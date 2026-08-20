import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.cwd());
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8' };
let postCount = 0;

function sendJson(res, body) {
  res.writeHead(200, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'access-control-allow-origin':'*', 'access-control-allow-headers':'*' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/nova-groq') {
      const key = String(req.headers['x-groq-key'] || '');
      if (req.method === 'GET') return sendJson(res, { ok:true, provider:key ? 'qwen/qwen3.6-27b' : 'supabase-command-engine', generative:Boolean(key), keyStatus:key ? 'valid' : 'missing_key', contract:'embodied-groq-v1' });
      if (req.method === 'POST') {
        postCount += 1;
        let raw=''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw || '{}');
        assert.match(String(body.message || ''), /подними.*шаг.*создай/i);
        assert.equal(key,'gsk-compound-test','Groq key missing from compound request');
        return sendJson(res, {
          ok:true,
          source:'groq',
          provider:'qwen/qwen3.6-27b',
          generative:true,
          aiAvailable:true,
          text:'Выполняю три действия.',
          intent:'tool_action',
          actions:[],
          extendedActions:[
            { name:'raise_hand', args:{ side:'left' } },
            { name:'step', args:{ direction:'right', distance:0.5 } },
            { name:'create_object', args:{ id:'compound_red_ball', label:'Red ball', shape:'sphere', color:'red', size:{scalar:0.4}, direction:'front', distance:1.0 } }
          ]
        });
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
    localStorage.setItem('nova_groq_key_v1','gsk-compound-test');
    class MockUtterance { constructor(text){this.text=text;this.lang='';this.onend=null;this.onerror=null;} }
    Object.defineProperty(window,'SpeechSynthesisUtterance',{value:MockUtterance,configurable:true});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel(){},speak(u){setTimeout(()=>u.onend?.(),5);}}});
  },{base});
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__NovaApp && window.__NovaGroqAuth?.getState().generative === true && window.__novaEmbodimentReady === true,null,{timeout:20000});

  const beforePos = await page.evaluate(()=>window.__novaScene.avatar.position.x);
  const beforeCount = await page.evaluate(()=>window.__novaEmbodiment.getDynamicIds().length);
  await page.fill('#text-input','Подними левую руку, потом шагни вправо на полметра и создай красный шар перед собой');
  await page.click('#send-button');
  await page.waitForFunction(()=>window.__novaEmbodiment.getPose().leftArm === 'raised',null,{timeout:10000});
  await page.waitForFunction((count)=>window.__novaEmbodiment.getDynamicIds().length === count + 1,beforeCount,{timeout:12000});
  const result = await page.evaluate(()=>({pose:window.__novaEmbodiment.getPose(),x:window.__novaScene.avatar.position.x,ids:window.__novaEmbodiment.getDynamicIds()}));
  assert.equal(result.pose.leftArm,'raised');
  assert.ok(result.x > beforePos + 0.35, `avatar did not step right: ${beforePos} -> ${result.x}`);
  assert.equal(result.ids.length,beforeCount+1,'create_object executed more than once or not at all');
  assert.equal(result.ids.filter(id=>id.includes('compound_red_ball')).length,1,'compound object duplicated');
  assert.equal(postCount,1,'compound prompt sent more than once');
  assert.equal(errors.length,0,`browser errors: ${errors.join(' | ')}`);
  console.log('COMPOUND_ACTIONS_SMOKE_PASS');
} finally {
  await browser?.close();
  await new Promise(done=>server.close(done));
}
