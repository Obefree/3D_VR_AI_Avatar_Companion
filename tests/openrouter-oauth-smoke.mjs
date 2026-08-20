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
let lastAuth = null;
let exchangeBody = null;
const proxyPosts = [];

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/oauth-auth') {
      lastAuth = Object.fromEntries(url.searchParams.entries());
      assert.equal(lastAuth.code_challenge_method, 'S256');
      assert.ok(lastAuth.code_challenge?.length > 30, 'PKCE challenge missing');
      const callback = new URL(lastAuth.callback_url);
      callback.searchParams.set('code', 'oauth-test-code');
      res.writeHead(302, { location: callback.toString(), 'cache-control': 'no-store' });
      return res.end();
    }
    if (url.pathname === '/oauth-exchange') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      exchangeBody = JSON.parse(raw || '{}');
      assert.equal(exchangeBody.code, 'oauth-test-code');
      assert.equal(exchangeBody.code_challenge_method, 'S256');
      assert.ok(String(exchangeBody.code_verifier || '').length > 40, 'PKCE verifier missing');
      return sendJson(res, 200, { key: 'sk-or-v1-test-key' });
    }
    if (url.pathname === '/nova-openrouter') {
      const key = req.headers['x-openrouter-key'] || '';
      if (req.method === 'GET') {
        return sendJson(res, 200, {
          ok: true,
          provider: key === 'sk-or-v1-test-key' ? 'openrouter/free' : 'supabase-command-engine',
          generative: key === 'sk-or-v1-test-key',
          oauthAvailable: true,
          contract: 'embodied-openrouter-v1',
        });
      }
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        proxyPosts.push({ key, body: JSON.parse(raw || '{}') });
        if (key === 'sk-or-v1-test-key') {
          return sendJson(res, 200, {
            ok: true,
            source: 'openrouter',
            provider: 'openrouter/free',
            generative: true,
            text: 'Свободный AI ответ работает.',
            intent: 'conversation',
            actions: [],
            extendedActions: [],
          });
        }
        return sendJson(res, 200, {
          ok: true,
          source: 'command-engine',
          generative: false,
          text: 'Command engine ready.',
          intent: 'local_agent_help',
          actions: [],
          extendedActions: [],
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
  await page.waitForFunction(() => window.__NovaOpenRouterAuth.getState().backendOk === true, null, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('mode-pill')?.textContent === 'Agent mode', null, { timeout: 10000 });

  await page.click('#live-button');
  await page.waitForURL((url) => url.origin === base && !url.searchParams.has('code'), { timeout: 15000 });
  await page.waitForFunction(() => window.__NovaOpenRouterAuth?.getState().generative === true, null, { timeout: 12000 });
  await page.waitForFunction(() => document.getElementById('mode-pill')?.textContent === 'AI mode', null, { timeout: 12000 });

  assert.ok(lastAuth, 'OAuth authorization route was never opened');
  assert.ok(exchangeBody, 'OAuth code was never exchanged');
  assert.equal(await page.evaluate(() => window.__NovaOpenRouterAuth.getKeyForTesting()), 'sk-or-v1-test-key');

  const before = await page.locator('#messages .message').count();
  await page.fill('#text-input', 'Расскажи что-нибудь свободно');
  await page.click('#send-button');
  await page.waitForFunction((count) => document.querySelectorAll('#messages .message').length >= count + 2, before, { timeout: 12000 });
  assert.match(await page.locator('#messages .message.assistant').last().innerText(), /Свободный AI ответ работает/i);
  assert.ok(proxyPosts.some((row) => row.key === 'sk-or-v1-test-key'), 'OpenRouter key was not forwarded to the proxy');
  assert.equal(pageErrors.length, 0, `browser errors: ${pageErrors.join(' | ')}`);

  console.log('OPENROUTER_OAUTH_SMOKE_PASS');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
