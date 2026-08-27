# Spatial AI Companion — Nova

Nova is a browser-first **anthropomorphic embodied AI companion** for games, VR, mixed reality and spatial interfaces.

She is not a chat box placed next to a 3D scene. The language model receives semantic scene/body context and can answer the user while invoking an allowlisted set of physical actions in the same world.

## Canonical live demo

Use only this current `main` build:

```text
https://raw.githack.com/Obefree/3D_VR_AI_Avatar_Companion/main/index.html
```

Older commit-pinned URLs are historical snapshots and are not the demo URL.

## Current stack

- Three.js + WebXR (`local-floor`) for browser/VR rendering.
- CC0 Quaternius **Animated Woman** GLB as Nova's visible humanoid body.
- Skeleton-driven gaze, pointing, hand raise/wave and conversational gestures.
- AnimationMixer clips for idle/walking where available.
- Browser SpeechRecognition for voice input and SpeechSynthesis for spoken replies.
- Groq server-side AI through a Supabase Edge Function; no API key is exposed to the browser.
- Fast deterministic command engine for simple scene actions, with Groq used for conversation and complex multi-action interpretation.
- Editable semantic 3D world and an allowlisted tool router.

## What Nova can do now

### Conversation

- answer free-form questions;
- keep short conversational context;
- respond in the user's language;
- speak replies aloud in browsers with SpeechSynthesis.

### Embodiment

- look at the user or a scene target;
- point at a target;
- raise/lower either hand;
- wave;
- turn her body;
- step in a direction by a requested distance;
- move near an object;
- return to a neutral pose.

### Scene interaction

- identify known objects and spatial relationships;
- highlight objects;
- press the service-device reset button;
- remove the service filter after reset;
- create box/sphere/cylinder/cone objects;
- move created objects;
- delete created objects.

The AI never receives arbitrary JavaScript references. It can request only actions exposed in the explicit tool schema, and the browser validates/executes them locally.

## Humanoid model

Nova currently uses the Quaternius Animated Woman model from the Ultimate Modular Women / Animated Women asset set.

- rigged and animated;
- glTF/GLB;
- Public Domain / CC0;
- permitted for personal and commercial projects.

The runtime loads the model, scales it to human height, resolves humanoid bones and maps Nova's semantic body state onto the skeleton. If the external model cannot load, the old procedural body remains only as a resilience fallback so scene logic still works.

## Architecture

```text
User text / microphone
        │
        ▼
Browser Nova runtime ─────────────── scene + body context
        │                                  │
        ▼                                  ▼
Supabase Groq proxy                  semantic 3D world
        │                                  │
        ▼                                  │
Groq conversation / tool calls             │
        │                                  │
        └──────────────► allowlisted tool router
                                   │
             ┌─────────────────────┼─────────────────────┐
             ▼                     ▼                     ▼
       humanoid body          scene objects       service device
       gaze/gesture/move      create/move/delete  button/filter
```

Simple known commands take the deterministic fast path so they do not wait for an LLM round trip. Compound or free-form requests use Groq and can return multiple physical actions in one turn.

## WebXR

On supported browsers/headsets the app exposes an **Enter XR** control. The renderer is WebXR-enabled and uses a `local-floor` reference space so Nova and scene objects retain meter-scale spatial positions.

The same `avatar` root is used in desktop and XR modes, so movement, turning, semantic body positions and tool actions are shared instead of having a separate VR-only character implementation.

## Run locally

```bash
npm install
npx serve . -l 4173
```

Open `http://localhost:4173`.

## Verification

The repository CI checks:

- JavaScript syntax;
- deterministic mobile scene/action flows;
- reconnect behavior;
- Groq connection state;
- compound multi-tool execution;
- real Supabase backend behavior;
- public CDN build behavior;
- real Quaternius GLB loading, skeleton resolution and humanoid hand/root movement.

Run the full local verification set with:

```bash
npm run verify
```

## Security

- The server Groq key is not embedded in frontend JavaScript.
- AI actions are allowlisted and arguments are sanitized.
- Built-in service objects cannot be deleted through dynamic-object tools.
- Movement and object sizes are clamped to scene bounds.
