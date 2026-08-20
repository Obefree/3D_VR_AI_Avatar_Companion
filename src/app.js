(() => {
  const $ = (id) => document.getElementById(id);
  const messages = $('messages');
  const nativeFetch = window.fetch.bind(window);
  const AI_ENDPOINT = window.__NOVA_AI_ENDPOINT || 'https://ugjjifmlivdufshkhmpa.supabase.co/functions/v1/nova-chat';
  const BASE_ACTIONS = new Set(['look_at','point_at','highlight','move_near','press_button','remove_filter','face_user']);
  const EXTENDED_ACTIONS = new Set(['raise_hand','lower_hand','wave','step','turn_body','neutral_pose','create_object','delete_object','move_object']);
  const DYNAMIC_SPATIAL_ACTIONS = new Set(['look_at','point_at','highlight','move_near']);

  let scene = createFallbackScene();
  let cloudAiReady = false;
  let activeTurn = false;
  let interactionQueue = Promise.resolve();
  let voiceRecognition = null;
  let voiceSession = false;
  let voiceTurnPending = false;
  let recognitionRunning = false;
  const conversation = [];

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const locale = () => navigator.language || 'en-US';
  const isRussian = () => locale().toLowerCase().startsWith('ru');

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function setConnection(text, active = false) {
    const pill = $('connection-pill');
    if (!pill) return;
    pill.textContent = text;
    pill.classList.toggle('muted', !active);
  }

  function setMode(text) { setText('mode-pill', text); }

  function toast(text, ms = 3400) {
    const el = $('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function renderMessage(role, text) {
    if (!messages) return;
    const item = document.createElement('div');
    item.className = `message ${role}`;
    item.innerHTML = `<span class="role">${role === 'user' ? 'You' : 'Nova'}</span><span class="body"></span>`;
    item.querySelector('.body').textContent = text;
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }

  function remember(role, text, show = true) {
    const content = String(text || '').trim();
    if (!content) return;
    conversation.push({ role, content });
    while (conversation.length > 18) conversation.shift();
    if (show) renderMessage(role, content);
  }

  function createFallbackScene() {
    const labels = new Map([
      ['device', 'service device'],
      ['red_button', 'red reset button'],
      ['filter', 'replaceable filter'],
    ]);
    const deviceState = { resetPressed: false, filterRemoved: false, lastActivatedTarget: null };
    const taskStep = () => deviceState.filterRemoved ? 'complete' : deviceState.resetPressed ? 'filter_required' : 'reset_required';
    return {
      isFallback: true,
      focusId: 'device',
      avatarState: 'idle',
      targets: new Map([...labels].map(([id, label]) => [id, { id, label }])),
      getSceneContext() {
        return {
          gazeTarget: this.focusId,
          visibleTargets: [...labels].map(([id, label]) => ({ id, label, distance: null })),
          task: { name: 'service_device', step: taskStep() },
          deviceState: { ...deviceState },
        };
      },
      setState(state) { this.avatarState = state; setText('agent-state', state); },
      async executeTool(name, args = {}) {
        const targetId = args.targetId || '';
        if (targetId && !labels.has(targetId)) return { ok: false, error: 'unknown_target', targetId };
        if (targetId) this.focusId = targetId;
        if (name === 'press_button') {
          deviceState.resetPressed = true;
          deviceState.lastActivatedTarget = 'red_button';
        }
        if (name === 'remove_filter') {
          if (!deviceState.resetPressed) return { ok: false, error: 'reset_required', targetId: 'filter' };
          deviceState.filterRemoved = true;
          deviceState.lastActivatedTarget = 'filter';
        }
        return { ok: true, action: name, targetId: targetId || undefined, taskStep: taskStep() };
      },
      async enterXR() { throw new Error('3D scene is not ready.'); },
    };
  }

  async function load3DScene() {
    setText('transport-state', 'loading 3D');
    try {
      const { SpatialScene } = await import('./scene.js');
      const realScene = new SpatialScene($('scene'), {
        onFocusChanged(id) { setText('focus-target', id ?? 'none'); },
        onStateChanged(state) { setText('agent-state', state); },
        onTool(name, args) { setText('last-tool', `${name}(${args?.targetId ?? ''})`); },
        onTargetActivated(id, result) { queueInteraction(() => handleTargetActivation(id, result)); },
      });
      scene = realScene;
      window.__novaScene = realScene;
      setText('focus-target', realScene.getSceneContext().gazeTarget ?? 'none');
      setText('transport-state', cloudAiReady ? 'AI ready' : '3D ready');
      setupXRButton();
    } catch (error) {
      console.error('3D scene failed to load:', error);
      setText('transport-state', cloudAiReady ? 'AI ready' : 'UI ready');
      toast('3D scene failed to load.', 5000);
    }
  }

  async function speak(text) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      await wait(Math.min(1300, 200 + text.length * 7));
      return;
    }
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = /[А-Яа-яЁё]/.test(text) ? 'ru-RU' : locale();
        utterance.rate = 1.03;
        utterance.pitch = 1.05;
        utterance.volume = 0.9;
        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
        setTimeout(finish, Math.min(9000, 1000 + text.length * 50));
      } catch { finish(); }
    });
  }

  async function say(text, transport = 'AI ready') {
    const value = String(text || '').trim();
    if (!value) return;
    scene.setState?.('speaking');
    setText('transport-state', transport);
    remember('assistant', value, true);
    await speak(value);
    scene.setState?.('idle');
  }

  async function fetchJSON(url, init = {}, attempts = 3, timeoutMs = 14000) {
    let lastError;
    for (let i = 0; i < attempts; i += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await nativeFetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
        return data;
      } catch (error) {
        lastError = error;
        if (i + 1 < attempts) {
          setConnection('Reconnecting…', true);
          setText('transport-state', `retry ${i + 1}/${attempts - 1}`);
          await wait(350 + i * 550);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new Error('Network request failed');
  }

  async function detectCloudAI(explicit = false) {
    try {
      const data = await fetchJSON(AI_ENDPOINT, { method: 'GET', headers: { Accept: 'application/json' } }, 2, 9000);
      if (!data?.ok) throw new Error('AI backend not ready');
      cloudAiReady = true;
      setMode('AI mode');
      setConnection(explicit ? 'Connected' : 'AI ready', true);
      setText('transport-state', 'AI ready');
      const button = $('live-button');
      if (button) button.textContent = explicit ? 'AI connected' : (button.textContent === 'Connecting…' ? 'Connect Live AI' : button.textContent);
      if (explicit) toast('Nova AI connected');
      return true;
    } catch (error) {
      console.warn('AI health check failed:', error);
      cloudAiReady = false;
      setMode('Demo mode');
      setConnection('Offline', false);
      setText('transport-state', 'AI unavailable');
      return false;
    }
  }

  async function connectLive() {
    const button = $('live-button');
    if (!button || button.disabled) return false;
    button.disabled = true;
    button.textContent = 'Connecting…';
    const ok = await detectCloudAI(true);
    button.disabled = false;
    if (!ok) {
      button.textContent = 'Connect Live AI';
      toast('AI backend is temporarily unavailable. Nova will retry automatically.', 5000);
    }
    return ok;
  }

  async function requestAI({ message, history, toolResults = [], phase = 'initial' }) {
    const data = await fetchJSON(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        message,
        history,
        scene: scene.getSceneContext?.() || {},
        toolResults,
        phase,
        locale: locale(),
      }),
    }, 3, 16000);
    if (!data?.ok || !data?.text) throw new Error(data?.error || 'Invalid AI response');
    return {
      text: String(data.text).trim(),
      intent: typeof data.intent === 'string' ? data.intent : '',
      actions: Array.isArray(data.actions) ? data.actions : [],
      extendedActions: Array.isArray(data.extendedActions) ? data.extendedActions : [],
    };
  }

  async function waitForEmbodiment(timeoutMs = 3500) {
    const began = performance.now();
    while (performance.now() - began < timeoutMs) {
      if (window.__novaEmbodimentReady && window.__novaEmbodiment?.execute) return window.__novaEmbodiment;
      await wait(50);
    }
    return window.__novaEmbodiment?.execute ? window.__novaEmbodiment : null;
  }

  function actionKey(action) { return `${action?.name || ''}:${JSON.stringify(action?.args || {})}`; }

  function combinedActions(reply) {
    const output = [];
    const seen = new Set();
    for (const action of [...(reply.actions || []), ...(reply.extendedActions || [])]) {
      if (!action || typeof action.name !== 'string') continue;
      const key = actionKey(action);
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ name: action.name, args: action.args && typeof action.args === 'object' ? { ...action.args } : {} });
      if (output.length >= 10) break;
    }
    return output;
  }

  async function executeAction(action) {
    const name = action?.name;
    const args = action?.args || {};
    setText('last-tool', `${name || 'unknown'}(${args.targetId ?? ''})`);

    if (BASE_ACTIONS.has(name)) {
      if (DYNAMIC_SPATIAL_ACTIONS.has(name) && args.targetId && !scene.targets?.has(args.targetId)) {
        return { ok: false, error: 'unknown_target', targetId: args.targetId };
      }
      return scene.executeTool(name, args);
    }

    if (EXTENDED_ACTIONS.has(name) || DYNAMIC_SPATIAL_ACTIONS.has(name)) {
      const embodiment = await waitForEmbodiment();
      if (!embodiment) return { ok: false, error: 'embodiment_not_ready', action: name };
      return embodiment.execute(action);
    }

    return { ok: false, error: 'action_not_allowed', action: name };
  }

  async function executeReplyActions(reply) {
    const results = [];
    for (const action of combinedActions(reply)) {
      try { results.push({ action, result: await executeAction(action) }); }
      catch (error) { results.push({ action, result: { ok: false, error: error?.message || 'execution_failed' } }); }
    }
    return results;
  }

  async function cloudRespond(text, options = {}) {
    const { preExecutedResults = [], showUser = true } = options;
    remember('user', text, showUser);
    const history = conversation.slice(0, -1).slice(-12);
    scene.setState?.('thinking');
    setMode('AI mode');
    setConnection('AI thinking', true);
    setText('transport-state', 'AI thinking');

    try {
      let reply = await requestAI({
        message: text,
        history,
        toolResults: preExecutedResults,
        phase: preExecutedResults.length ? 'after_tools' : 'initial',
      });
      let toolResults = await executeReplyActions(reply);
      const failed = toolResults.filter(({ result }) => !result?.ok);
      if (failed.length) {
        reply = await requestAI({ message: text, history, toolResults, phase: 'after_tools' });
        toolResults = await executeReplyActions(reply);
      }
      cloudAiReady = true;
      setMode('AI mode');
      setConnection('AI ready', true);
      await say(reply.text, 'AI ready');
      return true;
    } catch (error) {
      console.error('AI turn failed after retries:', error);
      cloudAiReady = false;
      setMode('Demo mode');
      setConnection('Retry next message', false);
      setText('transport-state', 'AI retry next turn');
      toast('AI request failed after retries. Nova will reconnect automatically on your next message.', 5600);
      await demoRespond(text, { alreadyRemembered: true, preExecutedResults });
      return false;
    }
  }

  async function demoRespond(text, options = {}) {
    const { alreadyRemembered = false, preExecutedResults = [] } = options;
    if (!alreadyRemembered) remember('user', text, true);
    scene.setState?.('thinking');
    setText('transport-state', 'demo fallback');
    await wait(80);
    const lower = String(text).toLowerCase();
    const context = scene.getSceneContext?.() || {};
    const failedReset = preExecutedResults.some((item) => item?.result?.error === 'reset_required');
    if (failedReset) {
      await scene.executeTool('look_at', { targetId: 'red_button' });
      await scene.executeTool('point_at', { targetId: 'red_button' });
      return say(isRussian() ? 'Сначала нужно нажать красную кнопку сброса.' : 'Press the red reset button first.', 'demo fallback');
    }
    if (context.task?.step === 'complete') return say(isRussian() ? 'Готово. Обслуживание завершено.' : 'Done. The task is complete.', 'demo fallback');
    if (lower.includes('кноп') || lower.includes('button')) {
      await scene.executeTool('look_at', { targetId: 'red_button' });
      await scene.executeTool('point_at', { targetId: 'red_button' });
      await scene.executeTool('highlight', { targetId: 'red_button', seconds: 2 });
      return say(isRussian() ? 'Вот красная кнопка сброса.' : 'Here is the red reset button.', 'demo fallback');
    }
    if (lower.includes('фильтр') || lower.includes('filter') || lower.includes('дальш') || lower.includes('next')) {
      await scene.executeTool('look_at', { targetId: 'filter' });
      await scene.executeTool('point_at', { targetId: 'filter' });
      return say(isRussian() ? 'Следующий объект — фильтр.' : 'The next object is the filter.', 'demo fallback');
    }
    return say(
      isRussian() ? 'AI сейчас недоступен. Я автоматически попробую подключиться снова со следующим сообщением.' : 'AI is unavailable right now. I will retry automatically on your next message.',
      'demo fallback',
    );
  }

  function queueInteraction(fn) {
    const run = interactionQueue.then(fn, fn);
    interactionQueue = run.catch((error) => console.error('Interaction failed:', error));
    return run;
  }

  async function sendPrompt(text, options = {}) {
    const value = String(text || '').trim();
    if (!value) return false;
    if ($('text-input')) $('text-input').value = '';
    activeTurn = true;
    try {
      if (!cloudAiReady) await detectCloudAI(false);
      return cloudAiReady ? await cloudRespond(value, options) : await demoRespond(value, options);
    } finally { activeTurn = false; }
  }

  async function handleTargetActivation(id, result) {
    let text;
    if (id === 'red_button') text = isRussian() ? 'Я нажал красную кнопку.' : 'I pressed the red button.';
    else if (id === 'filter' && result?.ok) text = isRussian() ? 'Я вынул фильтр.' : 'I removed the filter.';
    else if (id === 'filter') text = isRussian() ? 'Я попытался вынуть фильтр, но он не вышел.' : 'I tried to remove the filter, but it did not come out.';
    else text = isRussian() ? `Я выбрал объект ${id}. Что с ним делать?` : `I selected ${id}. What should I do with it?`;
    await sendPrompt(text, {
      preExecutedResults: [{ action: { name: 'physical_tap', args: { targetId: id } }, result }],
      showUser: true,
    });
  }

  async function runGuidedDemo() {
    await scene.executeTool('move_near', { targetId: 'device' });
    await scene.executeTool('look_at', { targetId: 'red_button' });
    await scene.executeTool('point_at', { targetId: 'red_button' });
    await scene.executeTool('highlight', { targetId: 'red_button', seconds: 2.5 });
    await say(isRussian() ? 'Начнём с красной кнопки. Нажми её или попроси меня нажать.' : 'Start with the red button. Tap it or ask me to press it.', cloudAiReady ? 'AI ready' : 'demo fallback');
  }

  function setVoiceButton(text) { const button = $('voice-demo-button'); if (button) button.textContent = text; }
  function stopVoiceSession() {
    voiceSession = false;
    voiceTurnPending = false;
    try { if (recognitionRunning) voiceRecognition?.abort?.(); } catch {}
    recognitionRunning = false;
    window.speechSynthesis?.cancel?.();
    setVoiceButton('Talk to Nova');
    setConnection(cloudAiReady ? 'AI ready' : 'Offline', cloudAiReady);
  }

  function startRecognition() {
    if (!voiceSession || !voiceRecognition || recognitionRunning || activeTurn || voiceTurnPending) return;
    try { voiceRecognition.lang = locale(); voiceRecognition.start(); }
    catch (error) { if (!String(error?.message || '').toLowerCase().includes('already')) toast('Voice recognition failed.'); }
  }
  function maybeResumeVoice() {
    if (!voiceSession || activeTurn || voiceTurnPending) return;
    setVoiceButton('Stop listening');
    setTimeout(startRecognition, 250);
  }
  function setupVoice() {
    const button = $('voice-demo-button');
    if (!button) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      button.addEventListener('click', () => toast('Voice recognition is not available in this browser.'));
      return;
    }
    voiceRecognition = new Recognition();
    voiceRecognition.lang = locale();
    voiceRecognition.interimResults = false;
    voiceRecognition.continuous = false;
    voiceRecognition.maxAlternatives = 1;
    voiceRecognition.onstart = () => {
      recognitionRunning = true;
      setVoiceButton('Listening…');
      scene.setState?.('listening');
      setConnection('Listening', true);
    };
    voiceRecognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (!text) return;
      voiceTurnPending = true;
      queueInteraction(async () => {
        try { await sendPrompt(text); }
        finally { voiceTurnPending = false; maybeResumeVoice(); }
      });
    };
    voiceRecognition.onerror = (event) => {
      recognitionRunning = false;
      if (event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        voiceSession = false;
        setVoiceButton('Talk to Nova');
        toast('Microphone permission was denied.');
        return;
      }
      toast(`Voice input error: ${event.error}`);
    };
    voiceRecognition.onend = () => {
      recognitionRunning = false;
      if (scene.avatarState === 'listening') scene.setState?.('idle');
      if (voiceSession && !voiceTurnPending && !activeTurn) maybeResumeVoice();
      else setVoiceButton(voiceSession ? 'Stop listening' : 'Talk to Nova');
    };
    button.addEventListener('click', () => {
      if (voiceSession) return stopVoiceSession();
      voiceSession = true;
      setVoiceButton('Stop listening');
      startRecognition();
    });
  }

  async function setupXRButton() {
    const button = $('xr-button');
    if (!button || !navigator.xr || scene.isFallback) return;
    const ar = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
    const vr = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
    if (ar || vr) button.classList.remove('hidden');
  }

  function bindUI() {
    $('send-button')?.addEventListener('click', () => queueInteraction(() => sendPrompt($('text-input')?.value)));
    $('text-input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') queueInteraction(() => sendPrompt(event.currentTarget.value));
    });
    $('demo-button')?.addEventListener('click', () => queueInteraction(runGuidedDemo));
    $('live-button')?.addEventListener('click', connectLive);
    document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => queueInteraction(() => sendPrompt(button.dataset.prompt))));
    setupVoice();
  }

  window.addEventListener('error', (event) => console.error('Browser error:', event.error || event.message));
  window.addEventListener('unhandledrejection', (event) => console.error('Unhandled rejection:', event.reason));

  window.__NovaApp = {
    send(text) { return queueInteraction(() => sendPrompt(text)); },
    connect: connectLive,
    reconnect() { return detectCloudAI(true); },
    getConversation() { return conversation.map((turn) => ({ ...turn })); },
    getSceneContext() { return scene.getSceneContext?.(); },
    stopVoice: stopVoiceSession,
    getAIState() { return { ready: cloudAiReady, endpoint: AI_ENDPOINT }; },
  };

  bindUI();
  remember('assistant', isRussian()
    ? 'Привет. Я Nova. Говори или пиши — я буду понимать сцену и выполнять доступные действия.'
    : 'Hi. I am Nova. Talk or type and I will understand the scene and perform available actions.', true);
  setText('transport-state', 'UI ready');
  setConnection('Connecting…', true);
  $('live-button') && ($('live-button').textContent = 'Connect Live AI');
  detectCloudAI(false).finally(load3DScene);
})();