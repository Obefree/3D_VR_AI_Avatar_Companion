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
      if (req.method === 'GET') return json(res, 200, { ok: true, provider: 'chain-mock' });
      if (req.method === 'POST') {
        return json(res, 200, {
          ok: true,
          text: 'Acting.',
          intent: 'act',
          actions: [{ name: 'look_at', args: { targetId: 'device' } }],
          extendedActions: [{ name: 'wave', args: { side: 'left' } }],
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

const embodimentSource = await readFile(resolve(root, 'src/embodiment.js'), 'utf8');
const indexSource = await readFile(resolve(root, 'index.html'), 'utf8');
const scenarioSource = await readFile(resolve(root, 'src/scenario-core.js'), 'utf8');
const binocularSource = await readFile(resolve(root, 'src/binocular-vr.js'), 'utf8');

assert.equal(embodimentSource.includes('window.fetch ='), false, 'embodiment fetch interceptor is back');
assert.equal(indexSource.includes('__NOVA_PRIMARY_FETCH'), false, 'PRIMARY_FETCH paper-over is back');
assert.equal(binocularSource.includes('requestSession'), false, 'binocular VR still opens a parallel XR session');
assert.match(scenarioSource, /подойд/);
assert.match(scenarioSource, /collapseConsecutive/);
assert.match(scenarioSource, /__NovaApp\?\.executeAction/);
await assert.rejects(access(resolve(root, 'tests/e2e.mjs')), /ENOENT/, 'unused e2e.mjs duplicate remains');
await assert.rejects(access(resolve(root, 'src/actor-director.js')), /ENOENT/);

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  await context.addInitScript(() => {
    class MockUtterance {
      constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.pitch = 1; this.onend = null; this.onerror = null; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, speak(u) { setTimeout(() => u.onend?.(), 20); } },
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__novaScene && window.__novaEmbodimentReady === true && window.__NovaApp, null, { timeout: 25000 });
  await page.waitForFunction(() => window.__novaCharacterProfile && window.__novaScenarioCore && window.__NovaBinocularVR, null, { timeout: 10000 });

  const dispatchers = await page.evaluate(() => ({
    appExecute: typeof window.__NovaApp?.executeAction,
    scenarioExecute: typeof window.__novaScenarioCore?.run,
    embodimentExecute: typeof window.__novaEmbodiment?.execute,
    fetchLooksLikeInterceptor: String(window.fetch).includes('extendedActions'),
  }));
  assert.equal(dispatchers.appExecute, 'function', 'app executeAction not exported');
  assert.equal(dispatchers.embodimentExecute, 'function');
  assert.equal(dispatchers.fetchLooksLikeInterceptor, false, 'window.fetch still looks like an action interceptor');

  const approach = await page.evaluate(async () => window.__novaScenarioCore.compile('Подойди ближе.', { ai: false }));
  assert.ok(approach.actions.some((action) => action.name === 'approach_user'), `подойди did not compile to approach_user: ${JSON.stringify(approach.actions)}`);
  assert.equal(approach.actions.filter((action) => action.name === 'approach_user').length, 1, 'duplicate approach_user planned');

  const closer = await page.evaluate(async () => window.__novaScenarioCore.compile('Come closer and wave.', { ai: false }));
  assert.ok(closer.actions.some((action) => action.name === 'approach_user'), 'come closer did not approach the viewer');
  assert.ok(closer.actions.some((action) => action.name === 'wave'), 'wave missing from come closer chain');

  const pronoun = await page.evaluate(async () => window.__novaScenarioCore.compile('Смотрит на устройство. Затем указывает на него.', { ai: false }));
  assert.ok(pronoun.actions.some((action) => action.name === 'look_at' && action.args?.targetId === 'device'), 'device look_at missing');
  assert.ok(pronoun.actions.some((action) => action.name === 'point_at' && action.args?.targetId === 'device'), 'pronoun did not keep device target');

  const greeting = 'Девушка замечает зрителя и смотрит на него. Она подходит ближе, машет рукой и говорит: «Привет. Я здесь». Затем делает паузу.';
  const plan = await page.evaluate(async (value) => window.__novaScenarioCore.compile(value, { ai: false }), greeting);
  const names = plan.actions.map((action) => action.name);
  assert.ok(names.includes('face_user'), `face_user missing: ${names.join(',')}`);
  assert.ok(names.includes('approach_user'), `approach_user missing: ${names.join(',')}`);
  assert.ok(names.includes('wave'), `wave missing: ${names.join(',')}`);
  assert.ok(names.includes('speak'), `speak missing: ${names.join(',')}`);
  assert.ok(names.includes('wait'), `wait missing: ${names.join(',')}`);
  for (let i = 1; i < names.length; i += 1) {
    assert.notEqual(`${names[i - 1]}:${JSON.stringify(plan.actions[i - 1].args)}`, `${names[i]}:${JSON.stringify(plan.actions[i].args)}`, `consecutive duplicate action ${names[i]}`);
  }
  const speak = plan.actions.find((action) => action.name === 'speak');
  assert.match(String(speak?.args?.text || ''), /Привет/);

  const before = await page.evaluate(() => ({ x: window.__novaScene.avatar.position.x, z: window.__novaScene.avatar.position.z }));
  const result = await page.evaluate(async (value) => window.__novaScenarioCore.run(value, { ai: false }), greeting);
  const after = await page.evaluate(() => ({
    x: window.__novaScene.avatar.position.x,
    z: window.__novaScene.avatar.position.z,
    lastTool: document.getElementById('last-tool')?.textContent || '',
    status: document.getElementById('nova-scenario-status')?.textContent || '',
  }));
  assert.equal(result.ok, true, 'greeting chain failed');
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 0.1, 'actor did not approach viewer');
  assert.match(after.status, /Scenario complete/);
  assert.notEqual(after.lastTool, '—', 'scenario bypassed app executeAction (last-tool unchanged)');

  await page.evaluate(() => { window.__novaEmbodimentExecutions = 0; });
  await page.evaluate(() => {
    const original = window.__novaEmbodiment.execute;
    window.__novaEmbodiment.execute = async (action) => {
      window.__novaEmbodimentExecutions = (window.__novaEmbodimentExecutions || 0) + 1;
      return original(action);
    };
  });
  const waved = await page.evaluate(async () => {
    const beforeCount = window.__novaEmbodimentExecutions;
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'wave' }),
    });
    await window.__NovaApp.executeAction({ name: 'wave', args: { side: 'left' } });
    return window.__novaEmbodimentExecutions - beforeCount;
  });
  assert.equal(waved, 1, `wave executed ${waved} times — parallel dispatcher suspected`);

  const mutex = await page.evaluate(async () => {
    const long = 'Она ждёт. Затем молчит. Затем делает паузу.';
    const first = window.__novaScenarioCore.run(long, { ai: false });
    await new Promise((resolve) => setTimeout(resolve, 40));
    let secondError = '';
    try { await window.__novaScenarioCore.run(long, { ai: false }); }
    catch (error) { secondError = String(error?.message || error); }
    const chat = await window.__NovaApp.send('Помаши рукой');
    const firstResult = await first;
    return { secondError, chat, firstOk: firstResult?.ok === true, busyAfter: window.__NovaApp.isBusy() };
  });
  assert.match(mutex.secondError, /already running/i, `parallel scenario was allowed: ${mutex.secondError}`);
  assert.equal(mutex.chat, false, 'chat ran in parallel with the scenario');
  assert.equal(mutex.firstOk, true, 'mutex scenario did not complete');
  assert.equal(mutex.busyAfter, false);

  await page.click('#nova-binocular-launch');
  await page.waitForSelector('.nova-binocular-overlay');
  const stereo = await page.evaluate(() => window.__NovaBinocularVR.getState());
  assert.equal(stereo.active, true);
  await page.evaluate(() => window.__NovaBinocularVR.stop());
  assert.equal(await page.locator('.nova-binocular-overlay').count(), 0);

  assert.equal(pageErrors.length, 0, `browser errors: ${pageErrors.join(' | ')}`);
  console.log('SCENARIO_CHAIN_SMOKE_PASS');
  await context.close();
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
