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
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, text: 'local cinematic mock', actions: [], extendedActions: [] }));
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

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const port = server.address().port;
const localUrl = `http://127.0.0.1:${port}/`;

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
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
  assert.ok(response && response.ok(), `local cinematic URL failed: ${response?.status()}`);
  await page.waitForFunction(() => window.__novaScene && window.__novaEmbodimentReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });
  await page.waitForFunction(() => window.__novaCinematicDirectorReady === true && window.__novaVR180 && window.__novaPresentation, null, { timeout: 20000 });

  await page.evaluate(() => {
    window.__novaCinematicDispatched = [];
    window.addEventListener('nova:cinematic-action', (event) => {
      window.__novaCinematicDispatched.push(event.detail?.name);
    });
  });

  const initial = await page.evaluate(() => ({
    avatar: { x: window.__novaScene.avatar.position.x, y: window.__novaScene.avatar.position.y, z: window.__novaScene.avatar.position.z },
    targets: [...window.__novaScene.targets.keys()],
    humanoid: window.__novaHumanoid.getState(),
    presets: window.__novaVR180.presets,
    baselines: window.__novaVR180.baselines,
    deviceVisible: window.__novaScene.device?.visible !== false,
    collapsed: document.getElementById('cinematic-director')?.classList.contains('collapsed') === true,
    dispatcher: typeof window.__NovaApp?.executeAction === 'function',
  }));

  assert.ok(initial.targets.includes('actor_window'), 'cinematic window target missing at runtime');
  assert.ok(initial.targets.includes('actor_table'), 'cinematic table target missing at runtime');
  assert.ok(initial.targets.includes('actor_glass'), 'cinematic prop target missing at runtime');
  assert.equal(initial.humanoid.ready, true, 'humanoid not ready');
  assert.equal(initial.humanoid.modelVisible, true, 'humanoid model not visible');
  assert.equal(initial.deviceVisible, true, 'service device must stay visible until presentation mode');
  assert.equal(initial.collapsed, true, 'director UI should start collapsed');
  assert.equal(initial.dispatcher, true, 'Nova chat dispatcher missing');
  assert.equal(initial.presets.draft.width, 4096);
  assert.equal(initial.presets.draft.height, 2048);
  assert.equal(initial.presets.quest.width, 5760);
  assert.equal(initial.presets.quest.height, 2880);
  assert.equal(initial.presets.quest.fps, 48);
  assert.equal(initial.baselines.canon.meters, 0.060);
  assert.equal(initial.baselines.natural.meters, 0.064);

  const plan = await page.evaluate(async () => {
    return window.__novaCinematicDirector.compile(
      'Девушка замечает зрителя, подходит ближе и машет рукой. Затем говорит: «Привет из VR».',
      false,
    );
  });
  const locomotion = plan.actions.filter((action) => ['approach_user', 'move_near', 'walk_to', 'step'].includes(action.name));
  assert.equal(locomotion.filter((action) => action.name === 'approach_user' || action.name === 'move_near').length <= 1, true, `parallel viewer locomotion: ${JSON.stringify(locomotion)}`);

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
    deviceVisible: window.__novaScene.device?.visible !== false,
  }));
  assert.equal(present.enabled, true, 'presentation API did not enable');
  assert.equal(present.classOnRoot, true, 'presentation CSS class missing');
  assert.equal(present.deviceVisible, false, 'presentation mode should hide the legacy service device');
  await page.evaluate(() => window.__novaPresentation.disable());
  const restored = await page.evaluate(() => window.__novaScene.device?.visible !== false);
  assert.equal(restored, true, 'leaving presentation mode should restore the service device');

  const finalState = await page.evaluate(() => ({
    avatar: { x: window.__novaScene.avatar.position.x, y: window.__novaScene.avatar.position.y, z: window.__novaScene.avatar.position.z },
    pose: window.__novaEmbodiment.getPose(),
    log: document.getElementById('cinematic-director-log')?.textContent || '',
    baselineValue: document.getElementById('vr180-baseline')?.value || '',
    dispatched: window.__novaCinematicDispatched || [],
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
  assert.ok(finalState.dispatched.includes('approach_user'), `director chain missed approach_user: ${finalState.dispatched.join(',')}`);
  assert.ok(finalState.dispatched.includes('wave'), `director chain missed wave: ${finalState.dispatched.join(',')}`);
  assert.ok(finalState.dispatched.includes('speak'), `director chain missed speak: ${finalState.dispatched.join(',')}`);
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
  server.close();
}
