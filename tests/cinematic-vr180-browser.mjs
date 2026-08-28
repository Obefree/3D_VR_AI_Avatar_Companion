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
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
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
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Failed to load resource:.*404/.test(text)) return;
    errors.push(text);
  });
  page.on('response', (response) => {
    if (response.status() !== 404) return;
    const url = response.url();
    if (/\.(js|css|html|glb|gltf|wasm)(\?|$)/i.test(url)) errors.push(`404 ${url}`);
  });

  const response = await page.goto(localUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response && response.ok(), `local runtime failed: ${response?.status()}`);
  await page.waitForFunction(() => window.__novaScene && window.__novaEmbodimentReady === true && window.__NovaApp?.executeAction, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });
  await page.waitForFunction(() => window.__novaCinematicDirectorReady === true && window.__novaVR180, null, { timeout: 20000 });

  const initial = await page.evaluate(() => ({
    avatar: { x: window.__novaScene.avatar.position.x, y: window.__novaScene.avatar.position.y, z: window.__novaScene.avatar.position.z },
    targets: [...window.__novaScene.targets.keys()],
    humanoid: window.__novaHumanoid.getState(),
    presets: window.__novaVR180.presets,
    dispatcher: typeof window.__NovaApp.executeAction,
    interceptor: typeof window.fetch.toString === 'function' ? window.fetch.toString().includes('extendedActions') : false,
  }));

  assert.ok(initial.targets.includes('actor_window'), 'cinematic window target missing at runtime');
  assert.ok(initial.targets.includes('actor_table'), 'cinematic table target missing at runtime');
  assert.ok(initial.targets.includes('actor_glass'), 'cinematic glass target missing at runtime');
  assert.equal(initial.humanoid.ready, true, 'humanoid not ready');
  assert.equal(initial.humanoid.modelVisible, true, 'humanoid model not visible');
  assert.equal(initial.dispatcher, 'function', 'shared executeAction dispatcher missing');
  assert.equal(initial.interceptor, false, 'fetch interceptor is still wrapping extendedActions');
  assert.equal(initial.presets.draft.width, 4096);
  assert.equal(initial.presets.draft.height, 2048);
  assert.equal(initial.presets.quest.width, 5760);
  assert.equal(initial.presets.quest.height, 2880);
  assert.equal(initial.presets.quest.fps, 48);

  const chain = await page.evaluate(async () => {
    const dispatched = [];
    const original = window.__NovaApp.executeAction.bind(window.__NovaApp);
    window.__NovaApp.executeAction = async (action) => {
      dispatched.push(action.name);
      return original(action);
    };
    const before = { x: window.__novaScene.avatar.position.x, z: window.__novaScene.avatar.position.z };
    const result = await window.__novaCinematicDirector.run(
      'Девушка замечает зрителя, подходит ближе и машет рукой. Затем говорит: «Привет из VR».',
      { preferAI: false },
    );
    return {
      names: result.actions.map((action) => action.name),
      dispatched,
      travel: Math.hypot(window.__novaScene.avatar.position.x - before.x, window.__novaScene.avatar.position.z - before.z),
      pose: window.__novaEmbodiment.getPose(),
      log: document.getElementById('cinematic-director-log')?.textContent || '',
      ui: {
        director: Boolean(document.getElementById('cinematic-director')),
        record: Boolean(document.getElementById('vr180-record-button')),
        preset: Boolean(document.getElementById('vr180-preset')),
      },
    };
  });

  assert.ok(chain.travel > 0.2, `cinematic scenario did not move avatar enough: ${chain.travel}`);
  assert.ok(chain.names.includes('approach_user'), `viewer approach missing: ${chain.names.join(',')}`);
  assert.ok(chain.names.includes('wave'), `wave missing: ${chain.names.join(',')}`);
  assert.ok(chain.names.includes('speak'), `speak missing: ${chain.names.join(',')}`);
  assert.equal(chain.names.includes('step'), false, 'approach_user ran in parallel with step');
  assert.ok(chain.dispatched.includes('wave'), `wave bypassed __NovaApp.executeAction: ${chain.dispatched.join(',')}`);
  assert.ok(chain.dispatched.includes('face_user') || chain.names.includes('face_user'), 'look/face chain did not run');
  assert.equal(chain.ui.director, true, 'cinematic director UI missing');
  assert.equal(chain.ui.record, true, 'VR180 record button missing');
  assert.equal(chain.ui.preset, true, 'VR180 preset selector missing');
  assert.match(chain.log, /Scene complete/i, `scene did not complete: ${chain.log}`);
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);

  console.log('CINEMATIC_VR180_BROWSER_PASS');
  console.log(localUrl);
  await context.close();
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
