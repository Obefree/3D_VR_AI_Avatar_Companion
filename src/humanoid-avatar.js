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

  function firstBoneChild(bone) {
    if (!bone) return null;
    return bone.children.find((child) => child?.isBone) || null;
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
      leftHand: findBone(allBones, ['hand_l', 'lefthand', 'mixamorigLeftHand']),
      rightUpperArm: findBone(allBones, ['upperarm_r', 'rightarm', 'rightupperarm', 'mixamorigRightArm']),
      rightLowerArm: findBone(allBones, ['lowerarm_r', 'rightforearm', 'rightlowerarm', 'mixamorigRightForeArm']),
      rightHand: findBone(allBones, ['hand_r', 'righthand', 'mixamorigRightHand']),
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
    if (kind === 'moving') clip = chooseClip(/walk|walking|run|jog/i);
    else if (kind === 'wave') clip = chooseClip(/wave|hello|greet/i);
    else clip = chooseClip(/idle|stand|breath/i) || state.clips[0];
    if (!clip || state.activeClip === clip.name) return;
    const previous = state.activeClip ? state.mixer.existingAction(state.clips.find((item) => item.name === state.activeClip)) : null;
    const next = state.mixer.clipAction(clip);
    next.reset().setLoop(state.THREE.LoopRepeat, Infinity).fadeIn(0.22).play();
    previous?.fadeOut?.(0.22);
    state.activeClip = clip.name;
  }

  function avatarWorldQuaternion() {
    return state.scene.avatar.getWorldQuaternion(new state.THREE.Quaternion());
  }

  function aimBone(bone, child, desiredWorldDirection, amount = 0.88) {
    if (!bone || !child || !bone.parent || !desiredWorldDirection?.lengthSq?.()) return false;
    const rest = bone.userData.novaRestQuaternion;
    if (!rest) return false;
    const parentInv = bone.parent.getWorldQuaternion(new state.THREE.Quaternion()).invert();
    const desiredLocal = desiredWorldDirection.clone().applyQuaternion(parentInv).normalize();
    const restDirection = child.position.clone().normalize().applyQuaternion(rest).normalize();
    if (restDirection.lengthSq() < 0.001) return false;
    const delta = new state.THREE.Quaternion().setFromUnitVectors(restDirection, desiredLocal);
    const target = delta.multiply(rest.clone());
    bone.quaternion.slerp(target, amount);
    return true;
  }

  function poseDirection(side, now, waving = false) {
    const x = side === 'left' ? -0.42 : 0.42;
    const local = new state.THREE.Vector3(x, 0.88, 0.18);
    if (waving) local.x += Math.sin(now * 0.014) * (side === 'left' ? -0.23 : 0.23);
    return local.normalize().applyQuaternion(avatarWorldQuaternion()).normalize();
  }

  function targetWorldPosition(id) {
    const target = id && state.scene.targets?.get(id);
    if (!target) return null;
    if (target.position?.isVector3) return target.position.clone();
    return target.mesh?.getWorldPosition?.(new state.THREE.Vector3()) || null;
  }

  function updateArms(now) {
    const pose = window.__novaEmbodiment?.getPose?.() || {};
    const rig = state.bones;
    const leftChild = rig.leftLowerArm || firstBoneChild(rig.leftUpperArm);
    const rightChild = rig.rightLowerArm || firstBoneChild(rig.rightUpperArm);

    if (pose.leftArm === 'raised' || pose.leftArm === 'waving') {
      aimBone(rig.leftUpperArm, leftChild, poseDirection('left', now, pose.leftArm === 'waving'));
    }

    const point = targetWorldPosition(state.scene.pointTarget);
    if (point && rig.rightUpperArm) {
      const shoulder = rig.rightUpperArm.getWorldPosition(new state.THREE.Vector3());
      aimBone(rig.rightUpperArm, rightChild, point.sub(shoulder).normalize(), 0.94);
    } else if (pose.rightArm === 'raised' || pose.rightArm === 'waving') {
      aimBone(rig.rightUpperArm, rightChild, poseDirection('right', now, pose.rightArm === 'waving'));
    }

    if (state.scene.avatarState === 'speaking' && !point && pose.leftArm !== 'raised' && pose.leftArm !== 'waving' && pose.rightArm !== 'raised' && pose.rightArm !== 'waving') {
      const local = new state.THREE.Vector3(0.34 + Math.sin(now * 0.004) * 0.08, 0.18 + Math.sin(now * 0.006) * 0.06, 0.9).normalize();
      aimBone(rig.rightUpperArm, rightChild, local.applyQuaternion(avatarWorldQuaternion()), 0.22);
    }
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
          id: 'nova',
          form: 'anthropomorphic humanoid woman',
          model: MODEL_NAME,
          modelReady: true,
          bodyParts,
          supportedEmbodiedActions: ['look_at','point_at','move_near','raise_hand','lower_hand','wave','step','turn_body','neutral_pose','create_object','delete_object','move_object','speak','wait','approach_user','face_user'],
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

  function frame(now) {
    requestAnimationFrame(frame);
    if (!state.ready || !state.scene) return;
    const delta = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000));
    state.lastFrame = now;
    const pose = window.__novaEmbodiment?.getPose?.() || {};
    const shouldWave = pose.leftArm === 'waving' || pose.rightArm === 'waving';
    playClip(state.scene.avatarState === 'moving' ? 'moving' : shouldWave ? 'wave' : 'idle');
    state.mixer?.update(delta);
    updateHead(now);
    updateArms(now);
    updateMorphs(now);
  }

  async function boot() {
    for (let i = 0; i < 160; i += 1) {
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
  };
  window.addEventListener('DOMContentLoaded', () => {
    void boot();
    requestAnimationFrame(frame);
  });
})();
