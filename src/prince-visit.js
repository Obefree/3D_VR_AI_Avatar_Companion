/**
 * Public Little Prince visit: far planets, corn-plane travel, role figures.
 * Original stylized models (mood of the tale, not book drawings / not Nova).
 */
import * as THREE from 'three';

const PLANETS = [
  { id: 'planet_home', role: 'Принц', roseRole: 'Роза', title: 'Планета принца', x: 0, y: 0, z: 0, r: 9.2, color: 0xc4a070, kind: 'home' },
  { id: 'planet_fox', role: 'Лис', title: 'Планета лиса', x: 92, y: 8, z: 38, r: 7.4, color: 0x6d8c3c, kind: 'fox' },
  { id: 'planet_king', role: 'Король', title: 'Планета короля', x: -86, y: 14, z: 42, r: 6.4, color: 0x8a7340, kind: 'king' },
  { id: 'planet_desert', role: 'Лётчик', title: 'Пустыня', x: 40, y: -6, z: 108, r: 11.2, color: 0xd2b896, kind: 'desert' },
  { id: 'planet_lamp', role: 'Фонарщик', title: 'Планета фонарщика', x: -58, y: 18, z: -88, r: 5.4, color: 0x3e4a5c, kind: 'lamp' },
];

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

const visit = {
  scene: null,
  root: null,
  plane: null,
  propeller: null,
  planets: [],
  figures: new Map(),
  mode: 'fly',
  landed: null,
  throttle: 0,
  sun: null,
  hint: '',
};

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: extra.roughness ?? 0.74,
    metalness: extra.metalness ?? 0.06,
    emissive: extra.emissive ?? 0x000000,
    emissiveIntensity: extra.emissiveIntensity ?? 0,
    transparent: extra.transparent ?? false,
    opacity: extra.opacity ?? 1,
    flatShading: extra.flat ?? false,
  });
}

function mesh(parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const item = new THREE.Mesh(geo, material);
  item.position.set(x, y, z);
  item.rotation.set(rx, ry, rz);
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function lookDir(scene) {
  const yaw = scene.walkYaw;
  const pitch = scene.walkPitch;
  const cy = Math.cos(pitch);
  return tmp2.set(-Math.sin(yaw) * cy, Math.sin(pitch), -Math.cos(yaw) * cy);
}

function applyLook(scene) {
  scene.camera.rotation.order = 'YXZ';
  scene.camera.rotation.y = scene.walkYaw;
  scene.camera.rotation.x = scene.walkPitch;
  scene.camera.rotation.z = 0;
}

function aimPlane(object, x, y, z) {
  object.lookAt(x, y, z);
  object.rotateY(-Math.PI / 2);
}

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = 'rgba(10, 16, 28, 0.0)';
  ctx.fillRect(0, 0, 512, 128);
  ctx.font = '600 42px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 232, 186, 0.92)';
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  }));
  sprite.scale.set(14, 3.5, 1);
  return sprite;
}

function buildStarfield() {
  const count = 1800;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const r = 180 + Math.random() * 520;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.55;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const gold = Math.random() > 0.72;
    colors[i * 3] = gold ? 1 : 0.78;
    colors[i * 3 + 1] = gold ? 0.86 : 0.88;
    colors[i * 3 + 2] = gold ? 0.55 : 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    size: 1.15,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    sizeAttenuation: true,
  }));
}

function human({ skin = 0xf0c4a0, hair = 0xf0d080, cloth = 0x4f6f8a, height = 1.6, crown = false, scarf = 0, helmet = false, lamp = false } = {}) {
  const g = new THREE.Group();
  const s = height / 1.62;
  g.scale.setScalar(s);
  const skinM = mat(skin, { roughness: 0.62 });
  const clothM = mat(cloth, { roughness: 0.7 });
  const hairM = mat(hair, { roughness: 0.55 });
  mesh(g, new THREE.CylinderGeometry(0.09, 0.12, 0.22, 8), clothM, 0.12, 0.12, 0.02);
  mesh(g, new THREE.CylinderGeometry(0.09, 0.12, 0.22, 8), clothM, -0.12, 0.12, 0.02);
  mesh(g, new THREE.SphereGeometry(0.11, 10, 8), mat(0x3a2a22), 0.12, 0.01, 0.04);
  mesh(g, new THREE.SphereGeometry(0.11, 10, 8), mat(0x3a2a22), -0.12, 0.01, 0.04);
  const torso = mesh(g, new THREE.CapsuleGeometry(0.2, 0.42, 6, 12), clothM, 0, 0.72, 0);
  torso.scale.set(1.05, 1, 0.72);
  mesh(g, new THREE.CapsuleGeometry(0.07, 0.34, 4, 8), clothM, 0.28, 0.7, 0);
  mesh(g, new THREE.CapsuleGeometry(0.07, 0.34, 4, 8), clothM, -0.28, 0.7, 0);
  const head = mesh(g, new THREE.SphereGeometry(0.18, 16, 12), skinM, 0, 1.22, 0);
  head.scale.set(1, 1.05, 0.92);
  const hairCap = mesh(g, new THREE.SphereGeometry(0.185, 14, 10), hairM, 0, 1.3, 0.01);
  hairCap.scale.set(1.05, 0.72, 1.02);
  mesh(g, new THREE.SphereGeometry(0.028, 8, 6), mat(0x1a1410), 0.06, 1.24, 0.15);
  mesh(g, new THREE.SphereGeometry(0.028, 8, 6), mat(0x1a1410), -0.06, 1.24, 0.15);
  if (scarf) {
    const band = mesh(g, new THREE.BoxGeometry(0.08, 0.04, 0.55), mat(scarf, { roughness: 0.5 }), 0.18, 1.04, 0.12, 0.2, 0.4, 0.3);
    band.name = 'scarf';
  }
  if (crown) {
    mesh(g, new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10), mat(0xd4b24a, { metalness: 0.55, roughness: 0.28, emissive: 0x5a3a00, emissiveIntensity: 0.15 }), 0, 1.44, 0);
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      mesh(g, new THREE.ConeGeometry(0.035, 0.12, 6), mat(0xe8d080, { metalness: 0.5 }), Math.cos(a) * 0.16, 1.52, Math.sin(a) * 0.16);
    }
  }
  if (helmet) {
    mesh(g, new THREE.SphereGeometry(0.2, 12, 10), mat(0x4a3324, { roughness: 0.45 }), 0, 1.28, 0).scale.set(1.05, 0.7, 1.1);
    mesh(g, new THREE.TorusGeometry(0.16, 0.025, 8, 16), mat(0x2a2a28, { metalness: 0.4 }), 0, 1.24, 0.02, Math.PI / 2, 0, 0);
  }
  if (lamp) {
    const light = mesh(g, new THREE.SphereGeometry(0.09, 10, 8), mat(0xffe6a8, { emissive: 0xffc45a, emissiveIntensity: 0.9, roughness: 0.3 }), 0.42, 0.95, 0.12);
    light.name = 'hand-lamp';
    mesh(g, new THREE.CylinderGeometry(0.02, 0.02, 0.28, 6), mat(0x2a2a28), 0.42, 0.78, 0.12);
  }
  g.userData.baseY = 0;
  return g;
}

function foxFigure() {
  const g = new THREE.Group();
  const fur = mat(0xd4782a, { roughness: 0.68 });
  const cream = mat(0xf3e2c4, { roughness: 0.7 });
  const body = mesh(g, new THREE.CapsuleGeometry(0.22, 0.42, 6, 10), fur, 0, 0.38, 0);
  body.rotation.z = Math.PI / 2;
  body.scale.set(1, 0.85, 0.9);
  mesh(g, new THREE.SphereGeometry(0.2, 12, 10), fur, 0.38, 0.5, 0);
  mesh(g, new THREE.SphereGeometry(0.12, 8, 8), cream, 0.48, 0.42, 0.08);
  mesh(g, new THREE.ConeGeometry(0.07, 0.16, 8), fur, 0.32, 0.68, 0.08, 0, 0, 0.4);
  mesh(g, new THREE.ConeGeometry(0.07, 0.16, 8), fur, 0.32, 0.68, -0.08, 0, 0, -0.4);
  mesh(g, new THREE.SphereGeometry(0.03, 8, 6), mat(0x1a1410), 0.52, 0.54, 0.08);
  mesh(g, new THREE.SphereGeometry(0.03, 8, 6), mat(0x1a1410), 0.52, 0.54, -0.08);
  const tail = mesh(g, new THREE.ConeGeometry(0.14, 0.7, 8), fur, -0.5, 0.48, 0, 0, 0, Math.PI / 2.4);
  tail.name = 'tail';
  mesh(g, new THREE.SphereGeometry(0.08, 8, 6), cream, -0.78, 0.55, 0);
  mesh(g, new THREE.CylinderGeometry(0.05, 0.06, 0.28, 6), fur, 0.16, 0.16, 0.12);
  mesh(g, new THREE.CylinderGeometry(0.05, 0.06, 0.28, 6), fur, 0.16, 0.16, -0.12);
  mesh(g, new THREE.CylinderGeometry(0.05, 0.06, 0.28, 6), fur, -0.16, 0.16, 0.12);
  mesh(g, new THREE.CylinderGeometry(0.05, 0.06, 0.28, 6), fur, -0.16, 0.16, -0.12);
  return g;
}

function roseFigure() {
  const g = new THREE.Group();
  const stem = mat(0x3d6b38, { roughness: 0.55 });
  mesh(g, new THREE.CylinderGeometry(0.04, 0.05, 1.15, 8), stem, 0, 0.58, 0);
  mesh(g, new THREE.SphereGeometry(0.18, 10, 8), stem, 0.16, 0.7, 0).scale.set(1.6, 0.12, 0.7);
  mesh(g, new THREE.SphereGeometry(0.16, 10, 8), stem, -0.14, 0.5, 0.06).scale.set(1.4, 0.1, 0.6);
  const petal = mat(0xe04560, { roughness: 0.45, emissive: 0x4a0010, emissiveIntensity: 0.12 });
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2;
    mesh(g, new THREE.SphereGeometry(0.16, 10, 8), petal, Math.cos(a) * 0.16, 1.22, Math.sin(a) * 0.16).scale.set(0.7, 1.1, 0.45);
  }
  mesh(g, new THREE.SphereGeometry(0.12, 10, 8), mat(0xffd0a8, { roughness: 0.5 }), 0, 1.22, 0.06);
  mesh(g, new THREE.SphereGeometry(0.02, 6, 6), mat(0x1a1410), 0.04, 1.24, 0.16);
  mesh(g, new THREE.SphereGeometry(0.02, 6, 6), mat(0x1a1410), -0.04, 1.24, 0.16);
  return g;
}

function buildCornPlane() {
  const g = new THREE.Group();
  const yellow = mat(0xe6c24a, { roughness: 0.48, metalness: 0.12 });
  const green = mat(0x3d6b38, { roughness: 0.55 });
  const dark = mat(0x2a2c30, { metalness: 0.35, roughness: 0.4 });
  const body = mesh(g, new THREE.CapsuleGeometry(0.42, 2.4, 8, 16), yellow, 0, 0, 0);
  body.rotation.z = Math.PI / 2;
  body.scale.set(1, 0.85, 1);
  mesh(g, new THREE.SphereGeometry(0.38, 12, 10), dark, 1.45, 0.02, 0);
  const prop = new THREE.Group();
  prop.name = 'propeller';
  prop.position.set(1.72, 0.02, 0);
  mesh(prop, new THREE.BoxGeometry(0.06, 1.55, 0.08), dark, 0, 0, 0);
  mesh(prop, new THREE.BoxGeometry(0.06, 0.08, 1.55), dark, 0, 0, 0);
  g.add(prop);
  const wing = mesh(g, new THREE.BoxGeometry(1.15, 0.07, 4.6), yellow, 0.15, 0.42, 0);
  wing.scale.set(1, 1, 1);
  mesh(g, new THREE.BoxGeometry(0.08, 0.42, 0.08), green, 0.2, 0.2, 1.4);
  mesh(g, new THREE.BoxGeometry(0.08, 0.42, 0.08), green, 0.2, 0.2, -1.4);
  mesh(g, new THREE.BoxGeometry(0.9, 0.05, 2.4), yellow, 0.1, -0.05, 0);
  mesh(g, new THREE.BoxGeometry(0.7, 0.06, 1.1), yellow, -1.35, 0.05, 0);
  mesh(g, new THREE.BoxGeometry(0.08, 0.7, 0.55), yellow, -1.55, 0.38, 0);
  mesh(g, new THREE.BoxGeometry(0.08, 0.18, 0.9), yellow, -1.55, 0.12, 0);
  mesh(g, new THREE.SphereGeometry(0.28, 10, 8), mat(0x88c4e8, { transparent: true, opacity: 0.35, roughness: 0.15 }), 0.55, 0.22, 0).scale.set(0.9, 0.7, 1.1);
  mesh(g, new THREE.SphereGeometry(0.12, 8, 6), dark, 0.3, -0.48, 0.42);
  mesh(g, new THREE.SphereGeometry(0.12, 8, 6), dark, 0.3, -0.48, -0.42);
  mesh(g, new THREE.SphereGeometry(0.1, 8, 6), dark, -1.1, -0.4, 0);
  mesh(g, new THREE.BoxGeometry(1.8, 0.12, 0.18), green, 0.1, 0.48, 0);
  g.scale.setScalar(1.05);
  return g;
}

function decoratePlanet(root, spec) {
  const { r, kind } = spec;
  if (kind === 'home') {
    mesh(root, new THREE.ConeGeometry(0.7, 1.6, 8), mat(0x8a5a40, { flat: true }), 2.2, r * 0.15, -1.4);
    mesh(root, new THREE.ConeGeometry(0.5, 1.2, 8), mat(0x7a4a38, { flat: true }), -2.6, r * 0.08, 1.1);
    mesh(root, new THREE.CylinderGeometry(0.18, 0.28, 1.4, 8), mat(0x4a3220), -1.4, 0.9, 2.2);
    mesh(root, new THREE.SphereGeometry(0.7, 10, 8), mat(0x3d6b38), -1.4, 1.7, 2.2);
  }
  if (kind === 'fox') {
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * Math.PI * 2;
      const rr = r * 0.55;
      mesh(root, new THREE.ConeGeometry(0.12, 0.7 + (i % 3) * 0.12, 6), mat(0xd4b56a), Math.cos(a) * rr, 0.35, Math.sin(a) * rr);
    }
  }
  if (kind === 'king') {
    mesh(root, new THREE.BoxGeometry(0.9, 1.1, 0.7), mat(0xc9a227, { metalness: 0.35, roughness: 0.4 }), 0, 0.7, 0.2);
    mesh(root, new THREE.BoxGeometry(1.2, 0.18, 0.9), mat(0x6a1020), 0, 1.28, 0.2);
  }
  if (kind === 'desert') {
    mesh(root, new THREE.SphereGeometry(2.2, 10, 8), mat(0xc4a070, { flat: true }), 3.2, -0.4, 1.4).scale.set(1.6, 0.35, 1.1);
    mesh(root, new THREE.SphereGeometry(1.8, 10, 8), mat(0xd8c49a, { flat: true }), -2.8, -0.2, -1.8).scale.set(1.4, 0.3, 1.2);
    mesh(root, new THREE.CylinderGeometry(0.35, 0.42, 1.1, 12), mat(0x5a6570), 1.2, 0.7, 0.4);
    const wreck = buildCornPlane();
    wreck.scale.setScalar(0.42);
    wreck.rotation.set(0.4, 0.8, -0.55);
    wreck.position.set(-3.4, 0.4, 2.2);
    wreck.traverse((obj) => {
      if (obj.isMesh && obj.material?.color) obj.material = obj.material.clone();
    });
    root.add(wreck);
  }
  if (kind === 'lamp') {
    const post = mesh(root, new THREE.CylinderGeometry(0.06, 0.08, 2.4, 8), mat(0x2a2c30), 0.4, 1.2, 0.2);
    const lamp = mesh(root, new THREE.SphereGeometry(0.22, 12, 10), mat(0xffe6a8, { emissive: 0xffc45a, emissiveIntensity: 1.1 }), 0.4, 2.35, 0.2);
    lamp.name = 'planet-lamp';
    post.userData.lamp = lamp;
  }
}

function terraceOf(planet) {
  return new THREE.Vector3(planet.x, planet.y + planet.r, planet.z);
}

function figureHome(planet, role) {
  const t = terraceOf(planet);
  if (role === 'Роза') return t.clone().add(new THREE.Vector3(1.1, 0, 0.4));
  if (role === 'Лис') return t.clone().add(new THREE.Vector3(0.6, 0, -0.5));
  return t.clone().add(new THREE.Vector3(0.15, 0, 0.35));
}

function registerPlanet(scene, spec, sphere) {
  const pos = sphere.getWorldPosition(new THREE.Vector3());
  scene.targets.set(spec.id, {
    id: spec.id,
    label: spec.title,
    mesh: sphere,
    material: sphere.material,
    pickMeshes: [sphere],
    position: pos,
    originalEmissive: sphere.material.emissive?.clone?.() ?? new THREE.Color(0),
    originalIntensity: sphere.material.emissiveIntensity ?? 0,
  });
}

function setFigureOpacity(group, opacity) {
  const show = opacity > 0.04;
  group.visible = show;
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of materials) {
      m.transparent = opacity < 0.98;
      m.opacity = opacity;
      m.depthWrite = opacity > 0.6;
    }
  });
}

function nearestPlanet(pos) {
  let best = null;
  let dist = Infinity;
  for (const p of visit.planets) {
    const d = pos.distanceTo(tmp.set(p.x, p.y, p.z));
    if (d < dist) {
      dist = d;
      best = p;
    }
  }
  return { planet: best, dist };
}

function faceCamera(group, cam) {
  const dx = cam.x - group.position.x;
  const dz = cam.z - group.position.z;
  if (Math.hypot(dx, dz) > 0.05) group.rotation.y = Math.atan2(dx, dz);
}

function hintEl(text) {
  visit.hint = text;
  const el = document.getElementById('prince-hint');
  if (el) el.textContent = text;
}

function currentRoleFromPos(cam) {
  const { planet, dist } = nearestPlanet(cam);
  if (!planet || dist > planet.r + 24) return '';
  if (planet.roseRole && visit.mode === 'walk') {
    const rose = visit.figures.get(planet.roseRole);
    if (rose && cam.distanceTo(rose.position) < 2.6) return planet.roseRole;
  }
  return planet.role;
}

function landOn(planet) {
  const scene = visit.scene;
  const top = terraceOf(planet);
  const figPos = figureHome(planet, planet.role);
  visit.mode = 'walk';
  visit.landed = planet;
  scene.lookFrozen = false;
  const away = new THREE.Vector3(figPos.x - top.x, 0, figPos.z - top.z);
  if (away.lengthSq() < 0.04) away.set(0, 0, 1);
  else away.normalize();
  scene.camera.position.set(figPos.x + away.x * 3.6, top.y + 1.62, figPos.z + away.z * 3.6);
  const dx = scene.camera.position.x - top.x;
  const dz = scene.camera.position.z - top.z;
  const h = Math.hypot(dx, dz);
  const lim = planet.r * 0.68;
  if (h > lim) {
    scene.camera.position.x = top.x + (dx / h) * lim;
    scene.camera.position.z = top.z + (dz / h) * lim;
  }
  scene.walkYaw = Math.atan2(scene.camera.position.x - figPos.x, scene.camera.position.z - figPos.z);
  scene.walkPitch = -0.18;
  scene.camera.fov = 64;
  scene.camera.updateProjectionMatrix();
  applyLook(scene);
  visit.plane.visible = true;
  visit.plane.scale.setScalar(0.62);
  visit.plane.position.set(top.x - away.x * 4.2, top.y + 0.62, top.z - away.z * 4.2);
  aimPlane(
    visit.plane,
    visit.plane.position.x + away.x * 8,
    visit.plane.position.y,
    visit.plane.position.z + away.z * 8,
  );
  hintEl(`E — взлететь. Подойди к герою и скажи.`);
}

function takeOff() {
  const scene = visit.scene;
  const planet = visit.landed;
  visit.mode = 'fly';
  visit.landed = null;
  scene.lookFrozen = false;
  const lift = planet ? terraceOf(planet).add(new THREE.Vector3(0, 8, planet.r + 6)) : scene.camera.position.clone().add(new THREE.Vector3(0, 8, 0));
  scene.camera.position.copy(lift);
  scene.walkPitch = 0.08;
  scene.camera.fov = 58;
  scene.camera.updateProjectionMatrix();
  visit.plane.scale.setScalar(1.05);
  hintEl('Кукурузник. WASD — лететь, мышь — смотреть, пробел/Shift — высота, E — сесть.');
}

function toggleLand() {
  if (visit.mode === 'walk') {
    takeOff();
    return;
  }
  const cam = visit.scene.camera.position;
  const { planet, dist } = nearestPlanet(cam);
  if (planet && dist < planet.r + 10) landOn(planet);
  else hintEl('Подлети ближе к планете, затем нажми E.');
}

function tickFly(delta) {
  const scene = visit.scene;
  const forward = (scene.walkKeys.has('w') ? 1 : 0) - (scene.walkKeys.has('s') ? 1 : 0);
  const strafe = (scene.walkKeys.has('d') ? 1 : 0) - (scene.walkKeys.has('a') ? 1 : 0);
  const lift = (scene.walkKeys.has('up') ? 1 : 0) - (scene.walkKeys.has('down') ? 1 : 0);
  const want = forward !== 0 || strafe !== 0 ? 1 : 0.22;
  visit.throttle = THREE.MathUtils.lerp(visit.throttle, want, 1 - Math.exp(-delta * 3));
  const dir = lookDir(scene);
  const speed = 26 * visit.throttle;
  const right = tmp.set(dir.z, 0, -dir.x).normalize();
  scene.camera.position.addScaledVector(dir, speed * forward * delta);
  scene.camera.position.addScaledVector(right, 14 * strafe * delta);
  scene.camera.position.y += 16 * lift * delta;
  const { planet, dist } = nearestPlanet(scene.camera.position);
  if (planet && dist < planet.r + 2.2) {
    const n = scene.camera.position.clone().sub(new THREE.Vector3(planet.x, planet.y, planet.z)).normalize();
    scene.camera.position.set(planet.x, planet.y, planet.z).addScaledVector(n, planet.r + 2.4);
  }
  const cam = scene.camera.position;
  visit.plane.scale.setScalar(0.52);
  visit.plane.position.set(
    cam.x + dir.x * 4.2,
    cam.y + dir.y * 4.2 - 1.85,
    cam.z + dir.z * 4.2,
  );
  visit.plane.lookAt(cam.x + dir.x * 20, cam.y + dir.y * 20, cam.z + dir.z * 20);
  visit.plane.rotateY(-Math.PI / 2);
  if (visit.propeller) visit.propeller.rotation.x += delta * (12 + visit.throttle * 28);
  if (planet && dist < planet.r + 10) hintEl(`E — приземлиться: ${planet.title}`);
  else hintEl('Кукурузник. WASD лететь · пробел выше · Shift ниже · E сесть на планету');
}

function tickWalk(delta) {
  const scene = visit.scene;
  const planet = visit.landed;
  if (!planet) return;
  const forward = (scene.walkKeys.has('w') ? 1 : 0) - (scene.walkKeys.has('s') ? 1 : 0);
  const strafe = (scene.walkKeys.has('d') ? 1 : 0) - (scene.walkKeys.has('a') ? 1 : 0);
  const yaw = scene.walkYaw;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const speed = 4.2 * delta;
  scene.camera.position.x += (-sin * forward + cos * strafe) * speed;
  scene.camera.position.z += (-cos * forward - sin * strafe) * speed;
  const top = terraceOf(planet);
  const dx = scene.camera.position.x - top.x;
  const dz = scene.camera.position.z - top.z;
  const lim = planet.r * 0.72;
  const h = Math.hypot(dx, dz);
  if (h > lim) {
    scene.camera.position.x = top.x + (dx / h) * lim;
    scene.camera.position.z = top.z + (dz / h) * lim;
  }
  scene.camera.position.y = top.y + 1.55;
  if (visit.propeller) visit.propeller.rotation.x += delta * 1.2;
}

function tickFigures(time) {
  const cam = visit.scene.camera.position;
  const speaking = visit.scene.avatarState === 'speaking';
  for (const spec of visit.planets) {
    const center = tmp.set(spec.x, spec.y, spec.z);
    const dist = cam.distanceTo(center);
    const show = dist < spec.r + 34;
    const opacity = THREE.MathUtils.clamp((spec.r + 34 - dist) / 10, 0, 1);
    const roles = spec.roseRole ? [spec.role, spec.roseRole] : [spec.role];
    for (const role of roles) {
      const fig = visit.figures.get(role);
      if (!fig) continue;
      setFigureOpacity(fig, show ? opacity : 0);
      if (!fig.visible) continue;
      faceCamera(fig, cam);
      const bob = Math.sin(time * 0.002 + fig.position.x) * 0.03;
      const talk = speaking && currentRoleFromPos(cam) === role ? Math.abs(Math.sin(time * 0.012)) * 0.05 : 0;
      fig.position.y = fig.userData.restY + bob + talk;
      const scarf = fig.getObjectByName('scarf');
      if (scarf) scarf.rotation.y = Math.sin(time * 0.003) * 0.35;
      const tail = fig.getObjectByName('tail');
      if (tail) tail.rotation.y = Math.sin(time * 0.004) * 0.25;
    }
    if (spec.label) {
      spec.label.lookAt(cam);
      const d = cam.distanceTo(tmp.set(spec.x, spec.y + spec.r + 4.2, spec.z));
      const s = THREE.MathUtils.clamp(d * 0.055, 8, 36);
      spec.label.scale.set(s, s * 0.25, 1);
    }
  }
  if (visit.sun) visit.sun.rotation.y = time * 0.00008;
}

function tick(delta) {
  if (!visit.scene) return;
  if (visit.mode === 'fly') tickFly(delta);
  else tickWalk(delta);
  tickFigures(performance.now());
}

function placeFigures() {
  const makers = {
    Принц: () => human({ height: 1.42, hair: 0xf0d080, cloth: 0x4f7a6a, scarf: 0xf0c84b, skin: 0xf3c4a0 }),
    Роза: roseFigure,
    Лис: foxFigure,
    Король: () => human({ height: 1.78, hair: 0xd8c4a0, cloth: 0x6a1020, crown: true, skin: 0xe8c4a0 }),
    Лётчик: () => human({ height: 1.72, hair: 0x3a3028, cloth: 0x3a3530, helmet: true, skin: 0xd8b090 }),
    Фонарщик: () => human({ height: 1.56, hair: 0x2a2a28, cloth: 0x3a4555, lamp: true, skin: 0xd4b090 }),
  };
  for (const spec of visit.planets) {
    const roles = spec.roseRole ? [spec.role, spec.roseRole] : [spec.role];
    for (const role of roles) {
      const fig = makers[role]();
      const pos = figureHome(spec, role);
      fig.position.copy(pos);
      fig.userData.restY = pos.y;
      fig.userData.role = role;
      setFigureOpacity(fig, 0);
      visit.root.add(fig);
      visit.figures.set(role, fig);
    }
  }
}

export function attachPrinceVisit(scene) {
  if (!scene) return visit;
  const old = scene.scene.getObjectByName('prince_cosmos');
  if (old) old.parent?.remove(old);
  visit.scene = scene;
  visit.figures.clear();
  visit.planets = PLANETS.map((row) => ({ ...row }));
  visit.mode = 'fly';
  visit.landed = null;
  scene.enableSpaceTravel();
  scene.lookFrozen = false;
  const root = new THREE.Group();
  root.name = 'prince_cosmos';
  visit.root = root;
  scene.scene.add(root);
  root.add(buildStarfield());
  const sun = mesh(root, new THREE.SphereGeometry(6.5, 24, 16), mat(0xffe6a8, { emissive: 0xffc45a, emissiveIntensity: 1.2, roughness: 0.4 }), 70, 48, -40);
  visit.sun = sun;
  const sunLight = new THREE.PointLight(0xffe2b0, 40, 420, 1.4);
  sunLight.position.copy(sun.position);
  root.add(sunLight);

  for (const spec of visit.planets) {
    const wrap = new THREE.Group();
    wrap.position.set(spec.x, spec.y, spec.z);
    const sphere = mesh(wrap, new THREE.SphereGeometry(spec.r, 40, 28), mat(spec.color, { roughness: 0.88, flat: true }));
    sphere.userData.planetRadius = spec.r;
    sphere.userData.targetId = spec.id;
    decoratePlanet(wrap, spec);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(spec.r * 1.35, 0.035, 8, 64),
      mat(0xffe6a8, { emissive: 0x8a7030, emissiveIntensity: 0.25, transparent: true, opacity: 0.35 }),
    );
    ring.rotation.x = Math.PI / 2.35;
    wrap.add(ring);
    const label = makeLabel(spec.title);
    label.position.set(0, spec.r + 4.2, 0);
    wrap.add(label);
    spec.label = label;
    spec.wrap = wrap;
    spec.mesh = sphere;
    root.add(wrap);
    registerPlanet(scene, spec, sphere);
    if (spec.id === 'planet_home') {
      scene.targets.set('rose_on_home', {
        id: 'rose_on_home',
        label: 'Роза',
        mesh: sphere,
        material: sphere.material,
        pickMeshes: [sphere],
        position: sphere.position.clone(),
        originalEmissive: sphere.material.emissive.clone(),
        originalIntensity: 0,
      });
    }
  }
  placeFigures();
  visit.plane = buildCornPlane();
  visit.propeller = visit.plane.getObjectByName('propeller');
  root.add(visit.plane);
  scene.camera.position.set(8, 52, 132);
  scene.walkYaw = 0.05;
  scene.walkPitch = -0.34;
  applyLook(scene);
  scene.onTravelTick = (delta) => tick(delta);
  scene.onTravelAction = () => toggleLand();
  hintEl('Кликни — смотреть. Кукурузник: WASD, E — на планету.');
  window.__princeVisit = api;
  return visit;
}

export function princeCurrentRole() {
  if (!visit.scene) return '';
  return currentRoleFromPos(visit.scene.camera.position);
}

export function princeHint() {
  return visit.hint || '';
}

const api = { attach: attachPrinceVisit, currentRole: princeCurrentRole, hint: princeHint, visit };
window.__princeVisit = api;
