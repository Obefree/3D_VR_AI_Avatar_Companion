(() => {
  const PROXY = window.__NOVA_OPENROUTER_PROXY || 'https://ugjjifmlivdufshkhmpa.supabase.co/functions/v1/nova-openrouter';
  const AUTH_URL = window.__NOVA_OPENROUTER_AUTH_URL || 'https://openrouter.ai/auth';
  const EXCHANGE_URL = window.__NOVA_OPENROUTER_EXCHANGE_URL || 'https://openrouter.ai/api/v1/auth/keys';
  const KEY_STORAGE = 'nova_openrouter_key_v1';
  const VERIFIER_STORAGE = 'nova_openrouter_pkce_verifier_v1';
  const nativeFetch = window.fetch.bind(window);
  const state = { backendOk: false, generative: false, provider: null, keyPresent: false, callbackHandled: false };
  const active = String(window.__NOVA_AI_ENDPOINT || '').includes('nova-openrouter');

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

  if (!active) {
    window.__NOVA_AUTH_READY = Promise.resolve({ ...state });
    window.__NovaOpenRouterAuth = {
      connect() { return Promise.resolve(false); },
      disconnect() { setKey(''); },
      probe() { return Promise.resolve({ ...state }); },
      getState() { return { ...state, keyPresent: Boolean(getKey()) }; },
      getKeyForTesting() { return getKey(); },
    };
    return;
  }

  const base64url = (bytes) => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  const callbackUrl = () => {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    return url.toString();
  };
  const isProxy = (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    return url === PROXY || url.includes('/functions/v1/nova-openrouter');
  };
  const toast = (text) => {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 5200);
  };

  async function exchangeCallback() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (!code) return false;
    let verifier = '';
    try { verifier = sessionStorage.getItem(VERIFIER_STORAGE) || ''; } catch {}
    if (!verifier) {
      state.callbackHandled = true;
      toast('OpenRouter authorization returned without a PKCE verifier. Please connect again.');
      return false;
    }
    try {
      const response = await nativeFetch(EXCHANGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.key) throw new Error(data?.error?.message || data?.error || `OpenRouter exchange failed (${response.status})`);
      setKey(String(data.key));
      try { sessionStorage.removeItem(VERIFIER_STORAGE); } catch {}
      history.replaceState({}, document.title, callbackUrl());
      state.callbackHandled = true;
      toast('OpenRouter Free connected');
      return true;
    } catch (error) {
      console.error('OpenRouter OAuth exchange failed:', error);
      state.callbackHandled = true;
      toast('OpenRouter connection failed. Please try Connect Live AI again.');
      return false;
    }
  }

  async function probe() {
    try {
      const headers = { Accept: 'application/json' };
      const key = getKey();
      if (key) headers['X-OpenRouter-Key'] = key;
      const response = await nativeFetch(PROXY, { method: 'GET', headers, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      state.backendOk = response.ok && data?.ok === true;
      state.generative = state.backendOk && data?.generative === true;
      state.provider = data?.provider || null;
      state.keyPresent = Boolean(key);
      return { ...state };
    } catch (error) {
      console.warn('OpenRouter proxy probe failed:', error);
      state.backendOk = false;
      state.generative = false;
      return { ...state };
    }
  }

  async function startOAuth() {
    const bytes = crypto.getRandomValues(new Uint8Array(48));
    const verifier = base64url(bytes);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = base64url(new Uint8Array(digest));
    try { sessionStorage.setItem(VERIFIER_STORAGE, verifier); } catch {}
    const url = new URL(AUTH_URL);
    url.searchParams.set('callback_url', callbackUrl());
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    location.assign(url.toString());
  }

  const authReady = (async () => {
    await exchangeCallback();
    await probe();
    return { ...state };
  })();
  window.__NOVA_AUTH_READY = authReady;

  window.fetch = async (input, init = {}) => {
    if (!isProxy(input)) return nativeFetch(input, init);
    await authReady;
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input?.headers : undefined) || {});
    const key = getKey();
    if (key) headers.set('X-OpenRouter-Key', key);
    return nativeFetch(input, { ...init, headers });
  };

  function patchAgentStatus() {
    if (!state.backendOk || state.generative) return;
    const mode = document.getElementById('mode-pill');
    const connection = document.getElementById('connection-pill');
    const transport = document.getElementById('transport-state');
    const button = document.getElementById('live-button');
    if (mode && ['AI mode', 'Demo mode'].includes(mode.textContent)) mode.textContent = 'Agent mode';
    if (connection && ['AI ready', 'Connected', 'Offline'].includes(connection.textContent)) {
      connection.textContent = 'Core ready';
      connection.classList.remove('muted');
    }
    if (transport && ['AI ready', 'AI unavailable', 'AI retry next turn'].includes(transport.textContent)) transport.textContent = 'Command engine';
    if (button && button.textContent === 'AI connected') button.textContent = 'Connect Live AI';
  }

  document.addEventListener('click', async (event) => {
    const button = event.target?.closest?.('#live-button');
    if (!button) return;
    await authReady;
    await probe();
    if (state.generative) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    button.textContent = 'Opening OpenRouter…';
    try { await startOAuth(); }
    catch (error) {
      console.error('OpenRouter OAuth start failed:', error);
      button.disabled = false;
      button.textContent = 'Connect Live AI';
      toast('Could not start OpenRouter authorization.');
    }
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(patchAgentStatus);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    authReady.then(() => patchAgentStatus());
  });

  window.__NovaOpenRouterAuth = {
    connect: startOAuth,
    disconnect() { setKey(''); state.generative = false; patchAgentStatus(); },
    probe,
    getState() { return { ...state, keyPresent: Boolean(getKey()) }; },
    getKeyForTesting() { return getKey(); },
  };
})();