import * as THREE from 'three';
import {
  SCENE_ACTIONS,
  EMBODIMENT_ACTIONS,
  DEFAULT_ACTOR_SCRIPT,
  fallbackPlan,
  normalizeAiActions,
  mergeSemanticActions,
  actionLabel,
} from './actor-plan.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));

const state = {
  scene: null,
  embodiment: null,
  running: false,
  lastRun: null,
  stereo: null,
  skinInstalled: false,
  seated: false,
  bodyHomeY: null,
  heldObject: null,
};

async function waitForRuntime(timeoutMs = 9000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const scene = window.__novaScene;
    const embodiment = window.__novaEmbodiment;
    if (scene?.scene && scene?.camera && embodiment?.execute) {
      state.scene = scene;
      state.embodiment = embodiment;
      return { scene, embodiment };
    }
    await sleep(80);
  }
  throw new Error('Nova 3D runtime is not ready');
}

function mat(color, roughness = 0.6, metalness = 0.05) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addMesh(parent, geometry, material, position, rotation = null, scale = null) {
  const mesh = new THREE.Mesh(geometry, material);
  if (position) mesh.position.set(position.x || 0, position.y || 0, position.z || 0);
  if (rotation) mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
  if (scale) mesh.scale.set(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function registerTarget(scene, id, label, mesh, material = mesh.material) {
  const position = mesh.getWorldPosition(new THREE.Vector3());
  scene.targets.set(id, {
    id,
    label,
    mesh,
    material,
    pickMeshes: [mesh],
    noRecolor: false,
    position,
    originalEmissive: material?.emissive?.clone?.() ?? new THREE.Color(0),
    originalIntensity: material?.emissiveIntensity ?? 0,
  });
  mesh.userData.targetId = id;
}

function installCinematicStage(scene) {
  if (scene.scene.getObjectByName('ai_actor_cinematic_stage')) return;

  const stage = new THREE.Group();
  stage.name = 'ai_actor_cinematic_stage';
  scene.scene.add(stage);

  // A small warm cinematic room around the existing interactive scene.
  const wallMat = mat(0x2b3038, 0.96, 0.02);
  const woodMat = mat(0x5b4332, 0.78, 0.03);
  const fabricMat = mat(0x263545, 0.92, 0.01);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xb9dcf1,
    roughness: 0.15,
    transmission: 0.35,
    transparent: true,
    opacity: 0.78,
  });

  const backWall = addMesh(stage, new THREE.PlaneGeometry(8.5, 4.5), wallMat, { x: 0, y: 2.2, z: -4.15 });
  backWall.receiveShadow = true;

  const sideWall = addMesh(stage, new THREE.PlaneGeometry(8.5, 4.5), wallMat, { x: -4.15, y: 2.2, z: 0 }, { y: Math.PI / 2 });
  sideWall.receiveShadow = true;

  const windowFrame = addMesh(stage, new THREE.BoxGeometry(2.4, 1.65, 0.08), mat(0x151a21, 0.4, 0.35), { x: -1.9, y: 2.05, z: -4.05 });
  const windowPane = addMesh(stage, new THREE.PlaneGeometry(2.18, 1.43), new THREE.MeshStandardMaterial({
    color: 0x6688a8,
    emissive: 0x29445e,
    emissiveIntensity: 0.55,
    roughness: 0.25,
  }), { x: -1.9, y: 2.05, z: -4.0 });
  registerTarget(scene, 'actor_window', 'Window', windowPane);

  const tableTop = addMesh(stage, new THREE.CylinderGeometry(0.72, 0.72, 0.08, 48), woodMat, { x: 1.45, y: 0.76, z: -0.95 });
  addMesh(stage, new THREE.CylinderGeometry(0.08, 0.12, 0.72, 24), woodMat, { x: 1.45, y: 0.38, z: -0.95 });
  registerTarget(scene, 'actor_table', 'Small table', tableTop);

  const chairSeat = addMesh(stage, new THREE.BoxGeometry(0.72, 0.12, 0.72), fabricMat, { x: -0.25, y: 0.58, z: 0.72 });
  addMesh(stage, new THREE.BoxGeometry(0.72, 0.9, 0.12), fabricMat, { x: -0.25, y: 1.03, z: 1.02 }, { x: -0.08 });
  for (const x of [-0.29, 0.29]) {
    for (const z of [-0.27, 0.27]) {
      addMesh(stage, new THREE.CylinderGeometry(0.035, 0.035, 0.54, 12), mat(0x20252b, 0.55, 0.2), { x: -0.25 + x, y: 0.27, z: 0.72 + z });
    }
  }
  registerTarget(scene, 'actor_chair', 'Chair', chairSeat);

  const glass = addMesh(stage, new THREE.CylinderGeometry(0.075, 0.065, 0.22, 32, 1, true), glassMat, { x: 1.25, y: 0.91, z: -0.94 });
  registerTarget(scene, 'actor_glass', 'Glass', glass, glassMat);

  const warmKey = new THREE.PointLight(0xffc38e, 22, 8, 2);
  warmKey.position.set(2.7, 3.2, 2.4);
  stage.add(warmKey);
  const windowFill = new THREE.PointLight(0x8fc9ff, 18, 7, 2);
  windowFill.position.set(-2.2, 2.5, -2.8);
  stage.add(windowFill);

  stage.userData.targets = ['actor_window', 'actor_table', 'actor_chair', 'actor_glass'];
}

function installFemaleActorSkin(scene) {
  if (state.skinInstalled || !scene.body || !scene.headPivot || !scene.leftArm || !scene.rightArm) return;
  state.skinInstalled = true;
  state.bodyHomeY = scene.body.position.y;

  // Keep the proven procedural rig, replace only its visible meshes with a stylized actor skin.
  scene.body.traverse((object) => {
    if (object.isMesh) object.visible = false;
  });

  const skin = mat(0xe7b99c, 0.72, 0.0);
  const dress = mat(0x26384f, 0.68, 0.02);
  const dressAccent = mat(0xb68c65, 0.55, 0.08);
  const hair = mat(0x2e211d, 0.86, 0.0);
  const eye = mat(0x22262c, 0.45, 0.02);
  const shoe = mat(0x17191d, 0.6, 0.12);

  // Torso and dress, attached to the original animated body group.
  addMesh(scene.body, new THREE.CapsuleGeometry(0.23, 0.38, 8, 24), dress, { x: 0, y: 0.02, z: 0 }, null, { x: 1.12, y: 1.08, z: 0.72 });
  addMesh(scene.body, new THREE.ConeGeometry(0.39, 0.58, 32), dress, { x: 0, y: -0.28, z: 0 }, { x: Math.PI }, { x: 1, y: 1, z: 0.78 });
  addMesh(scene.body, new THREE.TorusGeometry(0.235, 0.018, 10, 40), dressAccent, { x: 0, y: -0.03, z: 0.15 }, { x: Math.PI / 2 });

  // Legs are intentionally simple for MVP; locomotion remains procedural translation.
  for (const x of [-0.12, 0.12]) {
    addMesh(scene.body, new THREE.CylinderGeometry(0.065, 0.055, 0.48, 18), skin, { x, y: -0.52, z: 0 });
    addMesh(scene.body, new THREE.SphereGeometry(0.09, 18, 12), shoe, { x, y: -0.78, z: -0.04 }, null, { x: 0.95, y: 0.55, z: 1.45 });
  }

  // Face and hair, attached to the existing gaze-controlled head pivot.
  addMesh(scene.headPivot, new THREE.SphereGeometry(0.225, 32, 24), skin, { x: 0, y: 0, z: 0 }, null, { x: 0.9, y: 1.05, z: 0.84 });
  addMesh(scene.headPivot, new THREE.SphereGeometry(0.238, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.58), hair, { x: 0, y: 0.03, z: 0.025 }, { x: -0.08 });
  addMesh(scene.headPivot, new THREE.CapsuleGeometry(0.07, 0.36, 6, 14), hair, { x: 0.18, y: -0.17, z: 0.08 }, { z: -0.14 });
  addMesh(scene.headPivot, new THREE.CapsuleGeometry(0.07, 0.36, 6, 14), hair, { x: -0.18, y: -0.17, z: 0.08 }, { z: 0.14 });
  for (const x of [-0.07, 0.07]) {
    addMesh(scene.headPivot, new THREE.SphereGeometry(0.018, 14, 10), eye, { x, y: 0.025, z: -0.205 });
  }
  addMesh(scene.headPivot, new THREE.BoxGeometry(0.065, 0.009, 0.012), mat(0xa65f62, 0.62, 0.0), { x: 0, y: -0.067, z: -0.216 });

  function skinArm(arm) {
    addMesh(arm.root, new THREE.CylinderGeometry(0.047, 0.06, 0.42, 18), dress, { x: 0, y: -0.21, z: 0 });
    addMesh(arm.root, new THREE.SphereGeometry(0.065, 16, 12), skin, { x: 0, y: -0.45, z: 0 });
  }
  skinArm(scene.leftArm);
  skinArm(scene.rightArm);

  scene.avatar.userData.actorStyle = 'cinematic_female_mvp';
}

function viewerPosition(scene) {
  if (typeof scene.getViewerWorldPosition === 'function') return scene.getViewerWorldPosition();
  return scene.camera.getWorldPosition(new THREE.Vector3());
}

function tween(duration, update) {
  const started = performance.now();
  return new Promise((resolve) => {
    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const s = t * t * (3 - 2 * t);
      update(s);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

async function approachUser(args = {}) {
  const scene = state.scene;
  const desiredGap = clamp(args.gap ?? args.distanceFromUser ?? 1.55, 0.9, 2.6);
  const start = scene.avatar.position.clone();
  const target = viewerPosition(scene).clone();
  target.y = start.y;
  const vector = target.sub(start);
  const current = vector.length();
  if (current <= desiredGap + 0.05) return { ok: true, action: 'approach_user', moved: 0 };
  const move = Math.min(clamp(args.maxMove ?? 1.8, 0.2, 2.5), current - desiredGap);
  const end = start.clone().add(vector.normalize().multiplyScalar(move));
  scene.setState?.('moving');
  await tween(Math.max(650, move * 700), (t) => scene.avatar.position.lerpVectors(start, end, t));
  scene.setState?.('idle');
  return { ok: true, action: 'approach_user', moved: Number(move.toFixed(2)) };
}

async function sitActor() {
  const scene = state.scene;
  const home = state.bodyHomeY ?? scene.body.position.y;
  if (state.seated) return { ok: true, action: 'sit' };
  const start = scene.body.position.y;
  const end = home - 0.28;
  scene.setState?.('acting');
  await tween(700, (t) => { scene.body.position.y = THREE.MathUtils.lerp(start, end, t); });
  state.seated = true;
  scene.setState?.('idle');
  return { ok: true, action: 'sit' };
}

async function standActor() {
  const scene = state.scene;
  const home = state.bodyHomeY ?? 0.87;
  const start = scene.body.position.y;
  scene.setState?.('acting');
  await tween(650, (t) => { scene.body.position.y = THREE.MathUtils.lerp(start, home, t); });
  state.seated = false;
  scene.setState?.('idle');
  return { ok: true, action: 'stand' };
}

async function pickUp(args = {}) {
  const scene = state.scene;
  const targetId = args.targetId || 'actor_glass';
  const target = scene.targets.get(targetId);
  if (!target?.mesh) return { ok: false, error: 'unknown_target', targetId };

  const hand = scene.rightArm?.hand || scene.rightArm?.root;
  if (!hand) return { ok: false, error: 'right_hand_missing', targetId };

  scene.lookTarget = targetId;
  scene.pointTarget = targetId;
  scene.setState?.('acting');
  await sleep(500);

  const mesh = target.mesh;
  const worldStart = mesh.getWorldPosition(new THREE.Vector3());
  scene.scene.attach(mesh);
  mesh.position.copy(worldStart);
  const worldEnd = hand.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.08, -0.05));
  await tween(650, (t) => mesh.position.lerpVectors(worldStart, worldEnd, t));
  hand.attach(mesh);
  mesh.position.set(0, -0.1, -0.03);
  state.heldObject = targetId;
  target.position = mesh.getWorldPosition(new THREE.Vector3());
  scene.pointTarget = null;
  scene.setState?.('idle');
  return { ok: true, action: 'pick_up', targetId };
}

async function speakLine(text) {
  const value = String(text || '').trim();
  if (!value) return { ok: true, action: 'speak', skipped: true };
  state.scene.setState?.('speaking');
  const log = document.getElementById('actor-director-log');
  if (log) log.textContent = `ACTOR: ${value}`;
  if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const utterance = new SpeechSynthesisUtterance(value);
      utterance.lang = /[А-Яа-яЁё]/.test(value) ? 'ru-RU' : (navigator.language || 'en-US');
      utterance.rate = 0.94;
      utterance.pitch = 1.02;
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      setTimeout(finish, Math.min(9000, 1200 + value.length * 55));
    });
  } else {
    await sleep(Math.min(3600, 700 + value.length * 35));
  }
  state.scene.setState?.('idle');
  return { ok: true, action: 'speak', text: value };
}

async function executeAction(action) {
  const name = String(action?.name || '').trim();
  const args = action?.args && typeof action.args === 'object' ? action.args : {};

  if (name === 'speak') return speakLine(args.text || action.text || '');
  if (name === 'approach_user') return approachUser(args);
  if (name === 'sit') return sitActor();
  if (name === 'stand') return standActor();
  if (name === 'pick_up') return pickUp(args);
  if (name === 'pause') {
    await sleep(clamp(args.ms ?? 500, 80, 4000));
    return { ok: true, action: 'pause' };
  }
  // Scene/embodiment actions go through the single Nova dispatcher so the
  // director cannot replay the same tool in parallel with chat/demo handlers.
  if (SCENE_ACTIONS.has(name) || EMBODIMENT_ACTIONS.has(name)) {
    if (typeof window.__NovaApp?.executeAction === 'function') {
      return window.__NovaApp.executeAction({ name, args });
    }
    if (SCENE_ACTIONS.has(name)) return state.scene.executeTool(name, args);
    return state.embodiment.execute({ name, args });
  }
  return { ok: false, error: 'actor_action_not_allowed', action: name };
}

async function compileWithAI(script) {
  const endpoint = window.__NOVA_AI_ENDPOINT;
  if (!endpoint) throw new Error('AI endpoint is not configured');

  const directorInstruction = [
    'CINEMATIC ACTOR DIRECTOR TEST.',
    'Translate the following scene script into embodied actions for the 3D actress.',
    'Use only existing Nova scene/embodiment actions when possible: face_user, look_at, point_at, wave, raise_hand, lower_hand, step, turn_body, neutral_pose.',
    'Keep the performance concise and physical. Do not explain the task; return the normal Nova action response.',
    'Useful scene targets: actor_window, actor_table, actor_chair, actor_glass.',
    `SCRIPT: ${script}`,
  ].join('\n');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      message: directorInstruction,
      history: [],
      scene: state.scene.getSceneContext?.() || {},
      toolResults: [],
      phase: 'initial',
      locale: navigator.language || 'en-US',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `AI HTTP ${response.status}`);

  const actions = normalizeAiActions(data);
  if (!actions.length) throw new Error('AI returned no actor actions');
  return { actions, text: String(data.text || '').trim(), source: 'ai' };
}

async function compileScript(script, preferAI = true) {
  if (preferAI) {
    try {
      const ai = await compileWithAI(script);
      return { ...ai, actions: mergeSemanticActions(script, ai.actions) };
    } catch (error) {
      console.warn('AI actor compilation failed, using deterministic fallback:', error);
    }
  }
  return { actions: fallbackPlan(script), text: '', source: 'fallback' };
}

async function performScript(script, options = {}) {
  if (state.running) throw new Error('Actor is already performing a script');
  await waitForRuntime();
  state.running = true;
  const log = document.getElementById('actor-director-log');
  const list = document.getElementById('actor-action-list');
  try {
    const compiled = await compileScript(script, options.preferAI !== false);
    if (log) log.textContent = `Director: ${compiled.source === 'ai' ? 'AI plan' : 'local fallback'} · ${compiled.actions.length} actions`;
    if (list) list.textContent = compiled.actions.map(actionLabel).join('  ›  ');

    const results = [];
    for (let index = 0; index < compiled.actions.length; index += 1) {
      const action = compiled.actions[index];
      if (log) log.textContent = `${compiled.source === 'ai' ? 'AI' : 'Fallback'} director · ${index + 1}/${compiled.actions.length}: ${actionLabel(action)}`;
      const result = await executeAction(action);
      results.push({ action, result });
      await sleep(110);
    }
    if (log) log.textContent = `Scene complete · ${compiled.actions.length} actions · ${compiled.source}`;
    state.lastRun = { ok: true, ...compiled, results };
    return state.lastRun;
  } finally {
    state.running = false;
  }
}

async function runScript(script, options = {}) {
  const run = () => performScript(script, options);
  if (typeof window.__NovaApp?.queue === 'function') return window.__NovaApp.queue(run);
  return run();
}

function injectStyles() {
  if (document.getElementById('actor-director-styles')) return;
  const style = document.createElement('style');
  style.id = 'actor-director-styles';
  style.textContent = `
    .actor-director-panel { position: fixed; left: 18px; bottom: 18px; z-index: 16; width: min(520px, calc(100vw - 36px)); padding: 14px; border: 1px solid rgba(255,255,255,.16); border-radius: 16px; background: rgba(7,11,18,.84); backdrop-filter: blur(18px); box-shadow: 0 18px 50px rgba(0,0,0,.32); color: #eef5ff; font: 13px/1.35 system-ui, sans-serif; }
    .actor-director-panel .actor-title { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:9px; font-weight:700; letter-spacing:.04em; }
    .actor-director-panel textarea { width:100%; min-height:86px; resize:vertical; box-sizing:border-box; border-radius:11px; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.24); color:#fff; padding:10px; font:inherit; }
    .actor-director-panel .actor-buttons { display:flex; gap:8px; flex-wrap:wrap; margin-top:9px; }
    .actor-director-panel button { border:1px solid rgba(255,255,255,.16); border-radius:10px; padding:8px 11px; background:rgba(255,255,255,.08); color:#fff; cursor:pointer; }
    .actor-director-panel button.primary { background:rgba(70,145,255,.28); }
    #actor-director-log { margin-top:8px; color:#b9d5ff; }
    #actor-action-list { margin-top:5px; color:#8f9bad; max-height:42px; overflow:auto; font-size:11px; }
    .stereo-vr-overlay { position:fixed; inset:0; z-index:40; background:#000; display:grid; grid-template-rows:1fr auto; }
    .stereo-vr-overlay canvas { width:100%; height:100%; min-height:0; }
    .stereo-vr-hud { position:absolute; left:0; right:0; top:0; display:flex; justify-content:space-between; padding:12px 18px; pointer-events:none; color:#fff; font:600 12px/1 system-ui; text-shadow:0 1px 5px #000; }
    .stereo-vr-bar { display:flex; gap:12px; align-items:center; justify-content:center; padding:10px; background:#0b0d10; color:#bfc8d5; font:12px system-ui; }
    .stereo-vr-bar button { border:1px solid #4a5565; border-radius:9px; background:#1a2029; color:#fff; padding:7px 11px; cursor:pointer; }
    @media (max-width: 760px) { .actor-director-panel { bottom:10px; left:10px; width:calc(100vw - 20px); } }
  `;
  document.head.appendChild(style);
}

function stopStereoPreview() {
  const preview = state.stereo;
  if (!preview) return;
  cancelAnimationFrame(preview.raf);
  preview.renderer.dispose();
  preview.root.remove();
  state.stereo = null;
}

function startStereoPreview() {
  if (state.stereo || !state.scene) return;
  const root = document.createElement('div');
  root.className = 'stereo-vr-overlay';
  root.innerHTML = `
    <div style="position:relative;min-height:0"><canvas></canvas><div class="stereo-vr-hud"><span>LEFT EYE</span><span>RIGHT EYE</span></div></div>
    <div class="stereo-vr-bar"><span>64 mm stereo baseline · two-eye preview</span><button type="button">Close preview</button></div>
  `;
  document.body.appendChild(root);
  const canvas = root.querySelector('canvas');
  const close = root.querySelector('button');
  close.addEventListener('click', stopStereoPreview);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = state.scene.renderer?.toneMappingExposure ?? 1.15;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const stereo = new THREE.StereoCamera();
  stereo.eyeSep = 0.064;
  const renderCamera = state.scene.camera.clone();

  const draw = () => {
    const width = Math.max(2, canvas.clientWidth);
    const height = Math.max(2, canvas.clientHeight);
    const pixelRatio = renderer.getPixelRatio();
    const needResize = canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio);
    if (needResize) renderer.setSize(width, height, false);

    state.scene.camera.updateMatrixWorld(true);
    renderCamera.position.copy(state.scene.camera.position);
    renderCamera.quaternion.copy(state.scene.camera.quaternion);
    renderCamera.near = state.scene.camera.near;
    renderCamera.far = state.scene.camera.far;
    renderCamera.fov = Math.max(70, state.scene.camera.fov || 70);
    renderCamera.aspect = (width * 0.5) / height;
    renderCamera.updateProjectionMatrix();
    renderCamera.updateMatrixWorld(true);
    stereo.update(renderCamera);

    const half = width * 0.5;
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, half, height);
    renderer.setScissor(0, 0, half, height);
    renderer.render(state.scene.scene, stereo.cameraL);
    renderer.setViewport(half, 0, half, height);
    renderer.setScissor(half, 0, half, height);
    renderer.render(state.scene.scene, stereo.cameraR);
    renderer.setScissorTest(false);
    state.stereo.raf = requestAnimationFrame(draw);
  };

  state.stereo = { root, renderer, stereo, renderCamera, raf: requestAnimationFrame(draw) };
}

function buildUi() {
  if (document.getElementById('actor-director-panel')) return;
  injectStyles();
  const panel = document.createElement('section');
  panel.id = 'actor-director-panel';
  panel.className = 'actor-director-panel';
  panel.innerHTML = `
    <div class="actor-title"><span>AI ACTOR · CINEMATIC VR TEST</span><span style="opacity:.55">MVP</span></div>
    <textarea id="actor-script">${DEFAULT_ACTOR_SCRIPT}</textarea>
    <div class="actor-buttons">
      <button id="actor-run-ai" class="primary" type="button">AI → Act</button>
      <button id="actor-run-local" type="button">Run fallback</button>
      <button id="actor-stereo" type="button">Two-eye preview</button>
    </div>
    <div id="actor-director-log">Director ready</div>
    <div id="actor-action-list"></div>
  `;
  document.body.appendChild(panel);

  const script = panel.querySelector('#actor-script');
  panel.querySelector('#actor-run-ai').addEventListener('click', async () => {
    try { await runScript(script.value, { preferAI: true }); }
    catch (error) { panel.querySelector('#actor-director-log').textContent = `Error: ${error?.message || error}`; }
  });
  panel.querySelector('#actor-run-local').addEventListener('click', async () => {
    try { await runScript(script.value, { preferAI: false }); }
    catch (error) { panel.querySelector('#actor-director-log').textContent = `Error: ${error?.message || error}`; }
  });
  panel.querySelector('#actor-stereo').addEventListener('click', () => startStereoPreview());
}

async function init() {
  try {
    const { scene } = await waitForRuntime();
    installCinematicStage(scene);
    installFemaleActorSkin(scene);
    buildUi();
    window.__novaActorDirectorReady = true;
  } catch (error) {
    console.error('AI Actor Director failed to initialize:', error);
  }
}

window.__novaActorDirector = {
  runScript,
  compileScript,
  startStereoPreview,
  stopStereoPreview,
  get ready() { return Boolean(window.__novaActorDirectorReady); },
  get running() { return state.running; },
  get lastRun() { return state.lastRun; },
};

void init();
