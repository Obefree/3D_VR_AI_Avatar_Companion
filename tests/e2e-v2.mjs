import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.cwd());
const requests = [];

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function mockReply(body) {
  const message = String(body.message || '').trim();
  const lower = message.toLowerCase();
  const step = body.scene?.task?.step || 'reset_required';
  const failed = (body.toolResults || []).find((item) => item?.result?.ok === false);

  if (body.phase === 'after_tools' && failed?.result?.error === 'reset_required') {
    return {
      ok: true,
      text: 'Сначала нужно нажать красную кнопку сброса.',
      intent: 'explain_prerequisite',
      actions: [
        { name: 'look_at', args: { targetId: 'red_button' } },
        { name: 'point_at', args: { targetId: 'red_button' } },
        { name: 'highlight', args: { targetId: 'red_button', seconds: 2 } },
      ],
    };
  }

  if (body.phase === 'after_tools' && lower.includes('я нажал красную кнопку')) {
    return { ok: true, text: 'Сброс выполнен. Теперь можно перейти к фильтру.', intent: 'confirm_reset', actions: [] };
  }
  if (body.phase === 'after_tools' && lower.includes('я вынул фильтр')) {
    return { ok: true, text: 'Готово. Фильтр извлечён, обслуживание завершено.', intent: 'confirm_complete', actions: [] };
  }

  if (lower === 'покажи красную кнопку' || lower.includes('посмотри на красную кнопку')) {
    return {
      ok: true,
      text: 'Вот красная кнопка сброса.',
      intent: 'show_reset',
      actions: [
        { name: 'look_at', args: { targetId: 'red_button' } },
        { name: 'point_at', args: { targetId: 'red_button' } },
        { name: 'highlight', args: { targetId: 'red_button', seconds: 2 } },
      ],
    };
  }

  if (lower === 'нажми её' || lower.includes('нажми красную кнопку')) {
    return {
      ok: true,
      text: 'Нажимаю кнопку сброса.',
      intent: 'press_reset',
      actions: [{ name: 'press_button', args: { targetId: 'red_button' } }],
    };
  }

  if (lower === 'что дальше?') {
    assert.equal(step, 'filter_required', 'AI received stale task state after reset');
    return {
      ok: true,
      text: 'Сброс выполнен. Теперь вынь фильтр снизу.',
      intent: 'next_filter',
      actions: [
        { name: 'look_at', args: { targetId: 'filter' } },
        { name: 'point_at', args: { targetId: 'filter' } },
        { name: 'highlight', args: { targetId: 'filter', seconds: 2 } },
      ],
    };
  }

  if (lower === 'вытащи фильтр') {
    if (!body.scene?.deviceState?.resetPressed) {
      return {
        ok: true,
        text: 'Сначала нужно выполнить сброс.',
        intent: 'reset_first',
        actions: [{ name: 'point_at', args: { targetId: 'red_button' } }],
      };
    }
    return {
      ok: true,
      text: 'Вытаскиваю фильтр.',
      intent: 'remove_filter',
      actions: [{ name: 'remove_filter', args: { targetId: 'filter' } }],
    };
  }

  if (lower === 'мы закончили?') {
    assert.equal(step, 'complete', 'AI received stale task state after filter removal');
    return { ok: true, text: 'Да. Сброс выполнен, фильтр извлечён — задача завершена.', intent: 'complete', actions: [] };
  }

  if (lower.includes('попытался вынуть фильтр')) {
    return {
      ok: true,
      text: 'Фильтр заблокирован до сброса. Сначала нажми красную кнопку.',
      intent: 'reset_first',
      actions: [
        { name: 'look_at', args: { targetId: 'red_button' } },
        { name: 'point_at', args: { targetId: 'red_button' } },
      ],
    };
  }

  if (lower.includes('выбрал это устройство')) {
    return { ok: true, text: 'Это сервисный модуль. Начни с красной кнопки сброса.', intent: 'describe_device', actions: [] };
  }

  return { ok: true, text: 'Понял.', intent: 'acknowledge', actions: [] };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/chat') {
      if (req.method === 'GET') {
        return json(res, 200, { ok: true, provider: 'e2e-mock', contract: 'semantic-actions-v1' });
      }
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw || '{}');
        requests.push(body);
        return json(res, 200, mockReply(body));
      }
      return json(res, 405, { ok: false });
    }

    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
    const file = resolve(root, safe);
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    res.writeHead(404);
    res.end(String(error?.message || 'not found'));
  }
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const port = server.address().port;

let browser;
try {
  const appSource = await readFile(resolve(root, 'src/app.js'), 'utf8');
  const indexSource = await readFile(resolve(root, 'index.html'), 'utf8');
  for (const stale of ['RealtimeCompanion', 'realtimeBackendAvailable', 'applySpatialIntent']) {
    assert.equal(appSource.includes(stale), false, `stale active runtime symbol remains: ${stale}`);
  }
  assert.equal(indexSource.includes('tap-interaction.js'), false, 'legacy tap bridge is still loaded');
  assert.equal(indexSource.includes('remote-audio'), false, 'legacy realtime audio element is still loaded');
  assert.equal(indexSource.includes('__NOVA_PRIMARY_FETCH'), false, 'duplicate fetch interceptor is still papered over');
  const embodimentSource = await readFile(resolve(root, 'src/embodiment.js'), 'utf8');
  assert.equal(/window\.fetch\s*=/.test(embodimentSource), false, 'embodiment still wraps fetch beside app.js');
  await assert.rejects(access(resolve(root, 'src/realtime.js')), /ENOENT/);
  await assert.rejects(access(resolve(root, 'api/session.js')), /ENOENT/);
  await assert.rejects(access(resolve(root, 'api/health.js')), /ENOENT/);
  await assert.rejects(access(resolve(root, 'tests/e2e.mjs')), /ENOENT/);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'ru-RU',
  });

  await context.addInitScript(() => {
    window.__mockVoiceConsumed = false;
    window.__mockVoiceText = 'Посмотри на красную кнопку';

    class MockRecognition {
      constructor() {
        this.lang = 'en-US';
        this.interimResults = false;
        this.continuous = false;
        this.maxAlternatives = 1;
      }
      start() {
        this.onstart?.();
        if (window.__mockVoiceConsumed) return;
        window.__mockVoiceConsumed = true;
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: window.__mockVoiceText }]] });
          this.onend?.();
        }, 30);
      }
      abort() { this.onend?.(); }
    }

    class MockUtterance {
      constructor(text) {
        this.text = text;
        this.lang = '';
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.onend = null;
        this.onerror = null;
      }
    }

    Object.defineProperty(window, 'SpeechRecognition', { value: MockRecognition, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: MockRecognition, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        speak(utterance) { setTimeout(() => utterance.onend?.(), 10); },
      },
    });
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__novaScene && window.__NovaApp, null, { timeout: 20000 });
  await page.waitForFunction(() => document.getElementById('transport-state')?.textContent === 'AI ready', null, { timeout: 10000 });

  // A. Connect through the real visible UI.
  await page.click('#live-button');
  await page.waitForFunction(() => document.getElementById('live-button')?.textContent === 'AI connected');
  assert.equal(await page.textContent('#mode-pill'), 'AI mode');
  assert.equal(await page.textContent('#connection-pill'), 'Connected');

  async function sendViaUI(text) {
    const before = await page.locator('#messages .message').count();
    await page.fill('#text-input', text);
    await page.click('#send-button');
    await page.waitForFunction(
      (count) => document.querySelectorAll('#messages .message').length >= count + 2,
      before,
      { timeout: 12000 },
    );
  }

  // B1. Showing a button is not pressing it.
  await sendViaUI('Покажи красную кнопку');
  let state = await page.evaluate(() => ({
    look: window.__novaScene.lookTarget,
    point: window.__novaScene.pointTarget,
    reset: window.__novaScene.deviceState.resetPressed,
  }));
  assert.equal(state.look, 'red_button');
  assert.equal(state.point, 'red_button');
  assert.equal(state.reset, false, 'show/highlight accidentally pressed reset');

  // B2. Pronoun follow-up -> real press animation -> persistent state -> screen change.
  const beforePressMessages = await page.locator('#messages .message').count();
  await page.fill('#text-input', 'Нажми её');
  await page.click('#send-button');
  await page.waitForFunction(
    () => window.__novaScene.redButton.position.z < window.__novaScene.redButtonRestZ - 0.01,
    null,
    { timeout: 3000 },
  );
  await page.waitForFunction(() => window.__novaScene.deviceState.resetPressed === true, null, { timeout: 5000 });
  await page.waitForFunction(
    (count) => document.querySelectorAll('#messages .message').length >= count + 2,
    beforePressMessages,
    { timeout: 12000 },
  );
  state = await page.evaluate(() => ({
    context: window.__novaScene.getSceneContext(),
    screen: window.__novaScene.screenMaterial.emissive.getHexString(),
  }));
  assert.equal(state.context.task.step, 'filter_required');
  assert.equal(state.context.deviceState.resetPressed, true);
  assert.notEqual(state.screen, '1f84bd', 'device screen did not visibly change after reset');

  const pronounRequest = requests.find((item) => item.message === 'Нажми её');
  assert.ok(pronounRequest, 'pronoun request never reached backend');
  assert.ok(
    pronounRequest.history.some((turn) => turn.role === 'user' && turn.content === 'Покажи красную кнопку'),
    'conversation history was not sent with pronoun follow-up',
  );

  // B3. State-aware next step. Wait for the actual scene actions, not only transcript rendering.
  await sendViaUI('Что дальше?');
  await page.waitForFunction(
    () => window.__novaScene.lookTarget === 'filter' && window.__novaScene.pointTarget === 'filter',
    null,
    { timeout: 5000 },
  );
  state = await page.evaluate(() => ({
    look: window.__novaScene.lookTarget,
    point: window.__novaScene.pointTarget,
    step: window.__novaScene.getSceneContext().task.step,
  }));
  assert.equal(state.step, 'filter_required');
  assert.equal(state.look, 'filter');
  assert.equal(state.point, 'filter');

  // B4. Filter physically moves and completes the task.
  await page.fill('#text-input', 'Вытащи фильтр');
  await page.click('#send-button');
  await page.waitForFunction(
    () => window.__novaScene.filter.position.z > window.__novaScene.filterRestPosition.z + 0.1,
    null,
    { timeout: 4000 },
  );
  await page.waitForFunction(() => window.__novaScene.deviceState.filterRemoved === true, null, { timeout: 5000 });
  state = await page.evaluate(() => window.__novaScene.getSceneContext());
  assert.equal(state.task.step, 'complete');

  await sendViaUI('Мы закончили?');
  assert.match(await page.locator('#messages .message.assistant').last().innerText(), /завершена|готово|да/i);

  // C. Fresh state: physical filter attempt before reset must fail and remain in place.
  await page.evaluate(() => window.__novaScene.resetTask());
  const beforeBlockedTap = await page.locator('#messages .message').count();
  await page.evaluate(() => window.__novaScene.activateTarget('filter', 'tap'));
  await page.waitForFunction(
    (count) => document.querySelectorAll('#messages .message').length >= count + 2,
    beforeBlockedTap,
    { timeout: 12000 },
  );
  state = await page.evaluate(() => ({
    context: window.__novaScene.getSceneContext(),
    filterZ: window.__novaScene.filter.position.z,
    restZ: window.__novaScene.filterRestPosition.z,
  }));
  assert.equal(state.context.deviceState.filterRemoved, false);
  assert.equal(state.context.task.step, 'reset_required');
  assert.equal(state.filterZ, state.restZ);
  assert.match(await page.locator('#messages .message.assistant').last().innerText(), /сначала|сброс/i);

  // D. Frame the DEVICE for physical mobile hit tests (equivalent to user pan + zoom).
  // On a 390x844 portrait viewport, centering the camera at x=0 creates a very narrow horizontal FOV.
  // Target the device cluster itself instead of altering product geometry/FOV.
  await page.evaluate(() => {
    const s = window.__novaScene;
    s.camera.position.set(0.7, 1.7, 7.4);
    s.controls.target.set(0.7, 0.95, 0);
    s.controls.update();
  });
  await page.waitForTimeout(300);

  async function projectTarget(id) {
    return page.evaluate((targetId) => {
      const s = window.__novaScene;
      const target = s.targets.get(targetId).position.clone().project(s.camera);
      const rect = s.canvas.getBoundingClientRect();
      return {
        x: rect.left + (target.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-target.y * 0.5 + 0.5) * rect.height,
      };
    }, id);
  }

  // D1. Actual mobile center tap on red button -> real press -> exactly one Nova response.
  await page.evaluate(() => window.__novaScene.resetTask());
  await page.evaluate(() => {
    const s = window.__novaScene;
    s.camera.position.set(0.7, 1.7, 7.4);
    s.controls.target.set(0.7, 0.95, 0);
    s.controls.update();
  });
  let red = await projectTarget('red_button');
  assert.ok(red.x > 4 && red.x < 386 && red.y > 4 && red.y < 840, `red button not in mobile viewport: ${JSON.stringify(red)}`);
  let beforeTapMessages = await page.locator('#messages .message').count();
  await page.touchscreen.tap(red.x, red.y);
  await page.waitForFunction(() => window.__novaScene.deviceState.resetPressed === true, null, { timeout: 5000 });
  await page.waitForFunction(
    (count) => document.querySelectorAll('#messages .message').length >= count + 2,
    beforeTapMessages,
    { timeout: 12000 },
  );
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#messages .message').count(), beforeTapMessages + 2, 'one physical tap produced duplicate Nova replies');

  // D2. Edge/base tap should still resolve to red_button.
  await page.evaluate(() => window.__novaScene.resetTask());
  await page.evaluate(() => {
    const s = window.__novaScene;
    s.camera.position.set(0.7, 1.7, 7.4);
    s.controls.target.set(0.7, 0.95, 0);
    s.controls.update();
  });
  red = await projectTarget('red_button');
  beforeTapMessages = await page.locator('#messages .message').count();
  await page.touchscreen.tap(red.x + 10, red.y + 8);
  await page.waitForFunction(() => window.__novaScene.deviceState.resetPressed === true, null, { timeout: 5000 });
  await page.waitForFunction(
    (count) => document.querySelectorAll('#messages .message').length >= count + 2,
    beforeTapMessages,
    { timeout: 12000 },
  );
  assert.equal(await page.locator('#messages .message').count(), beforeTapMessages + 2, 'edge/base tap produced duplicate replies');

  // D3. Shell tap: no whole-box recolor.
  const device = await projectTarget('device');
  const shellBefore = await page.evaluate(() => window.__novaScene.targets.get('device').material.emissive.getHexString());
  beforeTapMessages = await page.locator('#messages .message').count();
  await page.touchscreen.tap(device.x - 20, device.y - 30);
  await page.waitForFunction(
    (count) => document.querySelectorAll('#messages .message').length >= count + 2,
    beforeTapMessages,
    { timeout: 12000 },
  );
  const shellAfter = await page.evaluate(() => window.__novaScene.targets.get('device').material.emissive.getHexString());
  assert.equal(shellAfter, shellBefore, 'generic device tap recolored the shell');

  // E. Real synthetic touch gestures against OrbitControls: one-finger rotate + two-finger pinch.
  const cdp = await context.newCDPSession(page);
  const cameraBefore = await page.evaluate(() => {
    const p = window.__novaScene.camera.position;
    return [p.x, p.y, p.z];
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: 500, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 235, y: 470, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  const cameraAfter = await page.evaluate(() => {
    const p = window.__novaScene.camera.position;
    return [p.x, p.y, p.z];
  });
  assert.ok(
    Math.hypot(...cameraAfter.map((value, index) => value - cameraBefore[index])) > 0.05,
    'one-finger touch rotate did not move the camera',
  );

  const distanceBefore = await page.evaluate(() => window.__novaScene.camera.position.distanceTo(window.__novaScene.controls.target));
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 155, y: 510, id: 2 }, { x: 225, y: 510, id: 3 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 125, y: 510, id: 2 }, { x: 255, y: 510, id: 3 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  const distanceAfter = await page.evaluate(() => window.__novaScene.camera.position.distanceTo(window.__novaScene.controls.target));
  assert.ok(Math.abs(distanceAfter - distanceBefore) > 0.03, 'two-finger pinch did not change camera distance');

  // F. Mock Russian SpeechRecognition. This proves voice transcript uses the SAME semantic AI/action path.
  const requestCountBeforeVoice = requests.length;
  await page.evaluate(() => {
    window.__mockVoiceConsumed = false;
    window.__mockVoiceText = 'Посмотри на красную кнопку';
  });
  await page.click('#voice-demo-button');
  await page.waitForFunction(
    () => window.__NovaApp.getConversation().some((turn) => turn.role === 'user' && turn.content === 'Посмотри на красную кнопку'),
    null,
    { timeout: 12000 },
  );
  await page.waitForFunction(() => window.__novaScene.lookTarget === 'red_button', null, { timeout: 12000 });
  assert.ok(requests.length > requestCountBeforeVoice, 'voice transcript never reached /api/chat');
  const voiceRequest = requests.findLast((item) => item.message === 'Посмотри на красную кнопку');
  assert.ok(voiceRequest, 'mocked Russian voice transcript missing from backend requests');
  assert.match(String(voiceRequest.locale), /^ru/i, 'voice/browser locale was not sent as Russian');
  await page.evaluate(() => window.__NovaApp.stopVoice());

  assert.deepEqual(consoleErrors, [], `browser console/page errors: ${consoleErrors.join(' | ')}`);
  console.log('E2E PASS: connect -> Russian semantic actions -> state -> physical taps -> touch orbit/pinch -> mocked Russian voice');
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
