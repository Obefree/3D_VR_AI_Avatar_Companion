import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.cwd());
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/chat') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, text: '', actions: [], extendedActions: [] }));
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

let browser;
try {
  await assert.rejects(access(resolve(root, 'tests/e2e.mjs')), /ENOENT/);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'ru-RU',
  });
  await context.addInitScript(() => {
    class MockUtterance {
      constructor(text) { this.text = text; this.lang = ''; this.onend = null; this.onerror = null; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, speak(u) { setTimeout(() => u.onend?.(), 20); } },
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__NovaApp?.executeAction && window.__novaCinematicDirectorReady === true, null, { timeout: 25000 });
  await page.waitForFunction(() => window.__novaEmbodimentReady === true, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });

  const overlay = await page.evaluate(() => {
    const panel = document.getElementById('cinematic-director');
    const style = panel ? getComputedStyle(panel) : null;
    return {
      present: Boolean(panel),
      pointerEvents: style?.pointerEvents || '',
      fetchIsNative: window.fetch === window.__NOVA_PRIMARY_FETCH || typeof window.__NOVA_PRIMARY_FETCH === 'undefined',
    };
  });
  assert.equal(overlay.present, true, 'cinematic director overlay missing');
  assert.equal(overlay.pointerEvents, 'none', `director overlay captures canvas touches: ${overlay.pointerEvents}`);
  assert.equal(overlay.fetchIsNative, true, 'PRIMARY_FETCH duplicate interceptor is still installed');

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
    'one-finger touch rotate did not move the camera through the director overlay',
  );

  const initial = await page.evaluate(() => {
    const original = window.__NovaApp.executeAction.bind(window.__NovaApp);
    window.__novaDispatched = [];
    window.__NovaApp.executeAction = async (action) => {
      window.__novaDispatched.push(action?.name);
      return original(action);
    };
    return {
      x: window.__novaScene.avatar.position.x,
      z: window.__novaScene.avatar.position.z,
      bodyVisible: window.__novaScene.body?.visible,
    };
  });

  await page.evaluate(async () => {
    await window.__novaCinematicDirector.run(
      'Девушка замечает зрителя, подходит ближе и машет рукой. Затем говорит: «Привет из VR».',
      { preferAI: false },
    );
  });

  const finalState = await page.evaluate(() => ({
    dispatched: window.__novaDispatched || [],
    pose: window.__novaEmbodiment.getPose(),
    travel: Math.hypot(
      window.__novaScene.avatar.position.x - window.__novaScene.avatarHome.x,
      window.__novaScene.avatar.position.z - window.__novaScene.avatarHome.z,
    ),
    dx: window.__novaScene.avatar.position.x - (window.__novaStartX ?? 0),
    log: document.getElementById('cinematic-director-log')?.textContent || '',
    running: window.__novaCinematicDirector.running,
    bodyVisible: window.__novaScene.body?.visible,
  }));

  const travel = await page.evaluate((start) => Math.hypot(
    window.__novaScene.avatar.position.x - start.x,
    window.__novaScene.avatar.position.z - start.z,
  ), initial);

  assert.ok(travel > 0.2, `cinematic chain did not move avatar: ${travel}`);
  assert.ok(finalState.dispatched.includes('wave'), `wave did not go through __NovaApp.executeAction: ${finalState.dispatched.join(',')}`);
  assert.ok(finalState.dispatched.includes('face_user') || finalState.dispatched.includes('look_at'), `scene actions bypassed the app dispatcher: ${finalState.dispatched.join(',')}`);
  assert.equal(finalState.dispatched.includes('approach_user'), false, 'director-only approach_user was sent through the chat dispatcher');
  assert.equal(finalState.running, false, 'director remained marked running after the chain');
  assert.match(finalState.log, /Scene complete/i, `scene did not complete: ${finalState.log}`);
  assert.equal(finalState.bodyVisible, false, 'hidden robot body became visible during the chain');
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);

  console.log('CINEMATIC_CHAIN_SMOKE_PASS');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
