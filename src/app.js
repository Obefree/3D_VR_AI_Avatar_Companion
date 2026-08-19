(() => {
  const $ = (id) => document.getElementById(id);
  const messages = $('messages');
  let scene = createFallbackScene();
  let live = null;
  let liveMode = false;
  let voiceRecognition = null;
  let partialBubble = null;
  let demoBusy = false;

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

  function addMessage(role, text, replacePartial = false) {
    if (!messages) return;
    if (replacePartial && partialBubble) {
      partialBubble.querySelector('.body').textContent = text;
      partialBubble = null;
      messages.scrollTop = messages.scrollHeight;
      return;
    }

    const item = document.createElement('div');
    item.className = `message ${role}`;
    item.innerHTML = `<span class="role">${role === 'user' ? 'You' : 'Nova'}</span><span class="body"></span>`;
    item.querySelector('.body').textContent = text;
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }

  function updatePartialAssistant(text) {
    if (!messages) return;
    if (!partialBubble) {
      partialBubble = document.createElement('div');
      partialBubble.className = 'message assistant';
      partialBubble.innerHTML = '<span class="role">Nova</span><span class="body"></span>';
      messages.appendChild(partialBubble);
    }
    partialBubble.querySelector('.body').textContent = text;
    messages.scrollTop = messages.scrollHeight;
  }

  function createFallbackScene() {
    const labels = new Map([
      ['device', 'service device'],
      ['red_button', 'red reset button'],
      ['filter', 'replaceable filter'],
    ]);

    return {
      isFallback: true,
      focusId: 'device',
      targets: new Map([...labels].map(([id, label]) => [id, { id, label }])),
      getSceneContext() {
        return {
          gazeTarget: this.focusId,
          visibleTargets: [...labels].map(([id, label]) => ({ id, label, distance: null })),
          task: { name: 'service_device', step: 'identify_reset_control' },
        };
      },
      setState(state) {
        setText('agent-state', state);
      },
      async executeTool(name, args = {}) {
        const targetId = args.targetId || '';
        setText('last-tool', `${name}(${targetId})`);
        if (targetId && !labels.has(targetId)) return { ok: false, error: `Unknown targetId: ${targetId}` };
        if (targetId) this.focusId = targetId;
        return { ok: true, targetId };
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
          live?.pushSceneContext?.();
        },
        onStateChanged(state) {
          setText('agent-state', state);
        },
        onTool(name, args) {
          setText('last-tool', `${name}(${args?.targetId ?? ''})`);
        },
        onTargetActivated(id) {
          toast(`Spatial target: ${id}`);
        },
      });
      scene = realScene;
      setText('transport-state', '3D ready');
      setText('focus-target', scene.getSceneContext().gazeTarget ?? 'none');
      setupXRButton();
    } catch (error) {
      console.error('3D scene failed to load:', error);
      setText('transport-state', 'UI demo ready');
      toast('3D failed to load, but chat and buttons still work.', 5200);
    }
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.03;
      utterance.pitch = 1.05;
      utterance.volume = 0.9;
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn('Speech synthesis failed:', error);
    }
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function executeTool(name, args) {
    setText('last-tool', `${name}(${args?.targetId ?? ''})`);
    try {
      return await scene.executeTool(name, args);
    } catch (error) {
      console.error(`Tool ${name} failed:`, error);
      return { ok: false, error: error.message };
    }
  }

  async function say(text) {
    scene.setState('speaking');
    setText('transport-state', liveMode ? 'live AI' : 'demo');
    addMessage('assistant', text);
    speak(text);
    await wait(Math.min(1600, 300 + text.length * 11));
    scene.setState('idle');
  }

  async function demoRespond(text) {
    if (demoBusy) return;
    demoBusy = true;
    try {
      addMessage('user', text);
      scene.setState('thinking');
      setText('transport-state', 'thinking');
      await wait(180);

      const lower = text.toLowerCase();
      const focus = scene.getSceneContext?.().gazeTarget || 'device';

      if (lower.includes('red') || lower.includes('button') || lower.includes('кноп')) {
        await executeTool('look_at', { targetId: 'red_button' });
        await executeTool('point_at', { targetId: 'red_button' });
        await executeTool('highlight', { targetId: 'red_button', seconds: 3 });
        await say('The red control on the right is the reset button. Start with this one.');
        return;
      }

      if (lower.includes('next') || lower.includes('дальш') || lower.includes('filter') || lower.includes('фильтр')) {
        await executeTool('look_at', { targetId: 'filter' });
        await executeTool('point_at', { targetId: 'filter' });
        await executeTool('highlight', { targetId: 'filter', seconds: 3 });
        await say('Next, remove the cylindrical filter below the front panel.');
        return;
      }

      if (lower.includes('looking') || lower.includes('this') || lower.includes('это') || lower.includes('смотр') || lower.includes('what is')) {
        const id = focus || 'device';
        const label = scene.targets?.get?.(id)?.label || id.replaceAll('_', ' ');
        await executeTool('look_at', { targetId: id });
        await say(`You are looking at the ${label}. I can point to a control or guide you through the task.`);
        return;
      }

      if (lower.includes('help') || lower.includes('fix') || lower.includes('repair') || lower.includes('помог')) {
        await executeTool('move_near', { targetId: 'device' });
        await executeTool('look_at', { targetId: 'device' });
        await say('Sure. I will guide you step by step. First, find the red reset control on the front panel.');
        return;
      }

      if (lower.includes('hello') || lower.includes('hi') || lower.includes('привет')) {
        await say('Hi. I am Nova. Ask me to show you the reset button, identify what you are looking at, or guide you through the task.');
        return;
      }

      await say('I can help with this spatial demo. Try “Show me the red button”, “What am I looking at?”, or “What should I do next?”.');
    } finally {
      demoBusy = false;
      setText('transport-state', liveMode ? 'live AI' : 'demo');
    }
  }

  async function runGuidedDemo() {
    if (demoBusy) return;
    demoBusy = true;
    try {
      await say('Hi. I am Nova, a spatial AI companion.');
      addMessage('user', 'Can you help me with this device?');
      scene.setState('thinking');
      await wait(250);
      await executeTool('move_near', { targetId: 'device' });
      await executeTool('look_at', { targetId: 'device' });
      await say('Of course. I can combine conversation with spatial actions.');
      addMessage('user', 'Show me what I should touch first.');
      scene.setState('thinking');
      await wait(250);
      await executeTool('look_at', { targetId: 'red_button' });
      await executeTool('point_at', { targetId: 'red_button' });
      await executeTool('highlight', { targetId: 'red_button', seconds: 3 });
      await say('Start with the red reset button on the right.');
    } finally {
      demoBusy = false;
    }
  }

  async function sendPrompt(text) {
    const value = String(text || '').trim();
    if (!value) return;
    if ($('text-input')) $('text-input').value = '';

    if (liveMode && live?.connected) {
      try {
        live.sendText(value);
      } catch (error) {
        toast(error.message);
        liveMode = false;
        setText('mode-pill', 'Demo mode');
        await demoRespond(value);
      }
      return;
    }

    await demoRespond(value);
  }

  function setupVoiceDemo() {
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
    voiceRecognition.lang = 'en-US';
    voiceRecognition.interimResults = false;
    voiceRecognition.continuous = false;
    voiceRecognition.maxAlternatives = 1;

    voiceRecognition.onstart = () => {
      button.textContent = 'Listening…';
      scene.setState('listening');
      setConnection('listening', true);
    };

    voiceRecognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (text) sendPrompt(text);
    };

    voiceRecognition.onerror = (event) => {
      const message = event.error === 'not-allowed'
        ? 'Microphone permission was denied.'
        : `Voice input error: ${event.error}`;
      toast(message);
    };

    voiceRecognition.onend = () => {
      button.textContent = 'Talk to Nova';
      if (!liveMode) setConnection('Offline', false);
      scene.setState('idle');
    };

    button.addEventListener('click', () => {
      try {
        voiceRecognition.start();
      } catch (error) {
        if (!String(error.message).toLowerCase().includes('already')) toast(error.message);
      }
    });
  }

  async function backendAvailable() {
    try {
      const response = await fetch('./api/health', { method: 'GET', cache: 'no-store' });
      if (!response.ok) return false;
      const data = await response.json().catch(() => null);
      return Boolean(data?.ok);
    } catch {
      return false;
    }
  }

  function liveStatus(status, error) {
    setText('transport-state', status);
    const active = ['connected', 'listening', 'thinking', 'speaking'].includes(status);
    setConnection(status, active);
    scene.setState?.(status === 'connected' ? 'idle' : status);
    if (error) toast(error, 5200);
  }

  async function connectLive() {
    const button = $('live-button');
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Checking backend…';

    const available = await backendAvailable();
    if (!available) {
      button.disabled = false;
      button.textContent = 'Connect Live AI';
      liveMode = false;
      setText('mode-pill', 'Demo mode');
      setConnection('No AI backend', false);
      toast('OpenAI backend is not deployed on this host yet. Demo chat and Talk to Nova still work.', 6500);
      return;
    }

    button.textContent = 'Connecting…';
    try {
      const { RealtimeCompanion } = await import('./realtime.js');
      live = new RealtimeCompanion({
        audioElement: $('remote-audio'),
        scene,
        onStatus: liveStatus,
        onMessage: addMessage,
        onPartialAssistant: updatePartialAssistant,
        onTool: (name, args) => setText('last-tool', `${name}(${args?.targetId ?? ''})`),
      });
      await live.connect();
      liveMode = true;
      setText('mode-pill', 'Live AI');
      button.textContent = 'Live AI connected';
      setConnection('connected', true);
      toast('OpenAI Realtime is connected. You can speak naturally.');
    } catch (error) {
      console.error('Live AI connection failed:', error);
      live?.disconnect?.();
      live = null;
      liveMode = false;
      setText('mode-pill', 'Demo mode');
      button.disabled = false;
      button.textContent = 'Connect Live AI';
      setConnection('AI error', false);
      toast(`Live AI failed: ${error.message}`, 6500);
    }
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
    $('send-button')?.addEventListener('click', () => sendPrompt($('text-input')?.value));
    $('text-input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') sendPrompt(event.currentTarget.value);
    });
    $('demo-button')?.addEventListener('click', runGuidedDemo);
    $('live-button')?.addEventListener('click', connectLive);
    document.querySelectorAll('[data-prompt]').forEach((button) => {
      button.addEventListener('click', () => sendPrompt(button.dataset.prompt));
    });
    setupVoiceDemo();
  }

  window.addEventListener('error', (event) => {
    console.error('Browser error:', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
  });

  bindUI();
  addMessage('assistant', 'Hi. I am Nova. The controls are ready. Ask me about the device or run the guided demo.');
  setText('transport-state', 'UI ready');
  setConnection('Offline', false);
  load3DScene();
})();
