import * as THREE from 'three';

const SCENE_ACTIONS = new Set(['look_at', 'point_at', 'highlight', 'move_near', 'press_button', 'remove_filter', 'face_user']);
const EMBODIMENT_ACTIONS = new Set(['raise_hand', 'lower_hand', 'wave', 'step', 'turn_body', 'neutral_pose', 'create_object', 'delete_object', 'move_object']);
const LOCOMOTION_ACTIONS = new Set(['approach_user', 'walk_to', 'step', 'move_near']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));

const state = { scene: null, running: false, held: null, chairMode: false };

async function waitForRuntime(timeoutMs = 12000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (window.__novaScene?.scene && window.__novaEmbodiment?.execute) {
      state.scene = window.__novaScene;
      return state.scene;
    }
    await sleep(80);
  }
  throw new Error('Nova runtime is not ready');
}

function material(color, roughness = 0.7, metalness = 0.04) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(parent, geometry, mat, position, rotation = null) {
  const item = new THREE.Mesh(geometry, mat);
  item.position.set(position.x || 0, position.y || 0, position.z || 0);
  if (rotation) item.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function registerTarget(id, label, item) {
  const mat = Array.isArray(item.material) ? item.material[0] : item.material;
  item.userData.targetId = id;
  state.scene.targets.set(id, {
    id, label, mesh: item, material: mat, pickMeshes: [item],
    position: item.getWorldPosition(new THREE.Vector3()),
    originalEmissive: mat?.emissive?.clone?.() ?? new THREE.Color(0),
    originalIntensity: mat?.emissiveIntensity ?? 0,
  });
}

function installStage() {
  if (!state.scene || state.scene.scene.getObjectByName('nova_cinematic_stage')) return;
  const stage = new THREE.Group();
  stage.name = 'nova_cinematic_stage';
  state.scene.scene.add(stage);

  const wall = material(0x30343b, 0.94, 0.02);
  const wood = material(0x5b4434, 0.74, 0.04);
  const fabric = material(0x27384a, 0.92, 0.01);

  mesh(stage, new THREE.PlaneGeometry(8.4, 4.4), wall, { x: 0, y: 2.2, z: -4.15 });
  mesh(stage, new THREE.PlaneGeometry(8.4, 4.4), wall, { x: -4.15, y: 2.2, z: 0 }, { y: Math.PI / 2 });

  const windowPane = mesh(stage, new THREE.PlaneGeometry(2.2, 1.45), new THREE.MeshStandardMaterial({
    color: 0x668eb4, emissive: 0x294864, emissiveIntensity: 0.72, roughness: 0.2,
  }), { x: -1.9, y: 2.05, z: -4.02 });
  mesh(stage, new THREE.BoxGeometry(2.42, 1.67, 0.07), material(0x161b21, 0.45, 0.28), { x: -1.9, y: 2.05, z: -4.07 });
  registerTarget('actor_window', 'Window', windowPane);

  const table = mesh(stage, new THREE.CylinderGeometry(0.72, 0.72, 0.08, 48), wood, { x: 1.45, y: 0.76, z: -0.95 });
  mesh(stage, new THREE.CylinderGeometry(0.08, 0.12, 0.72, 24), wood, { x: 1.45, y: 0.38, z: -0.95 });
  registerTarget('actor_table', 'Small table', table);

  const chair = mesh(stage, new THREE.BoxGeometry(0.72, 0.12, 0.72), fabric, { x: -0.2, y: 0.58, z: 0.72 });
  mesh(stage, new THREE.BoxGeometry(0.72, 0.88, 0.12), fabric, { x: -0.2, y: 1.02, z: 1.02 }, { x: -0.08 });
  for (const x of [-0.29, 0.29]) for (const z of [-0.27, 0.27]) {
    mesh(stage, new THREE.CylinderGeometry(0.035, 0.035, 0.54, 12), material(0x20252b, 0.55, 0.2), { x: -0.2 + x, y: 0.27, z: 0.72 + z });
  }
  registerTarget('actor_chair', 'Chair', chair);

  const glass = mesh(stage, new THREE.CylinderGeometry(0.075, 0.065, 0.22, 32, 1, true), new THREE.MeshPhysicalMaterial({
    color: 0xb9dcf1, roughness: 0.12, transmission: 0.42, transparent: true, opacity: 0.8,
  }), { x: 1.25, y: 0.91, z: -0.94 });
  registerTarget('actor_glass', 'Glass', glass);

  const key = new THREE.PointLight(0xffc38e, 22, 8, 2);
  key.position.set(2.7, 3.2, 2.4);
  stage.add(key);
  const fill = new THREE.PointLight(0x8fc9ff, 17, 7, 2);
  fill.position.set(-2.1, 2.5, -2.8);
  stage.add(fill);
}

function viewerPosition() {
  return state.scene.getViewerWorldPosition?.() || state.scene.camera.getWorldPosition(new THREE.Vector3());
}

function tween(duration, update) {
  const started = performance.now();
  return new Promise((resolve) => {
    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const s = t * t * (3 - 2 * t);
      update(s);
      if (t < 1) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
}

async function approachUser(args = {}) {
  const gap = clamp(args.distanceFromUser ?? args.gap ?? 1.55, 0.9, 2.6);
  const start = state.scene.avatar.position.clone();
  const target = viewerPosition().clone();
  target.y = start.y;
  const vector = target.sub(start);
  const distance = vector.length();
  if (distance <= gap + 0.05) return { ok: true, action: 'approach_user', moved: 0 };
  const move = Math.min(distance - gap, clamp(args.maxMove ?? 1.8, 0.2, 2.6));
  const end = start.clone().add(vector.normalize().multiplyScalar(move));
  state.scene.setState?.('moving');
  await tween(Math.max(650, move * 680), (t) => state.scene.avatar.position.lerpVectors(start, end, t));
  state.scene.setState?.('idle');
  return { ok: true, action: 'approach_user', moved: Number(move.toFixed(2)) };
}

async function walkToTarget(args = {}) {
  const targetId = args.targetId;
  const target = state.scene.targets.get(targetId);
  if (!target) return { ok: false, error: 'unknown_target', targetId };
  const targetPos = target.position?.clone?.() || target.mesh?.getWorldPosition?.(new THREE.Vector3());
  if (!targetPos) return { ok: false, error: 'target_position_missing', targetId };
  const start = state.scene.avatar.position.clone();
  const direction = targetPos.clone().setY(start.y).sub(start);
  const distance = direction.length();
  const stop = clamp(args.stopDistance ?? 0.72, 0.45, 1.4);
  const end = distance > stop ? start.clone().add(direction.normalize().multiplyScalar(distance - stop)) : start.clone();
  state.scene.setState?.('moving');
  await tween(Math.max(650, start.distanceTo(end) * 700), (t) => state.scene.avatar.position.lerpVectors(start, end, t));
  state.scene.setState?.('idle');
  return { ok: true, action: 'walk_to', targetId };
}

async function pickUp(args = {}) {
  const targetId = args.targetId || 'actor_glass';
  const target = state.scene.targets.get(targetId);
  const handState = window.__novaHumanoid?.getState?.()?.bodyParts?.rightHand;
  if (!target?.mesh || !handState) return { ok: false, error: 'pickup_unavailable', targetId };
  state.scene.lookTarget = targetId;
  state.scene.pointTarget = targetId;
  state.scene.setState?.('acting');
  await sleep(450);
  const object = target.mesh;
  const start = object.getWorldPosition(new THREE.Vector3());
  state.scene.scene.attach(object);
  object.position.copy(start);
  const end = new THREE.Vector3(handState.x, handState.y, handState.z);
  await tween(620, (t) => object.position.lerpVectors(start, end, t));
  const humanoidRoot = state.scene.avatar.getObjectByName('Nova_Humanoid_CC0');
  if (humanoidRoot) {
    let rightHandBone = null;
    humanoidRoot.traverse((node) => { if (!rightHandBone && node.isBone && /hand.*r|right.*hand|righthand/i.test(node.name || '')) rightHandBone = node; });
    if (rightHandBone) { rightHandBone.attach(object); object.position.set(0, 0.02, 0.02); }
  }
  state.held = targetId;
  state.scene.pointTarget = null;
  state.scene.setState?.('idle');
  return { ok: true, action: 'pick_up', targetId };
}

async function sitActor() {
  const humanoid = state.scene.avatar.getObjectByName('Nova_Humanoid_CC0');
  if (!humanoid || state.chairMode) return { ok: Boolean(humanoid), action: 'sit' };
  const startY = humanoid.position.y;
  state.scene.setState?.('acting');
  await tween(650, (t) => { humanoid.position.y = THREE.MathUtils.lerp(startY, startY - 0.28, t); });
  state.chairMode = true;
  state.scene.setState?.('idle');
  return { ok: true, action: 'sit' };
}

async function standActor() {
  const humanoid = state.scene.avatar.getObjectByName('Nova_Humanoid_CC0');
  if (!humanoid || !state.chairMode) return { ok: Boolean(humanoid), action: 'stand' };
  const startY = humanoid.position.y;
  state.scene.setState?.('acting');
  await tween(600, (t) => { humanoid.position.y = THREE.MathUtils.lerp(startY, startY + 0.28, t); });
  state.chairMode = false;
  state.scene.setState?.('idle');
  return { ok: true, action: 'stand' };
}

async function speak(text) {
  const value = String(text || '').trim();
  if (!value) return { ok: true, action: 'speak', skipped: true };
  state.scene.setState?.('speaking');
  const log = document.getElementById('cinematic-director-log');
  if (log) log.textContent = `ACTOR: ${value}`;
  if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const utterance = new SpeechSynthesisUtterance(value);
      utterance.lang = /[А-Яа-яЁё]/.test(value) ? 'ru-RU' : (navigator.language || 'en-US');
      utterance.rate = 0.96;
      utterance.pitch = 1.02;
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      setTimeout(finish, Math.min(9000, 1100 + value.length * 55));
    });
  } else await sleep(Math.min(3500, 600 + value.length * 35));
  state.scene.setState?.('idle');
  return { ok: true, action: 'speak', text: value };
}

async function waitForChatIdle() {
  const started = performance.now();
  while (window.__NovaApp?.isBusy?.() && performance.now() - started < 45000) await sleep(40);
}

async function execute(action) {
  const name = String(action?.name || '').trim();
  const args = action?.args && typeof action.args === 'object' ? action.args : {};
  window.dispatchEvent(new CustomEvent('nova:cinematic-action', { detail: { name, args } }));
  if (name === 'speak') return speak(args.text || action.text || '');
  if (name === 'approach_user') return approachUser(args);
  if (name === 'walk_to') return walkToTarget(args);
  if (name === 'pick_up') return pickUp(args);
  if (name === 'sit') return sitActor();
  if (name === 'stand') return standActor();
  if (name === 'pause') { await sleep(clamp(args.ms ?? 450, 80, 4000)); return { ok: true, action: 'pause' }; }
  if (typeof window.__NovaApp?.executeAction === 'function') {
    return window.__NovaApp.executeAction({ name, args });
  }
  if (SCENE_ACTIONS.has(name)) return state.scene.executeTool(name, args);
  if (EMBODIMENT_ACTIONS.has(name)) return window.__novaEmbodiment.execute({ name, args });
  return { ok: false, error: 'cinematic_action_not_allowed', action: name };
}

function dialogue(script) {
  return [...String(script).matchAll(/[«“\"]([^»”\"]{2,220})[»”\"]/g)].map((m) => m[1].trim()).slice(0, 3);
}

function fallbackPlan(script) {
  const lower = String(script || '').toLowerCase();
  const plan = [];
  if (/окн|window/.test(lower)) plan.push({ name: 'look_at', args: { targetId: 'actor_window' } });
  if (/замеч|notice|зрител|viewer|камер|camera/.test(lower)) plan.push({ name: 'face_user', args: {} });
  if (/подход|подойти|приближ|approach|comes closer|walks to viewer/.test(lower)) plan.push({ name: 'approach_user', args: { distanceFromUser: 1.55 } });
  if (/машет|помах|wave|greet/.test(lower)) plan.push({ name: 'wave', args: { side: 'left' } });
  if (/стакан|glass/.test(lower)) {
    plan.push({ name: 'walk_to', args: { targetId: 'actor_table', stopDistance: 0.78 } });
    plan.push({ name: 'look_at', args: { targetId: 'actor_glass' } });
    plan.push({ name: 'point_at', args: { targetId: 'actor_glass' } });
  }
  if (/бер[её]т|возьм|pick.*up|takes the glass/.test(lower)) plan.push({ name: 'pick_up', args: { targetId: 'actor_glass' } });
  if (/садит|садится|sit/.test(lower)) plan.push({ name: 'sit', args: {} });
  if (/вста[её]т|stand/.test(lower)) plan.push({ name: 'stand', args: {} });
  for (const line of dialogue(script)) plan.push({ name: 'speak', args: { text: line } });
  if (!plan.length) plan.push({ name: 'face_user', args: {} }, { name: 'wave', args: { side: 'left' } }, { name: 'speak', args: { text: 'Я получила сценарий и готова отыграть сцену.' } });
  return plan.slice(0, 16);
}

function actionKey(action) {
  return `${action?.name || ''}:${JSON.stringify(action?.args || {})}`;
}

function collapseConsecutive(actions) {
  const result = [];
  for (const action of actions) {
    const previous = result[result.length - 1];
    if (previous && actionKey(previous) === actionKey(action)) continue;
    result.push(action);
  }
  return result;
}

function normalizeActions(data) {
  const result = [];
  const seen = new Set();
  for (const item of [...(Array.isArray(data?.actions) ? data.actions : []), ...(Array.isArray(data?.extendedActions) ? data.extendedActions : [])]) {
    if (!item || typeof item.name !== 'string') continue;
    const action = { name: item.name, args: item.args && typeof item.args === 'object' ? { ...item.args } : {} };
    const key = actionKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }
  return collapseConsecutive(result).slice(0, 14);
}

function enrichPlan(script, actions) {
  const result = collapseConsecutive(actions);
  const lower = String(script).toLowerCase();
  const names = new Set(result.map((a) => a.name));
  const hasLocomotion = [...LOCOMOTION_ACTIONS].some((name) => names.has(name));
  if (/подход|подойти|приближ|approach|comes closer/.test(lower) && !hasLocomotion) {
    result.push({ name: 'approach_user', args: { distanceFromUser: 1.55 } });
  }
  if (/бер[её]т|возьм|pick.*up|takes the glass/.test(lower) && !names.has('pick_up')) {
    result.push({ name: 'pick_up', args: { targetId: 'actor_glass' } });
  }
  if (/садит|садится|sit/.test(lower) && !names.has('sit')) result.push({ name: 'sit', args: {} });
  const lines = dialogue(script);
  if (lines.length && !result.some((a) => a.name === 'speak')) for (const line of lines) result.push({ name: 'speak', args: { text: line } });
  return collapseConsecutive(result).slice(0, 16);
}

async function compileAI(script) {
  const endpoint = window.__NOVA_AI_ENDPOINT;
  if (!endpoint) throw new Error('AI endpoint is not configured');
  const prompt = [
    'CINEMATIC HUMANOID ACTOR DIRECTOR.',
    'Convert the following scene script into a concise ordered physical performance for Nova.',
    'Use existing actions where possible: face_user, look_at, point_at, wave, raise_hand, lower_hand, step, turn_body, neutral_pose.',
    'Scene targets available: actor_window, actor_table, actor_chair, actor_glass.',
    'Do not narrate the plan. Return the normal Nova tool/action response.',
    `SCRIPT: ${script}`,
  ].join('\n');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ message: prompt, history: [], scene: state.scene.getSceneContext?.() || {}, toolResults: [], phase: 'initial', locale: navigator.language || 'en-US' }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `AI HTTP ${response.status}`);
  const actions = normalizeActions(data);
  if (!actions.length) throw new Error('AI returned no actions');
  return { source: 'ai', actions: enrichPlan(script, actions) };
}

async function compile(script, preferAI = true) {
  if (preferAI) {
    try { return await compileAI(script); } catch (error) { console.warn('Cinematic AI fallback:', error); }
  }
  return { source: 'fallback', actions: fallbackPlan(script) };
}

function label(action) {
  const args = action.args || {};
  if (action.name === 'speak') return `SPEAK “${String(args.text || '').slice(0, 48)}”`;
  return `${action.name.toUpperCase()}${args.targetId ? ` → ${args.targetId}` : ''}`;
}

async function run(script, options = {}) {
  if (state.running) throw new Error('Scene is already running');
  await waitForRuntime();
  await waitForChatIdle();
  state.running = true;
  const log = document.getElementById('cinematic-director-log');
  const list = document.getElementById('cinematic-action-list');
  try {
    const plan = await compile(script, options.preferAI !== false);
    const actions = collapseConsecutive(plan.actions);
    if (list) list.textContent = actions.map(label).join('  ›  ');
    for (let i = 0; i < actions.length; i += 1) {
      const action = actions[i];
      if (log) log.textContent = `${plan.source === 'ai' ? 'AI' : 'Fallback'} director · ${i + 1}/${actions.length}: ${label(action)}`;
      await execute(action);
      await sleep(100);
    }
    if (log) log.textContent = `Scene complete · ${actions.length} actions · ${plan.source}`;
    return { ok: true, source: plan.source, actions };
  } finally { state.running = false; }
}

function styleUi() {
  if (document.getElementById('cinematic-director-style')) return;
  const style = document.createElement('style');
  style.id = 'cinematic-director-style';
  style.textContent = `
    .cinematic-director { position:fixed; left:12px; top:46%; transform:translateY(-50%); z-index:28; width:auto; max-width:min(420px,calc(100vw - 24px)); padding:0; border:0; background:transparent; box-shadow:none; pointer-events:none; color:#eef5ff; font:13px/1.35 system-ui,sans-serif; }
    .cinematic-director > * { pointer-events:auto; }
    .cinematic-director .cinematic-toggle { border:1px solid rgba(255,255,255,.16); border-radius:999px; padding:8px 12px; background:rgba(7,11,18,.86); color:#fff; cursor:pointer; backdrop-filter:blur(18px); box-shadow:0 10px 28px rgba(0,0,0,.28); }
    .cinematic-director.expanded { top:120px; bottom:auto; transform:none; width:min(420px,calc(100vw - 36px)); max-height:min(52vh,calc(100dvh - 260px)); overflow:auto; padding:14px; border:1px solid rgba(255,255,255,.16); border-radius:16px; background:rgba(7,11,18,.86); backdrop-filter:blur(18px); box-shadow:0 18px 50px rgba(0,0,0,.34); }
    .cinematic-director.expanded .cinematic-toggle { margin-bottom:8px; }
    .cinematic-director textarea { width:100%; min-height:90px; box-sizing:border-box; resize:vertical; border-radius:11px; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.25); color:#fff; padding:10px; font:inherit; }
    .cinematic-director .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:9px; }
    .cinematic-director button,.cinematic-director select { border:1px solid rgba(255,255,255,.16); border-radius:10px; padding:8px 11px; background:#171d27; color:#fff; cursor:pointer; }
    .cinematic-director button.primary { background:rgba(70,145,255,.28); }
    #cinematic-director-log { margin-top:8px; color:#b9d5ff; }
    #cinematic-action-list { margin-top:5px; color:#8f9bad; max-height:42px; overflow:auto; font-size:11px; }
    @media(max-width:760px){
      .cinematic-director { left:10px; }
      .cinematic-director.expanded { top:auto; bottom:10px; width:calc(100vw - 20px); max-height:46dvh; }
    }
  `;
  document.head.appendChild(style);
}

function setDirectorExpanded(panel, expanded) {
  const body = panel.querySelector('#cinematic-director-body');
  const toggle = panel.querySelector('#cinematic-director-toggle');
  panel.classList.toggle('expanded', expanded);
  if (body) body.hidden = !expanded;
  if (toggle) {
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.textContent = expanded ? 'Hide AI Actor' : 'AI Actor · VR180';
  }
}

function buildUi() {
  if (document.getElementById('cinematic-director')) return;
  styleUi();
  const panel = document.createElement('section');
  panel.id = 'cinematic-director';
  panel.className = 'cinematic-director';
  panel.innerHTML = `
    <button id="cinematic-director-toggle" class="cinematic-toggle" type="button" aria-expanded="false">AI Actor · VR180</button>
    <div id="cinematic-director-body" hidden>
      <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:9px;font-weight:700"><span>AI ACTOR · CINEMATIC VR</span><span style="opacity:.55">HUMANOID</span></div>
      <textarea id="cinematic-script">Девушка стоит у окна. Она замечает зрителя, поворачивается к нему, подходит ближе и машет рукой. Затем подходит к столу, показывает на стакан, берет его и говорит: «Привет. Я получила сценарий и могу отыграть его прямо в VR».</textarea>
      <div class="row"><button id="cinematic-run-ai" class="primary" type="button">AI → Act</button><button id="cinematic-run-local" type="button">Local fallback</button></div>
      <div id="cinematic-director-log">Director ready</div><div id="cinematic-action-list"></div>
    </div>
  `;
  document.body.appendChild(panel);
  setDirectorExpanded(panel, false);
  panel.querySelector('#cinematic-director-toggle').addEventListener('click', () => {
    setDirectorExpanded(panel, !panel.classList.contains('expanded'));
  });
  const script = panel.querySelector('#cinematic-script');
  panel.querySelector('#cinematic-run-ai').addEventListener('click', async () => { try { await run(script.value, { preferAI: true }); } catch (error) { panel.querySelector('#cinematic-director-log').textContent = `Error: ${error?.message || error}`; } });
  panel.querySelector('#cinematic-run-local').addEventListener('click', async () => { try { await run(script.value, { preferAI: false }); } catch (error) { panel.querySelector('#cinematic-director-log').textContent = `Error: ${error?.message || error}`; } });
}

async function init() {
  try { await waitForRuntime(); installStage(); buildUi(); window.__novaCinematicDirectorReady = true; }
  catch (error) { console.error('Cinematic director init failed:', error); }
}

window.__novaCinematicDirector = { run, compile, get ready() { return Boolean(window.__novaCinematicDirectorReady); }, get running() { return state.running; } };
void init();
