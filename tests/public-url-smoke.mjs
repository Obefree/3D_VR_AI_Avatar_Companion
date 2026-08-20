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
  await page.waitForFunction(()=>window.__NovaGroqAuth.getState().keyStatus === 'missing_key',null,{timeout:20000});
  await page.waitForFunction(()=>document.getElementById('mode-pill')?.textContent === 'Agent mode',null,{timeout:20000});
  assert.equal(await page.evaluate(()=>window.__NovaGroqAuth.getState().generative),false,'unauthenticated public build unexpectedly reports Groq AI');
  assert.match(await page.locator('#live-button').innerText(),/Connect Groq/i);

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

  await send('Подними левую руку',()=>window.__novaEmbodiment?.getPose().leftArm === 'raised');
  const beforeCreate = await page.evaluate(()=>window.__novaEmbodiment.getDynamicIds().length);
  await send('Создай синий куб полметра перед собой',()=>window.__novaEmbodiment?.getDynamicIds().length > 5);
  const createdId = await page.evaluate(()=>window.__novaScene.getSceneContext().editableWorld.lastCreatedId);
  assert.ok(createdId,'public create_object produced no object id');
  assert.equal(await page.evaluate(()=>window.__novaEmbodiment.getDynamicIds().length),beforeCreate+1);
  await send('Удали этот куб');
  await page.waitForFunction(id=>!window.__novaScene.targets.has(id),createdId,{timeout:18000});

  await send('Покажи красную кнопку',()=>window.__novaScene.lookTarget === 'red_button');
  state = await page.evaluate(()=>window.__novaScene.getSceneContext());
  assert.equal(state.deviceState.resetPressed,false);
  await send('Нажми её',()=>window.__novaScene.deviceState.resetPressed === true);
  await send('Что дальше?',()=>window.__novaScene.lookTarget === 'filter');
  await send('Вытащи фильтр',()=>window.__novaScene.deviceState.filterRemoved === true);
  state = await page.evaluate(()=>window.__novaScene.getSceneContext());
  assert.equal(state.task.step,'complete');

  const freeBefore = await page.locator('#messages .message').count();
  await page.fill('#text-input','Расскажи что-нибудь свободно');
  await page.click('#send-button');
  await page.waitForFunction(count=>document.querySelectorAll('#messages .message').length >= count + 2,freeBefore,{timeout:18000});
  assert.match(await page.locator('#messages .message.assistant').last().innerText(),/Groq не подключён|Connect Groq/i);
  const transcript = await page.locator('#messages').innerText();
  assert.doesNotMatch(transcript,/demo fallback|локальный резервный/i);
  assert.equal(errors.length,0,`public browser errors: ${errors.join(' | ')}`);
  await context.close();

  const invalidContext = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,locale:'ru-RU'});
  await addSpeechMocks(invalidContext);
  await invalidContext.addInitScript(()=>localStorage.setItem('nova_groq_key_v1','gsk_invalid_public_smoke'));
  const invalidPage = await invalidContext.newPage();
  const invalidErrors=[];
  invalidPage.on('pageerror',e=>invalidErrors.push(e.message));
  invalidPage.on('console',m=>{if(m.type()==='error')invalidErrors.push(m.text());});
  await invalidPage.goto(PUBLIC_URL,{waitUntil:'domcontentloaded',timeout:30000});
  await invalidPage.waitForFunction(()=>window.__NovaGroqAuth?.getState().backendOk === true,null,{timeout:20000});
  await invalidPage.waitForFunction(()=>window.__NovaGroqAuth?.getState().keyStatus === 'invalid_key',null,{timeout:20000});
  assert.equal(await invalidPage.evaluate(()=>window.__NovaGroqAuth.getState().keyPresent),false,'invalid Groq key was not cleared');
  assert.equal(await invalidPage.locator('#mode-pill').innerText(),'Agent mode');
  assert.match(await invalidPage.locator('#live-button').innerText(),/Connect Groq/i);
  assert.equal(invalidErrors.length,0,`invalid-key browser errors: ${invalidErrors.join(' | ')}`);
  await invalidContext.close();

  console.log('PUBLIC_URL_SMOKE_PASS');
  console.log('PUBLIC_GROQ_KEY_STATE_PASS');
  console.log(PUBLIC_URL);
} finally {
  await browser?.close();
}
