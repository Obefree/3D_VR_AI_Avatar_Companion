import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.cwd());
const AI_ENDPOINT = 'https://ugjjifmlivdufshkhmpa.supabase.co/functions/v1/nova-chat';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const health = await fetch(AI_ENDPOINT, { headers: { accept: 'application/json' } });
assert.equal(health.status, 200, `real AI health failed: ${health.status}`);
const healthJson = await health.json();
assert.equal(healthJson.ok, true, 'real AI backend reported not ready');
assert.match(String(healthJson.contract || ''), /semantic-actions/i);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
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
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'ru-RU',
  });

  await context.addInitScript(({ endpoint }) => {
    window.__NOVA_AI_ENDPOINT = endpoint;
    class MockUtterance {
      constructor(text) {
        this.text = text;
        this.lang = '';
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.onend = null;
        this.onerror = null;
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        speak(utterance) { setTimeout(() => utterance.onend?.(), 10); },
      },
    });
  }, { endpoint: AI_ENDPOINT });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__novaScene && window.__NovaApp, null, { timeout: 25000 });
  await page.waitForFunction(
    () => document.getElementById('transport-state')?.textContent === 'AI ready',
    null,
    { timeout: 20000 },
  );

  await page.click('#live-button');
  await page.waitForFunction(
    () => document.getElementById('live-button')?.textContent === 'AI connected',
    null,
    { timeout: 10000 },
  );
  assert.equal(await page.textContent('#mode-pill'), 'AI mode');
  assert.equal(await page.textContent('#connection-pill'), 'Connected');

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
    const assistant = await page.locator('#messages .message.assistant').last().innerText();
    assert.ok(assistant.trim().length > 0, `Nova returned an empty response for: ${text}`);
    return assistant;
  }

  await send('Покажи красную кнопку', () => window.__novaScene.lookTarget === 'red_button');
  let state = await page.evaluate(() => window.__novaScene.getSceneContext());
  assert.equal(state.deviceState.resetPressed, false, 'show command accidentally pressed reset');

  await send('Нажми её', () => window.__novaScene.deviceState.resetPressed === true);
  state = await page.evaluate(() => window.__novaScene.getSceneContext());
  assert.equal(state.task.step, 'filter_required');

  await send('Что дальше?', () => window.__novaScene.lookTarget === 'filter');
  state = await page.evaluate(() => window.__novaScene.getSceneContext());
  assert.equal(state.task.step, 'filter_required');

  await send('Вытащи фильтр', () => window.__novaScene.deviceState.filterRemoved === true);
  state = await page.evaluate(() => window.__novaScene.getSceneContext());
  assert.equal(state.task.step, 'complete');
  assert.equal(state.deviceState.filterRemoved, true);

  const transcript = await page.locator('#messages').innerText();
  assert.doesNotMatch(transcript, /demo fallback|локальный резервный/i, 'real smoke silently fell back to demo mode');
  assert.equal(pageErrors.length, 0, `browser errors: ${pageErrors.join(' | ')}`);

  console.log('REAL_BACKEND_SMOKE_PASS');
  console.log(JSON.stringify({
    backend: healthJson.provider,
    upstream: healthJson.upstream,
    model: healthJson.model,
    finalTaskStep: state.task.step,
  }));
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
