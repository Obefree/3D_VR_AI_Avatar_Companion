/**
 * TV Stage — thin product entry.
 * Scenario room + humanoid actions + WASD VR view + session record by button only.
 * Does not load cinematic-director.
 */
import * as THREE from 'three';
import { SpatialScene } from './scene.js';
import { tvDemoPack, TV_DEMO_CHARACTER } from '../scenario/packs/tv-demo.mjs';
import { littlePrinceDefaultPack } from '../scenario/packs/little-prince.mjs';
import { actorPromptPayload, normalizeActorSheet } from '../scenario/actor-sheet.mjs';
import { attachPrinceVisit, princeCurrentRole } from './prince-visit.js';

const SCENE_ACTIONS = new Set(['look_at', 'point_at', 'face_user', 'highlight']);
const DEAD = /^(готово|ready|ok|done)\b/i;
const PROMPT_LEAK = /WANT:|MISSION:|ARC \/|WORRIES:|MEMORY:|NEVER:|ONLY JSON|face_user|Props:|Spectator spoke|SCENE BEAT|FACTS:|Return ONLY|do":|extendedActions|system prompt|как ИИ|as an AI|не ассистент|не пересказывать|не держать светск|не читать ТЗ|не говорить\s*«?Готово|роль:\s|миссия:\s|хочет:\s|беспокоится:|Хочет:|Миссия:|Подтекст:/i;
const PACK_KEY = 'nova-scenario-pack';
const PLANET_ROLES = [
  { id: 'rose_on_home', name: 'Роза', max: 2.4 },
  { id: 'planet_fox', name: 'Лис', max: 3.4 },
  { id: 'planet_king', name: 'Король', max: 3.2 },
  { id: 'planet_desert', name: 'Лётчик', max: 3.5 },
  { id: 'planet_lamp', name: 'Фонарщик', max: 3.1 },
  { id: 'planet_home', name: 'Принц', max: 3.8 },
];

function isPrinceVisitor() {
  const params = new URLSearchParams(window.location.search || '');
  if (params.get('product') === 'prince') return true;
  const path = String(window.location.pathname || '');
  return /prince\.html$/i.test(path);
}

const state = {
  scene: null,
  character: TV_DEMO_CHARACTER,
  world: null,
  packId: 'tv-demo',
  pack: null,
  running: false,
  playGen: 0,
  held: null,
  chairMode: false,
  sessionOn: false,
  sessionLog: [],
  sessionStartedAt: 0,
  voiceTracks: [],
  screenRec: null,
  living: false,
  talk: [],
  facts: [],
  lastBeats: [],
  pendingHero: '',
  resumeTimer: 0,
  liveTimer: 0,
  aiAbort: null,
  keepAliveTimer: 0,
  scenarioBeat: 0,
  lastHeroAt: 0,
  scenarioSource: '',
  voiceBus: null,
  ttsAudio: null,
  ttsAbort: null,
  ttsSource: null,
  micStream: null,
  micTap: null,
  listening: false,
  recognition: null,
  micWanted: false,
  micPaused: false,
  warming: false,
  greetedRole: '',
  lastSpoken: '',
  lastHeard: '',
  echoUntil: 0,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function setLog(text) {
  const el = document.getElementById('stage-log');
  if (el) el.textContent = String(text || '');
}

function foldSpeech(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isSelfEcho(line) {
  const a = foldSpeech(line);
  if (!a || a.length < 2) return true;
  if (/я тебя слышу|скажи еще раз|скажи ещё раз/.test(a)) return true;
  const spoken = foldSpeech(state.lastSpoken);
  if (spoken && spoken.length >= 6) {
    if (a === spoken || a.includes(spoken)) return true;
    if (a.length >= spoken.length * 0.75 && spoken.includes(a)) return true;
  }
  const heard = foldSpeech(state.lastHeard);
  if (heard && a === heard && Date.now() - state.lastHeroAt < 1600) return true;
  return false;
}

function foldCard(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isDeadSlogan(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (DEAD.test(value)) return true;
  if (PROMPT_LEAK.test(value)) return true;
  if (/^[{\[]/.test(value) || /"text"\s*:/.test(value)) return true;
  const spoken = foldCard(value);
  if (spoken.length >= 12) {
    const ch = state.character || {};
    const cards = [
      ch.want, ch.mission, ch.forbidden, ch.meaning, ch.speechManner,
      ...(ch.worries || []),
    ].map(foldCard).filter((item) => item.length >= 12);
    if (cards.some((item) => spoken === item || (item.length >= 20 && spoken.includes(item.slice(0, 40))))) {
      return true;
    }
  }
  return false;
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

function parseHex(value, fallback) {
  const raw = String(value || '').trim().replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(raw)) return Number.parseInt(raw, 16);
  return fallback;
}

function registerTarget(id, label, item) {
  const mat = Array.isArray(item.material) ? item.material[0] : item.material;
  item.userData.targetId = id;
  state.scene.targets.set(id, {
    id,
    label,
    mesh: item,
    material: mat,
    pickMeshes: [item],
    position: item.getWorldPosition(new THREE.Vector3()),
    originalEmissive: mat?.emissive?.clone?.() ?? new THREE.Color(0),
    originalIntensity: mat?.emissiveIntensity ?? 0,
  });
}

function clearWorld() {
  if (!state.scene) return;
  const stage = state.scene.scene.getObjectByName('nova_cinematic_stage');
  if (stage) {
    stage.traverse((obj) => {
      const id = obj.userData?.targetId;
      if (id) state.scene.targets.delete(id);
    });
    stage.parent?.remove(stage);
  }
  window.__novaEmbodiment?.clearDynamic?.();
  state.held = null;
  state.chairMode = false;
}

function hideLabBits() {
  const group = state.scene?.environmentGroup;
  if (!group?.children) return;
  group.children.forEach((child, index) => {
    if (index > 0) child.visible = false;
  });
}

function placeProp(stage, spec) {
  const id = String(spec.id || spec.label || 'prop').slice(0, 64);
  const label = spec.label || id;
  const color = parseHex(spec.color, 0x6688aa);
  const x = clamp(spec.x ?? 0, -10, 10);
  const z = clamp(spec.z ?? 0, -10, 10);
  const shape = String(spec.shape || 'box');
  if (shape === 'window') {
    const pane = mesh(stage, new THREE.PlaneGeometry(2.2, 1.45), new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.45, roughness: 0.22,
    }), { x, y: spec.y ?? 2.05, z });
    mesh(stage, new THREE.BoxGeometry(2.42, 1.67, 0.07), material(0x161b21, 0.45, 0.28), { x, y: spec.y ?? 2.05, z: z - 0.05 });
    registerTarget(id, label, pane);
    return;
  }
  if (shape === 'planet') {
    const radius = clamp(spec.radius ?? 1.4, 0.6, 3.2);
    const item = mesh(stage, new THREE.SphereGeometry(radius, 28, 20), material(color, 0.82, 0.08), { x, y: radius * 0.15, z });
    item.userData.planetRadius = radius;
    registerTarget(id, label, item);
    return;
  }
  const y = spec.y ?? 0.32;
  let item;
  if (shape === 'cylinder') item = mesh(stage, new THREE.CylinderGeometry(0.28, 0.32, 0.55, 20), material(color, 0.7, 0.06), { x, y, z });
  else if (shape === 'sphere') item = mesh(stage, new THREE.SphereGeometry(0.22, 20, 16), material(color, 0.45, 0.12), { x, y, z });
  else if (shape === 'cone') item = mesh(stage, new THREE.ConeGeometry(0.28, 0.85, 16), material(color, 0.55, 0.08), { x, y: spec.y ?? 0.45, z });
  else if (shape === 'crystal') {
    item = mesh(stage, new THREE.OctahedronGeometry(0.28, 0), material(color, 0.25, 0.35), { x, y: spec.y ?? 0.42, z });
    if (item.material) {
      item.material.emissive = new THREE.Color(color);
      item.material.emissiveIntensity = 0.35;
    }
  }
  else item = mesh(stage, new THREE.BoxGeometry(0.55, 0.85, 0.55), material(color, 0.78, 0.04), { x, y, z });
  registerTarget(id, label, item);
}

function enterWorld(spec) {
  if (!state.scene || !spec) return;
  if (isPrinceVisitor()) {
    clearWorld();
    attachPrinceVisit(state.scene);
    state.world = spec;
    if (state.scene.avatar) state.scene.avatar.visible = false;
    return;
  }
  clearWorld();
  const wall = parseHex(spec.palette?.wall, 0x2a3038);
  const floor = parseHex(spec.palette?.floor, 0x1a1e24);
  const light = parseHex(spec.palette?.light, 0xc8d8e8);
  const planets = spec.mood === 'planets';
  if (state.scene.scene.background?.setHex) state.scene.scene.background.setHex(planets ? 0x04060e : 0x0a0e14);
  if (state.scene.scene.fog?.color) state.scene.scene.fog.color.setHex(planets ? 0x04060e : 0x0a0e14);
  const floorMesh = state.scene.environmentGroup?.children?.[0];
  if (floorMesh?.material?.color) floorMesh.material.color.setHex(floor);
  hideLabBits();

  const stage = new THREE.Group();
  stage.name = 'nova_cinematic_stage';
  state.scene.scene.add(stage);
  if (!planets) {
    const room = 11.2;
    const wallH = 4.8;
    const wallMat = material(wall, 0.94, 0.02);
    mesh(stage, new THREE.PlaneGeometry(room * 2, wallH), wallMat, { x: 0, y: wallH / 2, z: -room });
    mesh(stage, new THREE.PlaneGeometry(room * 2, wallH), wallMat, { x: 0, y: wallH / 2, z: room }, { y: Math.PI });
    mesh(stage, new THREE.PlaneGeometry(room * 2, wallH), wallMat, { x: -room, y: wallH / 2, z: 0 }, { y: Math.PI / 2 });
    mesh(stage, new THREE.PlaneGeometry(room * 2, wallH), wallMat, { x: room, y: wallH / 2, z: 0 }, { y: -Math.PI / 2 });
    mesh(stage, new THREE.BoxGeometry(2.4, 0.45, 1.1), material(0x4a3426, 0.86, 0.04), { x: -1.8, y: 0.32, z: 1.6 });
    mesh(stage, new THREE.BoxGeometry(1.6, 0.08, 1.6), material(0x3a2a22, 0.9, 0), { x: 0.4, y: 0.05, z: 0.2 });
  } else {
    const ground = mesh(stage, new THREE.CircleGeometry(14, 48), material(floor, 0.95, 0), { x: 0, y: 0.01, z: 0 }, { x: -Math.PI / 2 });
    ground.receiveShadow = true;
  }
  for (const item of spec.objects || []) placeProp(stage, item);
  const key = new THREE.PointLight(light, planets ? 36 : 28, planets ? 28 : 18, 2);
  key.position.set(2.7, planets ? 5.2 : 3.2, 2.4);
  stage.add(key);
  const fill = new THREE.PointLight(planets ? 0xffe6a8 : 0x8fc9ff, planets ? 22 : 18, 16, 2);
  fill.position.set(-2.1, planets ? 4.2 : 2.5, -2.8);
  stage.add(fill);
  state.world = spec;
  state.scene.avatarGroundY = 0;
  if (state.scene.avatar) {
    state.scene.avatar.position.set(planets ? 0.4 : -0.6, 0, planets ? 2.2 : -2.4);
    state.scene.avatarHome = state.scene.avatar.position.clone();
  }
}

function faceWalk(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) < 0.02) return;
  state.scene.avatar.rotation.y = Math.atan2(dx, dz);
}

function tween(duration, update) {
  const started = performance.now();
  const gen = state.playGen;
  return new Promise((resolve) => {
    const tick = () => {
      if (gen !== state.playGen) {
        resolve();
        return;
      }
      const now = performance.now();
      const t = Math.min(1, (now - started) / duration);
      const s = t * t * (3 - 2 * t);
      update(s);
      if (t < 1) setTimeout(tick, 16);
      else resolve();
    };
    tick();
  });
}

function interruptActing() {
  state.playGen += 1;
  try { state.aiAbort?.abort?.(); } catch {}
  state.aiAbort = null;
  stopNeuralAudio();
  try { window.speechSynthesis?.cancel?.(); } catch {}
  clearTimeout(state.liveTimer);
  state.running = false;
  try { state.scene?.setState?.('idle'); } catch {}
}

async function walkAvatar(end) {
  const start = state.scene.avatar.position.clone();
  end = end.clone();
  end.y = 0;
  const dist = start.distanceTo(end);
  if (dist < 0.08) return 0;
  faceWalk(start, end);
  state.scene.setState?.('moving');
  window.__novaHumanoid?.play?.('moving');
  await tween(Math.min(9000, Math.max(700, dist * 1100)), (t) => {
    state.scene.avatar.position.lerpVectors(start, end, t);
  });
  if (state.scene.avatarState === 'moving') state.scene.setState?.('idle');
  window.__novaHumanoid?.play?.('idle');
  return dist;
}

function viewerPosition() {
  return state.scene.getViewerWorldPosition?.() || state.scene.camera.getWorldPosition(new THREE.Vector3());
}

async function approachUser(args = {}) {
  const viewer = viewerPosition();
  const gap = clamp(args.distanceFromUser ?? args.gap ?? state.character?.proximity ?? 1.55, 0.85, 2.6);
  const start = state.scene.avatar.position.clone();
  start.y = 0;
  const target = viewer.clone();
  target.y = 0;
  const vector = target.sub(start);
  const distance = vector.length();
  if (distance <= gap + 0.05) return { ok: true, action: 'approach_user', moved: 0 };
  const end = start.clone().add(vector.normalize().multiplyScalar(distance - gap));
  end.y = 0;
  const moved = await walkAvatar(end);
  return { ok: true, action: 'approach_user', moved: Number(moved.toFixed(2)) };
}

async function walkToTarget(args = {}) {
  const targetId = args.targetId;
  const target = state.scene.targets.get(targetId);
  if (!target) return { ok: false, error: 'unknown_target', targetId };
  const targetPos = target.mesh?.getWorldPosition?.(new THREE.Vector3()) || target.position?.clone?.();
  if (!targetPos) return { ok: false, error: 'target_position_missing', targetId };
  const here = state.scene.avatar.position.clone();
  const direction = targetPos.clone().setY(0).sub(here.setY(0));
  const distance = direction.length();
  const stop = clamp(args.stopDistance ?? 0.72, 0.45, 1.4);
  const end = distance > stop ? here.clone().add(direction.normalize().multiplyScalar(distance - stop)) : here.clone();
  end.y = 0;
  await walkAvatar(end);
  return { ok: true, action: 'walk_to', targetId };
}

async function pickUp(args = {}) {
  const targetId = args.targetId || 'actor_glass';
  const target = state.scene.targets.get(targetId);
  if (!target?.mesh) return { ok: false, error: 'pickup_unavailable', targetId };
  state.scene.lookTarget = targetId;
  state.scene.setState?.('acting');
  window.__novaHumanoid?.play?.('interact');
  await sleep(180);
  const object = target.mesh;
  const start = object.getWorldPosition(new THREE.Vector3());
  state.scene.scene.attach(object);
  object.position.copy(start);
  const beside = state.scene.avatar.position.clone().add(new THREE.Vector3(0.35, 0.08, 0.12));
  beside.y = Math.max(0.08, start.y);
  await tween(620, (t) => object.position.lerpVectors(start, beside, t));
  target.position.copy(object.position);
  state.held = targetId;
  state.scene.setState?.('idle');
  return { ok: true, action: 'pick_up', targetId };
}

async function sitActor() {
  const humanoid = state.scene.avatar.getObjectByName('Nova_Humanoid_CC0');
  if (!humanoid || state.chairMode) return { ok: Boolean(humanoid), action: 'sit' };
  const startY = humanoid.position.y;
  state.scene.setState?.('acting');
  await tween(650, (t) => {
    humanoid.position.y = THREE.MathUtils.lerp(startY, startY - 0.28, t);
  });
  state.chairMode = true;
  state.scene.setState?.('idle');
  return { ok: true, action: 'sit' };
}

async function speak(text, args = {}) {
  const value = String(text || '').trim();
  if (!value || isDeadSlogan(value)) {
    return { ok: true, action: 'speak', skipped: true, reason: 'dead_slogan' };
  }
  const who = String(args.character || state.character?.name || 'Actor');
  stopNeuralAudio();
  try { window.speechSynthesis?.cancel?.(); } catch {}
  if (args.addressUser && !state.scene.lookTarget && !state.scene.pointTarget) {
    try {
      state.scene.executeTool?.('face_user', {});
    } catch {}
  }
  window.__novaHumanoid?.play?.('idle');
  state.scene.setState?.('speaking');
  setLog(`${who}: ${value}`);
  try {
    const a = state.scene.avatar.position;
    if (!state.scene.walkMode) {
      state.scene.controls?.target?.set?.(a.x, 1.25, a.z);
      state.scene.camera.position.set(a.x + 0.35, 1.55, a.z + 2.2);
      state.scene.controls?.update?.();
    } else {
      state.scene.controls?.target?.set?.(a.x, 1.2, a.z);
    }
  } catch {}

  let neuralOk = false;
  setMicMix(false);
  pauseMic();
  try {
    neuralOk = await speakNeural(value, { speakers: true });
    if (!neuralOk) setLog(`${who}: ${value} · голос актёра не дошёл`);
  } finally {
    setMicMix(true);
  }

  state.lastSpoken = value;
  state.echoUntil = Date.now() + Math.min(900, 280 + value.length * 12);
  syncVoiceTracks();
  state.scene.setState?.('idle');
  return { ok: true, action: 'speak', text: value, character: who, neural: neuralOk };
}

function getVoiceBus() {
  if (state.voiceBus) return state.voiceBus;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const dest = ctx.createMediaStreamDestination();
  const mix = ctx.createGain();
  const speaker = ctx.createGain();
  mix.connect(dest);
  speaker.connect(ctx.destination);
  state.voiceBus = { ctx, dest, mix, speaker, gain: mix };
  return state.voiceBus;
}

function syncVoiceTracks() {
  const tracks = getVoiceBus()?.dest?.stream?.getAudioTracks?.() || [];
  state.voiceTracks = tracks.filter((t) => t.readyState !== 'ended');
}

function stopNeuralAudio() {
  try { state.ttsAbort?.abort?.(); } catch {}
  state.ttsAbort = null;
  try { state.ttsSource?.stop?.(); } catch {}
  state.ttsSource = null;
  const audio = state.ttsAudio;
  state.ttsAudio = null;
  if (!audio) return;
  try { audio.pause(); } catch {}
  try { audio.src = ''; } catch {}
  if (audio.dataset?.url) URL.revokeObjectURL(audio.dataset.url);
}

function setMicMix(on) {
  const gain = state.micTap?.gain;
  if (!gain) return;
  try {
    const ctx = gain.context;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(on ? 1.15 : 0, ctx.currentTime, 0.02);
  } catch {
    gain.gain.value = on ? 1.15 : 0;
  }
}

async function ensureMicCapture() {
  if (state.micTap?.connected) {
    syncVoiceTracks();
    return true;
  }
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const bus = getVoiceBus();
    if (!bus) {
      for (const track of stream.getTracks()) track.stop();
      return false;
    }
    try { await bus.ctx.resume?.(); } catch {}
    const src = bus.ctx.createMediaStreamSource(stream);
    const gain = bus.ctx.createGain();
    gain.gain.value = 1.15;
    src.connect(gain);
    gain.connect(bus.mix);
    state.micStream = stream;
    state.micTap = { src, gain, connected: true };
    syncVoiceTracks();
    return true;
  } catch (error) {
    console.warn('Mic capture for recording failed:', error);
    return false;
  }
}

function stopMicCapture() {
  try { state.micTap?.src?.disconnect?.(); } catch {}
  try { state.micTap?.gain?.disconnect?.(); } catch {}
  for (const track of state.micStream?.getTracks?.() || []) {
    try { track.stop(); } catch {}
  }
  state.micStream = null;
  state.micTap = null;
}

async function speakNeural(value, { speakers = true } = {}) {
  const endpoint = (window.__NOVA_AI_ENDPOINT || './api/chat').replace(/\/api\/chat\/?$/, '/api/tts');
  const ttsUrl = endpoint.includes('/api/tts') ? endpoint : './api/tts';
  const ctrl = new AbortController();
  state.ttsAbort = ctrl;
  const kill = setTimeout(() => ctrl.abort(), 45000);
  try {
    const response = await fetch(ttsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: value.slice(0, 700),
        locale: /[а-яё]/i.test(value) ? 'ru-RU' : 'en-US',
        voice: /[а-яё]/i.test(value) ? 'ru-RU-SvetlanaNeural' : 'en-US-AvaNeural',
        rate: 1,
      }),
      signal: ctrl.signal,
    });
    if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
    const type = response.headers.get('Content-Type') || '';
    if (!/audio\//i.test(type)) throw new Error('TTS returned non-audio');
    const blob = await response.blob();
    if (!blob.size) throw new Error('Empty TTS');
    if (state.ttsAbort !== ctrl) return false;
    const bus = getVoiceBus();
    if (!bus) return false;
    try { await bus.ctx.resume?.(); } catch {}
    const buffer = await bus.ctx.decodeAudioData(await blob.arrayBuffer());
    if (state.ttsAbort !== ctrl) return false;
    const src = bus.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(bus.mix);
    if (speakers) src.connect(bus.speaker);
    state.ttsSource = src;
    syncVoiceTracks();
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      src.onended = finish;
      try { src.start(); } catch { finish(); }
      setTimeout(finish, Math.min(12000, Math.ceil((buffer.duration || 1) * 1000) + 200));
    });
    if (state.ttsSource === src) state.ttsSource = null;
    return true;
  } catch (error) {
    if (error?.name !== 'AbortError') console.warn('Neural TTS failed:', error);
    return false;
  } finally {
    clearTimeout(kill);
    if (state.ttsAbort === ctrl) state.ttsAbort = null;
  }
}

function toggleVrEyes() {
  if (!state.scene?.setStereoGlasses) {
    setLog('VR-очки: сцена ещё грузится.');
    return;
  }
  if (!state.scene.walkMode) toggleWalk(true);
  const on = state.scene.setStereoGlasses(!state.scene.stereoGlasses);
  const btn = document.getElementById('stage-vr-eyes');
  if (btn) btn.textContent = on ? '■ Очки' : '2 глаза';
  setLog(on
    ? 'Очки: VR180 3D SBS 2:1, 60 мм, как файл для гарнитуры. T — выкл, R — запись 4096×2048.'
    : 'Обычный VR-вид. T — снова очки.');
}

async function settlePose() {
  try {
    if (state.scene) {
      state.scene.pointTarget = null;
      state.scene.lookTarget = null;
      if (state.scene.avatarState !== 'speaking' && state.scene.avatarState !== 'moving') {
        state.scene.setState?.('idle');
      }
    }
    await window.__novaEmbodiment?.execute?.({ name: 'lower_hand', args: { side: 'both' } });
    window.__novaHumanoid?.play?.('idle');
  } catch {}
}

async function execute(action) {
  const name = String(action?.name || '').trim();
  const args = action?.args && typeof action.args === 'object' ? { ...action.args } : {};
  // Skip unused wave on TV Stage.
  if (name === 'wave') {
    await settlePose();
    return { ok: true, action: 'wave', skipped: true };
  }
  window.dispatchEvent(new CustomEvent('nova:cinematic-action', { detail: { name, args } }));
  logSession({ kind: 'action', name, targetId: args.targetId || '' });
  if (name === 'speak') {
    if (isDeadSlogan(args.text)) return { ok: true, skipped: true };
    const result = await speak(args.text, args);
    if (!state.living) await settlePose();
    return result;
  }
  if (name === 'approach_user' || name === 'walk_to') {
    if (state.living) {
      try { state.scene.executeTool?.('face_user', {}); } catch {}
      return { ok: true, action: name, skipped: true, reason: 'stay_in_dialogue' };
    }
  }
  if (name === 'approach_user') {
    const result = await approachUser(args);
    await settlePose();
    return result;
  }
  if (name === 'walk_to') {
    const result = await walkToTarget(args);
    await settlePose();
    return result;
  }
  if (name === 'pick_up') {
    const result = await pickUp(args);
    await settlePose();
    return result;
  }
  if (name === 'sit') return sitActor();
  if (SCENE_ACTIONS.has(name) || name === 'point_at') {
    const target = args.targetId && state.scene.targets.get(args.targetId);
    const pos = target?.mesh?.getWorldPosition?.(new THREE.Vector3()) || target?.position;
    if (pos) faceWalk(state.scene.avatar.position, pos);
    try {
      state.scene.highlight?.(args.targetId, 2.2);
    } catch {}
    const result = await state.scene.executeTool(name, args);
    if (!state.living) {
      if (name === 'point_at') await sleep(700);
      else if (name === 'look_at' || name === 'face_user') await sleep(350);
      await settlePose();
    }
    return result;
  }
  if (window.__novaEmbodiment?.execute) {
    return window.__novaEmbodiment.execute({ name, args });
  }
  return { ok: false, error: 'unknown_action', action: name };
}

async function playPlan(plan) {
  const gen = state.playGen;
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const spoken = actions.filter((item) => item.name === 'speak');
  const body = actions.filter((item) => item.name !== 'speak');
  if (!state.living) await settlePose();
  const speakP = spoken[0] ? execute(spoken[0]) : Promise.resolve();
  const bodyP = (async () => {
    for (let i = 0; i < body.length; i += 1) {
      if (gen !== state.playGen) break;
      await execute(body[i]);
    }
  })();
  await speakP;
  if (gen !== state.playGen) return;
  await bodyP;
  if (gen === state.playGen) await settlePose();
}

function logSession(entry) {
  if (!state.sessionOn) return;
  state.sessionLog.push({ t: Date.now(), ...entry });
}

function downloadSessionJson() {
  const payload = {
    version: 1,
    kind: 'tv-stage-session',
    savedAt: new Date().toISOString(),
    startedAt: state.sessionStartedAt ? new Date(state.sessionStartedAt).toISOString() : null,
    character: state.character?.name || '',
    world: state.world?.title || '',
    log: state.sessionLog,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `nova-tv-session-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function startScreenRec() {
  if (state.screenRec) return true;
  const canvas = state.scene?.renderer?.domElement || document.getElementById('scene');
  if (!canvas?.captureStream) throw new Error('Запись canvas недоступна в этом браузере');
  syncVoiceTracks();
  const voiceTracks = state.voiceTracks.filter((t) => t.readyState !== 'ended');
  const mimeType = chooseMime(voiceTracks.length > 0);
  if (!mimeType) throw new Error('MediaRecorder не поддерживает webm');
  const canvasStream = canvas.captureStream(30);
  const stream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...voiceTracks.map((t) => (t.clone ? t.clone() : t)),
  ]);
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nova-tv-screen-${stamp}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    for (const track of stream.getTracks()) track.stop();
  };
  recorder.start(1000);
  const badge = document.createElement('div');
  badge.id = 'stage-rec-badge';
  badge.textContent = state.micTap?.connected
    ? '● REC экран + актёр + ты'
    : (voiceTracks.length ? '● REC экран + актёр' : '● REC экран (включи микрофон для своего голоса)');
  badge.style.cssText = 'position:fixed;left:16px;top:16px;z-index:80;padding:8px 12px;border-radius:999px;background:rgba(160,30,30,.85);color:#fff;font:12px system-ui;pointer-events:none';
  document.body.appendChild(badge);
  state.screenRec = { recorder, stream, badge };
  return true;
}

function chooseMime(withAudio = false) {
  const list = withAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const type of list) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return '';
}

function stopScreenRec() {
  const active = state.screenRec;
  if (!active) return false;
  state.screenRec = null;
  try { active.recorder.stop(); } catch {}
  active.badge?.remove?.();
  return true;
}

async function toggleSession() {
  const button = document.getElementById('stage-session');
  if (state.sessionOn) {
    state.sessionOn = false;
    logSession({ kind: 'session', text: 'stop' });
    stopScreenRec();
    stopMicCapture();
    try { window.__novaVR180?.stopRecording?.(); } catch {}
    downloadSessionJson();
    if (button) {
      button.textContent = '● Запись';
      button.classList.remove('active');
    }
    setLog(`Запись сохранена (${state.sessionLog.length} событий). VR180 — файл VR180_3D_SBS + json.`);
    return;
  }
  state.sessionOn = true;
  state.sessionLog = [];
  state.sessionStartedAt = Date.now();
  logSession({ kind: 'session', text: 'start', pack: state.packId, role: state.character?.name });
  if (button) {
    button.textContent = '■ Стоп';
    button.classList.add('active');
  }
  try {
    getVoiceBus();
    const micOk = await ensureMicCapture();
    syncVoiceTracks();
    if (state.scene?.walkMode) {
      if (window.__novaVR180?.recording) window.__novaVR180.stopRecording();
      else {
        await window.__novaVR180?.startRecording?.('draft', { baselineKey: 'canon' });
      }
      setLog(micOk
        ? 'Запись VR180 3D SBS: актёр + твой микрофон. JSON-лог рядом.'
        : 'Запись VR180: микрофон не открылся — в файле будет только голос актёра. Разреши доступ.');
    } else {
      startScreenRec();
      setLog(micOk
        ? 'Запись: экран + актёр + твой голос. Для VR-файла: VR вид → 2 глаза.'
        : 'Запись экрана без твоего микрофона (доступ закрыт). Актёр пишется, если скажет реплику.');
    }
  } catch (error) {
    setLog(`JSON-сессия ок; видео: ${error?.message || error}`);
  }
}

function toggleWalk(force) {
  if (!state.scene?.setWalkMode) return;
  const next = typeof force === 'boolean' ? force : !state.scene.walkMode;
  state.scene.setWalkMode(next);
  document.documentElement.classList.toggle('walk-mode', next);
  const button = document.getElementById('stage-walk');
  if (button) button.textContent = next ? 'Выйти из VR' : 'VR вид';
  if (next) {
    document.getElementById('stage-script')?.blur();
    state.scene.canvas?.focus?.({ preventScroll: true });
    setLog('VR: мышь смотреть, WASD идти, T — очки SBS, R — запись, Esc — выход.');
  } else {
    setLog('Обычная камера.');
  }
}

function resetRoleMemory() {
  state.talk = [];
  state.facts = [];
  state.lastBeats = [];
  state.scenarioBeat = 0;
  state.lastHeroAt = 0;
  state.lastSpoken = '';
  state.greetedRole = '';
  state.pendingHero = '';
  state.held = null;
  state.chairMode = false;
  const ch = state.character || {};
  if (ch.emotions) ch.emotions.current = ch.emotions.baseline || ch.emotions.current || 'calm';
  refreshActorCard();
}

function propIds() {
  const fromWorld = (state.world?.objects || []).map((o) => o.id).filter(Boolean);
  const ids = fromWorld.length ? fromWorld : ['actor_window', 'actor_table', 'actor_chair', 'actor_glass'];
  return ids.filter((id) => state.scene?.targets?.has?.(id));
}

function sheetFromPackCharacter(raw, world) {
  const base = normalizeActorSheet({
    ...raw,
    mission: raw.mission || raw.want || '',
    worries: raw.worries || [],
    scenario: raw.scenario || {
      title: world?.title || '',
      source: state.scenarioSource || '',
      beats: raw.goals || [],
    },
  }, world || {});
  return base;
}

function readWorkshopPack() {
  try {
    const raw = localStorage.getItem(PACK_KEY);
    if (!raw) return null;
    const pack = JSON.parse(raw);
    if (!Array.isArray(pack?.characters) || !pack.characters.length) return null;
    return {
      version: 1,
      title: pack.world?.title || pack.title || 'Мой сценарий',
      source: pack.source || '',
      characters: pack.characters,
      world: pack.world || null,
    };
  } catch {
    return null;
  }
}

function fillPackSelect() {
  const sel = document.getElementById('stage-pack');
  if (!sel) return;
  const custom = readWorkshopPack();
  let opt = sel.querySelector('option[value="custom"]');
  if (custom) {
    if (!opt) {
      opt = document.createElement('option');
      opt.value = 'custom';
      sel.appendChild(opt);
    }
    opt.textContent = custom.title || 'Мой сценарий';
  } else if (opt) {
    opt.remove();
  }
}

function resolvePack(packId) {
  if (packId === 'custom') {
    const custom = readWorkshopPack();
    if (custom) return { id: 'custom', pack: custom };
  }
  if (packId === 'little-prince') return { id: 'little-prince', pack: littlePrinceDefaultPack() };
  return { id: 'tv-demo', pack: tvDemoPack() };
}

function worldForRole(pack, character) {
  if (isPrinceVisitor() && pack?.world && (pack.world.objects?.length || pack.world.title)) return pack.world;
  if (character?.zone && (character.zone.objects?.length || character.zone.title)) return character.zone;
  if (pack?.world && (pack.world.objects?.length || pack.world.title)) return pack.world;
  return { title: pack?.title || 'Сцена', mood: 'apartment', palette: {}, objects: [] };
}

function parkAvatarOnHome() {
  if (isPrinceVisitor()) return;
  if (!state.character?.homeProp || !state.scene?.avatar) return;
  const home = state.scene.targets.get(state.character.homeProp);
  const pos = home?.mesh?.getWorldPosition?.(new THREE.Vector3()) || home?.position;
  if (!pos) return;
  const r = Number(home?.mesh?.userData?.planetRadius) || 0;
  state.scene.avatar.position.set(pos.x + (r ? r * 0.15 : 0.8), 0, pos.z + (r ? r + 0.9 : 1.2));
  state.scene.avatarHome = state.scene.avatar.position.clone();
}

function inhabitRole(name) {
  if (!state.pack || !name) return;
  const raw = (state.pack.characters || []).find((c) => c.name === name);
  if (!raw) return;
  const same = state.character?.name === name;
  state.character = sheetFromPackCharacter(raw, state.world);
  window.__novaHumanoid?.applyCharacter?.(state.character);
  parkAvatarOnHome();
  if (!same) resetRoleMemory();
  refreshActorCard();
  const who = document.getElementById('prince-who');
  if (who) who.textContent = name;
}

function nearestVisitorRole() {
  if (isPrinceVisitor()) return princeCurrentRole();
  const cam = state.scene?.camera?.position;
  if (!cam) return '';
  let best = '';
  let bestDist = Infinity;
  for (const row of PLANET_ROLES) {
    const target = state.scene.targets.get(row.id);
    const pos = target?.position || target?.mesh?.position;
    if (!pos) continue;
    const dist = Math.hypot(cam.x - pos.x, cam.z - pos.z);
    if (dist <= row.max && dist < bestDist) {
      best = row.name;
      bestDist = dist;
    }
  }
  return best;
}

function watchVisitorProximity() {
  const tick = () => {
    if (isPrinceVisitor() && state.scene && !state.running) {
      const name = nearestVisitorRole();
      const who = document.getElementById('prince-who');
      if (who) who.textContent = name || 'В полёте';
      if (name && name !== state.character?.name) {
        inhabitRole(name);
        setLog(`${name} здесь. Можно говорить.`);
      }
      if (name && state.living && name !== state.greetedRole) {
        state.greetedRole = name;
        void greetVisitor(name);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function greetVisitor(name) {
  if (!state.living || state.running) return;
  setLog(`${name} замечает тебя…`);
  try {
    const actions = await decideBeat({
      mode: 'think',
      notes: 'Путник только что подлетел на кукурузнике. Поздоровайся коротко, из своей жизни, без пересказа книги.',
    });
    const spoken = await playAdaptive(actions);
    if (spoken) setLog(`${state.character?.name}: ${spoken}`);
  } catch (error) {
    setLog(error?.message || String(error));
  }
}

async function ensurePrinceAi() {
  try {
    const response = await fetch('./api/chat?warm=1', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.ok) return data.provider === 'groq-vault-fallback' ? 'vault' : 'local';
  } catch {}
  return 'local';
}

function loadPack(packId, roleName = '') {
  const resolved = resolvePack(packId);
  const { id, pack } = resolved;
  state.packId = id;
  state.pack = pack;
  state.scenarioSource = pack.source || '';
  const names = (pack.characters || []).map((c) => c.name);
  const pick = roleName && names.includes(roleName) ? roleName : names[0];
  const raw = (pack.characters || []).find((c) => c.name === pick) || pack.characters?.[0];
  const world = worldForRole(pack, raw);
  enterWorld(world);
  state.character = sheetFromPackCharacter(raw || TV_DEMO_CHARACTER, world);
  parkAvatarOnHome();
  window.__novaHumanoid?.applyCharacter?.(state.character);
  resetRoleMemory();
  fillPackSelect();
  fillRoleSelect();
  const packSel = document.getElementById('stage-pack');
  if (packSel) packSel.value = id;
  if (!isPrinceVisitor()) {
    setLog(`${pack.title || id}: роль «${state.character.name}». Жми «Диалог» или говори в микрофон.`);
  }
  return state.character;
}

function fillRoleSelect() {
  const sel = document.getElementById('stage-role');
  if (!sel || !state.pack) return;
  const current = state.character?.name || '';
  sel.innerHTML = '';
  for (const ch of state.pack.characters || []) {
    const opt = document.createElement('option');
    opt.value = ch.name;
    opt.textContent = ch.role && ch.role !== ch.name ? `${ch.name} · ${ch.role}` : ch.name;
    if (ch.name === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

function onPackChange() {
  const packId = document.getElementById('stage-pack')?.value || 'tv-demo';
  stopLiving();
  loadPack(packId);
}

function onRoleChange() {
  const name = document.getElementById('stage-role')?.value || '';
  if (!name || !state.pack) return;
  stopLiving();
  loadPack(state.packId, name);
}

function micSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function pauseMic() {
  state.micPaused = true;
  try { state.recognition?.stop?.(); } catch {}
}

function resumeMic() {
  clearTimeout(state.resumeTimer);
  const wait = Math.max(160, state.echoUntil - Date.now());
  state.resumeTimer = setTimeout(() => {
    if (state.running || Date.now() < state.echoUntil) {
      resumeMic();
      return;
    }
    state.micPaused = false;
    if (state.micWanted && !state.listening) attachRecognition();
  }, wait);
}

function stopListening() {
  state.micWanted = false;
  state.listening = false;
  state.micPaused = false;
  try { state.recognition?.stop?.(); } catch {}
}

function attachRecognition() {
  if (!micSupported() || !state.micWanted || state.micPaused) return;
  if (state.listening) return;
  if (Date.now() < state.echoUntil) {
    resumeMic();
    return;
  }
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Rec();
  state.recognition = rec;
  rec.lang = 'ru-RU';
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (event) => {
    let interim = '';
    let finalLine = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const piece = String(event.results[i][0].transcript || '').trim();
      if (event.results[i].isFinal) finalLine += (finalLine ? ' ' : '') + piece;
      else interim += (interim ? ' ' : '') + piece;
    }
    if (interim && !finalLine && !isSelfEcho(interim) && !state.micPaused) setLog(`Слышу: ${interim}`);
    if (!finalLine || isSelfEcho(finalLine)) return;
    if (state.micPaused || state.running) {
      state.pendingHero = finalLine;
      return;
    }
    void heroSaid(finalLine).catch((error) => setLog(error?.message || String(error)));
  };
  rec.onerror = (event) => {
    if (event.error === 'not-allowed') {
      setLog('Микрофон запрещён — разреши доступ в Chrome.');
      stopListening();
      return;
    }
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    setLog(`Микрофон: ${event.error}`);
  };
  rec.onend = () => {
    state.listening = false;
    if (state.micWanted && !state.micPaused) setTimeout(() => attachRecognition(), 160);
  };
  try {
    rec.start();
    state.listening = true;
  } catch (error) {
    state.listening = false;
    setLog(`Микрофон: ${error?.message || error}`);
  }
}

function startListening() {
  if (!micSupported()) {
    setLog('Голос недоступен — нужен Chrome/Edge. Пока пиши в поле ниже.');
    return;
  }
  if (state.micWanted) {
    stopListening();
    setLog('Микрофон выкл.');
    return;
  }
  state.micWanted = true;
  if (!state.living) void startLiving();
  else attachRecognition();
  setLog('Слушаю. Говори — компаньон ответит сам, кнопку жать не нужно.');
}

function characterPayload() {
  return actorPromptPayload(state.character || {});
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function refreshActorCard() {
  const el = document.getElementById('stage-actor-card');
  const who = document.getElementById('stage-who');
  const ch = state.character;
  if (who) who.textContent = ch?.name || '—';
  const princeWho = document.getElementById('prince-who');
  if (princeWho && !isPrinceVisitor()) princeWho.textContent = ch?.name || '—';
  if (!el) return;
  if (!ch) {
    el.textContent = '';
    return;
  }
  const look = ch.appearance || {};
  const want = String(ch.want || ch.mission || '').trim();
  el.innerHTML = `
    <div class="stage-look">
      <span class="stage-swatch" style="background:${escapeHtml(look.hair || '#888')}" title="волосы"></span>
      <span class="stage-swatch" style="background:${escapeHtml(look.clothes || '#666')}" title="одежда"></span>
      <span class="stage-look-name">${escapeHtml(ch.name)}${ch.role && ch.role !== ch.name ? ` · ${escapeHtml(ch.role)}` : ''}</span>
    </div>
    ${look.notes ? `<div class="stage-look-notes">${escapeHtml(look.notes)}</div>` : ''}
    ${want ? `<div class="stage-look-want">${escapeHtml(want)}</div>` : ''}
  `;
}

function advanceScenarioBeat(actions, spoken) {
  const beats = state.character?.scenario?.beats || [];
  if (!beats.length) return;
  const names = (actions || []).map((a) => a.name);
  let next = state.scenarioBeat;
  if (names.includes('face_user') || names.includes('approach_user')) next = Math.max(next, 1);
  if (spoken) next = Math.max(next, 2);
  if (names.includes('point_at')) next = Math.max(next, 3);
  if (names.includes('pick_up')) next = Math.max(next, 4);
  if (names.includes('sit')) next = Math.max(next, 5);
  state.scenarioBeat = Math.min(beats.length - 1, next);
}

function noteFact(text) {
  const value = String(text || '').trim();
  if (!value) return;
  if (state.facts.includes(value)) return;
  state.facts.push(value);
  while (state.facts.length > 14) state.facts.shift();
  logSession({ kind: 'fact', text: value });
}

function absorbBeat(actions, spoken) {
  for (const action of actions || []) {
    const name = action.name;
    const target = action.args?.targetId || '';
    if (name === 'look_at' && target) noteFact(`смотрела на ${target}`);
    if (name === 'point_at' && target) noteFact(`указала на ${target}`);
    if (name === 'walk_to' && target) noteFact(`подошла к ${target}`);
    if (name === 'approach_user') noteFact('подошла к зрителю');
    if (name === 'pick_up' && target) noteFact(`взяла ${target}`);
    if (name === 'sit') noteFact('села');
  }
  if (spoken) {
    state.talk.push({ role: 'assistant', content: spoken.slice(0, 280) });
    while (state.talk.length > 12) state.talk.shift();
    noteFact(`сказала: ${spoken.slice(0, 80)}`);
  }
  state.lastBeats = (actions || []).map((a) => a.name).slice(0, 6);
  advanceScenarioBeat(actions, spoken);
  refreshActorCard();
}

function normalizePlan(data, { reply = false } = {}) {
  const actions = [];
  for (const item of [...(data.actions || []), ...(data.extendedActions || [])]) {
    if (!item?.name || item.name === 'wave') continue;
    if (item.name === 'speak' && isDeadSlogan(item.args?.text || data.text)) continue;
    const next = { name: item.name, args: item.args && typeof item.args === 'object' ? { ...item.args } : {} };
    if (['look_at', 'point_at', 'walk_to', 'pick_up'].includes(next.name)) {
      const id = String(next.args.targetId || next.args.target || '').trim();
      next.args.targetId = propIds().includes(id) ? id : (propIds()[0] || '');
      if (!next.args.targetId) continue;
    }
    if (state.living && (next.name === 'walk_to' || next.name === 'approach_user')) {
      next.name = next.name === 'approach_user' ? 'face_user' : 'look_at';
    }
    if (reply && next.name === 'walk_to') next.name = 'look_at';
    if (reply && next.name === 'approach_user') next.name = 'face_user';
    if (next.name === 'speak') {
      next.args.character = state.character?.name || next.args.character;
      next.args.addressUser = true;
    }
    if (!actions.some((a) => a.name === next.name && a.args?.targetId === next.args?.targetId)) actions.push(next);
  }
  const line = String(data.text || '').trim();
  if (line && !isDeadSlogan(line) && !actions.some((a) => a.name === 'speak')) {
    actions.push({ name: 'speak', args: { text: line, character: state.character?.name, addressUser: true } });
  }
  let body = actions.filter((a) => a.name !== 'speak').slice(0, reply ? 1 : 2);
  if (!body.length) body = [{ name: 'face_user', args: {} }];
  const speakAct = actions.find((a) => a.name === 'speak');
  if (speakAct) {
    const spatial = body.some((a) => a.name === 'look_at' || a.name === 'point_at');
    speakAct.args.addressUser = !spatial;
  }
  return speakAct ? [...body, speakAct] : body;
}

async function warmModel() {
  const endpoint = window.__NOVA_AI_ENDPOINT || './api/chat';
  if (/nova-groq/i.test(endpoint)) {
    if (state.living) setLog(`${state.character?.name || 'Герой'} слушает. Говори.`);
    return true;
  }
  const t0 = performance.now();
  try {
    const response = await fetch(`${endpoint}?warm=1`, { cache: 'no-store', signal: AbortSignal.timeout(180000) });
    const data = await response.json().catch(() => ({}));
    const ms = Math.round(data?.warm?.ms || (performance.now() - t0));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `AI HTTP ${response.status}`);
    startClientKeepAlive();
    if (!state.running && state.living) setLog(`${state.character?.name || 'Компаньон'} готов (${Math.round(ms / 1000)} с прогрева). Говори.`);
    return true;
  } catch (error) {
    if (state.living) setLog(`Модель ещё холодная: ${error?.message || error}`);
    return false;
  }
}

function startClientKeepAlive() {
  if (state.keepAliveTimer) return;
  const endpoint = window.__NOVA_AI_ENDPOINT || './api/chat';
  state.keepAliveTimer = setInterval(() => {
    if (!state.living || state.running || state.warming) return;
    void fetch(`${endpoint}?warm=1`, { cache: 'no-store', signal: AbortSignal.timeout(20000) }).catch(() => {});
  }, 4 * 60 * 1000);
}

function gestureForLine(line) {
  const ids = propIds();
  const home = state.character?.homeProp;
  const text = String(line || '').toLowerCase();
  for (const id of ids) {
    const label = id.replace(/_/g, ' ');
    if (text.includes(id) || (label.length > 3 && text.includes(label))) {
      return { name: /покаж|указ/.test(text) ? 'point_at' : 'look_at', args: { targetId: id } };
    }
  }
  if (/покаж|указ|вон там|что это|это что/.test(text) && ids[0]) {
    return { name: 'point_at', args: { targetId: home && ids.includes(home) ? home : ids[0] } };
  }
  if (home && ids.includes(home) && /там|здесь|мир|планет|комнат/.test(text)) {
    return { name: 'look_at', args: { targetId: home } };
  }
  return { name: 'face_user', args: {} };
}

async function decideBeat({ mode = 'think', heroLine = '', notes = '' } = {}) {
  const endpoint = window.__NOVA_AI_ENDPOINT || './api/chat';
  const ctrl = new AbortController();
  state.aiAbort = ctrl;
  const timer = setTimeout(() => ctrl.abort(), mode === 'idle' ? 8000 : 15000);
  const props = propIds().join(', ');
  const message = heroLine
    ? String(heroLine).slice(0, 280)
    : [
      mode === 'idle' ? 'Silent body beat only.' : `Continue living as ${state.character?.name}.`,
      `Props: ${props}`,
      notes,
    ].filter(Boolean).join('\n').slice(0, 360);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
      body: JSON.stringify({
        message,
        history: state.talk.slice(-4),
        scene: {
          objects: propIds().map((id) => ({ id })),
          visibleTargets: propIds().map((id) => ({ id, label: id })),
        },
        toolResults: [],
        phase: 'initial',
        locale: /[а-яё]/i.test(heroLine || '') ? 'ru-RU' : (navigator.language || 'ru-RU'),
        mode: heroLine ? 'reply' : mode,
        character: characterPayload(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `AI HTTP ${response.status}`);
    }
    return normalizePlan(data, { reply: Boolean(heroLine) });
  } finally {
    clearTimeout(timer);
    if (state.aiAbort === ctrl) state.aiAbort = null;
  }
}

function localAmbientActions() {
  return [{ name: 'face_user', args: {} }];
}

async function playAdaptive(actions) {
  if (!actions?.length) return '';
  await playPlan({ source: 'ai', actions });
  const spoken = actions.filter((a) => a.name === 'speak' && a.args?.text).map((a) => a.args.text).join(' ');
  absorbBeat(actions, spoken);
  return spoken;
}

async function heroSaid(text) {
  const line = String(text || '').trim();
  if (!line || isSelfEcho(line)) return;
  interruptActing();
  if (!state.living) {
    state.living = true;
    const btn = document.getElementById('stage-live');
    if (btn) {
      btn.textContent = '■ Стоп';
      btn.classList.add('active');
    }
    const mic = document.getElementById('prince-mic');
    if (mic) {
      mic.textContent = 'Микрофон вкл';
      mic.classList.add('active');
    }
  }
  state.running = true;
  const gen = state.playGen;
  state.lastHeard = line;
  state.pendingHero = '';
  setLog(`Ты: ${line}`);
  try {
    state.talk.push({ role: 'user', content: line.slice(0, 280) });
    state.lastHeroAt = Date.now();
    if (state.character?.emotions) state.character.emotions.current = 'warm';
    noteFact(`зритель сказал: ${line.slice(0, 80)}`);
    logSession({ kind: 'hero', text: line });
    refreshActorCard();
    const actions = await decideBeat({ mode: 'reply', heroLine: line });
    if (gen !== state.playGen) return;
    const speakAct = (actions || []).find((a) => a.name === 'speak');
    const gesture = (actions || []).find((a) => ['look_at', 'point_at', 'face_user'].includes(a.name))
      || gestureForLine(line);
    const plan = [gesture, speakAct].filter(Boolean);
    const reply = plan.find((a) => a.name === 'speak')?.args?.text;
    if (reply) setLog(`${state.character?.name}: ${reply}`);
    else setLog(`${state.character?.name} молчит — скажи ещё раз.`);
    const spoken = await playAdaptive(plan);
    if (gen !== state.playGen) return;
    logSession({ kind: 'actor', text: spoken || '' });
    if (spoken) setLog(`${state.character?.name}: ${spoken}`);
  } catch (error) {
    if (gen !== state.playGen) return;
    setLog(error?.name === 'AbortError' ? `${state.character?.name} слушает…` : (error?.message || String(error)));
  } finally {
    if (gen === state.playGen) {
      state.running = false;
      resumeMic();
      const queued = state.pendingHero;
      state.pendingHero = '';
      if (queued && !isSelfEcho(queued)) {
        void heroSaid(queued).catch((error) => setLog(error?.message || String(error)));
      }
    }
  }
}

function scheduleLive() {
  clearTimeout(state.liveTimer);
}

async function liveAmbient() {
  return;
}

function stopLiving() {
  interruptActing();
  state.pendingHero = '';
  state.living = false;
  stopListening();
  const btn = document.getElementById('stage-live');
  if (btn) {
    btn.textContent = 'Диалог';
    btn.classList.remove('active');
  }
  const mic = document.getElementById('prince-mic');
  if (mic) {
    mic.textContent = 'Микрофон';
    mic.classList.remove('active');
  }
}

async function startLiving({ silentOpen = false } = {}) {
  if (state.living && !silentOpen) {
    if (micSupported() && !state.micWanted) {
      state.micWanted = true;
      attachRecognition();
    }
    return;
  }
  if (!state.pack) loadPack(state.packId || 'tv-demo', state.character?.name);
  else window.__novaHumanoid?.applyCharacter?.(state.character);
  state.living = true;
  const btn = document.getElementById('stage-live');
  if (btn) {
    btn.textContent = '■ Стоп';
    btn.classList.add('active');
  }
  const mic = document.getElementById('prince-mic');
  if (mic) {
    mic.textContent = 'Микрофон вкл';
    mic.classList.add('active');
  }
  refreshActorCard();
  if (micSupported()) {
    state.micWanted = true;
    attachRecognition();
  }
  setLog(`${state.character.name} слушает. Говори — ответит сам.`);
  if (!state.warming) {
    state.warming = true;
    void warmModel().finally(() => { state.warming = false; });
  }
}

function toggleLiving() {
  if (state.living) {
    stopLiving();
    setLog('Диалог остановлен.');
    return;
  }
  void startLiving();
}

function buildVisitorUi() {
  if (document.getElementById('prince-hud')) return;
  const hud = document.createElement('section');
  hud.id = 'prince-hud';
  hud.innerHTML = `
    <header class="prince-head">
      <p class="prince-kicker">Обход сказки</p>
      <h1>Маленький принц</h1>
      <p id="prince-who">В полёте</p>
    </header>
    <p id="prince-hint" class="prince-hint">Кликни по небу — смотреть. Кукурузник: WASD, E — на планету.</p>
    <div id="stage-log">Герой появится, когда подлетишь к его планете.</div>
    <div class="prince-row">
      <input id="stage-hero" type="text" placeholder="Скажи герою…" autocomplete="off" />
      <button id="prince-mic" type="button">Микрофон</button>
    </div>
  `;
  document.body.appendChild(hud);
  const hero = hud.querySelector('#stage-hero');
  hero.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const line = hero.value.trim();
      hero.value = '';
      void heroSaid(line).catch((error) => setLog(error?.message || String(error)));
    }
  });
  hud.querySelector('#prince-mic').addEventListener('click', () => toggleLiving());
  window.addEventListener('nova:pointer-lock', (event) => {
    document.documentElement.classList.toggle('prince-looking', Boolean(event.detail?.locked));
  });
}

function buildUi() {
  if (isPrinceVisitor()) {
    buildVisitorUi();
    return;
  }
  if (document.getElementById('stage-panel')) return;
  const panel = document.createElement('section');
  panel.id = 'stage-panel';
  panel.className = 'stage-panel';
  panel.innerHTML = `
    <div class="stage-head">
      <div class="stage-brand"><span>Nova Stage</span><strong id="stage-who">…</strong></div>
      <span id="stage-status">…</span>
    </div>
    <div class="stage-row stage-selects">
      <label>Сценарий
        <select id="stage-pack">
          <option value="tv-demo">Комната у окна</option>
          <option value="little-prince">Маленький принц</option>
        </select>
      </label>
      <label>Роль
        <select id="stage-role"></select>
      </label>
      <a class="stage-workshop" href="./scenario/" target="_blank" rel="noopener">Мастерская</a>
    </div>
    <div id="stage-actor-card" class="stage-actor-card"></div>
    <div class="stage-row stage-actions">
      <button id="stage-live" class="primary" type="button" title="Говори в микрофон — актёр отвечает">Диалог</button>
      <button id="stage-session" type="button" title="Запись: картинка + твой голос и актёр">● Запись</button>
    </div>
    <div class="stage-row">
      <input id="stage-hero" type="text" placeholder="Или напиши реплику и Enter" />
    </div>
    <div class="stage-row">
      <button id="stage-walk" type="button" title="Ходить WASD, смотреть мышью">VR вид</button>
      <button id="stage-vr-eyes" type="button" title="VR180 3D SBS, как файл для гарнитуры">2 глаза</button>
    </div>
    <div id="stage-log">Выбери роль → Диалог. Говори в микрофон.</div>
  `;
  document.body.appendChild(panel);
  panel.querySelector('#stage-pack').addEventListener('change', () => onPackChange());
  panel.querySelector('#stage-role').addEventListener('change', () => onRoleChange());
  panel.querySelector('#stage-live').addEventListener('click', () => toggleLiving());
  panel.querySelector('#stage-walk').addEventListener('click', () => toggleWalk());
  panel.querySelector('#stage-vr-eyes').addEventListener('click', () => toggleVrEyes());
  panel.querySelector('#stage-session').addEventListener('click', () => { void toggleSession(); });
  const hero = panel.querySelector('#stage-hero');
  hero.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const line = hero.value.trim();
      hero.value = '';
      void heroSaid(line).catch((error) => setLog(error?.message || String(error)));
    }
  });
  window.addEventListener('nova:walk-mode', (event) => {
    const on = Boolean(event.detail?.enabled);
    const button = document.getElementById('stage-walk');
    if (button) button.textContent = on ? 'Выйти из VR' : 'VR вид';
    if (!on) {
      const eyes = document.getElementById('stage-vr-eyes');
      if (eyes) eyes.textContent = '2 глаза';
    }
  });
  window.addEventListener('nova:stereo-glasses', (event) => {
    const on = Boolean(event.detail?.enabled);
    const btn = document.getElementById('stage-vr-eyes');
    if (btn) btn.textContent = on ? '■ Очки' : '2 глаза';
    setLog(on ? 'Очки SBS на весь экран. T выкл · R запись.' : 'Очки выкл.');
  });
}

async function bootScene() {
  if (state.scene && window.__novaScene) return state.scene;
  const canvas = document.getElementById('scene');
  if (!canvas) throw new Error('No #scene canvas');
  const scene = new SpatialScene(canvas, {
    onStateChanged(next) {
      const el = document.getElementById('stage-status');
      if (el) el.textContent = next || 'idle';
    },
  });
  state.scene = scene;
  window.__novaScene = scene;
  return scene;
}

async function waitReady() {
  if (isPrinceVisitor()) return Boolean(window.__novaScene);
  for (let i = 0; i < 200; i += 1) {
    if (window.__novaEmbodimentReady && window.__novaScene?.avatar) return true;
    await sleep(50);
  }
  return Boolean(window.__novaScene?.avatar);
}

async function init() {
  const visitor = isPrinceVisitor();
  document.documentElement.classList.toggle('prince-visit', visitor);
  document.documentElement.classList.toggle('tv-stage', !visitor);
  buildUi();
  setLog(visitor ? 'Гружу планеты…' : 'Гружу 3D…');
  await bootScene();
  await waitReady();
  if (visitor && state.scene) state.scene.companionFollow = false;
  const params = new URLSearchParams(window.location.search);
  const demo = params.get('demo');
  const want = params.get('pack');
  fillPackSelect();
  let packId = visitor ? 'little-prince' : 'tv-demo';
  if (demo === 'prince' || demo === 'lp' || want === 'little-prince' || visitor) packId = 'little-prince';
  else if (want === 'custom' || want === 'workshop') packId = 'custom';
  const packSel = document.getElementById('stage-pack');
  if (packSel) {
    if (packId === 'custom' && !readWorkshopPack()) packId = 'tv-demo';
    packSel.value = packId;
  }
  loadPack(packId);
  if (visitor) {
    toggleWalk(true);
    watchVisitorProximity();
    const canvas = state.scene?.canvas;
    canvas?.addEventListener('click', () => {
      if (state.scene?.walkMode && document.pointerLockElement !== canvas) {
        try { canvas.requestPointerLock?.(); } catch {}
      }
    });
    const ai = await ensurePrinceAi();
    void startLiving();
    setLog(ai === 'vault'
      ? 'ИИ включён. Кликни — смотреть. Лети к планете и говори с героем.'
      : 'Кликни — смотреть. Лети к планете, говори с героем.');
  } else {
    setLog('Выбери роль → «Диалог». Говори в микрофон — компаньон отвечает сам.');
  }
  window.__novaTvStageReady = true;
  window.__novaTvStage = {
    loadPack,
    startLiving,
    stopLiving,
    heroSaid,
    decideBeat,
    execute,
    playPlan,
    enterWorld,
    toggleWalk,
    toggleSession,
    startListening,
    stopListening,
    getVoiceTracks: () => {
      syncVoiceTracks();
      return state.voiceTracks.filter((t) => t.readyState !== 'ended');
    },
    toggleVrEyes,
    get ready() { return true; },
    get running() { return state.running; },
    get living() { return state.living; },
    get facts() { return [...state.facts]; },
    get packId() { return state.packId; },
  };
}

// Kick scene immediately (module runs before DOMContentLoaded).
{
  const visitor = isPrinceVisitor();
  document.documentElement.classList.toggle('prince-visit', visitor);
  document.documentElement.classList.toggle('tv-stage', !visitor);
  const canvas = document.getElementById('scene');
  if (canvas) {
    try {
      const scene = new SpatialScene(canvas, {
        onStateChanged(next) {
          const el = document.getElementById('stage-status');
          if (el) el.textContent = next || 'idle';
        },
      });
      state.scene = scene;
      window.__novaScene = scene;
    } catch (error) {
      console.error('Stage scene boot failed', error);
    }
  }
}

void init().catch((error) => {
  console.error(error);
  setLog(error?.message || String(error));
});
