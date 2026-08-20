import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.cwd());
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
let authOpened = false;
let exchangeBody = null;
let staleGetCount = 0;
let freshGetCount = 0;
let generativePostCount = 0;

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
  });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/oauth-auth') {
      authOpened = true;
      const params = Object.fromEntries(url.searchParams.entries());
      assert.equal(params.code_challenge_method, 'S256');
      assert.ok(params.code_challenge?.length > 30, 'PKCE challenge missing');
      const callback = new URL(params.callback_url);
      callback.searchParams.set('code', 'reconnect-code');
      res.writeHead(302, { location: callback.toString(), 'cache-control': 'no-store' });
      return res.end();
    }
    if (url.pathname === '/oauth-exchange') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      exchangeBody = JSON.parse(raw || '{}');
      assert.equal(exchangeBody.code, 'reconnect-code');
      assert.equal(exchangeBody.code_challenge_method, 'S256');
      assert.ok(String(exchangeBody.code_verifier || '').length > 40, 'PKCE verifier missing');
      return sendJson(res, 200, { key: 'sk-or-v1-fresh' });
    }
    if (url.pathname === '/nova-openrouter') {
      const key = String(req.headers['x-openrouter-key'] || '');
      if (req.method === 'GET') {
        if (key === 'sk-or-v1-stale') {
          staleGetCount += 1;
          return sendJson(res, 200, {
            ok: true,
            provider: 'supabase-command-engine',
            generative: false,
            keySource: 'user',
            keyStatus: 'invalid_key',
            contract: 'embodied-openrouter-diagnostic-v2',
          });
        }
        if (key === 'sk-or-v1-fresh') {
          freshGetCount += 1;
          return sendJson(res, 200, {
            ok: true,
            provider: 'openai/gpt-oss-120b:free',
            generative: true,
            keySource: 'user',
            keyStatus: 'valid',
            limitRemaining: 49,
            contract: 'embodied-openrouter-diagnostic-v2',
          });
        }
        return sendJson(res, 200, {
          ok: true,
          provider: 'supabase-command-engine',
          generative: false,
          keySource: null,
          keyStatus: 'missing_key',
          contract: 'embodied-openrouter-diagnostic-v2',
        });
      }
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        JSON.parse(raw || '{}');
        if (key === 'sk-or-v1-fresh') {
          generativePostCount += 1;
          return sendJson(res, 200, {
            ok: true,
            source: 'openrouter',
            provider: 'openai/gpt-oss-120b:free',
            generative: true,
            text: 'Свободная языковая модель снова работает.',
            intent: 'conversation',
            actions: [],
            extendedActions: [],
          });
        }
        return sendJson(res, 200, {
          ok: true,
          source: 'command-engine',
          generative: false,
          text: 'Command engine only.',
          intent: 'local_agent_help',
          actions: [],
          extendedActions: [],
          fastFallback: true,
          fallbackReason: key ? 'invalid_key' : 'missing_key',
          requiresReauth: true,
        });
      }
    }

    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
    const file = resolve(root, safe);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    res.writeHead(500);
    res.end(String(error?.stack || error));
  }
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  await context.addInitScript(({ base }) => {
    window.__NOVA_AI_ENDPOINT = `${base}/nova-openrouter`;
    window.__NOVA_OPENROUTER_PROXY = `${base}/nova-openrouter`;
    window.__NOVA_OPENROUTER_AUTH_URL = `${base}/oauth-auth`;
    window.__NOVA_OPENROUTER_EXCHANGE_URL = `${base}/oauth-exchange`;
    localStorage.setItem('nova_openrouter_key_v1', 'sk-or-v1-stale');
    class MockUtterance {
      constructor(text) { this.text = text; this.lang = ''; this.onend = null; this.onerror = null; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, speak(u) { setTimeout(() => u.onend?.(), 5); } },
    });
  }, { base });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__NovaApp && window.__NovaOpenRouterAuth && window.__novaScene, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__NovaOpenRouterAuth.getState().keyStatus === 'invalid_key', null, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('mode-pill')?.textContent === 'Agent mode', null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('nova_openrouter_key_v1')), null, 'stale key should be removed');
  assert.ok(staleGetCount >= 1, 'stale key was not validated');
  assert.match(await page.locator('#connection-pill').innerText(), /expired|Core ready|OpenRouter/i);
  assert.match(await page.locator('#live-button').innerText(), /Connect OpenRouter|Reconnect OpenRouter/i);

  await page.click('#live-button');
  await page.waitForURL((u) => u.origin === base && !u.searchParams.has('code'), { timeout: 15000 });
  await page.waitForFunction(() => window.__NovaOpenRouterAuth?.getState().generative === true, null, { timeout: 12000 });
  await page.waitForFunction(() => document.getElementById('mode-pill')?.textContent === 'AI mode', null, { timeout: 12000 });
  await page.waitForFunction(() => document.getElementById('connection-pill')?.textContent === 'AI ready', null, { timeout: 12000 });

  assert.ok(authOpened, 'OAuth authorization route was not opened');
  assert.ok(exchangeBody, 'OAuth code was not exchanged');
  assert.ok(freshGetCount >= 1, 'fresh key was not validated');
  assert.equal(await page.evaluate(() => window.__NovaOpenRouterAuth.getKeyForTesting()), 'sk-or-v1-fresh');
  assert.equal(await page.locator('#live-button').innerText(), 'AI connected');

  const before = await page.locator('#messages .message').count();
  await page.fill('#text-input', 'Расскажи свободно, кто ты');
  await page.click('#send-button');
  await page.waitForFunction((count) => document.querySelectorAll('#messages .message').length >= count + 2, before, { timeout: 12000 });
  assert.match(await page.locator('#messages .message.assistant').last().innerText(), /Свободная языковая модель снова работает/i);
  assert.equal(generativePostCount, 1, 'free-form request should hit generative proxy exactly once');
  assert.equal(pageErrors.length, 0, `browser errors: ${pageErrors.join(' | ')}`);

  console.log('OPENROUTER_AUTH_RECONNECT_SMOKE_PASS');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
