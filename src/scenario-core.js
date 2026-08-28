(() => {
  const SCENE_ACTIONS = new Set(['look_at', 'point_at', 'highlight', 'move_near', 'press_button', 'remove_filter', 'face_user']);
  const EMBODIMENT_ACTIONS = new Set(['raise_hand', 'lower_hand', 'wave', 'step', 'turn_body', 'neutral_pose', 'create_object', 'delete_object', 'move_object']);
  const CORE_ACTIONS = new Set(['speak', 'wait', 'approach_user']);
  const ALL_ACTIONS = new Set([...SCENE_ACTIONS, ...EMBODIMENT_ACTIONS, ...CORE_ACTIONS]);

  const state = {
    running: false,
    stopRequested: false,
    lastPlan: null,
    lastSource: 'none',
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
  const russian = (text) => /[А-Яа-яЁё]/.test(String(text || ''));

  function scene() { return window.__novaScene || null; }
  function embodiment() { return window.__novaEmbodiment || null; }
  function profile() { return window.__novaCharacterProfile?.get?.() || {}; }
  function profilePrompt() { return window.__novaCharacterProfile?.promptContext?.() || ''; }

  async function waitForRuntime(timeoutMs = 9000) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      if (scene()?.scene && embodiment()?.execute) return true;
      await sleep(60);
    }
    throw new Error('3D actor runtime is not ready');
  }

  function cleanText(value) {
    return String(value || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  }

  function extractDialogue(segment) {
    const out = [];
    const regex = /[«“"]([^»”"]{1,500})[»”"]/g;
    let match;
    while ((match = regex.exec(segment))) out.push(match[1].trim());
    return out;
  }

  function detectEmotion(text) {
    const lower = text.toLowerCase();
    if (/улыб|рад|тепл|friendly|smil|happy|joy/.test(lower)) return 'warm';
    if (/трев|беспоко|страх|worried|afraid|anxious/.test(lower)) return 'concerned';
    if (/зл|серд|angry|irritat/.test(lower)) return 'tense';
    if (/груст|sad|quietly|тихо/.test(lower)) return 'soft';
    if (/быстро|срочно|urgent|quick/.test(lower)) return 'urgent';
    return 'neutral';
  }

  function splitScenario(script) {
    const text = cleanText(script);
    if (!text) return [];
    const held = [];
    const masked = text.replace(/[«“"][^»”"]{0,500}[»”"]/g, (chunk) => {
      held.push(chunk);
      return `\u0000Q${held.length - 1}\u0000`;
    });
    const raw = masked
      .split(/\n+|(?<=[.!?])\s+(?=[А-ЯA-ZЁ])/u)
      .map((item) => item.replace(/\u0000Q(\d+)\u0000/g, (_, index) => held[Number(index)]).trim())
      .filter(Boolean);
    const beats = [];
    raw.forEach((segment, index) => {
      const dialogue = extractDialogue(segment);
      const direction = segment.replace(/[«“"][^»”"]{1,500}[»”"]/g, '').trim();
      beats.push({
        id: `beat_${index + 1}`,
        raw: segment,
        direction,
        dialogue,
        emotion: detectEmotion(segment),
      });
    });
    return beats;
  }

  function targetFromText(text, runtimeScene) {
    const lower = text.toLowerCase();
    const targets = [...(runtimeScene?.targets?.values?.() || [])];
    for (const target of targets) {
      if (target?.internal) continue;
      const id = String(target.id || '').toLowerCase();
      const label = String(target.label || '').toLowerCase();
      if ((id && lower.includes(id.replace(/_/g, ' '))) || (label && lower.includes(label))) return target.id;
    }
    if (/кноп|button/.test(lower) && runtimeScene?.targets?.has('red_button')) return 'red_button';
    if (/фильтр|filter/.test(lower) && runtimeScene?.targets?.has('filter')) return 'filter';
    if (/устройств|device|аппарат/.test(lower) && runtimeScene?.targets?.has('device')) return 'device';
    return null;
  }

  function pushUnique(actions, action) {
    if (!action?.name || !ALL_ACTIONS.has(action.name)) return;
    const key = `${action.name}:${JSON.stringify(action.args || {})}`;
    if (!actions.some((item) => `${item.name}:${JSON.stringify(item.args || {})}` === key)) actions.push(action);
  }

  function actionsForBeat(beat, runtimeScene, actorProfile, context = {}) {
    const text = `${beat.direction} ${beat.raw}`.toLowerCase();
    const actions = [];
    const targetId = targetFromText(text, runtimeScene);
    const movement = actorProfile.movement || {};
    const character = actorProfile.character || {};
    const socialDistance = clamp(movement.personalDistanceMeters ?? 1.35, 0.8, 3.5);
    const gestureIntensity = clamp(movement.gestureIntensity ?? 0.55, 0, 1);
    const gazeEngagement = clamp(movement.gazeEngagement ?? 0.82, 0, 1);
    const viewerAttention = Boolean(context.viewerAttention);

    const referencesViewer = /зрител|геро|пользовател|собесед|viewer|user|hero|camera|камер/.test(text);
    const looks = /смотр|гляд|look|notice|замеч|видит|sees/.test(text);
    const approaches = /подход|подойд|приближ|ближе|ид[её]т к|walks? (?:up|to|closer)|comes? closer|approach/.test(text);
    const waves = /машет|помах|wave|greet|приветствует/.test(text);
    const points = /показыва|указывает|point|gesture toward/.test(text);
    const turns = /поворач|turns?|разворач/.test(text);
    const stepsBack = /отход|назад|steps? back|moves? back/.test(text);
    const stepsLeft = /влево|налево|steps? left|moves? left/.test(text);
    const stepsRight = /вправо|направо|steps? right|moves? right/.test(text);
    const pauses = /пауза|молчит|жд[её]т|pause|waits?|silence/.test(text);

    if ((referencesViewer || viewerAttention) && (looks || gazeEngagement > 0.68 || beat.dialogue.length)) {
      pushUnique(actions, { name: 'face_user', args: {} });
    }
    if (targetId && looks) pushUnique(actions, { name: 'look_at', args: { targetId } });
    if (turns && (referencesViewer || viewerAttention)) pushUnique(actions, { name: 'face_user', args: {} });
    else if (turns && !targetId) pushUnique(actions, { name: 'turn_body', args: { degrees: 45 } });
    // A named scene object is the destination — do not also walk to the camera.
    if (approaches && targetId && !referencesViewer) {
      pushUnique(actions, { name: 'move_near', args: { targetId } });
    } else if (approaches && (referencesViewer || viewerAttention || !targetId)) {
      pushUnique(actions, { name: 'approach_user', args: { distance: socialDistance } });
    }
    if (waves || (/привет|hello|hi\b/.test(text) && gestureIntensity > 0.32 && (character.warmth ?? 0.7) > 0.5)) pushUnique(actions, { name: 'wave', args: { side: 'left' } });
    if (points && targetId) {
      pushUnique(actions, { name: 'look_at', args: { targetId } });
      pushUnique(actions, { name: 'point_at', args: { targetId } });
    }
    if (stepsBack) pushUnique(actions, { name: 'step', args: { direction: 'back', distance: 0.55 } });
    if (stepsLeft) pushUnique(actions, { name: 'step', args: { direction: 'left', distance: 0.45 } });
    if (stepsRight) pushUnique(actions, { name: 'step', args: { direction: 'right', distance: 0.45 } });
    if (pauses) pushUnique(actions, { name: 'wait', args: { ms: 700 } });

    for (const line of beat.dialogue) {
      if (gazeEngagement > 0.62) pushUnique(actions, { name: 'face_user', args: {} });
      actions.push({ name: 'speak', args: { text: line, emotion: beat.emotion } });
    }

    if (actions.length > 2 && gestureIntensity < 0.35) {
      return actions.filter((action) => action.name !== 'wave' && action.name !== 'raise_hand');
    }
    return actions;
  }

  function localCompile(script) {
    const runtimeScene = scene();
    const actorProfile = profile();
    let viewerAttention = false;
    const beats = splitScenario(script).map((beat) => {
      const actions = actionsForBeat(beat, runtimeScene, actorProfile, { viewerAttention });
      const text = `${beat.direction} ${beat.raw}`.toLowerCase();
      if (/зрител|геро|пользовател|собесед|viewer|user|hero|camera|камер/.test(text) || beat.dialogue.length) {
        viewerAttention = true;
      }
      return { ...beat, actions };
    });
    const actions = beats.flatMap((beat) => beat.actions);
    if (!actions.length) {
      actions.push({ name: 'face_user', args: {} });
      actions.push({ name: 'speak', args: { text: russian(script) ? 'Я поняла сцену. Дай мне более конкретное действие или реплику.' : 'I understand the scene. Give me a more specific action or line.' } });
    }
    return { source: 'local', beats, actions };
  }

  function normalizeAiActions(data) {
    const runtimeScene = scene();
    const combined = [...(Array.isArray(data?.actions) ? data.actions : []), ...(Array.isArray(data?.extendedActions) ? data.extendedActions : [])];
    const output = [];
    for (const raw of combined) {
      if (!raw || !ALL_ACTIONS.has(raw.name)) continue;
      const args = raw.args && typeof raw.args === 'object' ? { ...raw.args } : {};
      if (args.targetId && !runtimeScene?.targets?.has(args.targetId)) continue;
      pushUnique(output, { name: raw.name, args });
      if (output.length >= 16) break;
    }
    return output;
  }

  function mergePlans(localPlan, aiActions) {
    if (!aiActions.length) return localPlan;
    const actions = [];
    // Local character-aware beats stay the spine so AI extras cannot drop approach/wave/speech.
    for (const action of localPlan.actions) pushUnique(actions, action);
    for (const action of aiActions) {
      if (action.name === 'speak') continue;
      pushUnique(actions, action);
    }
    if (!actions.some((action) => action.name === 'face_user') && actions.some((action) => action.name === 'speak')) {
      actions.unshift({ name: 'face_user', args: {} });
    }
    return { ...localPlan, source: 'ai+local', actions };
  }

  async function aiCompile(script, localPlan) {
    const endpoint = window.__NOVA_AI_ENDPOINT;
    if (!endpoint) return localPlan;
    const runtimeScene = scene();
    const actionVocabulary = [...ALL_ACTIONS].join(', ');
    const message = [
      'SCENARIO DIRECTOR MODE. You are planning embodied acting, not chatting with the user.',
      profilePrompt(),
      `AVAILABLE PHYSICAL ACTIONS: ${actionVocabulary}.`,
      'Use only those physical actions through the normal action/tool output. Do not invent new tools.',
      'Do not generate bone rotations or animation keyframes. Plan intentions and meaningful physical actions only.',
      'Keep actions ordered as a performance. Preserve explicit dialogue; the local scenario core handles spoken lines.',
      `SCENE TARGETS: ${[...(runtimeScene?.targets?.values?.() || [])].filter((t) => !t.internal).map((t) => `${t.id}:${t.label}`).join(', ')}`,
      `SCENARIO:\n${script}`,
    ].join('\n\n');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        message,
        history: [],
        scene: runtimeScene?.getSceneContext?.() || {},
        toolResults: [],
        phase: 'initial',
        locale: navigator.language || 'en-US',
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `AI HTTP ${response.status}`);
    return mergePlans(localPlan, normalizeAiActions(data));
  }

  async function compile(script, options = {}) {
    await waitForRuntime();
    const localPlan = localCompile(script);
    if (options.ai === false) return localPlan;
    try { return await aiCompile(script, localPlan); }
    catch (error) {
      console.warn('Scenario AI planning unavailable; using local character-aware plan:', error);
      return localPlan;
    }
  }

  function viewerWorldPosition(runtimeScene) {
    if (typeof runtimeScene?.getViewerWorldPosition === 'function') return runtimeScene.getViewerWorldPosition();
    const THREE = window.__novaEmbodiment?.THREE;
    if (THREE && runtimeScene?.camera) return runtimeScene.camera.getWorldPosition(new THREE.Vector3());
    return null;
  }

  async function approachUser(args = {}) {
    const runtimeScene = scene();
    const viewer = viewerWorldPosition(runtimeScene);
    if (!viewer || !runtimeScene?.avatar) return { ok: false, error: 'viewer_unavailable' };
    const start = runtimeScene.avatar.position.clone();
    const desiredDistance = clamp(args.distance ?? profile()?.movement?.personalDistanceMeters ?? 1.35, 0.8, 3.5);
    const flatTarget = viewer.clone();
    flatTarget.y = start.y;
    const delta = flatTarget.sub(start);
    const current = delta.length();
    if (current <= desiredDistance + 0.05) return { ok: true, action: 'approach_user', moved: 0 };
    const move = Math.min(2.2, current - desiredDistance);
    const end = start.clone().add(delta.normalize().multiplyScalar(move));
    runtimeScene.setState?.('moving');
    const started = performance.now();
    const duration = Math.max(650, move * 720 / clamp(profile()?.movement?.baseTempo ?? 1, 0.5, 1.8));
    await new Promise((resolve) => {
      const tick = (now) => {
        const t = Math.min(1, (now - started) / duration);
        const smooth = t * t * (3 - 2 * t);
        runtimeScene.avatar.position.lerpVectors(start, end, smooth);
        if (t < 1 && !state.stopRequested) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    runtimeScene.setState?.('idle');
    return { ok: true, action: 'approach_user', moved: Number(move.toFixed(2)) };
  }

  async function speakLine(text) {
    const value = cleanText(text);
    if (!value) return { ok: true, action: 'speak', skipped: true };
    const runtimeScene = scene();
    runtimeScene.setState?.('speaking');
    setStatus(`Nova: ${value}`);
    if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        const utterance = new SpeechSynthesisUtterance(value);
        utterance.lang = russian(value) ? 'ru-RU' : (navigator.language || 'en-US');
        const speech = profile()?.speech || {};
        utterance.rate = /calm/i.test(speech.tempo || '') ? 0.94 : 1.0;
        utterance.pitch = 1.02;
        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        setTimeout(finish, Math.min(12000, 1200 + value.length * 60));
      });
    } else {
      await sleep(Math.min(4500, 700 + value.length * 38));
    }
    runtimeScene.setState?.('idle');
    return { ok: true, action: 'speak', text: value };
  }

  async function execute(action) {
    if (state.stopRequested) return { ok: false, error: 'stopped' };
    const runtimeScene = scene();
    const name = action?.name;
    const args = action?.args || {};
    if (name === 'speak') return speakLine(args.text);
    if (name === 'wait') { await sleep(clamp(args.ms ?? 500, 80, 4000)); return { ok: true, action: 'wait' }; }
    if (name === 'approach_user') return approachUser(args);
    if (SCENE_ACTIONS.has(name)) return runtimeScene.executeTool(name, args);
    if (EMBODIMENT_ACTIONS.has(name)) return embodiment().execute({ name, args });
    return { ok: false, error: 'unsupported_action', action: name };
  }

  async function run(script, options = {}) {
    if (state.running) throw new Error('A scenario is already running');
    state.running = true;
    state.stopRequested = false;
    setStatus('Analyzing character and scenario…');
    try {
      const plan = await compile(script, options);
      state.lastPlan = plan;
      state.lastSource = plan.source;
      renderPlan(plan);
      const results = [];
      for (let i = 0; i < plan.actions.length; i += 1) {
        if (state.stopRequested) break;
        const action = plan.actions[i];
        setStatus(`Acting ${i + 1}/${plan.actions.length}: ${actionLabel(action)}`);
        results.push({ action, result: await execute(action) });
        await sleep(90);
      }
      setStatus(state.stopRequested ? 'Scenario stopped' : `Scenario complete · ${plan.source}`);
      return { ok: !state.stopRequested, plan, results };
    } finally {
      state.running = false;
      state.stopRequested = false;
    }
  }

  function stop() {
    state.stopRequested = true;
    try { window.speechSynthesis?.cancel?.(); } catch {}
    scene()?.setState?.('idle');
  }

  function actionLabel(action) {
    const args = action?.args || {};
    if (action?.name === 'speak') return `SPEAK “${String(args.text || '').slice(0, 56)}”`;
    return `${String(action?.name || '').toUpperCase()}${args.targetId ? ` → ${args.targetId}` : ''}`;
  }

  function setStatus(text) {
    const node = document.getElementById('nova-scenario-status');
    if (node) node.textContent = text;
  }

  function renderPlan(plan) {
    const node = document.getElementById('nova-scenario-plan');
    if (!node) return;
    node.innerHTML = '';
    for (const beat of plan.beats) {
      const row = document.createElement('div');
      row.className = 'nova-scenario-beat';
      row.innerHTML = `<strong>${beat.id}</strong><span>${beat.emotion}</span><div></div>`;
      row.querySelector('div').textContent = beat.raw;
      node.appendChild(row);
    }
    const actions = document.createElement('div');
    actions.className = 'nova-scenario-actions';
    actions.textContent = plan.actions.map(actionLabel).join('  ›  ');
    node.appendChild(actions);
  }

  function installStyles() {
    if (document.getElementById('nova-scenario-styles')) return;
    const style = document.createElement('style');
    style.id = 'nova-scenario-styles';
    style.textContent = `
      .nova-scenario-modal{position:fixed;inset:0;z-index:75;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(3,6,10,.68);backdrop-filter:blur(10px)}.nova-scenario-modal.open{display:flex}
      .nova-scenario-card{width:min(820px,100%);max-height:90vh;overflow:auto;padding:18px;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:#0c121b;color:#eef5ff;box-shadow:0 24px 70px rgba(0,0,0,.46);font:13px/1.45 system-ui,sans-serif}.nova-scenario-card h2{margin:0 0 4px;font-size:19px}.nova-scenario-card>p{margin:0 0 12px;color:#94a6ba}.nova-scenario-card textarea{width:100%;min-height:150px;box-sizing:border-box;border:1px solid rgba(255,255,255,.15);border-radius:12px;background:#070c12;color:#fff;padding:11px;resize:vertical;font:13px/1.5 system-ui,sans-serif}
      .nova-scenario-buttons{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.nova-scenario-buttons button{border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#182332;color:#fff;padding:8px 12px;cursor:pointer}.nova-scenario-buttons .primary{background:#245fa8}.nova-scenario-buttons .danger{background:#642c35}.nova-scenario-status{color:#acd0ff;margin:8px 0}.nova-scenario-plan{display:grid;gap:6px}.nova-scenario-beat{display:grid;grid-template-columns:auto auto 1fr;gap:8px;align-items:start;padding:7px 9px;border-radius:9px;background:rgba(255,255,255,.045)}.nova-scenario-beat span{color:#8da1b7}.nova-scenario-actions{padding:9px;color:#a8b4c2;font-size:11px;overflow:auto}.nova-scenario-launch{white-space:nowrap}
    `;
    document.head.appendChild(style);
  }

  function installUi() {
    if (document.getElementById('nova-scenario-modal')) return;
    installStyles();
    const modal = document.createElement('div');
    modal.id = 'nova-scenario-modal';
    modal.className = 'nova-scenario-modal';
    modal.innerHTML = `
      <section class="nova-scenario-card" role="dialog" aria-modal="true">
        <h2>Scenario Core</h2>
        <p>Character → situation → intentions → physical beats → dialogue. The AI never controls bones directly.</p>
        <textarea id="nova-scenario-script">Девушка замечает зрителя и поворачивается к нему. Она подходит ближе, приветливо машет рукой и говорит: «Привет. Я рада тебя видеть». Затем делает небольшую паузу и смотрит на устройство.</textarea>
        <div class="nova-scenario-buttons">
          <button id="nova-scenario-run" class="primary" type="button">AI → perform</button>
          <button id="nova-scenario-local" type="button">Local perform</button>
          <button id="nova-scenario-character" type="button">Character…</button>
          <button id="nova-scenario-stop" class="danger" type="button">Stop</button>
          <button id="nova-scenario-close" type="button">Close</button>
        </div>
        <div id="nova-scenario-status" class="nova-scenario-status">Ready</div>
        <div id="nova-scenario-plan" class="nova-scenario-plan"></div>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (event) => { if (event.target === modal) closeUi(); });
    modal.querySelector('#nova-scenario-close').addEventListener('click', closeUi);
    modal.querySelector('#nova-scenario-character').addEventListener('click', () => window.__novaCharacterProfile?.open?.());
    modal.querySelector('#nova-scenario-stop').addEventListener('click', stop);
    modal.querySelector('#nova-scenario-run').addEventListener('click', async () => {
      try { await run(modal.querySelector('#nova-scenario-script').value, { ai: true }); }
      catch (error) { setStatus(`Error: ${error?.message || error}`); }
    });
    modal.querySelector('#nova-scenario-local').addEventListener('click', async () => {
      try { await run(modal.querySelector('#nova-scenario-script').value, { ai: false }); }
      catch (error) { setStatus(`Error: ${error?.message || error}`); }
    });

    const row = document.querySelector('.button-row');
    if (row && !document.getElementById('nova-scenario-launch')) {
      const button = document.createElement('button');
      button.id = 'nova-scenario-launch';
      button.className = 'nova-scenario-launch';
      button.type = 'button';
      button.textContent = 'Scenario';
      button.addEventListener('click', openUi);
      row.appendChild(button);
    }
  }

  function openUi() {
    installUi();
    document.getElementById('nova-scenario-modal').classList.add('open');
  }

  function closeUi() {
    document.getElementById('nova-scenario-modal')?.classList.remove('open');
  }

  window.__novaScenarioCore = {
    splitScenario,
    compile,
    run,
    stop,
    open: openUi,
    close: closeUi,
    getState: () => ({ running: state.running, source: state.lastSource, lastPlan: state.lastPlan }),
    actions: () => [...ALL_ACTIONS],
  };

  window.addEventListener('DOMContentLoaded', installUi);
})();
