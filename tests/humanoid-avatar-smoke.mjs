import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PUBLIC_REF = process.env.PUBLIC_REF || process.env.GITHUB_SHA || 'main';
const PUBLIC_URL = `https://cdn.githubraw.com/Obefree/3D_VR_AI_Avatar_Companion/${PUBLIC_REF}/index.html`;

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  await context.addInitScript(() => {
    class MockUtterance { constructor(text){ this.text=text; this.lang=''; this.onend=null; this.onerror=null; } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel(){}, speak(u){ setTimeout(() => u.onend?.(), 40); } } });
  });

  const page = await context.newPage();
  const errors = [];
  let modelResponse = null;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.url().includes('Animated%20Woman-nIItLV9nxS.glb') || response.url().includes('Animated Woman-nIItLV9nxS.glb')) {
      modelResponse = { status: response.status(), url: response.url() };
    }
  });

  const response = await page.goto(PUBLIC_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response && response.ok(), `public URL failed: ${response?.status()}`);
  await page.waitForFunction(() => window.__novaScene && window.__novaEmbodimentReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaHumanoidReady === true, null, { timeout: 35000 });

  const humanoid = await page.evaluate(() => window.__novaHumanoid.getState());
  console.log('HUMANOID_STATE', JSON.stringify(humanoid));
  console.log('MODEL_RESPONSE', JSON.stringify(modelResponse));

  assert.equal(humanoid.ready, true, 'humanoid runtime not ready');
  assert.equal(humanoid.modelVisible, true, 'humanoid model is not visible');
  assert.equal(humanoid.robotFallbackVisible, false, 'procedural robot is still visible after humanoid load');
  assert.ok(humanoid.modelHeight > 1.5 && humanoid.modelHeight < 1.85, `unexpected humanoid height ${humanoid.modelHeight}`);
  assert.ok(humanoid.animationNames.length > 0, 'GLB contains no animation clips');
  assert.ok(humanoid.boneNames.length >= 8, `too few skeleton bones: ${humanoid.boneNames.length}`);
  assert.ok(humanoid.rig.head || humanoid.rig.neck, `head/neck bone unresolved: ${JSON.stringify(humanoid.rig)}`);
  assert.ok(humanoid.rig.leftUpperArm, `left upper arm unresolved: ${JSON.stringify(humanoid.rig)}`);
  assert.ok(humanoid.rig.rightUpperArm, `right upper arm unresolved: ${JSON.stringify(humanoid.rig)}`);
  assert.ok(humanoid.bodyParts.leftHand, 'left hand world position unavailable');
  assert.ok(humanoid.bodyParts.rightHand, 'right hand world position unavailable');

  const contextState = await page.evaluate(() => window.__novaScene.getSceneContext());
  assert.equal(contextState.avatar?.form, 'anthropomorphic humanoid woman');
  assert.equal(contextState.avatar?.modelReady, true);

  async function send(text, predicate, timeout = 25000) {
    const before = await page.locator('#messages .message').count();
    await page.fill('#text-input', text);
    await page.click('#send-button');
    await page.waitForFunction((count) => document.querySelectorAll('#messages .message').length >= count + 2, before, { timeout });
    if (predicate) await page.waitForFunction(predicate, null, { timeout });
  }

  const beforeHand = humanoid.bodyParts.leftHand;
  await send('Подними левую руку', () => window.__novaEmbodiment?.getPose().leftArm === 'raised');
  await page.waitForTimeout(450);
  const afterRaise = await page.evaluate(() => window.__novaHumanoid.getState());
  const handTravel = Math.hypot(
    afterRaise.bodyParts.leftHand.x - beforeHand.x,
    afterRaise.bodyParts.leftHand.y - beforeHand.y,
    afterRaise.bodyParts.leftHand.z - beforeHand.z,
  );
  assert.ok(handTravel > 0.1, `real humanoid left hand did not move enough: ${handTravel}`);

  const beforeStep = await page.evaluate(() => ({ ...window.__novaScene.avatar.position }));
  await send('Шагни вправо на полметра', () => window.__novaEmbodiment?.getPose().motion === 'idle');
  await page.waitForTimeout(120);
  const afterStep = await page.evaluate(() => ({ ...window.__novaScene.avatar.position }));
  const stepTravel = Math.hypot(afterStep.x - beforeStep.x, afterStep.z - beforeStep.z);
  assert.ok(stepTravel > 0.25, `avatar root did not move with humanoid: ${stepTravel}`);

  const finalState = await page.evaluate(() => window.__novaHumanoid.getState());
  assert.equal(finalState.ready, true);
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);

  console.log('HUMANOID_AVATAR_SMOKE_PASS');
  console.log(PUBLIC_URL);
  await context.close();
} finally {
  await browser?.close();
}
