import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.cwd());
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/chat') {
      if (req.method === 'GET') return json(res, 200, { ok: true, provider: 'cinematic-mock', contract: 'semantic-actions-v1' });
      if (req.method === 'POST') {
        for await (const chunk of req) { void chunk; }
        return json(res, 200, { ok: true, text: 'Director mock.', intent: 'acknowledge', actions: [], extendedActions: [] });
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

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'ru-RU',
  });
  await context.addInitScript(() => {
    class MockUtterance {
      constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.pitch = 1; this.onend = null; this.onerror = null; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, speak(u) { setTimeout(() => u.onend?.(), 25); } },
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  const response = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response && response.ok(), `local app failed: ${response?.status()}`);
  await page.waitForFunction(() => window.__novaScene && window.__NovaApp && window.__novaEmbodimentReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });
  await page.waitForFunction(() => window.__novaCinematicDirectorReady === true && window.__novaVR180, null, { timeout: 20000 });

  const overlayBlocksOrbit = await page.evaluate(() => {
    const hit = document.elementFromPoint(160, 500);
    return Boolean(hit?.closest?.('#cinematic-director, .cinematic-director, .cinematic-director-body, #cinematic-director-body'));
  });
  assert.equal(overlayBlocksOrbit, false, 'collapsed cinematic overlay still covers the orbit gesture zone');

  const dispatcher = await page.evaluate(() => typeof window.__NovaApp?.executeAction === 'function');
  assert.equal(dispatcher, true, 'app action dispatcher is missing at runtime');

  const initial = await page.evaluate(() => ({
    avatar: { x: window.__novaScene.avatar.position.x, y: window.__novaScene.avatar.position.y, z: window.__novaScene.avatar.position.z },
    targets: [...window.__novaScene.targets.keys()],
    expanded: document.getElementById('cinematic-director')?.classList.contains('expanded') === true,
    presets: window.__novaVR180.presets,
    fetchIsNativeWrapper: typeof window.fetch === 'function',
  }));

  assert.ok(initial.targets.includes('actor_window'), 'cinematic window target missing at runtime');
  assert.ok(initial.targets.includes('actor_table'), 'cinematic table target missing at runtime');
  assert.ok(initial.targets.includes('actor_glass'), 'cinematic glass target missing at runtime');
  assert.equal(initial.expanded, false, 'director panel should start collapsed so orbit remains usable');
  assert.equal(initial.presets.draft.width, 4096);
  assert.equal(initial.presets.draft.height, 2048);
  assert.equal(initial.presets.quest.width, 5760);
  assert.equal(initial.presets.quest.height, 2880);
  assert.equal(initial.presets.quest.fps, 48);

  const cameraBefore = await page.evaluate(() => {
    const p = window.__novaScene.camera.position;
    return [p.x, p.y, p.z];
  });
  const cdp = await context.newCDPSession(page);
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
    'cinematic overlay blocked one-finger orbit',
  );

  const waveEvents = [];
  await page.exposeFunction('__novaRecordAction', (detail) => waveEvents.push(detail));
  await page.evaluate(() => {
    window.addEventListener('nova:cinematic-action', (event) => window.__novaRecordAction(event.detail));
  });

  await page.evaluate(async () => {
    await window.__novaCinematicDirector.run(
      'Девушка замечает зрителя, подходит ближе и машет рукой. Затем говорит: «Привет из VR».',
      { preferAI: false },
    );
  });

  const finalState = await page.evaluate(() => ({
    avatar: { x: window.__novaScene.avatar.position.x, y: window.__novaScene.avatar.position.y, z: window.__novaScene.avatar.position.z },
    pose: window.__novaEmbodiment.getPose(),
    log: document.getElementById('cinematic-director-log')?.textContent || '',
    ui: {
      director: Boolean(document.getElementById('cinematic-director')),
      record: Boolean(document.getElementById('vr180-record-button')),
      preset: Boolean(document.getElementById('vr180-preset')),
    },
  }));

  const travel = Math.hypot(finalState.avatar.x - initial.avatar.x, finalState.avatar.z - initial.avatar.z);
  assert.ok(travel > 0.2, `cinematic scenario did not move avatar enough: ${travel}`);
  assert.equal(finalState.ui.director, true, 'cinematic director UI missing');
  assert.equal(finalState.ui.record, true, 'VR180 record button missing');
  assert.equal(finalState.ui.preset, true, 'VR180 preset selector missing');
  assert.match(finalState.log, /Scene complete/i, `scene did not complete: ${finalState.log}`);
  assert.ok(waveEvents.some((item) => item?.name === 'wave'), 'wave action never reached the cinematic executor');
  assert.ok(waveEvents.some((item) => item?.name === 'approach_user'), 'approach_user missing from director chain');
  assert.equal(
    waveEvents.filter((item) => item?.name === 'approach_user' || item?.name === 'step' || item?.name === 'move_near').length,
    1,
    'parallel locomotion aliases ran in the same scene',
  );
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);

  console.log('CINEMATIC_VR180_BROWSER_PASS');
  console.log(base);
  await context.close();
} finally {
  await browser?.close();
  server.close();
}
