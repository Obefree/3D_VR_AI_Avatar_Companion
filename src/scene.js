import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 3.1;
    this.controls.maxDistance = 7.0;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.targets = new Map();
    this.focusId = null;
    this.lastFocusCheck = 0;
    this.highlightTimeouts = new Map();
    this.isXR = false;

    this.#buildLighting();
    this.#buildEnvironment();
    this.#buildAvatar();
    this.#buildDevice();
    this.#wireEvents();
    this.#resize();

    this.renderer.setAnimationLoop((time) => this.#animate(time));
  }

  #material(color, options = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: options.roughness ?? 0.52, metalness: options.metalness ?? 0.18, emissive: options.emissive ?? 0x000000, emissiveIntensity: options.emissiveIntensity ?? 0 });
  }

  #buildLighting() {
    const hemi = new THREE.HemisphereLight(0xaedcff, 0x10131c, 2.2);
    this.scene.add(hemi);
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
    const floor = new THREE.Mesh(new THREE.CircleGeometry(5.3, 64), this.#material(0x151d2a, { roughness: 0.93 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.environmentGroup.add(floor);
    const grid = new THREE.GridHelper(8, 16, 0x285777, 0x172533);
    grid.position.y = 0.006;
    grid.material.opacity = 0.28;
    grid.material.transparent = true;
    this.environmentGroup.add(grid);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.9, 0.16, 48), this.#material(0x111926, { metalness: 0.45 }));
    pedestal.position.set(1.35, 0.08, -0.2);
    pedestal.receiveShadow = true;
    this.environmentGroup.add(pedestal);
  }

  #buildAvatar() {
    this.avatar = new THREE.Group();
    this.avatar.position.set(-1.35, 0, -0.1);
    this.scene.add(this.avatar);
    const bodyMat = this.#material(0x263e57, { metalness: 0.62, roughness: 0.28 });
    const trimMat = this.#material(0x70dcff, { metalness: 0.35, roughness: 0.25, emissive: 0x1d8bc1, emissiveIntensity: 0.35 });
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
    face.position.set(0, 0, 0.225);
    this.headPivot.add(face);
    this.leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.027, 16, 12), trimMat);
    this.rightEye = this.leftEye.clone();
    this.leftEye.position.set(-0.074, 0.018, 0.255);
    this.rightEye.position.set(0.074, 0.018, 0.255);
    this.headPivot.add(this.leftEye, this.rightEye);
    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.012), trimMat);
    this.mouth.position.set(0, -0.052, 0.258);
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
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, armLength, 16), bodyMat);
    arm.position.y = -armLength * 0.5;
    arm.castShadow = true;
    root.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), trimMat);
    hand.position.y = -armLength;
    root.add(hand);
    return { root, hand, length: armLength };
  }

  #buildDevice() {
    const device = new THREE.Group();
    device.position.set(1.35, 0.25, -0.2);
    this.scene.add(device);
    const shellMat = this.#material(0x303845, { metalness: 0.48, roughness: 0.32 });
    const panelMat = this.#material(0x0d151e, { metalness: 0.55, roughness: 0.25 });
    const redMat = this.#material(0xd93b4f, { emissive: 0x8b061d, emissiveIntensity: 0.4 });
    const filterMat = this.#material(0x7b8797, { metalness: 0.4, roughness: 0.42 });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.15, 0.72), shellMat);
    shell.position.y = 0.63;
    shell.castShadow = true;
    shell.receiveShadow = true;
    device.add(shell);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.48, 0.045), panelMat);
    panel.position.set(0, 0.79, 0.385);
    device.add(panel);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.18), this.#material(0x17334c, { emissive: 0x1f84bd, emissiveIntensity: 0.7 }));
    screen.position.set(-0.11, 0.85, 0.411);
    device.add(screen);
    const redButton = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 24), redMat);
    redButton.rotation.x = Math.PI / 2;
    redButton.position.set(0.31, 0.74, 0.425);
    device.add(redButton);
    const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.42, 32), filterMat);
    filter.rotation.z = Math.PI / 2;
    filter.position.set(0.1, 0.28, 0.44);
    device.add(filter);
    this.#registerTarget('device', 'Service device', shell, device.position.clone().add(new THREE.Vector3(0, 0.7, 0)), shellMat);
    this.#registerTarget('red_button', 'Red reset button', redButton, device.position.clone().add(redButton.position), redMat);
    this.#registerTarget('filter', 'Replaceable filter', filter, device.position.clone().add(filter.position), filterMat);
  }

  #registerTarget(id, label, mesh, position, material) {
    mesh.userData.targetId = id;
    this.targets.set(id, { id, label, mesh, position, material, originalEmissive: material.emissive?.clone?.() ?? new THREE.Color(0), originalIntensity: material.emissiveIntensity ?? 0 });
  }

  #wireEvents() {
    window.addEventListener('resize', () => this.#resize());
    this.canvas.addEventListener('click', () => {
      if (this.focusId) this.callbacks.onTargetActivated?.(this.focusId);
    });
  }

  #resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
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
    let targetPosition = this.lookTarget && this.targets.has(this.lookTarget) ? this.targets.get(this.lookTarget).position : this.getViewerWorldPosition();
    const worldPos = new THREE.Vector3();
    this.headPivot.getWorldPosition(worldPos);
    const desired = new THREE.Matrix4().lookAt(worldPos, targetPosition, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(desired);
    this.headPivot.quaternion.slerp(q, Math.min(1, delta * 4.8));
  }

  #updateArm(delta) {
    const armRoot = this.rightArm.root;
    let desired = new THREE.Quaternion();
    if (this.pointTarget && this.targets.has(this.pointTarget)) {
      const worldShoulder = new THREE.Vector3();
      armRoot.getWorldPosition(worldShoulder);
      const directionWorld = this.targets.get(this.pointTarget).position.clone().sub(worldShoulder).normalize();
      const parentInverse = this.body.getWorldQuaternion(new THREE.Quaternion()).invert();
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
    const hit = this.raycaster.intersectObjects([...this.targets.values()].map(t => t.mesh), false)[0];
    const nextId = hit?.object?.userData?.targetId ?? null;
    if (nextId !== this.focusId) {
      this.focusId = nextId;
      this.callbacks.onFocusChanged?.(nextId, this.getSceneContext());
    }
  }

  getViewerWorldPosition() {
    if (this.renderer.xr.isPresenting) return this.renderer.xr.getCamera(this.camera).getWorldPosition(new THREE.Vector3());
    return this.camera.getWorldPosition(new THREE.Vector3());
  }

  getSceneContext() {
    const viewer = this.getViewerWorldPosition();
    return {
      gazeTarget: this.focusId,
      visibleTargets: [...this.targets.values()].map(target => ({ id: target.id, label: target.label, distance: Number(viewer.distanceTo(target.position).toFixed(2)) })),
      task: { name: 'service_device', step: 'identify_reset_control' },
    };
  }

  setState(state) {
    this.avatarState = state;
    this.callbacks.onStateChanged?.(state);
  }

  async executeTool(name, args = {}) {
    const id = args.targetId;
    if (id && !this.targets.has(id)) return { ok: false, error: `Unknown targetId: ${id}` };
    this.callbacks.onTool?.(name, args);
    switch (name) {
      case 'look_at':
        this.lookTarget = id;
        this.setState('looking');
        setTimeout(() => this.setState('idle'), 900);
        return { ok: true, targetId: id };
      case 'point_at':
        this.lookTarget = id;
        this.pointTarget = id;
        this.setState('pointing');
        setTimeout(() => { this.pointTarget = null; this.setState('idle'); }, 2800);
        return { ok: true, targetId: id };
      case 'highlight':
        this.highlight(id, Number(args.seconds ?? 3));
        return { ok: true, targetId: id };
      case 'move_near':
        await this.moveNear(id);
        return { ok: true, targetId: id };
      default:
        return { ok: false, error: `Tool not allowed: ${name}` };
    }
  }

  highlight(id, seconds = 3) {
    const target = this.targets.get(id);
    if (!target) return;
    const mat = target.material;
    if (mat.emissive) { mat.emissive.set(0x25c6ff); mat.emissiveIntensity = 1.8; }
    clearTimeout(this.highlightTimeouts.get(id));
    this.highlightTimeouts.set(id, setTimeout(() => {
      if (mat.emissive) mat.emissive.copy(target.originalEmissive);
      mat.emissiveIntensity = target.originalIntensity;
    }, Math.max(250, seconds * 1000)));
  }

  moveNear(id) {
    const target = this.targets.get(id);
    if (!target) return Promise.resolve();
    this.setState('moving');
    const destination = target.position.clone();
    destination.x -= 0.9;
    destination.z += 0.3;
    destination.y = 0;
    return new Promise(resolve => {
      const start = this.avatar.position.clone();
      const began = performance.now();
      const duration = 1200;
      const tick = now => {
        const t = Math.min(1, (now - began) / duration);
        const eased = t * t * (3 - 2 * t);
        this.avatar.position.lerpVectors(start, destination, eased);
        if (t < 1) requestAnimationFrame(tick);
        else { this.setState('idle'); resolve(); }
      };
      requestAnimationFrame(tick);
    });
  }

  async enterXR() {
    if (!navigator.xr) throw new Error('WebXR is not available in this browser.');
    const arSupported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
    const mode = arSupported ? 'immersive-ar' : 'immersive-vr';
    const options = arSupported
      ? { optionalFeatures: ['local-floor', 'dom-overlay', 'hand-tracking'], domOverlay: { root: document.body } }
      : { optionalFeatures: ['local-floor', 'hand-tracking'] };
    const session = await navigator.xr.requestSession(mode, options);
    this.isXR = true;
    if (arSupported) { this.scene.background = null; this.scene.fog = null; this.environmentGroup.visible = false; }
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
