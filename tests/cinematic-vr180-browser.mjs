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
      if (req.method === 'GET') return json(res, 200, { ok: true, provider: 'cinematic-mock' });
      if (req.method === 'POST') {
        return json(res, 200, {
          ok: true,
          text: 'Сцена готова.',
          intent: 'cinematic',
          actions: [
            { name: 'face_user', args: {} },
            { name: 'approach_user', args: { distanceFromUser: 1.55 } },
            { name: 'wave', args: { side: 'left' } },
            { name: 'move_near', args: { targetId: 'actor_table' } },
            { name: 'walk_to', args: { targetId: 'actor_table', stopDistance: 0.78 } },
            { name: 'speak', args: { text: 'Привет из VR' } },
          ],
        });
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
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(u) { setTimeout(() => u.onend?.(), 25); } } });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__novaScene && window.__novaEmbodimentReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });
  await page.waitForFunction(() => window.__novaCinematicDirectorReady === true && window.__novaVR180, null, { timeout: 20000 });

  const initial = await page.evaluate(() => ({
    avatar: { x: window.__novaScene.avatar.position.x, y: window.__novaScene.avatar.position.y, z: window.__novaScene.avatar.position.z },
    targets: [...window.__novaScene.targets.keys()],
    humanoid: window.__novaHumanoid.getState(),
    presets: window.__novaVR180.presets,
    overlay: (() => {
      const hit = document.elementFromPoint(160, 500);
      const panel = document.getElementById('cinematic-director');
      const box = panel?.getBoundingClientRect();
      return {
        collapsed: panel?.classList.contains('collapsed'),
        hitId: hit?.id || hit?.tagName || null,
        coversOrbit: Boolean(box && box.left <= 160 && box.right >= 160 && box.top <= 500 && box.bottom >= 500),
      };
    })(),
  }));

  assert.ok(initial.targets.includes('actor_window'), 'cinematic window target missing at runtime');
  assert.ok(initial.targets.includes('actor_table'), 'cinematic table target missing at runtime');
  assert.ok(initial.targets.includes('actor_glass'), 'cinematic glass target missing at runtime');
  assert.equal(initial.humanoid.ready, true, 'humanoid not ready');
  assert.equal(initial.humanoid.modelVisible, true, 'humanoid model not visible');
  assert.equal(initial.presets.draft.width, 4096);
  assert.equal(initial.presets.draft.height, 2048);
  assert.equal(initial.presets.quest.width, 5760);
  assert.equal(initial.presets.quest.height, 2880);
  assert.equal(initial.presets.quest.fps, 48);
  assert.equal(initial.overlay.collapsed, true, 'cinematic director should stay collapsed so canvas orbit remains free');
  assert.equal(initial.overlay.coversOrbit, false, 'collapsed director overlay still covers the orbit touch point');

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
    'one-finger touch rotate did not move the camera under the cinematic overlay',
  );

  const compiled = await page.evaluate(async () => {
    const script = 'Девушка замечает зрителя, подходит ближе и машет рукой. Затем подходит к столу, берет стакан и говорит: «Привет из VR».';
    const fallback = await window.__novaCinematicDirector.compile(script, false);
    const ai = await window.__novaCinematicDirector.compile(script, true);
    return {
      fallback: fallback.actions.map((a) => `${a.name}:${a.args?.targetId || ''}`),
      ai: ai.actions.map((a) => `${a.name}:${a.args?.targetId || ''}`),
      aiSource: ai.source,
    };
  });
  const fallbackApproaches = compiled.fallback.filter((name) => name.startsWith('approach_user')).length;
  const fallbackWalksToTable = compiled.fallback.filter((name) => name === 'walk_to:actor_table' || name === 'move_near:actor_table').length;
  assert.equal(fallbackApproaches, 1, `duplicate viewer approach in fallback: ${compiled.fallback.join(',')}`);
  assert.equal(fallbackWalksToTable, 1, `parallel table locomotion in fallback: ${compiled.fallback.join(',')}`);
  const aiTableMoves = compiled.ai.filter((name) => name === 'walk_to:actor_table' || name === 'move_near:actor_table');
  assert.equal(aiTableMoves.length, 1, `AI plan kept parallel walk_to/move_near: ${compiled.ai.join(',')}`);

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
      executeAction: typeof window.__NovaApp?.executeAction === 'function',
    },
  }));

  const travel = Math.hypot(finalState.avatar.x - initial.avatar.x, finalState.avatar.z - initial.avatar.z);
  assert.ok(travel > 0.2, `cinematic scenario did not move avatar enough: ${travel}`);
  assert.equal(finalState.ui.director, true, 'cinematic director UI missing');
  assert.equal(finalState.ui.record, true, 'VR180 record button missing');
  assert.equal(finalState.ui.preset, true, 'VR180 preset selector missing');
  assert.equal(finalState.ui.executeAction, true, 'single action dispatcher missing');
  assert.match(finalState.log, /Scene complete/i, `scene did not complete: ${finalState.log}`);
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);

  console.log('CINEMATIC_VR180_BROWSER_PASS');
  await context.close();
} finally {
  await browser?.close();
  server.close();
}
