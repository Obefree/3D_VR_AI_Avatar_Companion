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

const actor = await readFile(resolve(root, 'src/actor-director.js'), 'utf8');
const sceneSource = await readFile(resolve(root, 'src/scene.js'), 'utf8');
const embodiment = await readFile(resolve(root, 'src/embodiment.js'), 'utf8');
const index = await readFile(resolve(root, 'index.html'), 'utf8');

assert.match(actor, /async function compileWithAI\(/, 'AI director compiler is missing');
assert.match(actor, /async function runScript\(/, 'actor script runner is missing');
assert.match(actor, /new THREE\.StereoCamera\(\)/, 'stereo camera preview is missing');
assert.match(actor, /stereo\.eyeSep = 0\.064/, 'stereo baseline must be 64 mm');
assert.match(actor, /approach_user/, 'viewer-relative actor movement is missing');
assert.match(actor, /actor_glass/, 'cinematic prop target is missing');
assert.match(actor, /installFemaleActorSkin/, 'female actor skin is missing');
assert.match(actor, /tweenBodyBaseY/, 'sit/stand must drive bodyBaseY, not fight the idle bob');
assert.match(sceneSource, /this\.bodyBaseY/, 'scene idle bob must use an overridable bodyBaseY');
assert.match(sceneSource, /this\.faceRig/, 'visible actor face must receive speech animation');
assert.equal(embodiment.includes('window.fetch ='), false, 'embodiment still wraps fetch and would execute extendedActions in parallel with app.js');
assert.equal(index.includes('__NOVA_PRIMARY_FETCH'), false, 'PRIMARY_FETCH restore is leftover from the parallel fetch interceptor');
assert.match(index, /src\/actor-director\.js/, 'actor director module is not loaded by index.html');
await assert.rejects(access(resolve(root, 'tests/e2e.mjs')), /ENOENT/, 'superseded tests/e2e.mjs duplicate is still present');

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/chat') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      if (req.method === 'GET') return res.end(JSON.stringify({ ok: true, provider: 'actor-chain-mock' }));
      return res.end(JSON.stringify({ ok: false, error: 'force_fallback' }));
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
const base = `http://127.0.0.1:${port}`;
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'ru-RU',
  });
  await context.addInitScript(() => {
    class MockUtterance {
      constructor(text) {
        this.text = text;
        this.lang = '';
        this.rate = 1;
        this.pitch = 1;
        this.onend = null;
        this.onerror = null;
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, speak(utterance) { setTimeout(() => utterance.onend?.(), 20); } },
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__novaScene && window.__novaActorDirector?.ready && window.__novaEmbodimentReady,
    null,
    { timeout: 20000 },
  );

  const compiled = await page.evaluate(async () => {
    const script = document.getElementById('actor-script').value;
    const plan = window.__novaActorDirector.fallbackPlan(script);
    const names = plan.map((item) => item.name);
    return {
      names,
      faceUserCount: names.filter((name) => name === 'face_user').length,
      hasWindow: plan.some((item) => item.name === 'look_at' && item.args?.targetId === 'actor_window'),
      hasApproach: names.includes('approach_user'),
      hasPick: names.includes('pick_up'),
      hasWave: names.includes('wave'),
      hasSpeak: names.includes('speak'),
      skin: window.__novaScene.avatar.userData.actorStyle,
      faceRig: Boolean(window.__novaScene.faceRig?.mouth),
      targets: [...window.__novaScene.targets.keys()],
    };
  });

  assert.equal(compiled.skin, 'cinematic_female_mvp');
  assert.equal(compiled.faceRig, true, 'actor faceRig was not installed for visible speech animation');
  assert.equal(compiled.faceUserCount, 1, 'fallback plan still emits duplicate face_user from overlapping regexes');
  assert.equal(compiled.hasWindow, true);
  assert.equal(compiled.hasApproach, true);
  assert.equal(compiled.hasPick, true);
  assert.equal(compiled.hasWave, true);
  assert.equal(compiled.hasSpeak, true);
  assert.ok(compiled.targets.includes('actor_glass'));
  assert.ok(compiled.targets.includes('actor_chair'));

  await page.evaluate(async () => {
    await window.__novaActorDirector.runScript('Садится.', { preferAI: false });
  });
  await page.waitForTimeout(450);
  const seated = await page.evaluate(() => ({
    seated: window.__novaActorDirector.seated,
    base: window.__novaScene.bodyBaseY,
    y: window.__novaScene.body.position.y,
  }));
  assert.equal(seated.seated, true);
  assert.ok(seated.base < 0.7, `sit was overwritten by idle bob: bodyBaseY=${seated.base}`);
  assert.ok(seated.y < 0.75, `visible body height did not stay seated: y=${seated.y}`);

  await page.evaluate(async () => {
    await window.__novaActorDirector.runScript('Встает.', { preferAI: false });
  });
  await page.waitForTimeout(200);
  const standing = await page.evaluate(() => ({
    seated: window.__novaActorDirector.seated,
    base: window.__novaScene.bodyBaseY,
    y: window.__novaScene.body.position.y,
  }));
  assert.equal(standing.seated, false);
  assert.ok(standing.base > 0.8, `stand did not restore bodyBaseY: ${standing.base}`);
  assert.ok(standing.y > 0.8, `visible body height did not stand: y=${standing.y}`);

  const beforeApproach = await page.evaluate(() => window.__novaScene.avatar.position.distanceTo(window.__novaScene.getViewerWorldPosition()));
  await page.evaluate(async () => {
    await window.__novaActorDirector.runScript('Подойди ближе.', { preferAI: false });
  });
  const afterApproach = await page.evaluate(() => window.__novaScene.avatar.position.distanceTo(window.__novaScene.getViewerWorldPosition()));
  assert.ok(afterApproach < beforeApproach - 0.2, `approach_user did not move toward the viewer: ${beforeApproach} -> ${afterApproach}`);

  await page.evaluate(async () => {
    await window.__novaActorDirector.runScript('Берет стакан.', { preferAI: false });
  });
  const held = await page.evaluate(() => {
    const scene = window.__novaScene;
    const glass = scene.targets.get('actor_glass').mesh;
    return {
      parentIsHand: glass.parent === scene.rightArm.hand,
      targetId: glass.userData.targetId,
    };
  });
  assert.equal(held.parentIsHand, true, 'pick_up did not attach the glass to the right hand');
  assert.equal(held.targetId, 'actor_glass');

  await page.evaluate(() => window.__novaActorDirector.startStereoPreview());
  const stereo = await page.evaluate(() => ({
    overlay: Boolean(document.querySelector('.stereo-vr-overlay')),
    canvases: document.querySelectorAll('.stereo-vr-overlay canvas').length,
  }));
  assert.equal(stereo.overlay, true, 'two-eye stereo overlay did not open');
  assert.equal(stereo.canvases, 1);
  await page.evaluate(() => window.__novaActorDirector.stopStereoPreview());

  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);
  console.log('actor-director chain: sit/stand vs idle-bob, approach, pick_up, stereo, fallback dedupe');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
