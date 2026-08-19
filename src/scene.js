import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TARGET_PRIORITY = ['red_button', 'filter', 'device'];

export class SpatialScene {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090e17);
    this.scene.fog = new THREE.Fog(0x090e17, 6, 14);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 30);
    this.camera.position.set(0, 1.6, 5.2);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');

    canvas.style.touchAction = 'none';
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 8.0;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.targets = new Map();
    this.focusId = null;
    this.lastFocusCheck = 0;
    this.highlightTimeouts = new Map();
    this.isXR = false;

    this.deviceState = {
      resetPressed: false,
      filterRemoved: false,
      lastActivatedTarget: null,
    };

    this.#buildLighting();
    this.#buildEnvironment();
    this.#buildAvatar();
    this.#buildDevice();
    this.#wireEvents();
    this.#resize();
    this.renderer.setAnimationLoop((time) => this.#animate(time));
  }

  #material(color, options = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.52,
      metalness: options.metalness ?? 0.18,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 0,
    });
  }

  #buildLighting() {
    this.scene.add(new THREE.HemisphereLight(0xaedcff, 0x10131c, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 4.2);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x41baff, 20, 8, 2);
    rim.position.set(-2.7, 2.4, 0.4);
    this.scene.add(rim);
  }

  #buildEnvironment() {
    this.environmentGroup = new THREE.Group();
    this.scene.add(this.environmentGroup);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(5.3, 64),
      this.#material(0x151d2a, { roughness: 0.93 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.environmentGroup.add(floor);

    const grid = new THREE.GridHelper(8, 16, 0x285777, 0x172533);
    grid.position.y = 0.006;
    grid.material.opacity = 0.28;
    grid.material.transparent = true;
    this.environmentGroup.add(grid);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.82, 0.9, 0.16, 48),
      this.#material(0x111926, { metalness: 0.45 }),
    );
    pedestal.position.set(1.35, 0.08, -0.2);
    pedestal.receiveShadow = true;
    this.environmentGroup.add(pedestal);
  }

  #buildAvatar() {
    this.avatar = new THREE.Group();
    this.avatar.position.set(-1.35, 0, -0.1);
    this.avatarHome = this.avatar.position.clone();
    this.scene.add(this.avatar);

    const bodyMat = this.#material(0x263e57, { metalness: 0.62, roughness: 0.28 });
    const trimMat = this.#material(0x70dcff, {
      metalness: 0.35,
      roughness: 0.25,
      emissive: 0x1d8bc1,
      emissiveIntensity: 0.35,
    });
    const darkMat = this.#material(0x09131d, { metalness: 0.5, roughness: 0.35 });

    this.body = new THREE.Group();
    this.body.position.y = 0.87;
    this.avatar.add(this.body);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.38, 8, 20), bodyMat);
    torso.scale.set(1.08, 1.1, 0.75);
    torso.castShadow = true;
    this.body.add(torso);

    const chest = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 12, 48), trimMat);
    chest.rotation.x = Math.PI / 2;
    chest.position.set(0, 0.02, 0.25);
    this.body.add(chest);

    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 0.62, 0);
    this.body.add(this.headPivot);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.245, 32, 20), bodyMat);
    head.scale.set(1, 0.82, 0.88);
    head.castShadow = true;
    this.headPivot.add(head);

    const face = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.13, 0.055), darkMat);
    face.position.set(0, 0, -0.225);
    this.headPivot.add(face);

    this.leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.027, 16, 12), trimMat);
    this.rightEye = this.leftEye.clone();
    this.leftEye.position.set(0.074, 0.018, -0.255);
    this.rightEye.position.set(-0.074, 0.018, -0.255);
    this.headPivot.add(this.leftEye, this.rightEye);

    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.012), trimMat);
    this.mouth.position.set(0, -0.052, -0.258);
    this.headPivot.add(this.mouth);

    this.leftArm = this.#createArm(-0.34, bodyMat, trimMat);
    this.rightArm = this.#createArm(0.34, bodyMat, trimMat);
    this.body.add(this.leftArm.root, this.rightArm.root);

    const footGeo = new THREE.SphereGeometry(0.16, 20, 12);
    for (const x of [-0.17, 0.17]) {
      const foot = new THREE.Mesh(footGeo, darkMat);
      foot.scale.set(1, 0.45, 1.5);
      foot.position.set(x, -0.55, 0.04);
      foot.castShadow = true;
      this.body.add(foot);
    }

    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.008, 8, 64), trimMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -0.49;
    this.body.add(halo);

    this.avatarState = 'idle';
    this.lookTarget = null;
    this.pointTarget = null;
  }

  #createArm(x, bodyMat, trimMat) {
    const root = new THREE.Group();
    root.position.set(x, 0.22, 0);
    const armLength = 0.42;
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.07, armLength, 16),
      bodyMat,
    );
    arm.position.y = -armLength * 0.5;
    arm.castShadow = true;
    root.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), trimMat);
    hand.position.y = -armLength;
    root.add(hand);
    return { root, hand, length: armLength };
  }

  #buildDevice() {
    this.device = new THREE.Group();
    this.device.position.set(1.35, 0.25, -0.2);
    this.scene.add(this.device);

    const shellMat = this.#material(0x303845, { metalness: 0.48, roughness: 0.32 });
    const panelMat = this.#material(0x0d151e, { metalness: 0.55, roughness: 0.25 });
    const redMat = this.#material(0xd93b4f, { emissive: 0x8b061d, emissiveIntensity: 0.4 });
    const filterMat = this.#material(0x7b8797, { metalness: 0.4, roughness: 0.42 });

    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.15, 0.72), shellMat);
    shell.position.y = 0.63;
    shell.castShadow = true;
    shell.receiveShadow = true;
    this.device.add(shell);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.48, 0.045), panelMat);
    panel.position.set(0, 0.79, 0.385);
    this.device.add(panel);

    this.screenMaterial = this.#material(0x17334c, {
      emissive: 0x1f84bd,
      emissiveIntensity: 0.7,
    });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.18), this.screenMaterial);
    this.screen.position.set(-0.11, 0.85, 0.411);
    this.device.add(this.screen);

    this.redBezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.125, 0.03, 24),
      panelMat,
    );
    this.redBezel.rotation.x = Math.PI / 2;
    this.redBezel.position.set(0.31, 0.74, 0.402);
    this.device.add(this.redBezel);

    this.redButton = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.06, 24),
      redMat,
    );
    this.redButton.rotation.x = Math.PI / 2;
    this.redButton.position.set(0.31, 0.74, 0.425);
    this.redButtonRestZ = this.redButton.position.z;
    this.device.add(this.redButton);

    const redHit = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    redHit.position.set(0.31, 0.74, 0.42);
    this.device.add(redHit);

    this.filter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.42, 32),
      filterMat,
    );
    this.filter.rotation.z = Math.PI / 2;
    this.filter.position.set(0.1, 0.28, 0.44);
    this.filterRestPosition = this.filter.position.clone();
    this.device.add(this.filter);

    const filterHit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.5, 16),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    filterHit.rotation.z = Math.PI / 2;
    filterHit.position.copy(this.filter.position);
    this.device.add(filterHit);
    this.filterHit = filterHit;

    this.#registerTarget(
      'device',
      'Service device',
      shell,
      this.device.position.clone().add(new THREE.Vector3(0, 0.7, 0)),
      shellMat,
      { pickMeshes: [shell, panel, this.screen], noRecolor: true },
    );
    this.#registerTarget(
      'red_button',
      'Red reset button',
      this.redButton,
      this.device.position.clone().add(this.redButton.position),
      redMat,
      { pickMeshes: [this.redButton, this.redBezel, redHit] },
    );
    this.#registerTarget(
      'filter',
      'Replaceable filter',
      this.filter,
      this.device.position.clone().add(this.filter.position),
      filterMat,
      { pickMeshes: [this.filter, filterHit] },
    );
  }

  #registerTarget(id, label, mesh, position, material, options = {}) {
    mesh.userData.targetId = id;
    const pickMeshes = options.pickMeshes ?? [mesh];
    for (const pickMesh of pickMeshes) pickMesh.userData.targetId = id;
    this.targets.set(id, {
      id,
      label,
      mesh,
      position,
      material,
      pickMeshes,
      noRecolor: Boolean(options.noRecolor),
      originalEmissive: material.emissive?.clone?.() ?? new THREE.Color(0),
      originalIntensity: material.emissiveIntensity ?? 0,
    });
  }

  #allPickMeshes() {
    const meshes = [];
    for (const target of this.targets.values()) meshes.push(...target.pickMeshes);
    return meshes;
  }

  #wireEvents() {
    window.addEventListener('resize', () => this.#resize());
    window.visualViewport?.addEventListener('resize', () => this.#resize());

    let down = null;
    this.canvas.addEventListener('pointerdown', (event) => {
      down = { x: event.clientX, y: event.clientY, id: event.pointerId };
    });
    this.canvas.addEventListener('pointercancel', () => {
      down = null;
    });
    this.canvas.addEventListener('pointerup', (event) => {
      if (!down || down.id !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (moved > 10) return;
      const id = this.#pickAt(event.clientX, event.clientY);
      if (!id) return;
      void this.activateTarget(id, 'tap');
    });
  }

  async activateTarget(id, source = 'tap') {
    if (!this.targets.has(id)) return { ok: false, error: 'unknown_target', targetId: id };

    this.focusId = id;
    this.deviceState.lastActivatedTarget = id;
    this.callbacks.onFocusChanged?.(id, this.getSceneContext());

    let result;
    if (id === 'red_button') {
      result = await this.executeTool('press_button', { targetId: 'red_button', source });
    } else if (id === 'filter') {
      result = await this.executeTool('remove_filter', { targetId: 'filter', source });
    } else {
      result = { ok: true, action: 'select', targetId: id };
    }

    this.callbacks.onTargetActivated?.(id, result, this.getSceneContext());
    return result;
  }

  #pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const meshes = this.#allPickMeshes();
    const found = new Set();
    const radius = Math.max(12, Math.min(rect.width, rect.height) * 0.03);
    const samples = [[0, 0]];

    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      samples.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      samples.push([Math.cos(angle) * radius * 0.5, Math.sin(angle) * radius * 0.5]);
    }

    for (const [dx, dy] of samples) {
      this.pointer.x = ((clientX + dx - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((clientY + dy - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      this.raycaster.far = 8;

      for (const hit of this.raycaster.intersectObjects(meshes, false)) {
        const id = hit.object?.userData?.targetId;
        if (id) found.add(id);
      }
      if (found.has('red_button')) return 'red_button';
    }

    return TARGET_PRIORITY.find((id) => found.has(id)) ?? null;
  }

  #resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.visualViewport?.height || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  #animate(time) {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (!this.isXR) this.controls.update();

    this.body.position.y = 0.87 + Math.sin(time * 0.0018) * 0.025;
    if (this.avatarState === 'speaking') {
      this.mouth.scale.y = 1 + Math.abs(Math.sin(time * 0.025)) * 3.2;
      this.leftEye.scale.setScalar(1 + Math.sin(time * 0.006) * 0.04);
      this.rightEye.scale.copy(this.leftEye.scale);
    } else {
      this.mouth.scale.y = THREE.MathUtils.lerp(this.mouth.scale.y, 1, delta * 8);
    }

    this.#updateHead(delta);
    this.#updateArm(delta);
    this.#updateFocus(time);
    this.renderer.render(this.scene, this.camera);
  }

  #updateHead(delta) {
    const targetPosition =
      this.lookTarget && this.targets.has(this.lookTarget)
        ? this.targets.get(this.lookTarget).position
        : this.getViewerWorldPosition();

    const worldPos = new THREE.Vector3();
    this.headPivot.getWorldPosition(worldPos);
    const desiredMatrix = new THREE.Matrix4().lookAt(
      worldPos,
      targetPosition,
      new THREE.Vector3(0, 1, 0),
    );
    const desiredWorld = new THREE.Quaternion().setFromRotationMatrix(desiredMatrix);
    const parentWorld = this.body.getWorldQuaternion(new THREE.Quaternion());
    const desiredLocal = parentWorld.invert().multiply(desiredWorld);
    this.headPivot.quaternion.slerp(desiredLocal, Math.min(1, delta * 4.8));
  }

  #updateArm(delta) {
    const armRoot = this.rightArm.root;
    const desired = new THREE.Quaternion();
    if (this.pointTarget && this.targets.has(this.pointTarget)) {
      const worldShoulder = new THREE.Vector3();
      armRoot.getWorldPosition(worldShoulder);
      const directionWorld = this.targets
        .get(this.pointTarget)
        .position.clone()
        .sub(worldShoulder)
        .normalize();
      const parentInverse = this.body
        .getWorldQuaternion(new THREE.Quaternion())
        .invert();
      const localDirection = directionWorld.applyQuaternion(parentInverse).normalize();
      desired.setFromUnitVectors(new THREE.Vector3(0, -1, 0), localDirection);
    }
    armRoot.quaternion.slerp(desired, Math.min(1, delta * 6.5));
  }

  #updateFocus(time) {
    if (time - this.lastFocusCheck < 120) return;
    this.lastFocusCheck = time;

    let origin;
    let direction;
    if (this.renderer.xr.isPresenting) {
      const xrCamera = this.renderer.xr.getCamera(this.camera);
      origin = xrCamera.getWorldPosition(new THREE.Vector3());
      direction = xrCamera.getWorldDirection(new THREE.Vector3());
    } else {
      origin = this.camera.getWorldPosition(new THREE.Vector3());
      direction = this.camera.getWorldDirection(new THREE.Vector3());
    }

    this.raycaster.set(origin, direction);
    this.raycaster.far = 8;
    const hit = this.raycaster.intersectObjects(this.#allPickMeshes(), false)[0];
    const nextId = hit?.object?.userData?.targetId ?? null;
    if (nextId !== this.focusId) {
      this.focusId = nextId;
      this.callbacks.onFocusChanged?.(nextId, this.getSceneContext());
    }
  }

  #taskStep() {
    if (this.deviceState.filterRemoved) return 'complete';
    if (this.deviceState.resetPressed) return 'filter_required';
    return 'reset_required';
  }

  getViewerWorldPosition() {
    if (this.renderer.xr.isPresenting) {
      return this.renderer.xr.getCamera(this.camera).getWorldPosition(new THREE.Vector3());
    }
    return this.camera.getWorldPosition(new THREE.Vector3());
  }

  getSceneContext() {
    const viewer = this.getViewerWorldPosition();
    return {
      gazeTarget: this.focusId,
      visibleTargets: [...this.targets.values()].map((target) => ({
        id: target.id,
        label: target.label,
        distance: Number(viewer.distanceTo(target.position).toFixed(2)),
      })),
      task: { name: 'service_device', step: this.#taskStep() },
      deviceState: {
        resetPressed: this.deviceState.resetPressed,
        filterRemoved: this.deviceState.filterRemoved,
        lastActivatedTarget: this.deviceState.lastActivatedTarget,
      },
    };
  }

  setState(state) {
    this.avatarState = state;
    this.callbacks.onStateChanged?.(state);
  }

  async executeTool(name, args = {}) {
    const id = args.targetId;
    if (id && !this.targets.has(id)) {
      return { ok: false, error: 'unknown_target', targetId: id };
    }
    this.callbacks.onTool?.(name, args);

    switch (name) {
      case 'look_at':
        if (!id) return { ok: false, error: 'target_required' };
        this.lookTarget = id;
        this.setState('looking');
        setTimeout(() => this.setState('idle'), 900);
        return { ok: true, action: name, targetId: id };
      case 'point_at':
        if (!id) return { ok: false, error: 'target_required' };
        this.lookTarget = id;
        this.pointTarget = id;
        this.setState('pointing');
        setTimeout(() => {
          this.pointTarget = null;
          this.setState('idle');
        }, 2800);
        return { ok: true, action: name, targetId: id };
      case 'highlight':
        if (!id) return { ok: false, error: 'target_required' };
        this.highlight(id, Number(args.seconds ?? 3));
        return { ok: true, action: name, targetId: id };
      case 'move_near':
        if (!id) return { ok: false, error: 'target_required' };
        await this.moveNear(id);
        return { ok: true, action: name, targetId: id };
      case 'face_user':
        this.lookTarget = null;
        this.pointTarget = null;
        this.setState('looking');
        setTimeout(() => this.setState('idle'), 700);
        return { ok: true, action: name };
      case 'press_button':
        return this.pressButton(id || 'red_button');
      case 'remove_filter':
        return this.removeFilter(id || 'filter');
      default:
        return { ok: false, error: 'tool_not_allowed', action: name };
    }
  }

  highlight(id, seconds = 3) {
    const target = this.targets.get(id);
    if (!target || target.noRecolor) return;
    const mat = target.material;
    const isRed = id === 'red_button';
    if (mat.emissive) {
      mat.emissive.set(isRed ? 0xff3149 : 0x25c6ff);
      mat.emissiveIntensity = isRed ? 2.2 : 1.8;
    }
    clearTimeout(this.highlightTimeouts.get(id));
    this.highlightTimeouts.set(
      id,
      setTimeout(() => {
        if (mat.emissive) mat.emissive.copy(target.originalEmissive);
        mat.emissiveIntensity = target.originalIntensity;
      }, Math.max(250, seconds * 1000)),
    );
  }

  async pressButton(id = 'red_button') {
    if (id !== 'red_button') return { ok: false, error: 'invalid_button', targetId: id };

    this.deviceState.lastActivatedTarget = 'red_button';
    this.focusId = 'red_button';
    this.lookTarget = 'red_button';
    this.callbacks.onFocusChanged?.('red_button', this.getSceneContext());
    this.setState('acting');
    await this.#animateButtonPress();
    this.deviceState.resetPressed = true;
    this.#setScreenStatus('reset');
    this.setState('idle');

    return {
      ok: true,
      action: 'press_button',
      targetId: 'red_button',
      state: this.getSceneContext().deviceState,
      taskStep: this.#taskStep(),
    };
  }

  #animateButtonPress() {
    const target = this.targets.get('red_button');
    const mat = target.material;
    const restZ = this.redButtonRestZ;
    const began = performance.now();
    const duration = 420;

    return new Promise((resolve) => {
      const tick = (now) => {
        const t = Math.min(1, (now - began) / duration);
        const pulse = Math.sin(t * Math.PI);
        this.redButton.position.z = restZ - 0.045 * pulse;
        if (mat.emissive) {
          mat.emissive.setHex(0xff2b3f);
          mat.emissiveIntensity = target.originalIntensity + 3.2 * pulse;
        }
        if (t < 1) requestAnimationFrame(tick);
        else {
          this.redButton.position.z = restZ;
          if (mat.emissive) mat.emissive.copy(target.originalEmissive);
          mat.emissiveIntensity = target.originalIntensity;
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  async removeFilter(id = 'filter') {
    if (id !== 'filter') return { ok: false, error: 'invalid_filter', targetId: id };
    if (!this.deviceState.resetPressed) {
      return {
        ok: false,
        error: 'reset_required',
        action: 'remove_filter',
        targetId: 'filter',
        state: this.getSceneContext().deviceState,
        taskStep: this.#taskStep(),
      };
    }

    this.deviceState.lastActivatedTarget = 'filter';
    this.focusId = 'filter';
    this.lookTarget = 'filter';
    this.callbacks.onFocusChanged?.('filter', this.getSceneContext());

    if (!this.deviceState.filterRemoved) {
      this.setState('acting');
      await this.#animateFilterRemoval();
      this.deviceState.filterRemoved = true;
      this.#setScreenStatus('complete');
      this.setState('idle');
    }

    return {
      ok: true,
      action: 'remove_filter',
      targetId: 'filter',
      state: this.getSceneContext().deviceState,
      taskStep: this.#taskStep(),
    };
  }

  #animateFilterRemoval() {
    const start = this.filter.position.clone();
    const end = this.filterRestPosition.clone().add(new THREE.Vector3(0, 0.04, 0.58));
    const began = performance.now();
    const duration = 750;

    return new Promise((resolve) => {
      const tick = (now) => {
        const t = Math.min(1, (now - began) / duration);
        const eased = t * t * (3 - 2 * t);
        this.filter.position.lerpVectors(start, end, eased);
        this.filterHit.position.copy(this.filter.position);
        this.targets.get('filter').position.copy(this.device.position).add(this.filter.position);
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  #setScreenStatus(status) {
    if (status === 'complete') {
      this.screenMaterial.color.setHex(0x1a554f);
      this.screenMaterial.emissive.setHex(0x44ffd7);
      this.screenMaterial.emissiveIntensity = 1.7;
      return;
    }
    if (status === 'reset') {
      this.screenMaterial.color.setHex(0x173e31);
      this.screenMaterial.emissive.setHex(0x36dc8c);
      this.screenMaterial.emissiveIntensity = 1.45;
      return;
    }
    this.screenMaterial.color.setHex(0x17334c);
    this.screenMaterial.emissive.setHex(0x1f84bd);
    this.screenMaterial.emissiveIntensity = 0.7;
  }

  moveNear(id) {
    const target = this.targets.get(id);
    if (!target) return Promise.resolve();
    this.setState('moving');
    const destination = target.position.clone();
    destination.x -= 0.9;
    destination.z += 0.3;
    destination.y = 0;

    return new Promise((resolve) => {
      const start = this.avatar.position.clone();
      const began = performance.now();
      const duration = 1200;
      const tick = (now) => {
        const t = Math.min(1, (now - began) / duration);
        const eased = t * t * (3 - 2 * t);
        this.avatar.position.lerpVectors(start, destination, eased);
        if (t < 1) requestAnimationFrame(tick);
        else {
          this.setState('idle');
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  resetTask() {
    this.deviceState.resetPressed = false;
    this.deviceState.filterRemoved = false;
    this.deviceState.lastActivatedTarget = null;
    this.filter.position.copy(this.filterRestPosition);
    this.filterHit.position.copy(this.filterRestPosition);
    this.targets.get('filter').position.copy(this.device.position).add(this.filter.position);
    this.redButton.position.z = this.redButtonRestZ;
    this.#setScreenStatus('idle');
    this.lookTarget = null;
    this.pointTarget = null;
    this.focusId = null;
    this.avatar.position.copy(this.avatarHome);
    this.setState('idle');
    this.callbacks.onFocusChanged?.(null, this.getSceneContext());
    return this.getSceneContext();
  }

  async enterXR() {
    if (!navigator.xr) throw new Error('WebXR is not available in this browser.');
    const arSupported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
    const mode = arSupported ? 'immersive-ar' : 'immersive-vr';
    const options = arSupported
      ? {
          optionalFeatures: ['local-floor', 'dom-overlay', 'hand-tracking'],
          domOverlay: { root: document.body },
        }
      : { optionalFeatures: ['local-floor', 'hand-tracking'] };

    const session = await navigator.xr.requestSession(mode, options);
    this.isXR = true;
    if (arSupported) {
      this.scene.background = null;
      this.scene.fog = null;
      this.environmentGroup.visible = false;
    }
    session.addEventListener('end', () => {
      this.isXR = false;
      this.scene.background = new THREE.Color(0x090e17);
      this.scene.fog = new THREE.Fog(0x090e17, 6, 14);
      this.environmentGroup.visible = true;
    });
    await this.renderer.xr.setSession(session);
    return mode;
  }
}
