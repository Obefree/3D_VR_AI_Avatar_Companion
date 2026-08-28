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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/chat') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, provider: 'cinematic-local', contract: 'semantic-actions-v1' }));
      return;
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
const localUrl = `http://127.0.0.1:${port}/`;

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  await context.addInitScript(() => {
    class MockUtterance {
      constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.pitch = 1; this.onend = null; this.onerror = null; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel(){}, speak(u){ setTimeout(() => u.onend?.(), 25); } } });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  const response = await page.goto(localUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response && response.ok(), `local cinematic runtime failed: ${response?.status()}`);
  await page.waitForFunction(() => window.__novaScene && window.__novaEmbodimentReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });
  await page.waitForFunction(() => window.__novaCinematicDirectorReady === true && window.__novaVR180 && window.__novaPresentation && window.__NovaApp?.executeAction, null, { timeout: 20000 });

  const initial = await page.evaluate(() => {
    const panel = document.getElementById('cinematic-director');
    const style = panel ? getComputedStyle(panel) : null;
    const rect = panel?.getBoundingClientRect();
    const hit = document.elementFromPoint(160, 500);
    return {
      avatar: { x: window.__novaScene.avatar.position.x, y: window.__novaScene.avatar.position.y, z: window.__novaScene.avatar.position.z },
      targets: [...window.__novaScene.targets.keys()],
      humanoid: window.__novaHumanoid.getState(),
      presets: window.__novaVR180.presets,
      baselines: window.__novaVR180.baselines,
      deviceVisible: window.__novaScene.device?.visible,
      dispatcher: typeof window.__NovaApp?.executeAction,
      overlay: {
        collapsed: panel?.classList.contains('collapsed') === true,
        pointerEvents: style?.pointerEvents || '',
        height: rect?.height || 0,
        bottom: rect?.bottom || 0,
      },
      orbitHit: { id: hit?.id || '', tag: hit?.tagName || '' },
    };
  });

  assert.ok(initial.targets.includes('actor_window'), 'cinematic window target missing at runtime');
  assert.ok(initial.targets.includes('actor_table'), 'cinematic table target missing at runtime');
  assert.ok(initial.targets.includes('actor_glass'), 'cinematic glass target missing at runtime');
  assert.equal(initial.humanoid.ready, true, 'humanoid not ready');
  assert.equal(initial.humanoid.modelVisible, true, 'humanoid model not visible');
  assert.equal(initial.deviceVisible, true, 'legacy service device must stay visible until presentation mode');
  assert.equal(initial.dispatcher, 'function', 'chat/director dispatcher missing');
  assert.equal(initial.overlay.collapsed, true, 'director panel must start collapsed so it does not cover the canvas');
  assert.equal(initial.overlay.pointerEvents, 'none', 'director chrome must let canvas orbit gestures pass through');
  assert.ok(initial.overlay.height < 90, `collapsed director still covers the canvas: ${initial.overlay.height}`);
  assert.ok(initial.overlay.bottom < 220, `collapsed director dropped into the orbit zone: ${initial.overlay.bottom}`);
  assert.equal(initial.orbitHit.id, 'scene', `orbit point hit overlay instead of canvas: ${JSON.stringify(initial.orbitHit)}`);
  assert.equal(initial.presets.draft.width, 4096);
  assert.equal(initial.presets.draft.height, 2048);
  assert.equal(initial.presets.quest.width, 5760);
  assert.equal(initial.presets.quest.height, 2880);
  assert.equal(initial.presets.quest.fps, 48);
  assert.equal(initial.baselines.canon.meters, 0.060);
  assert.equal(initial.baselines.natural.meters, 0.064);

  await page.evaluate(async () => {
    await window.__novaCinematicDirector.run(
      'Девушка замечает зрителя, подходит ближе и машет рукой. Затем говорит: «Привет из VR».',
      { preferAI: false },
    );
  });

  await page.evaluate(() => window.__novaPresentation.enable());
  const present = await page.evaluate(() => ({
    enabled: window.__novaPresentation.enabled,
    classOnRoot: document.documentElement.classList.contains('cinematic-presentation'),
    deviceVisible: window.__novaScene.device?.visible,
  }));
  assert.equal(present.enabled, true, 'presentation API did not enable');
  assert.equal(present.classOnRoot, true, 'presentation CSS class missing');
  assert.equal(present.deviceVisible, false, 'presentation mode did not hide the legacy device');
  await page.evaluate(() => window.__novaPresentation.disable());
  const restored = await page.evaluate(() => window.__novaScene.device?.visible);
  assert.equal(restored, true, 'exiting presentation did not restore the legacy device');

  const finalState = await page.evaluate(() => ({
    avatar: { x: window.__novaScene.avatar.position.x, y: window.__novaScene.avatar.position.y, z: window.__novaScene.avatar.position.z },
    pose: window.__novaEmbodiment.getPose(),
    log: document.getElementById('cinematic-director-log')?.textContent || '',
    baselineValue: document.getElementById('vr180-baseline')?.value || '',
    ui: {
      director: Boolean(document.getElementById('cinematic-director')),
      record: Boolean(document.getElementById('vr180-record-button')),
      preset: Boolean(document.getElementById('vr180-preset')),
      baseline: Boolean(document.getElementById('vr180-baseline')),
      audio: Boolean(document.getElementById('vr180-tab-audio')),
      presentation: Boolean(document.getElementById('cinematic-present-toggle')),
    },
  }));

  const travel = Math.hypot(finalState.avatar.x - initial.avatar.x, finalState.avatar.z - initial.avatar.z);
  assert.ok(travel > 0.2, `cinematic scenario did not move avatar enough: ${travel}`);
  assert.equal(finalState.ui.director, true, 'cinematic director UI missing');
  assert.equal(finalState.ui.record, true, 'VR180 record button missing');
  assert.equal(finalState.ui.preset, true, 'VR180 preset selector missing');
  assert.equal(finalState.ui.baseline, true, 'VR180 baseline selector missing');
  assert.equal(finalState.ui.audio, true, 'VR180 tab-audio control missing');
  assert.equal(finalState.ui.presentation, true, 'presentation button missing');
  assert.equal(finalState.baselineValue, 'canon', 'Canon 60 mm baseline should be default');
  assert.match(finalState.log, /Scene complete/i, `scene did not complete: ${finalState.log}`);
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);

  console.log('CINEMATIC_VR180_BROWSER_PASS');
  console.log(localUrl);
  await context.close();
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
