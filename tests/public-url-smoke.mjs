import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PUBLIC_URL = 'https://raw.githack.com/Obefree/3D_VR_AI_Avatar_Companion/f0d86bb8daad1935e30fab9cecc26d33d7798d3b/index.html';

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
  await page.waitForFunction(() => window.__NovaApp && window.__novaScene, null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('transport-state')?.textContent === 'AI ready', null, { timeout: 20000 });

  await page.click('#live-button');
  await page.waitForFunction(() => document.getElementById('live-button')?.textContent === 'AI connected', null, { timeout: 10000 });

  async function send(text, predicate) {
    const before = await page.locator('#messages .message').count();
    await page.fill('#text-input', text);
    await page.click('#send-button');
    await page.waitForFunction(
      (count) => document.querySelectorAll('#messages .message').length >= count + 2,
      before,
      { timeout: 30000 },
    );
    if (predicate) await page.waitForFunction(predicate, null, { timeout: 15000 });
  }

  await send('Покажи красную кнопку', () => window.__novaScene.lookTarget === 'red_button');
  let state = await page.evaluate(() => window.__novaScene.getSceneContext());
  assert.equal(state.deviceState.resetPressed, false);

  await send('Нажми её', () => window.__novaScene.deviceState.resetPressed === true);
  state = await page.evaluate(() => window.__novaScene.getSceneContext());
  assert.equal(state.task.step, 'filter_required');

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
