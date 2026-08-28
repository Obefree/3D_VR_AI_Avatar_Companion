import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PUBLIC_REF = process.env.PUBLIC_REF || process.env.GITHUB_SHA || 'feature/live-site-actor-polish';
const PUBLIC_URL = `https://cdn.githubraw.com/Obefree/3D_VR_AI_Avatar_Companion/${PUBLIC_REF}/index.html`;

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

  const response = await page.goto(PUBLIC_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response && response.ok(), `public URL failed: ${response?.status()}`);
  await page.waitForFunction(() => window.__novaScene && window.__novaEmbodimentReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });
  await page.waitForFunction(() => window.__novaCinematicDirectorReady === true && window.__novaVR180 && window.__novaPresentation && window.__novaActorPolish?.getState?.().ready, null, { timeout: 20000 });

  const initial = await page.evaluate(() => ({
    avatar: { x: window.__novaScene.avatar.position.x, y: window.__novaScene.avatar.position.y, z: window.__novaScene.avatar.position.z },
    yaw: window.__novaScene.avatar.rotation.y,
    targets: [...window.__novaScene.targets.keys()],
    humanoid: window.__novaHumanoid.getState(),
    actorPolish: window.__novaActorPolish.getState(),
    presets: window.__novaVR180.presets,
    baselines: window.__novaVR180.baselines,
    deviceVisible: window.__novaScene.device?.visible,
  }));

  assert.ok(initial.targets.includes('actor_window'), 'cinematic window target missing at runtime');
  assert.ok(initial.targets.includes('actor_table'), 'cinematic table target missing at runtime');
  assert.ok(initial.targets.includes('actor_glass'), 'cinematic glass target missing at runtime');
  assert.equal(initial.humanoid.ready, true, 'humanoid not ready');
  assert.equal(initial.humanoid.modelVisible, true, 'humanoid model not visible');
  assert.equal(initial.actorPolish.ready, true, 'actor polish runtime not ready');
  assert.equal(initial.deviceVisible, false, 'legacy service device should be hidden in cinematic mode');
  assert.equal(initial.presets.draft.width, 4096);
  assert.equal(initial.presets.draft.height, 2048);
  assert.equal(initial.presets.quest.width, 5760);
  assert.equal(initial.presets.quest.height, 2880);
  assert.equal(initial.presets.quest.fps, 48);
  assert.equal(initial.baselines.canon.meters, 0.060);
  assert.equal(initial.baselines.natural.meters, 0.064);

  await page.evaluate(() => {
    const avatar = window.__novaScene.avatar.position;
    window.__novaActorPolish.aimAt({ x: avatar.x + 1, y: avatar.y, z: avatar.z }, 1400);
  });
  await page.waitForTimeout(650);
  const polishedYaw = await page.evaluate(() => window.__novaScene.avatar.rotation.y);
  assert.ok(Math.abs(polishedYaw - initial.yaw) > 0.08, `actor polish did not rotate Nova toward a target: ${initial.yaw} -> ${polishedYaw}`);

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
  }));
  assert.equal(present.enabled, true, 'presentation API did not enable');
  assert.equal(present.classOnRoot, true, 'presentation CSS class missing');
  await page.evaluate(() => window.__novaPresentation.disable());

  const finalState = await page.evaluate(() => ({
    avatar: { x: window.__novaScene.avatar.position.x, y: window.__novaScene.avatar.position.y, z: window.__novaScene.avatar.position.z },
    pose: window.__novaEmbodiment.getPose(),
    actorPolish: window.__novaActorPolish.getState(),
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
  assert.equal(finalState.actorPolish.ready, true, 'actor polish stopped during scenario');
  assert.ok(finalState.actorPolish.lastAction, 'actor polish did not observe cinematic actions');
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
  console.log(PUBLIC_URL);
  await context.close();
} finally {
  await browser?.close();
}
