(() => {
  const ENDPOINTS = {
    supabaseGroqVault: 'https://ugjjifmlivdufshkhmpa.supabase.co/functions/v1/nova-groq-vault',
    userGroqProxy: 'https://ugjjifmlivdufshkhmpa.supabase.co/functions/v1/nova-groq',
    localApi: './api/chat',
  };

  const params = new URLSearchParams(window.location.search || '');
  const existing = window.__NovaRuntimeConfig && typeof window.__NovaRuntimeConfig === 'object'
    ? { ...window.__NovaRuntimeConfig }
    : {};
  const requestedMode = String(params.get('ai') || existing.mode || '').toLowerCase();
  const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  let aiEndpoint =
    window.__NOVA_AI_ENDPOINT ||
    existing.aiEndpoint ||
    (isLocalHost ? ENDPOINTS.localApi : ENDPOINTS.supabaseGroqVault);

  if (requestedMode === 'local') aiEndpoint = ENDPOINTS.localApi;
  if (requestedMode === 'user-groq') aiEndpoint = ENDPOINTS.userGroqProxy;
  if (requestedMode === 'vault' || requestedMode === 'production') aiEndpoint = ENDPOINTS.supabaseGroqVault;

  const isGroqEndpoint = /\/functions\/v1\/nova-groq(?:-vault)?$/i.test(aiEndpoint);
  const groqProxy =
    window.__NOVA_GROQ_PROXY ||
    existing.groqProxy ||
    (isGroqEndpoint ? aiEndpoint : ENDPOINTS.userGroqProxy);
  const serverManaged = /\/functions\/v1\/nova-groq-vault$/i.test(groqProxy);
  const resolvedMode =
    requestedMode ||
    existing.mode ||
    (isGroqEndpoint ? (serverManaged ? 'production' : 'user-groq') : 'local');

  window.__NOVA_AI_ENDPOINT = aiEndpoint;
  if (isGroqEndpoint) window.__NOVA_GROQ_PROXY = groqProxy;

  window.__NovaRuntimeConfig = {
    ...existing,
    mode: resolvedMode,
    aiEndpoint,
    groqProxy,
    serverManaged,
    transport: isGroqEndpoint ? 'supabase-groq' : 'local-api',
    endpoints: ENDPOINTS,
  };
})();
