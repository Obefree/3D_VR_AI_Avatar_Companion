export const SCENE_ACTIONS = new Set([
  'look_at', 'point_at', 'highlight', 'move_near', 'press_button', 'remove_filter', 'face_user',
]);
export const EMBODIMENT_ACTIONS = new Set([
  'raise_hand', 'lower_hand', 'wave', 'step', 'turn_body', 'neutral_pose',
  'create_object', 'delete_object', 'move_object',
]);
export const DIRECTOR_ACTIONS = new Set([
  'speak', 'approach_user', 'sit', 'stand', 'pick_up', 'pause',
]);

export const DEFAULT_ACTOR_SCRIPT = [
  'Девушка стоит у окна. Она замечает зрителя, поворачивается к нему, подходит ближе и машет рукой.',
  'Затем показывает на стакан, берет его и говорит: «Привет. Я получила сценарий и могу отыграть его прямо в VR».',
].join(' ');

// One cue per semantic beat. Overlapping /смотр|look/ + /зрител/ used to emit two face_user
// actions that ran back-to-back and fought the same look target.
export const SCRIPT_CUES = {
  window: /окн|window/,
  viewer: /зрител|геро|замечает|поворачива|viewer|\busers?\b|камер|camera|notices?\b/,
  wave: /машет|помах|\bwave\b|greet/,
  approach: /подход|подойти|приближ|approach|comes closer|walks to/,
  glass: /стакан|\bglass\b|предмет.*стол|object.*table|показыва.*стол|point.*table/,
  pickup: /бер[её]т|возьм|поднимает стакан|pick.*up|takes the glass/,
  sit: /садит(?:ся)?|\bsits?\b/,
  stand: /вста[её]т|\bstands?\b/,
};

export function quotedDialogue(script) {
  const matches = [...String(script).matchAll(/[«“"]([^»”"]{2,180})[»”"]/g)];
  return matches.map((match) => match[1].trim()).filter(Boolean).slice(0, 3);
}

export function actionKey(action) {
  return `${action?.name || ''}:${JSON.stringify(action?.args || {})}`;
}

export function dedupeActions(actions, limit = 14) {
  const result = [];
  const seen = new Set();
  for (const action of actions) {
    if (!action || typeof action.name !== 'string') continue;
    const item = {
      name: action.name,
      args: action.args && typeof action.args === 'object' ? { ...action.args } : {},
    };
    const key = actionKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function hasName(plan, name) {
  return plan.some((item) => item.name === name);
}

export function fallbackPlan(script) {
  const lower = String(script || '').toLowerCase();
  const plan = [];

  // Order follows the scene beats, not the order regexes happen to be written.
  if (SCRIPT_CUES.window.test(lower)) plan.push({ name: 'look_at', args: { targetId: 'actor_window' } });
  if (SCRIPT_CUES.viewer.test(lower)) plan.push({ name: 'face_user', args: {} });
  if (SCRIPT_CUES.approach.test(lower)) plan.push({ name: 'approach_user', args: { distanceFromUser: 1.55, maxMove: 1.6 } });
  if (SCRIPT_CUES.wave.test(lower)) plan.push({ name: 'wave', args: { side: 'left' } });
  if (SCRIPT_CUES.glass.test(lower)) {
    plan.push({ name: 'look_at', args: { targetId: 'actor_glass' } });
    plan.push({ name: 'point_at', args: { targetId: 'actor_glass' } });
  }
  if (SCRIPT_CUES.pickup.test(lower)) plan.push({ name: 'pick_up', args: { targetId: 'actor_glass' } });
  if (SCRIPT_CUES.sit.test(lower)) plan.push({ name: 'sit', args: {} });
  if (SCRIPT_CUES.stand.test(lower)) plan.push({ name: 'stand', args: {} });

  for (const line of quotedDialogue(script)) plan.push({ name: 'speak', args: { text: line } });

  if (!plan.length) {
    plan.push(
      { name: 'face_user', args: {} },
      { name: 'wave', args: { side: 'left' } },
      { name: 'speak', args: { text: 'Я получила сценарий и готова отыграть сцену.' } },
    );
  }
  return dedupeActions(plan, 14);
}

export function normalizeAiActions(data) {
  return dedupeActions([
    ...(Array.isArray(data?.actions) ? data.actions : []),
    ...(Array.isArray(data?.extendedActions) ? data.extendedActions : []),
  ], 12);
}

export function mergeSemanticActions(script, aiActions) {
  const result = dedupeActions(aiActions, 14);
  const lower = String(script || '').toLowerCase();

  if (SCRIPT_CUES.approach.test(lower) && !hasName(result, 'approach_user')) {
    const faceIndex = result.findIndex((item) => item.name === 'face_user');
    const insertAt = faceIndex >= 0 ? faceIndex + 1 : 0;
    result.splice(insertAt, 0, { name: 'approach_user', args: { distanceFromUser: 1.55, maxMove: 1.6 } });
  }
  if (SCRIPT_CUES.pickup.test(lower) && !hasName(result, 'pick_up')) {
    result.push({ name: 'pick_up', args: { targetId: 'actor_glass' } });
  }
  if (SCRIPT_CUES.sit.test(lower) && !hasName(result, 'sit')) {
    result.push({ name: 'sit', args: {} });
  }

  const dialogue = quotedDialogue(script);
  if (dialogue.length && !hasName(result, 'speak')) {
    for (const line of dialogue) result.push({ name: 'speak', args: { text: line } });
  }
  return dedupeActions(result, 14);
}

export function actionLabel(action) {
  const args = action.args || {};
  if (action.name === 'speak') return `SPEAK “${String(args.text || '').slice(0, 50)}”`;
  const detail = args.targetId || args.side || args.direction || '';
  return `${action.name.toUpperCase()}${detail ? ` → ${detail}` : ''}`;
}
