(() => {
  const MODEL_URL = 'https://raw.githubusercontent.com/RSelaries/ateliers-gamejam/4b5adc49ca4fd1f6ed67b733159bfd0f9fe43d75/projets/walking_sim_starter/assets/city_pack/personnages/Animated%20Woman-nIItLV9nxS.glb';
  const MODEL_NAME = 'Quaternius Animated Woman';
  const TARGET_HEIGHT = 1.68;
  const state = {
    ready: false,
    loading: false,
    error: null,
    scene: null,
    THREE: null,
    root: null,
    mixer: null,
    clips: [],
    activeClip: null,
    bones: {},
    boneNames: [],
    morphMeshes: [],
    modelHeight: 0,
    contextWrapped: false,
    lastFrame: performance.now(),
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function findBone(allBones, candidates) {
    for (const candidate of candidates) {
      const exact = allBones.find((bone) => clean(bone.name) === clean(candidate));
      if (exact) return exact;
    }
    for (const candidate of candidates) {
      const needle = clean(candidate);
      const fuzzy = allBones.find((bone) => clean(bone.name).includes(needle));
      if (fuzzy) return fuzzy;
    }
    return null;
  }

  function resolveRig(root) {
    const allBones = [];
    root.traverse((obj) => { if (obj?.isBone) allBones.push(obj); });
    state.boneNames = allBones.map((bone) => bone.name);
    const rig = {
      head: findBone(allBones, ['head', 'mixamorigHead', 'Head']),
      neck: findBone(allBones, ['neck', 'mixamorigNeck', 'Neck']),
      spine: findBone(allBones, ['spine2', 'spine1', 'chest', 'upperchest', 'mixamorigSpine2', 'mixamorigSpine1']),
      leftUpperArm: findBone(allBones, ['upperarm_l', 'leftarm', 'leftupperarm', 'mixamorigLeftArm']),
      leftLowerArm: findBone(allBones, ['lowerarm_l', 'leftforearm', 'leftlowerarm', 'mixamorigLeftForeArm']),
      leftHand: findBone(allBones, ['wristl', 'hand_l', 'lefthand', 'lefthand', 'mixamorigLeftHand']),
      rightUpperArm: findBone(allBones, ['upperarm_r', 'rightarm', 'rightupperarm', 'mixamorigRightArm']),
      rightLowerArm: findBone(allBones, ['lowerarm_r', 'rightforearm', 'rightlowerarm', 'mixamorigRightForeArm']),
      rightHand: findBone(allBones, ['wristr', 'hand_r', 'righthand', 'mixamorigRightHand']),
    };
    for (const [key, bone] of Object.entries(rig)) {
      if (!bone) continue;
      bone.userData.novaRestQuaternion = bone.quaternion.clone();
      bone.userData.novaRestPosition = bone.position.clone();
    }
    state.bones = rig;
    return rig;
  }

  function chooseClip(regex) {
    return state.clips.find((clip) => regex.test(clip.name || '')) || null;
  }

  function playClip(kind) {
    if (!state.mixer || !state.clips.length) return;
    let clip = null;
    if (kind === 'wave') clip = chooseClip(/\|Wave$/i) || chooseClip(/wave/i);
    else if (kind === 'interact') clip = chooseClip(/\|Interact$/i) || chooseClip(/interact/i);
    else if (kind === 'moving') clip = chooseClip(/\|Walk$/i) || chooseClip(/walk/i) || chooseClip(/run/i);
    else clip = chooseClip(/\|Idle$/i) || chooseClip(/Idle_Neutral/i) || chooseClip(/idle/i) || state.clips[0];
    if (!clip) return;
    const previous = state.activeClip ? state.mixer.existingAction(state.clips.find((item) => item.name === state.activeClip)) : null;
    const next = state.mixer.clipAction(clip);
    if (state.activeClip === clip.name) {
      if (kind === 'wave' && !next.isRunning()) next.reset().play();
      return;
    }
    const loopOnce = kind === 'wave' || kind === 'interact';
    next.reset().setLoop(loopOnce ? state.THREE.LoopOnce : state.THREE.LoopRepeat, loopOnce ? 1 : Infinity).fadeIn(0.18).play();
    if (loopOnce) next.clampWhenFinished = true;
    previous?.fadeOut?.(0.18);
    state.activeClip = clip.name;
  }

  function avatarWorldQuaternion() {
    return state.scene.avatar.getWorldQuaternion(new state.THREE.Quaternion());
  }

  function targetWorldPosition(id) {
    const target = id && state.scene.targets?.get(id);
    if (!target) return null;
    if (target.position?.isVector3) return target.position.clone();
    return target.mesh?.getWorldPosition?.(new state.THREE.Vector3()) || null;
  }

  function updateHead(now) {
    const head = state.bones.head || state.bones.neck;
    if (!head || !head.parent) return;
    const rest = head.userData.novaRestQuaternion;
    if (!rest) return;
    const target = targetWorldPosition(state.scene.lookTarget) || state.scene.getViewerWorldPosition?.();
    if (!target) return;
    const headWorld = head.getWorldPosition(new state.THREE.Vector3());
    const directionWorld = target.clone().sub(headWorld).normalize();
    const avatarInv = avatarWorldQuaternion().invert();
    const local = directionWorld.applyQuaternion(avatarInv);
    const yaw = state.THREE.MathUtils.clamp(Math.atan2(local.x, Math.max(0.001, local.z)), -0.58, 0.58);
    const pitch = state.THREE.MathUtils.clamp(Math.asin(state.THREE.MathUtils.clamp(local.y, -1, 1)), -0.3, 0.3);
    const nod = state.scene.avatarState === 'speaking' ? Math.sin(now * 0.006) * 0.035 : 0;
    const offset = new state.THREE.Quaternion().setFromEuler(new state.THREE.Euler(-pitch + nod, yaw, 0, 'YXZ'));
    head.quaternion.slerp(rest.clone().multiply(offset), 0.14);
  }

  function updateMorphs(now) {
    const speaking = state.scene.avatarState === 'speaking';
    const value = speaking ? 0.16 + Math.abs(Math.sin(now * 0.024)) * 0.42 : 0;
    for (const mesh of state.morphMeshes) {
      const dict = mesh.morphTargetDictionary || {};
      for (const [name, index] of Object.entries(dict)) {
        if (/mouth|jaw|viseme|open/i.test(name)) mesh.morphTargetInfluences[index] = value;
      }
    }
  }

  function boneWorld(bone) {
    if (!bone) return null;
    const p = bone.getWorldPosition(new state.THREE.Vector3());
    return { x: Number(p.x.toFixed(3)), y: Number(p.y.toFixed(3)), z: Number(p.z.toFixed(3)) };
  }

  function stripLookOverlays(root) {
    if (!root) return;
    for (const name of ['LeelooLook', 'LeelooStraps']) {
      const item = root.getObjectByName(name);
      item?.parent?.remove(item);
    }
  }

  function tintFromName(name, salt = 0) {
    let hash = salt;
    for (const ch of String(name || 'actor')) hash = ((hash * 33) + ch.charCodeAt(0)) >>> 0;
    const h = hash % 360;
    const s = 0.42 + ((hash % 28) / 100);
    const l = 0.38 + (((hash >> 8) % 22) / 100);
    const color = new state.THREE.Color().setHSL(h / 360, s, l);
    return `#${color.getHexString()}`;
  }

  function tintMaterial(mat, hex) {
    if (!mat?.color) return mat;
    const copy = mat.userData?.novaTinted ? mat : mat.clone();
    copy.userData.novaTinted = true;
    if (!copy.userData.novaBaseHex) copy.userData.novaBaseHex = `#${mat.color.getHexString()}`;
    copy.color.set(hex);
    copy.needsUpdate = true;
    return copy;
  }

  function replaceMat(obj, index, hex) {
    if (Array.isArray(obj.material)) {
      const next = obj.material.slice();
      next[index] = tintMaterial(next[index], hex);
      obj.material = next;
      return;
    }
    obj.material = tintMaterial(obj.material, hex);
  }

  function matLuma(mat) {
    const hex = mat?.userData?.novaBaseHex;
    const color = hex ? new state.THREE.Color(hex) : mat?.color;
    if (!color) return 0.5;
    return (0.299 * color.r) + (0.587 * color.g) + (0.114 * color.b);
  }

  function lookOf(character) {
    const look = character?.appearance && typeof character.appearance === 'object' ? character.appearance : {};
    const blob = [character?.name, character?.role, character?.species, look.notes].join(' ').toLowerCase();
    const presets = [
      { test: /принц|prince/, hair: '#f0d48a', skin: '#f0c4a0', clothes: '#4a6eb5', height: 1.36 },
      { test: /лис|fox/, hair: '#e07028', skin: '#e8a070', clothes: '#7a3e14', height: 1.42 },
      { test: /роз|rose/, hair: '#e04560', skin: '#f3cfc0', clothes: '#f4ece4', height: 1.50 },
      { test: /корол|king/, hair: '#e4d4a8', skin: '#e8c4a0', clothes: '#9a7428', height: 1.80 },
      { test: /фонар|lamp/, hair: '#2c2c2a', skin: '#d4b090', clothes: '#3d4c5c', height: 1.60 },
      { test: /лётчик|пилот|pilot/, hair: '#3a3028', skin: '#d8b090', clothes: '#243038', height: 1.74 },
      { test: /мара|mara/, hair: '#1a1a1c', skin: '#e8b89a', clothes: '#2a3c52', height: 1.68 },
    ];
    const hit = presets.find((row) => row.test.test(blob));
    return {
      hair: look.hair || hit?.hair || tintFromName(character?.name, 11),
      skin: look.skin || hit?.skin || '#e8b89a',
      clothes: look.clothes || hit?.clothes || tintFromName(character?.name, 77),
      heightMeters: Number(look.heightMeters) || hit?.height || 1.68,
    };
  }

  function applyCharacter(character) {
    if (!state.root || !state.THREE) return false;
    stripLookOverlays(state.root);
    if (state.scene?.body) state.scene.body.visible = false;
    const look = lookOf(character);
    const slots = [];
    state.root.traverse((obj) => {
      if (!obj?.isMesh && !obj?.isSkinnedMesh) return;
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      list.forEach((mat, index) => {
        if (!mat?.color) return;
        slots.push({ obj, index, mat, name: `${obj.name} ${mat.name || ''}`.toLowerCase() });
      });
    });
    const painted = new Set();
    const paintNamed = (re, hex) => {
      for (const slot of slots) {
        const key = `${slot.obj.uuid}:${slot.index}`;
        if (painted.has(key) || !re.test(slot.name)) continue;
        replaceMat(slot.obj, slot.index, hex);
        painted.add(key);
      }
    };
    paintNamed(/hair|scalp|bang|brow/, look.hair);
    paintNamed(/cloth|dress|shirt|pant|outfit|strap|top|suit|coat|jacket/, look.clothes);
    const rest = slots.filter((slot) => !painted.has(`${slot.obj.uuid}:${slot.index}`));
    rest.sort((a, b) => matLuma(a.mat) - matLuma(b.mat));
    const n = rest.length;
    for (let i = 0; i < n; i += 1) {
      const hex = i < n / 3 ? look.hair : (i > (2 * n) / 3 ? look.skin : look.clothes);
      replaceMat(rest[i].obj, rest[i].index, hex);
    }
    const height = look.heightMeters;
    if (Number.isFinite(height) && height > 1.2 && height < 2.2 && state.baseUniform) {
      const factor = height / (state.fitHeight || TARGET_HEIGHT);
      state.root.scale.setScalar(state.baseUniform * factor);
      state.root.updateMatrixWorld?.(true);
    }
    return true;
  }

  function wrapContext() {
    if (state.contextWrapped || !state.scene?.getSceneContext) return;
    const original = state.scene.getSceneContext.bind(state.scene);
    state.scene.getSceneContext = () => {
      const context = original();
      if (!state.ready) return context;
      const avatar = context.avatar || {};
      const bodyParts = { ...(avatar.bodyParts || {}) };
      const head = boneWorld(state.bones.head || state.bones.neck);
      const leftHand = boneWorld(state.bones.leftHand || state.bones.leftLowerArm);
      const rightHand = boneWorld(state.bones.rightHand || state.bones.rightLowerArm);
      if (head) bodyParts.head = head;
      if (leftHand) bodyParts.leftHand = leftHand;
      if (rightHand) bodyParts.rightHand = rightHand;
      return {
        ...context,
        avatar: {
          ...avatar,
          id: state.scene.actorName || 'nova',
          name: state.scene.actorName || 'Nova',
          form: 'anthropomorphic humanoid woman',
          model: MODEL_NAME,
          modelReady: true,
          bodyParts,
          supportedEmbodiedActions: ['look_at','point_at','walk_to','pick_up','sit','stand','raise_hand','lower_hand','wave','step','turn_body','neutral_pose','create_object','delete_object','move_object'],
        },
      };
    };
    state.contextWrapped = true;
  }

  function publicState() {
    const pose = window.__novaEmbodiment?.getPose?.() || null;
    return {
      ready: state.ready,
      loading: state.loading,
      error: state.error,
      modelName: MODEL_NAME,
      modelUrl: MODEL_URL,
      license: 'CC0 / Public Domain',
      modelHeight: Number(state.modelHeight.toFixed(3)),
      modelVisible: Boolean(state.root?.visible),
      robotFallbackVisible: Boolean(state.scene?.body?.visible),
      animationNames: state.clips.map((clip) => clip.name),
      activeClip: state.activeClip,
      boneNames: [...state.boneNames],
      rig: Object.fromEntries(Object.entries(state.bones).map(([key, bone]) => [key, bone?.name || null])),
      pose,
      bodyParts: {
        head: boneWorld(state.bones.head || state.bones.neck),
        leftHand: boneWorld(state.bones.leftHand || state.bones.leftLowerArm),
        rightHand: boneWorld(state.bones.rightHand || state.bones.rightLowerArm),
      },
    };
  }

  async function loadHumanoid() {
    if (state.loading || state.ready) return state.ready;
    const scene = window.__novaScene;
    if (!scene?.scene || !scene?.avatar) return false;
    state.loading = true;
    state.scene = scene;
    try {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      state.THREE = THREE;
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(MODEL_URL);
      const root = gltf.scene;
      root.name = 'Nova_Humanoid_CC0';
      root.traverse((obj) => {
        if (obj?.isMesh || obj?.isSkinnedMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
          if (obj.morphTargetInfluences && obj.morphTargetDictionary) state.morphMeshes.push(obj);
        }
      });

      let box = new THREE.Box3().setFromObject(root);
      const initialSize = box.getSize(new THREE.Vector3());
      if (!Number.isFinite(initialSize.y) || initialSize.y <= 0.01) throw new Error('invalid_model_bounds');
      const scale = TARGET_HEIGHT / initialSize.y;
      root.scale.multiplyScalar(scale);
      state.baseUniform = scale;
      state.fitHeight = TARGET_HEIGHT;
      root.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      root.position.set(-center.x, -box.min.y, -center.z);
      root.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(root);
      state.modelHeight = box.getSize(new THREE.Vector3()).y;

      scene.avatar.add(root);
      state.root = root;
      state.clips = Array.isArray(gltf.animations) ? gltf.animations : [];
      state.mixer = state.clips.length ? new THREE.AnimationMixer(root) : null;
      resolveRig(root);
      playClip('idle');
      state.ready = true;
      state.error = null;
      if (scene.body) scene.body.visible = false;
      wrapContext();
      window.__novaHumanoidReady = true;
      document.documentElement.dataset.novaAvatar = 'humanoid';
      window.__novaHumanoid?.applyCharacter?.(window.__novaTvStage?.character || window.__novaCinematicDirector?.character);
      window.dispatchEvent(new CustomEvent('nova:humanoid-ready'));
      console.info('Nova humanoid ready', publicState());
      return true;
    } catch (error) {
      state.error = error?.message || String(error);
      state.ready = false;
      if (scene.body) scene.body.visible = true;
      console.error('Nova humanoid failed to load; robot fallback remains active:', error);
      return false;
    } finally {
      state.loading = false;
    }
  }

  function clipKindFromPose() {
    const pose = window.__novaEmbodiment?.getPose?.() || {};
    const waving = pose.leftArm === 'waving' || pose.rightArm === 'waving';
    if (state.scene.avatarState === 'moving') return 'moving';
    if (state.scene.avatarState === 'acting') return 'interact';
    if (waving) return 'wave';
    return 'idle';
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!state.ready || !state.scene) return;
    const delta = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000));
    state.lastFrame = now;
    const kind = clipKindFromPose();
    playClip(kind);
    state.mixer?.update(delta);
    if (kind !== 'moving') updateHead(now);
    updateMorphs(now);
  }

  async function boot() {
    for (let i = 0; i < 400; i += 1) {
      if (window.__novaScene?.scene && window.__novaEmbodimentReady) break;
      await wait(50);
    }
    await loadHumanoid();
  }

  window.__novaHumanoidReady = false;
  window.__novaHumanoid = {
    load: loadHumanoid,
    getState: publicState,
    getModelUrl: () => MODEL_URL,
    applyCharacter,
    play: playClip,
    getBone: (part) => state.bones[part] || null,
  };
  window.addEventListener('DOMContentLoaded', () => {
    void boot();
    requestAnimationFrame(frame);
  });
})();
