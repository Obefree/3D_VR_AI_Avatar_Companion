const t0 = Date.now();
const r = await fetch('http://127.0.0.1:11434/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'nova-prince',
    stream: false,
    format: 'json',
    keep_alive: -1,
    messages: [
      {
        role: 'system',
        content:
          'You ARE Mara. WANT: be seen. Props: actor_window. Reply FAST one short sentence. ONLY JSON {"text":"...","do":"face_user","target":""}',
      },
      { role: 'user', content: 'BEAT. They said: What do you see?' },
    ],
    options: { temperature: 0.4, num_predict: 20, num_ctx: 512, num_gpu: -1 },
  }),
});
const j = await r.json();
console.log('direct', Date.now() - t0, 'ms status', r.status);
console.log(
  'eval_ms',
  (j.eval_duration || 0) / 1e6,
  'prompt_ms',
  (j.prompt_eval_duration || 0) / 1e6,
  'tokens',
  j.eval_count,
);
console.log(String(j.message?.content || j.error || '').slice(0, 240));
