import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PUBLIC_REF = process.env.PUBLIC_REF || process.env.GITHUB_SHA || 'feature/unified-scenario-character-vr';
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

  const response = await page.goto(PUBLIC_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response && response.ok(), `public URL failed: ${response?.status()}`);
  await page.waitForFunction(() => window.__novaScene && window.__novaEmbodimentReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });
  await page.waitForFunction(() => window.__novaCharacterProfile && window.__novaScenarioCore && window.__NovaBinocularVR, null, { timeout: 10000 });

  const initial = await page.evaluate(() => ({
    humanoid: window.__novaHumanoid.getState(),
    profile: window.__novaCharacterProfile.get(),
    scenarioActions: window.__novaScenarioCore.actions(),
    binocular: window.__NovaBinocularVR.getState(),
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

  await page.click('#nova-scenario-launch');
  await page.waitForSelector('#nova-scenario-modal.open');
  const script = 'Девушка замечает зрителя и смотрит на него. Она подходит ближе, машет рукой и говорит: «Привет. Я здесь». Затем делает паузу.';
  await page.fill('#nova-scenario-script', script);

  const plan = await page.evaluate(async (value) => window.__novaScenarioCore.compile(value, { ai: false }), script);
  assert.ok(plan.beats.length >= 2, `too few beats: ${plan.beats.length}`);
  assert.ok(plan.actions.some((action) => action.name === 'face_user'), 'face_user not planned');
  assert.ok(plan.actions.some((action) => action.name === 'approach_user'), 'approach_user not planned');
  assert.ok(plan.actions.some((action) => action.name === 'wave'), 'wave not planned');
  assert.ok(plan.actions.some((action) => action.name === 'speak' && /Привет/.test(action.args?.text || '')), 'dialogue not preserved');

  const before = await page.evaluate(() => ({ x: window.__novaScene.avatar.position.x, z: window.__novaScene.avatar.position.z }));
  const result = await page.evaluate(async (value) => window.__novaScenarioCore.run(value, { ai: false }), script);
  const after = await page.evaluate(() => ({
    x: window.__novaScene.avatar.position.x,
    z: window.__novaScene.avatar.position.z,
    humanoid: window.__novaHumanoid.getState(),
    status: document.getElementById('nova-scenario-status')?.textContent || '',
  }));
  assert.equal(result.ok, true, 'scenario execution failed');
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
  console.log(PUBLIC_URL);
  await context.close();
} finally {
  await browser?.close();
}
