import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './track.js';
import { gltfLoader, normalizeVehicle } from './cars.js';

const KENNEY_SCALE = 1.8; // kit is toy-scale (~2.5m sedans)
const KENNEY = ['sedan', 'taxi', 'suv', 'suv-luxury', 'van', 'truck', 'delivery', 'garbage-truck', 'ambulance', 'sedan-sports', 'hatchback-sports', 'firetruck'];
const HEAD = [4, 3.8, 3.2], TAIL = [2.2, 0.04, 0.02];
const DELIVERY = [0xf27a1a, 0xe23744, 0x2fa84f, 0xf2c200, 0x1f6fd0];

// Circuit (one-way) traffic for the Tokyo loop.
const LOOP_LANES = [-6.75, -2.25, 2.25, 6.75], LOOP_SPEED = [15, 19, 23, 27];
const LOOP_SLOW = ['truck', 'delivery', 'garbage-truck', 'van', 'sedan', 'firetruck'];
const LOOP_FAST = ['sedan', 'sedan', 'taxi', 'taxi', 'suv', 'suv-luxury', 'van', 'sedan-sports', 'hatchback-sports', 'ambulance'];
// Two-way Indian roads: per direction a kerb scooter lane, a slow lane and a fast lane (left-hand traffic).
const ROAD_LANES = [{ lat: 7.9, speed: 12, kinds: ['scooter'], perKm: 4 }, { lat: 6.2, speed: 13, kinds: ['auto', 'bus', 'truck', 'delivery'], perKm: 3.5 },
  { lat: 2.25, speed: 19, kinds: ['sedan', 'suv', 'hatch', 'van', 'auto'], perKm: 3 }];
const KIND_MODELS = { sedan: ['sedan'], suv: ['suv', 'suv-luxury'], hatch: ['hatchback-sports', 'sedan-sports'], van: ['van'], truck: ['truck', 'garbage-truck'], delivery: ['delivery'], auto: ['auto'], scooter: ['scooter'], bus: ['bus'] };

function colored(g, c) {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const box = (sx, sy, sz, x, y, z, c) => colored(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), c);
const wheel = (r, w, x, y, z, c = [0.05, 0.05, 0.05]) => colored(new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2).translate(x, y, z), c);
const ball = (r, x, y, z, c) => colored(new THREE.SphereGeometry(r, 10, 8).translate(x, y, z), c);

function lightsGeo(d) {
  const y = Math.min(1.05, 0.3 * d.h + 0.25), out = [];
  for (const s of [-1, 1]) {
    out.push(box(0.36, 0.13, 0.06, s * (d.w / 2 - 0.35), y, d.maxZ + 0.02, HEAD));
    out.push(box(0.4, 0.12, 0.06, s * (d.w / 2 - 0.3), y, d.minZ - 0.02, TAIL));
  }
  return mergeGeometries(out);
}

function bake(gltf) {
  const wheelNames = ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'];
  const { norm, dims } = normalizeVehicle(gltf.scene, wheelNames, KENNEY_SCALE);
  norm.updateMatrixWorld(true);
  const geos = [];
  let mat = null;
  norm.traverse((o) => {
    if (!o.isMesh) return;
    mat ||= o.material;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    geos.push(g.index ? g.toNonIndexed() : g);
  });
  const geo = mergeGeometries(geos);
  return { geo, mat, dims, lights: lightsGeo(dims) };
}

export async function loadTrafficModels() {
  const loader = gltfLoader();
  const out = {};
  await Promise.all(KENNEY.map(async (t) => { out[t] = bake(await loader.loadAsync(`models/kenney/${t}.glb`)); }));
  return out;
}

// Procedural Indian vehicles (vertex-coloured; white parts take the per-vehicle instance colour).
function indianModels(T) {
  const W = [1, 1, 1], DARK = [0.06, 0.06, 0.07], GLASS = [0.08, 0.1, 0.13], SKIN = [0.5, 0.36, 0.26];
  const [roof, body, stripe] = T.autoColors || [[0.95, 0.76, 0.05], [0.07, 0.07, 0.07], [0.12, 0.48, 0.23]];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
  const auto = {
    geo: mergeGeometries([
      box(1.3, 0.55, 2.3, 0, 0.62, -0.15, body), box(0.9, 0.9, 0.45, 0, 0.95, 1.0, body), box(1.32, 0.08, 2.32, 0, 0.93, -0.15, stripe),
      box(1.38, 0.08, 2.0, 0, 1.78, -0.2, roof), box(1.38, 0.95, 0.08, 0, 1.3, -1.2, roof),
      box(0.05, 0.42, 1.1, 0.68, 1.55, -0.6, roof), box(0.05, 0.42, 1.1, -0.68, 1.55, -0.6, roof),
      box(0.06, 0.9, 0.06, 0.6, 1.3, 0.78, DARK), box(0.06, 0.9, 0.06, -0.6, 1.3, 0.78, DARK), box(1.0, 0.62, 0.04, 0, 1.38, 0.98, GLASS),
      box(0.4, 0.55, 0.3, 0, 1.2, 0.45, [0.25, 0.3, 0.45]), ball(0.13, 0, 1.62, 0.45, SKIN),
      wheel(0.22, 0.16, 0, 0.22, 1.05), wheel(0.22, 0.16, 0.6, 0.22, -0.85), wheel(0.22, 0.16, -0.6, 0.22, -0.85),
    ]),
    lights: mergeGeometries([box(0.2, 0.14, 0.05, 0, 1.08, 1.24, HEAD), box(0.14, 0.1, 0.04, 0.5, 0.75, -1.28, TAIL), box(0.14, 0.1, 0.04, -0.5, 0.75, -1.28, TAIL)]),
    dims: { w: 1.4, l: 2.8 }, mat, tint: false,
  };
  const scooter = {
    geo: mergeGeometries([
      box(0.32, 0.4, 1.25, 0, 0.55, 0, [0.85, 0.87, 0.9]), box(0.48, 0.75, 0.14, 0, 0.72, 0.6, [0.85, 0.87, 0.9]), box(0.6, 0.05, 0.05, 0, 1.08, 0.58, DARK),
      box(0.3, 0.35, 0.55, 0, 0.88, -0.05, [0.12, 0.14, 0.2]), box(0.42, 0.58, 0.28, 0, 1.33, -0.08, W), ball(0.16, 0, 1.78, -0.04, DARK),
      box(0.1, 0.42, 0.1, 0.22, 1.25, 0.25, W), box(0.1, 0.42, 0.1, -0.22, 1.25, 0.25, W),
      box(0.52, 0.5, 0.46, 0, 1.24, -0.55, W),
      wheel(0.22, 0.1, 0, 0.22, 0.55), wheel(0.22, 0.1, 0, 0.22, -0.55),
    ]),
    lights: mergeGeometries([box(0.14, 0.1, 0.05, 0, 0.98, 0.69, HEAD), box(0.12, 0.08, 0.04, 0, 0.78, -0.66, TAIL)]),
    dims: { w: 0.7, l: 1.8 }, mat, tint: true, palette: DELIVERY,
  };
  const bus = {
    geo: mergeGeometries([
      box(2.55, 2.4, 11.5, 0, 1.65, 0, W), box(2.5, 0.2, 11.3, 0, 2.95, 0, [0.75, 0.75, 0.75]), box(2.3, 1.3, 0.06, 0, 2.0, 5.76, GLASS),
      box(2.6, 0.35, 0.3, 0, 0.55, 5.7, DARK), box(2.6, 0.35, 0.3, 0, 0.55, -5.7, DARK),
      wheel(0.5, 0.3, 1.1, 0.5, 3.8), wheel(0.5, 0.3, -1.1, 0.5, 3.8), wheel(0.5, 0.3, 1.1, 0.5, -3.6), wheel(0.5, 0.3, -1.1, 0.5, -3.6),
    ]),
    lights: mergeGeometries([box(2.6, 0.85, 10.2, 0, 2.15, -0.4, [1.6, 1.35, 0.85]), box(1.6, 0.3, 0.05, 0, 2.78, 5.79, [3.2, 1.6, 0.2]),
      box(0.35, 0.15, 0.05, 0.9, 0.95, 5.77, HEAD), box(0.35, 0.15, 0.05, -0.9, 0.95, 5.77, HEAD),
      box(0.3, 0.2, 0.05, 1.0, 1.0, -5.77, TAIL), box(0.3, 0.2, 0.05, -1.0, 1.0, -5.77, TAIL)]),
    dims: { w: 2.55, l: 11.5 }, mat, tint: true, palette: T.busColors || [0x2f8f3a],
  };
  return { auto, scooter, bus };
}

export class Traffic {
  constructor(scene, track, models, T) {
    this.track = track;
    this.enabled = true;
    this.closed = track.closed;
    const r = rng(4242);
    const L = track.length;
    this.cars = [];
    const plan = [];
    const all = { ...models, ...(T.traffic ? indianModels(T) : {}) };
    if (track.closed || !T.traffic) {
      LOOP_LANES.forEach((lat, li) => {
        const count = Math.round((li === 0 ? 8 : li === 3 ? 5 : 7) * (L / 4600));
        const pool = li === 0 ? LOOP_SLOW : LOOP_FAST;
        for (let i = 0; i < count; i++) {
          let type = pool[Math.floor(r() * pool.length)];
          if (type === 'firetruck' && r() < 0.6) type = 'truck';
          plan.push({ type, lat, dir: 1, speed: LOOP_SPEED[li], d0: 140 + ((i + r() * 0.5) / count) * (L - 300) });
        }
      });
    } else {
      const weights = T.traffic;
      for (const dir of [1, -1]) for (const lane of ROAD_LANES) {
        const kinds = lane.kinds.filter((k) => (weights[k] ?? 0) > 0);
        if (!kinds.length) continue;
        const total = kinds.reduce((s, k) => s + weights[k], 0);
        const count = Math.max(2, Math.round((L / 1000) * lane.perKm * (lane.kinds[0] === 'scooter' ? Math.min(1.4, weights.scooter / 5) : 1)));
        for (let i = 0; i < count; i++) {
          let x = r() * total, kind = kinds[0];
          for (const k of kinds) { x -= weights[k]; if (x <= 0) { kind = k; break; } }
          const opts = KIND_MODELS[kind];
          const type = opts[Math.floor(r() * opts.length)];
          plan.push({ type, lat: lane.lat * dir, dir, speed: lane.speed * (dir > 0 ? 1 : 1.04), d0: ((i + 0.15 + r() * 0.5) / count) * (L + 60) });
        }
      }
    }
    const byType = {};
    for (const p of plan) if (all[p.type]) (byType[p.type] ||= []).push(p);
    const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.meshes = [];
    const col = new THREE.Color();
    for (const type in byType) {
      const list = byType[type], m = all[type], n = list.length;
      let mat;
      if (m.tint !== undefined) mat = m.mat;
      else { mat = m.mat.clone(); mat.color.setRGB(0.62, 0.62, 0.68); mat.roughness = 0.45; mat.metalness = 0.25; mat.envMapIntensity = 0.9; }
      const mk = (geo, material) => {
        const im = new THREE.InstancedMesh(geo, material, n);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false;
        scene.add(im); this.meshes.push(im);
        return im;
      };
      const meshes = { body: mk(m.geo, mat), lights: mk(m.lights, lightMat) };
      list.forEach((p, i) => {
        if (m.tint) meshes.body.setColorAt(i, col.set(m.palette[Math.floor(r() * m.palette.length)]));
        else if (m.tint === false) meshes.body.setColorAt(i, col.setRGB(1, 1, 1));
        const dims = m.dims;
        this.cars.push({ ...p, meshes, idx: i, half: dims.l / 2, r: Math.min(1.3, (dims.w / 2) * 0.95), x: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, on: true });
      });
      if (meshes.body.instanceColor) meshes.body.instanceColor.needsUpdate = true;
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1); this._z = new THREE.Vector3(0, 0, 0);
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmp = {};
  }

  setEnabled(on) {
    this.enabled = on;
    for (const m of this.meshes) m.visible = on;
  }

  // t: seconds on the shared race clock
  update(t) {
    if (!this.enabled) return;
    const s = this._tmp, L = this.track.length;
    for (const c of this.cars) {
      let d;
      if (this.closed) d = c.d0 + c.speed * t;
      else {
        const span = L + 60;
        const u = (((c.d0 + c.speed * t) % span) + span) % span - 30;
        d = c.dir > 0 ? u : L - u;
      }
      c.on = this.closed || (d > 0 && d < L);
      this.track.sample(d, c.lat, s);
      const yaw = c.dir > 0 ? s.yaw : s.yaw + Math.PI;
      c.x = s.x; c.z = s.z; c.yaw = yaw; c.dist = s.dist;
      c.vx = s.tx * c.speed * c.dir; c.vz = s.tz * c.speed * c.dir;
      if (!c.on) { c.x = c.z = 1e6; }
      this._p.set(s.x, 0.02, s.z);
      this._q.setFromAxisAngle(this._up, yaw);
      this._m.compose(this._p, this._q, c.on ? this._s : this._z);
      for (const k in c.meshes) c.meshes[k].setMatrixAt(c.idx, this._m);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}
