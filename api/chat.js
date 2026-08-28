import { generateText } from 'ai';

const MODEL = process.env.NOVA_AI_GATEWAY_MODEL || 'openai/gpt-oss-20b';
const ALLOWED_ACTIONS = new Set([
  'look_at',
  'point_at',
  'highlight',
  'move_near',
  'press_button',
  'remove_filter',
  'face_user',
  'raise_hand',
  'lower_hand',
  'wave',
  'step',
  'turn_body',
  'neutral_pose',
  'create_object',
  'delete_object',
  'move_object',
]);
const BUILTIN_TARGETS = new Set(['device', 'red_button', 'filter']);
const TARGET_ID_RE = /^[a-z0-9а-яё_-]{1,64}$/i;

const SYSTEM = `You are Nova, an embodied spatial AI companion inside a browser 3D/XR scene.
You do not merely describe actions: when the user asks you to act in the scene, return semantic actions for the client to execute.

You know only the supplied scene context and conversation history. Never claim camera/sensor access beyond that context.
The scene targets are supplied in CURRENT SCENE CONTEXT. Use only target ids present there.
The maintenance state is authoritative:
- reset_required: the red reset button must be pressed before the filter can be removed.
- filter_required: reset is complete; the filter is the next step.
- complete: reset is complete and filter is removed.

Allowed actions only:
- look_at(targetId)
- point_at(targetId)
- highlight(targetId, seconds?)
- move_near(targetId)
- press_button(targetId=red_button)
- remove_filter(targetId=filter)
- face_user()
- raise_hand(side?)
- lower_hand(side?)
- wave(side?, seconds?)
- step(direction?, distance?)
- turn_body(degrees?)
- neutral_pose()
- create_object(shape?, color?, size?, direction?, distance?, position?, label?)
- delete_object(targetId?)
- move_object(targetId, direction?, distance?, position?)

Important behavioral rules:
1. Understand natural language semantically, including Russian/English, pronouns and follow-ups from history. Do not rely on the client to keyword-route the request.
2. Reply in the same language as the user's latest message. If the message is a scene event rather than natural speech, use the supplied locale and recent conversation language.
3. When asked to SHOW a target, use look_at/point_at/highlight. Showing the red button must NOT press it.
4. When asked to PRESS/ACTIVATE the reset button, use press_button. The client executes actions before speaking your text.
5. When asked what is next, use the actual task step. If filter_required, direct attention to the filter. If complete, say the task is complete and do not recommend reset again.
6. remove_filter is valid only after resetPressed=true. If reset is not done, do not request remove_filter; explain the prerequisite and optionally point to red_button.
7. If phase=after_tools, tool results are ground truth. Never claim success for a failed action. Correct the answer and, if helpful, return only safe corrective actions.
8. For body movement, gestures and editable-world operations, return extendedActions rather than actions.
9. Keep spoken text concise: normally 1-2 short sentences.

Return ONLY one valid JSON object, with no markdown or commentary:
{
  "text": "spoken response",
  "intent": "short_intent_name",
  "actions": [
    {"name":"look_at","args":{"targetId":"red_button"}}
  ],
  "extendedActions": [
    {"name":"raise_hand","args":{"side":"left"}}
  ]
}
Use an empty actions array when no physical/spatial action is needed.`;

function sanitizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
    .slice(-12)
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 900) }))
    .filter((item) => item.content);
}

function safeTargetId(value) {
  const id = String(value || '').trim();
  return TARGET_ID_RE.test(id) && !id.startsWith('__') ? id : '';
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
        .slice(0, 8)
        .map((item) => ({
          id: item.id,
          label: typeof item.label === 'string' ? item.label.slice(0, 80) : item.id,
          distance: Number.isFinite(Number(item.distance)) ? Number(item.distance) : null,
        }))
    : [];
  return {
    gazeTarget: targetIds.has(value.gazeTarget) ? value.gazeTarget : null,
    visibleTargets,
    task: {
      name: 'service_device',
      step: ['reset_required', 'filter_required', 'complete'].includes(value.task?.step)
        ? value.task.step
        : 'reset_required',
    },
    deviceState: {
      resetPressed: Boolean(value.deviceState?.resetPressed),
      filterRemoved: Boolean(value.deviceState?.filterRemoved),
      lastActivatedTarget: targetIds.has(value.deviceState?.lastActivatedTarget)
        ? value.deviceState.lastActivatedTarget
        : null,
    },
    space: value.space && typeof value.space === 'object' ? value.space : null,
    avatar: value.avatar && typeof value.avatar === 'object' ? value.avatar : null,
    editableWorld: value.editableWorld && typeof value.editableWorld === 'object' ? value.editableWorld : null,
    objects: Array.isArray(value.objects)
      ? value.objects
          .filter((item) => item && targetIds.has(item.id))
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

function normalizeAction(raw, targetIds) {
  if (!raw || typeof raw !== 'object' || !ALLOWED_ACTIONS.has(raw.name)) return null;
  const args = raw.args && typeof raw.args === 'object' ? { ...raw.args } : {};

  if (['look_at', 'point_at', 'highlight', 'move_near'].includes(raw.name)) {
    if (!targetIds.has(args.targetId)) return null;
  }
  if (['delete_object', 'move_object'].includes(raw.name) && args.targetId && !targetIds.has(args.targetId)) return null;
  if (raw.name === 'press_button') args.targetId = 'red_button';
  if (raw.name === 'remove_filter') args.targetId = 'filter';
  if (raw.name === 'face_user') delete args.targetId;
  if (raw.name === 'highlight') {
    args.seconds = Math.max(0.5, Math.min(6, Number(args.seconds || 2.5)));
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

function normalizeModelReply(parsed, scene) {
  if (!parsed || typeof parsed !== 'object') return null;
  const text = typeof parsed.text === 'string' ? parsed.text.trim().slice(0, 1000) : '';
  if (!text) return null;
  const targetIds = collectSceneTargetIds(scene);
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.map((action) => normalizeAction(action, targetIds)).filter(Boolean).slice(0, 8)
    : [];
  const extendedActions = Array.isArray(parsed.extendedActions)
    ? parsed.extendedActions.map((action) => normalizeAction(action, targetIds)).filter(Boolean).slice(0, 8)
    : [];
  return {
    text,
    intent: typeof parsed.intent === 'string' ? parsed.intent.trim().slice(0, 80) : '',
    actions,
    extendedActions,
  };
}

async function generateStructured({ message, history, scene, toolResults, phase, locale }) {
  const prompt = [
    `LOCALE: ${locale}`,
    `PHASE: ${phase}`,
    `CURRENT SCENE CONTEXT:\n${JSON.stringify(scene, null, 2)}`,
    `RECENT CONVERSATION:\n${JSON.stringify(history, null, 2)}`,
    toolResults.length ? `ACTUAL TOOL RESULTS:\n${JSON.stringify(toolResults, null, 2)}` : '',
    `LATEST USER / SCENE MESSAGE:\n${message}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { text } = await generateText({
      model: MODEL,
      system: SYSTEM,
      prompt:
        attempt === 0
          ? prompt
          : `${prompt}\n\nYour previous output was not valid for the required JSON contract. Return ONLY the valid JSON object now.`,
      maxOutputTokens: 420,
      providerOptions: {
        gateway: {
          tags: ['project:spatial-ai-companion', 'feature:semantic-actions'],
        },
      },
    });

    const normalized = normalizeModelReply(extractJson(text), scene);
    if (normalized) return normalized;
  }

  throw new Error('Model did not return a valid structured response');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const configured = Boolean(
      process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY,
    );
    return res.status(configured ? 200 : 503).json({
      ok: configured,
      provider: 'vercel-ai-gateway-adapter',
      model: MODEL,
      contract: 'embodied-editable-world-v3',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1800) : '';
  if (!message) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const history = sanitizeHistory(body.history);
  const scene = sanitizeScene(body.scene);
  const toolResults = sanitizeToolResults(body.toolResults);
  const phase = body.phase === 'after_tools' ? 'after_tools' : 'initial';
  const locale = typeof body.locale === 'string' ? body.locale.slice(0, 32) : 'en-US';

  try {
    const reply = await generateStructured({ message, history, scene, toolResults, phase, locale });
    return res.status(200).json({ ok: true, ...reply });
  } catch (error) {
    console.error('AI Gateway semantic chat failed:', error);
    const status = Number(error?.statusCode || error?.status || 500);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: error?.message || 'AI response failed',
    });
  }
}
