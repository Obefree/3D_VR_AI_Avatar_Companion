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
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/chat') {
      if (req.method === 'GET') return json(res, 200, { ok: true, provider: 'cinematic-mock', contract: 'semantic-actions-v1' });
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        return json(res, 200, { ok: true, text: 'Cinematic mock ready.', intent: 'ack', actions: [], extendedActions: [] });
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
const base = `http://127.0.0.1:${server.address().port}`;

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

  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__novaScene && window.__novaEmbodimentReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });
  await page.waitForFunction(() => window.__novaCinematicDirectorReady === true && window.__novaVR180, null, { timeout: 20000 });

  const initial = await page.evaluate(() => ({
    dispatcher: typeof window.__NovaApp?.executeAction,
    fetchWrappedByEmbodiment: /novaLastExtendedResults/.test(String(window.fetch)),
    avatar: { x: window.__novaScene.avatar.position.x, y: window.__novaScene.avatar.position.y, z: window.__novaScene.avatar.position.z },
    targets: [...window.__novaScene.targets.keys()],
    humanoid: window.__novaHumanoid.getState(),
    presets: window.__novaVR180.presets,
    collapsed: document.getElementById('cinematic-director')?.classList.contains('collapsed'),
  }));

  assert.equal(initial.dispatcher, 'function', 'shared action dispatcher is missing');
  assert.equal(initial.fetchWrappedByEmbodiment, false, 'embodiment still wraps fetch beside app.js');
  assert.equal(initial.collapsed, false, 'desktop director panel should start expanded');
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

  await page.evaluate(() => {
    window.__novaCinematicActionLog = [];
    window.addEventListener('nova:cinematic-action', (event) => {
      window.__novaCinematicActionLog.push(event.detail?.name);
    });
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
    chain: window.__novaCinematicActionLog || [],
    ui: {
      director: Boolean(document.getElementById('cinematic-director')),
      record: Boolean(document.getElementById('vr180-record-button')),
      preset: Boolean(document.getElementById('vr180-preset')),
    },
  }));

  const travel = Math.hypot(finalState.avatar.x - initial.avatar.x, finalState.avatar.z - initial.avatar.z);
  assert.ok(travel > 0.2, `cinematic scenario did not move avatar enough: ${travel}`);
  assert.ok(finalState.chain.includes('approach_user'), `approach_user missing from chain: ${finalState.chain.join(',')}`);
  assert.ok(finalState.chain.includes('wave'), `wave missing from chain: ${finalState.chain.join(',')}`);
  assert.ok(finalState.chain.includes('speak'), `speak missing from chain: ${finalState.chain.join(',')}`);
  assert.equal(finalState.chain.includes('move_near'), false, 'approach_user ran in parallel with move_near');
  assert.equal(finalState.ui.director, true, 'cinematic director UI missing');
  assert.equal(finalState.ui.record, true, 'VR180 record button missing');
  assert.equal(finalState.ui.preset, true, 'VR180 preset selector missing');
  assert.match(finalState.log, /Scene complete/i, `scene did not complete: ${finalState.log}`);
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await mobilePage.waitForFunction(() => window.__novaCinematicDirectorReady === true, null, { timeout: 20000 });
  const mobileOverlay = await mobilePage.evaluate(() => {
    const panel = document.getElementById('cinematic-director');
    const hit = document.elementFromPoint(160, 500);
    return {
      collapsed: panel?.classList.contains('collapsed') === true,
      hitId: hit?.id || '',
    };
  });
  assert.equal(mobileOverlay.collapsed, true, 'mobile director overlay did not collapse');
  assert.equal(mobileOverlay.hitId, 'scene', `mobile orbit point covered by ${mobileOverlay.hitId || 'unknown'}`);
  await mobile.close();

  console.log('CINEMATIC_VR180_BROWSER_PASS');
  await context.close();
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
