/**
 * Full actor / creature sheet — one schema for packs + Stage + AI.
 * Strings stay short so prompts stay fast; normalize fills safe defaults.
 */

export const ACTOR_SHEET_VERSION = 1;

/** @typedef {{ id: string, name: string, bond?: string, wantFromThem?: string, fear?: string, howToAct?: string }} ActorRelation */

/**
 * @param {object} raw
 * @param {object} [world]
 */
export function normalizeActorSheet(raw = {}, world = {}) {
  const appearance = raw.appearance && typeof raw.appearance === 'object' ? raw.appearance : {};
  const embodiment = raw.embodiment && typeof raw.embodiment === 'object' ? raw.embodiment : {};
  const emotions = raw.emotions && typeof raw.emotions === 'object' ? raw.emotions : {};
  const knowledge = raw.knowledge && typeof raw.knowledge === 'object' && !Array.isArray(raw.knowledge)
    ? raw.knowledge
    : {
      personal: Array.isArray(raw.knowledge) ? raw.knowledge : [],
      shared: [],
    };
  const relations = normalizeRelations(raw.relations);

  return {
    sheetVersion: ACTOR_SHEET_VERSION,
    name: String(raw.name || 'Actor').slice(0, 64),
    aliases: (raw.aliases || []).map((a) => String(a).slice(0, 40)).slice(0, 6),
    role: String(raw.role || 'Actor').slice(0, 64),
    pronoun: String(raw.pronoun || 'they').slice(0, 16),
    species: String(raw.species || 'human').slice(0, 40),

    // Personality engine
    temperament: String(raw.temperament || '').slice(0, 400),
    mission: String(raw.mission || raw.want || '').slice(0, 320),
    want: String(raw.want || '').slice(0, 320),
    worries: (raw.worries || []).map((w) => String(w).slice(0, 160)).slice(0, 6),
    goals: (raw.goals || []).map((g) => String(g).slice(0, 160)).slice(0, 8),
    forbidden: String(raw.forbidden || '').slice(0, 280),
    habits: (raw.habits || []).map((h) => String(h).slice(0, 120)).slice(0, 8),

    emotions: {
      baseline: String(emotions.baseline || 'calm').slice(0, 40),
      current: String(emotions.current || emotions.baseline || 'calm').slice(0, 40),
      range: (emotions.range || ['calm', 'curious', 'wary', 'warm']).map((e) => String(e).slice(0, 32)).slice(0, 10),
      triggers: (emotions.triggers || []).map((t) => String(t).slice(0, 120)).slice(0, 8),
    },

    // Speech
    vocabulary: (raw.vocabulary || []).map((v) => String(v).slice(0, 40)).slice(0, 24),
    speechManner: String(raw.speechManner || '').slice(0, 220),
    talkThemes: (raw.talkThemes || []).map((t) => String(t).slice(0, 80)).slice(0, 10),
    openingSeed: String(raw.openingSeed || '').slice(0, 200),

    // Social — per other being
    relations,

    // Story
    history: String(raw.history || '').slice(0, 900),
    background: String(raw.background || '').slice(0, 600),
    memory: String(raw.memory || '').slice(0, 600),

    knowledge: {
      personal: (knowledge.personal || []).map((k) => String(k).slice(0, 160)).slice(0, 12),
      shared: (knowledge.shared || world.sharedKnowledge || []).map((k) => String(k).slice(0, 160)).slice(0, 12),
    },

    // How she may act in this space
    interactionWays: (raw.interactionWays || [
      'look_at', 'face_user', 'approach_user', 'point_at', 'walk_to', 'pick_up', 'sit', 'speak',
    ]).map((w) => String(w).slice(0, 32)).slice(0, 16),

    movement: String(raw.movement || '').slice(0, 280),
    proximity: Number.isFinite(raw.proximity) ? raw.proximity : 1.25,
    homeProp: String(raw.homeProp || '').slice(0, 64),

    appearance: {
      notes: String(appearance.notes || '').slice(0, 200),
      hair: appearance.hair || '#171717',
      skin: appearance.skin || '#e8b89a',
      clothes: appearance.clothes || '#28384d',
      heightMeters: Number(appearance.heightMeters) || Number(embodiment.heightMeters) || 1.68,
      build: String(appearance.build || 'average').slice(0, 40),
    },

    embodiment: {
      modelName: String(embodiment.modelName || 'Quaternius Animated Woman').slice(0, 80),
      skeleton: String(embodiment.skeleton || 'humanoid-mixamo-like').slice(0, 64),
      heightMeters: Number(embodiment.heightMeters || appearance.heightMeters) || 1.68,
      gait: String(embodiment.gait || 'measured, short steps').slice(0, 120),
      clips: {
        idle: embodiment.clips?.idle || 'idle',
        walk: embodiment.clips?.walk || 'walk',
        interact: embodiment.clips?.interact || 'interact',
      },
      gestures: {
        noticeViewer: embodiment.gestures?.noticeViewer || 'look_at home → face_user',
        greet: embodiment.gestures?.greet || 'approach_user → speak',
        showObject: embodiment.gestures?.showObject || 'point_at → walk_to → pick_up',
        settle: embodiment.gestures?.settle || 'walk_to chair → sit → face_user',
        ...(embodiment.gestures && typeof embodiment.gestures === 'object' ? embodiment.gestures : {}),
      },
    },

    scenario: raw.scenario && typeof raw.scenario === 'object' ? {
      title: String(raw.scenario.title || world.title || '').slice(0, 80),
      source: String(raw.scenario.source || '').slice(0, 900),
      beats: (raw.scenario.beats || []).map((b) => String(b).slice(0, 160)).slice(0, 12),
    } : null,
  };
}

function normalizeRelations(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).map((item, index) => {
    if (typeof item === 'string') {
      return {
        id: `other_${index}`,
        name: item.split(/[—:]/)[0].trim().slice(0, 64) || `other_${index}`,
        bond: item.slice(0, 220),
        wantFromThem: '',
        fear: '',
        howToAct: '',
      };
    }
    return {
      id: String(item.id || item.name || `other_${index}`).slice(0, 48),
      name: String(item.name || item.id || `other_${index}`).slice(0, 64),
      bond: String(item.bond || '').slice(0, 220),
      wantFromThem: String(item.wantFromThem || '').slice(0, 160),
      fear: String(item.fear || '').slice(0, 160),
      howToAct: String(item.howToAct || '').slice(0, 160),
    };
  });
}

/** Compact card for UI / logs */
export function actorCardLines(sheet) {
  if (!sheet) return [];
  const look = sheet.appearance || {};
  const lookLine = look.notes || [look.hair && 'волосы', look.clothes && 'одежда'].filter(Boolean).join(' · ');
  return [
    `${sheet.name}${sheet.role && sheet.role !== sheet.name ? ` · ${sheet.role}` : ''}`,
    lookLine || null,
    sheet.want ? `Хочет: ${sheet.want}` : (sheet.mission ? `Миссия: ${sheet.mission}` : null),
  ].filter(Boolean);
}

function actingManner(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^говорит:\s*[«"']/i.test(text)) return '';
  if (/не ассистент|не читать ТЗ|не говорить\s*«?Готово/i.test(text)) return '';
  return text.slice(0, 120);
}

/** Compact acting brief for /api/chat — notes to play, not lines to recite */
export function actorPromptPayload(sheet) {
  if (!sheet) return {};
  return {
    name: sheet.name,
    role: sheet.role,
    pronoun: sheet.pronoun,
    want: String(sheet.want || sheet.mission || '').slice(0, 160),
    temperament: String(sheet.temperament || '').slice(0, 140),
    speechManner: actingManner(sheet.speechManner),
    homeProp: sheet.homeProp,
  };
}
