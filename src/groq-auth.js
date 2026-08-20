(() => {
  const PROXY = window.__NOVA_GROQ_PROXY || 'https://ugjjifmlivdufshkhmpa.supabase.co/functions/v1/nova-groq';
  const KEY_STORAGE = 'nova_groq_key_v1';
  const nativeFetch = window.fetch.bind(window);
  const state = {
    backendOk: false,
    generative: false,
    provider: null,
    keyPresent: false,
    keyStatus: 'unknown',
  };
  const active = String(window.__NOVA_AI_ENDPOINT || '').includes('nova-groq');

  const getKey = () => {
    try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
  };
  const setKey = (key) => {
    try {
      if (key) localStorage.setItem(KEY_STORAGE, key);
      else localStorage.removeItem(KEY_STORAGE);
    } catch {}
    state.keyPresent = Boolean(key);
  };
  const setNodeText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
  const toast = (text, ms = 5200) => {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), ms);
  };
  const isProxy = (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    return url === PROXY || url.includes('/functions/v1/nova-groq');
  };

  if (!active) {
    window.__NOVA_AUTH_READY = Promise.resolve({ ...state });
    window.__NovaGroqAuth = {
      connect() { return Promise.resolve(false); },
      disconnect() { setKey(''); },
      probe() { return Promise.resolve({ ...state }); },
      getState() { return { ...state, keyPresent: Boolean(getKey()) }; },
      getKeyForTesting() { return getKey(); },
    };
    return;
  }

  function humanStatus(status) {
    if (status === 'missing_key') return 'Groq disconnected';
    if (status === 'invalid_key') return 'Groq key invalid';
    if (status === 'rate_limited') return 'Groq rate limited';
    if (status === 'timeout') return 'Groq check timed out';
    if (status === 'key_check_failed') return 'Groq unavailable';
    return 'Command engine';
  }

  function patchAgentStatus() {
    const mode = document.getElementById('mode-pill');
    const connection = document.getElementById('connection-pill');
    const transport = document.getElementById('transport-state');
    const button = document.getElementById('live-button');

    if (state.backendOk && state.generative) {
      setNodeText(mode, 'AI mode');
      if (connection) { setNodeText(connection, 'Groq ready'); connection.classList.remove('muted'); }
      if (transport && ['Command engine','AI unavailable','AI retry next turn','starting','3D ready','AI ready'].includes(transport.textContent)) {
        setNodeText(transport, state.provider ? `Groq: ${state.provider}` : 'Groq ready');
      }
      if (button && !button.disabled) setNodeText(button, 'Groq connected');
      return;
    }

    if (!state.backendOk) return;
    setNodeText(mode, 'Agent mode');
    if (connection) { setNodeText(connection, humanStatus(state.keyStatus)); connection.classList.remove('muted'); }
    if (transport && ['AI ready','AI unavailable','AI retry next turn','starting','3D ready'].includes(transport.textContent)) {
      setNodeText(transport, 'Command engine');
    }
    if (button && !button.disabled) setNodeText(button, state.keyPresent ? 'Reconnect Groq' : 'Connect Groq');
  }

  async function probe() {
    try {
      const headers = { Accept: 'application/json' };
      const key = getKey();
      if (key) headers['X-Groq-Key'] = key;
      const response = await nativeFetch(PROXY, { method: 'GET', headers, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      state.backendOk = response.ok && data?.ok === true;
      state.generative = state.backendOk && data?.generative === true;
      state.provider = data?.provider || null;
      state.keyStatus = data?.keyStatus || (key ? 'unknown' : 'missing_key');
      state.keyPresent = Boolean(key);
      if (state.keyStatus === 'invalid_key') {
        setKey('');
        state.keyPresent = false;
      }
      patchAgentStatus();
      return { ...state };
    } catch (error) {
      console.warn('Groq proxy probe failed:', error);
      state.backendOk = false;
      state.generative = false;
      state.keyStatus = 'probe_failed';
      patchAgentStatus();
      return { ...state };
    }
  }

  async function connect() {
    const existing = getKey();
    const entered = window.prompt(
      'Paste your Groq API key. It will be stored only in this browser and sent through the Nova backend proxy.\n\nCreate a free key at console.groq.com/keys',
      existing,
    );
    if (entered == null) return false;
    const key = String(entered).trim();
    if (!key) {
      setKey('');
      state.generative = false;
      state.keyStatus = 'missing_key';
      patchAgentStatus();
      toast('No Groq key entered. Scene commands still work.');
      return false;
    }
    setKey(key);
    state.keyStatus = 'checking';
    patchAgentStatus();
    const result = await probe();
    if (result.generative) {
      toast('Groq AI connected and verified');
      return true;
    }
    toast(result.keyStatus === 'invalid_key' ? 'Groq key is invalid.' : `Groq connection failed: ${result.keyStatus}`);
    return false;
  }

  const authReady = probe();
  window.__NOVA_AUTH_READY = authReady;

  window.fetch = async (input, init = {}) => {
    if (!isProxy(input)) return nativeFetch(input, init);
    await authReady;
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input?.headers : undefined) || {});
    const key = getKey();
    if (key) headers.set('X-Groq-Key', key);
    const response = await nativeFetch(input, { ...init, headers });
    try {
      const method = String(init.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
      const data = await response.clone().json().catch(() => null);
      if (method === 'POST' && data) {
        if (data.generative === true || data.source === 'groq') {
          state.generative = true;
          state.provider = data.provider || state.provider;
          state.keyStatus = 'valid';
        } else if (data.aiAvailable === false || data.fastFallback === true) {
          state.generative = false;
          state.keyStatus = data.fallbackReason || data.keyStatus || state.keyStatus;
          if (state.keyStatus === 'invalid_key') setKey('');
        }
        patchAgentStatus();
      }
    } catch {}
    return response;
  };

  document.addEventListener('click', async (event) => {
    const button = event.target?.closest?.('#live-button');
    if (!button) return;
    await authReady;
    if (state.generative) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    setNodeText(button, 'Connecting Groq…');
    try { await connect(); }
    finally { button.disabled = false; patchAgentStatus(); }
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(patchAgentStatus);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    authReady.then(patchAgentStatus);
  });

  window.__NovaGroqAuth = {
    connect,
    disconnect() {
      setKey('');
      state.generative = false;
      state.keyStatus = 'missing_key';
      patchAgentStatus();
    },
    probe,
    getState() { return { ...state, keyPresent: Boolean(getKey()) }; },
    getKeyForTesting() { return getKey(); },
  };
})();
