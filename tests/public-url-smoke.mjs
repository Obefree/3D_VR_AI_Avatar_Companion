import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PUBLIC_REF = process.env.PUBLIC_REF || process.env.GITHUB_SHA || 'main';
const PUBLIC_URL = `https://cdn.githubraw.com/Obefree/3D_VR_AI_Avatar_Companion/${PUBLIC_REF}/index.html`;

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'ru-RU',
  });

  await context.addInitScript(() => {
    class MockUtterance {
      constructor(text) {
        this.text = text;
        this.lang = '';
        this.onend = null;
        this.onerror = null;
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, speak(u) { setTimeout(() => u.onend?.(), 10); } },
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  const response = await page.goto(PUBLIC_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response, 'public URL returned no response');
  assert.ok(response.status() >= 200 && response.status() < 400, `public URL HTTP ${response.status()}`);
  await page.waitForFunction(() => window.__NovaApp && window.__novaScene && window.__NovaOpenRouterAuth, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__novaEmbodimentReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__NovaOpenRouterAuth.getState().backendOk === true, null, { timeout: 20000 });
  await page.waitForFunction(() => document.getElementById('mode-pill')?.textContent === 'Agent mode', null, { timeout: 20000 });
  await page.waitForFunction(() => document.getElementById('transport-state')?.textContent === 'Command engine', null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => window.__NovaOpenRouterAuth.getState().generative), false, 'public unauthenticated build unexpectedly reports generative AI');

  async function send(text, predicate, timeout = 35000) {
    const before = await page.locator('#messages .message').count();
    await page.fill('#text-input', text);
    await page.click('#send-button');
    await page.waitForFunction(
      (count) => document.querySelectorAll('#messages .message').length >= count + 2,
      before,
      { timeout },
    );
    if (predicate) await page.waitForFunction(predicate, null, { timeout: 18000 });
  }

  let state = await page.evaluate(() => window.__novaScene.getSceneContext());
  assert.ok(state.avatar?.bodyParts?.leftHand, 'public build has no body awareness');
  assert.ok(state.space?.size?.width >= 8, 'public build has no room bounds');
  assert.ok(state.editableWorld?.dynamicObjectIds?.length >= 5, 'starter scene objects missing');

  await send('Подними левую руку', () => window.__novaEmbodiment?.getPose().leftArm === 'raised');

  const beforeCreate = await page.evaluate(() => window.__novaEmbodiment.getDynamicIds().length);
  await send('Создай синий куб полметра перед собой', () => window.__novaEmbodiment?.getDynamicIds().length > 5);
  const createdId = await page.evaluate(() => window.__novaScene.getSceneContext().editableWorld.lastCreatedId);
  assert.ok(createdId, 'public create_object produced no object id');
  assert.equal(await page.evaluate(() => window.__novaEmbodiment.getDynamicIds().length), beforeCreate + 1);

  await send('Удали этот куб');
  await page.waitForFunction((id) => !window.__novaScene.targets.has(id), createdId, { timeout: 18000 });

  await send('Покажи красную кнопку', () => window.__novaScene.lookTarget === 'red_button');
  state = await page.evaluate(() => window.__novaScene.getSceneContext());
  assert.equal(state.deviceState.resetPressed, false);

  await send('Нажми её', () => window.__novaScene.deviceState.resetPressed === true);
  await send('Что дальше?', () => window.__novaScene.lookTarget === 'filter');
  await send('Вытащи фильтр', () => window.__novaScene.deviceState.filterRemoved === true);
  state = await page.evaluate(() => window.__novaScene.getSceneContext());
  assert.equal(state.task.step, 'complete');

  const transcript = await page.locator('#messages').innerText();
  assert.doesNotMatch(transcript, /demo fallback|локальный резервный/i);
  assert.equal(errors.length, 0, `public browser errors: ${errors.join(' | ')}`);

  console.log('PUBLIC_URL_SMOKE_PASS');
  console.log(PUBLIC_URL);
} finally {
  await browser?.close();
}
