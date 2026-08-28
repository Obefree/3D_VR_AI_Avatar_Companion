# Spatial AI Companion — Nova

Nova is a browser-first **anthropomorphic embodied AI actor/companion** for games, cinematic VR, mixed reality and spatial interfaces.

She is not a chat box next to a 3D scene. The AI receives semantic scene/body context and can answer the user while invoking an allowlisted set of physical actions in the same 3D world.

## Canonical live site

Use this single current `main` build:

```text
https://raw.githack.com/Obefree/3D_VR_AI_Avatar_Companion/main/index.html
```

This is the URL to keep sharing while the demo is under active development. RawGitHack's branch URL refreshes after new pushes to `main`, so we do not need a new site address for every version.

For a frozen management/demo snapshot, use the same URL format with a specific commit hash instead of `main`.

## What the current site contains

### AI actor mode

A screenplay or natural-language scene can be compiled into an ordered performance for Nova. The cinematic layer currently supports:

- noticing/facing the viewer;
- walking closer to the viewer;
- walking to scene targets;
- looking and pointing;
- waving and hand gestures;
- picking up a prop;
- sitting/standing demo behavior;
- spoken dialogue;
- cinematic stage targets: window, table, chair and glass.

The language model acts as a **director/planner**. Movement itself is executed by deterministic animation/embodiment code instead of asking the LLM to generate skeletal poses frame by frame.

### Actor polish

A post-animation polish layer makes the cinematic actor turn naturally toward the direction of movement, scene targets and the viewer. It also uses blink/smile morph targets when the loaded humanoid provides them, while remaining safe on models without facial morphs.

### Presentation mode

`Presentation mode` hides the development UI and old service-demo clutter so the same browser build can be shown as a cleaner cinematic scene.

### WebXR

On supported browsers/headsets the site exposes **Enter XR**. The renderer uses WebXR `local-floor`, and the same avatar root, scene coordinates and AI actions are used in desktop and headset modes.

### VR180 3D video for headsets

The site can also record a stereoscopic VR180 output rather than only run interactively.

Current presets:

- **VR180 Draft** — 4096×2048 / 30 fps;
- **Quest HQ** — 5760×2880 / 48 fps.

The recorder outputs cropped-equirectangular **VR180 3D Side-by-Side, Left/Right**. The default stereo baseline is **60 mm** to approximate Canon RF5.2mm Dual Fisheye geometry; a **64 mm** natural/headset option is also available.

Optional current-tab audio capture lets browser speech be included in the recording after the user grants tab-audio capture permission.

See `VR180_HEADSET.md` for playback/export notes.

## Current stack

- Three.js + WebXR (`local-floor`).
- CC0 Quaternius **Animated Woman** GLB as Nova's visible humanoid body.
- AnimationMixer locomotion/idle clips where available.
- Skeleton-driven gaze, pointing, hand raise/wave and conversational gestures.
- Actor-facing and optional facial-morph polish layer.
- Browser SpeechRecognition and SpeechSynthesis.
- Groq server-side AI through a Supabase Edge Function; no API key is exposed to the browser.
- Deterministic fast path for simple commands and Groq for conversation/compound interpretation.
- Editable semantic 3D world with an allowlisted action router.
- Browser VR180 stereo recorder.

## Core architecture

```text
Scene script / user speech / text
              │
              ▼
        AI director / Nova
              │
      ordered safe actions
              │
              ▼
       embodiment runtime
       │       │       │
       ▼       ▼       ▼
 locomotion  gaze/IK  objects
       │       │       │
       └───────┼───────┘
               ▼
        humanoid performance
          │             │
          ▼             ▼
       WebXR         VR180 SBS
    interactive      video export
```

## Regular companion abilities

Nova can also:

- answer free-form questions and speak replies;
- look at the user or scene targets;
- raise/lower either hand and wave;
- turn and step by requested distances;
- identify spatial relationships;
- create box/sphere/cylinder/cone objects;
- move/delete created objects;
- interact with the original service-demo button/filter workflow.

AI actions are allowlisted and validated locally. The model does not receive arbitrary JavaScript execution access.

## Humanoid model

Nova currently uses the Quaternius Animated Woman model from the Ultimate Modular Women / Animated Women asset set.

- rigged and animated;
- glTF/GLB;
- Public Domain / CC0;
- permitted for personal and commercial projects.

The runtime scales it to human height, resolves humanoid bones and maps Nova's semantic state onto the skeleton. If the external model fails to load, the procedural body remains as a resilience fallback so scene logic still works.

## Run locally

```bash
npm install
npx serve . -l 4173
```

Open `http://localhost:4173`.

## Verification

CI checks:

- JavaScript syntax;
- deterministic mobile scene/action flows;
- touch/XR controls;
- reconnect behavior;
- Groq connection state;
- compound multi-tool execution;
- real Supabase backend behavior;
- immutable public CDN behavior;
- real Quaternius GLB loading and skeleton movement;
- cinematic director execution;
- Presentation Mode;
- VR180 presets/stereo baselines;
- actor-polish runtime and natural facing behavior.

Run the full verification set with:

```bash
npm run verify
```

## Security

- Groq credentials are not embedded in frontend JavaScript.
- AI actions are allowlisted and arguments are sanitized.
- Built-in protected objects cannot be deleted through dynamic-object tools.
- Movement and object sizes are clamped to scene bounds.
