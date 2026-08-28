import * as THREE from 'three';

const PRESETS = {
  draft: { label: 'VR180 Draft · 4096×2048 · 30 fps', width: 4096, height: 2048, fps: 30, cube: 1024, bitrate: 24_000_000 },
  quest: { label: 'Quest HQ · 5760×2880 · 48 fps', width: 5760, height: 2880, fps: 48, cube: 1536, bitrate: 36_000_000 },
};

const state = {
  scene: null,
  recording: null,
  lastBlobUrl: null,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForScene(timeoutMs = 12000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (window.__novaScene?.scene && window.__novaScene?.camera) return window.__novaScene;
    await sleep(80);
  }
  throw new Error('Nova scene did not become ready');
}

function chooseMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
}

function createProjectionMaterial(cubeTexture) {
  return new THREE.ShaderMaterial({
    uniforms: { cubeMap: { value: cubeTexture } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform samplerCube cubeMap;
      varying vec2 vUv;
      const float PI = 3.141592653589793;
      void main() {
        // Cropped equirectangular 180x180 hemisphere.
        float lon = (vUv.x - 0.5) * PI;
        float lat = (vUv.y - 0.5) * PI;
        float c = cos(lat);
        vec3 direction = normalize(vec3(
          sin(lon) * c,
          sin(lat),
          -cos(lon) * c
        ));
        gl_FragColor = textureCube(cubeMap, direction);
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function buildRecorderRuntime(preset) {
  const canvas = document.createElement('canvas');
  canvas.width = preset.width;
  canvas.height = preset.height;
  canvas.style.cssText = 'width:min(760px,92vw);height:auto;display:block;background:#000';

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(preset.width, preset.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = state.scene.renderer?.toneMappingExposure ?? 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const leftTarget = new THREE.WebGLCubeRenderTarget(preset.cube, {
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.SRGBColorSpace,
  });
  const rightTarget = leftTarget.clone();
  const leftEye = new THREE.CubeCamera(0.05, 30, leftTarget);
  const rightEye = new THREE.CubeCamera(0.05, 30, rightTarget);

  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const leftMaterial = createProjectionMaterial(leftTarget.texture);
  const rightMaterial = createProjectionMaterial(rightTarget.texture);
  const quad = new THREE.Mesh(geometry, leftMaterial);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const centerPosition = state.scene.camera.getWorldPosition(new THREE.Vector3());
  const centerQuaternion = state.scene.camera.getWorldQuaternion(new THREE.Quaternion());
  const rightVector = new THREE.Vector3(1, 0, 0).applyQuaternion(centerQuaternion).normalize();
  const halfIpd = 0.032;
  const leftPosition = centerPosition.clone().addScaledVector(rightVector, -halfIpd);
  const rightPosition = centerPosition.clone().addScaledVector(rightVector, halfIpd);

  leftEye.position.copy(leftPosition);
  rightEye.position.copy(rightPosition);
  leftEye.quaternion.copy(centerQuaternion);
  rightEye.quaternion.copy(centerQuaternion);

  return {
    canvas, renderer,
    leftTarget, rightTarget, leftEye, rightEye,
    quadScene, quadCamera, quad, leftMaterial, rightMaterial, geometry,
    centerPosition, centerQuaternion,
  };
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

function cleanupRuntime(runtime) {
  runtime.leftTarget.dispose();
  runtime.rightTarget.dispose();
  runtime.leftMaterial.dispose();
  runtime.rightMaterial.dispose();
  runtime.geometry.dispose();
  runtime.renderer.dispose();
}

function extensionFor(mime) {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
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

function buildMetadata(preset, mime) {
  return {
    schema: 'nova-vr180-export-v1',
    projection: 'equirectangular-180',
    horizontalFovDegrees: 180,
    verticalFovDegrees: 180,
    stereo: true,
    stereoLayout: 'left-right',
    eyeOrder: ['left', 'right'],
    eyeSeparationMeters: 0.064,
    width: preset.width,
    height: preset.height,
    frameRate: preset.fps,
    mimeType: mime,
    note: 'Browser master. For maximum headset compatibility, transcode to HEVC/H.265 MP4 and tag/select as VR180 3D SBS in the target player.',
  };
}

function updateUi(text, isError = false) {
  const status = document.getElementById('vr180-status');
  if (!status) return;
  status.textContent = text;
  status.style.color = isError ? '#ffb0b0' : '#a9bad0';
}

async function startRecording(presetName = 'draft') {
  if (state.recording) return false;
  if (!state.scene) state.scene = await waitForScene();
  if (!HTMLCanvasElement.prototype.captureStream || typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot record a canvas stream');
  }

  const preset = PRESETS[presetName] || PRESETS.draft;
  const mimeType = chooseMimeType();
  if (!mimeType) throw new Error('No supported browser video encoder found');

  updateUi(`Preparing ${preset.label}…`);
  const runtime = buildRecorderRuntime(preset);
  renderFrame(runtime);
  const stream = runtime.canvas.captureStream(preset.fps);
  const chunks = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: preset.bitrate,
  });

  const overlay = document.createElement('div');
  overlay.id = 'vr180-recording-overlay';
  overlay.style.cssText = 'position:fixed;z-index:45;right:14px;bottom:14px;padding:10px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:rgba(5,8,12,.9);box-shadow:0 14px 40px rgba(0,0,0,.4)';
  overlay.appendChild(runtime.canvas);
  const label = document.createElement('div');
  label.style.cssText = 'padding-top:7px;color:#fff;font:12px system-ui';
  label.textContent = `● REC · ${preset.label} · VR180 3D SBS`;
  overlay.appendChild(label);
  document.body.appendChild(overlay);

  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  recorder.onerror = (event) => {
    console.error('VR180 MediaRecorder:', event.error || event);
    updateUi(`Recorder error: ${event.error?.message || 'unknown'}`, true);
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = extensionFor(mimeType);
    downloadBlob(blob, `nova_ai_actor_${stamp}_VR180_3D_SBS.${ext}`);
    const metadata = new Blob([JSON.stringify(buildMetadata(preset, mimeType), null, 2)], { type: 'application/json' });
    downloadBlob(metadata, `nova_ai_actor_${stamp}_VR180_3D_SBS.json`);
    updateUi(`Saved VR180 3D SBS · ${(blob.size / 1024 / 1024).toFixed(1)} MB · ${mimeType}`);
  };

  const loop = () => {
    if (!state.recording) return;
    renderFrame(runtime);
    state.recording.raf = requestAnimationFrame(loop);
  };

  recorder.start(1000);
  state.recording = { recorder, runtime, overlay, preset, mimeType, raf: requestAnimationFrame(loop) };
  updateUi(`Recording ${preset.label} · stereo LR · 64 mm IPD`);
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
  for (const track of active.recorder.stream?.getTracks?.() || []) track.stop();
  active.overlay.remove();
  cleanupRuntime(active.runtime);
  const button = document.getElementById('vr180-record-button');
  if (button) button.textContent = 'Record VR180 for headset';
  return true;
}

function addUi() {
  const panel = document.getElementById('actor-director-panel');
  if (!panel || document.getElementById('vr180-record-button')) return false;

  const row = panel.querySelector('.actor-buttons') || panel;
  const select = document.createElement('select');
  select.id = 'vr180-preset';
  select.style.cssText = 'border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:8px;background:#171d27;color:#fff';
  for (const [key, preset] of Object.entries(PRESETS)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = preset.label;
    select.appendChild(option);
  }
  row.appendChild(select);

  const button = document.createElement('button');
  button.id = 'vr180-record-button';
  button.type = 'button';
  button.textContent = 'Record VR180 for headset';
  row.appendChild(button);

  const status = document.createElement('div');
  status.id = 'vr180-status';
  status.style.cssText = 'margin-top:6px;color:#a9bad0;font:11px system-ui';
  status.textContent = 'VR180: 180°×180° per eye · Left–Right SBS · 64 mm eye separation';
  panel.appendChild(status);

  button.addEventListener('click', async () => {
    try {
      if (state.recording) stopRecording();
      else await startRecording(select.value);
    } catch (error) {
      console.error(error);
      updateUi(`VR180 error: ${error?.message || error}`, true);
    }
  });
  return true;
}

async function init() {
  try {
    state.scene = await waitForScene();
    for (let i = 0; i < 100; i += 1) {
      if (addUi()) break;
      await sleep(80);
    }
    window.__novaVR180 = {
      startRecording,
      stopRecording,
      presets: PRESETS,
      get recording() { return Boolean(state.recording); },
    };
  } catch (error) {
    console.error('VR180 recorder init failed:', error);
  }
}

void init();
