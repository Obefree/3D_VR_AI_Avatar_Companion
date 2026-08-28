(() => {
  const state = {
    ready: false,
    desiredYaw: null,
    desiredUntil: 0,
    morphMeshes: [],
    nextBlinkAt: performance.now() + 2400,
    blinkStartedAt: 0,
    lastAction: null,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || '').toLowerCase();

  function scene() { return window.__novaScene || null; }

  function viewerPosition() {
    const runtime = scene();
    if (!runtime) return null;
    return runtime.getViewerWorldPosition?.() || runtime.camera?.getWorldPosition?.(new runtime.THREE.Vector3()) || null;
  }

  function targetPosition(targetId) {
    const runtime = scene();
    const target = targetId && runtime?.targets?.get?.(targetId);
    if (!target) return null;
    const THREE = window.__novaThree || runtime.THREE;
    if (target.position?.clone) return target.position.clone();
    if (target.mesh?.getWorldPosition && THREE?.Vector3) return target.mesh.getWorldPosition(new THREE.Vector3());
    return null;
  }

  async function threeModule() {
    try { return await import('three'); } catch { return null; }
  }

  function shortestAngleDelta(from, to) {
    let delta = (to - from + Math.PI) % (Math.PI * 2);
    if (delta < 0) delta += Math.PI * 2;
    return delta - Math.PI;
  }

  function aimAt(point, holdMs = 2600) {
    const runtime = scene();
    if (!runtime?.avatar || !point) return false;
    const origin = runtime.avatar.position;
    const dx = point.x - origin.x;
    const dz = point.z - origin.z;
    if (Math.hypot(dx, dz) < 0.08) return false;
    // Nova's local forward is -Z.
    state.desiredYaw = Math.atan2(-dx, -dz);
    state.desiredUntil = performance.now() + holdMs;
    return true;
  }

  function actionTarget(detail) {
    const name = String(detail?.name || '');
    const args = detail?.args || {};
    if (name === 'approach_user' || name === 'face_user' || name === 'speak') return viewerPosition();
    if (['walk_to', 'pick_up', 'look_at', 'point_at'].includes(name)) return targetPosition(args.targetId);
    return null;
  }

  function collectMorphMeshes() {
    const runtime = scene();
    const root = runtime?.avatar?.getObjectByName?.('Nova_Humanoid_CC0');
    if (!root) return false;
    const meshes = [];
    root.traverse((node) => {
      if (node?.morphTargetDictionary && node?.morphTargetInfluences) meshes.push(node);
    });
    state.morphMeshes = meshes;
    return true;
  }

  function setNamedMorph(pattern, value) {
    for (const mesh of state.morphMeshes) {
      const dict = mesh.morphTargetDictionary || {};
      for (const [name, index] of Object.entries(dict)) {
        if (pattern.test(clean(name))) mesh.morphTargetInfluences[index] = value;
      }
    }
  }

  function updateFace(now) {
    if (!state.morphMeshes.length) return;
    if (now >= state.nextBlinkAt && !state.blinkStartedAt) state.blinkStartedAt = now;
    if (state.blinkStartedAt) {
      const elapsed = now - state.blinkStartedAt;
      const blink = elapsed < 90 ? elapsed / 90 : elapsed < 180 ? 1 - ((elapsed - 90) / 90) : 0;
      setNamedMorph(/blink|eye.*close|close.*eye/, Math.max(0, Math.min(1, blink)));
      if (elapsed >= 180) {
        state.blinkStartedAt = 0;
        state.nextBlinkAt = now + 2600 + Math.random() * 4200;
      }
    }
    const speaking = scene()?.avatarState === 'speaking';
    setNamedMorph(/smile|happy/, speaking ? 0.14 : 0);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const runtime = scene();
    if (!runtime?.avatar) return;
    if (state.desiredYaw !== null && now <= state.desiredUntil) {
      const current = runtime.avatar.rotation.y;
      const delta = shortestAngleDelta(current, state.desiredYaw);
      runtime.avatar.rotation.y = current + delta * 0.12;
    }
    updateFace(now);
  }

  function onCinematicAction(event) {
    const detail = event?.detail || {};
    state.lastAction = { name: detail.name || null, args: detail.args || {}, at: Date.now() };
    const point = actionTarget(detail);
    if (point) aimAt(point, detail.name === 'speak' ? 9000 : 3000);
  }

  async function init() {
    for (let i = 0; i < 180; i += 1) {
      if (window.__novaScene?.avatar && window.__novaHumanoidReady) break;
      await sleep(60);
    }
    const THREE = await threeModule();
    if (THREE) {
      window.__novaThree = THREE;
      if (window.__novaScene && !window.__novaScene.THREE) window.__novaScene.THREE = THREE;
    }
    collectMorphMeshes();
    window.addEventListener('nova:cinematic-action', onCinematicAction);
    state.ready = Boolean(window.__novaScene?.avatar);
    window.__novaActorPolish = {
      aimAt,
      refreshMorphs: collectMorphMeshes,
      getState: () => ({
        ready: state.ready,
        desiredYaw: state.desiredYaw,
        morphMeshCount: state.morphMeshes.length,
        lastAction: state.lastAction,
      }),
    };
  }

  window.addEventListener('DOMContentLoaded', () => {
    void init();
    requestAnimationFrame(frame);
  });
})();
