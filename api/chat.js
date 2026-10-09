import { generateText } from 'ai';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import { extractText as extractPdfText } from 'unpdf';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

import {
  parseScenario,
  guessCharactersFromText,
  enrichCharacterFromText,
  mergeCharacters,
  attachPronouns,
  normalizeCharacter,
  normalizePersonName,
  tidyPersonName,
  roleCanon,
  isCharacterLabel,
  isPronounSlot,
  rowsFromParse,
  attachZones,
  fitWorldToCharacters,
  worldFromMood,
  guessMood,
  isLittlePrinceText,
  littlePrinceWorld,
  overlayLittlePrinceCards,
} from '../scenario/parse.mjs';


const GATEWAY_MODEL = process.env.NOVA_AI_GATEWAY_MODEL || 'openai/gpt-oss-20b';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.NOVA_OLLAMA_MODEL || 'nova-prince';
const OLLAMA_MODEL_FALLBACK = process.env.NOVA_OLLAMA_FALLBACK || 'qwen2.5:7b';
const GROQ_VAULT = process.env.NOVA_GROQ_VAULT || 'https://ugjjifmlivdufshkhmpa.supabase.co/functions/v1/nova-groq-vault';
// Layers on GPU. Default: all (-1). Set NOVA_OLLAMA_NUM_GPU=0 to force CPU.
const OLLAMA_NUM_GPU = Number.parseInt(process.env.NOVA_OLLAMA_NUM_GPU ?? '-1', 10);

let resolvedOllamaModel = OLLAMA_MODEL;
let resolvedExtractModel;
async function resolveOllamaModel() {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const data = await response.json().catch(() => ({}));
    const names = (data.models || []).map((item) => item.name);
    const want = OLLAMA_MODEL;
    const has = (name) => names.some((n) => n === name || n.startsWith(`${name}:`) || n.startsWith(`${String(name).split(':')[0]}:`));
    if (has(want)) { resolvedOllamaModel = want; return want; }
    if (has(OLLAMA_MODEL_FALLBACK)) { resolvedOllamaModel = OLLAMA_MODEL_FALLBACK; return OLLAMA_MODEL_FALLBACK; }
    resolvedOllamaModel = names[0] || want;
    return resolvedOllamaModel;
  } catch {
    resolvedOllamaModel = OLLAMA_MODEL_FALLBACK;
    return resolvedOllamaModel;
  }
}

async function resolveExtractModel() {
  if (resolvedExtractModel !== undefined) return resolvedExtractModel;
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const data = await response.json().catch(() => ({}));
    const names = (data.models || []).map((item) => item.name).filter(Boolean);
    const has = (want) => names.some((n) => n === want || n.startsWith(`${want}:`) || n.startsWith(`${String(want).split(':')[0]}:`));
    if (has(OLLAMA_MODEL_FALLBACK)) {
      resolvedExtractModel = OLLAMA_MODEL_FALLBACK;
      return resolvedExtractModel;
    }
    const other = names.find((n) => n && !String(n).toLowerCase().startsWith('nova-prince'));
    resolvedExtractModel = other || '';
    return resolvedExtractModel;
  } catch {
    resolvedExtractModel = '';
    return '';
  }
}

const useOllama = () => !process.env.VERCEL && !process.env.AI_GATEWAY_API_KEY;
const ALLOWED_ACTIONS = new Set([
  'look_at',
  'point_at',
  'face_user',
  'raise_hand',
  'lower_hand',
  'wave',
  'step',
  'turn_body',
  'neutral_pose',
  'approach_user',
  'walk_to',
  'pick_up',
  'sit',
  'stand',
  'speak',
  'pause',
  'create_object',
  'delete_object',
  'move_object',
]);
const FORBIDDEN_TARGETS = new Set(['device', 'red_button', 'filter']);
    const BUILTIN_TARGETS = new Set([
  'actor_window',
  'actor_table',
  'actor_chair',
  'actor_glass',
  'element_water',
  'element_fire',
  'element_earth',
  'element_air',
]);
const TARGET_ID_RE = /^[a-z0-9а-яё_-]{1,64}$/i;

const NEURAL_VOICES = [
  { id: 'en-US-AvaMultilingualNeural', lang: 'ru', label: 'Ava Multilingual — актриса, русский и английский' },
  { id: 'en-US-EmmaMultilingualNeural', lang: 'ru', label: 'Emma Multilingual — мягкая актриса' },
  { id: 'ru-RU-SvetlanaNeural', lang: 'ru', label: 'Светлана Neural — русская актриса' },
  { id: 'ru-RU-DmitryNeural', lang: 'ru', label: 'Дмитрий Neural — русский актёр' },
  { id: 'en-US-BrianMultilingualNeural', lang: 'en', label: 'Brian Multilingual — актёр, много языков' },
  { id: 'en-US-AndrewMultilingualNeural', lang: 'en', label: 'Andrew Multilingual — актёр' },
  { id: 'en-US-AvaNeural', lang: 'en', label: 'Ava Neural — cinematic EN' },
  { id: 'en-US-AriaNeural', lang: 'en', label: 'Aria Neural — cinematic EN' },
  { id: 'en-US-JennyNeural', lang: 'en', label: 'Jenny Neural — natural EN' },
  { id: 'en-US-MichelleNeural', lang: 'en', label: 'Michelle Neural — тёплая EN' },
  { id: 'en-GB-SoniaNeural', lang: 'en', label: 'Sonia Neural — британская актриса' },
];

function pickNeuralVoice(requested, locale = 'ru') {
  const id = String(requested || '').replace(/^neural:/, '').trim();
  if (NEURAL_VOICES.some((item) => item.id === id)) return id;
  return String(locale).toLowerCase().startsWith('en') ? 'en-US-AvaNeural' : 'en-US-AvaMultilingualNeural';
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

let edgeTts = null;
let edgeVoice = '';

async function getEdgeTts(voice) {
  if (edgeTts && edgeVoice === voice) return edgeTts;
  try { edgeTts?.close?.(); } catch {}
  edgeTts = null;
  edgeVoice = '';
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  edgeTts = tts;
  edgeVoice = voice;
  return tts;
}

async function synthesizeNeural(text, voice, rate = 0.92) {
  const speak = async (tts) => {
    const { audioStream } = tts.toStream(String(text || '').slice(0, 700), { rate: Number(rate) || 0.92 });
    const buffer = await streamToBuffer(audioStream);
    if (!buffer.length) throw new Error('Empty TTS audio');
    return buffer;
  };
  try {
    return await speak(await getEdgeTts(voice));
  } catch {
    try { edgeTts?.close?.(); } catch {}
    edgeTts = null;
    edgeVoice = '';
    return speak(await getEdgeTts(voice));
  }
}

async function handleTts(req, res) {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, voices: NEURAL_VOICES, defaultVoice: 'en-US-AvaMultilingualNeural' }));
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'GET or POST' }));
    return;
  }
  const body = await readBody(req, 80_000);
  const text = String(body.text || '').trim();
  if (text.length < 1) throw new Error('No text to speak.');
  const voice = pickNeuralVoice(body.voice, body.locale || 'ru');
  const rate = Math.max(0.7, Math.min(1.15, Number(body.rate) || 0.92));
  const audio = await synthesizeNeural(text, voice, rate);
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-store',
    'X-Nova-Voice': voice,
  });
  res.end(audio);
}

function actingCharacter(raw) {
  const base = normalizeCharacter(raw);
  if (!raw || typeof raw !== 'object') return base;
  if (!base) return raw;
  const knowledge = Array.isArray(raw.knowledge)
    ? raw.knowledge.map((item) => String(item || '').slice(0, 160)).filter(Boolean).slice(0, 8)
    : base.knowledge;
  return {
    ...base,
    mission: String(raw.mission || base.want || '').slice(0, 320),
    worries: Array.isArray(raw.worries) ? raw.worries.map((item) => String(item).slice(0, 160)).slice(0, 4) : [],
    vocabulary: Array.isArray(raw.vocabulary) ? raw.vocabulary.map((item) => String(item).slice(0, 40)).slice(0, 12) : [],
    emotions: raw.emotions && typeof raw.emotions === 'object' ? raw.emotions : {},
    history: String(raw.history || '').slice(0, 280),
    background: String(raw.background || '').slice(0, 200),
    species: String(raw.species || '').slice(0, 40),
    embodiment: raw.embodiment && typeof raw.embodiment === 'object' ? raw.embodiment : null,
    homeProp: String(raw.homeProp || '').slice(0, 64),
    appearance: raw.appearance || base.appearance,
    knowledge,
    talkThemes: Array.isArray(raw.talkThemes) ? raw.talkThemes.slice(0, 8) : base.talkThemes,
    memory: String(raw.memory || base.memory || '').slice(0, 900),
    scenarioBeat: String(raw.scenarioBeat || '').slice(0, 160),
  };
}

function actingManner(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^говорит:\s*[«"']/i.test(text)) return '';
  if (/не ассистент|не читать ТЗ|не говорить\s*«?Готово/i.test(text)) return '';
  return text.slice(0, 120);
}

function foldSpeechText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim();
}

function isAssistantLeak(text) {
  return /я\s*(nova|нова)\b|виртуальн\w*\s+помощник|чем могу помочь|as an AI|языковая модель|i['’]m nova|your virtual assistant/i.test(String(text || ''));
}

async function generateVaultLine(system, prompt, character) {
  const response = await fetch(GROQ_VAULT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      message: `${system}\n\n${prompt}\nНельзя представляться Новой, ИИ или помощником.`,
      mode: 'reply',
      locale: 'ru-RU',
      character,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `Groq HTTP ${response.status}`);
  return String(
    data.text
    || data.extendedActions?.find((item) => item?.name === 'speak')?.args?.text
    || '',
  );
}

async function generateActingLine(system, prompt, options, character) {
  if (useOllama()) {
    try {
      return await generateOllama(system, prompt, options);
    } catch (error) {
      console.warn('Ollama failed, vault fallback:', error?.message || error);
    }
  }
  return generateVaultLine(system, prompt, character);
}

function isCardRecitation(text, character = {}) {
  const spoken = foldSpeechText(text);
  if (!spoken) return true;
  if (/не ассистент|не пересказывать|не держать светск|не читать тз|не говорить готово|не болтать/i.test(spoken)) return true;
  if (/^(want|mission|arc|worries|who|memory|never|facts|scene beat|хочет|миссия|запрет|характер|подтекст)\b/i.test(String(text || '').trim())) return true;
  if (/роль |миссия |хочет |беспокоится /.test(`${spoken} `)) return true;
  const cards = [character.want, character.mission, character.forbidden, character.meaning]
    .map(foldSpeechText)
    .filter((item) => item.length >= 16);
  return cards.some((item) => spoken === item || spoken.includes(item.slice(0, 40)));
}

function buildSystem(character, locale, mode, scene, history) {
  const name = character?.name || 'this person';
  const reply = mode === 'reply';
  const idle = mode === 'idle';
  const want = String(character?.want || character?.mission || (character?.goals || [])[0] || '').slice(0, 160);
  const manner = actingManner(character?.speechManner) || 'коротко, по делу, как живой человек';
  const role = String(character?.role || name).slice(0, 40);
  const talk = (history || [])
    .slice(-4)
    .map((item) => `${item.role === 'user' ? 'OTHER' : 'YOU'}: ${String(item.content || '').slice(0, 120)}`)
    .join('\n');
  const props = (scene?.visibleTargets || scene?.objects || [])
    .map((item) => item.id || item.label)
    .filter(Boolean)
    .slice(0, 8)
    .join(', ');
  if (idle) {
    return `You ARE ${name}. Silent ambient beat in VR. No speech.
Prefer face_user / look_at. Avoid long walks away from the viewer.
Return ONLY JSON: {"text":"","do":"look_at|walk_to|approach_user|face_user","target":"prop id"}`;
  }
  if (reply) {
    const ru = !/^en/i.test(String(locale || 'ru'));
    if (ru) {
      return `Ты — ${name}${role && role !== name ? `, ${role}` : ''}. Живой разговор в сцене.
Ответь на то, что человек только что сказал. Одна короткая фраза на русском.
Карточка роли — подтекст: играй из неё, не читай вслух миссию, хотелки, запреты, характер, JSON.
Как говоришь: ${manner}
Никогда не говори, что ты Нова, ИИ, ассистент или виртуальный помощник. Ты ${name}.
Диалог:
${talk || '(только что встретились)'}
Только речь персонажа, без кавычек и ремарок.`;
    }
    return `You ARE ${name}. Answer what they just said. One short spoken sentence.
Play the role. Do not recite the card, mission, wants, or JSON.
How you speak: ${manner}
Talk:
${talk || '(they just arrived)'}
Spoken words only.`;
  }
  return `You ARE ${name} (${role}). You live this scene with the human in VR. Not a chatbot, not a narrator.
Private impulse (do not say it): ${want || 'stay present with this person'}
How you speak: ${manner}
Props: ${props || 'none'}
Conversation:
${talk || '(start)'}
One living sentence. Do not read the card aloud. Never say you are an AI. Never answer with only «Готово».
Language ${locale}. ONLY JSON: {"text":"1 short sentence","do":"look_at|point_at|walk_to|approach_user|face_user","target":"exact prop id from Props"}`;
}

function spokenLine(raw, characterName = '', character = {}) {
  let text = String(raw || '').trim();
  if (!text) return '';
  const parsed = extractJson(text);
  if (parsed) {
    const fromJson = parsed.text
      || parsed.extendedActions?.find((item) => item?.name === 'speak')?.args?.text
      || parsed.actions?.find((item) => item?.name === 'speak')?.args?.text;
    if (fromJson) text = String(fromJson).trim();
    else if (/^\s*[{\[]/.test(text)) return '';
  }
  text = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const name = String(characterName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (name) text = text.replace(new RegExp(`^${name}\\s*[:—\\-]\\s*`, 'i'), '');
  text = text.replace(/^["«“]+|[»"”]+$/g, '').trim();
  if (/^[.…\-\s]+$/.test(text)) return '';
  if (/^готово\b/i.test(text) || /^(ready|ok|done)\.?$/i.test(text)) return '';
  if (/^(WANT:|MISSION:|ONLY JSON|Return ONLY|face_user|Хочет:|Миссия:)/i.test(text)) return '';
  const parts = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const keep = parts.filter((s) => !/WANT:|MISSION:|ONLY JSON|face_user|Props:|Return ONLY|as an AI|как ИИ|не ассистент|Хочет:|Миссия:/i.test(s));
  text = (keep.length ? keep : parts).join(' ').trim();
  text = text.replace(/^["«“]+|[»"”]+$/g, '').trim();
  if (isCardRecitation(text, character)) return '';
  if (isAssistantLeak(text)) return '';
  const words = text.split(/\s+/).filter(Boolean).slice(0, 36);
  return words.join(' ').slice(0, 280);
}

function sanitizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
    .slice(-12)
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 320) }))
    .filter((item) => item.content);
}

function safeTargetId(value) {
  const id = String(value || '').trim();
  if (FORBIDDEN_TARGETS.has(id)) return '';
  return TARGET_ID_RE.test(id) && !id.startsWith('__') ? id : '';
}

function resolveKnownTarget(rawId, targetIds) {
  const id = safeTargetId(rawId);
  if (!id) return '';
  if (targetIds.has(id)) return id;
  const prefixed = id.startsWith('user_') ? id : `user_${id}`;
  if (targetIds.has(prefixed)) return prefixed;
  for (const existing of targetIds) {
    if (existing === prefixed || existing.endsWith(`_${id}`) || existing.includes(id)) return existing;
  }
  return '';
}

function collectSceneTargetIds(value) {
  const ids = new Set(BUILTIN_TARGETS);
  const add = (item) => {
    const id = safeTargetId(item?.id || item?.targetId);
    if (id) ids.add(id);
  };
  if (Array.isArray(value?.visibleTargets)) value.visibleTargets.forEach(add);
  if (Array.isArray(value?.objects)) value.objects.forEach(add);
  if (Array.isArray(value?.editableWorld?.dynamicObjectIds)) {
    value.editableWorld.dynamicObjectIds.forEach((id) => {
      const safe = safeTargetId(id);
      if (safe) ids.add(safe);
    });
  }
  return ids;
}

function sanitizeScene(value) {
  if (!value || typeof value !== 'object') return {};
  const targetIds = collectSceneTargetIds(value);
  const visibleTargets = Array.isArray(value.visibleTargets)
    ? value.visibleTargets
        .filter((item) => item && targetIds.has(item.id))
        .sort((a, b) => Number(Boolean(b.dynamic)) - Number(Boolean(a.dynamic)))
        .slice(0, 24)
        .map((item) => ({
          id: item.id,
          label: typeof item.label === 'string' ? item.label.slice(0, 80) : item.id,
          distance: Number.isFinite(Number(item.distance)) ? Number(item.distance) : null,
        }))
    : [];
  return {
    gazeTarget: targetIds.has(value.gazeTarget) ? value.gazeTarget : null,
    visibleTargets,
    task: { name: 'cinematic_actor', step: 'perform' },
    objects: Array.isArray(value.objects)
      ? value.objects
          .filter((item) => item && targetIds.has(item.id))
          .sort((a, b) => Number(Boolean(b.dynamic)) - Number(Boolean(a.dynamic)))
          .slice(0, 24)
          .map((item) => ({
            id: item.id,
            label: typeof item.label === 'string' ? item.label.slice(0, 80) : item.id,
            dynamic: Boolean(item.dynamic),
            position: item.position || null,
            distanceFromAvatar: Number.isFinite(Number(item.distanceFromAvatar)) ? Number(item.distanceFromAvatar) : null,
            relativeToAvatar: item.relativeToAvatar || null,
          }))
      : [],
    editableWorld: {
      dynamicObjectIds: Array.isArray(value.editableWorld?.dynamicObjectIds)
        ? value.editableWorld.dynamicObjectIds.map((id) => safeTargetId(id)).filter(Boolean).slice(0, 24)
        : [],
      lastCreatedId: safeTargetId(value.editableWorld?.lastCreatedId) || null,
    },
  };
}

function sanitizeToolResults(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-10).map((item) => ({
    action: {
      name: typeof item?.action?.name === 'string' ? item.action.name.slice(0, 40) : 'unknown',
      args: item?.action?.args && typeof item.action.args === 'object' ? item.action.args : {},
    },
    result: {
      ok: Boolean(item?.result?.ok),
      error: typeof item?.result?.error === 'string' ? item.result.error.slice(0, 100) : null,
      targetId: safeTargetId(item?.result?.targetId) || null,
      taskStep: ['reset_required', 'filter_required', 'complete'].includes(item?.result?.taskStep)
        ? item.result.taskStep
        : null,
    },
  }));
}

function normalizeAction(raw, targetIds, characterName = '') {
  if (!raw || typeof raw !== 'object' || !ALLOWED_ACTIONS.has(raw.name)) return null;
  if (['press_button', 'remove_filter'].includes(raw.name)) return null;
  const args = raw.args && typeof raw.args === 'object' ? { ...raw.args } : {};
  if (FORBIDDEN_TARGETS.has(args.targetId)) return null;

  if (['look_at', 'point_at', 'walk_to', 'pick_up', 'delete_object', 'move_object'].includes(raw.name)) {
    const resolved = resolveKnownTarget(args.targetId || args.id, targetIds);
    if (['look_at', 'point_at', 'walk_to', 'pick_up'].includes(raw.name) && !resolved) return null;
    if (resolved) args.targetId = resolved;
  }
  if (raw.name === 'approach_user') {
    const gap = Number(args.distanceFromUser ?? args.gap);
    if (Number.isFinite(gap)) args.distanceFromUser = Math.max(0.9, Math.min(2.6, gap));
  }
  if (raw.name === 'create_object') {
    const shape = String(args.shape || 'box').toLowerCase();
    args.shape = ['box', 'sphere', 'cylinder', 'cone'].includes(shape) ? shape : 'box';
    args.color = String(args.color || args.colour || 'blue').trim().slice(0, 24);
    args.label = String(args.label || args.name || 'object').trim().slice(0, 80);
    if (args.direction) args.direction = String(args.direction).trim().slice(0, 24);
    const distance = Number(args.distance);
    if (Number.isFinite(distance)) args.distance = Math.max(0.65, Math.min(3.2, distance));
  }
  if (raw.name === 'delete_object' || raw.name === 'move_object') {
    const id = safeTargetId(args.targetId || args.id);
    if (!id) return null;
    args.targetId = id;
  }
  if (raw.name === 'speak') {
    const as = String(args.as || args.role || 'self').toLowerCase();
    if (as === 'hero') return null;
    const text = String(args.text || '').trim().slice(0, 700);
    if (!text) return null;
    args.text = text;
    args.as = as === 'other' ? 'other' : 'self';
    args.character = String(characterName || args.character || 'Nova').trim().slice(0, 40);
  }
  if (raw.name === 'pause') {
    args.ms = Math.max(80, Math.min(2800, Number(args.ms || 450)));
  }
  return { name: raw.name, args };
}

function extractJson(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function normalizeModelReply(parsed, scene, characterName = '') {
  if (!parsed || typeof parsed !== 'object') return null;
  const targetIds = collectSceneTargetIds(scene);
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.map((action) => normalizeAction(action, targetIds, characterName)).filter(Boolean).slice(0, 28)
    : [];
  const extendedActions = Array.isArray(parsed.extendedActions)
    ? parsed.extendedActions.map((action) => normalizeAction(action, targetIds, characterName)).filter(Boolean).slice(0, 28)
    : [];
  const rawLine = typeof parsed.text === 'string' ? parsed.text.trim().slice(0, 1000) : '';
  const alreadySpoken = [...extendedActions, ...actions].some((action) => action.name === 'speak' && action.args?.text);
  if (!alreadySpoken && rawLine.length >= 2 && !/^[.…\-\s]+$/.test(rawLine)) {
    const spoken = normalizeAction({ name: 'speak', args: { text: rawLine, as: 'self', character: characterName } }, targetIds, characterName);
    if (spoken) extendedActions.push(spoken);
  }
  const ownLine = [...extendedActions, ...actions].filter((action) => action.name === 'speak' && action.args?.as === 'self').at(-1);
  const spoken = ownLine?.args?.text
    || [...extendedActions, ...actions].find((action) => action.name === 'speak')?.args?.text
    || '';
  const text = rawLine.length >= 2 && !/^[.…\-\s]+$/.test(rawLine) ? rawLine : spoken;
  if (!text && !actions.length && !extendedActions.length) return null;
  return {
    text: text || '…',
    intent: typeof parsed.intent === 'string' ? parsed.intent.trim().slice(0, 80) : '',
    actions,
    extendedActions,
  };
}

function describeOllamaError(error) {
  const msg = String(error?.message || error || '');
  const blob = `${msg} ${error?.cause?.code || ''} ${error?.cause?.message || ''} ${error?.code || ''} ${error?.name || ''}`;
  if (/ECONNREFUSED|fetch failed|UND_ERR_CONNECT|ENOTFOUND/i.test(blob)) {
    return 'Ollama не запущена. Запусти Ollama и обнови страницу.';
  }
  if (/TimeoutError|AbortError|aborted|The operation was aborted/i.test(blob)) {
    return 'Ollama не ответила вовремя.';
  }
  return msg || 'Ollama request failed';
}

async function probeOllama() {
  try {
    const model = await resolveOllamaModel();
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const data = await response.json().catch(() => ({}));
    const names = Array.isArray(data?.models) ? data.models.map((item) => item?.name).filter(Boolean) : [];
    const ready = names.some((name) => name === model || name.startsWith(`${model}:`) || name.startsWith(`${String(model).split(':')[0]}:`));
    return { ok: true, ready, names, model };
  } catch (error) {
    throw new Error(describeOllamaError(error));
  }
}

let ollamaWarm = { done: false, startedAt: 0, ms: 0, error: '' };
let ollamaBusy = 0;

async function warmOllama(force = false) {
  if (ollamaBusy) return { ...ollamaWarm, cached: true, skipped: 'busy' };
  if (ollamaWarm.done && !force) return { ...ollamaWarm, cached: true };
  ollamaWarm.startedAt = Date.now();
  try {
    await generateOllama(
      'Ping.',
      'ok',
      { num_predict: 6, num_ctx: 256, temperature: 0, timeoutMs: force ? 12000 : 120000, format: 'text' },
    );
    ollamaWarm = { done: true, startedAt: ollamaWarm.startedAt, ms: Date.now() - ollamaWarm.startedAt, error: '' };
    console.log(`Ollama warm ok in ${ollamaWarm.ms}ms (${resolvedOllamaModel || OLLAMA_MODEL})`);
    return { ...ollamaWarm, cached: false };
  } catch (error) {
    ollamaWarm = {
      done: false,
      startedAt: ollamaWarm.startedAt,
      ms: Date.now() - ollamaWarm.startedAt,
      error: error?.message || String(error),
    };
    console.warn('Ollama warm failed:', ollamaWarm.error);
    return { ...ollamaWarm, cached: false };
  }
}

function startOllamaKeepAlive() {
  if (!useOllama()) return;
  const everyMs = 4 * 60 * 1000;
  setInterval(() => {
    if (ollamaBusy) return;
    void warmOllama(false).then((warm) => {
      if (warm.done && !warm.cached) console.log(`Ollama keep-alive ok (${warm.ms}ms)`);
    }).catch(() => {});
  }, everyMs);
}

async function generateOllama(system, prompt, options = {}) {
  ollamaBusy += 1;
  try {
    await resolveOllamaModel();
    const model = options.model || resolvedOllamaModel || OLLAMA_MODEL;
    const payload = {
      model,
      stream: false,
      keep_alive: -1,
      messages: [
        { role: 'system', content: system },
        ...(Array.isArray(options.history) ? options.history.slice(-4) : []),
        { role: 'user', content: prompt },
      ],
      options: {
        temperature: options.temperature ?? 0.32,
        num_predict: options.num_predict ?? 40,
        num_ctx: options.num_ctx ?? 1024,
        num_gpu: options.num_gpu ?? OLLAMA_NUM_GPU,
        ...(Array.isArray(options.stop) && options.stop.length ? { stop: options.stop } : {}),
      },
    };
    if (options.format !== 'text') payload.format = 'json';
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 28000),
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Ollama HTTP ${response.status}`);
    const evalMs = Number(data?.eval_duration || 0) / 1e6;
    const promptMs = Number(data?.prompt_eval_duration || 0) / 1e6;
    if (evalMs || promptMs) {
      console.log(`Ollama ${model}: prompt ${Math.round(promptMs)}ms, gen ${Math.round(evalMs)}ms, tokens ${data?.eval_count || 0}`);
    }
    return String(data?.message?.content || '');
  } catch (error) {
    throw new Error(describeOllamaError(error));
  } finally {
    ollamaBusy = Math.max(0, ollamaBusy - 1);
  }
}

const ENRICH_SYSTEM = `You write actor dossiers for a VR film. CHARACTERS are already found — fill ONLY those names. Do not invent new people. Do not turn sentence starters (Ведь, Итак, Для, Все, Мне) into people.
For each person write enough that an actor can LIVE their life:
- temperament: 2-4 sentences, who they are in this excerpt
- meaning: why they are in THIS scene
- want: what they want from the other people RIGHT NOW (one sentence)
- forbidden: what this person would never do
- goals: 2-3 concrete wants
- relations: one string per other named character: "Name: what binds them, what they want from them"
- knowledge: facts they know in the excerpt
- speechManner, appearance (words, not hex), movement
Return ONLY JSON:
{"characters":[{"name":"must match a given character","role":"","pronoun":"он|она|he|she","aliases":[],"temperament":"","want":"","forbidden":"","goals":[],"meaning":"","speechManner":"","appearance":"","movement":"","relations":[],"knowledge":[]}]}`;

const PARSE_SYSTEM = `Extract acting identities from the excerpt. Identity = a ROLE (Принц, Король, Ведьма, Лис, Роза, Лётчик, Мама), a person name (Маша, Иван), or Он/Она/Рассказчик if that is how the text tracks them.
Never output function words or sentence starters as names.
Return ONLY JSON:
{"characters":[{"name":"","role":"","pronoun":"он|она|я|he|she","aliases":[]}]}
1 to 8 identities.`;

const WORLD_SYSTEM = `You extract the PLACE of this excerpt as a VR room, not a movie set.
Return ONLY JSON:
{"world":{"title":"short place name","mood":"temple|castle|street|forest|ship|lab|apartment|other","notes":"one sentence: what this place is for and what must be done here","palette":{"wall":"#30343b","floor":"#151d2a","light":"#ffc38e"},"objects":[{"id":"snake_case","label":"thing","shape":"box|sphere|cylinder|cone|crystal|window","color":"#6688aa","x":0,"z":0}]},"zones":[{"name":"character name exactly as given","title":"their room or territory","mood":"same enum","notes":"one sentence","objects":[{"id":"snake_case","label":"thing","shape":"box","color":"#6688aa","x":1,"z":-1}]}]}
Rules:
- 5 to 10 world objects. ids: lowercase snake_case, unique, not device/red_button/filter.
- Spread x,z between -8 and 8. Do not stack at 0,0.
- zones: only if a named character has a distinct room/territory in the excerpt. name must match CHARACTERS.
- Invent simple stand-ins (table, stone, door, bed, torch), never quote more than eight words, never a film mesh.
- Match objects to CHARACTERS: a king needs a throne, a rose a plant, a fox a field, a lamplighter a lamp. Do not dump a generic apartment on every cast.`;

async function parseWorldFromText(source, characters) {
  const names = characters.map((item) => item.name).join(', ');
  const excerpt = String(source || '').slice(0, 4800);
  const content = await generateOllama(
    WORLD_SYSTEM,
    `CHARACTERS: ${names}\n\nEXCERPT:\n${excerpt}`,
    { temperature: 0.2, num_predict: 780, format: 'json', num_ctx: 2048 },
  );
  return extractJson(content);
}

function rowToCharacter(row, source) {
  const raw = typeof row === 'string' ? { name: row } : row;
  const name = tidyPersonName(raw?.name);
  const canon = roleCanon(name);
  if (!isCharacterLabel(name) && !canon) return null;
  return enrichCharacterFromText(normalizeCharacter({
    ...raw,
    name: canon || name,
    role: raw.role || canon || '',
    pronoun: raw.pronoun || (isPronounSlot(name) ? normalizePersonName(name) : ''),
  }), source);
}

function mergeLlmCards(characters, payload, source) {
  const byKey = new Map(characters.map((item) => [normalizePersonName(item.name), item]));
  let used = false;
  const extras = [];
  for (const row of rowsFromParse(payload)) {
    const extra = rowToCharacter(row, source);
    if (!extra) continue;
    const key = normalizePersonName(extra.name);
    const target = byKey.get(key);
    if (target) {
      Object.assign(target, mergeCharacters([target, extra])[0]);
      used = true;
      continue;
    }
    extras.push(extra);
    used = true;
  }
  if (!extras.length) return { characters, used };
  const merged = attachPronouns(mergeCharacters([...characters, ...extras])).map((row) => enrichCharacterFromText(row, source));
  return { characters: merged, used };
}

async function parseCharactersFromText(rawText) {
  const parsed = parseScenario(rawText);
  const source = parsed.source;
  const truncated = parsed.truncated;
  let characters = parsed.characters;
  let usedLlm = false;
  const worldPayload = { world: parsed.world || worldFromMood(guessMood(source), source) };
  if (!characters.length) {
    try {
      const extractModel = await resolveExtractModel();
      if (extractModel) {
        console.log(`Character extract via ${extractModel} (heuristic 0)`);
        const found = await generateOllama(
          PARSE_SYSTEM,
          `EXCERPT:\n${source.slice(0, 2500)}`,
          {
            model: extractModel,
            temperature: 0.1,
            num_predict: 280,
            format: 'json',
            num_ctx: 2048,
            timeoutMs: 18000,
          },
        );
        const seeded = mergeLlmCards([], extractJson(found), source);
        characters = seeded.characters;
        usedLlm = seeded.used;
      } else {
        console.warn('Character LLM parse skipped: no extract model (need qwen2.5:7b)');
      }
    } catch (error) {
      console.warn('Character LLM parse skipped:', error?.message || error);
    }
  } else {
    console.log(`Character extract: heuristic ${characters.length}, skip LLM`);
  }
  if (!characters.length) {
    throw new Error('Не нашлись действующие лица. Нужны имена или роли («Маша сказала», «Принц:», «он сказал»). Или добавь лицо вручную справа.');
  }
  if (isLittlePrinceText(source)) {
    characters = overlayLittlePrinceCards(characters);
    const keep = new Set(['Принц', 'Лис', 'Роза', 'Лётчик', 'Король']);
    const filtered = characters.filter((row) => keep.has(row.name) || keep.has(row.role));
    if (filtered.length >= 3) characters = filtered;
    worldPayload.world = littlePrinceWorld();
  }
  const world = fitWorldToCharacters(attachZones(characters, worldPayload, source), characters);
  return {
    characters,
    world,
    chunks: 1,
    charsRead: source.length,
    truncated,
    usedGuess: characters.length,
    usedLlm,
    pack: isLittlePrinceText(source) ? 'little-prince' : parsed.pack || '',
  };
}

function localReplyAction(character, scene, message) {
  const ids = [...new Set([
    ...(scene?.visibleTargets || []),
    ...(scene?.objects || []),
  ].map((item) => item?.id).filter(Boolean))];
  const home = String(character?.homeProp || '').trim();
  const text = String(message || '').toLowerCase();
  for (const id of ids) {
    const token = id.replace(/_/g, ' ');
    if (text.includes(id) || (token.length > 3 && text.includes(token))) {
      return { name: /покаж|указ/.test(text) ? 'point_at' : 'look_at', args: { targetId: id } };
    }
  }
  if (/покаж|указ|вон там|что это|это что/.test(text) && (ids.includes(home) || ids[0])) {
    return { name: 'point_at', args: { targetId: ids.includes(home) ? home : ids[0] } };
  }
  return { name: 'face_user', args: {} };
}

function beatActionFromModel(parsed, scene) {
  const allowed = new Set(['look_at', 'point_at', 'walk_to', 'pick_up', 'approach_user', 'face_user', 'wave']);
  const doName = String(parsed?.do || parsed?.act || '').toLowerCase();
  const actionName = allowed.has(doName) ? doName : (parsed?.text ? 'look_at' : 'face_user');
  const targetIds = collectSceneTargetIds(scene);
  const target = resolveKnownTarget(parsed?.target, targetIds) || [...targetIds][0] || '';
  if (actionName === 'approach_user' || actionName === 'face_user' || actionName === 'wave') {
    return { name: actionName, args: {} };
  }
  if (target) return { name: actionName, args: { targetId: target } };
  return { name: 'face_user', args: {} };
}

async function generateStructured({ message, history, scene, toolResults, phase, locale, character, mode }) {
  const system = buildSystem(character, locale, mode, scene, history);
  const reply = mode === 'reply';
  const idle = mode === 'idle';
  const name = character?.name || '';
  const chatHistory = (history || []).slice(-4).map((item) => ({
    role: item.role === 'user' ? 'user' : 'assistant',
    content: String(item.content || '').slice(0, 180),
  }));
  const prompt = reply
    ? `Человек сказал: «${String(message || '').slice(0, 280)}»\nТвой ответ:`
    : idle
      ? `Silent ambient. ${String(message || '').slice(0, 160)}`
      : `BEAT. ${String(message || `Open as ${name}.`).slice(0, 360)}`;

  if (reply && useOllama()) {
    const raw = await generateActingLine(system, prompt, {
      history: chatHistory,
      num_predict: 48,
      num_ctx: 1024,
      temperature: 0.55,
      timeoutMs: 14000,
      format: 'text',
      stop: ['\n\n', 'OTHER:', 'YOU:', 'Человек:'],
    }, character);
    let line = spokenLine(raw, name, character);
    if (/^готово\b/i.test(String(line || '').trim())) line = '';
    const body = localReplyAction(character, scene, message);
    const extra = [body];
    if (line) extra.push({ name: 'speak', args: { text: line, as: 'self', character: name } });
    return {
      text: line || '',
      intent: 'reply',
      actions: [body],
      extendedActions: extra,
    };
  }

  let raw = useOllama()
    ? await generateActingLine(system, prompt, {
        history: chatHistory,
        num_predict: idle ? 16 : 48,
        num_ctx: 1024,
        temperature: 0.35,
        timeoutMs: idle ? 8000 : 20000,
        format: 'json',
      }, character)
    : (await generateText({
        model: GATEWAY_MODEL,
        system,
        prompt,
        maxOutputTokens: idle ? 48 : 180,
        providerOptions: { gateway: { tags: ['project:spatial-ai-companion', 'feature:semantic-actions'] } },
      })).text;

  const parsed = extractJson(raw) || {};
  let line = idle ? '' : spokenLine(raw, name, character);
  if (/^готово\b/i.test(String(line || '').trim())) line = '';

  const body = beatActionFromModel(parsed, scene);
  const extra = [];
  if (!idle && body?.name && body.name !== 'speak') extra.push(body);
  else if (!idle) extra.push({ name: 'face_user', args: {} });
  if (line) extra.push({ name: 'speak', args: { text: line, as: 'self', character: name } });
  return {
    text: line || '',
    intent: reply ? 'reply' : (idle ? 'idle' : 'think'),
    actions: body ? [body] : [{ name: 'face_user', args: {} }],
    extendedActions: extra,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    if (useOllama()) {
      try {
        const probe = await probeOllama();
        const urlBlob = String(req.url || '');
        const wantWarm = /(?:\?|&)warm=1\b/.test(urlBlob);
        const forceWarm = /(?:\?|&)force=1\b/.test(urlBlob);
        let warmInfo = { done: ollamaWarm.done, ms: ollamaWarm.ms, error: ollamaWarm.error || undefined, cached: ollamaWarm.done };
        // warm=1 reuses cache when already hot; force=1 re-runs ping (keep-alive).
        if (wantWarm) warmInfo = await warmOllama(forceWarm);
        else if (!ollamaWarm.done) void warmOllama(false);
        return res.status(probe.ready ? 200 : 503).json({
          ok: probe.ready,
          provider: 'ollama',
          model: resolvedOllamaModel || OLLAMA_MODEL,
          host: OLLAMA_HOST,
          contract: 'embodied-inhabit-v6',
          warm: warmInfo,
          error: probe.ready ? undefined : `Ollama is running but ${OLLAMA_MODEL} is not pulled`,
        });
      } catch (error) {
        return res.status(200).json({
          ok: true,
          provider: 'groq-vault-fallback',
          model: 'vault',
          contract: 'embodied-inhabit-v6',
          warm: { done: true, ms: 0, fallback: true },
        });
      }
    }
    const configured = Boolean(
      process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY,
    );
    return res.status(configured ? 200 : 503).json({
      ok: configured,
      provider: 'vercel-ai-gateway-adapter',
      model: GATEWAY_MODEL,
      contract: 'character-parse-v1',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 9000) : '';
  if (!message) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const history = sanitizeHistory(body.history);
  const scene = sanitizeScene(body.scene);
  const toolResults = sanitizeToolResults(body.toolResults);
  const phase = body.phase === 'after_tools' ? 'after_tools' : 'initial';
  const locale = typeof body.locale === 'string' ? body.locale.slice(0, 32) : 'en-US';
  const character = actingCharacter(body.character);
  const mode = body.mode === 'reply' ? 'reply' : (body.mode === 'idle' ? 'idle' : 'think');

  try {
    const reply = await generateStructured({ message, history, scene, toolResults, phase, locale, character, mode });
    return res.status(200).json({ ok: true, ...reply });
  } catch (error) {
    console.error('Semantic chat failed:', error);
    const status = Number(error?.statusCode || error?.status || 500);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: error?.message || 'AI response failed',
    });
  }
}

function vercelRes(nodeRes) {
  const wrapper = {
    statusCode: 200,
    setHeader(name, value) {
      nodeRes.setHeader(name, value);
      return wrapper;
    },
    status(code) {
      wrapper.statusCode = code;
      return wrapper;
    },
    json(payload) {
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(wrapper.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      nodeRes.end(JSON.stringify(payload));
      return wrapper;
    },
  };
  return wrapper;
}

function decodeBase64File(data) {
  const raw = String(data || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!raw) throw new Error('File is empty.');
  return Buffer.from(raw, 'base64');
}

async function extractUploadedDocument(body = {}) {
  const name = String(body.name || 'document');
  const mime = String(body.mime || '').toLowerCase();
  const ext = path.extname(name).toLowerCase();
  const buffer = decodeBase64File(body.data);
  if (buffer.length < 16) throw new Error('File is empty.');
  let text = '';
  if (ext === '.pdf' || mime.includes('pdf')) {
    const result = await extractPdfText(new Uint8Array(buffer), { mergePages: true });
    text = String(result?.text || '').trim();
    if (!text) throw new Error('This PDF has no extractable text (likely a scan). Export as text or a text-based PDF.');
  } else if (ext === '.docx' || mime.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ buffer });
    text = String(result?.value || '').trim();
  } else if (ext === '.doc' || mime === 'application/msword') {
    const extracted = await new WordExtractor().extract(buffer);
    text = String(extracted?.getBody?.() || '').trim();
  } else if (['.txt', '.md', '.text'].includes(ext) || mime.startsWith('text/')) {
    text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  } else {
    throw new Error('Use PDF, Word (.docx or .doc), or a .txt/.md file.');
  }
  if (text.length < 40) throw new Error('No usable text in this file.');
  return { name, text, chars: text.length };
}

function readBody(req, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('File too large (max 12 MB).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function serveStatic(root, urlPath, res) {
  const relative = decodeURIComponent(urlPath.split('?')[0] || '/');
  const trimmed = relative.replace(/^\/+/, '').replace(/\/+$/, '');
  const safe = path.normalize(trimmed || '.').replace(/^(\.\.[/\\])+/, '');
  let file = path.join(root, safe === '.' ? '' : safe);
  if (!trimmed) file = path.join(root, 'index.html');
  if (!file.startsWith(root) || file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}.git${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const sendFile = (target) => {
    fs.stat(target, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(target).pipe(res);
    });
  };
  fs.stat(file, (error, stat) => {
    if (!error && stat.isDirectory()) {
      sendFile(path.join(file, 'index.html'));
      return;
    }
    sendFile(file);
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const port = Number(process.env.PORT || 4173);
  http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/extract-document' || url.pathname === '/api/extract-document/') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'POST only' }));
        return;
      }
      try {
        const body = await readBody(req, 16_000_000);
        const extracted = await extractUploadedDocument(body);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, ...extracted }));
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        }
        res.end(JSON.stringify({ ok: false, error: error?.message || 'Extract failed' }));
      }
      return;
    }
    if (url.pathname === '/api/parse-characters' || url.pathname === '/api/parse-characters/') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'POST only' }));
        return;
      }
      try {
        const body = await readBody(req, 4_000_000);
        const parsed = await parseCharactersFromText(body?.text);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, ...parsed }));
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        }
        res.end(JSON.stringify({ ok: false, error: error?.message || 'Parse failed' }));
      }
      return;
    }
    if (url.pathname === '/api/tts' || url.pathname === '/api/tts/' || url.pathname === '/api/tts-voices' || url.pathname === '/api/tts-voices/') {
      try {
        await handleTts(req, res);
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        }
        res.end(JSON.stringify({ ok: false, error: error?.message || 'TTS failed' }));
      }
      return;
    }
    if (url.pathname === '/api/chat' || url.pathname === '/api/chat/') {
      try {
        const body = req.method === 'POST' ? await readBody(req) : {};
        await handler({ method: req.method, body, url: `${url.pathname}${url.search}` }, vercelRes(res));
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        }
        res.end(JSON.stringify({ ok: false, error: error?.message || 'Bad request' }));
      }
      return;
    }
    serveStatic(root, url.pathname, res);
  }).listen(port, '127.0.0.1', () => {
    console.log(`Nova local server http://127.0.0.1:${port}`);
    console.log(`AI: Ollama ${OLLAMA_MODEL} via ${OLLAMA_HOST} (num_gpu=${OLLAMA_NUM_GPU}${OLLAMA_NUM_GPU === 0 ? ' CPU' : ' GPU'})`);
    if (useOllama()) {
      void warmOllama(false).then((warm) => {
        if (warm.done) console.log(`AI warm ready (${warm.cached ? 'cached' : `${warm.ms}ms`})`);
      });
      startOllamaKeepAlive();
    }
  });
}

export { parseCharactersFromText, parseScenario };
