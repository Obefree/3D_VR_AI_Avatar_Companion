import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, normalize, resolve } from 'node:path';
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

const embodimentSrc = await readFile(resolve(root, 'src/embodiment.js'), 'utf8');
const indexSrc = await readFile(resolve(root, 'index.html'), 'utf8');
const scenarioSrc = await readFile(resolve(root, 'src/scenario-core.js'), 'utf8');
const appSrc = await readFile(resolve(root, 'src/app.js'), 'utf8');
const binocularSrc = await readFile(resolve(root, 'src/binocular-vr.js'), 'utf8');
assert.equal(embodimentSrc.includes('window.fetch = async'), false, 'embodiment fetch interceptor is back and would replay actions in parallel with app.js');
assert.equal(indexSrc.includes('__NOVA_PRIMARY_FETCH'), false, 'PRIMARY_FETCH paper-over is still present');
assert.match(scenarioSrc, /EXCLUSIVE_ACTIONS/, 'scenario merge no longer de-duplicates parallel AI/local actions');
assert.match(scenarioSrc, /__NovaApp\?\.executeAction/, 'scenario still bypasses the central app dispatcher');
assert.match(appSrc, /executeAction,/, 'app.js does not export executeAction');
assert.equal(binocularSrc.includes('requestSession'), false, 'binocular VR still opens a second WebXR session');
await assert.rejects(access(resolve(root, 'tests/e2e.mjs')), /ENOENT/, 'unused near-duplicate tests/e2e.mjs is back');

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/chat') {
      if (req.method === 'GET') {
        return json(res, 200, { ok: true, provider: 'scenario-smoke', contract: 'semantic-actions-v1' });
      }
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        void raw;
        return json(res, 200, {
          ok: true,
          text: 'Понял.',
          intent: 'acknowledge',
          actions: [],
          extendedActions: [],
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
  await page.route(/favicon\.ico|apple-touch-icon/i, (route) => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Failed to load resource/.test(text) && /404/.test(text)) return;
    pageErrors.push(text);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    if (/favicon\.ico|apple-touch-icon/i.test(url)) return;
    pageErrors.push(`${response.status()} ${url}`);
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__novaScene && window.__novaEmbodimentReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });
  await page.waitForFunction(() => window.__novaCharacterProfile && window.__novaScenarioCore && window.__novaCharacterAnalyzer && window.__NovaBinocularVR, null, { timeout: 10000 });

  const initial = await page.evaluate(() => ({
    humanoid: window.__novaHumanoid.getState(),
    profile: window.__novaCharacterProfile.get(),
    scenarioActions: window.__novaScenarioCore.actions(),
    binocular: window.__NovaBinocularVR.getState(),
    fetchInterceptsEmbodiment: String(window.fetch).includes('executeExtended') && String(window.fetch).includes('extendedActions'),
    lastExtended: window.__novaLastExtendedResults,
    hasCentralExecute: typeof window.__NovaApp?.executeAction === 'function',
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
  assert.equal(initial.fetchInterceptsEmbodiment, false, 'window.fetch still executes embodiment actions in parallel');
  assert.equal(initial.lastExtended, undefined, 'dead embodiment fetch side channel is still populated');
  assert.equal(initial.hasCentralExecute, true, 'central executeAction is missing');

  await page.click('#nova-scenario-launch');
  await page.waitForSelector('#nova-scenario-modal.open');
  await page.waitForSelector('#nova-analyze-character');
  const script = 'Девушка приветливо замечает зрителя и смотрит на него. Она сама подходит ближе, машет рукой и говорит: «Привет. Я здесь». Затем делает паузу.';
  await page.fill('#nova-scenario-script', script);

  const analysis = await page.evaluate((value) => window.__novaCharacterAnalyzer.localAnalyze(value), script);
  assert.match(analysis.relationship, /viewer/, 'viewer relationship not extracted');
  assert.ok(analysis.traits.warmth > 0.6, `warmth not inferred: ${analysis.traits.warmth}`);
  assert.ok(analysis.movement.vocabulary.some((item) => item.name === 'approach'), 'approach movement not extracted');
  assert.ok(analysis.movement.vocabulary.some((item) => item.name === 'wave'), 'wave movement not extracted');
  assert.ok(analysis.dialogueExamples.some((line) => /Привет/.test(line)), 'dialogue example not extracted');

  await page.evaluate((value) => {
    const analysisResult = window.__novaCharacterAnalyzer.localAnalyze(value);
    window.__novaCharacterAnalyzer.apply(analysisResult);
  }, script);
  const analyzedProfile = await page.evaluate(() => window.__novaCharacterProfile.get());
  assert.equal(analyzedProfile.analysis?.relationship, 'direct scene partner: viewer');
  assert.ok(analyzedProfile.analysis?.movementVocabulary?.some((item) => item.name === 'wave'), 'analysis metadata missing movement vocabulary');

  await page.click('#nova-analyze-character-local');
  await page.waitForSelector('#nova-character-analysis.visible');
  const analysisText = await page.locator('#nova-character-analysis pre').textContent();
  assert.match(analysisText || '', /Model native clips:/, 'native animation capability list missing');
  assert.match(analysisText || '', /Wave/, 'native Wave clip missing from analysis UI');

  const plan = await page.evaluate(async (value) => window.__novaScenarioCore.compile(value, { ai: false }), script);
  assert.ok(plan.beats.length >= 2, `too few beats: ${plan.beats.length}`);
  assert.ok(plan.analysis?.traits?.warmth > 0.6, 'compile did not extract character before planning');
  assert.ok(plan.actions.some((action) => action.name === 'face_user'), 'face_user not planned');
  assert.ok(plan.actions.some((action) => action.name === 'approach_user'), 'approach_user not planned');
  assert.ok(plan.actions.some((action) => action.name === 'wave'), 'wave not planned');
  assert.ok(plan.actions.some((action) => action.name === 'speak' && /Привет\. Я здесь/.test(action.args?.text || '')), 'multi-sentence dialogue not preserved');
  for (const name of ['wave', 'approach_user', 'wait']) {
    const count = plan.actions.filter((action) => action.name === name).length;
    assert.ok(count <= 1, `duplicate ${name} in local plan: ${count}`);
  }

  const merged = await page.evaluate(async (value) => window.__novaScenarioCore.compile(value, {
    ai: false,
    analyze: false,
    aiActions: [
      { name: 'wave', args: { side: 'right' } },
      { name: 'approach_user', args: { distance: 2.8 } },
      { name: 'speak', args: { text: 'Параллельный дубль' } },
      { name: 'highlight', args: { targetId: 'device' } },
    ],
  }), script);
  assert.equal(merged.actions.filter((action) => action.name === 'wave').length, 1, 'AI wave ran in parallel with local wave');
  assert.equal(merged.actions.filter((action) => action.name === 'approach_user').length, 1, 'AI approach ran in parallel with local approach');
  assert.equal(merged.actions.some((action) => action.args?.text === 'Параллельный дубль'), false, 'AI speak duplicated local dialogue');
  assert.ok(merged.actions.some((action) => action.name === 'highlight' && action.args?.targetId === 'device'), 'non-conflicting AI action was dropped');

  const imperative = await page.evaluate(async () => window.__novaScenarioCore.compile('Подойди ближе к зрителю и скажи: «Я здесь».', { ai: false }));
  assert.ok(imperative.actions.some((action) => action.name === 'approach_user'), 'imperative подойди/ближе did not plan approach_user');

  const beforeProfile = await page.evaluate(() => window.__novaCharacterProfile.get().character.warmth);
  const before = await page.evaluate(() => ({ x: window.__novaScene.avatar.position.x, z: window.__novaScene.avatar.position.z }));
  const result = await page.evaluate(async (value) => window.__novaScenarioCore.run(value, { ai: false }), script);
  const after = await page.evaluate(() => ({
    x: window.__novaScene.avatar.position.x,
    z: window.__novaScene.avatar.position.z,
    humanoid: window.__novaHumanoid.getState(),
    status: document.getElementById('nova-scenario-status')?.textContent || '',
    analysisVisible: document.getElementById('nova-character-analysis')?.classList.contains('visible'),
    persistedWarmth: window.__novaCharacterProfile.get().character.warmth,
  }));
  assert.equal(result.ok, true, 'scenario execution failed');
  assert.ok(result.plan?.analysis?.source, 'run() skipped character extraction before performance');
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 0.1, 'actor did not approach viewer');
  assert.equal(after.humanoid.ready, true, 'humanoid was lost during scenario');
  assert.match(after.status, /Scenario complete/);
  assert.equal(after.analysisVisible, true, 'character analysis was not shown during performance');
  assert.equal(after.persistedWarmth, beforeProfile, 'run() overwrote the saved character profile');

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
  console.log(`http://127.0.0.1:${port}/`);
  await context.close();
} finally {
  await browser?.close();
  server.close();
}
