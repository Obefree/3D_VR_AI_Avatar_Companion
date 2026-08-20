(() => {
  const BUILTIN_TARGETS = new Set(['device', 'red_button', 'filter']);
  const EXTENDED_ACTIONS = new Set([
    'raise_hand',
    'lower_hand',
    'wave',
    'step',
    'turn_body',
    'neutral_pose',
    'create_object',
    'delete_object',
    'move_object',
  ]);
  const DYNAMIC_SPATIAL_ACTIONS = new Set(['look_at', 'point_at', 'highlight', 'move_near']);
  const SPACE = {
    floorY: 0,
    minX: -4.35,
    maxX: 4.35,
    minZ: -4.35,
    maxZ: 4.35,
    maxY: 3.2,
  };

  const state = {
    scene: null,
    THREE: null,
    dynamicIds: new Set(),
    createdOrder: [],
    pose: {
      leftArm: 'down',
      rightArm: 'down',
      motion: 'idle',
      facingDegrees: 0,
    },
    leftTarget: null,
    leftWaveUntil: 0,
    leftWaveStarted: 0,
    rightPoseTargetId: '__nova_right_pose_target',
    ready: false,
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
  const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function safeId(value, fallback = 'object') {
    const base = String(value || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9а-яё_-]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36) || fallback;
    let id = base.startsWith('user_') ? base : `user_${base}`;
    let suffix = 2;
    while (state.scene?.targets?.has(id)) id = `${base}_${suffix++}`;
    return id;
  }

  function parseColor(value) {
    if (!state.THREE) return 0x4aa8ff;
    const names = {
      red: 0xe74b5d,
      blue: 0x4298ff,
      green: 0x43c982,
      yellow: 0xf0c84b,
      orange: 0xf28b45,
      purple: 0xa56cff,
      pink: 0xf06fb5,
      white: 0xdfe8f2,
      gray: 0x7d8a98,
      grey: 0x7d8a98,
      black: 0x1a2028,
      cyan: 0x44d7e8,
      синий: 0x4298ff,
      красный: 0xe74b5d,
      зелёный: 0x43c982,
      зеленый: 0x43c982,
      жёлтый: 0xf0c84b,
      желтый: 0xf0c84b,
      оранжевый: 0xf28b45,
      фиолетовый: 0xa56cff,
      белый: 0xdfe8f2,
      серый: 0x7d8a98,
    };
    if (typeof value === 'number') return value;
    const key = String(value || '').trim().toLowerCase();
    if (names[key]) return names[key];
    if (/^#?[0-9a-f]{6}$/i.test(key)) return Number.parseInt(key.replace('#', ''), 16);
    return 0x4aa8ff;
  }

  function materialFor(color) {
    const THREE = state.THREE;
    return new THREE.MeshStandardMaterial({
      color: parseColor(color),
      roughness: 0.52,
      metalness: 0.22,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });
  }

  function normalizeSize(shape, raw = {}) {
    const scalar = clamp(raw.scalar ?? raw.size ?? 0.5, 0.12, 1.5);
    const x = clamp(raw.x ?? raw.width ?? scalar, 0.12, 1.5);
    const y = clamp(raw.y ?? raw.height ?? scalar, 0.12, 1.8);
    const z = clamp(raw.z ?? raw.depth ?? scalar, 0.12, 1.5);
    if (shape === 'sphere') return { x: scalar, y: scalar, z: scalar };
    if (shape === 'cylinder' || shape === 'cone') {
      const diameter = clamp(raw.diameter ?? raw.x ?? scalar, 0.12, 1.2);
      return { x: diameter, y, z: diameter };
    }
    return { x, y, z };
  }

  function geometryFor(shape, size) {
    const THREE = state.THREE;
    switch (shape) {
      case 'sphere':
        return new THREE.SphereGeometry(size.x * 0.5, 28, 18);
      case 'cylinder':
        return new THREE.CylinderGeometry(size.x * 0.5, size.x * 0.5, size.y, 28);
      case 'cone':
        return new THREE.ConeGeometry(size.x * 0.5, size.y, 28);
      case 'box':
      default:
        return new THREE.BoxGeometry(size.x, size.y, size.z);
    }
  }

  function avatarPosition() {
    return state.scene.avatar.getWorldPosition(new state.THREE.Vector3());
  }

  function avatarQuaternion() {
    return state.scene.avatar.getWorldQuaternion(new state.THREE.Quaternion());
  }

  function localDirection(direction) {
    const THREE = state.THREE;
    const vectors = {
      front: new THREE.Vector3(0, 0, -1),
      forward: new THREE.Vector3(0, 0, -1),
      вперед: new THREE.Vector3(0, 0, -1),
      back: new THREE.Vector3(0, 0, 1),
      backward: new THREE.Vector3(0, 0, 1),
      назад: new THREE.Vector3(0, 0, 1),
      left: new THREE.Vector3(-1, 0, 0),
      слева: new THREE.Vector3(-1, 0, 0),
      влево: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
      справа: new THREE.Vector3(1, 0, 0),
      вправо: new THREE.Vector3(1, 0, 0),
    };
    return (vectors[String(direction || 'front').toLowerCase()] || vectors.front)
      .clone()
      .applyQuaternion(avatarQuaternion())
      .setY(0)
      .normalize();
  }

  function placementPosition(args, size) {
    const THREE = state.THREE;
    const explicit = args.position && typeof args.position === 'object' ? args.position : null;
    if (explicit && Number.isFinite(Number(explicit.x)) && Number.isFinite(Number(explicit.z))) {
      return new THREE.Vector3(
        clamp(explicit.x, SPACE.minX + 0.25, SPACE.maxX - 0.25),
        clamp(explicit.y ?? size.y * 0.5, size.y * 0.5, SPACE.maxY - size.y * 0.5),
        clamp(explicit.z, SPACE.minZ + 0.25, SPACE.maxZ - 0.25),
      );
    }

    const origin = avatarPosition();
    const direction = localDirection(args.direction || args.placement || 'front');
    const distance = clamp(args.distance ?? 1.35, 0.65, 3.2);
    const pos = origin.clone().addScaledVector(direction, distance);
    pos.x = clamp(pos.x, SPACE.minX + 0.25, SPACE.maxX - 0.25);
    pos.z = clamp(pos.z, SPACE.minZ + 0.25, SPACE.maxZ - 0.25);
    pos.y = size.y * 0.5;
    return pos;
  }

  function addTargetRecord(id, label, mesh, material, size, dynamic = true) {
    mesh.userData.targetId = id;
    mesh.userData.dynamicObject = dynamic;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    state.scene.targets.set(id, {
      id,
      label,
      mesh,
      material,
      pickMeshes: [mesh],
      noRecolor: false,
      position: mesh.position.clone(),
      size: { ...size },
      dynamic,
      originalEmissive: material.emissive.clone(),
      originalIntensity: material.emissiveIntensity,
    });
    if (dynamic) {
      state.dynamicIds.add(id);
      state.createdOrder = state.createdOrder.filter((item) => item !== id);
      state.createdOrder.push(id);
    }
    return id;
  }

  function createObject(args = {}, options = {}) {
    const shapeRaw = String(args.shape || options.shape || 'box').toLowerCase();
    const shape = ['box', 'sphere', 'cylinder', 'cone'].includes(shapeRaw) ? shapeRaw : 'box';
    const size = normalizeSize(shape, args.size || options.size || {});
    const label = String(args.label || args.name || options.label || 'New object').slice(0, 80);
    const id = safeId(args.id || args.name || options.id || label);
    const material = materialFor(args.color || options.color || 'blue');
    const mesh = new state.THREE.Mesh(geometryFor(shape, size), material);
    mesh.position.copy(placementPosition({ ...options, ...args }, size));
    state.scene.scene.add(mesh);
    addTargetRecord(id, label, mesh, material, size, options.dynamic !== false);
    updateVisiblePanel();
    return {
      ok: true,
      action: 'create_object',
      targetId: id,
      label,
      shape,
      color: `#${material.color.getHexString()}`,
      size,
      position: vectorJson(mesh.position),
    };
  }

  function deleteObject(args = {}) {
    let id = String(args.targetId || args.id || '').trim();
    if (!id && state.createdOrder.length) id = state.createdOrder[state.createdOrder.length - 1];
    if (!state.dynamicIds.has(id)) {
      return { ok: false, error: BUILTIN_TARGETS.has(id) ? 'protected_object' : 'dynamic_object_not_found', targetId: id };
    }
    const target = state.scene.targets.get(id);
    if (target?.mesh) {
      target.mesh.parent?.remove(target.mesh);
      target.mesh.geometry?.dispose?.();
      target.mesh.material?.dispose?.();
    }
    state.scene.targets.delete(id);
    state.dynamicIds.delete(id);
    state.createdOrder = state.createdOrder.filter((item) => item !== id);
    if (state.scene.lookTarget === id) state.scene.lookTarget = null;
    if (state.scene.pointTarget === id) state.scene.pointTarget = null;
    if (state.scene.focusId === id) state.scene.focusId = null;
    updateVisiblePanel();
    return { ok: true, action: 'delete_object', targetId: id };
  }

  async function moveObject(args = {}) {
    const id = String(args.targetId || '').trim();
    const target = state.scene.targets.get(id);
    if (!target?.mesh || !state.dynamicIds.has(id)) return { ok: false, error: 'dynamic_object_not_found', targetId: id };
    const start = target.mesh.position.clone();
    const size = target.size || { x: 0.5, y: 0.5, z: 0.5 };
    let end;
    if (args.position) end = placementPosition({ position: args.position }, size);
    else {
      const direction = localDirection(args.direction || 'front');
      const distance = clamp(args.distance ?? 0.8, 0.1, 2.5);
      end = start.clone().addScaledVector(direction, distance);
      end.x = clamp(end.x, SPACE.minX + 0.2, SPACE.maxX - 0.2);
      end.z = clamp(end.z, SPACE.minZ + 0.2, SPACE.maxZ - 0.2);
      end.y = Math.max(size.y * 0.5, end.y);
    }
    await tween(650, (t) => {
      target.mesh.position.lerpVectors(start, end, smooth(t));
      target.position.copy(target.mesh.position);
    });
    return { ok: true, action: 'move_object', targetId: id, position: vectorJson(target.mesh.position) };
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function tween(duration, update) {
    const started = performance.now();
    return new Promise((resolve) => {
      const tick = (now) => {
        const t = Math.min(1, (now - started) / duration);
        update(t);
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  function setLeftArmPose(pose) {
    state.pose.leftArm = pose;
    const THREE = state.THREE;
    if (pose === 'down') {
      state.leftTarget = new THREE.Quaternion();
      state.leftWaveUntil = 0;
      return;
    }
    const direction = pose === 'raised'
      ? new THREE.Vector3(-0.18, 0.92, -0.35).normalize()
      : new THREE.Vector3(-0.45, 0.65, -0.6).normalize();
    state.leftTarget = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
  }

  function ensureRightPoseTarget() {
    const id = state.rightPoseTargetId;
    if (state.scene.targets.has(id)) return state.scene.targets.get(id);
    const target = {
      id,
      label: 'internal right hand pose target',
      mesh: null,
      material: null,
      pickMeshes: [],
      noRecolor: true,
      dynamic: false,
      internal: true,
      position: new state.THREE.Vector3(),
    };
    state.scene.targets.set(id, target);
    return target;
  }

  function setRightArmPose(pose) {
    state.pose.rightArm = pose;
    if (pose === 'down') {
      if (state.scene.pointTarget === state.rightPoseTargetId) state.scene.pointTarget = null;
      return;
    }
    ensureRightPoseTarget();
    state.scene.pointTarget = state.rightPoseTargetId;
  }

  function updateRightPoseTarget(now = performance.now()) {
    const target = state.scene.targets.get(state.rightPoseTargetId);
    if (!target || state.pose.rightArm === 'down') return;
    const shoulder = state.scene.rightArm.root.getWorldPosition(new state.THREE.Vector3());
    const q = avatarQuaternion();
    const up = new state.THREE.Vector3(0.15, 0.9, -0.35).applyQuaternion(q).normalize();
    if (state.pose.rightArm === 'waving') {
      up.x += Math.sin(now * 0.018) * 0.26;
      up.normalize();
    }
    target.position.copy(shoulder).addScaledVector(up, 0.9);
  }

  async function raiseHand(args = {}) {
    const side = String(args.side || 'left').toLowerCase().startsWith('r') || String(args.side || '').toLowerCase().includes('прав') ? 'right' : 'left';
    if (side === 'left') setLeftArmPose('raised');
    else setRightArmPose('raised');
    state.scene.setState('acting');
    await sleep(650);
    state.scene.setState('idle');
    return { ok: true, action: 'raise_hand', side, pose: { ...state.pose } };
  }

  async function lowerHand(args = {}) {
    const raw = String(args.side || 'both').toLowerCase();
    const both = raw === 'both' || raw.includes('обе') || raw.includes('both');
    if (both || raw.startsWith('l') || raw.includes('лев')) setLeftArmPose('down');
    if (both || raw.startsWith('r') || raw.includes('прав')) setRightArmPose('down');
    state.scene.setState('acting');
    await sleep(600);
    state.scene.setState('idle');
    return { ok: true, action: 'lower_hand', side: both ? 'both' : raw, pose: { ...state.pose } };
  }

  async function wave(args = {}) {
    const side = String(args.side || 'left').toLowerCase().startsWith('r') || String(args.side || '').toLowerCase().includes('прав') ? 'right' : 'left';
    const duration = clamp(args.seconds ?? 2, 0.8, 4) * 1000;
    state.scene.setState('acting');
    if (side === 'left') {
      setLeftArmPose('raised');
      state.pose.leftArm = 'waving';
      state.leftWaveStarted = performance.now();
      state.leftWaveUntil = state.leftWaveStarted + duration;
    } else {
      setRightArmPose('waving');
    }
    await sleep(duration);
    if (side === 'left') setLeftArmPose('raised');
    else setRightArmPose('raised');
    state.scene.setState('idle');
    return { ok: true, action: 'wave', side };
  }

  async function stepAvatar(args = {}) {
    const direction = String(args.direction || 'front');
    const distance = clamp(args.distance ?? args.meters ?? 0.7, 0.1, 2.0);
    const start = state.scene.avatar.position.clone();
    const delta = localDirection(direction).multiplyScalar(distance);
    const end = start.clone().add(delta);
    end.x = clamp(end.x, SPACE.minX + 0.55, SPACE.maxX - 0.55);
    end.z = clamp(end.z, SPACE.minZ + 0.55, SPACE.maxZ - 0.55);
    end.y = 0;
    state.pose.motion = 'moving';
    state.scene.setState('moving');
    await tween(Math.max(420, distance * 650), (t) => state.scene.avatar.position.lerpVectors(start, end, smooth(t)));
    state.pose.motion = 'idle';
    state.scene.setState('idle');
    return { ok: true, action: 'step', direction, distance: round(start.distanceTo(end)), position: vectorJson(state.scene.avatar.position) };
  }

  async function turnBody(args = {}) {
    const degrees = clamp(args.degrees ?? args.angle ?? 45, -180, 180);
    const start = state.scene.avatar.rotation.y;
    const end = start + state.THREE.MathUtils.degToRad(degrees);
    state.pose.motion = 'turning';
    state.scene.setState('moving');
    await tween(500, (t) => {
      state.scene.avatar.rotation.y = state.THREE.MathUtils.lerp(start, end, smooth(t));
    });
    state.pose.motion = 'idle';
    state.pose.facingDegrees = round(state.THREE.MathUtils.radToDeg(state.scene.avatar.rotation.y), 1);
    state.scene.setState('idle');
    return { ok: true, action: 'turn_body', degrees, facingDegrees: state.pose.facingDegrees };
  }

  async function neutralPose() {
    setLeftArmPose('down');
    setRightArmPose('down');
    state.scene.lookTarget = null;
    state.pose.motion = 'idle';
    await sleep(450);
    return { ok: true, action: 'neutral_pose', pose: { ...state.pose } };
  }

  function vectorJson(v) {
    return { x: round(v.x), y: round(v.y), z: round(v.z) };
  }

  function objectDimensions(target) {
    if (target?.size) return { ...target.size };
    if (!target?.mesh) return null;
    try {
      const box = new state.THREE.Box3().setFromObject(target.mesh);
      const size = box.getSize(new state.THREE.Vector3());
      return vectorJson(size);
    } catch {
      return null;
    }
  }

  function relativeToAvatar(worldPosition) {
    const origin = avatarPosition();
    const local = worldPosition.clone().sub(origin).applyQuaternion(avatarQuaternion().invert());
    const horizontal = Math.hypot(local.x, local.z);
    const side = Math.abs(local.x) > Math.abs(local.z) ? (local.x < 0 ? 'left' : 'right') : (local.z < 0 ? 'front' : 'behind');
    return {
      relation: side,
      horizontalDistance: round(horizontal),
      verticalOffset: round(local.y),
    };
  }

  function enrichedContext(baseGet) {
    const base = baseGet();
    const avatar = state.scene.avatar;
    const avatarBox = new state.THREE.Box3().setFromObject(avatar);
    const avatarSize = avatarBox.getSize(new state.THREE.Vector3());
    const avatarPos = avatarPosition();
    const leftHand = state.scene.leftArm.hand.getWorldPosition(new state.THREE.Vector3());
    const rightHand = state.scene.rightArm.hand.getWorldPosition(new state.THREE.Vector3());
    const head = state.scene.headPivot.getWorldPosition(new state.THREE.Vector3());
    const objects = [...state.scene.targets.values()]
      .filter((target) => !target.internal && !String(target.id).startsWith('__'))
      .map((target) => {
        const position = target.position?.clone?.() || target.mesh?.getWorldPosition?.(new state.THREE.Vector3()) || new state.THREE.Vector3();
        const distance = avatarPos.distanceTo(position);
        return {
          id: target.id,
          label: target.label,
          dynamic: Boolean(target.dynamic),
          position: vectorJson(position),
          dimensions: objectDimensions(target),
          distanceFromAvatar: round(distance),
          reachableFromCurrentPosition: distance <= 0.82,
          relativeToAvatar: relativeToAvatar(position),
        };
      });

    return {
      ...base,
      visibleTargets: objects.map((item) => ({
        id: item.id,
        label: item.label,
        distance: item.distanceFromAvatar,
      })),
      space: {
        units: 'meters',
        floorY: SPACE.floorY,
        bounds: {
          x: [SPACE.minX, SPACE.maxX],
          y: [SPACE.floorY, SPACE.maxY],
          z: [SPACE.minZ, SPACE.maxZ],
        },
        size: { width: round(SPACE.maxX - SPACE.minX), height: SPACE.maxY, depth: round(SPACE.maxZ - SPACE.minZ) },
      },
      avatar: {
        id: 'nova',
        position: vectorJson(avatarPos),
        dimensions: vectorJson(avatarSize),
        approximateReach: 0.82,
        facingDegrees: state.pose.facingDegrees,
        pose: { ...state.pose },
        bodyParts: {
          head: vectorJson(head),
          leftHand: vectorJson(leftHand),
          rightHand: vectorJson(rightHand),
        },
      },
      objects,
      editableWorld: {
        dynamicObjectIds: [...state.dynamicIds],
        lastCreatedId: state.createdOrder[state.createdOrder.length - 1] || null,
        supportedShapes: ['box', 'sphere', 'cylinder', 'cone'],
      },
    };
  }

  async function executeExtended(action) {
    if (!state.ready || !state.scene) return { ok: false, error: 'embodiment_not_ready' };
    const args = action?.args && typeof action.args === 'object' ? action.args : {};
    switch (action?.name) {
      case 'raise_hand': return raiseHand(args);
      case 'lower_hand': return lowerHand(args);
      case 'wave': return wave(args);
      case 'step': return stepAvatar(args);
      case 'turn_body': return turnBody(args);
      case 'neutral_pose': return neutralPose();
      case 'create_object': return createObject(args);
      case 'delete_object': return deleteObject(args);
      case 'move_object': return moveObject(args);
      default:
        if (DYNAMIC_SPATIAL_ACTIONS.has(action?.name)) {
          return state.scene.executeTool(action.name, args);
        }
        return { ok: false, error: 'extended_action_not_allowed', action: action?.name };
    }
  }

  function updateVisiblePanel() {
    const el = document.getElementById('visible-targets');
    if (!el || !state.scene) return;
    const ids = [...state.scene.targets.keys()].filter((id) => !String(id).startsWith('__'));
    el.textContent = ids.join(', ');
  }

  function addStarterObjects() {
    const specs = [
      { id: 'blue_crate', label: 'Blue storage crate', shape: 'box', color: 'blue', size: { x: 0.58, y: 0.48, z: 0.58 }, position: { x: -0.25, y: 0.24, z: -1.35 } },
      { id: 'yellow_cone', label: 'Yellow safety cone', shape: 'cone', color: 'yellow', size: { x: 0.46, y: 0.72, z: 0.46 }, position: { x: 2.45, y: 0.36, z: 1.25 } },
      { id: 'green_canister', label: 'Green canister', shape: 'cylinder', color: 'green', size: { x: 0.42, y: 0.68, z: 0.42 }, position: { x: -2.25, y: 0.34, z: 0.78 } },
      { id: 'purple_orb', label: 'Purple calibration sphere', shape: 'sphere', color: 'purple', size: { scalar: 0.48 }, position: { x: 0.28, y: 0.24, z: 1.72 } },
      { id: 'white_toolbox', label: 'White toolbox', shape: 'box', color: 'white', size: { x: 0.72, y: 0.3, z: 0.38 }, position: { x: -0.72, y: 0.15, z: 0.88 } },
    ];
    for (const spec of specs) {
      if (state.scene.targets.has(`user_${spec.id}`)) continue;
      createObject({ ...spec, id: spec.id }, { dynamic: true });
    }
  }

  function animationLoop() {
    if (!state.ready || !state.scene) return requestAnimationFrame(animationLoop);
    const now = performance.now();
    if (state.leftTarget) {
      let target = state.leftTarget;
      if (state.pose.leftArm === 'waving' && now < state.leftWaveUntil) {
        const base = state.leftTarget.clone();
        const wiggle = new state.THREE.Quaternion().setFromAxisAngle(
          new state.THREE.Vector3(0, 1, 0),
          Math.sin((now - state.leftWaveStarted) * 0.022) * 0.42,
        );
        target = base.multiply(wiggle);
      }
      state.scene.leftArm.root.quaternion.slerp(target, 0.18);
    }
    updateRightPoseTarget(now);
    state.pose.facingDegrees = round(state.THREE.MathUtils.radToDeg(state.scene.avatar.rotation.y), 1);
    requestAnimationFrame(animationLoop);
  }

  async function attachToScene(scene) {
    if (!scene || scene === state.scene || !scene.scene || !scene.targets || !scene.avatar) return;
    state.scene = scene;
    state.THREE = await import('three');
    const originalGetContext = scene.getSceneContext.bind(scene);
    scene.getSceneContext = () => enrichedContext(originalGetContext);
    setLeftArmPose('down');
    addStarterObjects();
    updateVisiblePanel();
    state.ready = true;
    window.__novaEmbodimentReady = true;
    window.__novaEmbodiment = {
      execute: executeExtended,
      createObject,
      deleteObject,
      moveObject,
      getContext: () => scene.getSceneContext(),
      getDynamicIds: () => [...state.dynamicIds],
      getPose: () => ({ ...state.pose }),
    };
  }

  async function waitForScene() {
    for (let i = 0; i < 100; i += 1) {
      const scene = window.__novaScene;
      if (scene?.scene && scene?.avatar) {
        await attachToScene(scene);
        return true;
      }
      await sleep(50);
    }
    return false;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const input = args[0];
      const init = args[1] || {};
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(init.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
      if (method === 'POST' && url.includes('nova-chat')) {
        const clone = response.clone();
        const data = await clone.json().catch(() => null);
        if (data?.ok && Array.isArray(data.extendedActions) && data.extendedActions.length) {
          if (!state.ready) await waitForScene();
          const results = [];
          for (const action of data.extendedActions.slice(0, 8)) results.push(await executeExtended(action));
          window.__novaLastExtendedResults = results;
        }
      }
    } catch (error) {
      console.error('Embodiment action execution failed:', error);
    }
    return response;
  };

  window.__novaEmbodimentReady = false;
  window.addEventListener('DOMContentLoaded', () => {
    waitForScene();
    requestAnimationFrame(animationLoop);
  });
})();
