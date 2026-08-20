import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.cwd());
let healthCount = 0;
let postCount = 0;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/chat') {
      if (req.method === 'GET') {
        healthCount += 1;
        if (healthCount === 1) return sendJson(res, 503, { ok: false, error: 'transient health failure' });
        return sendJson(res, 200, { ok: true, provider: 'reconnect-mock', contract: 'embodied-editable-world-v3' });
      }
      if (req.method === 'POST') {
        postCount += 1;
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw || '{}');
        if (postCount === 1) return sendJson(res, 503, { ok: false, error: 'transient turn failure' });
        if (String(body.message).toLowerCase().includes('куб')) {
          return sendJson(res, 200, {
            ok: true,
            text: 'Создаю синий куб.',
            intent: 'create_object',
            actions: [],
            extendedActions: [{ name: 'create_object', args: { id: 'retry_cube', label: 'Retry cube', shape: 'box', color: 'blue', size: { scalar: 0.4 }, direction: 'front', distance: 1 } }],
          });
        }
        return sendJson(res, 200, {
          ok: true,
          text: 'Поднимаю левую руку.',
          intent: 'raise_hand',
          actions: [],
          extendedActions: [{ name: 'raise_hand', args: { side: 'left' } }],
        });
      }
      return sendJson(res, 405, { ok: false });
    }

    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
    const file = resolve(root, safe);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  await context.addInitScript(() => {
    class MockUtterance {
      constructor(text) { this.text = text; this.lang = ''; this.onend = null; this.onerror = null; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, speak(u) { setTimeout(() => u.onend?.(), 5); } },
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__NovaApp && window.__novaScene, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__novaEmbodimentReady === true, null, { timeout: 20000 });
  await page.waitForFunction(() => document.getElementById('transport-state')?.textContent === 'AI ready', null, { timeout: 12000 });
  assert.ok(healthCount >= 2, 'initial health retry did not happen');
  assert.equal(await page.textContent('#mode-pill'), 'AI mode');

  const before = await page.locator('#messages .message').count();
  await page.fill('#text-input', 'Подними левую руку');
  await page.click('#send-button');
  await page.waitForFunction(() => window.__novaEmbodiment?.getPose().leftArm === 'raised', null, { timeout: 15000 });
  await page.waitForFunction((count) => document.querySelectorAll('#messages .message').length >= count + 2, before, { timeout: 15000 });
  assert.ok(postCount >= 2, 'AI POST retry did not happen');
  assert.equal(await page.textContent('#mode-pill'), 'AI mode');
  assert.equal(await page.textContent('#transport-state'), 'AI ready');

  const dynamicBefore = await page.evaluate(() => window.__novaEmbodiment.getDynamicIds().length);
  await page.fill('#text-input', 'Создай синий куб');
  await page.click('#send-button');
  await page.waitForFunction((n) => window.__novaEmbodiment.getDynamicIds().length === n + 1, dynamicBefore, { timeout: 15000 });

  const transcript = await page.locator('#messages').innerText();
  assert.doesNotMatch(transcript, /локальный резервный режим|local fallback/i, 'transient failure leaked into permanent fallback');
  const unexpectedErrors = errors.filter((message) => !/503|Service Unavailable/i.test(message));
  assert.equal(unexpectedErrors.length, 0, `unexpected browser errors: ${unexpectedErrors.join(' | ')}`);

  console.log('RECONNECT_SMOKE_PASS');
  console.log(JSON.stringify({ healthCount, postCount, aiState: await page.evaluate(() => window.__NovaApp.getAIState()) }));
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
