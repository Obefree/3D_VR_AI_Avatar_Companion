# Nova — VR headset demo and VR180 video

The project now has two separate headset paths.

## 1. Interactive WebXR

Open the current site in a WebXR-capable headset browser and use **Enter XR**.

This mode is realtime and interactive:

- the same humanoid Nova is rendered separately for both headset eyes by WebXR;
- scene scale is in meters (`local-floor` reference space);
- Nova can still look, gesture, move and execute AI/scene actions;
- this is the best mode for proving that the actor is actually AI-driven rather than a prerecorded video.

## 2. Prerendered VR180 3D video

The cinematic director panel contains **Record VR180 for headset**.

The browser renderer produces:

- cropped equirectangular **180° × 180° per eye**;
- stereoscopic **Left–Right side-by-side (SBS)** layout;
- fixed stereo camera position, like a VR180 camera;
- a JSON sidecar describing projection, eye order, baseline, resolution and frame rate.

### Presets

- **VR180 Draft** — 4096×2048, 30 fps. Each eye gets 2048×2048.
- **Quest HQ** — 5760×2880, 48 fps. Each eye gets 2880×2880.

The high-quality browser preset is intentionally below the highest Quest decode target so the live browser render remains practical. Meta's current media guidance describes 7680×3840 / 60 fps as a realistic high-end 180 3D LR-SBS target and recommends 48–60 fps with HEVC/H.265 or AV1 for 180 media.

Reference: https://developers.meta.com/horizon/documentation/android-apps/media-requirements/

### Stereo baseline

Two profiles are available:

- **Canon-style — 60 mm** (default), matching the optical-center spacing of Canon's RF5.2mm F2.8 L Dual Fisheye reference system.
- **Headset stereo — 64 mm**, a slightly wider generic human/headset stereo baseline.

For the job-test video that is intended to resemble the Canon R5 C / Dual Fisheye result, use **Canon-style 60 mm**.

## Recording dialogue into the video

Canvas recording contains video by default. Browser `SpeechSynthesis` audio is system/tab audio and is not automatically part of the canvas stream.

Enable **include tab voice** before starting the recording if the rendered video needs Nova's spoken dialogue.

The browser will ask for screen/tab capture permission:

1. choose the current Nova browser tab;
2. enable **Share tab audio**;
3. start the actor scene;
4. stop VR180 recording when the performance is complete.

The screen-share video track is discarded; only its audio track is combined with the VR180 render.

If the browser/headset does not expose tab-audio capture, record video without audio and add the dialogue track during postproduction.

## Playback in a headset

The exported file is **VR180 / 3D / Side-by-Side / Left–Right**.

If the player does not detect the projection automatically, select those four properties manually:

```text
Projection: 180°
3D: enabled
Layout: Side-by-Side
Eye order: Left / Right
```

The browser downloads a `.json` sidecar next to the video with the exact export parameters.

## Optional HEVC delivery transcode

Browser codec support differs by OS, so recording may produce MP4/H.264 or WebM/VP9. For a polished Quest delivery, a browser master can be transcoded to HEVC without changing its stereo layout:

```bash
ffmpeg -i nova_VR180_3D_SBS.webm \
  -c:v libx265 -preset slow -crf 18 -tag:v hvc1 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  nova_VR180_3D_SBS_HEVC.mp4
```

Do not convert the SBS frame into a normal 16:9 movie. The full frame must keep both square eye views next to each other.

## Recommended management demo

Use both outputs:

1. **WebXR live demo** — proves the script/AI controls an embodied actor in realtime.
2. **VR180 3D recorded scene** — proves the same concept can be presented as cinematic stereoscopic content for a headset.

That makes the technical chain visible:

```text
TEXT SCRIPT → AI DIRECTOR → HUMANOID ACTOR → CINEMATIC SCENE → WEBXR / VR180 3D
```
