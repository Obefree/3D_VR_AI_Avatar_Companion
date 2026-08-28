import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, readFile } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.cwd());
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const script = 'Девушка замечает зрителя и смотрит на него. Она подходит ближе, машет рукой и говорит: «Привет. Я здесь». Затем делает паузу.';

const embodimentSource = await readFile(resolve(root, 'src/embodiment.js'), 'utf8');
const indexSource = await readFile(resolve(root, 'index.html'), 'utf8');
const scenarioSource = await readFile(resolve(root, 'src/scenario-core.js'), 'utf8');
assert.equal(embodimentSource.includes('window.fetch ='), false, 'embodiment fetch interceptor would run actions in parallel with app.js');
assert.equal(indexSource.includes('__NOVA_PRIMARY_FETCH'), false, 'PRIMARY_FETCH paper-over should not be needed');
assert.equal(scenarioSource.includes('[...ALL_ACTIONS]'), true, 'AI scenario vocabulary omitted core actions');
assert.equal(indexSource.includes('tap-interaction.js'), false, 'legacy tap bridge is still loaded');
await assert.rejects(access(resolve(root, 'tests/e2e.mjs')), /ENOENT/, 'unused e2e.mjs duplicate is back');

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
    if (url.pathname === '/api/chat' || url.pathname === '/api/chat.js') {
      if (req.method === 'GET') {
        return json(res, 200, { ok: true, provider: 'scenario-mock', generative: false });
      }
      if (req.method === 'POST') {
        return json(res, 200, { ok: true, text: 'Local scenario mock', actions: [], extendedActions: [] });
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
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, speak(u) { setTimeout(() => u.onend?.(), 35); } },
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });

  const response = await page.goto(localUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response && response.ok(), `local URL failed: ${response?.status()}`);
  await page.waitForFunction(() => window.__novaScene && window.__novaEmbodimentReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });
  await page.waitForFunction(() => window.__novaCharacterProfile && window.__novaScenarioCore && window.__NovaBinocularVR, null, { timeout: 10000 });

  const initial = await page.evaluate(() => ({
    humanoid: window.__novaHumanoid.getState(),
    profile: window.__novaCharacterProfile.get(),
    scenarioActions: window.__novaScenarioCore.actions(),
    binocular: window.__NovaBinocularVR.getState(),
    fetchHijacked: Boolean(window.__novaLastExtendedResults),
  }));

  assert.equal(initial.humanoid.ready, true);
  assert.equal(initial.humanoid.modelVisible, true);
  assert.equal(initial.humanoid.robotFallbackVisible, false);
  assert.equal(initial.profile.name, 'Nova');
  assert.ok(initial.profile.goals.length >= 3, 'character goals missing');
  assert.ok(initial.profile.behavior.length >= 3, 'character behavior rules missing');
  assert.ok(initial.scenarioActions.includes('speak'), 'scenario speech action missing');
  assert.ok(initial.scenarioActions.includes('approach_user'), 'viewer-relative approach action missing');
  assert.equal(initial.binocular.eyeSeparation, 0.064);
  assert.equal(initial.fetchHijacked, false, 'embodiment still recorded parallel fetch-executed actions');

  await page.click('#nova-scenario-launch');
  await page.waitForSelector('#nova-scenario-modal.open');
  await page.fill('#nova-scenario-script', script);

  const chains = await page.evaluate(async (value) => {
    const names = (plan) => plan.actions.map((action) => action.name);
    const main = await window.__novaScenarioCore.compile(value, { ai: false });
    const closer = await window.__novaScenarioCore.compile('Подойди ближе.', { ai: false });
    const device = await window.__novaScenarioCore.compile('Она подходит к устройству.', { ai: false });
    return {
      main: names(main),
      closer: names(closer),
      device: names(device),
      dialogue: main.actions.some((action) => action.name === 'speak' && /Привет/.test(action.args?.text || '') && /здесь/.test(action.args?.text || '')),
      dualMovers: main.actions.some((action) => action.name === 'approach_user')
        && main.actions.some((action) => action.name === 'move_near'),
    };
  }, script);

  assert.ok(chains.main.includes('face_user'), 'face_user not planned');
  assert.ok(chains.main.includes('approach_user'), 'approach_user not planned');
  assert.ok(chains.main.includes('wave'), 'wave not planned');
  assert.equal(chains.dialogue, true, 'dialogue not preserved');
  assert.equal(chains.dualMovers, false, 'approach_user and move_near planned together');
  assert.ok(chains.closer.includes('approach_user'), 'imperative подойди ближе did not plan approach_user');
  assert.ok(chains.device.includes('move_near'), 'device approach did not plan move_near');
  assert.equal(chains.device.includes('approach_user'), false, 'device approach incorrectly walked to the camera');

  const before = await page.evaluate(() => ({ x: window.__novaScene.avatar.position.x, z: window.__novaScene.avatar.position.z }));
  const result = await page.evaluate(async (value) => window.__novaScenarioCore.run(value, { ai: false }), script);
  const after = await page.evaluate(() => ({
    x: window.__novaScene.avatar.position.x,
    z: window.__novaScene.avatar.position.z,
    humanoid: window.__novaHumanoid.getState(),
    status: document.getElementById('nova-scenario-status')?.textContent || '',
  }));
  assert.equal(result.ok, true, 'scenario execution failed');
  assert.ok(result.results.some((item) => item.action.name === 'approach_user' && item.result?.ok), 'approach_user did not execute');
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 0.1, 'actor did not approach viewer');
  assert.equal(after.humanoid.ready, true, 'humanoid was lost during scenario');
  assert.match(after.status, /Scenario complete/);

  await page.evaluate(() => window.__novaCharacterProfile.update({ character: { warmth: 0.81 }, movement: { personalDistanceMeters: 1.5 } }));
  const editedProfile = await page.evaluate(() => window.__novaCharacterProfile.get());
  assert.equal(editedProfile.character.warmth, 0.81);
  assert.equal(editedProfile.movement.personalDistanceMeters, 1.5);

  await page.click('#nova-scenario-close');
  await page.click('#nova-binocular-launch');
  await page.waitForSelector('.nova-binocular-overlay');
  const stereo = await page.evaluate(() => ({
    state: window.__NovaBinocularVR.getState(),
    labels: [...document.querySelectorAll('.nova-binocular-labels span')].map((el) => el.textContent),
    canvasWidth: document.querySelector('.nova-binocular-overlay canvas')?.width || 0,
  }));
  assert.equal(stereo.state.active, true);
  assert.deepEqual(stereo.labels, ['LEFT EYE', 'RIGHT EYE']);
  assert.ok(stereo.canvasWidth > 0, 'stereo canvas not rendering');

  await page.evaluate(() => window.__NovaBinocularVR.stop());
  assert.equal(await page.locator('.nova-binocular-overlay').count(), 0, 'binocular overlay did not close');

  assert.equal(pageErrors.length, 0, `browser errors: ${pageErrors.join(' | ')}`);
  console.log('SCENARIO_CHARACTER_VR_SMOKE_PASS');
  console.log(localUrl);
  await context.close();
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
