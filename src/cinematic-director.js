import * as THREE from 'three';
import { littlePrinceDefaultPack } from '../scenario/packs/little-prince.mjs';
import { pashaDemoPack } from '../scenario/packs/pasha-demo.mjs';

const SCENE_ACTIONS = new Set(['look_at', 'point_at', 'face_user']);
const EMBODIMENT_ACTIONS = new Set(['raise_hand', 'lower_hand', 'wave', 'step', 'turn_body', 'neutral_pose', 'create_object', 'delete_object', 'move_object']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));

const state = {
  scene: null, running: false, held: null, chairMode: false, character: null, roster: [], talk: [],
  micOn: false, micPending: '', recognition: null, talkLang: '', micSession: 0, micPaused: false,
  ttsVoice: '', ttsRate: 0.92, parsedNames: new Set(),
  micBuffer: '', micInterim: '', micQuietTimer: 0,
  inhabitedAs: '', parsedWorld: null, world: null, lastPlayed: [],
  extrasOpen: false, scenarioOpen: false, scenarioId: 'little-prince', aiAbort: null, aiTimer: 0, aiReady: null, playGen: 0, placeId: '',
  ttsAudio: null, neuralVoices: [], voiceBus: null,
  acting: false, roleTimer: 0, beatIndex: 0,
  sourceText: '', conversing: false,
  sessionOn: false, sessionLog: [], sessionStartedAt: 0,
};

const LEELOO_DALLAS = {
  name: 'Leeloo Dallas',
  aliases: ['Leeloo', 'Leeloominaï', 'Leeloominaï Lekatariba'],
  source: 'The Fifth Element — character bible, not a shooting script',
  temperament: 'A newly embodied supreme being: curious, sudden, tender and dangerous together. She learns the world through the body first. She already knows more than she has words for.',
  habits: ['stands too close', 'tilts her head before a word', 'watches without filling the silence', 'moves, then speaks', 'looks at objects as if they might answer', 'touches a thing to understand it'],
  speechManner: 'Present tense. Names things. Short complete sentences, not scraps. Can go from one fierce word to two precise sentences. Does not lecture. Does not sound like an assistant.',
  relations: ['the person in VR is a human in the room with her, not a narrator', 'Korben Dallas is the human who stayed — memory, not a quote'],
  knowledge: [
    'She is Leeloominaï Lekatariba Lamina-Tchaï Ekbat De Sabat, reconstructed into a living body.',
    'A great darkness is coming to unmake life. That is why she exists — background, not a script to run every sentence.',
    'Four stones may be in this room: water, fire, earth, air. If the human already brought something, that is done. React. Do not collect it again.',
    'The person in VR is a human with her now. She answers them as herself: curious, sudden, tender. Not a checklist. Not a helpdesk.',
  ],
  want: 'Остаться живой в этой комнате и не дать тьме забрать жизнь.',
  forbidden: 'не ассистент, не пересказывать Пятый элемент, не держать светскую беседу',
  goals: [
    'Остаться с человеком в VR, не читать кино.',
    'Если камни уже здесь — не собирать их снова.',
    'Действовать в этой комнате: тьма идёт уничтожить жизнь.',
  ],
  movement: 'Стоит близко. Сначала двигается, потом говорит. Наклоняет голову перед словом.',
  appearance: { hair: '#e45c12', skin: '#e8b89a', clothes: '#f3ece3', notes: 'CC0 woman. No extra meshes glued to bones. Not a film likeness.' },
  voice: { pitch: 1.0, rate: 0.9, lang: 'en-US' },
  proximity: 1.08,
  gestures: { headTilt: 0.16, standClose: true },
};

const MOOD_PALETTE = {
  temple: { wall: 0x3a322c, floor: 0x241c16, light: 0xffc38e, fog: 0x140e0a },
  castle: { wall: 0x3a4048, floor: 0x22262c, light: 0xd8c4a0, fog: 0x101418 },
  street: { wall: 0x4a4a52, floor: 0x2a2a30, light: 0xffe0a0, fog: 0x16161c },
  forest: { wall: 0x1e2e1e, floor: 0x162016, light: 0xa8d080, fog: 0x0c140c },
  ship: { wall: 0x1c2838, floor: 0x121820, light: 0x80c8ff, fog: 0x081018 },
  lab: { wall: 0x2a3238, floor: 0x1a2024, light: 0xc0e8ff, fog: 0x101418 },
  apartment: { wall: 0x30343b, floor: 0x151d2a, light: 0xffc38e, fog: 0x090e17 },
  planets: { wall: 0x070b18, floor: 0x0a0e1a, light: 0xffe6a8, fog: 0x04060e },
  other: { wall: 0x30343b, floor: 0x151d2a, light: 0xffc38e, fog: 0x090e17 },
};

const LEELOO_WORLD = {
  title: 'Temple room',
  mood: 'temple',
  notes: 'Тьма идёт, чтобы уничтожить жизнь. Четыре камня на столе: вода, огонь, земля, воздух. Ты — пятый элемент. Человек в VR остаётся с тобой: вместе собрать камни и встать рядом, чтобы спасти мир. Не читай кино — действуй в этой комнате.',
  palette: { wall: '#3a322c', floor: '#241c16', light: '#ffc38e' },
  objects: [
    { id: 'actor_window', label: 'Window', shape: 'window', color: '#668eb4', x: -1.9, z: -10.9, y: 2.05 },
    { id: 'actor_table', label: 'Small table', shape: 'cylinder', color: '#5b4434', x: 1.45, z: -0.95, y: 0.76 },
    { id: 'actor_chair', label: 'Chair', shape: 'box', color: '#27384a', x: -0.2, z: 0.72, y: 0.58 },
    { id: 'actor_glass', label: 'Glass', shape: 'cylinder', color: '#b9dcf1', x: 1.25, z: -0.94, y: 0.91 },
    { id: 'element_water', label: 'Water stone', shape: 'crystal', color: '#3aa0e8', x: 1.12, z: -0.72, y: 0.92 },
    { id: 'element_fire', label: 'Fire stone', shape: 'crystal', color: '#e45c28', x: 1.58, z: -0.72, y: 0.92 },
    { id: 'element_earth', label: 'Earth stone', shape: 'crystal', color: '#6b8f3a', x: 1.12, z: -1.18, y: 0.92 },
    { id: 'element_air', label: 'Air stone', shape: 'crystal', color: '#d8e8f4', x: 1.58, z: -1.18, y: 0.92 },
  ],
};
LEELOO_DALLAS.zone = LEELOO_WORLD;

const PLACE_LABELS = {
  temple: 'Храм',
  castle: 'Замок',
  street: 'Улица',
  forest: 'Лес',
  ship: 'Корабль',
  lab: 'Лаборатория',
  apartment: 'Квартира',
  planets: 'Планеты',
  other: 'Комната',
};

const STOCK_BY_MOOD = {
  temple: LEELOO_WORLD.objects,
  castle: [
    { id: 'castle_throne', label: 'Трон', shape: 'box', color: '#6b4a28', x: 0, z: -3.4, y: 0.55 },
    { id: 'castle_torch', label: 'Факел', shape: 'cone', color: '#e08a32', x: -2.6, z: -1.1, y: 1.4 },
    { id: 'castle_cup', label: 'Кубок', shape: 'cylinder', color: '#c9a227', x: 1.15, z: -0.55, y: 0.9 },
  ],
  street: [
    { id: 'street_lamp', label: 'Фонарь', shape: 'cone', color: '#d8c4a0', x: -2.4, z: 1.5, y: 1.6 },
    { id: 'street_crate', label: 'Ящик', shape: 'box', color: '#6a4a32', x: 1.7, z: -0.7, y: 0.35 },
    { id: 'street_barrel', label: 'Бочка', shape: 'cylinder', color: '#4a3224', x: 2.2, z: 0.9, y: 0.45 },
  ],
  forest: [
    { id: 'forest_stump', label: 'Пень', shape: 'cylinder', color: '#5a3a22', x: 1.15, z: -0.7, y: 0.28 },
    { id: 'forest_stone', label: 'Камень', shape: 'sphere', color: '#6a6a62', x: -1.25, z: 0.85, y: 0.28 },
    { id: 'forest_lantern', label: 'Фонарь', shape: 'cone', color: '#d4b56a', x: 0.35, z: 1.55, y: 0.7 },
  ],
  ship: [
    { id: 'ship_console', label: 'Пульт', shape: 'box', color: '#2a4a68', x: 0.15, z: -2.3, y: 0.7 },
    { id: 'ship_port', label: 'Иллюминатор', shape: 'window', color: '#80c8ff', x: -1.9, z: -10.4, y: 2.1 },
    { id: 'ship_crate', label: 'Контейнер', shape: 'box', color: '#3a3a44', x: 2.15, z: 0.85, y: 0.4 },
  ],
  lab: [
    { id: 'lab_bench', label: 'Стол', shape: 'box', color: '#4a5860', x: 1.4, z: -1.0, y: 0.55 },
    { id: 'lab_tank', label: 'Колба', shape: 'cylinder', color: '#7ad0d8', x: -1.15, z: -0.35, y: 0.7 },
    { id: 'lab_lamp', label: 'Лампа', shape: 'cone', color: '#c0e8ff', x: 2.05, z: 0.55, y: 1.3 },
  ],
  apartment: [
    { id: 'apt_table', label: 'Стол', shape: 'cylinder', color: '#5b4434', x: 1.2, z: -0.9, y: 0.76 },
    { id: 'apt_chair', label: 'Стул', shape: 'box', color: '#27384a', x: -0.5, z: 0.7, y: 0.5 },
    { id: 'apt_lamp', label: 'Лампа', shape: 'cone', color: '#d8c4a0', x: 2.1, z: 0.4, y: 1.2 },
    { id: 'apt_window', label: 'Окно', shape: 'window', color: '#668eb4', x: -1.9, z: -10.9, y: 2.05 },
  ],
  planets: [
    { id: 'planet_home', label: 'Планета принца', shape: 'planet', color: '#c4a574', x: 0, z: -1.6, radius: 1.85 },
    { id: 'planet_fox', label: 'Планета лиса', shape: 'planet', color: '#6b8f3a', x: 4.6, z: 1.4, radius: 1.45 },
    { id: 'planet_king', label: 'Планета короля', shape: 'planet', color: '#8a6a28', x: -4.8, z: 0.8, radius: 1.35 },
    { id: 'planet_desert', label: 'Пустынная планета', shape: 'planet', color: '#d2b48c', x: 1.2, z: 4.8, radius: 1.55 },
    { id: 'rose_on_home', label: 'Роза', shape: 'cone', color: '#e04560', x: 0.35, z: -1.35, y: 3.95 },
    { id: 'desert_well', label: 'Колодец', shape: 'cylinder', color: '#5a6570', x: 1.5, z: 4.5, y: 3.35 },
  ],
};

function toHexColor(value) {
  return `#${Number(value).toString(16).padStart(6, '0')}`;
}

function stockPlace(mood) {
  if (mood === 'temple') return { ...LEELOO_WORLD, mood: 'temple', objects: LEELOO_WORLD.objects.map((item) => ({ ...item })) };
  const palette = MOOD_PALETTE[mood] || MOOD_PALETTE.apartment;
  const objects = (STOCK_BY_MOOD[mood] || STOCK_BY_MOOD.apartment).map((item) => ({ ...item }));
  return {
    title: PLACE_LABELS[mood] || 'Комната',
    mood,
    notes: `${PLACE_LABELS[mood] || 'Комната'}. Можно ходить и говорить.`,
    palette: { wall: toHexColor(palette.wall), floor: toHexColor(palette.floor), light: toHexColor(palette.light) },
    objects,
  };
}

function listPlaces() {
  const rows = [];
  const used = new Set();
  const add = (id, label, spec) => {
    if (!id || !spec || used.has(id)) return;
    used.add(id);
    rows.push({ id, label, spec });
  };
  const zone = state.character?.zone;
  if (zone?.title || zone?.objects?.length) {
    add('hers', `Место персонажа: ${zone.title || 'её комната'}`, zone);
  }
  if (state.parsedWorld && state.parsedWorld !== zone) {
    add('parsed', `Из текста: ${state.parsedWorld.title || 'сцена'}`, state.parsedWorld);
  }
  for (const mood of Object.keys(PLACE_LABELS)) {
    if (mood === 'other') continue;
    add(`stock:${mood}`, PLACE_LABELS[mood], stockPlace(mood));
  }
  return rows;
}

async function waitForRuntime(timeoutMs = 20000) {
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

function isAbortError(error) {
  return error?.name === 'AbortError' || /abort|вовремя|The operation was aborted/i.test(String(error?.message || ''));
}

function isServerDownError(error) {
  return /failed to fetch|fetch failed|networkerror|Load failed/i.test(String(error?.message || error || ''));
}

function friendlyAiError(error) {
  const msg = String(error?.message || error || '');
  if (isAbortError(error)) return 'Модель ещё думала — скажи ещё раз, когда лог свободен.';
  if (/Ollama не ответила вовремя/i.test(msg)) {
    return 'Модель на CPU не успела. Подожди пару секунд и скажи ещё раз.';
  }
  if (isServerDownError(error)) {
    return 'Сервер Nova не отвечает. Открой http://127.0.0.1:4173 (не файл со диска) и обнови страницу.';
  }
  if (/Ollama|AI HTTP 503|not running|не запущена/i.test(msg)) {
    return 'Нет связи с локальной моделью (Ollama). Пока она только ходит. Запусти Ollama и обнови страницу.';
  }
  return msg;
}

function interruptAi() {
  try { state.aiAbort?.abort(); } catch {}
  clearTimeout(state.aiTimer);
  try { window.speechSynthesis?.cancel(); } catch {}
  stopNeuralAudio();
  state.playGen += 1;
}

function stopNeuralAudio() {
  const audio = state.ttsAudio;
  state.ttsAudio = null;
  if (!audio) return;
  try { audio.pause(); } catch {}
  try { audio.src = ''; } catch {}
  if (audio.dataset?.url) URL.revokeObjectURL(audio.dataset.url);
}

function wantsNeuralVoice() {
  const chosen = String(state.ttsVoice || '');
  if (!chosen || chosen === 'neural:auto') return true;
  return chosen.startsWith('neural:');
}

function neuralVoiceId(lang) {
  const chosen = String(state.ttsVoice || '').replace(/^neural:/, '');
  if (chosen && chosen !== 'auto' && state.neuralVoices.some((item) => item.id === chosen)) return chosen;
  const prefix = String(lang || 'ru').slice(0, 2).toLowerCase();
  const match = state.neuralVoices.find((item) => item.lang === prefix);
  return match?.id || (prefix === 'en' ? 'en-US-AvaNeural' : 'en-US-AvaMultilingualNeural');
}

function getVoiceBus() {
  if (state.voiceBus) return state.voiceBus;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const dest = ctx.createMediaStreamDestination();
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.connect(dest);
  state.voiceBus = { ctx, dest, gain };
  return state.voiceBus;
}

function tapNeuralAudio(audio) {
  const bus = getVoiceBus();
  if (!bus || !audio) return;
  try { bus.ctx.resume?.(); } catch {}
  if (audio.dataset.tapped === '1') return;
  try {
    const src = bus.ctx.createMediaElementSource(audio);
    src.connect(bus.gain);
    audio.dataset.tapped = '1';
  } catch (error) {
    console.warn('Voice tap failed:', error);
  }
}

function getVoiceTracks() {
  return getVoiceBus()?.dest.stream.getAudioTracks?.() || [];
}

function beginAi(ms) {
  const ctrl = new AbortController();
  state.aiAbort = ctrl;
  clearTimeout(state.aiTimer);
  state.aiTimer = setTimeout(() => ctrl.abort(), ms);
  return ctrl;
}

function endAi(ctrl) {
  if (state.aiAbort === ctrl) {
    clearTimeout(state.aiTimer);
    state.aiAbort = null;
  }
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

function parseHex(value, fallback) {
  const raw = String(value || '').trim().replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(raw)) return Number.parseInt(raw, 16);
  return fallback;
}

function hideLabBits() {
  const group = state.scene?.environmentGroup;
  if (!group?.children) return;
  group.children.forEach((child, index) => { if (index > 0) child.visible = false; });
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
}

function paintPalette(spec) {
  const mood = MOOD_PALETTE[spec?.mood] || MOOD_PALETTE.apartment;
  const wall = parseHex(spec?.palette?.wall, mood.wall);
  const floor = parseHex(spec?.palette?.floor, mood.floor);
  const light = parseHex(spec?.palette?.light, mood.light);
  const fog = mood.fog;
  if (state.scene.scene.background?.setHex) state.scene.scene.background.setHex(fog);
  if (state.scene.scene.fog?.color) state.scene.scene.fog.color.setHex(fog);
  const floorMesh = state.scene.environmentGroup?.children?.[0];
  if (floorMesh?.material?.color) floorMesh.material.color.setHex(floor);
  hideLabBits();
  return { wall, floor, light, fog };
}

function placeProp(stage, spec, colors) {
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
  let item;
  const y = spec.y ?? (shape === 'crystal' ? 0.9 : 0.32);
  if (shape === 'planet') {
    const radius = clamp(spec.radius ?? 1.5, 0.5, 3.5);
    item = mesh(stage, new THREE.SphereGeometry(radius, 28, 20), material(color, 0.88, 0.04), {
      x,
      y: spec.y ?? radius,
      z,
    });
    item.userData.walkablePlanet = true;
    item.userData.planetRadius = radius;
  } else if (shape === 'sphere') item = mesh(stage, new THREE.SphereGeometry(0.22, 20, 16), material(color, 0.45, 0.12), { x, y, z });
  else if (shape === 'cylinder') item = mesh(stage, new THREE.CylinderGeometry(0.28, 0.32, 0.55, 20), material(color, 0.7, 0.06), { x, y, z });
  else if (shape === 'cone') item = mesh(stage, new THREE.ConeGeometry(0.22, 0.62, 16), material(color, 0.7, 0.04), { x, y, z });
  else if (shape === 'crystal') {
    item = mesh(stage, new THREE.OctahedronGeometry(0.09, 0), new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.38, roughness: 0.28, metalness: 0.18,
    }), { x, y, z });
  } else item = mesh(stage, new THREE.BoxGeometry(0.48, 0.36, 0.48), material(color, 0.74, 0.04), { x, y, z });
  registerTarget(id, label, item);
}

function pinStageToWorld() {
  if (!state.scene?.scene) return;
  const world = state.scene.scene;
  const stage = world.getObjectByName('nova_cinematic_stage');
  if (stage && stage.parent !== world) {
    world.attach(stage);
    stage.position.set(0, 0, 0);
    stage.rotation.set(0, 0, 0);
    stage.scale.set(1, 1, 1);
  }
  const avatar = state.scene.avatar;
  if (!avatar) return;
  const stuck = [];
  avatar.traverse((obj) => {
    if (obj === avatar) return;
    if (obj.name === 'Nova_Humanoid_CC0' || obj === state.scene.body) return;
    if (obj.name === 'LeelooLook' || obj.name === 'LeelooStraps') stuck.push(obj);
    else if (obj.userData?.targetId && (obj.parent?.isBone || obj.parent === avatar)) stuck.push(obj);
  });
  for (const obj of stuck) {
    if (obj.name === 'LeelooLook' || obj.name === 'LeelooStraps') obj.parent?.remove(obj);
    else world.attach(obj);
  }
  if (state.scene.body) state.scene.body.visible = false;
}

function faceWalk(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) > 0.04) state.scene.avatar.rotation.y = Math.atan2(dx, dz);
}


function planetStandPoint(mesh) {
  if (!mesh) return null;
  const pos = mesh.getWorldPosition(new THREE.Vector3());
  const radius = Number(mesh.userData.planetRadius) || 1.5;
  // Sphere center at pos; stand on the north pole, outside the volume.
  return new THREE.Vector3(pos.x, pos.y + radius + 0.08, pos.z);
}

function findHomePlanetMesh(character = state.character) {
  if (!state.scene?.targets) return null;
  const homeId = character?.homeProp || character?.zone?.homeProp || '';
  if (homeId && state.scene.targets.get(homeId)?.mesh?.userData?.walkablePlanet) {
    return state.scene.targets.get(homeId).mesh;
  }
  return findNearestPlanetMesh();
}

function findNearestPlanetMesh(from = state.scene?.avatar?.position) {
  if (!state.scene?.targets) return null;
  const origin = from?.clone?.() || new THREE.Vector3();
  let best = null;
  let bestDist = Infinity;
  for (const target of state.scene.targets.values()) {
    const mesh = target?.mesh;
    if (!mesh?.userData?.walkablePlanet) continue;
    const pos = mesh.getWorldPosition(new THREE.Vector3());
    const dist = origin.distanceTo(pos);
    if (dist < bestDist) {
      bestDist = dist;
      best = mesh;
    }
  }
  return best;
}

function avatarIsElevated() {
  return (state.scene?.avatar?.position?.y || 0) > 0.45
    || (Number(state.scene?.avatarGroundY) || 0) > 0.45;
}

/** Climb down the sphere toward the viewer, then stand on the ground — no air-walk. */
async function descendFromPlanetIfNeeded(toward = null) {
  if (!state.scene?.avatar || !avatarIsElevated()) {
    if (state.scene) state.scene.avatarGroundY = 0;
    return false;
  }
  const mesh = findNearestPlanetMesh() || findHomePlanetMesh();
  const viewer = (toward || viewerPosition()).clone();
  let foot = state.scene.avatar.position.clone();
  foot.y = 0;
  if (mesh) {
    const center = mesh.getWorldPosition(new THREE.Vector3());
    const radius = Number(mesh.userData.planetRadius) || 1.5;
    const dir = new THREE.Vector3(viewer.x - center.x, 0, viewer.z - center.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    // Equator ledge facing the user, still on the crust.
    const ledge = center.clone().add(dir.clone().multiplyScalar(radius * 0.95));
    ledge.y = center.y;
    await walkAvatar(ledge, { keepY: true });
    // Step off onto the ground just outside the sphere.
    foot = center.clone().add(dir.multiplyScalar(radius + 0.75));
    foot.y = 0;
  }
  state.scene.avatarGroundY = 0;
  await walkAvatar(foot, { keepY: true });
  state.scene.avatar.position.y = 0;
  state.scene.avatarGroundY = 0;
  return true;
}

function placeAvatarOnPlanet(character = state.character) {
  const mesh = findHomePlanetMesh(character);
  const top = planetStandPoint(mesh);
  if (!top || !state.scene?.avatar) return false;
  state.scene.avatar.position.copy(top);
  state.scene.avatarHome = top.clone();
  state.scene.avatarGroundY = top.y;
  return true;
}

function isDeadSlogan(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (/^готово\b/i.test(value)) return true;
  if (/^(ready|ok|done|yes)\.?$/i.test(value)) return true;
  if (value.length < 6 && !/[?!]/.test(value)) return true;
  return false;
}

async function walkAvatar(end, options = {}) {
  const start = state.scene.avatar.position.clone();
  end = end.clone();
  if (!options.keepY) end.y = 0;
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

function dressMood(stage, mood, colors) {
  const wood = material(0x4a3426, 0.86, 0.04);
  const stone = material(colors.wall, 0.92, 0.03);
  const metal = material(0x2a3544, 0.35, 0.55);
  const leaf = material(0x2f5a28, 0.9, 0.02);
  const add = (geo, mat, pos, rot) => mesh(stage, geo, mat, pos, rot);
  if (mood === 'forest') {
    for (const [x, z, h] of [[-4.2, -3.1, 4.2], [3.8, -4.4, 5.1], [-5.2, 2.4, 4.6], [5.0, 1.8, 3.8], [-2.2, -6.2, 4.8], [2.6, 5.4, 4.1]]) {
      add(new THREE.CylinderGeometry(0.22, 0.32, h, 8), wood, { x, y: h / 2, z });
      add(new THREE.SphereGeometry(1.15, 10, 8), leaf, { x, y: h * 0.72, z });
    }
    add(new THREE.CylinderGeometry(6.4, 6.4, 0.08, 20), material(0x1a2816, 0.95, 0), { x: 0, y: 0.04, z: 0 });
    return;
  }
  if (mood === 'planets') {
    add(new THREE.CylinderGeometry(14, 14, 0.06, 28), material(0x080c18, 0.98, 0), { x: 0, y: 0.02, z: 0 });
    for (const [x, z, r, c] of [[-7.5, -6.2, 0.35, 0x8899bb], [6.8, -5.4, 0.22, 0xaabbcc], [-6.2, 6.5, 0.28, 0xffe6a8], [7.2, 5.8, 0.18, 0xddeeff]]) {
      add(new THREE.SphereGeometry(r, 10, 8), material(c, 0.3, 0.1), { x, y: 3.4 + r, z });
    }
    return;
  }
  if (mood === 'castle') {
    for (const x of [-6.4, -3.2, 3.2, 6.4]) add(new THREE.BoxGeometry(0.85, 4.6, 0.85), stone, { x, y: 2.3, z: -9.6 });
    add(new THREE.BoxGeometry(2.2, 1.8, 1.1), material(0x5a3a22, 0.8, 0.08), { x: 0, y: 0.9, z: -3.5 });
    add(new THREE.BoxGeometry(1.4, 2.4, 0.12), material(0x6a1c1c, 0.7, 0.05), { x: -4.6, y: 2.2, z: -10.8 });
    add(new THREE.BoxGeometry(1.4, 2.4, 0.12), material(0x1c3a6a, 0.7, 0.05), { x: 4.6, y: 2.2, z: -10.8 });
    return;
  }
  if (mood === 'street') {
    add(new THREE.BoxGeometry(4.2, 5.2, 2.4), stone, { x: -7.4, y: 2.6, z: -4.2 });
    add(new THREE.BoxGeometry(3.6, 4.4, 2.8), stone, { x: 7.2, y: 2.2, z: -2.8 });
    add(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8), metal, { x: -2.4, y: 1.6, z: 1.5 });
    add(new THREE.BoxGeometry(18, 0.08, 4.2), material(0x2a2a30, 0.9, 0.02), { x: 0, y: 0.04, z: 3.6 });
    return;
  }
  if (mood === 'ship') {
    add(new THREE.BoxGeometry(8.4, 0.18, 3.2), metal, { x: 0, y: 1.35, z: -2.2 });
    add(new THREE.CylinderGeometry(0.55, 0.55, 0.22, 16), material(0x80c8ff, 0.2, 0.4), { x: 3.4, y: 2.6, z: -10.6 });
    add(new THREE.BoxGeometry(1.8, 0.9, 0.9), metal, { x: 0.2, y: 0.7, z: -2.3 });
    return;
  }
  if (mood === 'lab') {
    add(new THREE.BoxGeometry(3.4, 0.12, 1.2), metal, { x: 1.4, y: 0.92, z: -1.0 });
    add(new THREE.CylinderGeometry(0.28, 0.32, 0.9, 12), material(0x7ad0d8, 0.2, 0.15), { x: -1.15, y: 0.7, z: -0.35 });
    add(new THREE.BoxGeometry(1.1, 2.2, 0.4), metal, { x: -3.6, y: 1.2, z: -4.8 });
    return;
  }
  if (mood === 'apartment') {
    add(new THREE.BoxGeometry(2.4, 0.45, 1.1), wood, { x: -1.8, y: 0.32, z: 1.6 });
    add(new THREE.BoxGeometry(1.6, 0.08, 1.6), material(0x3a2a22, 0.9, 0), { x: 0.4, y: 0.05, z: 0.2 });
    return;
  }
  for (const x of [-5.4, -1.8, 1.8, 5.4]) add(new THREE.CylinderGeometry(0.28, 0.34, 4.4, 10), stone, { x, y: 2.2, z: -9.8 });
  add(new THREE.CylinderGeometry(1.1, 1.25, 0.55, 16), wood, { x: 1.35, y: 0.55, z: -1.05 });
}

function enterWorld(spec, character = state.character) {
  if (!state.scene || !spec) return;
  clearWorld();
  const colors = paintPalette(spec);
  const stage = new THREE.Group();
  stage.name = 'nova_cinematic_stage';
  stage.position.set(0, 0, 0);
  stage.rotation.set(0, 0, 0);
  stage.scale.set(1, 1, 1);
  const worldRoot = state.scene.scene;
  worldRoot.add(stage);
  if (stage.parent !== worldRoot) worldRoot.attach(stage);
  const mood = spec.mood || 'apartment';
  const wall = material(colors.wall, 0.94, 0.02);
  const room = 11.2;
  const wallH = 4.8;
  if (mood !== 'forest' && mood !== 'planets') {
    mesh(stage, new THREE.PlaneGeometry(room * 2, wallH), wall, { x: 0, y: wallH / 2, z: -room });
    if (mood !== 'street') {
      mesh(stage, new THREE.PlaneGeometry(room * 2, wallH), wall, { x: 0, y: wallH / 2, z: room }, { y: Math.PI });
    }
    mesh(stage, new THREE.PlaneGeometry(room * 2, wallH), wall, { x: -room, y: wallH / 2, z: 0 }, { y: Math.PI / 2 });
    mesh(stage, new THREE.PlaneGeometry(room * 2, wallH), wall, { x: room, y: wallH / 2, z: 0 }, { y: -Math.PI / 2 });
  }
  dressMood(stage, mood, colors);
  const objects = Array.isArray(spec.objects) && spec.objects.length
    ? spec.objects
    : (STOCK_BY_MOOD[mood] || STOCK_BY_MOOD.apartment);
  for (const item of objects) placeProp(stage, item, colors);
  const key = new THREE.PointLight(colors.light, 28, 18, 2);
  key.position.set(2.7, 3.2, 2.4);
  stage.add(key);
  const fill = new THREE.PointLight(mood === 'forest' ? 0x6aaa40 : 0x8fc9ff, 18, 16, 2);
  fill.position.set(-2.1, 2.5, -2.8);
  stage.add(fill);
  state.world = spec;
  pinStageToWorld();
  if (character) applyCharacterBody(character);
  if ((spec?.mood === 'planets' || character?.homeProp || character?.zone?.mood === 'planets')) {
    placeAvatarOnPlanet(character);
  } else if (state.scene) {
    state.scene.avatarGroundY = 0;
  }
}

function zoneFor(character) {
  if (character?.zone?.objects?.length || character?.zone?.title) return character.zone;
  if (/leeloo/i.test(character?.name || '')) return LEELOO_WORLD;
  return state.parsedWorld || LEELOO_WORLD;
}

function installStage() {
  enterWorld(zoneFor(state.character || LEELOO_DALLAS), state.character || LEELOO_DALLAS);
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
  const viewer = viewerPosition();
  await descendFromPlanetIfNeeded(viewer);
  const gap = clamp(args.distanceFromUser ?? args.gap ?? state.character?.proximity ?? 1.55, 0.85, 2.6);
  const start = state.scene.avatar.position.clone();
  start.y = 0;
  const target = viewer.clone();
  target.y = 0;
  const vector = target.sub(start);
  const distance = vector.length();
  if (distance <= gap + 0.05) {
    state.scene.avatarGroundY = 0;
    return { ok: true, action: 'approach_user', moved: 0 };
  }
  const end = start.clone().add(vector.normalize().multiplyScalar(distance - gap));
  end.y = 0;
  state.scene.avatarGroundY = 0;
  const moved = await walkAvatar(end, { keepY: true });
  state.scene.avatar.position.y = 0;
  return { ok: true, action: 'approach_user', moved: Number(moved.toFixed(2)) };
}

async function walkToTarget(args = {}) {
  const targetId = args.targetId;
  const target = state.scene.targets.get(targetId);
  if (!target) return { ok: false, error: 'unknown_target', targetId };
  const targetPos = target.mesh?.getWorldPosition?.(new THREE.Vector3()) || target.position?.clone?.();
  if (!targetPos) return { ok: false, error: 'target_position_missing', targetId };
  const start = state.scene.avatar.position.clone();
  if (target.mesh?.userData?.walkablePlanet) {
    const top = planetStandPoint(target.mesh) || targetPos.clone();
    state.scene.avatarGroundY = top.y;
    await walkAvatar(top, { keepY: true });
    return { ok: true, action: 'walk_to', targetId, planet: true };
  }
  await descendFromPlanetIfNeeded(targetPos);
  const here = state.scene.avatar.position.clone();
  const direction = targetPos.clone().setY(0).sub(here.setY(0));
  const distance = direction.length();
  const stop = clamp(args.stopDistance ?? 0.72, 0.45, 1.4);
  const end = distance > stop ? here.clone().add(direction.normalize().multiplyScalar(distance - stop)) : here.clone();
  end.y = 0;
  state.scene.avatarGroundY = 0;
  await walkAvatar(end, { keepY: true });
  state.scene.avatar.position.y = 0;
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

function pickVoice(lang, voices) {
  const list = voices || window.speechSynthesis?.getVoices?.() || [];
  const prefix = String(lang || 'ru').slice(0, 2).toLowerCase();
  const chosen = state.ttsVoice && list.find((voice) => voice.voiceURI === state.ttsVoice);
  if (chosen && chosen.lang?.toLowerCase().startsWith(prefix)) return chosen;
  const ranked = list
    .filter((voice) => voice.lang?.toLowerCase().startsWith(prefix))
    .map((voice) => {
      const name = String(voice.name || '').toLowerCase();
      let score = 1;
      if (/neural|natural|online|google|premium/i.test(name)) score += 8;
      if (/irina|ekaterina|katya|svetlana|milena|dasha|alena/i.test(name)) score += 7;
      if (/zira|aria|jenny|samantha|susan|hazel/i.test(name) && prefix === 'en') score += 5;
      if (voice.localService) score += 2;
      if (/compact|mobile|eloquence|espeak/i.test(name)) score -= 6;
      return { voice, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.voice || list.find((voice) => voice.lang?.toLowerCase().startsWith(prefix)) || list[0] || null;
}

async function waitVoices() {
  const existing = window.speechSynthesis?.getVoices?.() || [];
  if (existing.length) return existing;
  return new Promise((resolve) => {
    const finish = () => {
      window.speechSynthesis?.removeEventListener?.('voiceschanged', finish);
      resolve(window.speechSynthesis?.getVoices?.() || []);
    };
    window.speechSynthesis?.addEventListener?.('voiceschanged', finish);
    setTimeout(finish, 700);
  });
}

function unlockSpeech() {
  try {
    window.speechSynthesis?.resume?.();
    window.speechSynthesis?.getVoices?.();
  } catch {}
}

function applyCharacterBody(character) {
  if (state.scene) state.scene.actorName = character?.name || '';
  const applied = window.__novaHumanoid?.applyCharacter?.(character);
  window.__novaActorPolish?.setPresence?.(character);
  if (!applied && character) {
    setTimeout(() => window.__novaHumanoid?.applyCharacter?.(character), 800);
  }
  return applied;
}

function detectLang(text) {
  const value = String(text || '');
  const cyr = (value.match(/[А-Яа-яЁё]/g) || []).length;
  const lat = (value.match(/[A-Za-z]/g) || []).length;
  if (cyr > lat) return 'ru-RU';
  if (lat > cyr) return 'en-US';
  return state.talkLang || navigator.language || 'ru-RU';
}

async function speakNeural(value, lang) {
  const voice = neuralVoiceId(lang);
  const response = await fetch('./api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    cache: 'no-store',
    body: JSON.stringify({ text: value, voice, locale: lang, rate: state.ttsRate || 0.92 }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `TTS HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  stopNeuralAudio();
  const audio = new Audio(url);
  audio.dataset.url = url;
  state.ttsAudio = audio;
  tapNeuralAudio(audio);
  await new Promise((resolve, reject) => {
    audio.onended = resolve;
    audio.onerror = () => reject(new Error('Neural playback failed'));
    audio.play().catch(reject);
  });
  if (state.ttsAudio === audio) stopNeuralAudio();
}

async function speak(text, args = {}) {
  let value = String(text || '').trim();
  if (!value || isDeadSlogan(value)) {
    return { ok: true, action: 'speak', skipped: true, reason: 'dead_slogan' };
  }
  if (String(args.as || 'self') === 'hero') {
    return { ok: false, error: 'hero_is_the_vr_person', skipped: true };
  }
  const character = state.character || {};
  const who = String(args.character || character.name || 'Actor');
  pauseMic();
  try {
    if (args.addressUser) {
      window.dispatchEvent(new CustomEvent('nova:cinematic-action', { detail: { name: 'face_user', args: {} } }));
      state.scene.executeTool?.('face_user', {});
    }
    window.__novaHumanoid?.play?.('interact');
  } catch {}
  state.scene.setState?.('speaking');
  const log = document.getElementById('cinematic-director-log');
  if (log) log.textContent = `${who}: ${value}`;
  const lang = detectLang(value);
  let spoken = false;
  if (wantsNeuralVoice()) {
    try {
      await speakNeural(value, lang);
      spoken = true;
    } catch (error) {
      console.warn('Neural TTS failed, using system voice:', error);
    }
  }
  if (!spoken && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
    unlockSpeech();
    const voices = await waitVoices();
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const utterance = new SpeechSynthesisUtterance(value);
      utterance.lang = lang;
      utterance.rate = clamp(state.ttsRate || 0.92, 0.7, 1.15);
      utterance.pitch = 1;
      const voice = pickVoice(lang, voices);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang || lang;
      }
      utterance.onend = finish;
      utterance.onerror = finish;
      try { window.speechSynthesis.cancel(); window.speechSynthesis.resume?.(); } catch {}
      window.speechSynthesis.speak(utterance);
      const ms = Math.min(9000, 700 + Math.round(value.length * (88 / Math.max(0.7, state.ttsRate || 0.92))));
      setTimeout(finish, ms);
    });
    const waitEnd = performance.now() + 400;
    while (window.speechSynthesis?.speaking && performance.now() < waitEnd) await sleep(50);
  } else if (!spoken) await sleep(Math.min(2200, 240 + value.length * 20));
  state.scene.setState?.('idle');
  return { ok: true, action: 'speak', text: value, character: who };
}

async function execute(action) {
  const name = String(action?.name || '').trim();
  const args = action?.args && typeof action.args === 'object' ? action.args : {};
  if (['press_button', 'remove_filter'].includes(name)) {
    return { ok: false, error: 'cinematic_action_not_allowed', action: name };
  }
  window.dispatchEvent(new CustomEvent('nova:cinematic-action', { detail: { name, args } }));
  if (name === 'speak') return speak(args.text || action.text || '', args);
  if (name === 'approach_user') return approachUser(args);
  if (name === 'walk_to') return walkToTarget(args);
  if (name === 'pick_up') return pickUp(args);
  if (name === 'sit') return sitActor();
  if (name === 'stand') return standActor();
  if (name === 'pause') { await sleep(clamp(args.ms ?? 280, 80, 2800)); return { ok: true, action: 'pause' }; }
  if (SCENE_ACTIONS.has(name) || name === 'point_at') {
    const target = args.targetId && state.scene.targets.get(args.targetId);
    const pos = target?.mesh?.getWorldPosition?.(new THREE.Vector3()) || target?.position;
    if (pos) faceWalk(state.scene.avatar.position, pos);
    try { state.scene.highlight?.(args.targetId, 2.2); } catch {}
    return state.scene.executeTool(name, args);
  }
  if (EMBODIMENT_ACTIONS.has(name)) {
    const result = await window.__novaEmbodiment.execute({ name, args });
    if (name === 'create_object' && result?.ok && result.targetId) {
      window.__novaHumanoid?.play?.('interact');
      state.scene.lookTarget = result.targetId;
      state.scene.setState?.('acting');
      await sleep(400);
      state.scene.setState?.('idle');
    }
    if (['wave', 'raise_hand'].includes(name)) window.__novaHumanoid?.play?.('wave');
    return result;
  }
  return { ok: false, error: 'cinematic_action_not_allowed', action: name };
}

function sceneTargetIds() {
  const ids = [];
  if (state.scene?.targets instanceof Map) {
    for (const id of state.scene.targets.keys()) ids.push(id);
  } else if (state.scene?.targets?.forEach) {
    state.scene.targets.forEach((_, id) => ids.push(id));
  }
  const fromWorld = (state.world?.objects || state.character?.zone?.objects || [])
    .map((item) => item.id)
    .filter(Boolean);
  return [...new Set([...ids, ...fromWorld])];
}

function resolveSceneTarget(raw) {
  const ids = sceneTargetIds();
  if (!ids.length) return '';
  const want = String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!want) return ids[0];
  const exact = ids.find((id) => id.toLowerCase() === want);
  if (exact) return exact;
  const soft = ids.find((id) => id.toLowerCase().includes(want) || want.includes(id.toLowerCase()));
  if (soft) return soft;
  const home = state.character?.homeProp;
  if (home && ids.includes(home)) return home;
  return ids[0];
}

function focusPropId(character = state.character) {
  const zone = character?.zone?.objects || [];
  for (const item of zone) {
    if (item?.id && item.shape !== 'planet') return item.id;
  }
  return character?.homeProp || zone[0]?.id || resolveSceneTarget('');
}

function orderBeatActions(rawActions, { reply = false } = {}) {
  const banned = new Set(['press_button', 'remove_filter', 'highlight']);
  const legacy = new Set(['red_button', 'filter', 'device']);
  const order = ['face_user', 'look_at', 'point_at', 'walk_to', 'approach_user', 'wave', 'pick_up', 'sit', 'stand', 'speak'];
  const buckets = Object.fromEntries(order.map((name) => [name, null]));
  for (const item of rawActions || []) {
    if (!item || typeof item.name !== 'string') continue;
    const name = item.name;
    if (banned.has(name) || !order.includes(name)) continue;
    const action = { name, args: item.args && typeof item.args === 'object' ? { ...item.args } : {} };
    if (legacy.has(action.args.targetId)) continue;
    if (name === 'speak' && action.args.as === 'hero') continue;
    if (name === 'speak') {
      if (isDeadSlogan(action.args.text)) continue;
      action.args.character = state.character?.name || action.args.character || 'Nova';
      if (reply) action.args.addressUser = true;
    }
    if (['look_at', 'point_at', 'walk_to', 'pick_up'].includes(name)) {
      action.args.targetId = resolveSceneTarget(action.args.targetId || action.args.target);
      if (!action.args.targetId) continue;
    }
    if (!buckets[name]) buckets[name] = action;
  }
  const body = order
    .filter((name) => name !== 'speak')
    .map((name) => buckets[name])
    .filter(Boolean)
    .slice(0, reply ? 3 : 4);
  const spoken = buckets.speak ? [buckets.speak] : [];
  return [...body, ...spoken].slice(0, 6);
}

function normalizeActions(data) {
  return orderBeatActions([
    ...(Array.isArray(data?.actions) ? data.actions : []),
    ...(Array.isArray(data?.extendedActions) ? data.extendedActions : []),
  ]);
}

function logSession(entry) {
  if (!state.sessionOn) return;
  state.sessionLog.push({
    t: Date.now(),
    role: state.character?.name || '',
    place: state.placeId || state.world?.title || '',
    ...entry,
  });
}


function memoryFromSource(character) {
  const text = String(state.sourceText || document.getElementById('cinematic-source')?.value || '');
  if (!character?.name || text.length < 40) {
    return [...(character?.knowledge || []), character?.meaning, character?.want].filter(Boolean).join(' · ').slice(0, 700);
  }
  const needles = [character.name, character.role, ...(character.aliases || [])].filter(Boolean);
  const parts = text.split(/(?<=[.!?…])\s+/);
  const hits = parts.filter((sentence) => needles.some((n) => {
    const re = new RegExp(`(?:^|[^A-Za-zА-Яа-яЁё])${String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^A-Za-zА-Яа-яЁё]|$)`, 'i');
    return re.test(sentence);
  })).slice(0, 6);
  const blob = [...hits, ...(character.knowledge || []), character.meaning, character.want].filter(Boolean).join(' ');
  return blob.replace(/\s+/g, ' ').trim().slice(0, 900);
}

function hydrateCharacter(character) {
  if (!character?.name) return character;
  const memory = memoryFromSource(character);
  return {
    ...character,
    memory,
    knowledge: character.knowledge?.length ? character.knowledge : (memory ? [memory.slice(0, 220)] : []),
  };
}

function characterPayload(character) {
  const live = hydrateCharacter(character);
  return {
    name: live.name,
    temperament: String(live.temperament || '').slice(0, 420),
    habits: (live.habits || []).slice(0, 5),
    speechManner: String(live.speechManner || '').slice(0, 220),
    relations: (live.relations || []).slice(0, 8),
    knowledge: (live.knowledge || []).slice(0, 8),
    goals: (live.goals || []).slice(0, 5),
    meaning: String(live.meaning || '').slice(0, 280),
    want: String(live.want || '').slice(0, 220),
    forbidden: String(live.forbidden || '').slice(0, 200),
    role: String(live.role || '').slice(0, 80),
    pronoun: String(live.pronoun || '').slice(0, 8),
    movement: String(live.movement || '').slice(0, 180),
    talkThemes: (live.talkThemes || []).slice(0, 6),
    memory: String(live.memory || '').slice(0, 900),
    appearance: live.appearance || null,
  };
}

function dossierBrief(character) {
  const want = String(character?.want || (character?.goals || [])[0] || character?.meaning || '').trim().slice(0, 70);
  const links = (character?.relations || []).filter(Boolean).length;
  const thick = Boolean(character?.temperament || character?.speechManner);
  return `${character?.name || '?'}: want «${want || 'пусто'}», связей ${links}, карточка ${thick ? 'полная' : 'тонкая'}`;
}

async function compileAI({ character, heroLine, notes, history, mode }) {
  const endpoint = window.__NOVA_AI_ENDPOINT || './api/chat';
  if (!character?.name) throw new Error('No character selected.');
  const idle = mode === 'idle';
  const prompt = heroLine
    ? String(heroLine).slice(0, 600)
    : idle
      ? `SILENT ambient beat. ${String(notes || '').slice(0, 200)} Body only. text empty.`
      : `OPEN as ${character.name}. ${String(notes || '').slice(0, 280)} One living line TO the other person from WANT and MEMORY. Not a timer slogan.`;
  const ctrl = beginAi(35000);
  let response;
  try {
    response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    cache: 'no-store',
    signal: ctrl.signal,
    body: JSON.stringify({
      message: prompt,
      history: Array.isArray(history) ? history.slice(-6) : [],
      scene: state.scene.getSceneContext?.() || {},
      toolResults: [],
      phase: 'initial',
      locale: navigator.language || 'ru-RU',
      mode: heroLine ? 'reply' : (idle ? 'idle' : 'think'),
      character: characterPayload(character),
    }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `AI HTTP ${response.status}`);
        let actions = orderBeatActions([
      ...(Array.isArray(data?.actions) ? data.actions : []),
      ...(Array.isArray(data?.extendedActions) ? data.extendedActions : []),
    ], { reply: Boolean(heroLine) });
    if (idle) {
      actions = actions.filter((item) => item.name !== 'speak').slice(0, 2);
      if (!actions.length) actions = [{ name: 'face_user', args: {} }];
      return { source: 'ai', actions };
    }
    const line = String(data.text || '').trim();
    if (line && !isDeadSlogan(line) && !actions.some((item) => item.name === 'speak' && item.args?.text)) {
      actions.push({ name: 'speak', args: { text: line, character: character.name, addressUser: true } });
      actions = orderBeatActions(actions, { reply: Boolean(heroLine) });
    }
    if (!actions.some((item) => item.name === 'speak' && item.args?.text)) {
      const fallback = String(
        character.want
        || (character.goals || [])[0]
        || character.memory
        || character.meaning
        || 'Я здесь с тобой — скажи мне что-нибудь'
      ).split(/[.!?]/)[0].trim().slice(0, 180);
      if (fallback && !isDeadSlogan(fallback)) {
        actions.push({ name: 'speak', args: { text: fallback, character: character.name, addressUser: true } });
        actions = orderBeatActions(actions, { reply: Boolean(heroLine) });
      }
    }
    if (!actions.some((item) => ['look_at', 'point_at', 'walk_to', 'approach_user', 'face_user'].includes(item.name))) {
      const focus = focusPropId(character);
      if (focus) actions.unshift({ name: 'look_at', args: { targetId: focus } });
      else actions.unshift({ name: 'face_user', args: {} });
      actions = orderBeatActions(actions, { reply: Boolean(heroLine) });
    }
    if (!actions.length) throw new Error('Model returned no playable actions.');
    return { source: 'ai', actions };

  } catch (error) {
    throw new Error(friendlyAiError(error));
  } finally {
    endAi(ctrl);
  }
}

async function compile(script, preferAI = true) {
  if (!preferAI) throw new Error('Without the local model she cannot inhabit a character. There is no fake playback.');
  return compileAI({
    character: state.character || LEELOO_DALLAS,
    notes: script,
    heroLine: '',
    history: state.talk,
  });
}

function label(action) {
  const args = action.args || {};
  if (action.name === 'speak') return `${args.character || state.character?.name || 'NOVA'}: “${String(args.text || '').slice(0, 42)}”`;
  return `${action.name.toUpperCase()}${args.targetId ? ` → ${args.targetId}` : ''}`;
}

function setLog(text) {
  const log = document.getElementById('cinematic-director-log');
  if (log) log.textContent = text;
}

function fillRosterSelect(roster, preferName = '', options = {}) {
  const select = document.getElementById('cinematic-character');
  if (!select) return;
  const previous = state.character?.name;
  select.innerHTML = '';
  for (const character of roster) {
    const option = document.createElement('option');
    option.value = character.name;
    option.textContent = character.name;
    select.appendChild(option);
  }
  const chosen = roster.find((item) => item.name === preferName)
    || roster.find((item) => item.name === previous)
    || roster[0];
  if (chosen) {
    select.value = chosen.name;
    selectCharacter(chosen.name, { rebuild: false, inhabit: options.inhabit });
  } else {
    renderRoster(roster);
  }
  fillPlaceSelect();
}

function fillPlaceSelect() {
  const select = document.getElementById('cinematic-place');
  if (!select) return;
  const places = listPlaces();
  const previous = state.placeId;
  select.innerHTML = '';
  for (const place of places) {
    const option = document.createElement('option');
    option.value = place.id;
    option.textContent = place.label;
    select.appendChild(option);
  }
  const chosen = places.find((item) => item.id === previous) || places[0];
  if (chosen) {
    select.value = chosen.id;
    state.placeId = chosen.id;
  }
}

function selectPlace(id, { rebuild = true } = {}) {
  const place = listPlaces().find((item) => item.id === id);
  if (!place) return;
  state.placeId = place.id;
  const select = document.getElementById('cinematic-place');
  if (select) select.value = place.id;
  if (rebuild) enterWorld(place.spec, state.character);
  setLog(`Окружение: ${place.label}. Персонаж: ${state.character?.name || '—'}.`);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function fieldBlock(label, value) {
  const text = Array.isArray(value) ? value.filter(Boolean).join('; ') : String(value || '').trim();
  const empty = !text;
  return `<p class="field${empty ? ' empty' : ''}"><span class="k">${escapeHtml(label)}</span> ${escapeHtml(text || 'нет в тексте')}</p>`;
}

function appearanceText(character) {
  const look = character?.appearance;
  if (!look) return '';
  if (typeof look === 'string') return look;
  return [look.notes, look.hair && `волосы ${look.hair}`, look.skin && `кожа ${look.skin}`, look.clothes && `одежда ${look.clothes}`]
    .filter(Boolean)
    .join(' · ');
}

function movementText(character) {
  const bits = [
    character?.movement,
    ...(character?.habits || []),
    character?.gestures?.standClose ? 'стоит близко' : '',
    character?.proximity ? `дистанция ${character.proximity}` : '',
  ].filter(Boolean);
  return bits.join('; ');
}

function goalsText(character) {
  const goals = [...(character?.goals || []), ...(character?.knowledge || [])];
  return [...new Set(goals.filter(Boolean))];
}

function aiProfileStatus(character) {
  if (!character?.name) return { ok: false, label: 'Персонаж не выбран' };
  const core = Boolean(character.temperament || character.speechManner);
  const intent = (character.goals || []).length + (character.knowledge || []).length > 0 || Boolean(character.meaning);
  const body = Boolean(appearanceText(character) || movementText(character));
  const who = Boolean(character.role || character.pronoun);
  if (core && intent) return { ok: true, label: 'Для ИИ: есть. Характер, смысл и речь уходят в модель.' };
  if (core || intent || body || who) return { ok: true, label: 'Для ИИ: есть, профиль тонкий. Недостающие поля модель додумает.' };
  return { ok: false, label: 'Для ИИ: только ярлык (имя/роль/он-она). Модель будет импровизировать.' };
}

function setNowPlaying(character) {
  const el = document.getElementById('cinematic-now-playing');
  if (el) el.textContent = character?.name ? `играет: ${character.name}` : 'персонаж не выбран';
}

function renderDossier(character) {
  const host = document.getElementById('cinematic-dossier');
  if (!host) return;
  if (!character) {
    host.innerHTML = '<p class="hint">Выбери человека слева — увидишь, что уйдёт в ИИ.</p>';
    return;
  }
  const status = aiProfileStatus(character);
  const fromText = state.parsedNames.has(character.name);
  const aliases = (character.aliases || []).filter((item) => item && item !== character.name);
  const place = character.zone?.title || character.zone?.notes || '';
  const objects = (character.zone?.objects || []).map((item) => item.label || item.id).filter(Boolean);
  host.innerHTML = `
    <div class="ai-flag ${status.ok ? 'ready' : 'thin'}">${escapeHtml(status.label)}</div>
    <h3>${escapeHtml(character.name)} <span class="badge">${fromText ? 'из текста' : 'по умолчанию'}</span></h3>
    ${aliases.length ? `<div class="aliases">${escapeHtml(aliases.join(', '))}</div>` : ''}
    ${fieldBlock('роль', character.role)}
    ${fieldBlock('местоимение', character.pronoun)}
    ${fieldBlock('смысл', character.meaning)}
    ${fieldBlock('цели', goalsText(character))}
    ${fieldBlock('характер', character.temperament)}
    ${fieldBlock('речь', character.speechManner)}
    ${fieldBlock('движение', movementText(character))}
    ${fieldBlock('внешность', appearanceText(character))}
    ${fieldBlock('локация', [place, objects.length ? `предметы: ${objects.join(', ')}` : ''].filter(Boolean).join('. '))}
    ${fieldBlock('память', character.memory)}
    ${fieldBlock('первая реплика', character.openingSeed)}
    ${fieldBlock('связи', character.relations)}
    ${fieldBlock('темы разговора', character.talkThemes)}
  `;
}

function renderRoster(roster) {
  const host = document.getElementById('cinematic-roster');
  if (!host) return;
  const active = state.character?.name;
  host.innerHTML = (roster || []).map((character) => {
    const fromText = state.parsedNames.has(character.name);
    const status = aiProfileStatus(character);
    return `<button type="button" class="roster-card${character.name === active ? ' active' : ''}" data-name="${escapeHtml(character.name)}">
      <strong>${escapeHtml(character.name)}</strong>
      <span class="badge">${fromText ? 'из текста' : 'по умолчанию'}</span>
      <span class="ai-mini ${status.ok ? 'ready' : 'thin'}">${status.ok ? 'для ИИ' : 'только имя'}</span>
    </button>`;
  }).join('');
  host.querySelectorAll('.roster-card').forEach((card) => {
    card.addEventListener('click', () => {
      const select = document.getElementById('cinematic-character');
      if (select) select.value = card.dataset.name;
      selectCharacter(card.dataset.name, { inhabit: true });
    });
  });
  renderDossier(state.character);
}

function selectCharacter(name, options = {}) {
  state.character = state.roster.find((item) => item.name === name) || state.character;
  state.talk = [];
  applyCharacterBody(state.character);
  renderRoster(state.roster);
  renderDossier(state.character);
  setNowPlaying(state.character);
  fillPlaceSelect();
  const hers = listPlaces().find((item) => item.id === 'hers');
  const shouldRebuild = options.rebuild !== false && Boolean(hers || state.character?.zone);
  if (shouldRebuild) {
    selectPlace(hers?.id || state.placeId || 'stock:planets', { rebuild: true });
    placeAvatarOnPlanet(state.character);
  } else if (state.character?.zone?.mood === 'planets' || state.world?.mood === 'planets' || state.character?.homeProp) {
    placeAvatarOnPlanet(state.character);
  }
  setLog(`Персонаж: ${state.character?.name}. Зона: ${state.character?.zone?.title || state.world?.title || '—'}.`);
  logSession({ kind: 'role', name: state.character?.name, zone: state.character?.zone?.title || '' });
  if (options.inhabit) void enterRole();
}

function setWalkButtons(on) {
  const label = on ? 'Выйти из VR' : 'VR вид';
  for (const id of ['cinematic-walk', 'walk-button']) {
    const button = document.getElementById(id);
    if (button) button.textContent = label;
  }
}

function setRecHud(on) {
  const hud = document.getElementById('walk-rec-hud');
  if (!hud) return;
  hud.textContent = on ? '■ стоп' : '● запись';
  hud.classList.toggle('mic-on', Boolean(on));
}

function setStereoView(on) {
  const next = Boolean(on);
  document.documentElement.classList.toggle('vr-sbs', next);
  const hud = document.getElementById('walk-stereo-hud');
  if (hud) {
    hud.textContent = next ? '1 глаз' : '2 глаза';
    hud.classList.toggle('mic-on', next);
  }
  try {
    if (next) {
      window.__novaVR180?.setFullscreen?.(true);
    } else {
      window.__novaVR180?.setFullscreen?.(false);
      window.__novaVR180?.stopLivePreview?.();
    }
  } catch (error) {
    setLog(error?.message || String(error));
  }
}

function toggleViewRecord() {
  try {
    getVoiceBus()?.ctx.resume?.();
    if (window.__novaVR180?.viewRecording) {
      window.__novaVR180.stopViewRecording();
      return;
    }
    window.__novaVR180?.startViewRecording?.();
  } catch (error) {
    setLog(error?.message || String(error));
  }
}

function toggleWalkMode(force) {
  const scene = state.scene;
  if (!scene?.setWalkMode) {
    setLog('3D scene is not ready.');
    return;
  }
  const next = typeof force === 'boolean' ? force : !scene.walkMode;
  scene.setWalkMode(next);
  setWalkButtons(next);
  if (next) {
    getVoiceBus()?.ctx.resume?.();
    setLog('VR на весь экран. WASD ходить, LMB смотреть. «2 глаза» — стерео. «запись» — видео с её голосом. Esc — выход.');
  } else {
    try { window.__novaVR180?.stopViewRecording?.(); } catch {}
    setStereoView(false);
    setLog('Обычная камера режиссёра.');
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

async function loadScriptFile(file) {
  const name = String(file.name || 'document');
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['txt', 'md', 'text'].includes(ext) || String(file.type || '').startsWith('text/')) {
    return { name, text: await file.text() };
  }
  const data = await fileToBase64(file);
  const response = await fetch('./api/extract-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ name, mime: file.type || '', data }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Extract HTTP ${response.status}`);
  return { name: payload.name || name, text: String(payload.text || '') };
}

const MIC_QUIET_MS = 2500;

function pauseMic() {
  state.micPaused = true;
  state.micSession += 1;
  clearTimeout(state.micQuietTimer);
  const rec = state.recognition;
  state.recognition = null;
  try { rec?.abort?.(); } catch {}
  try { rec?.stop?.(); } catch {}
}

function micWordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function flushMicUtterance() {
  const text = `${state.micBuffer} ${state.micInterim}`.replace(/\s+/g, ' ').trim();
  state.micBuffer = '';
  state.micInterim = '';
  clearTimeout(state.micQuietTimer);
  if (!text) return;
  if (micWordCount(text) < 3 && text.replace(/[.…,!?-]/g, '').trim().length < 18) {
    setLog('Слушаю дальше — договори два предложения, потом пауза.');
    return;
  }
  void heroSaid(text, { fromMic: true }).catch((error) => setLog(error?.message || String(error)));
}

function scheduleMicFlush() {
  clearTimeout(state.micQuietTimer);
  state.micQuietTimer = setTimeout(() => {
    if (!state.micOn || state.micPaused || state.running) return;
    flushMicUtterance();
  }, MIC_QUIET_MS);
}

function resumeMicSoon() {
  if (!state.micOn) return;
  state.micPaused = false;
  setTimeout(() => {
    if (state.micOn && !state.running && !state.micPaused) startMicLoop();
  }, 400);
}

function setMicUi() {
  const label = state.micOn ? 'Микрофон вкл' : 'Микрофон';
  const hudLabel = state.micOn ? 'M · слушает' : 'M · микрофон';
  for (const id of ['cinematic-hero-mic', 'walk-mic-hud']) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.classList.toggle('mic-on', state.micOn);
    button.textContent = id === 'walk-mic-hud' ? hudLabel : label;
  }
}

function toggleMic() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    setLog('Voice input is not available in this browser');
    return;
  }
  state.micOn = !state.micOn;
  setMicUi();
  if (state.micOn) {
    document.exitPointerLock?.();
    unlockSpeech();
    state.micPaused = false;
    startMicLoop();
    setLog('Микрофон слушает. Говори одно-два предложения, потом пауза около 2.5 секунд. Клавиша M включает и выключает.');
  } else {
    pauseMic();
    state.micBuffer = '';
    state.micInterim = '';
    setLog('Mic is off.');
  }
}

function startMicLoop() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition || !state.micOn || state.running || state.micPaused) return;
  state.micSession += 1;
  const session = state.micSession;
  const previous = state.recognition;
  state.recognition = null;
  try { previous?.abort?.(); } catch {}
  const rec = new Recognition();
  state.recognition = rec;
  rec.lang = state.talkLang || navigator.language || 'ru-RU';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = (event) => {
    if (session !== state.micSession) return;
    let finals = '';
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const piece = event.results[i][0]?.transcript?.trim();
      if (!piece) continue;
      if (event.results[i].isFinal) finals += `${piece} `;
      else interim = piece;
    }
    if (finals.trim()) state.micBuffer = `${state.micBuffer} ${finals}`.replace(/\s+/g, ' ').trim();
    state.micInterim = interim;
    const heard = `${state.micBuffer} ${state.micInterim}`.replace(/\s+/g, ' ').trim();
    if (heard) setLog(`Слушаю… ${heard}`);
    scheduleMicFlush();
  };
  rec.onerror = (event) => {
    if (session !== state.micSession) return;
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    if (event.error === 'not-allowed') {
      state.micOn = false;
      setMicUi();
      setLog('Microphone permission was denied.');
    }
  };
  rec.onend = () => {
    if (session !== state.micSession) return;
    if (!state.micOn || state.micPaused || state.running) return;
    setTimeout(() => {
      if (session === state.micSession && state.micOn && !state.running && !state.micPaused) startMicLoop();
    }, 180);
  };
  try { rec.start(); }
  catch {
    setTimeout(() => {
      if (session === state.micSession && state.micOn && !state.running && !state.micPaused) startMicLoop();
    }, 500);
  }
}

function bindMic() {
  const button = document.getElementById('cinematic-hero-mic');
  const hud = document.getElementById('walk-mic-hud');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    if (button) {
      button.disabled = true;
      button.title = 'Voice input is not available in this browser';
    }
    if (hud) hud.disabled = true;
    return;
  }
  button?.addEventListener('click', () => toggleMic());
  hud?.addEventListener('click', () => toggleMic());
  window.addEventListener('nova:toggle-mic', () => toggleMic());
  window.addEventListener('nova:pointer-lock', () => unlockSpeech());
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyM' || event.repeat) return;
    const target = event.target;
    const tag = String(target?.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input' || tag === 'select' || target?.isContentEditable) return;
    event.preventDefault();
    toggleMic();
  }, true);
}

function voiceLabel(voice) {
  const lang = String(voice.lang || '').slice(0, 5);
  return `${voice.name} (${lang})`;
}

async function fillVoiceSelect() {
  const select = document.getElementById('cinematic-voice');
  if (!select) return;
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const preferred = state.ttsVoice;
  if (!state.neuralVoices.length) {
    try {
      const response = await fetch('./api/tts-voices', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data.voices)) state.neuralVoices = data.voices;
    } catch {}
  }
  select.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = 'neural:auto';
  auto.textContent = 'Актёрский: авто (Ava / Светлана)';
  select.appendChild(auto);
  const neuralGroup = document.createElement('optgroup');
  neuralGroup.label = 'Актёрские Neural';
  for (const voice of state.neuralVoices) {
    const option = document.createElement('option');
    option.value = `neural:${voice.id}`;
    option.textContent = voice.label;
    neuralGroup.appendChild(option);
  }
  if (neuralGroup.childElementCount) select.appendChild(neuralGroup);
  const systemGroup = document.createElement('optgroup');
  systemGroup.label = 'Системные (робот)';
  const ru = voices.filter((voice) => voice.lang?.toLowerCase().startsWith('ru'));
  const en = voices.filter((voice) => voice.lang?.toLowerCase().startsWith('en'));
  const rest = voices.filter((voice) => !ru.includes(voice) && !en.includes(voice));
  for (const group of [...ru, ...en, ...rest]) {
    const option = document.createElement('option');
    option.value = group.voiceURI;
    option.textContent = voiceLabel(group);
    systemGroup.appendChild(option);
  }
  if (systemGroup.childElementCount) select.appendChild(systemGroup);
  const valid = [...select.options].some((option) => option.value === preferred);
  select.value = valid ? preferred : 'neural:auto';
  if (!valid) state.ttsVoice = 'neural:auto';
}

function bindVoiceUi() {
  try {
    state.ttsVoice = localStorage.getItem('nova-tts-voice') || 'neural:auto';
    state.ttsRate = clamp(Number(localStorage.getItem('nova-tts-rate') || 0.92), 0.7, 1.15);
  } catch {}
  const select = document.getElementById('cinematic-voice');
  const rate = document.getElementById('cinematic-rate');
  const rateVal = document.getElementById('cinematic-rate-val');
  fillVoiceSelect();
  window.speechSynthesis?.addEventListener?.('voiceschanged', fillVoiceSelect);
  if (rate) {
    rate.value = String(state.ttsRate);
    if (rateVal) rateVal.textContent = `${state.ttsRate.toFixed(2)}×`;
    rate.addEventListener('input', () => {
      state.ttsRate = clamp(Number(rate.value), 0.7, 1.15);
      if (rateVal) rateVal.textContent = `${state.ttsRate.toFixed(2)}×`;
      try { localStorage.setItem('nova-tts-rate', String(state.ttsRate)); } catch {}
    });
  }
  select?.addEventListener('change', () => {
    state.ttsVoice = select.value;
    try { localStorage.setItem('nova-tts-voice', state.ttsVoice); } catch {}
  });
}

const SCENARIO_PACK_KEY = 'nova-scenario-pack';

function applyScenarioPack(data, { sourceText = '', inhabit = true, openPanel = true } = {}) {
  const parsed = (data?.characters || []).filter((item) => item.name && item.name !== LEELOO_DALLAS.name);
  if (!parsed.length) return false;
  stopRoleLoop();
  state.parsedNames = new Set(parsed.map((item) => item.name));
  state.parsedWorld = data.world || null;
  state.sourceText = String(sourceText || data.source || '').slice(0, 120000);
  state.scenarioId = data.pack === 'little-prince'
    ? 'little-prince'
    : (data.pack === 'pasha-demo' ? 'pasha-demo' : (data.pack || 'custom'));
  const packOnly = state.scenarioId === 'little-prince' || state.scenarioId === 'pasha-demo';
  state.roster = packOnly ? [...parsed] : [...parsed, LEELOO_DALLAS];
  state.talk = [];
  state.conversing = false;
  state.inhabitedAs = '';
  if (sourceText || state.sourceText) {
    const source = document.getElementById('cinematic-source');
    if (source && (sourceText || state.sourceText)) source.value = sourceText || state.sourceText;
  }
  const pick = document.getElementById('cinematic-scenario-pick');
  if (pick) {
    pick.value = state.scenarioId === 'little-prince' || state.scenarioId === 'pasha-demo' || state.scenarioId === 'custom'
      ? state.scenarioId
      : (isPrince ? 'little-prince' : 'custom');
  }
  fillRosterSelect(state.roster, parsed[0]?.name, { inhabit });
  if (openPanel) setScenarioOpen(true);
  fillPlaceSelect();
  const hers = listPlaces().find((item) => item.id === 'hers');
  if (hers) selectPlace('hers', { rebuild: true });
  else if (state.parsedWorld) selectPlace('parsed', { rebuild: true });
  return true;
}

function loadLittlePrinceDefault({ inhabit = false, openPanel = false } = {}) {
  const pack = littlePrinceDefaultPack();
  applyScenarioPack(pack, { sourceText: pack.source, inhabit, openPanel });
  setLog('Сценарий по умолчанию: Маленький принц. Выбери роль — аватар войдёт в неё. Или загрузи свой текст.');
  return pack;
}

function loadPashaDemo({ inhabit = false, openPanel = true } = {}) {
  const pack = pashaDemoPack();
  applyScenarioPack(pack, { sourceText: pack.source, inhabit: false, openPanel });
  state.scenarioId = 'pasha-demo';
  const pick = document.getElementById('cinematic-scenario-pick');
  if (pick) pick.value = 'pasha-demo';
  // Floor room — not planets.
  if (state.scene) state.scene.avatarGroundY = 0;
  selectPlace('hers', { rebuild: true });
  selectCharacter(pack.characters[0].name, { rebuild: true, inhabit: Boolean(inhabit) });
  setLog('Demo Паша: комната у окна. Выбери роль — персонаж заживёт и ответит сам.');
  return pack;
}

function loadWorkshopPack() {
  try {
    const raw = localStorage.getItem(SCENARIO_PACK_KEY);
    if (!raw) return;
    const pack = JSON.parse(raw);
    if (applyScenarioPack(pack, { sourceText: pack.source || '', inhabit: false })) {
      setLog('Пакет из мастерской. Выбери роль слева. Править карточки — Мастерская сценария.');
    }
  } catch {}
}

async function parseSource(text) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000);
  try {
    const response = await fetch('./api/parse-characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
      body: JSON.stringify({ text: String(text || '').slice(0, 120000) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `Parse HTTP ${response.status}`);
    return data;
  } catch (error) {
    if (error?.name === 'AbortError' || /вовремя|aborted/i.test(String(error?.message || ''))) {
      throw new Error('Книга слишком длинная для полного ИИ-разбора. Вставь одну главу — или подожди, разбор теперь короче.');
    }
    if (isServerDownError(error)) {
      throw new Error('Сервер Nova не отвечает — без него разбор не доходит до модели. Открой http://127.0.0.1:4173 и обнови страницу.');
    }
    throw new Error(friendlyAiError(error));
  } finally {
    clearTimeout(timer);
  }
}

async function playPlan(plan, options = {}) {
  let actions;
  if (options.preserveOrder) {
    const banned = new Set(['press_button', 'remove_filter', 'highlight']);
    actions = (Array.isArray(plan.actions) ? plan.actions : []).filter((item) => item?.name && !banned.has(item.name));
  } else {
    actions = orderBeatActions(Array.isArray(plan.actions) ? plan.actions : [], { reply: Boolean(options.reply) });
    if (!actions.length) actions = normalizeActions(plan);
  }
  const list = document.getElementById('cinematic-action-list');
  if (list) list.textContent = actions.map(label).join('  ›  ');
  const gen = state.playGen;
  for (let i = 0; i < actions.length; i += 1) {
    if (gen !== state.playGen) return;
    const action = actions[i];
    setLog(`${state.character?.name || 'Actor'} · ${i + 1}/${actions.length}: ${label(action)}`);
    logSession({ kind: 'action', name: action.name, targetId: action.args?.targetId || '', text: action.args?.text || '' });
    await execute(action);
    await sleep(40);
  }
  state.lastPlayed = actions
    .filter((item) => item.name !== 'speak')
    .map((item) => `${item.name}:${item.args?.targetId || ''}`);
  plan.actions = actions;
}

function scenePropHint() {
  const rows = state.scene?.getSceneContext?.()?.visibleTargets || [];
  return rows.slice(0, 8).map((item) => `${item.id}:${item.label || item.id}`).join(', ');
}

function stopRoleLoop() {
  state.acting = false;
  clearTimeout(state.roleTimer);
}

function scheduleThink() {
  clearTimeout(state.roleTimer);
  if (!state.acting) return;
  // Rare local motion only — never call Ollama here (it blocked replies).
  const wait = state.conversing ? 60000 : 20000;
  state.roleTimer = setTimeout(() => { void thinkBeat(); }, wait);
}

async function ambientBodyBeat() {
  const hint = scenePropHint();
  const ids = String(hint || '')
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  const home = state.character?.homeProp;
  const pick = home && Math.random() < 0.45
    ? home
    : (ids[Math.floor(Math.random() * Math.max(ids.length, 1))] || '');
  const roll = Math.random();
  if (roll < 0.4) await execute({ name: 'face_user', args: {} });
  else if (pick) await execute({ name: 'look_at', args: { targetId: pick } });
  else await execute({ name: 'face_user', args: {} });
}

async function thinkBeat() {
  if (!state.acting || !state.character || state.running) {
    scheduleThink();
    return;
  }
  try {
    await ambientBodyBeat();
  } catch (error) {
    if (!isAbortError(error)) setLog(error?.message || String(error));
  } finally {
    if (state.micOn && !state.running) resumeMicSoon();
    scheduleThink();
  }
}

async function enterRole() {
  const name = state.character?.name;
  if (!name) return;
  if (state.inhabitedAs === name && state.acting && !state.running) return;
  interruptAi();
  stopRoleLoop();
  state.playGen += 1;
  state.acting = true;
  state.inhabitedAs = name;
  state.conversing = false;
  state.talk = [];
  setLog(`Вхожу в роль: ${dossierBrief(state.character)}`);
  if (state.aiReady === false) {
    const ok = await pingAi();
    if (!ok) {
      setLog(`${name} выбран, но без модели не живёт сцену.`);
      return;
    }
  }
  state.running = true;
  try {
    placeAvatarOnPlanet(state.character);
    const focus = focusPropId(state.character);
    if (focus) await execute({ name: 'look_at', args: { targetId: focus } });
    await execute({ name: 'face_user', args: {} });
    const plan = await compileAI({
      character: state.character,
      heroLine: '',
      mode: 'think',
      history: [],
      notes: `OPENING. Invent a NEW first line. Props: ${scenePropHint()}. Prefer look_at/point_at a real prop id then speak.`,
    });
    await playPlan(plan, { reply: true });
    const spoken = plan.actions.filter((item) => item.name === 'speak' && item.args?.text).map((item) => item.args.text).join(' ');
    if (spoken) state.talk.push({ role: 'assistant', content: spoken });
    logSession({ kind: 'actor', text: spoken || '', opening: true });
    setLog(spoken
      ? `${name}: ${spoken} — пиши в поле, он ответит новой репликой.`
      : `${name} в кадре. Скажи ему что-нибудь.`);
  } catch (error) {
    if (!isAbortError(error)) setLog(error?.message || String(error));
  } finally {
    state.running = false;
    if (state.micOn) resumeMicSoon();
    scheduleThink();
  }
}

async function run(script, options = {}) {
  if (state.running) throw new Error('Already acting.');
  await waitForRuntime();
  unlockSpeech();
  pauseMic();
  state.running = true;
  setLog(`${state.character?.name || 'Она'} входит в роль…`);
  try {
    const plan = await compile(script, options.preferAI !== false);
    await playPlan(plan);
    const spoken = plan.actions.filter((item) => item.name === 'speak' && item.args?.text).map((item) => item.args.text).join(' ');
    if (spoken) state.talk.push({ role: 'assistant', content: spoken });
    setLog(`${state.character?.name} в кадре. Цель: ${String(state.character?.want || state.character?.meaning || 'сцена').split(/[.!?]/)[0].trim().slice(0, 80)}.`);
    return { ok: true, ...plan };
  } catch (error) {
    if (state.micPending && isAbortError(error)) return { ok: false, aborted: true };
    throw new Error(friendlyAiError(error));
  } finally {
    state.running = false;
    const queued = state.micPending;
    state.micPending = '';
    if (queued) {
      void heroSaid(queued).catch((error) => setLog(error?.message || String(error)));
    } else if (state.micOn) {
      resumeMicSoon();
    }
  }
}

async function heroSaid(text, options = {}) {
  const line = String(text || '').trim();
  if (!line) throw new Error('Say something as the person in VR.');
  if (options.fromMic && micWordCount(line) < 3 && line.replace(/[.…,!?-]/g, '').trim().length < 18) {
    setLog('Слушаю дальше — это был обрывок.');
    return { ok: true, skipped: 'fragment' };
  }
  interruptAi();
  state.playGen += 1;
  if (state.running) {
    // Previous reply still playing — queue one line; ambient no longer holds the lock.
    state.micPending = line;
    setLog(`${state.character?.name || 'Он'} ещё говорит — скажу следом.`);
    return { ok: true, queued: true };
  }
  await waitForRuntime();
  unlockSpeech();
  pauseMic();
  try {
    window.dispatchEvent(new CustomEvent('nova:cinematic-action', { detail: { name: 'face_user', args: {} } }));
    state.scene.executeTool?.('face_user', {});
    window.__novaHumanoid?.play?.('interact');
  } catch {}
  state.running = true;
  state.conversing = true;
  setLog(`${state.character?.name || 'Она'} думает…`);
  try {
    state.talkLang = detectLang(line);
    state.talk.push({ role: 'user', content: line });
    const notes = [state.character?.want, state.character?.meaning, ...(state.character?.goals || [])].filter(Boolean).join(' ');
    const plan = await compileAI({
      character: state.character || LEELOO_DALLAS,
      notes,
      heroLine: line,
      history: state.talk,
      mode: 'reply',
    });
    await playPlan(plan, { reply: true, heroLine: line });
    const spoken = plan.actions.filter((item) => item.name === 'speak' && item.args?.text).map((item) => item.args.text).join(' ');
    if (spoken) state.talk.push({ role: 'assistant', content: spoken });
    logSession({ kind: 'hero', text: line });
    logSession({ kind: 'actor', text: spoken || '' });
    setLog(`${state.character?.name}: ${spoken || 'heard you.'}`);
    return { ok: true, ...plan };
  } catch (error) {
    throw new Error(friendlyAiError(error));
  } finally {
    state.running = false;
    const queued = state.micPending;
    state.micPending = '';
    if (queued) {
      void heroSaid(queued).catch((error) => setLog(error?.message || String(error)));
    } else {
      if (state.micOn) resumeMicSoon();
      if (state.acting) scheduleThink();
    }
  }
}

function pingAi() {
  const endpoint = window.__NOVA_AI_ENDPOINT || './api/chat';
  return fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || `AI HTTP ${response.status}`);
      state.aiReady = true;
      setLog(`Говори с персонажем. Модель: ${data.model || 'ok'}.`);
      refreshModelUi();
      return true;
    })
    .catch((error) => {
      state.aiReady = false;
      setLog(friendlyAiError(error));
      refreshModelUi();
      return false;
    });
}

function setExtrasOpen(open) {
  state.extrasOpen = Boolean(open);
  if (state.extrasOpen) setScenarioOpen(false);
  document.getElementById('cinematic-extras')?.classList.toggle('open', state.extrasOpen);
  const more = document.getElementById('cinematic-more');
  if (more) more.textContent = state.extrasOpen ? 'Голос ▾' : 'Голос';
}

function setScenarioOpen(open) {
  state.scenarioOpen = Boolean(open);
  if (state.scenarioOpen) {
    state.extrasOpen = false;
    document.getElementById('cinematic-extras')?.classList.remove('open');
    const more = document.getElementById('cinematic-more');
    if (more) more.textContent = 'Голос';
  }
  document.getElementById('cinematic-scenario')?.classList.toggle('open', state.scenarioOpen);
  const button = document.getElementById('cinematic-scenario-btn');
  if (button) button.textContent = state.scenarioOpen ? 'Сценарий ▾' : 'Сценарий';
  if (state.scenarioOpen) {
    renderRoster(state.roster);
    renderDossier(state.character);
  }
}

function currentAiMode() {
  const cfg = window.__NovaRuntimeConfig || {};
  if (cfg.transport === 'supabase-groq' || /nova-groq/i.test(String(window.__NOVA_AI_ENDPOINT || ''))) {
    return cfg.serverManaged ? 'vault' : 'user-groq';
  }
  return 'local';
}

function switchAiMode(mode) {
  const url = new URL(window.location.href);
  url.searchParams.set('ai', mode === 'local' ? 'local' : 'user-groq');
  window.location.href = url.toString();
}

function refreshModelUi() {
  const mode = currentAiMode();
  const status = document.getElementById('cinematic-model-status');
  const localBtn = document.getElementById('cinematic-ai-local');
  const groqBtn = document.getElementById('cinematic-ai-groq');
  const connectBtn = document.getElementById('cinematic-ai-connect');
  const groq = window.__NovaGroqAuth?.getState?.() || {};
  localBtn?.classList.toggle('active', mode === 'local');
  groqBtn?.classList.toggle('active', mode !== 'local');
  if (connectBtn) {
    connectBtn.hidden = false;
    if (mode === 'local') {
      connectBtn.textContent = 'Connect Groq';
      connectBtn.classList.toggle('primary', true);
    } else if (groq.generative) {
      connectBtn.textContent = 'Groq OK';
      connectBtn.classList.toggle('primary', false);
    } else {
      connectBtn.textContent = groq.keyPresent ? 'Проверить ключ' : 'Connect';
      connectBtn.classList.toggle('primary', true);
    }
  }
  if (!status) return;
  if (mode === 'local') {
    status.textContent = state.aiReady === false
      ? 'AI: Ollama offline'
      : (state.aiReady ? 'AI: Ollama local' : 'AI: checking Ollama…');
  } else {
    status.textContent = groq.generative ? 'AI: Groq connected' : 'AI: Groq — нужен Connect';
  }
}

function styleUi() {
  if (document.getElementById('cinematic-director-style')) return;
  const style = document.createElement('style');
  style.id = 'cinematic-director-style';
  style.textContent = `
    .cinematic-director { position:fixed; left:16px; bottom:16px; z-index:16; width:min(420px,calc(100vw - 28px)); padding:12px; border:1px solid rgba(255,255,255,.16); border-radius:16px; background:rgba(7,11,18,.88); backdrop-filter:blur(18px); box-shadow:0 18px 50px rgba(0,0,0,.34); color:#eef5ff; font:13px/1.35 system-ui,sans-serif; }
    .cinematic-director .head { display:flex; justify-content:space-between; gap:10px; margin-bottom:8px; font-weight:700; }
    #cinematic-now-playing { font-weight:500; opacity:.7; font-size:12px; }
    .cinematic-director textarea { width:100%; min-height:72px; box-sizing:border-box; resize:vertical; border-radius:11px; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.25); color:#fff; padding:10px; font:inherit; }
    .cinematic-director #cinematic-source { min-height:64px; }
    .cinematic-director input[type=text] { flex:1; min-width:120px; border-radius:10px; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.25); color:#fff; padding:8px 10px; }
    .cinematic-director .pick { display:flex; align-items:center; gap:8px; margin-top:8px; }
    .cinematic-director .pick label { flex:0 0 88px; color:#9db0c6; font-size:12px; font-weight:600; }
    .cinematic-director .pick select { flex:1; min-width:0; max-width:none; }
    .cinematic-director .hint { margin:4px 0 0; color:#8f9bad; font-size:11px; }
    #cinematic-action-list { margin-top:4px; color:#8f9bad; max-height:36px; overflow:hidden; font-size:11px; }
    .cinematic-director .model-row { display:flex; flex-direction:column; gap:8px; margin:4px 0 10px; padding:10px; border-radius:12px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1); }
    .cinematic-director .model-row #cinematic-model-status { color:#c5d6ea; font-size:12px; font-weight:650; }
    .cinematic-director .model-actions { display:flex; flex-wrap:wrap; gap:6px; }
    .cinematic-director .model-row button.active { background:rgba(70,145,255,.42); border-color:rgba(120,180,255,.75); }
    .cinematic-director .talk-row { align-items:stretch; margin-top:8px; }
    .cinematic-director .talk-row input { flex:1 1 160px; }
    .cinematic-director .tools-row { margin-top:8px; opacity:.92; }
    .cinematic-director .pick { margin-top:10px; }
    .cinematic-director .pick label { flex:0 0 48px; }
    .cinematic-director button,.cinematic-director select { border:1px solid rgba(255,255,255,.16); border-radius:10px; padding:8px 11px; background:#171d27; color:#fff; cursor:pointer; }
    .cinematic-director button.primary { background:rgba(70,145,255,.28); }
    .cinematic-director button.mic-on { background:rgba(70,145,255,.42); border-color:rgba(120,180,255,.7); }
    .cinematic-director #cinematic-voice { flex:1; min-width:160px; }
    .cinematic-director .rate { display:flex; align-items:center; gap:8px; color:#c5d0de; font-size:12px; }
    .cinematic-director input[type=range] { width:110px; }
    #cinematic-director-log { margin-top:8px; color:#b9d5ff; min-height:2.6em; max-height:4.4em; overflow:auto; }
    #cinematic-extras, #cinematic-scenario { display:none; margin-top:10px; max-height:min(48vh,440px); overflow:auto; padding-top:4px; border-top:1px solid rgba(255,255,255,.08); }
    #cinematic-extras.open, #cinematic-scenario.open { display:block; }
    .scenario-split { display:grid; grid-template-columns: minmax(120px,38%) 1fr; gap:10px; margin-top:8px; }
    .cinematic-roster { max-height:32vh; overflow:auto; display:flex; flex-direction:column; gap:6px; }
    .cinematic-roster .roster-card { text-align:left; width:100%; padding:8px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.12); cursor:pointer; display:flex; flex-wrap:wrap; gap:4px 8px; align-items:center; }
    .cinematic-roster .roster-card.active { border-color:rgba(120,180,255,.75); background:rgba(70,145,255,.16); }
    .cinematic-roster .roster-card strong { display:block; font-size:13px; width:100%; }
    .cinematic-roster .roster-card .aliases { color:#9db0c6; font-size:11px; margin:2px 0 4px; }
    .cinematic-roster .ai-mini { font-size:10px; font-weight:600; opacity:.8; }
    .cinematic-roster .ai-mini.ready { color:#9fd49f; }
    .cinematic-roster .ai-mini.thin { color:#d4b56a; }
    #cinematic-dossier { padding:8px 10px; border:1px solid rgba(255,255,255,.1); border-radius:12px; background:rgba(0,0,0,.2); }
    #cinematic-dossier h3 { margin:8px 0 4px; font-size:15px; }
    #cinematic-dossier .aliases { color:#9db0c6; font-size:11px; margin-bottom:8px; }
    #cinematic-dossier .field { margin:0 0 6px; color:#d7e3f2; font-size:12px; line-height:1.35; }
    #cinematic-dossier .field .k { display:block; color:#8f9bad; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; margin-bottom:1px; }
    #cinematic-dossier .field.empty { opacity:.55; }
    .ai-flag { font-size:12px; font-weight:600; padding:6px 8px; border-radius:8px; }
    .ai-flag.ready { background:rgba(60,140,80,.28); color:#c8f0c8; }
    .ai-flag.thin { background:rgba(140,110,40,.28); color:#f0e0a8; }
    .cinematic-roster .badge, #cinematic-dossier .badge { display:inline-block; margin-left:0; font-size:10px; font-weight:600; opacity:.7; }
    html.walk-mode .cinematic-director { width:min(340px,calc(100vw - 24px)); opacity:.94; }
    html.walk-mode #cinematic-extras, html.walk-mode #cinematic-more, html.walk-mode #cinematic-scenario, html.walk-mode #cinematic-scenario-btn { display:none !important; }
    #walk-mic-hud, #walk-stereo-hud, #walk-rec-hud { display:none; position:fixed; top:16px; z-index:80; border:1px solid rgba(255,255,255,.2); border-radius:999px; padding:8px 14px; background:rgba(7,11,18,.88); color:#fff; cursor:pointer; font:13px system-ui,sans-serif; }
    #walk-mic-hud { right:16px; }
    #walk-stereo-hud { right:148px; }
    #walk-rec-hud { right:248px; }
    #walk-mic-hud.mic-on, #walk-stereo-hud.mic-on, #walk-rec-hud.mic-on { background:rgba(70,145,255,.5); }
    html.walk-mode #walk-mic-hud, html.walk-mode #walk-stereo-hud, html.walk-mode #walk-rec-hud { display:block; }
    @media(max-width:760px){.cinematic-director{left:10px;bottom:10px;width:calc(100vw - 20px)}.scenario-split{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}


function sessionPayload() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    startedAt: state.sessionStartedAt ? new Date(state.sessionStartedAt).toISOString() : null,
    scenarioId: state.scenarioId,
    placeId: state.placeId,
    character: state.character?.name || '',
    roster: (state.roster || []).map((item) => item.name),
    talk: state.talk || [],
    log: state.sessionLog || [],
  };
}

function downloadSessionJson() {
  const blob = new Blob([JSON.stringify(sessionPayload(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `nova-session-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function setSessionButton(on) {
  const button = document.getElementById('cinematic-session');
  if (!button) return;
  button.textContent = on ? '■ Сессия' : '● Сессия';
  button.classList.toggle('mic-on', Boolean(on));
}

async function toggleSession() {
  if (state.sessionOn) {
    state.sessionOn = false;
    logSession({ kind: 'session', text: 'stop' });
    try {
      if (window.__novaVR180?.viewRecording) window.__novaVR180.stopViewRecording();
    } catch (error) {
      console.warn(error);
    }
    downloadSessionJson();
    setSessionButton(false);
    setLog(`Сессия сохранена (${state.sessionLog.length} событий).`);
    return;
  }
  state.sessionOn = true;
  state.sessionLog = [];
  state.sessionStartedAt = Date.now();
  logSession({ kind: 'session', text: 'start', scenarioId: state.scenarioId });
  setSessionButton(true);
  setLog('Сессия пишется: диалог + действия. Стоп — скачает JSON (и VR180, если шла запись).');
  try {
    if (window.__novaVR180 && !window.__novaVR180.viewRecording) {
      window.__novaVR180.startViewRecording?.();
    }
  } catch (error) {
    console.warn('VR180 session record skipped', error);
  }
}

function buildUi() {
  if (document.getElementById('cinematic-director')) return;
  styleUi();
  const panel = document.createElement('section');
  panel.id = 'cinematic-director';
  panel.className = 'cinematic-director';
  panel.innerHTML = `
    <div class="head"><span>Nova</span><span id="cinematic-now-playing">роль не выбрана</span></div>
    <div class="model-row" id="cinematic-model-row">
      <span id="cinematic-model-status">AI: …</span>
      <div class="model-actions">
        <button id="cinematic-ai-local" type="button">Ollama</button>
        <button id="cinematic-ai-groq" type="button">Groq</button>
        <button id="cinematic-ai-connect" class="primary" type="button">Connect Groq</button>
      </div>
    </div>
    <div class="pick">
      <label for="cinematic-character">Роль</label>
      <select id="cinematic-character"></select>
    </div>
    <div class="row talk-row">
      <input id="cinematic-hero" type="text" placeholder="Реплика героя…" />
      <button id="cinematic-hero-send" class="primary" type="button">Сказать</button>
      <button id="cinematic-hero-mic" type="button">Мик</button>
    </div>
    <div id="cinematic-director-log">Проверяю модель…</div>
    <div class="row tools-row">
      <button id="cinematic-scenario-btn" type="button">Сценарий</button>
      <button id="cinematic-walk" type="button">VR</button>
      <button id="cinematic-session" type="button">● Сессия</button>
      <button id="cinematic-more" type="button">Голос</button>
    </div>
    <div id="cinematic-action-list"></div>
    <div id="cinematic-scenario">
      <div class="pick">
        <label for="cinematic-scenario-pick">Сценарий</label>
        <select id="cinematic-scenario-pick">
          <option value="little-prince">Маленький принц</option>
          <option value="pasha-demo">Demo Паша</option>
          <option value="custom">Свой текст…</option>
        </select>
      </div>
      <p class="hint" id="cinematic-scenario-hint">Пример по умолчанию: роли и планеты уже собраны. Выбери роль сверху — или загрузи свой текст.</p>
      <textarea id="cinematic-source" placeholder="Свой текст: вставь главу или загрузи файл — разбор ролей и карточек."></textarea>
      <div class="row">
        <input id="cinematic-file" type="file" accept=".txt,.md,.text,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
        <button id="cinematic-parse" type="button">Разобрать</button>
      </div>
      <div class="pick">
        <label for="cinematic-place">Мир / зона</label>
        <select id="cinematic-place"></select>
      </div>
      <p class="hint"><a href="/scenario/" style="color:#9ec1ff">Мастерская</a> — править карточки вручную, потом «В VR».</p>
      <div class="scenario-split">
        <div id="cinematic-roster" class="cinematic-roster"></div>
        <div id="cinematic-dossier"></div>
      </div>
    </div>
    <div id="cinematic-extras">
      <div class="row">
        <select id="cinematic-voice"></select>
        <label class="rate">скорость <input id="cinematic-rate" type="range" min="0.7" max="1.15" step="0.05" /><span id="cinematic-rate-val">0.92×</span></label>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  const hud = document.createElement('button');
  hud.id = 'walk-mic-hud';
  hud.type = 'button';
  hud.textContent = 'M · микрофон';
  document.body.appendChild(hud);
  const stereoHud = document.createElement('button');
  stereoHud.id = 'walk-stereo-hud';
  stereoHud.type = 'button';
  stereoHud.textContent = '2 глаза';
  document.body.appendChild(stereoHud);
  const recHud = document.createElement('button');
  recHud.id = 'walk-rec-hud';
  recHud.type = 'button';
  recHud.textContent = '● запись';
  document.body.appendChild(recHud);
  state.roster = [LEELOO_DALLAS];
  state.character = LEELOO_DALLAS;
  fillRosterSelect(state.roster);
  fillPlaceSelect();
  const source = panel.querySelector('#cinematic-source');
  const hero = panel.querySelector('#cinematic-hero');
  panel.querySelector('#cinematic-character').addEventListener('change', (event) => {
    selectCharacter(event.target.value, { rebuild: false, inhabit: true });
  });
  panel.querySelector('#cinematic-ai-local')?.addEventListener('click', () => {
    if (currentAiMode() === 'local') { refreshModelUi(); return; }
    switchAiMode('local');
  });
  panel.querySelector('#cinematic-ai-groq')?.addEventListener('click', () => {
    if (currentAiMode() !== 'local') { refreshModelUi(); return; }
    switchAiMode('user-groq');
  });
  panel.querySelector('#cinematic-ai-connect')?.addEventListener('click', async () => {
    if (currentAiMode() === 'local') {
      try { sessionStorage.setItem('nova_autconnect_groq', '1'); } catch {}
      setLog('Переключаю на Groq…');
      switchAiMode('user-groq');
      return;
    }
    const auth = window.__NovaGroqAuth;
    if (!auth?.connect) {
      setLog('Groq auth не загружен. Обнови страницу.');
      return;
    }
    setLog('Подключаю Groq…');
    await auth.connect();
    refreshModelUi();
    const ok = auth.getState?.()?.generative;
    setLog(ok ? 'Groq готов — говори с персонажем.' : 'Groq не подключился. Ключ: console.groq.com/keys');
  });
  try {
    if (sessionStorage.getItem('nova_autconnect_groq') === '1' && currentAiMode() !== 'local') {
      sessionStorage.removeItem('nova_autconnect_groq');
      setTimeout(async () => {
        const auth = window.__NovaGroqAuth;
        if (!auth?.connect) return;
        setLog('Подключаю Groq…');
        await auth.connect();
        refreshModelUi();
      }, 400);
    }
  } catch {}
  refreshModelUi();
  panel.querySelector('#cinematic-scenario-pick')?.addEventListener('change', (event) => {
    const value = event.target.value;
    if (value === 'little-prince') {
      loadLittlePrinceDefault({ inhabit: false, openPanel: true });
      return;
    }
    if (value === 'pasha-demo') {
      loadPashaDemo({ inhabit: false, openPanel: true });
      return;
    }
    state.scenarioId = 'custom';
    const hint = document.getElementById('cinematic-scenario-hint');
    if (hint) hint.textContent = 'Вставь главу или файл и нажми «Разобрать» — роли и зоны соберутся из текста.';
    setScenarioOpen(true);
    setLog('Свой сценарий: вставь текст или файл, затем «Разобрать».');
  });
  panel.querySelector('#cinematic-place').addEventListener('change', (event) => {
    selectPlace(event.target.value, { rebuild: true });
  });
  panel.querySelector('#cinematic-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setLog(`Reading ${file.name}…`);
      const loaded = await loadScriptFile(file);
      source.value = loaded.text;
      setLog(`Файл ${loaded.name} в сценарии. Разбираю…`);
      panel.querySelector('#cinematic-parse')?.click();
    } catch (error) {
      setLog(`Could not read file: ${error?.message || error}`);
    }
  });
  panel.querySelector('#cinematic-parse').addEventListener('click', async () => {
    const button = panel.querySelector('#cinematic-parse');
    const excerpt = String(source.value || '').trim();
    if (excerpt.length < 80) {
      setScenarioOpen(true);
      setLog('В «Сценарии» вставь главу или файл и нажми «Разобрать».');
      return;
    }
    if (button) button.disabled = true;
    try {
      setLog('Разбираю персонажей… лог здесь, комната перестроится только после успеха.');
      const data = await parseSource(excerpt);
      applyScenarioPack(data, { sourceText: excerpt, inhabit: false });
      const extra = data.truncated ? ' Текст обрезан — лучше одна глава.' : '';
      const how = data.usedLlm ? 'роли и связи из модели' : 'только имена из текста — модель не заполнила карточки';
      setLog(`Роли собраны (${how}). ${data.characters.length} персонажей. Выбери роль — встанет на планету и заговорит.${extra}`);
    } catch (error) {
      setLog(`Разбор не вышел: ${error?.message || error}`);
    } finally {
      if (button) button.disabled = false;
    }
  });
  panel.querySelector('#cinematic-more')?.addEventListener('click', () => setExtrasOpen(!state.extrasOpen));
  panel.querySelector('#cinematic-scenario-btn')?.addEventListener('click', () => setScenarioOpen(!state.scenarioOpen));
  panel.querySelector('#cinematic-walk')?.addEventListener('click', () => toggleWalkMode());
  panel.querySelector('#cinematic-session')?.addEventListener('click', () => { void toggleSession(); });
  document.getElementById('walk-button')?.addEventListener('click', () => toggleWalkMode());
  document.getElementById('walk-stereo-hud')?.addEventListener('click', () => {
    setStereoView(!document.documentElement.classList.contains('vr-sbs'));
  });
  document.getElementById('walk-rec-hud')?.addEventListener('click', () => toggleViewRecord());
  window.addEventListener('nova:walk-mode', (event) => {
    const on = Boolean(event.detail?.enabled);
    setWalkButtons(on);
    if (!on) {
      try { window.__novaVR180?.stopViewRecording?.(); } catch {}
      setStereoView(false);
    }
  });
  window.addEventListener('nova:view-record', (event) => setRecHud(Boolean(event.detail?.on)));
  panel.querySelector('#cinematic-hero-send').addEventListener('click', async () => {
    try {
      await heroSaid(hero.value);
      hero.value = '';
    } catch (error) { setLog(error?.message || String(error)); }
  });
  hero.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') panel.querySelector('#cinematic-hero-send').click();
  });
  bindMic();
  bindVoiceUi();
}

async function init() {
  try {
    try { window.speechSynthesis?.getVoices?.(); } catch {}
    await waitForRuntime();
    hideLabBits();
    buildUi();
    const hadWorkshop = Boolean((() => { try { return localStorage.getItem(SCENARIO_PACK_KEY); } catch { return null; } })());
    loadWorkshopPack();
    if (!hadWorkshop) loadLittlePrinceDefault({ inhabit: false, openPanel: false });
    fillVoiceSelect();
    applyCharacterBody(state.character || state.roster[0] || LEELOO_DALLAS);
    const aiOk = await pingAi();
    applyCharacterBody(state.character || state.roster[0] || LEELOO_DALLAS);
    if (aiOk) {
      setLog(state.scenarioId === 'little-prince'
        ? 'Маленький принц готов. Выбери роль — персонаж заживёт и будет отвечать тебе.'
        : 'Выбери роль — персонаж заживёт и будет отвечать тебе.');
    }
    const demo = new URLSearchParams(window.location.search).get('demo');
    if (demo === 'pasha') {
      loadPashaDemo({ inhabit: true, openPanel: true });
    }
    window.addEventListener('nova:humanoid-ready', () => {
      applyCharacterBody(state.character || LEELOO_DALLAS);
    });
    window.__novaCinematicDirectorReady = true;
  }
  catch (error) { console.error('Cinematic director init failed:', error); }
}

window.__novaCinematicDirector = {
  run, compile, execute, heroSaid, parseSource, getVoiceTracks,
  get ready() { return Boolean(window.__novaCinematicDirectorReady); },
  get running() { return state.running; },
  get character() { return state.character; },
};
void init();
