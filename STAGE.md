# TV Stage — runbook

Branch: `feature/tv-stage`

## Start

1. Ollama running (`ollama serve` if needed). Model: `nova-prince` (fallback `qwen2.5:7b`).
2. From repo root:

```bash
node api/chat.js
```

3. Open `http://127.0.0.1:4173/?demo=tv` (hard refresh after code changes).

## Use

| Button | What it does |
|--------|----------------|
| **Жить** | Warm model → opening beat → living ambient (body only, no surprise voice) |
| **Реплика** | Fast adaptive reply (WANT + facts + talk history) |
| **След. бит** | Director note → one think beat |
| **Прогон** | Deterministic checklist (proof only) |
| **VR вид** | WASD + look; Esc exits |
| **● Сессия** | JSON log; optional video (SBS stereo default, or mono canvas) |

## Recording

- Check **Запись с сессией** + **SBS стерео** → Left–Right ≥3840×1920 via `vr180-recorder` (no dead cinematic UI on Stage).
- Uncheck SBS → mono main canvas webm.
- Stop session → downloads JSON (+ webm when recording).

## Speed

- Server warms Ollama on boot + every 3 min keep-alive.
- **Жить** awaits `?warm=1` before first dialogue.
- Hot replies are ~1–3 s; cold first warm can be 10–20 s.

## Smoke

```bash
node tools/tv-stage-e2e.mjs
node tools/bench-api-reply.mjs
```
