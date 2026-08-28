(() => {
  const DEFAULT_EYE_SEPARATION = 0.064;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
  const state = {
    scene: null,
    THREE: null,
    renderer: null,
    stereoCamera: null,
    sourceCamera: null,
    overlay: null,
    frame: 0,
    active: false,
    eyeSeparation: DEFAULT_EYE_SEPARATION,
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForScene(timeoutMs = 9000) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      if (window.__novaScene?.scene && window.__novaScene?.camera) {
        state.scene = window.__novaScene;
        return state.scene;
      }
      await wait(60);
    }
    throw new Error('3D scene is not ready');
  }

  function installStyles() {
    if (document.getElementById('nova-binocular-styles')) return;
    const style = document.createElement('style');
    style.id = 'nova-binocular-styles';
    style.textContent = `
      .nova-binocular-overlay{position:fixed;inset:0;z-index:90;background:#000;display:grid;grid-template-rows:1fr auto}.nova-binocular-stage{position:relative;min-height:0;overflow:hidden}.nova-binocular-stage canvas{width:100%;height:100%;display:block}.nova-binocular-labels{position:absolute;left:0;right:0;top:0;display:grid;grid-template-columns:1fr 1fr;pointer-events:none;color:#fff;text-shadow:0 2px 7px #000;font:700 11px/1 system-ui,sans-serif;letter-spacing:.08em}.nova-binocular-labels span{padding:12px 16px}.nova-binocular-labels span:last-child{text-align:right}.nova-binocular-divider{position:absolute;top:0;bottom:0;left:50%;width:1px;background:rgba(255,255,255,.2);pointer-events:none}.nova-binocular-bar{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;padding:10px 12px;background:#0a0d12;color:#aab6c5;font:12px system-ui,sans-serif}.nova-binocular-bar button{border:1px solid #394657;border-radius:9px;background:#182231;color:#fff;padding:7px 11px;cursor:pointer}.nova-binocular-bar button.primary{background:#245fa8}.nova-binocular-bar input{width:76px}.nova-binocular-launch[data-active="1"]{background:#245fa8}
    `;
    document.head.appendChild(style);
  }

  function renderFrame() {
    if (!state.active || !state.overlay || !state.renderer || !state.scene) return;
    const canvas = state.overlay.querySelector('canvas');
    const cssWidth = Math.max(2, canvas.clientWidth);
    const cssHeight = Math.max(2, canvas.clientHeight);
    const dpr = state.renderer.getPixelRatio();
    const targetW = Math.floor(cssWidth * dpr);
    const targetH = Math.floor(cssHeight * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) state.renderer.setSize(cssWidth, cssHeight, false);

    const liveCamera = state.scene.camera;
    liveCamera.updateMatrixWorld(true);
    const camera = state.sourceCamera;
    camera.position.copy(liveCamera.position);
    camera.quaternion.copy(liveCamera.quaternion);
    camera.scale.copy(liveCamera.scale);
    camera.near = liveCamera.near;
    camera.far = liveCamera.far;
    camera.fov = Math.max(70, Number(liveCamera.fov || 70));
    camera.aspect = (cssWidth * 0.5) / cssHeight;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    state.stereoCamera.eyeSep = state.eyeSeparation;
    state.stereoCamera.update(camera);

    const half = Math.floor(cssWidth * 0.5);
    state.renderer.setScissorTest(true);
    state.renderer.setViewport(0, 0, half, cssHeight);
    state.renderer.setScissor(0, 0, half, cssHeight);
    state.renderer.render(state.scene.scene, state.stereoCamera.cameraL);
    state.renderer.setViewport(half, 0, cssWidth - half, cssHeight);
    state.renderer.setScissor(half, 0, cssWidth - half, cssHeight);
    state.renderer.render(state.scene.scene, state.stereoCamera.cameraR);
    state.renderer.setScissorTest(false);
    state.frame = requestAnimationFrame(renderFrame);
  }

  async function enterHeadsetVr() {
    const runtimeScene = state.scene || await waitForScene();
    if (!navigator.xr) throw new Error('WebXR is not available in this browser');
    const supported = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
    if (!supported) throw new Error('Immersive VR headset was not detected');
    stopPreview();
    const xrButton = document.getElementById('xr-button');
    if (window.__NovaXRControls?.toggleXR) {
      return window.__NovaXRControls.toggleXR(runtimeScene, xrButton);
    }
    if (typeof runtimeScene.enterXR === 'function') {
      const mode = await runtimeScene.enterXR();
      return { active: true, mode };
    }
    throw new Error('XR controls are not ready');
  }

  function updateLaunchButton() {
    const button = document.getElementById('nova-binocular-launch');
    if (!button) return;
    button.dataset.active = state.active ? '1' : '0';
    button.textContent = state.active ? 'Exit binocular' : 'Binocular VR';
  }

  function stopPreview() {
    state.active = false;
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.renderer?.dispose?.();
    state.renderer = null;
    state.stereoCamera = null;
    state.sourceCamera = null;
    state.overlay?.remove?.();
    state.overlay = null;
    updateLaunchButton();
  }

  async function startPreview() {
    if (state.active) return;
    const runtimeScene = await waitForScene();
    const THREE = state.THREE || await import('three');
    state.THREE = THREE;
    installStyles();

    const overlay = document.createElement('div');
    overlay.className = 'nova-binocular-overlay';
    overlay.innerHTML = `
      <div class="nova-binocular-stage">
        <canvas aria-label="Binocular stereo VR preview"></canvas>
        <div class="nova-binocular-labels"><span>LEFT EYE</span><span>RIGHT EYE</span></div>
        <div class="nova-binocular-divider"></div>
      </div>
      <div class="nova-binocular-bar">
        <strong>BINOCULAR VR</strong>
        <span>stereo separation</span>
        <input id="nova-eye-separation" type="range" min="0.05" max="0.075" step="0.001" value="${state.eyeSeparation}">
        <span id="nova-eye-separation-value">${Math.round(state.eyeSeparation * 1000)} mm</span>
        <button id="nova-enter-headset" class="primary" type="button">Enter headset VR</button>
        <button id="nova-close-binocular" type="button">Back to normal view</button>
      </div>`;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = runtimeScene.renderer?.toneMappingExposure ?? 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    state.scene = runtimeScene;
    state.renderer = renderer;
    state.stereoCamera = new THREE.StereoCamera();
    state.stereoCamera.eyeSep = state.eyeSeparation;
    state.sourceCamera = runtimeScene.camera.clone();
    state.overlay = overlay;
    state.active = true;

    const slider = overlay.querySelector('#nova-eye-separation');
    const value = overlay.querySelector('#nova-eye-separation-value');
    slider.addEventListener('input', () => {
      state.eyeSeparation = Number(slider.value);
      value.textContent = `${Math.round(state.eyeSeparation * 1000)} mm`;
    });
    overlay.querySelector('#nova-close-binocular').addEventListener('click', stopPreview);
    overlay.querySelector('#nova-enter-headset').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Entering VR…';
      try { await enterHeadsetVr(); }
      catch (error) {
        button.disabled = false;
        button.textContent = error?.message || 'VR unavailable';
        setTimeout(() => { if (button.isConnected) button.textContent = 'Enter headset VR'; }, 2600);
      }
    });

    updateLaunchButton();
    state.frame = requestAnimationFrame(renderFrame);
  }

  async function toggle() {
    if (state.active) stopPreview();
    else await startPreview();
  }

  function installButton() {
    if (document.getElementById('nova-binocular-launch')) return;
    const row = document.querySelector('.button-row');
    if (!row) return;
    installStyles();
    const button = document.createElement('button');
    button.id = 'nova-binocular-launch';
    button.className = 'nova-binocular-launch';
    button.type = 'button';
    button.textContent = 'Binocular VR';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await toggle(); }
      finally { button.disabled = false; }
    });
    row.appendChild(button);
  }

  window.__NovaBinocularVR = {
    start: startPreview,
    stop: stopPreview,
    toggle,
    enterHeadsetVr,
    setEyeSeparation(value) { state.eyeSeparation = clamp(Number(value) || DEFAULT_EYE_SEPARATION, 0.05, 0.075); },
    getState: () => ({ active: state.active, eyeSeparation: state.eyeSeparation }),
  };

  window.addEventListener('DOMContentLoaded', installButton);
})();
