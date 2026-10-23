import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Player car roster. Meshes are matched by node or material name so new models only need a config entry.
export const CARS = {
  ferrari: {
    name: 'FERRARI 458 SPIDER', url: 'models/ferrari.glb', power: 1.0, grip: 1.0,
    stats: { speed: 0.78, accel: 0.8, handling: 0.88 },
    wheels: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'],
    paint: (o) => o.name === 'body', glass: (o) => o.name === 'glass',
    brake: (o) => o.name === 'brakes', head: (o) => o.name === 'lights',
  },
  concept: {
    name: 'CONCEPT HYPERCAR', url: 'models/carconcept.glb', power: 1.12, grip: 0.95,
    stats: { speed: 0.9, accel: 0.88, handling: 0.74 },
    wheels: ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR'],
    paint: (o) => /^Paint 1/.test(o.material?.name || ''), glass: (o) => o.material?.name === 'Glass',
    brake: (o) => o.material?.name === 'Brakelight', head: (o) => o.material?.name === 'Headlight',
  },
};
export const CAR_IDS = Object.keys(CARS);

const protos = {};
let aoTex = null, beamTex = null;
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, metalness: 0.3, roughness: 0.04, transparent: true, opacity: 0.72, envMapIntensity: 1.6 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 4 });
const flameOuter = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.75, 0.18), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
const flameInner = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.2, 4.2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });

export function gltfLoader() {
  const draco = new DRACOLoader();
  draco.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

// Rotates/offsets a loaded model so it faces +Z, sits on y=0 and is centred between its wheels.
export function normalizeVehicle(scene, wheelNames, scale = 1) {
  const norm = new THREE.Group();
  norm.add(scene);
  scene.scale.multiplyScalar(scale);
  norm.updateMatrixWorld(true);
  const wheels = () => wheelNames.map((n) => scene.getObjectByName(n)?.getWorldPosition(new THREE.Vector3()));
  let wp = wheels();
  const hasWheels = wp.every(Boolean);
  if (hasWheels) {
    const fwd = wp[0].clone().add(wp[1]).sub(wp[2]).sub(wp[3]);
    scene.rotation.y += -Math.atan2(fwd.x, fwd.z);
    norm.updateMatrixWorld(true);
    wp = wheels();
  }
  const box = new THREE.Box3().setFromObject(scene);
  let cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  if (hasWheels) {
    const c = wp.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(0.25);
    cx = c.x; cz = c.z;
  }
  let groundY = box.min.y;
  if (hasWheels) {
    groundY = Infinity;
    for (const n of wheelNames) groundY = Math.min(groundY, new THREE.Box3().setFromObject(scene.getObjectByName(n), true).min.y);
  }
  scene.position.x -= cx; scene.position.z -= cz; scene.position.y -= groundY;
  norm.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(scene);
  return { norm, dims: { w: b.max.x - b.min.x, h: b.max.y, minZ: b.min.z, maxZ: b.max.z, l: b.max.z - b.min.z } };
}

// Merges a car's meshes by material (body and each wheel separately) to cut draw calls ~3x.
function bakeCar(norm, cfg) {
  norm.updateMatrixWorld(true);
  const wheels = cfg.wheels.map((n) => norm.getObjectByName(n));
  const groups = new Map();
  const meshes = [];
  norm.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    let container = norm;
    for (let p = o.parent; p; p = p.parent) if (wheels.includes(p)) { container = p; break; }
    const role = cfg.paint(o) ? 'paint' : cfg.glass(o) ? 'glass' : cfg.brake(o) ? 'brake' : cfg.head(o) ? 'head' : 'other';
    const g = o.geometry;
    const sig = Object.keys(g.attributes).sort().join() + (g.index ? '|i' : '|n') + (g.morphAttributes && Object.keys(g.morphAttributes).length ? '|m' : '');
    const key = container.uuid + role + o.material.uuid + sig;
    o.userData.role = role;
    if (!groups.has(key)) groups.set(key, { container, role, material: o.material, list: [] });
    groups.get(key).list.push(o);
  }
  const inv = new THREE.Matrix4(), m = new THREE.Matrix4();
  for (const { container, role, material, list } of groups.values()) {
    inv.copy(container.matrixWorld).invert();
    const geos = list.map((o) => o.geometry.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
    const merged = list.length > 1 ? mergeGeometries(geos) : geos[0];
    if (!merged) continue;
    for (const o of list) {
      for (const c of [...o.children]) o.parent.attach(c); // keep subtrees (e.g. wheels parented to a body mesh)
      o.removeFromParent();
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = role; mesh.userData.role = role;
    container.add(mesh);
  }
}

export async function loadCarModels(onProgress) {
  const loader = gltfLoader();
  const progress = {};
  await Promise.all(CAR_IDS.map(async (id) => {
    const cfg = CARS[id];
    const gltf = await loader.loadAsync(cfg.url, (e) => {
      if (e.total) { progress[id] = e.loaded / e.total; onProgress?.(CAR_IDS.reduce((s, k) => s + (progress[k] || 0), 0) / CAR_IDS.length); }
    });
    protos[id] = normalizeVehicle(gltf.scene, cfg.wheels);
    bakeCar(protos[id].norm, cfg);
  }));
  aoTex = await new THREE.TextureLoader().loadAsync('models/ferrari_ao.png');
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 256);
  const h = x.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.3, 'rgba(0,0,0,0)'); h.addColorStop(0.7, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = h; x.fillRect(0, 0, 64, 256);
  beamTex = new THREE.CanvasTexture(c);
}

function nameTag(name, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const x = c.getContext('2d');
  x.font = 'italic 900 52px "Arial Black", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 8; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.strokeText(name, 256, 50);
  x.fillStyle = '#fff'; x.fillText(name, 256, 50);
  x.fillStyle = color; x.fillRect(156, 84, 200, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(4.4, 0.82, 1);
  return s;
}

const _q = new THREE.Quaternion(), _x = new THREE.Vector3(1, 0, 0), _m = new THREE.Matrix4();

export class CarVisual {
  constructor(carId, color, { police = false, name = null, beam = true } = {}) {
    const id = CARS[carId] ? carId : 'ferrari';
    const cfg = CARS[id], proto = protos[id];
    this.carId = id;
    this.root = new THREE.Group();
    const model = proto.norm.clone(true);
    this.root.add(model);
    this.root.position.y = 0.02;
    this.police = police;
    const d = proto.dims;

    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: police ? 0x08090c : color, metalness: police ? 0.6 : 1.0, roughness: police ? 0.3 : 0.4,
      clearcoat: 1.0, clearcoatRoughness: 0.03,
    });
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff1508, emissiveIntensity: 1.5 });
    model.traverse((o) => {
      if (!o.isMesh) return;
      const role = o.userData.role;
      if (role === 'paint') o.material = this.bodyMat;
      else if (role === 'glass') o.material = glassMat;
      else if (role === 'brake') o.material = this.brakeMat;
      else if (role === 'head') o.material = headMat;
    });

    // Wheels spin about their own axle; front wheels get a steering pivot about the car's up axis.
    this.root.updateMatrixWorld(true);
    this.wheels = cfg.wheels.map((n, i) => {
      const w = model.getObjectByName(n);
      const box = new THREE.Box3().setFromObject(w, true);
      const radius = Math.max(0.25, (box.max.y - box.min.y) / 2);
      const axle = _x.clone().applyQuaternion(w.getWorldQuaternion(new THREE.Quaternion()));
      const entry = { obj: w, base: w.quaternion.clone(), sign: Math.sign(axle.x) || 1, radius };
      if (i < 2) {
        const parent = w.parent;
        const pivot = new THREE.Group();
        pivot.position.copy(w.position);
        parent.add(pivot);
        w.position.set(0, 0, 0);
        pivot.add(w);
        entry.pivot = pivot;
        entry.up = new THREE.Vector3(0, 1, 0).transformDirection(_m.copy(parent.matrixWorld).invert());
      }
      return entry;
    });
    this.spin = 0;

    const ao = new THREE.Mesh(new THREE.PlaneGeometry(d.w * 1.16, d.l * 1.15),
      new THREE.MeshBasicMaterial({ map: aoTex, blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, depthWrite: false }));
    ao.rotation.x = -Math.PI / 2; ao.position.set(0, 0.015, (d.minZ + d.maxZ) / 2); ao.renderOrder = 2;
    this.root.add(ao);

    this.flames = new THREE.Group();
    for (const sx of [-0.17, 0.17]) {
      const o = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.8, 10, 1, true), flameOuter);
      o.rotation.x = -Math.PI / 2; o.position.set(sx, 0.4, d.minZ - 0.4);
      const i = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.5, 8, 1, true), flameInner);
      i.rotation.x = -Math.PI / 2; i.position.set(sx, 0.4, d.minZ - 0.25);
      this.flames.add(o, i);
    }
    this.flames.visible = false;
    this.root.add(this.flames);

    if (beam) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 24),
        new THREE.MeshBasicMaterial({ map: beamTex, color: 0xfff1d8, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
      b.rotation.x = -Math.PI / 2; b.position.set(0, 0.04, d.maxZ + 12);
      this.root.add(b);
    }

    if (police) {
      const bar = new THREE.Group();
      bar.position.set(0, d.h + 0.01, (d.minZ + d.maxZ) / 2 - 0.15);
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 0.28), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
      this.redMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      this.blueMat = new THREE.MeshBasicMaterial({ color: 0x0033ff });
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.24), this.redMat); red.position.set(-0.29, 0.09, 0);
      const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.24), this.blueMat); blue.position.set(0.29, 0.09, 0);
      bar.add(base, red, blue);
      this.root.add(bar);
    }
    this.lightsOn = true;
    if (name) { this.tag = nameTag(name, color); this.tag.position.y = d.h + 1.35; this.root.add(this.tag); }
  }

  // s: {x,z,yaw,fwd,steer,braking,nitro}
  update(dt, s, t) {
    this.root.position.x = s.x; this.root.position.z = s.z;
    this.root.rotation.y = s.yaw;
    this.spin += (s.fwd ?? 0) * dt;
    const steer = -(s.steer || 0) * 0.5;
    for (const w of this.wheels) {
      w.obj.quaternion.copy(w.base).multiply(_q.setFromAxisAngle(_x, w.sign * this.spin / w.radius));
      if (w.pivot) w.pivot.quaternion.setFromAxisAngle(w.up, steer);
    }
    this.brakeMat.emissiveIntensity = s.braking ? 9 : 1.6;
    this.flames.visible = !!s.nitro;
    if (s.nitro) this.flames.scale.set(1, 1, 0.75 + Math.random() * 0.5);
    if (this.police) {
      const phase = Math.floor(t * 8) % 4;
      const on = this.lightsOn;
      this.redMat.color.setRGB(on && phase < 2 ? 12 : 0.15, 0, 0);
      this.blueMat.color.setRGB(0, on ? (phase >= 2 ? 1.5 : 0.02) : 0.01, on && phase >= 2 ? 14 : 0.15);
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.bodyMat.dispose(); this.brakeMat.dispose();
    if (this.tag) { this.tag.material.map.dispose(); this.tag.material.dispose(); }
  }
}
