import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PUBLIC_REF = process.env.PUBLIC_REF || process.env.GITHUB_SHA || 'main';
const PUBLIC_URL = `https://cdn.githubraw.com/Obefree/3D_VR_AI_Avatar_Companion/${PUBLIC_REF}/index.html`;

function addSpeechMocks(context) {
  return context.addInitScript(() => {
    class MockUtterance { constructor(text){ this.text=text; this.lang=''; this.onend=null; this.onerror=null; } }
    Object.defineProperty(window,'SpeechSynthesisUtterance',{value:MockUtterance,configurable:true});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel(){},speak(u){setTimeout(()=>u.onend?.(),10);}}});
  });
}

let browser;
try {
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,locale:'ru-RU'});
  await addSpeechMocks(context);
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});

  const response = await page.goto(PUBLIC_URL,{waitUntil:'domcontentloaded',timeout:30000});
  assert.ok(response,'public URL returned no response');
  assert.ok(response.status() >= 200 && response.status() < 400,`public URL HTTP ${response.status()}`);
  await page.waitForFunction(()=>window.__NovaApp && window.__novaScene && window.__NovaGroqAuth,null,{timeout:30000});
  await page.waitForFunction(()=>window.__novaEmbodimentReady === true,null,{timeout:30000});
  await page.waitForFunction(()=>window.__NovaGroqAuth.getState().backendOk === true,null,{timeout:20000});
  await page.waitForFunction(()=>window.__NovaGroqAuth.getState().generative === true,null,{timeout:20000});
  await page.waitForFunction(()=>document.getElementById('mode-pill')?.textContent === 'AI mode',null,{timeout:20000});
  const authState = await page.evaluate(()=>window.__NovaGroqAuth.getState());
  assert.equal(authState.serverManaged,true,'public demo is not using server-managed Groq credentials');
  assert.equal(authState.keyPresent,false,'public demo unexpectedly requires a browser Groq key');
  assert.equal(authState.keyStatus,'valid');
  assert.match(await page.locator('#live-button').innerText(),/Groq connected/i);
  assert.match(await page.locator('#connection-pill').innerText(),/Groq ready/i);

  async function send(text,predicate,timeout=35000){
    const before = await page.locator('#messages .message').count();
    await page.fill('#text-input',text);
    await page.click('#send-button');
    await page.waitForFunction(count=>document.querySelectorAll('#messages .message').length >= count + 2,before,{timeout});
    if(predicate) await page.waitForFunction(predicate,null,{timeout:18000});
  }

  let state = await page.evaluate(()=>window.__novaScene.getSceneContext());
  assert.ok(state.avatar?.bodyParts?.leftHand,'public build has no body awareness');
  assert.ok(state.space?.size?.width >= 8,'public build has no room bounds');
  assert.ok(state.editableWorld?.dynamicObjectIds?.length >= 5,'starter scene objects missing');

  // Live LLM -> multiple tool calls -> actual scene mutations, with no browser API key.
  const compoundBefore = await page.evaluate(() => ({
    position: window.__novaScene.getSceneContext().avatar.position,
    dynamicCount: window.__novaEmbodiment.getDynamicIds().length,
  }));
  await send(
    'Подними левую руку, затем сделай шаг вправо на полметра, затем создай красный шар перед собой',
    () => window.__novaEmbodiment?.getPose().leftArm === 'raised' && window.__novaEmbodiment?.getDynamicIds().length > 5,
    35000,
  );
  await page.waitForFunction(
    before => {
      const now = window.__novaScene.getSceneContext().avatar.position;
      return Math.hypot(now.x-before.x,now.y-before.y,now.z-before.z) > 0.25;
    },
    compoundBefore.position,
    {timeout:18000},
  );
  const compoundAfter = await page.evaluate(() => ({
    position: window.__novaScene.getSceneContext().avatar.position,
    dynamicCount: window.__novaEmbodiment.getDynamicIds().length,
    lastCreatedId: window.__novaScene.getSceneContext().editableWorld.lastCreatedId,
    pose: window.__novaEmbodiment.getPose(),
  }));
  assert.equal(compoundAfter.pose.leftArm,'raised');
  assert.equal(compoundAfter.dynamicCount,compoundBefore.dynamicCount+1,'compound create action executed incorrectly');
  assert.ok(compoundAfter.lastCreatedId,'compound LLM action did not create an object');
  assert.ok(Math.hypot(
    compoundAfter.position.x-compoundBefore.position.x,
    compoundAfter.position.y-compoundBefore.position.y,
    compoundAfter.position.z-compoundBefore.position.z,
  ) > 0.25,'compound LLM step action did not move the avatar');

  // Live free-form LLM response, not command-engine fallback.
  const freeBefore = await page.locator('#messages .message').count();
  await page.fill('#text-input','Объясни в одном коротком предложении, почему небо голубое');
  await page.click('#send-button');
  await page.waitForFunction(count=>document.querySelectorAll('#messages .message').length >= count + 2,freeBefore,{timeout:25000});
  const freeText = await page.locator('#messages .message.assistant').last().innerText();
  assert.match(freeText,/рассе|рэле|свет|атмосфер/i,'free-form request did not receive a substantive LLM answer');
  assert.doesNotMatch(freeText,/не подключ|недоступ|command engine|команды сцены/i);

  // Deterministic service path still works through the fast command engine.
  await page.evaluate(()=>window.__novaScene.resetTask());
  await send('Покажи красную кнопку',()=>window.__novaScene.lookTarget === 'red_button');
  state = await page.evaluate(()=>window.__novaScene.getSceneContext());
  assert.equal(state.deviceState.resetPressed,false);
  await send('Нажми её',()=>window.__novaScene.deviceState.resetPressed === true);
  await send('Что дальше?',()=>window.__novaScene.lookTarget === 'filter');
  await send('Вытащи фильтр',()=>window.__novaScene.deviceState.filterRemoved === true);
  state = await page.evaluate(()=>window.__novaScene.getSceneContext());
  assert.equal(state.task.step,'complete');

  const transcript = await page.locator('#messages').innerText();
  assert.doesNotMatch(transcript,/demo fallback|локальный резервный/i);
  assert.equal(errors.length,0,`public browser errors: ${errors.join(' | ')}`);
  await context.close();

  // A stale browser key must not override the server-managed demo credential.
  const staleContext = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,locale:'ru-RU'});
  await addSpeechMocks(staleContext);
  await staleContext.addInitScript(()=>localStorage.setItem('nova_groq_key_v1','gsk_invalid_public_smoke'));
  const stalePage = await staleContext.newPage();
  const staleErrors=[];
  stalePage.on('pageerror',e=>staleErrors.push(e.message));
  stalePage.on('console',m=>{if(m.type()==='error')staleErrors.push(m.text());});
  await stalePage.goto(PUBLIC_URL,{waitUntil:'domcontentloaded',timeout:30000});
  await stalePage.waitForFunction(()=>window.__NovaGroqAuth?.getState().backendOk === true,null,{timeout:20000});
  await stalePage.waitForFunction(()=>window.__NovaGroqAuth?.getState().generative === true,null,{timeout:20000});
  const staleState = await stalePage.evaluate(()=>window.__NovaGroqAuth.getState());
  assert.equal(staleState.serverManaged,true);
  assert.equal(staleState.keyPresent,false,'stale browser key still participates in server-managed mode');
  assert.equal(staleState.keyStatus,'valid');
  assert.equal(await stalePage.locator('#mode-pill').innerText(),'AI mode');
  assert.match(await stalePage.locator('#live-button').innerText(),/Groq connected/i);
  assert.equal(staleErrors.length,0,`stale-key browser errors: ${staleErrors.join(' | ')}`);
  await staleContext.close();

  console.log('PUBLIC_URL_SMOKE_PASS');
  console.log('PUBLIC_SERVER_GROQ_PASS');
  console.log(PUBLIC_URL);
} finally {
  await browser?.close();
}
