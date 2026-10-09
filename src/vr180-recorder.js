import * as THREE from 'three';

const PRESETS = {
  draft: { label: 'VR180 · 4096×2048 · 30 fps (мин. 2K/eye)', width: 4096, height: 2048, fps: 30, cube: 1024, bitrate: 24_000_000 },
  quest: { label: 'Quest HQ · 5760×2880 · 48 fps', width: 5760, height: 2880, fps: 48, cube: 1536, bitrate: 36_000_000 },
};
/** On-screen SBS view capture — at least 2K total width (1920×1920 per eye). */
const VIEW_REC = { width: 3840, height: 1920, fps: 30, bitrate: 20_000_000 };
/** Live Stage glasses: same 2:1 VR180 frame as the file, lighter cube. */
const STAGE_LIVE = { label: 'VR180 live · 2048×1024', width: 2048, height: 1024, fps: 30, cube: 512, bitrate: 12_000_000 };
export const BASELINES = {
  canon: { label: 'Canon-style · 60 mm', meters: 0.060 },
  natural: { label: 'Headset stereo · 64 mm', meters: 0.064 },
};

const state = { scene: null, recording: null, preview: null, viewRec: null };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForScene(timeoutMs = 12000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (window.__novaScene?.scene && window.__novaScene?.camera) return window.__novaScene;
    await sleep(80);
  }
  throw new Error('Nova scene did not become ready');
}

function chooseMimeType(withAudio = false) {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = withAudio
    ? ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
}

export function projectionMaterial(cubeTexture) {
  return new THREE.ShaderMaterial({
    uniforms: { cubeMap: { value: cubeTexture } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
    fragmentShader: `
      uniform samplerCube cubeMap;
      varying vec2 vUv;
      const float PI=3.141592653589793;
      void main(){
        float lon=(vUv.x-0.5)*PI;
        float lat=(vUv.y-0.5)*PI;
        float c=cos(lat);
        vec3 direction=normalize(vec3(sin(lon)*c,sin(lat),-cos(lon)*c));
        gl_FragColor=textureCube(cubeMap,direction);
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

const _placePos = new THREE.Vector3();
const _placeQuat = new THREE.Quaternion();
const _placeRight = new THREE.Vector3();

/** Parallel stereo like Canon RF 5.2 Dual Fisheye — same orientation, 60 mm optical centers. */
export function placeParallelEyes(camera, leftEye, rightEye, baselineMeters = BASELINES.canon.meters) {
  camera.updateMatrixWorld();
  camera.getWorldPosition(_placePos);
  camera.getWorldQuaternion(_placeQuat);
  _placeRight.set(1, 0, 0).applyQuaternion(_placeQuat).normalize();
  const halfIpd = baselineMeters * 0.5;
  leftEye.position.copy(_placePos).addScaledVector(_placeRight, -halfIpd);
  rightEye.position.copy(_placePos).addScaledVector(_placeRight, halfIpd);
  leftEye.quaternion.copy(_placeQuat);
  rightEye.quaternion.copy(_placeQuat);
}

function buildRuntime(preset, baselineMeters) {
  const canvas = document.createElement('canvas');
  canvas.width = preset.width;
  canvas.height = preset.height;
  canvas.style.cssText = 'width:min(760px,92vw);height:auto;display:block;background:#000';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(preset.width, preset.height, false);
  matchMainLook(renderer);

  const makeTarget = () => new THREE.WebGLCubeRenderTarget(preset.cube, {
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.SRGBColorSpace,
  });
  const leftTarget = makeTarget();
  const rightTarget = makeTarget();
  const leftEye = new THREE.CubeCamera(0.08, 80, leftTarget);
  const rightEye = new THREE.CubeCamera(0.08, 80, rightTarget);

  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const leftMaterial = projectionMaterial(leftTarget.texture);
  const rightMaterial = projectionMaterial(rightTarget.texture);
  const quad = new THREE.Mesh(geometry, leftMaterial);
  quad.frustumCulled = false;
  quadScene.add(quad);

  placeParallelEyes(state.scene.camera, leftEye, rightEye, baselineMeters);

  return {
    canvas, renderer, leftTarget, rightTarget, leftEye, rightEye,
    quadScene, quadCamera, quad, leftMaterial, rightMaterial, geometry,
    baselineMeters, preset,
  };
}

function matchMainLook(renderer) {
  const src = state.scene?.renderer;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = src?.toneMapping ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = src?.toneMappingExposure ?? 1.15;
  renderer.shadowMap.enabled = false;
}

function renderFrame(runtime) {
  if (state.scene?.camera) {
    placeParallelEyes(state.scene.camera, runtime.leftEye, runtime.rightEye, runtime.baselineMeters || BASELINES.canon.meters);
  }
  matchMainLook(runtime.renderer);
  const shadowed = [];
  state.scene.scene.traverse((obj) => {
    if (obj.isLight && obj.castShadow) {
      shadowed.push(obj);
      obj.castShadow = false;
    }
  });
  runtime.renderer.shadowMap.enabled = false;
  try {
    runtime.leftEye.update(runtime.renderer, state.scene.scene);
    runtime.rightEye.update(runtime.renderer, state.scene.scene);
  } finally {
    for (const light of shadowed) light.castShadow = true;
  }
  const width = runtime.canvas.width;
  const height = runtime.canvas.height;
  const half = Math.floor(width / 2);
  const mapped = runtime.renderer.toneMapping;
  runtime.renderer.toneMapping = THREE.NoToneMapping;
  runtime.renderer.setScissorTest(true);
  runtime.renderer.setClearColor(0x000000, 1);

  runtime.quad.material = runtime.leftMaterial;
  runtime.renderer.setViewport(0, 0, half, height);
  runtime.renderer.setScissor(0, 0, half, height);
  runtime.renderer.render(runtime.quadScene, runtime.quadCamera);

  runtime.quad.material = runtime.rightMaterial;
  runtime.renderer.setViewport(half, 0, width - half, height);
  runtime.renderer.setScissor(half, 0, width - half, height);
  runtime.renderer.render(runtime.quadScene, runtime.quadCamera);
  runtime.renderer.setScissorTest(false);
  runtime.renderer.toneMapping = mapped;
}

function cleanup(runtime) {
  runtime.leftTarget.dispose(); runtime.rightTarget.dispose();
  runtime.leftMaterial.dispose(); runtime.rightMaterial.dispose();
  runtime.geometry.dispose(); runtime.renderer.dispose();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function extensionFor(mime) { return mime.startsWith('video/mp4') ? 'mp4' : 'webm'; }

function metadata(preset, mime, options = {}) {
  return {
    schema: 'nova-vr180-export-v1',
    projection: 'equirectangular-180',
    horizontalFovDegrees: 180,
    verticalFovDegrees: 180,
    stereo: true,
    stereoLayout: 'left-right',
    eyeOrder: ['left', 'right'],
    eyeSeparationMeters: options.baselineMeters ?? 0.060,
    stereoProfile: options.baselineKey || 'canon',
    width: preset.width,
    height: preset.height,
    frameRate: preset.fps,
    mimeType: mime,
    tabAudioRequested: Boolean(options.tabAudioRequested),
    tabAudioCaptured: Boolean(options.tabAudioCaptured),
    playerHint: 'Select VR180 / 3D / Side-by-Side (Left-Right) when the headset player does not auto-detect projection.',
    productionHint: 'For final Quest delivery use HEVC/H.265 or AV1 at 48-60 fps; Meta currently cites 7680x3840/60 as a realistic high-end LR SBS target.',
  };
}

function currentBaselineMeters() {
  const key = document.getElementById('vr180-baseline')?.value;
  return (BASELINES[key] || BASELINES.canon).meters;
}

function setPreviewButton(on) {
  const button = document.getElementById('vr180-preview-button');
  if (button) button.textContent = on ? 'Скрыть VR демо' : 'VR демо · 2 глаза';
}

function emitViewRecord(on) {
  window.dispatchEvent(new CustomEvent('nova:view-record', { detail: { on: Boolean(on) } }));
}

function applyPreviewLayout() {
  const preview = state.preview;
  if (!preview) return;
  // Keep ≥2K buffer while view-recording; don't shrink under the recorder.
  if (state.viewRec || preview.recordingBoost) {
    if (preview.canvas.width !== VIEW_REC.width || preview.canvas.height !== VIEW_REC.height) {
      preview.canvas.width = VIEW_REC.width;
      preview.canvas.height = VIEW_REC.height;
      preview.renderer.setSize(VIEW_REC.width, VIEW_REC.height, false);
    }
    preview.minFrameMs = Math.floor(1000 / VIEW_REC.fps);
    return;
  }
  const { overlay, canvas, renderer } = preview;
  const full = Boolean(preview.fullscreen);
  document.documentElement.classList.toggle('vr-sbs', full);
  overlay.querySelectorAll('[data-vr-chrome]').forEach((el) => {
    el.style.display = full ? 'none' : '';
  });
  if (full) {
    overlay.style.cssText = 'position:fixed;inset:0;z-index:6;width:100vw;height:100dvh;padding:0;border:0;border-radius:0;background:#000;pointer-events:none';
    canvas.style.cssText = 'width:100vw;height:100dvh;display:block;background:#000';
    const width = Math.max(2, Math.min(window.innerWidth, 1600) - (Math.min(window.innerWidth, 1600) % 2));
    const height = Math.max(2, Math.min(window.innerHeight, 900));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      renderer.setSize(width, height, false);
    }
    preview.minFrameMs = 40;
  } else {
    overlay.style.cssText = 'position:fixed;z-index:8;right:14px;bottom:14px;width:min(280px,32vw);padding:8px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(5,8,12,.78);color:#eef5ff;font:11px/1.3 system-ui,sans-serif;pointer-events:none';
    canvas.style.cssText = 'width:100%;height:auto;display:block;background:#000;border-radius:8px';
    if (canvas.width !== 480 || canvas.height !== 240) {
      canvas.width = 480;
      canvas.height = 240;
      renderer.setSize(480, 240, false);
    }
    preview.minFrameMs = 160;
  }
}

function setFullscreen(on) {
  if (on) {
    if (!state.preview?.running) startLivePreview({ fullscreen: true });
    else {
      state.preview.fullscreen = true;
      applyPreviewLayout();
    }
    return Boolean(state.preview?.running);
  }
  if (state.preview) {
    state.preview.fullscreen = false;
    applyPreviewLayout();
  }
  document.documentElement.classList.remove('vr-sbs');
  return true;
}

function stopLivePreview() {
  const preview = state.preview;
  if (!preview) return false;
  preview.running = false;
  cancelAnimationFrame(preview.raf);
  for (const track of preview.stream?.getTracks?.() || []) {
    if (!state.viewRec) track.stop();
  }
  preview.overlay.remove();
  preview.renderer.dispose();
  state.preview = null;
  document.documentElement.classList.remove('vr-sbs');
  setPreviewButton(false);
  setStatus('VR demo off. First-person view stays. Headset still uses Left–Right SBS.');
  return true;
}

function hideRecordCanvas(canvas) {
  if (!canvas) return;
  canvas.style.cssText = 'position:fixed;left:-9999px;top:0;width:16px;height:8px;opacity:0;pointer-events:none;z-index:-1';
}

function styleVr180Canvas(canvas) {
  canvas.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:6',
    'width:100%',
    'height:100%',
    'object-fit:contain',
    'background:#000',
    'pointer-events:none',
    'display:block',
  ].join(';');
}

function showRecordingView(on) {
  const canvas = state.recording?.runtime?.canvas;
  if (!canvas) return false;
  if (on) styleVr180Canvas(canvas);
  else hideRecordCanvas(canvas);
  return Boolean(on);
}

function stopStageView() {
  const view = state.stageView;
  if (!view) return false;
  view.running = false;
  cancelAnimationFrame(view.raf);
  view.runtime?.canvas?.remove?.();
  if (view.runtime) cleanup(view.runtime);
  state.stageView = null;
  return true;
}

function renderStageView() {
  const view = state.stageView;
  if (!view?.running || !state.scene?.scene) return;
  renderFrame(view.runtime);
  view.raf = requestAnimationFrame(renderStageView);
}

/** Live 2-eye = same VR180 2:1 SBS frame as the headset file (Canon 60 mm). */
export function setStageView(on) {
  const want = Boolean(on);
  if (state.recording) return showRecordingView(want);
  if (!want) return stopStageView();
  if (state.stageView?.running) return true;
  if (!state.scene?.scene) state.scene = window.__novaScene || state.scene;
  if (!state.scene?.scene || !state.scene?.camera) throw new Error('3D scene is not ready');
  stopLivePreview();
  const runtime = buildRuntime(STAGE_LIVE, BASELINES.canon.meters);
  runtime.canvas.id = 'nova-vr180-stage';
  styleVr180Canvas(runtime.canvas);
  document.body.appendChild(runtime.canvas);
  state.stageView = { running: true, runtime, raf: 0 };
  renderStageView();
  return true;
}

function renderLivePreview() {
  const preview = state.preview;
  if (!preview?.running || !state.scene?.camera) return;
  const now = performance.now();
  if (now - (preview.lastFrame || 0) < (preview.minFrameMs || 160)) {
    preview.raf = requestAnimationFrame(renderLivePreview);
    return;
  }
  preview.lastFrame = now;
  const cam = state.scene.camera;
  cam.updateMatrixWorld();
  const width = preview.canvas.width;
  const height = preview.canvas.height;
  preview.stereo.aspect = (width / 2) / Math.max(1, height);
  preview.stereo.eyeSep = preview.eyeSep;
  preview.stereo.update(cam);
  const renderer = preview.renderer;
  const half = Math.floor(width / 2);
  renderer.setClearColor(0x070b12, 1);
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, half, height);
  renderer.setScissor(0, 0, half, height);
  renderer.render(state.scene.scene, preview.stereo.cameraL);
  renderer.setViewport(half, 0, width - half, height);
  renderer.setScissor(half, 0, width - half, height);
  renderer.render(state.scene.scene, preview.stereo.cameraR);
  renderer.setScissorTest(false);
  preview.raf = requestAnimationFrame(renderLivePreview);
}

function startLivePreview(options = {}) {
  if (state.preview?.running) {
    if (options.fullscreen) setFullscreen(true);
    else applyPreviewLayout();
    return true;
  }
  if (!state.scene?.scene || !state.scene?.camera) throw new Error('3D scene is not ready');
  const eyeSep = currentBaselineMeters();
  const width = 480;
  const height = 240;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText = 'width:100%;height:auto;display:block;background:#000;border-radius:8px';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  matchMainLook(renderer);
  renderer.shadowMap.enabled = false;
  const stereo = new THREE.StereoCamera();
  stereo.eyeSep = eyeSep;
  const overlay = document.createElement('div');
  overlay.id = 'vr180-live-preview';
  overlay.style.cssText = 'position:fixed;z-index:8;right:14px;bottom:14px;width:min(280px,32vw);padding:8px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(5,8,12,.78);color:#eef5ff;font:11px/1.3 system-ui,sans-serif;pointer-events:none';
  overlay.innerHTML = `<div data-vr-chrome style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;font-weight:700"><span>VR · 2 глаза</span><span style="opacity:.6;font-weight:500">${Math.round(eyeSep * 1000)} mm</span></div>`;
  const frame = document.createElement('div');
  frame.style.cssText = 'position:relative';
  frame.appendChild(canvas);
  const leftTag = document.createElement('div');
  leftTag.dataset.vrChrome = '1';
  leftTag.textContent = 'L · левый';
  const rightTag = document.createElement('div');
  rightTag.dataset.vrChrome = '1';
  rightTag.textContent = 'R · правый';
  const tagStyle = 'position:absolute;top:8px;padding:3px 8px;border-radius:999px;background:rgba(0,0,0,.55);font:11px system-ui';
  leftTag.style.cssText = `${tagStyle};left:8px`;
  rightTag.style.cssText = `${tagStyle};right:8px`;
  const split = document.createElement('div');
  split.dataset.vrChrome = '1';
  split.style.cssText = 'position:absolute;top:0;bottom:0;left:50%;width:1px;background:rgba(255,255,255,.45)';
  frame.appendChild(leftTag);
  frame.appendChild(rightTag);
  frame.appendChild(split);
  overlay.appendChild(frame);
  const hint = document.createElement('div');
  hint.dataset.vrChrome = '1';
  hint.style.cssText = 'margin-top:6px;color:#a9bad0';
  hint.textContent = 'Маленький SBS. Не закрывает игру. M — микрофон.';
  overlay.appendChild(hint);
  document.body.appendChild(overlay);

  const stream = canvas.captureStream?.(30) || null;
  state.preview = { running: true, renderer, canvas, overlay, stereo, eyeSep, stream, raf: 0, lastFrame: 0, fullscreen: Boolean(options.fullscreen), minFrameMs: 160 };
  setPreviewButton(true);
  setStatus(`VR demo on screen: Left–Right SBS · ${Math.round(eyeSep * 1000)} mm. Headset combines these two frames into one.`);
  applyPreviewLayout();
  renderLivePreview();
  return true;
}

function toggleLivePreview() {
  if (state.preview?.running) return stopLivePreview();
  return startLivePreview();
}

function startViewRecording() {
  if (state.viewRec) return true;
  if (state.recording) throw new Error('Headset VR180 recording is already running');
  if (!state.scene?.renderer && !state.preview?.canvas) throw new Error('3D scene is not ready');

  // View record is always stereo SBS at ≥2K (camera-style Left–Right).
  if (!state.preview?.running) startLivePreview({ fullscreen: true });
  else if (!state.preview.fullscreen) setFullscreen(true);

  const preview = state.preview;
  if (!preview?.canvas?.captureStream) throw new Error('Browser canvas recording is unavailable');

  preview.recordingBoost = {
    width: preview.canvas.width,
    height: preview.canvas.height,
    fullscreen: preview.fullscreen,
    minFrameMs: preview.minFrameMs,
  };
  preview.canvas.width = VIEW_REC.width;
  preview.canvas.height = VIEW_REC.height;
  preview.renderer.setSize(VIEW_REC.width, VIEW_REC.height, false);
  preview.minFrameMs = Math.floor(1000 / VIEW_REC.fps);

  const canvasStream = preview.canvas.captureStream(VIEW_REC.fps);
  preview.stream = canvasStream;
  const voiceTracks = (
    window.__novaTvStage?.getVoiceTracks?.()
    || window.__novaCinematicDirector?.getVoiceTracks?.()
    || []
  ).filter((track) => track.readyState !== 'ended');
  const mimeType = chooseMimeType(voiceTracks.length > 0);
  if (!mimeType) throw new Error('No supported browser video encoder found');
  const outputStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...voiceTracks.map((track) => (track.clone ? track.clone() : track)),
  ]);
  const recorder = new MediaRecorder(outputStream, { mimeType, videoBitsPerSecond: VIEW_REC.bitrate });
  const chunks = [];
  recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
  recorder.onerror = (event) => setStatus(`View recorder error: ${event.error?.message || 'unknown'}`, true);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = `nova_vr_view_SBS_${VIEW_REC.width}x${VIEW_REC.height}_${stamp}`;
    downloadBlob(blob, `${prefix}.${extensionFor(mimeType)}`);
    downloadBlob(new Blob([JSON.stringify({
      kind: 'view-sbs',
      projection: 'rectilinear-stereo',
      stereoLayout: 'left-right',
      width: VIEW_REC.width,
      height: VIEW_REC.height,
      frameRate: VIEW_REC.fps,
      eyeWidth: VIEW_REC.width / 2,
      eyeHeight: VIEW_REC.height,
      baselineMeters: currentBaselineMeters(),
    }, null, 2)], { type: 'application/json' }), `${prefix}.json`);
    setStatus(`Saved SBS ${VIEW_REC.width}×${VIEW_REC.height} (≥2K/eye) · ${(blob.size / 1024 / 1024).toFixed(1)} MB${voiceTracks.length ? ' · with voice' : ' · silent'}`);
  };
  const badge = document.createElement('div');
  badge.id = 'nova-view-rec-badge';
  badge.style.cssText = 'position:fixed;left:16px;top:16px;z-index:81;padding:8px 12px;border-radius:999px;background:rgba(160,30,30,.82);color:#fff;font:12px system-ui;pointer-events:none';
  badge.textContent = `● REC SBS ${VIEW_REC.width}×${VIEW_REC.height}${voiceTracks.length ? ' + голос' : ''}`;
  document.body.appendChild(badge);
  recorder.start(1000);
  state.viewRec = { recorder, canvasStream, outputStream, badge, stereo: true };
  emitViewRecord(true);
  setStatus(`Recording SBS ${VIEW_REC.width}×${VIEW_REC.height} (2K per eye). Neural voice mixes in if she speaks.`);
  return true;
}

function stopViewRecording() {
  const active = state.viewRec;
  if (!active) return false;
  state.viewRec = null;
  try { active.recorder.stop(); } catch {}
  for (const track of active.outputStream?.getAudioTracks?.() || []) {
    try { track.stop(); } catch {}
  }
  active.badge?.remove();
  if (state.preview?.recordingBoost) {
    state.preview.recordingBoost = null;
    applyPreviewLayout();
  }
  emitViewRecord(false);
  return true;
}

function setStatus(text, error = false) {
  const el = document.getElementById('vr180-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = error ? '#ffb0b0' : '#a9bad0';
}

async function requestTabAudio(enabled) {
  if (!enabled) return { stream: null, audioTracks: [] };
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Tab audio capture is not supported by this browser');
  setStatus('Choose this browser tab and enable “Share tab audio”…');
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
  });
  return { stream, audioTracks: stream.getAudioTracks() };
}

async function startRecording(presetName = 'draft', options = {}) {
  if (state.recording) return false;
  if (state.preview?.running) stopLivePreview();
  stopStageView();
  if (!state.scene) state.scene = await waitForScene();
  if (!HTMLCanvasElement.prototype.captureStream || typeof MediaRecorder === 'undefined') throw new Error('Browser canvas recording is unavailable');

  const preset = PRESETS[presetName] || PRESETS.draft;
  const baselineKey = BASELINES[options.baselineKey] ? options.baselineKey : 'canon';
  const baselineMeters = BASELINES[baselineKey].meters;
  const tabAudioRequested = Boolean(options.includeTabAudio);
  const tabCapture = await requestTabAudio(tabAudioRequested);
  const voiceTracks = (
    window.__novaTvStage?.getVoiceTracks?.()
    || window.__novaCinematicDirector?.getVoiceTracks?.()
    || []
  ).filter((track) => track.readyState !== 'ended');
  const tabAudioCaptured = tabCapture.audioTracks.length > 0;
  const audioTracks = tabAudioCaptured ? tabCapture.audioTracks : voiceTracks;
  if (tabAudioRequested && !tabAudioCaptured) setStatus('Tab shared, but no audio track was provided. Mixing Neural voice instead.', true);

  const mimeType = chooseMimeType(audioTracks.length > 0);
  if (!mimeType) {
    for (const track of tabCapture.stream?.getTracks?.() || []) track.stop();
    throw new Error('No supported browser video encoder found');
  }

  const runtime = buildRuntime(preset, baselineMeters);
  renderFrame(runtime);
  const canvasStream = runtime.canvas.captureStream(preset.fps);
  const outputStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioTracks.map((track) => (track.clone ? track.clone() : track)),
  ]);
  const recorder = new MediaRecorder(outputStream, { mimeType, videoBitsPerSecond: preset.bitrate });
  const chunks = [];

  const overlay = document.createElement('div');
  overlay.id = 'vr180-recording-overlay';
  overlay.style.cssText = 'position:fixed;z-index:8;right:14px;bottom:14px;padding:8px 12px;border-radius:12px;background:rgba(5,8,12,.72);color:#fff;font:12px system-ui;pointer-events:none';
  overlay.textContent = `● REC · VR180 SBS · ${Math.round(baselineMeters * 1000)} mm`;
  document.body.appendChild(overlay);
  runtime.canvas.id = 'nova-vr180-stage';
  if (state.scene?.stereoGlasses) styleVr180Canvas(runtime.canvas);
  else hideRecordCanvas(runtime.canvas);
  document.body.appendChild(runtime.canvas);

  recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
  recorder.onerror = (event) => setStatus(`VR180 recorder error: ${event.error?.message || 'unknown'}`, true);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = extensionFor(mimeType);
    const prefix = `nova_ai_actor_${stamp}_VR180_3D_SBS`;
    downloadBlob(blob, `${prefix}.${ext}`);
    downloadBlob(new Blob([JSON.stringify(metadata(preset, mimeType, { baselineMeters, baselineKey, tabAudioRequested, tabAudioCaptured }), null, 2)], { type: 'application/json' }), `${prefix}.json`);
    setStatus(`Saved VR180 3D SBS · ${(blob.size / 1024 / 1024).toFixed(1)} MB · ${mimeType}${tabAudioCaptured ? ' · audio included' : ''}`);
  };

  const loop = () => {
    if (!state.recording) return;
    renderFrame(runtime);
    state.recording.raf = requestAnimationFrame(loop);
  };

  recorder.start(1000);
  state.recording = { recorder, runtime, overlay, preset, mimeType, canvasStream, outputStream, tabCaptureStream: tabCapture.stream, baselineMeters, baselineKey, tabAudioCaptured, raf: requestAnimationFrame(loop) };
  setStatus(`Recording ${preset.label} · LR stereo · ${Math.round(baselineMeters * 1000)} mm${tabAudioCaptured ? ' · tab audio' : ''}`);
  const button = document.getElementById('vr180-record-button');
  if (button) button.textContent = 'Stop VR180 recording';
  return true;
}

function stopRecording() {
  const active = state.recording;
  if (!active) return false;
  state.recording = null;
  cancelAnimationFrame(active.raf);
  active.recorder.stop();
  for (const track of active.canvasStream?.getTracks?.() || []) track.stop();
  for (const track of active.outputStream?.getTracks?.() || []) track.stop();
  for (const track of active.tabCaptureStream?.getTracks?.() || []) track.stop();
  active.overlay.remove();
  active.runtime?.canvas?.remove?.();
  cleanup(active.runtime);
  const button = document.getElementById('vr180-record-button');
  if (button) button.textContent = 'Record VR180 for headset';
  if (document.documentElement.classList.contains('vr-glasses')) {
    try { setStageView(true); } catch {}
  }
  return true;
}

function addUi() {
  // TV Stage drives recording via __novaVR180 — do not inject dead cinematic controls.
  if (document.documentElement.classList.contains('tv-stage') || document.getElementById('stage-panel')) {
    return true;
  }
  const extras = document.getElementById('cinematic-extras')
    || document.getElementById('cinematic-director')
    || document.getElementById('stage-panel');
  if (!extras || document.getElementById('vr180-record-button')) return false;
  const row = document.createElement('div');
  row.className = 'row';
  row.id = 'vr180-controls';

  const select = document.createElement('select');
  select.id = 'vr180-preset';
  for (const [key, preset] of Object.entries(PRESETS)) {
    const option = document.createElement('option'); option.value = key; option.textContent = preset.label; select.appendChild(option);
  }
  row.appendChild(select);

  const baseline = document.createElement('select');
  baseline.id = 'vr180-baseline';
  for (const [key, profile] of Object.entries(BASELINES)) {
    const option = document.createElement('option'); option.value = key; option.textContent = profile.label; baseline.appendChild(option);
  }
  row.appendChild(baseline);
  baseline.addEventListener('change', () => {
    if (state.preview) state.preview.eyeSep = currentBaselineMeters();
  });

  const audioLabel = document.createElement('label');
  audioLabel.style.cssText = 'display:flex;align-items:center;gap:5px;padding:7px 4px;color:#cbd5e2;font:11px system-ui';
  audioLabel.innerHTML = '<input id="vr180-tab-audio" type="checkbox"> звук вкладки (если Neural не пишется)';
  row.appendChild(audioLabel);

  const previewBtn = document.createElement('button');
  previewBtn.id = 'vr180-preview-button';
  previewBtn.type = 'button';
  previewBtn.textContent = 'VR демо · 2 глаза';
  row.appendChild(previewBtn);
  previewBtn.addEventListener('click', () => {
    try { toggleLivePreview(); }
    catch (error) { setStatus(`VR demo error: ${error?.message || error}`, true); }
  });

  const button = document.createElement('button');
  button.id = 'vr180-record-button'; button.type = 'button'; button.textContent = 'Record VR180 for headset'; row.appendChild(button);
  const status = document.createElement('div');
  status.id = 'vr180-status'; status.style.cssText = 'margin-top:6px;color:#a9bad0;font:11px system-ui';
  status.textContent = 'Запись: VR180 headset ≥4096×2048; кнопка «запись» в VR-виде = SBS 3840×1920 (≥2K на глаз) + Neural.';
  extras.appendChild(row);
  extras.appendChild(status);

  button.addEventListener('click', async () => {
    try {
      if (state.recording) stopRecording();
      else await startRecording(select.value, {
        baselineKey: baseline.value,
        includeTabAudio: Boolean(document.getElementById('vr180-tab-audio')?.checked),
      });
    } catch (error) { console.error(error); setStatus(`VR180 error: ${error?.message || error}`, true); }
  });
  return true;
}

async function init() {
  try {
    state.scene = await waitForScene();
    for (let i = 0; i < 120; i += 1) { if (addUi()) break; await sleep(80); }
    window.__novaVR180 = {
      startRecording, stopRecording, startLivePreview, stopLivePreview, toggleLivePreview,
      setFullscreen, startViewRecording, stopViewRecording, setStageView,
      presets: PRESETS, baselines: BASELINES,
      get recording() { return Boolean(state.recording); },
      get viewRecording() { return Boolean(state.viewRec); },
      get previewing() { return Boolean(state.preview?.running); },
      get stageView() { return Boolean(state.stageView?.running); },
      getLiveStream() { return state.preview?.stream || null; },
    };
    window.addEventListener('resize', () => {
      if (state.preview?.fullscreen) applyPreviewLayout();
    });
  } catch (error) { console.error('VR180 recorder init failed:', error); }
}

void init();
