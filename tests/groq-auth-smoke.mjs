import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.cwd());
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8' };
let validGets = 0;
let invalidGets = 0;
let generativePosts = 0;

function sendJson(res, body) {
  res.writeHead(200, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'access-control-allow-origin':'*', 'access-control-allow-headers':'*' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/nova-groq') {
      const key = String(req.headers['x-groq-key'] || '');
      if (req.method === 'GET') {
        if (key === 'gsk-stale') {
          invalidGets += 1;
          return sendJson(res, { ok:true, provider:'supabase-command-engine', generative:false, keyStatus:'invalid_key', contract:'embodied-groq-v1' });
        }
        if (key === 'gsk-test') {
          validGets += 1;
          return sendJson(res, { ok:true, provider:'qwen/qwen3.6-27b', generative:true, keyStatus:'valid', contract:'embodied-groq-v1' });
        }
        return sendJson(res, { ok:true, provider:'supabase-command-engine', generative:false, keyStatus:'missing_key', contract:'embodied-groq-v1' });
      }
      if (req.method === 'POST') {
        let raw=''; for await (const chunk of req) raw += chunk;
        JSON.parse(raw || '{}');
        if (key === 'gsk-test') {
          generativePosts += 1;
          return sendJson(res, { ok:true, source:'groq', provider:'qwen/qwen3.6-27b', generative:true, aiAvailable:true, text:'Groq отвечает свободно и быстро.', intent:'conversation', actions:[], extendedActions:[] });
        }
        return sendJson(res, { ok:true, source:'command-engine', generative:false, aiAvailable:false, text:'Groq не подключён. Нажми Connect Groq — команды сцены уже работают.', intent:'local_agent_help', actions:[], extendedActions:[], fastFallback:true, fallbackReason:key ? 'invalid_key' : 'missing_key' });
      }
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//,'');
    const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/,'');
    const file = resolve(root, safe);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (error) { res.writeHead(500); res.end(String(error?.stack || error)); }
});

await new Promise(done => server.listen(0,'127.0.0.1',done));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
let browser;
try {
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,locale:'ru-RU'});
  await context.addInitScript(({base}) => {
    window.__NOVA_AI_ENDPOINT = `${base}/nova-groq`;
    window.__NOVA_GROQ_PROXY = `${base}/nova-groq`;
    window.prompt = () => 'gsk-test';
    class MockUtterance { constructor(text){this.text=text;this.lang='';this.onend=null;this.onerror=null;} }
    Object.defineProperty(window,'SpeechSynthesisUtterance',{value:MockUtterance,configurable:true});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel(){},speak(u){setTimeout(()=>u.onend?.(),5);}}});
  },{base});
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__NovaApp && window.__NovaGroqAuth && window.__novaScene,null,{timeout:20000});
  await page.waitForFunction(()=>window.__NovaGroqAuth.getState().backendOk === true,null,{timeout:10000});
  await page.waitForFunction(()=>window.__NovaGroqAuth.getState().keyStatus === 'missing_key',null,{timeout:10000});
  assert.equal(await page.locator('#mode-pill').innerText(),'Agent mode');
  assert.match(await page.locator('#live-button').innerText(),/Connect Groq/i);

  await page.click('#live-button');
  await page.waitForFunction(()=>window.__NovaGroqAuth.getState().generative === true,null,{timeout:10000});
  await page.waitForFunction(()=>document.getElementById('mode-pill')?.textContent === 'AI mode',null,{timeout:10000});
  assert.ok(validGets >= 1,'Groq key was not validated');
  assert.equal(await page.evaluate(()=>window.__NovaGroqAuth.getKeyForTesting()),'gsk-test');
  assert.equal(await page.locator('#live-button').innerText(),'Groq connected');

  const before = await page.locator('#messages .message').count();
  await page.fill('#text-input','Расскажи свободно, кто ты');
  await page.click('#send-button');
  await page.waitForFunction(count=>document.querySelectorAll('#messages .message').length >= count + 2,before,{timeout:12000});
  assert.match(await page.locator('#messages .message.assistant').last().innerText(),/Groq отвечает свободно и быстро/i);
  assert.equal(generativePosts,1,'free-form request should hit Groq exactly once');
  assert.equal(errors.length,0,`browser errors: ${errors.join(' | ')}`);
  await context.close();

  const staleContext = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,locale:'ru-RU'});
  await staleContext.addInitScript(({base}) => {
    window.__NOVA_AI_ENDPOINT = `${base}/nova-groq`;
    window.__NOVA_GROQ_PROXY = `${base}/nova-groq`;
    localStorage.setItem('nova_groq_key_v1','gsk-stale');
    class MockUtterance { constructor(text){this.text=text;this.lang='';this.onend=null;this.onerror=null;} }
    Object.defineProperty(window,'SpeechSynthesisUtterance',{value:MockUtterance,configurable:true});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel(){},speak(u){setTimeout(()=>u.onend?.(),5);}}});
  },{base});
  const stalePage = await staleContext.newPage();
  await stalePage.goto(base,{waitUntil:'domcontentloaded'});
  await stalePage.waitForFunction(()=>window.__NovaGroqAuth?.getState().keyStatus === 'invalid_key',null,{timeout:10000});
  assert.ok(invalidGets >= 1,'stale Groq key was not validated');
  assert.equal(await stalePage.evaluate(()=>localStorage.getItem('nova_groq_key_v1')),null,'invalid Groq key was not cleared');
  assert.equal(await stalePage.locator('#mode-pill').innerText(),'Agent mode');
  assert.match(await stalePage.locator('#live-button').innerText(),/Connect Groq/i);
  await staleContext.close();

  console.log('GROQ_AUTH_SMOKE_PASS');
} finally {
  await browser?.close();
  await new Promise(done=>server.close(done));
}
