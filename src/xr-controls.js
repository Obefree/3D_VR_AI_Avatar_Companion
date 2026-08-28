(() => {
  const MAX_ORBIT_DISTANCE = 14;
  const MIN_CAMERA_FAR = 50;

  function showToast(text, ms = 2600) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function setButtonState(button, active) {
    if (!button) return;
    button.textContent = active ? 'Exit XR' : 'Enter XR';
    button.dataset.xrActive = active ? '1' : '0';
  }

  function configureScene(scene) {
    if (!scene) return false;
    if (scene.controls) {
      scene.controls.maxDistance = Math.max(Number(scene.controls.maxDistance || 0), MAX_ORBIT_DISTANCE);
      scene.controls.minDistance = Math.min(Number(scene.controls.minDistance || 2.2), 1.8);
    }
    if (scene.camera) {
      scene.camera.far = Math.max(Number(scene.camera.far || 0), MIN_CAMERA_FAR);
      scene.camera.updateProjectionMatrix?.();
    }
    return true;
  }

  function enhanceVrEntry(scene) {
    // SpatialScene.enterXR is the only WebXR session owner. This helper only
    // widens orbit/camera limits so a second immersive session cannot start in parallel.
    return configureScene(scene);
  }

  function bindSessionEnd(scene, button, session) {
    if (!session?.addEventListener || session.__novaExitBound) return;
    session.__novaExitBound = true;
    session.addEventListener('end', () => {
      scene.isXR = false;
      setButtonState(button, false);
    }, { once: true });
  }

  async function toggleXR(scene, button) {
    if (!scene) throw new Error('3D scene is not ready.');
    configureScene(scene);

    const currentSession = scene.renderer?.xr?.getSession?.() || null;
    if (scene.isXR || currentSession) {
      if (currentSession?.end) await currentSession.end();
      scene.isXR = false;
      setButtonState(button, false);
      return { active: false, mode: 'exited' };
    }

    const mode = await scene.enterXR();
    const session = scene.renderer?.xr?.getSession?.() || null;
    bindSessionEnd(scene, button, session);
    setButtonState(button, true);
    return { active: true, mode };
  }

  function install(scene) {
    const button = document.getElementById('xr-button');
    if (!scene || !button || button.dataset.xrToggleBound === '1') return false;
    configureScene(scene);
    enhanceVrEntry(scene);
    button.dataset.xrToggleBound = '1';

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (button.disabled) return;
      button.disabled = true;
      try {
        const result = await toggleXR(scene, button);
        showToast(result.active ? `Entered ${result.mode}` : 'Exited XR');
      } catch (error) {
        showToast(error?.message || 'XR action failed.', 4200);
        setButtonState(button, Boolean(scene.isXR || scene.renderer?.xr?.getSession?.()));
      } finally {
        button.disabled = false;
      }
    }, true);

    const existingSession = scene.renderer?.xr?.getSession?.() || null;
    if (existingSession) bindSessionEnd(scene, button, existingSession);
    setButtonState(button, Boolean(scene.isXR || existingSession));
    return true;
  }

  function waitForScene() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const scene = window.__novaScene;
      if (scene && install(scene)) clearInterval(timer);
      else if (attempts > 240) clearInterval(timer);
    }, 50);
  }

  window.__NovaXRControls = {
    install,
    toggleXR,
    configureScene,
    MAX_ORBIT_DISTANCE,
  };

  waitForScene();
})();