# Spatial AI Companion

A browser-first MVP of an **embodied realtime AI assistant** for games, VR, mixed reality and future AR glasses.

The same agent concept can act as a game companion, onboarding guide, museum character, training assistant, or spatial UI layer.

## What this MVP demonstrates

- a fully procedural 3D animated companion with no external model dependency;
- head gaze, idle motion, talking animation, pointing, highlighting and movement;
- semantic spatial targets (`device`, `red_button`, `filter`);
- center-view gaze / focus detection;
- safe application-defined tool calls instead of arbitrary AI control;
- realtime speech-to-speech through OpenAI Realtime WebRTC;
- a scripted fallback demo that works without any API key;
- browser speech recognition + speech synthesis for a zero-key voice demo;
- WebXR entry point for compatible headsets and browsers.

## Demo modes

### 1. Demo mode

Works as a static website. No server, account, API key or headset is required.

Try:

- `What am I looking at?`
- `Show me the red button`
- `What should I do next?`

Use **Talk to Nova** in Chrome/Edge to speak instead of typing. The browser performs speech recognition and Nova replies using built-in speech synthesis while the same spatial tool layer drives the 3D avatar.

### 2. Live AI mode

`Connect Live AI` creates a WebRTC session with the OpenAI Realtime API. Microphone audio and model audio are carried by WebRTC. Spatial actions are returned as function calls and executed locally in the 3D scene.

The permanent OpenAI API key stays on the server. It is intentionally never embedded in the static site.

## Architecture

```text
Browser / XR headset
       │
       ├── microphone ─────────────┐
       ├── head/view direction     │
       └── semantic scene context  │
                                  ▼
                         Realtime AI session
                         speech + reasoning
                         function calling
                                  │
                                  ▼
                             Tool Router
                                  │
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
                look             point          highlight
                  │               │               │
                  └──────────── 3D Avatar ─────────┘
```

The model never receives arbitrary JavaScript references and never executes code. It receives semantic IDs and may call only an allowlisted tool schema.

## Run the static demo locally

Any local web server works. For example:

```bash
npx serve . -l 4173
```

Then open `http://localhost:4173`.

Because Three.js is loaded through an import map from jsDelivr, there is no frontend build step for this first MVP.

## Public static preview

Because the repository is public, the latest `main` can also be rendered through a source CDN:

```text
https://raw.githack.com/Obefree/3D_VR_AI_Avatar_Companion/main/index.html
```

This preview runs Demo Mode, browser voice input, 3D spatial tools, and WebXR where the browser supports it. A source-CDN preview cannot run the server-only `/api/session` endpoint, so Live OpenAI Realtime requires a serverless deployment.

## Deploy the live version on Vercel

1. Import this GitHub repository into Vercel.
2. Add an environment variable:

```text
OPENAI_API_KEY=sk-...
```

3. Deploy.

Vercel automatically exposes `api/session.js` as `/api/session`.

The browser sends an SDP offer to that endpoint. The server forwards it to OpenAI's `POST /v1/realtime/calls` endpoint together with the session instructions and tool schemas, and returns the SDP answer.

## GitHub Pages

The included workflow deploys the static demo on pushes to `main`. GitHub Pages cannot safely hold a permanent OpenAI API key, so Pages intentionally runs the fully functional demo mode.

For a new repository, Pages must be enabled once with `Settings → Pages → Source → GitHub Actions`.

## WebXR

On supported browsers, an **Enter XR** button appears automatically.

The code prefers `immersive-ar` and falls back to `immersive-vr`. In AR, the synthetic demo room is hidden while the avatar and semantic demo objects remain spatial content.

A later native Quest build can replace the semantic demo context with Meta passthrough camera, scene/depth and anchors while keeping the same agent/tool contract.

## Current tool contract

```json
look_at({ "targetId": "red_button" })
point_at({ "targetId": "red_button" })
highlight({ "targetId": "red_button", "seconds": 3 })
move_near({ "targetId": "device" })
```

Allowed target IDs:

- `device`
- `red_button`
- `filter`

## Security notes

- Never put `OPENAI_API_KEY` in frontend JavaScript.
- The model can call only explicit tools.
- Tool arguments use known semantic target IDs.
- A production version should add per-tool permissions, action cancellation, movement boundaries and user confirmation for consequential actions.
