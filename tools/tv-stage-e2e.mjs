import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4173/?v=e2e';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__novaTvStageReady === true, null, { timeout: 90000 });

const ui = await page.evaluate(() => ({
  buttons: [...document.querySelectorAll('#stage-panel button')].map((b) => b.id),
  hasRun: Boolean(document.getElementById('stage-run')),
  hasStubCopy: /не нашёл реплику|proof only|Жёсткий прогон/i.test(document.body.innerText),
}));
console.log('UI', ui);
if (ui.hasRun) throw new Error('stub button #stage-run is visible');
if (ui.hasStubCopy) throw new Error('stub copy on page');

await page.click('#stage-session');
await page.waitForTimeout(400);
const recOn = await page.evaluate(() => ({
  sessionBtn: document.getElementById('stage-session')?.textContent,
  badge: Boolean(document.getElementById('stage-rec-badge')),
}));
console.log('REC_START', recOn);
if (!recOn.badge) throw new Error('record badge missing — record stub?');

await page.click('#stage-walk');
await page.waitForTimeout(300);
const walk = await page.evaluate(() => window.__novaScene?.walkMode);
console.log('WALK', walk);
if (!walk) throw new Error('VR walk did not enable');
await page.keyboard.press('KeyT');
await page.waitForTimeout(400);
const glasses = await page.evaluate(() => {
  const canvas = document.getElementById('nova-vr180-stage');
  return {
    on: Boolean(window.__novaScene?.stereoGlasses),
    vr180: Boolean(window.__novaScene?.vr180View),
    css: document.documentElement.classList.contains('vr-glasses'),
    stage: Boolean(canvas),
    size: canvas ? [canvas.width, canvas.height] : null,
  };
});
console.log('GLASSES', glasses);
if (!glasses.on || !glasses.vr180 || !glasses.css || !glasses.stage) {
  throw new Error('Canon VR180 glasses view did not enable');
}
if (!glasses.size || glasses.size[0] !== glasses.size[1] * 2) {
  throw new Error(`VR180 frame must be 2:1 SBS, got ${glasses.size}`);
}
await page.keyboard.press('KeyT');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.evaluate(() => {
  if (window.__novaScene?.walkMode) window.__novaScene.setWalkMode(false);
});
await page.fill('#stage-hero', 'Привет, ты меня видишь?');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__novaTvStage?.running === false, null, { timeout: 90000 });
const afterTalk = await page.evaluate(() => document.getElementById('stage-log')?.textContent || '');
console.log('AFTER_TALK', afterTalk);
if (/не нашёл реплику|proof only|Я тебя слышу/i.test(afterTalk)) {
  throw new Error(`stub line in log: ${afterTalk}`);
}

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
  page.evaluate(() => window.__novaTvStage?.toggleSession?.()),
]);
console.log('REC_STOP', download ? await download.suggestedFilename() : null);

await browser.close();
console.log('E2E_OK');
