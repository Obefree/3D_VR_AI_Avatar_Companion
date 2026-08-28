import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const ACTOR_SOURCES = [
  'https://three.ws/avatars/michelle.glb',
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r185/examples/models/gltf/Michelle.glb',
];
const MOTION_SOURCE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r185/examples/models/gltf/Soldier.glb';
const TARGET_HEIGHT = 1.72;

const state = {
  scene: null,
  root: null,
  mixer: null,
  actions: new Map(),
  activeAction: null,
  targetSkin: null,
  bones: {},
  morphMeshes: [],
  lastAvatarPosition: new THREE.Vector3(),
  lastTime: performance.now(),
  ready: false,
  failed: false,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForScene(timeoutMs = 12000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (window.__novaScene?.scene && window.__novaScene?.avatar) return window.__novaScene;
    await sleep(80);
  }
  throw new Error('Nova scene did not become ready');
}

function loadGLTF(url) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, resolve, undefined, reject);
  });
}

async function loadFirst(urls) {
  let lastError;
  for (const url of urls) {
    try { return await loadGLTF(url); }
    catch (error) { lastError = error; console.warn('Humanoid source failed:', url, error); }
  }
  throw lastError || new Error('No humanoid source loaded');
}

function findSkinnedMesh(object) {
  let found = null;
  object.traverse((node) => {
    if (!found && node.isSkinnedMesh && node.skeleton) found = node;
  });
  return found;
}

function findBones(object) {
  const result = {};
  object.traverse((node) => {
    if (!node.isBone) return;
    const name = node.name || '';
    result[name] = node;
  });
  return result;
}

function findBoneBySuffix(bones, names) {
  const values = Object.values(bones);
  for (const candidate of names) {
    const exact = bones[candidate];
    if (exact) return exact;
    const lower = candidate.toLowerCase();
    const match = values.find((bone) => String(bone.name).toLowerCase().endsWith(lower));
    if (match) return match;
  }
  return null;
}

function normalizeActor(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0.001) return;
  const scale = TARGET_HEIGHT / size.y;
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(root);
  root.position.y -= scaledBox.min.y;
  root.updateMatrixWorld(true);
}

function prepareMaterials(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      if ('envMapIntensity' in material) material.envMapIntensity = 0.65;
      if ('roughness' in material) material.roughness = Math.max(0.32, material.roughness ?? 0.55);
    }
    if (node.morphTargetDictionary && node.morphTargetInfluences) state.morphMeshes.push(node);
  });
}

function buildRetargetNames(targetSkin, sourceSkin) {
  const sourceNames = new Set(sourceSkin.skeleton.bones.map((bone) => bone.name));
  const names = {};
  for (const bone of targetSkin.skeleton.bones) {
    if (sourceNames.has(bone.name)) names[bone.name] = bone.name;
  }
  return names;
}

function buildActions(targetSkin, sourceSkin, clips) {
  const names = buildRetargetNames(targetSkin, sourceSkin);
  const retargetOptions = {
    hip: names.mixamorigHips ? 'mixamorigHips' : (targetSkin.skeleton.bones.find((b) => /hips/i.test(b.name))?.name || 'mixamorigHips'),
    names,
    preserveBonePositions: true,
    hipInfluence: new THREE.Vector3(0, 1, 0),
    useFirstFramePosition: false,
  };

  state.mixer = new THREE.AnimationMixer(targetSkin);
  const preferred = new Set(['Idle', 'Walk', 'Run']);
  for (const clip of clips) {
    if (!preferred.has(clip.name)) continue;
    try {
      const retargeted = SkeletonUtils.retargetClip(targetSkin, sourceSkin.skeleton, clip, retargetOptions);
      retargeted.name = clip.name;
      const action = state.mixer.clipAction(retargeted);
      action.enabled = true;
      action.setLoop(THREE.LoopRepeat, Infinity);
      state.actions.set(clip.name, action);
    } catch (error) {
      console.warn(`Retarget ${clip.name} failed:`, error);
    }
  }
}

function play(name, fade = 0.22) {
  const next = state.actions.get(name) || state.actions.get('Idle');
  if (!next || state.activeAction === next) return;
  next.reset().fadeIn(fade).play();
  if (state.activeAction) state.activeAction.fadeOut(fade);
  state.activeAction = next;
}

function bindBones(root) {
  const all = findBones(root);
  state.bones = {
    head: findBoneBySuffix(all, ['mixamorigHead', 'Head']),
    neck: findBoneBySuffix(all, ['mixamorigNeck', 'Neck']),
    leftArm: findBoneBySuffix(all, ['mixamorigLeftArm', 'LeftUpperArm']),
    rightArm: findBoneBySuffix(all, ['mixamorigRightArm', 'RightUpperArm']),
    leftForeArm: findBoneBySuffix(all, ['mixamorigLeftForeArm', 'LeftLowerArm']),
    rightForeArm: findBoneBySuffix(all, ['mixamorigRightForeArm', 'RightLowerArm']),
    leftUpLeg: findBoneBySuffix(all, ['mixamorigLeftUpLeg', 'LeftUpperLeg']),
    rightUpLeg: findBoneBySuffix(all, ['mixamorigRightUpLeg', 'RightUpperLeg']),
  };
}

function overlayProceduralRig() {
  const scene = state.scene;
  if (!scene || !state.ready) return;

  // The hidden original rig still computes gaze/point/wave. Reuse that motion as an overlay
  // on top of the retargeted skeletal locomotion so existing AI tools stay compatible.
  const blendBone = (bone, q, amount) => {
    if (!bone || !q) return;
    const target = bone.quaternion.clone().multiply(q);
    bone.quaternion.slerp(target, amount);
  };

  const pose = window.__novaEmbodiment?.getPose?.() || {};
  const leftAmount = pose.leftArm && pose.leftArm !== 'down' ? 0.78 : 0.18;
  const rightAmount = (pose.rightArm && pose.rightArm !== 'down') || scene.pointTarget ? 0.78 : 0.18;
  blendBone(state.bones.leftArm, scene.leftArm?.root?.quaternion, leftAmount);
  blendBone(state.bones.rightArm, scene.rightArm?.root?.quaternion, rightAmount);

  if (state.bones.head && scene.headPivot?.quaternion) {
    const target = state.bones.head.quaternion.clone().multiply(scene.headPivot.quaternion);
    state.bones.head.quaternion.slerp(target, 0.42);
  }
}

function animateFace(time) {
  const speaking = state.scene?.avatarState === 'speaking';
  if (!state.morphMeshes.length) {
    if (speaking && state.bones.head) state.bones.head.rotation.z += Math.sin(time * 0.006) * 0.0035;
    return;
  }
  for (const mesh of state.morphMeshes) {
    const dict = mesh.morphTargetDictionary || {};
    const influences = mesh.morphTargetInfluences || [];
    const candidates = Object.entries(dict).filter(([name]) => /mouth|jaw|aa|oh|viseme/i.test(name));
    for (const [, index] of candidates.slice(0, 2)) {
      influences[index] = speaking ? 0.12 + Math.abs(Math.sin(time * 0.021)) * 0.34 : THREE.MathUtils.lerp(influences[index] || 0, 0, 0.22);
    }
  }
}

function chooseLocomotion(deltaSeconds) {
  const current = state.scene.avatar.position;
  const distance = current.distanceTo(state.lastAvatarPosition);
  const speed = deltaSeconds > 0 ? distance / deltaSeconds : 0;
  state.lastAvatarPosition.copy(current);
  if (speed > 2.4) return 'Run';
  if (speed > 0.09 || state.scene.avatarState === 'moving') return 'Walk';
  return 'Idle';
}

function loop(time) {
  if (!state.ready || !state.scene) return requestAnimationFrame(loop);
  const delta = Math.min(0.05, Math.max(0.001, (time - state.lastTime) / 1000));
  state.lastTime = time;
  play(chooseLocomotion(delta));
  state.mixer?.update(delta);
  overlayProceduralRig();
  animateFace(time);
  requestAnimationFrame(loop);
}

function updateUi(text, ok = true) {
  let badge = document.getElementById('humanoid-actor-status');
  const panel = document.getElementById('actor-director-panel');
  if (!panel) return;
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'humanoid-actor-status';
    badge.style.cssText = 'margin-top:6px;font:11px system-ui;color:#98a7ba';
    panel.appendChild(badge);
  }
  badge.textContent = text;
  badge.style.color = ok ? '#9ad8b8' : '#ffb3b3';
}

async function init() {
  try {
    state.scene = await waitForScene();
    updateUi('Humanoid: loading rig…');
    const [actorGltf, motionGltf] = await Promise.all([
      loadFirst(ACTOR_SOURCES),
      loadGLTF(MOTION_SOURCE),
    ]);

    const root = actorGltf.scene;
    const targetSkin = findSkinnedMesh(root);
    const sourceSkin = findSkinnedMesh(motionGltf.scene);
    if (!targetSkin || !sourceSkin) throw new Error('Compatible humanoid skeleton not found');

    root.name = 'cinematic_humanoid_actor';
    prepareMaterials(root);
    normalizeActor(root);
    bindBones(root);
    buildActions(targetSkin, sourceSkin, motionGltf.animations || []);
    if (!state.actions.size) throw new Error('No locomotion clips were retargeted');

    state.root = root;
    state.targetSkin = targetSkin;
    state.scene.avatar.add(root);
    state.scene.body.visible = false;
    state.lastAvatarPosition.copy(state.scene.avatar.position);
    state.lastTime = performance.now();
    state.ready = true;
    play('Idle', 0);
    updateUi('Humanoid: rigged actor ready · Idle / Walk / Run + AI gesture overlay');
    window.__novaHumanoidActorReady = true;
    window.__novaHumanoidActor = {
      root,
      mixer: state.mixer,
      actions: state.actions,
      get ready() { return state.ready; },
      play,
    };
    requestAnimationFrame(loop);
  } catch (error) {
    state.failed = true;
    console.error('Humanoid actor failed; procedural actor remains available:', error);
    updateUi(`Humanoid fallback: ${error?.message || error}`, false);
  }
}

void init();
