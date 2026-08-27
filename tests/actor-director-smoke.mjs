import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { chromium } from 'playwright';
import {
  DEFAULT_ACTOR_SCRIPT,
  fallbackPlan,
  mergeSemanticActions,
  normalizeAiActions,
} from '../src/actor-plan.js';

function names(plan) {
  return plan.map((item) => item.name);
}

const fallback = fallbackPlan(DEFAULT_ACTOR_SCRIPT);
assert.deepEqual(
  names(fallback),
  ['look_at', 'face_user', 'approach_user', 'wave', 'look_at', 'point_at', 'pick_up', 'speak'],
  'default script chain must be window → face → approach → wave → glass → pick_up → speak',
);
assert.equal(fallback.filter((item) => item.name === 'face_user').length, 1, 'overlapping viewer cues must not emit parallel face_user');
assert.equal(fallback[0].args.targetId, 'actor_window');
assert.equal(fallback[4].args.targetId, 'actor_glass');
assert.equal(fallback[6].args.targetId, 'actor_glass');
assert.match(fallback[7].args.text, /Привет/);

const merged = mergeSemanticActions(DEFAULT_ACTOR_SCRIPT, [
  { name: 'look_at', args: { targetId: 'actor_window' } },
  { name: 'face_user', args: {} },
  { name: 'wave', args: { side: 'left' } },
]);
assert.ok(merged.some((item) => item.name === 'approach_user'), 'AI plan missing approach must be completed, not run as a second parallel director');
assert.ok(merged.some((item) => item.name === 'pick_up'), 'AI plan missing pick_up must be completed by the same chain');
assert.equal(merged.filter((item) => item.name === 'wave').length, 1);

const parallelLists = normalizeAiActions({
  actions: [{ name: 'wave', args: { side: 'left' } }, { name: 'step', args: { direction: 'front' } }],
  extendedActions: [{ name: 'wave', args: { side: 'left' } }, { name: 'step', args: { direction: 'front' } }],
});
assert.deepEqual(names(parallelLists), ['wave', 'step'], 'actions + extendedActions duplicates must collapse to one chain');

const sitStand = fallbackPlan('She sits, then stands.');
assert.deepEqual(names(sitStand), ['sit', 'stand']);
assert.equal(fallbackPlan('I understand the situation.').some((item) => item.name === 'sit' || item.name === 'stand'), false);

const root = resolve(process.cwd());
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, body) {
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/chat' || url.pathname === '/api/chat/') {
      if (req.method === 'GET') return sendJson(res, { ok: true, provider: 'mock', generative: true });
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || '{}');
      if (String(body.message || '').includes('CINEMATIC ACTOR DIRECTOR')) {
        return sendJson(res, {
          ok: true,
          text: 'Playing the scene.',
          actions: [
            { name: 'look_at', args: { targetId: 'actor_window' } },
            { name: 'wave', args: { side: 'left' } },
            { name: 'wave', args: { side: 'left' } },
          ],
          extendedActions: [{ name: 'wave', args: { side: 'left' } }],
        });
      }
      return sendJson(res, { ok: true, text: 'Ready.', actions: [] });
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/g, '');
    const file = resolve(root, safe);
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  await context.addInitScript(() => {
    class MockUtterance {
      constructor(text) { this.text = text; this.lang = ''; this.onend = null; this.onerror = null; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, speak(utterance) { setTimeout(() => utterance.onend?.(), 8); } },
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__novaActorDirectorReady === true && window.__novaEmbodimentReady === true && window.__NovaApp,
    null,
    { timeout: 25000 },
  );

  const stage = await page.evaluate(() => {
    const scene = window.__novaScene;
    return {
      targets: ['actor_window', 'actor_table', 'actor_chair', 'actor_glass'].every((id) => scene.targets.has(id)),
      skin: scene.avatar?.userData?.actorStyle === 'cinematic_female_mvp',
      hasQueue: typeof window.__NovaApp.queue === 'function',
      hasExecute: typeof window.__NovaApp.executeAction === 'function',
    };
  });
  assert.equal(stage.targets, true, 'cinematic stage targets missing');
  assert.equal(stage.skin, true, 'female actor skin missing');
  assert.equal(stage.hasQueue, true, 'NovaApp.queue missing — director and chat cannot serialize');
  assert.equal(stage.hasExecute, true, 'NovaApp.executeAction missing — duplicate dispatchers would run in parallel');

  const startX = await page.evaluate(() => window.__novaScene.avatar.position.x);
  const startZ = await page.evaluate(() => window.__novaScene.avatar.position.z);
  await page.click('#actor-run-local');
  await page.waitForFunction(
    () => window.__novaActorDirector?.lastRun?.ok === true && window.__novaActorDirector.running === false,
    null,
    { timeout: 45000 },
  );

  const run = await page.evaluate(() => {
    const last = window.__novaActorDirector.lastRun;
    const glass = window.__novaScene.targets.get('actor_glass');
    return {
      source: last.source,
      names: last.actions.map((item) => item.name),
      results: last.results.map((item) => ({ name: item.action.name, ok: item.result?.ok, error: item.result?.error || null })),
      held: glass?.mesh?.parent?.name || glass?.mesh?.parent?.type || null,
      x: window.__novaScene.avatar.position.x,
      z: window.__novaScene.avatar.position.z,
    };
  });

  assert.equal(run.source, 'fallback');
  assert.deepEqual(run.names, names(fallback));
  const failed = run.results.filter((item) => item.ok === false);
  assert.equal(failed.length, 0, `actor chain failed: ${JSON.stringify(failed)}`);
  assert.equal(run.results.filter((item) => item.name === 'face_user').length, 1);
  const moved = Math.hypot(run.x - startX, run.z - startZ);
  assert.ok(moved > 0.15, `approach_user did not move the actor: ${moved}`);
  assert.ok(run.held, 'pick_up did not reparent the glass');

  await page.click('#actor-stereo');
  await page.waitForSelector('.stereo-vr-overlay canvas', { timeout: 8000 });
  const stereo = await page.evaluate(() => Boolean(document.querySelector('.stereo-vr-overlay')));
  assert.equal(stereo, true);
  await page.click('.stereo-vr-bar button');
  await page.waitForFunction(() => !document.querySelector('.stereo-vr-overlay'), null, { timeout: 5000 });

  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);
  console.log('actor-director chain: ok');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
