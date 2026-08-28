import * as THREE from 'three';

const PRESETS = {
  draft: { label: 'VR180 Draft · 4096×2048 · 30 fps', width: 4096, height: 2048, fps: 30, cube: 1024, bitrate: 24_000_000 },
  quest: { label: 'Quest HQ · 5760×2880 · 48 fps', width: 5760, height: 2880, fps: 48, cube: 1536, bitrate: 36_000_000 },
};
const BASELINES = {
  canon: { label: 'Canon-style · 60 mm', meters: 0.060 },
  natural: { label: 'Headset stereo · 64 mm', meters: 0.064 },
};

const state = { scene: null, recording: null };
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

function projectionMaterial(cubeTexture) {
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

function buildRuntime(preset, baselineMeters) {
  const canvas = document.createElement('canvas');
  canvas.width = preset.width;
  canvas.height = preset.height;
  canvas.style.cssText = 'width:min(760px,92vw);height:auto;display:block;background:#000';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(preset.width, preset.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = state.scene.renderer?.toneMappingExposure ?? 1.15;

  const makeTarget = () => new THREE.WebGLCubeRenderTarget(preset.cube, {
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.SRGBColorSpace,
  });
  const leftTarget = makeTarget();
  const rightTarget = makeTarget();
  const leftEye = new THREE.CubeCamera(0.05, 30, leftTarget);
  const rightEye = new THREE.CubeCamera(0.05, 30, rightTarget);

  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const leftMaterial = projectionMaterial(leftTarget.texture);
  const rightMaterial = projectionMaterial(rightTarget.texture);
  const quad = new THREE.Mesh(geometry, leftMaterial);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const centerPosition = state.scene.camera.getWorldPosition(new THREE.Vector3());
  const centerQuaternion = state.scene.camera.getWorldQuaternion(new THREE.Quaternion());
  const rightVector = new THREE.Vector3(1, 0, 0).applyQuaternion(centerQuaternion).normalize();
  const halfIpd = baselineMeters * 0.5;
  leftEye.position.copy(centerPosition).addScaledVector(rightVector, -halfIpd);
  rightEye.position.copy(centerPosition).addScaledVector(rightVector, halfIpd);
  leftEye.quaternion.copy(centerQuaternion);
  rightEye.quaternion.copy(centerQuaternion);

  return { canvas, renderer, leftTarget, rightTarget, leftEye, rightEye, quadScene, quadCamera, quad, leftMaterial, rightMaterial, geometry };
}

function renderFrame(runtime) {
  runtime.leftEye.update(runtime.renderer, state.scene.scene);
  runtime.rightEye.update(runtime.renderer, state.scene.scene);
  const width = runtime.canvas.width;
  const height = runtime.canvas.height;
  const half = Math.floor(width / 2);
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
  if (!state.scene) state.scene = await waitForScene();
  if (!HTMLCanvasElement.prototype.captureStream || typeof MediaRecorder === 'undefined') throw new Error('Browser canvas recording is unavailable');

  const preset = PRESETS[presetName] || PRESETS.draft;
  const baselineKey = BASELINES[options.baselineKey] ? options.baselineKey : 'canon';
  const baselineMeters = BASELINES[baselineKey].meters;
  const tabAudioRequested = Boolean(options.includeTabAudio);
  const tabCapture = await requestTabAudio(tabAudioRequested);
  const tabAudioCaptured = tabCapture.audioTracks.length > 0;
  if (tabAudioRequested && !tabAudioCaptured) setStatus('Tab shared, but no audio track was provided. Video will be silent.', true);

  const mimeType = chooseMimeType(tabAudioCaptured);
  if (!mimeType) {
    for (const track of tabCapture.stream?.getTracks?.() || []) track.stop();
    throw new Error('No supported browser video encoder found');
  }

  const runtime = buildRuntime(preset, baselineMeters);
  renderFrame(runtime);
  const canvasStream = runtime.canvas.captureStream(preset.fps);
  const outputStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...tabCapture.audioTracks,
  ]);
  const recorder = new MediaRecorder(outputStream, { mimeType, videoBitsPerSecond: preset.bitrate });
  const chunks = [];

  const overlay = document.createElement('div');
  overlay.id = 'vr180-recording-overlay';
  overlay.style.cssText = 'position:fixed;z-index:45;right:14px;bottom:14px;padding:10px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:rgba(5,8,12,.9);box-shadow:0 14px 40px rgba(0,0,0,.4)';
  overlay.appendChild(runtime.canvas);
  const label = document.createElement('div');
  label.style.cssText = 'padding-top:7px;color:#fff;font:12px system-ui';
  label.textContent = `● REC · ${preset.label} · VR180 3D SBS · ${Math.round(baselineMeters * 1000)} mm${tabAudioCaptured ? ' · audio' : ''}`;
  overlay.appendChild(label);
  document.body.appendChild(overlay);

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
  cleanup(active.runtime);
  const button = document.getElementById('vr180-record-button');
  if (button) button.textContent = 'Record VR180 for headset';
  return true;
}

function addUi() {
  const panel = document.getElementById('cinematic-director');
  if (!panel || document.getElementById('vr180-record-button')) return false;
  const row = panel.querySelector('.row') || panel;
  const body = panel.querySelector('.cinematic-body') || panel;

  const select = document.createElement('select');
  select.id = 'vr180-preset';
  select.className = 'cinematic-hit';
  for (const [key, preset] of Object.entries(PRESETS)) {
    const option = document.createElement('option'); option.value = key; option.textContent = preset.label; select.appendChild(option);
  }
  row.appendChild(select);

  const baseline = document.createElement('select');
  baseline.id = 'vr180-baseline';
  baseline.className = 'cinematic-hit';
  for (const [key, profile] of Object.entries(BASELINES)) {
    const option = document.createElement('option'); option.value = key; option.textContent = profile.label; baseline.appendChild(option);
  }
  row.appendChild(baseline);

  const audioLabel = document.createElement('label');
  audioLabel.className = 'cinematic-hit';
  audioLabel.style.cssText = 'display:flex;align-items:center;gap:5px;padding:7px 4px;color:#cbd5e2;font:11px system-ui';
  audioLabel.innerHTML = '<input id="vr180-tab-audio" type="checkbox"> include tab voice';
  row.appendChild(audioLabel);

  const button = document.createElement('button');
  button.id = 'vr180-record-button'; button.type = 'button'; button.className = 'cinematic-hit'; button.textContent = 'Record VR180 for headset'; row.appendChild(button);
  const status = document.createElement('div');
  status.id = 'vr180-status'; status.style.cssText = 'margin-top:6px;color:#a9bad0;font:11px system-ui';
  status.textContent = 'VR180: 180°×180° per eye · Left–Right SBS · Canon-style 60 mm default';
  body.appendChild(status);

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
    window.__novaVR180 = { startRecording, stopRecording, presets: PRESETS, baselines: BASELINES, get recording() { return Boolean(state.recording); } };
  } catch (error) { console.error('VR180 recorder init failed:', error); }
}

void init();
