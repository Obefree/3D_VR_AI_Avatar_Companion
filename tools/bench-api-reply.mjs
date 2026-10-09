const warmRes = await fetch('http://127.0.0.1:4173/api/chat?warm=1');
const warm = await warmRes.json();
console.log('warm', warm.warm);

const payload = {
  message: 'What do you see in the window?',
  mode: 'reply',
  locale: 'en-US',
  history: [{ role: 'assistant', content: 'I see you.' }],
  character: { name: 'Mara Vale', want: 'be seen', memory: 'at the window', forbidden: 'Ready' },
  scene: { visibleTargets: [{ id: 'actor_window' }] },
  phase: 'initial',
  toolResults: [],
};

for (const i of [1, 2, 3]) {
  const t = Date.now();
  const r = await fetch('http://127.0.0.1:4173/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await r.json();
  console.log(`reply${i}`, `${Date.now() - t}ms`, r.status, String(body.text || body.error || '').slice(0, 100));
}
