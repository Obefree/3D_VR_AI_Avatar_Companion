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
      if (req.method === 'GET') return res.end(JSON.stringify({ ok: true, source: 'local-cinematic-mock' }));
      let raw = '';
      for await (const chunk of req) raw += chunk;
      return res.end(JSON.stringify({ ok: true, text: 'local mock', actions: [], extendedActions: [] }));
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
    const file = resolve(root, safe);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    res.writeHead(error?.code === 'ENOENT' ? 404 : 500);
    res.end(String(error?.stack || error));
  }
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

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
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  const response = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response && response.ok(), `local URL failed: ${response?.status()}`);
  await page.waitForFunction(() => window.__novaScene && window.__novaEmbodimentReady === true && window.__NovaApp, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });
  await page.waitForFunction(() => window.__novaCinematicDirectorReady === true && window.__novaVR180, null, { timeout: 20000 });

  const initial = await page.evaluate(() => ({
    avatar: { x: window.__novaScene.avatar.position.x, y: window.__novaScene.avatar.position.y, z: window.__novaScene.avatar.position.z },
    targets: [...window.__novaScene.targets.keys()],
    humanoid: window.__novaHumanoid.getState(),
    presets: window.__novaVR180.presets,
    dispatcher: typeof window.__NovaApp.executeAction,
    primaryFetch: Boolean(window.__NOVA_PRIMARY_FETCH),
    fetchInterceptsChat: String(window.fetch).includes('nova-chat') || String(window.fetch).includes('extendedActions'),
    robotVisible: Boolean(window.__novaScene.body?.visible),
  }));

  assert.ok(initial.targets.includes('actor_window'), 'cinematic window target missing at runtime');
  assert.ok(initial.targets.includes('actor_table'), 'cinematic table target missing at runtime');
  assert.ok(initial.targets.includes('actor_glass'), 'cinematic glass target missing at runtime');
  assert.equal(initial.humanoid.ready, true, 'humanoid not ready');
  assert.equal(initial.humanoid.modelVisible, true, 'humanoid model not visible');
  assert.equal(initial.dispatcher, 'function', 'shared dispatcher missing');
  assert.equal(initial.primaryFetch, false, 'PRIMARY_FETCH workaround reappeared');
  assert.equal(initial.fetchInterceptsChat, false, 'fetch interceptor still wrapping chat');
  assert.equal(initial.robotVisible, false, 'hidden robot body is still visible');
  assert.equal(initial.presets.draft.width, 4096);
  assert.equal(initial.presets.draft.height, 2048);
  assert.equal(initial.presets.quest.width, 5760);
  assert.equal(initial.presets.quest.height, 2880);
  assert.equal(initial.presets.quest.fps, 48);

  const collapsed = await page.evaluate(() => window.__novaCinematicDirector.finalizePlan(
    'Подойди ближе к зрителю. Come closer.',
    [
      { name: 'move_near', args: {} },
      { name: 'step', args: { direction: 'forward', distance: 0.4 } },
      { name: 'approach_user', args: { distanceFromUser: 1.55 } },
      { name: 'approach_user', args: { distanceFromUser: 1.55 } },
      { name: 'wave', args: { side: 'left' } },
    ],
  ));
  assert.equal(collapsed.filter((action) => action.name === 'approach_user').length, 1, `parallel viewer locomotion survived: ${JSON.stringify(collapsed)}`);
  assert.equal(collapsed.some((action) => action.name === 'move_near' || action.name === 'step'), false, `camera walk/step still beside approach_user: ${JSON.stringify(collapsed)}`);
  assert.ok(collapsed.some((action) => action.name === 'wave'), 'wave dropped while collapsing locomotion');

  const parallel = await page.evaluate(async () => {
    const runPromise = window.__novaCinematicDirector.run(
      'Девушка замечает зрителя, подходит ближе и машет рукой. Затем говорит: «Привет из VR».',
      { preferAI: false },
    );
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (window.__novaCinematicDirector.running) { clearInterval(timer); resolve(); }
      }, 10);
    });
    const sendResult = await window.__NovaApp.send('Подними левую руку');
    const runResult = await runPromise;
    return {
      sendResult,
      leakedChat: window.__NovaApp.getConversation().some((turn) => String(turn.content || '').includes('Подними левую руку')),
      leftArm: window.__novaEmbodiment.getPose().leftArm,
      names: runResult.actions.map((action) => action.name),
      vias: runResult.results.map((result) => ({ action: result.action, via: result.via, ok: result.ok })),
      avatar: { x: window.__novaScene.avatar.position.x, z: window.__novaScene.avatar.position.z },
      log: document.getElementById('cinematic-director-log')?.textContent || '',
      ui: {
        director: Boolean(document.getElementById('cinematic-director')),
        record: Boolean(document.getElementById('vr180-record-button')),
        preset: Boolean(document.getElementById('vr180-preset')),
      },
    };
  });

  const travel = Math.hypot(parallel.avatar.x - initial.avatar.x, parallel.avatar.z - initial.avatar.z);
  assert.ok(travel > 0.2, `cinematic scenario did not move avatar enough: ${travel}`);
  assert.equal(parallel.sendResult, false, 'chat ran in parallel with the cinematic scene');
  assert.equal(parallel.leakedChat, false, 'chat prompt was recorded during the cinematic scene');
  assert.ok(parallel.names.includes('approach_user'), `approach_user missing from chain: ${parallel.names.join(',')}`);
  assert.ok(parallel.names.includes('wave'), `wave missing from chain: ${parallel.names.join(',')}`);
  assert.ok(parallel.vias.some((item) => item.via === 'app'), `shared actions did not use app dispatcher: ${JSON.stringify(parallel.vias)}`);
  assert.ok(parallel.vias.some((item) => item.via === 'director' && item.action === 'approach_user'), `approach_user was replaced by a duplicate executor: ${JSON.stringify(parallel.vias)}`);
  assert.ok(parallel.vias.some((item) => item.action === 'wave' && item.via === 'app'), `wave did not go through the chat dispatcher: ${JSON.stringify(parallel.vias)}`);
  assert.equal(parallel.ui.director, true, 'cinematic director UI missing');
  assert.equal(parallel.ui.record, true, 'VR180 record button missing');
  assert.equal(parallel.ui.preset, true, 'VR180 preset selector missing');
  assert.match(parallel.log, /Scene complete/i, `scene did not complete: ${parallel.log}`);
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);

  console.log('CINEMATIC_VR180_BROWSER_PASS');
  console.log(base);
  await context.close();
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
