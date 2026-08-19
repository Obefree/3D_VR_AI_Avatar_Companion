(() => {
  const $ = (id) => document.getElementById(id);
  const messages = $('messages');
  const ALLOWED_ACTIONS = new Set([
    'look_at',
    'point_at',
    'highlight',
    'move_near',
    'press_button',
    'remove_filter',
    'face_user',
  ]);
  const TARGETS = new Set(['device', 'red_button', 'filter']);

  let scene = createFallbackScene();
  let cloudAiReady = false;
  let voiceRecognition = null;
  let voiceSession = false;
  let voiceTurnPending = false;
  let recognitionRunning = false;
  let activeTurn = false;
  let interactionQueue = Promise.resolve();
  const conversation = [];

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
    while (conversation.length > 16) conversation.shift();
    if (show) renderMessage(role, content);
  }

  function locale() {
    return navigator.language || 'en-US';
  }

  function isRussian() {
    return locale().toLowerCase().startsWith('ru');
  }

  function createFallbackScene() {
    const labels = new Map([
      ['device', 'service device'],
      ['red_button', 'red reset button'],
      ['filter', 'replaceable filter'],
    ]);
    const deviceState = {
      resetPressed: false,
      filterRemoved: false,
      lastActivatedTarget: null,
    };
    const taskStep = () => {
      if (deviceState.filterRemoved) return 'complete';
      if (deviceState.resetPressed) return 'filter_required';
      return 'reset_required';
    };

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
      setState(state) {
        this.avatarState = state;
        setText('agent-state', state);
      },
      async executeTool(name, args = {}) {
        const targetId = args.targetId || '';
        setText('last-tool', `${name}(${targetId})`);
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
      async enterXR() {
        throw new Error('3D scene is not ready, so XR cannot start yet.');
      },
    };
  }

  async function load3DScene() {
    setText('transport-state', 'loading 3D');
    try {
      const { SpatialScene } = await import('./scene.js');
      const realScene = new SpatialScene($('scene'), {
        onFocusChanged(id) {
          setText('focus-target', id ?? 'none');
        },
        onStateChanged(state) {
          setText('agent-state', state);
        },
        onTool(name, args) {
          setText('last-tool', `${name}(${args?.targetId ?? ''})`);
        },
        onTargetActivated(id, result) {
          queueInteraction(() => handleTargetActivation(id, result));
        },
      });
      scene = realScene;
      window.__novaScene = realScene;
      setText('transport-state', cloudAiReady ? 'AI ready' : '3D ready');
      setText('focus-target', scene.getSceneContext().gazeTarget ?? 'none');
      setupXRButton();
    } catch (error) {
      console.error('3D scene failed to load:', error);
      setText('transport-state', cloudAiReady ? 'AI ready' : 'UI demo ready');
      toast('3D failed to load, but conversation controls still work.', 5200);
    }
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function speak(text) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return wait(Math.min(1400, 250 + text.length * 8));
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

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
        setTimeout(finish, Math.min(9000, 1200 + text.length * 55));
      } catch (error) {
        console.warn('Speech synthesis failed:', error);
        finish();
      }
    });
  }

  async function say(text, transportLabel = null) {
    const value = String(text || '').trim();
    if (!value) return;
    scene.setState('speaking');
    if (transportLabel) setText('transport-state', transportLabel);
    remember('assistant', value, true);
    await speak(value);
    scene.setState('idle');
  }

  function normalizeAction(raw) {
    if (!raw || typeof raw !== 'object' || !ALLOWED_ACTIONS.has(raw.name)) return null;
    const args = raw.args && typeof raw.args === 'object' ? { ...raw.args } : {};
    const targetId = args.targetId;

    if (['look_at', 'point_at', 'highlight', 'move_near'].includes(raw.name)) {
      if (!TARGETS.has(targetId)) return null;
    }
    if (raw.name === 'press_button') args.targetId = 'red_button';
    if (raw.name === 'remove_filter') args.targetId = 'filter';
    if (raw.name === 'face_user') delete args.targetId;
    if (raw.name === 'highlight') {
      args.seconds = Math.max(0.5, Math.min(6, Number(args.seconds || 2.5)));
    }

    return { name: raw.name, args };
  }

  async function executeActions(actions) {
    const safe = Array.isArray(actions) ? actions.map(normalizeAction).filter(Boolean).slice(0, 8) : [];
    const results = [];
    for (const action of safe) {
      try {
        setText('last-tool', `${action.name}(${action.args?.targetId ?? ''})`);
        const result = await scene.executeTool(action.name, action.args || {});
        results.push({ action, result });
      } catch (error) {
        results.push({ action, result: { ok: false, error: error?.message || 'execution_failed' } });
      }
    }
    return results;
  }

  async function requestAI({ message, history, toolResults = [], phase = 'initial' }) {
    const response = await fetch('./api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history,
        scene: scene.getSceneContext?.() || {},
        toolResults,
        phase,
        locale: locale(),
      }),
      cache: 'no-store',
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.text) {
      throw new Error(data?.error || `AI endpoint failed (${response.status})`);
    }
    return {
      text: String(data.text).trim(),
      intent: typeof data.intent === 'string' ? data.intent : '',
      actions: Array.isArray(data.actions) ? data.actions : [],
    };
  }

  async function cloudRespond(text, options = {}) {
    const { preExecutedResults = [], showUser = true } = options;
    if (showUser) remember('user', text, true);
    else remember('user', text, false);

    const history = conversation.slice(0, -1).slice(-12);
    scene.setState('thinking');
    setText('transport-state', 'AI thinking');
    setConnection('AI thinking', true);

    try {
      const phase = preExecutedResults.length ? 'after_tools' : 'initial';
      let reply = await requestAI({
        message: text,
        history,
        toolResults: preExecutedResults,
        phase,
      });

      let toolResults = await executeActions(reply.actions);
      const failed = toolResults.filter(({ result }) => !result?.ok);

      if (failed.length) {
        reply = await requestAI({
          message: text,
          history,
          toolResults,
          phase: 'after_tools',
        });
        const correctiveResults = await executeActions(reply.actions);
        if (correctiveResults.some(({ result }) => !result?.ok)) {
          reply.text = isRussian()
            ? 'Это действие сейчас недоступно. Сначала выполним необходимый предыдущий шаг.'
            : 'That action is not available yet. We need to complete the prerequisite first.';
        }
      }

      await say(reply.text, 'AI ready');
      setConnection('AI ready', true);
      return true;
    } catch (error) {
      console.error('Cloud AI failed; using demo fallback:', error);
      cloudAiReady = false;
      setText('mode-pill', 'Demo mode');
      setConnection('Demo fallback', false);
      toast('Cloud AI is unavailable, so Nova switched to the local fallback.', 4800);
      await demoRespond(text, { alreadyRemembered: true, preExecutedResults });
      return false;
    }
  }

  async function demoRespond(text, options = {}) {
    const { alreadyRemembered = false, preExecutedResults = [] } = options;
    if (!alreadyRemembered) remember('user', text, true);
    scene.setState('thinking');
    setText('transport-state', 'demo fallback');
    await wait(100);

    const context = scene.getSceneContext?.() || {};
    const step = context.task?.step;
    const lower = String(text).toLowerCase();
    const failedResetPrecondition = preExecutedResults.some((item) => item?.result?.error === 'reset_required');

    if (failedResetPrecondition) {
      await scene.executeTool('look_at', { targetId: 'red_button' });
      await scene.executeTool('point_at', { targetId: 'red_button' });
      await say(isRussian() ? 'Сначала нужно нажать красную кнопку сброса.' : 'Press the red reset button first.', 'demo fallback');
      return;
    }

    if (step === 'complete') {
      await say(isRussian() ? 'Готово. Сброс выполнен, фильтр извлечён.' : 'Done. The reset is complete and the filter has been removed.', 'demo fallback');
      return;
    }

    if (lower.includes('кноп') || lower.includes('button') || lower.includes('покаж') || lower.includes('show')) {
      await scene.executeTool('look_at', { targetId: 'red_button' });
      await scene.executeTool('point_at', { targetId: 'red_button' });
      await scene.executeTool('highlight', { targetId: 'red_button', seconds: 2.5 });
      await say(isRussian() ? 'Вот красная кнопка сброса.' : 'Here is the red reset button.', 'demo fallback');
      return;
    }

    if (step === 'filter_required' || lower.includes('дальш') || lower.includes('next') || lower.includes('фильтр') || lower.includes('filter')) {
      await scene.executeTool('look_at', { targetId: 'filter' });
      await scene.executeTool('point_at', { targetId: 'filter' });
      await scene.executeTool('highlight', { targetId: 'filter', seconds: 2.5 });
      await say(isRussian() ? 'Теперь нужно вынуть фильтр снизу.' : 'Next, remove the filter below the panel.', 'demo fallback');
      return;
    }

    await say(
      isRussian()
        ? 'Сейчас работает локальный резервный режим. Я могу показать кнопку, фильтр и провести по шагам.'
        : 'The local fallback is active. I can show the button, the filter, and guide the steps.',
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
    if (!value) return;
    if ($('text-input')) $('text-input').value = '';

    activeTurn = true;
    try {
      if (cloudAiReady) await cloudRespond(value, options);
      else await demoRespond(value, options);
    } finally {
      activeTurn = false;
    }
  }

  async function handleTargetActivation(id, result) {
    let text;
    if (id === 'red_button') {
      text = isRussian() ? 'Я нажал красную кнопку.' : 'I pressed the red button.';
    } else if (id === 'filter' && result?.ok) {
      text = isRussian() ? 'Я вынул фильтр.' : 'I removed the filter.';
    } else if (id === 'filter') {
      text = isRussian() ? 'Я попытался вынуть фильтр, но он не вышел.' : 'I tried to remove the filter, but it did not come out.';
    } else {
      text = isRussian() ? 'Я выбрал это устройство. Что мне с ним делать?' : 'I selected this device. What should I do with it?';
    }

    await sendPrompt(text, {
      preExecutedResults: [{ action: { name: 'physical_tap', args: { targetId: id } }, result }],
      showUser: true,
    });
  }

  async function runGuidedDemo() {
    await say(isRussian() ? 'Покажу, как я связываю речь с действиями в пространстве.' : 'I will show how conversation connects to spatial actions.', cloudAiReady ? 'AI ready' : 'demo fallback');
    await scene.executeTool('move_near', { targetId: 'device' });
    await scene.executeTool('look_at', { targetId: 'red_button' });
    await scene.executeTool('point_at', { targetId: 'red_button' });
    await scene.executeTool('highlight', { targetId: 'red_button', seconds: 2.5 });
    await say(isRussian() ? 'Начнём с красной кнопки. Нажми её или попроси меня нажать.' : 'Start with the red button. Tap it or ask me to press it.', cloudAiReady ? 'AI ready' : 'demo fallback');
  }

  async function detectCloudAI(explicit = false) {
    try {
      const response = await fetch('./api/chat', { method: 'GET', cache: 'no-store' });
      if (!response.ok) throw new Error(`AI health ${response.status}`);
      const data = await response.json().catch(() => null);
      if (!data?.ok) throw new Error('AI backend not ready');
      cloudAiReady = true;
      setText('mode-pill', 'AI mode');
      setConnection(explicit ? 'Connected' : 'AI ready', true);
      setText('transport-state', 'AI ready');
      if (explicit) {
        const button = $('live-button');
        if (button) button.textContent = 'AI connected';
        toast('Nova AI connected');
      }
      return true;
    } catch (error) {
      cloudAiReady = false;
      setText('mode-pill', 'Demo mode');
      setConnection('Offline', false);
      setText('transport-state', 'demo ready');
      return false;
    }
  }

  async function connectLive() {
    const button = $('live-button');
    if (!button || button.disabled) return;
    if (cloudAiReady && button.textContent === 'AI connected') {
      toast('Nova AI is already connected.');
      return;
    }
    button.disabled = true;
    button.textContent = 'Connecting…';
    const ok = await detectCloudAI(true);
    button.disabled = false;
    if (!ok) {
      button.textContent = 'Connect Live AI';
      toast('Nova AI is unavailable right now. Demo mode still works.', 5200);
    }
  }

  function setVoiceButton(text) {
    const button = $('voice-demo-button');
    if (button) button.textContent = text;
  }

  function stopVoiceSession() {
    voiceSession = false;
    voiceTurnPending = false;
    try {
      if (recognitionRunning) voiceRecognition?.abort?.();
    } catch {}
    recognitionRunning = false;
    window.speechSynthesis?.cancel?.();
    setVoiceButton('Talk to Nova');
    if (cloudAiReady) setConnection('AI ready', true);
    else setConnection('Offline', false);
  }

  function startRecognition() {
    if (!voiceSession || !voiceRecognition || recognitionRunning || activeTurn || voiceTurnPending) return;
    try {
      voiceRecognition.lang = locale();
      voiceRecognition.start();
    } catch (error) {
      if (!String(error?.message || '').toLowerCase().includes('already')) {
        toast(error?.message || 'Voice recognition failed.');
      }
    }
  }

  function maybeResumeVoice() {
    if (!voiceSession || activeTurn || voiceTurnPending) return;
    setVoiceButton('Stop listening');
    setTimeout(startRecognition, 350);
  }

  function setupVoice() {
    const button = $('voice-demo-button');
    if (!button) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!Recognition) {
      button.addEventListener('click', () => {
        toast('Voice recognition is not available in this browser. Type a message instead.');
      });
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
      scene.setState('listening');
      setConnection('Listening', true);
    };

    voiceRecognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (!text) return;
      voiceTurnPending = true;
      queueInteraction(async () => {
        try {
          await sendPrompt(text);
        } finally {
          voiceTurnPending = false;
          maybeResumeVoice();
        }
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
      if (scene.avatarState === 'listening') scene.setState('idle');
      if (voiceSession && !voiceTurnPending && !activeTurn) maybeResumeVoice();
      else if (voiceSession) setVoiceButton('Stop listening');
      else setVoiceButton('Talk to Nova');
    };

    button.addEventListener('click', () => {
      if (voiceSession) {
        stopVoiceSession();
        return;
      }
      voiceSession = true;
      setVoiceButton('Stop listening');
      startRecognition();
    });
  }

  async function setupXRButton() {
    const button = $('xr-button');
    if (!button || !navigator.xr || scene.isFallback) return;
    const arSupported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
    const vrSupported = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
    if (!arSupported && !vrSupported) return;
    button.classList.remove('hidden');
    if (button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      try {
        const mode = await scene.enterXR();
        toast(`Entered ${mode}`);
      } catch (error) {
        toast(error.message);
      }
    });
  }

  function bindUI() {
    $('send-button')?.addEventListener('click', () => queueInteraction(() => sendPrompt($('text-input')?.value)));
    $('text-input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') queueInteraction(() => sendPrompt(event.currentTarget.value));
    });
    $('demo-button')?.addEventListener('click', () => queueInteraction(runGuidedDemo));
    $('live-button')?.addEventListener('click', connectLive);
    document.querySelectorAll('[data-prompt]').forEach((button) => {
      button.addEventListener('click', () => queueInteraction(() => sendPrompt(button.dataset.prompt)));
    });
    setupVoice();
  }

  window.addEventListener('error', (event) => {
    console.error('Browser error:', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
  });

  window.__NovaApp = {
    send(text) {
      return queueInteraction(() => sendPrompt(text));
    },
    connect() {
      return connectLive();
    },
    getConversation() {
      return conversation.map((turn) => ({ ...turn }));
    },
    getSceneContext() {
      return scene.getSceneContext?.();
    },
    stopVoice: stopVoiceSession,
  };

  bindUI();
  remember(
    'assistant',
    isRussian()
      ? 'Привет. Я Nova. Можешь говорить со мной или писать — я буду связывать ответы с действиями в сцене.'
      : 'Hi. I am Nova. Talk or type to me and I will connect my answers to actions in the scene.',
    true,
  );
  setText('transport-state', 'UI ready');
  setConnection('Offline', false);
  $('live-button') && ($('live-button').textContent = 'Connect Live AI');

  detectCloudAI(false).finally(load3DScene);
})();
