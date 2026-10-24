import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './track.js';
import { gltfLoader, normalizeVehicle } from './cars.js';
import { collide } from './physics.js';
import { FONTS } from './themes.js';

const KENNEY_SCALE = 1.8; // kit is toy-scale (~2.5m sedans)
const KENNEY = ['sedan', 'taxi', 'suv', 'suv-luxury', 'van', 'truck', 'delivery', 'garbage-truck', 'ambulance', 'sedan-sports', 'hatchback-sports', 'firetruck'];
// Real-world masses (kg) drive collision outcomes.
export const MASS = {
  sedan: 1250, taxi: 1250, suv: 2000, 'suv-luxury': 2200, van: 2100, truck: 2200, delivery: 2500, 'garbage-truck': 9000, ambulance: 3000,
  'sedan-sports': 1350, 'hatchback-sports': 1100, firetruck: 12000, auto: 450, scooter: 220, bike: 200, bus: 12000, lorry: 10000,
};
const HEAD = [4, 3.8, 3.2], TAIL = [1.4, 0.03, 0.01];
const DELIVERY = [0xf27a1a, 0xe23744, 0x2fa84f, 0xf2c200, 0x1f6fd0];
const RIDER = [0x2b3a55, 0x6b1f1f, 0x1f4a2b, 0x444444, 0x8a6a2a, 0xdddddd];
const PAINT = [0xe8e8e8, 0xb9bcc2, 0x1a1c20, 0x7a1f1f, 0x1d2b4f, 0x55595f, 0xc9b28a, 0x2a5a3a];

const LOOP_LANES = [-6.75, -2.25, 2.25, 6.75], LOOP_SPEED = [15, 19, 23, 27];
const LOOP_SLOW = ['truck', 'delivery', 'garbage-truck', 'van', 'sedan', 'firetruck'];
const LOOP_FAST = ['sedan', 'sedan', 'taxi', 'taxi', 'suv', 'suv-luxury', 'van', 'sedan-sports', 'hatchback-sports', 'ambulance'];
// Two-way Indian roads (left-hand traffic): per direction a kerb two-wheeler lane, a slow lane and a fast lane.
const ROAD_LANES = [{ lat: 7.9, speed: 12, kinds: ['scooter', 'bike'], perKm: 4.5, wobble: 0.35 },
  { lat: 6.0, speed: 13, kinds: ['auto', 'bus', 'lorry', 'delivery'], perKm: 3.5, wobble: 0.22 },
  { lat: 2.25, speed: 19, kinds: ['sedan', 'suv', 'hatch', 'van', 'auto'], perKm: 3, wobble: 0.08 }];
const KIND_MODELS = { sedan: ['sedan'], suv: ['suv', 'suv-luxury'], hatch: ['hatchback-sports', 'sedan-sports'], van: ['van'], truck: ['truck', 'garbage-truck'], delivery: ['delivery'],
  auto: ['auto'], scooter: ['scooter'], bike: ['bike'], bus: ['bus'], lorry: ['lorry'] };

// Bus liveries: operator lettering, colours and real route boards per city.
const LIVERY = {
  bmtc: { top: '#a6d36a', bottom: '#1f6e2e', stripe: '#f2c200', name: 'BMTC', local: 'ಬೆಂಗಳೂರು ಮಹಾನಗರ ಸಾರಿಗೆ ಸಂಸ್ಥೆ', lang: 'kn', routes: ['500D HEBBAL', '500DA KR PURAM', '500K KADUGODI', '290E MAJESTIC'] },
  vajra: { top: '#f4f6f8', bottom: '#1f4fbf', stripe: '#7fb2ff', name: 'VAJRA · BMTC', local: 'ವಜ್ರ', lang: 'kn', routes: ['V-500D HEBBAL', 'V-500CA SILK BOARD', 'KIA-9 AIRPORT'] },
  'ksrtc-ka': { top: '#e9e9e9', bottom: '#c4161c', stripe: '#f2a800', name: 'KSRTC', local: 'ಕರ್ನಾಟಕ ರಾಜ್ಯ ರಸ್ತೆ ಸಾರಿಗೆ ನಿಗಮ', lang: 'kn', routes: ['201 CHAMUNDI HILLS', '150 CBS', '303 KRS DAM'] },
  'ksrtc-kl': { top: '#f2d23a', bottom: '#c41c1c', stripe: '#1a1a1a', name: 'KSRTC', local: 'കെ.എസ്.ആർ.ടി.സി', lang: 'ml', routes: ['FAST KOZHIKODE', 'KALPETTA', 'THALASSERY', 'VYTTILA', 'KOVALAM', 'EAST FORT'] },
  private: { top: '#ffffff', bottom: '#2a7de1', stripe: '#ff3d7f', name: 'SREE KRISHNA', local: 'ശ്രീ കൃഷ്ണ', lang: 'ml', routes: ['KANNUR', 'IRITTY', 'ALUVA', 'FORT KOCHI', 'VIZHINJAM'] },
  mtc: { top: '#f0e6c8', bottom: '#8a1c1c', stripe: '#f2c200', name: 'MTC', local: 'மாநகர் போக்குவரத்துக் கழகம்', lang: 'ta', routes: ['23C BESANT NAGAR', '12B T.NAGAR', '5B BROADWAY'] },
  tgsrtc: { top: '#f4f6f8', bottom: '#1e8a3a', stripe: '#d62828', name: 'TGSRTC', local: 'తెలంగాణ ఆర్టీసీ', lang: 'te', routes: ['1Z SECUNDERABAD', '8A AFZALGUNJ', '49M KOTI'] },
};
const CITY_BUSES = { bengaluru: ['bmtc', 'bmtc', 'vajra'], mysuru: ['ksrtc-ka'], chennai: ['mtc'], hyderabad: ['tgsrtc'],
  wayanad: ['ksrtc-kl'], kannur: ['ksrtc-kl', 'private', 'private'], kochi: ['ksrtc-kl', 'private'], trivandrum: ['ksrtc-kl', 'private'] };
// Destination boards that make sense on each route.
const CITY_ROUTES = {
  wayanad: { 'ksrtc-kl': ['FAST KOZHIKODE', 'KALPETTA', 'SULTHAN BATHERY', 'MANANTHAVADY', 'THAMARASSERY'] },
  kannur: { 'ksrtc-kl': ['FAST KOZHIKODE', 'THALASSERY', 'KANNUR', 'MANGALURU'], private: ['KANNUR', 'THALASSERY', 'IRITTY', 'THALIPARAMBA'] },
  kochi: { 'ksrtc-kl': ['VYTTILA', 'ALUVA', 'THRISSUR', 'EDAPPALLY'], private: ['FORT KOCHI', 'ALUVA', 'KAKKANAD', 'VYTTILA'] },
  trivandrum: { 'ksrtc-kl': ['KOVALAM', 'EAST FORT', 'VIZHINJAM', 'THAMPANOOR'], private: ['VIZHINJAM', 'KOVALAM', 'POOVAR'] },
};

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
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

// Box whose six faces map to regions of a texture atlas: [right, left, top, bottom, front, back] as [u0,v0,u1,v1].
function atlasBox(sx, sy, sz, x, y, z, regions) {
  const g = new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) {
    const [u0, v0, u1, v1] = regions[Math.floor(k / 4)];
    uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
  }
  return g.toNonIndexed();
}

function lightsGeo(d) {
  const y = Math.min(1.05, 0.3 * d.h + 0.25), head = [], tail = [];
  for (const s of [-1, 1]) {
    head.push(box(0.36, 0.13, 0.06, s * (d.w / 2 - 0.35), y, d.maxZ + 0.02, HEAD));
    tail.push(box(0.4, 0.12, 0.06, s * (d.w / 2 - 0.3), y, d.minZ - 0.02, TAIL));
  }
  return { head: mergeGeometries(head), tail: mergeGeometries(tail) };
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
  const l = lightsGeo(dims);
  return { geo: mergeGeometries(geos), mat, dims, head: l.head, tail: l.tail };
}

export async function loadTrafficModels() {
  const loader = gltfLoader();
  const out = {};
  await Promise.all(KENNEY.map(async (t) => { out[t] = bake(await loader.loadAsync(`models/kenney/${t}.glb`)); }));
  return out;
}

function busAtlas(L) {
  const S = 1024;
  const [c, x] = canvas(S, S), [e, y] = canvas(S, S);
  y.fillStyle = '#000'; y.fillRect(0, 0, S, S);
  // side (0..320 px tall): windows band, livery, lettering
  const side = (oy) => {
    x.fillStyle = L.top; x.fillRect(0, oy, S, 320);
    x.fillStyle = L.bottom; x.fillRect(0, oy + 190, S, 130);
    x.fillStyle = L.stripe; x.fillRect(0, oy + 178, S, 14);
    x.fillStyle = '#1b2026'; x.fillRect(40, oy + 40, S - 80, 110);
    for (let i = 0; i < 9; i++) {
      const wx = 60 + i * 102;
      x.fillStyle = '#2c3640'; x.fillRect(wx, oy + 48, 92, 94);
      y.fillStyle = Math.random() < 0.8 ? '#ffe6b0' : '#cfe6ff'; y.fillRect(wx + 4, oy + 52, 84, 86);
      y.fillStyle = 'rgba(40,30,20,0.6)'; for (let p = 0; p < 2; p++) y.fillRect(wx + 12 + p * 38, oy + 92, 22, 46); // passengers
    }
    x.fillStyle = '#101418'; x.fillRect(S - 150, oy + 40, 70, 260); // door
    x.textBaseline = 'middle';
    x.fillStyle = '#ffffff'; x.font = '900 70px "Arial Black", Impact, sans-serif'; x.textAlign = 'left';
    x.fillText(L.name, 50, oy + 255);
    x.font = `700 34px ${FONTS[L.lang]}, Arial`; x.textAlign = 'right';
    x.fillStyle = L.stripe === '#1a1a1a' ? '#f2d23a' : '#ffffff';
    x.fillText(L.local, S - 170, oy + 255);
  };
  side(0);
  // front (0..320 x, 320..640 y) and back (320..640 x)
  for (const [ox, front] of [[0, true], [320, false]]) {
    x.fillStyle = L.bottom; x.fillRect(ox, 320, 320, 320);
    x.fillStyle = L.top; x.fillRect(ox, 320, 320, 140);
    x.fillStyle = '#11161c'; x.fillRect(ox + 20, front ? 380 : 400, 280, front ? 150 : 90);
    x.fillStyle = '#000'; x.fillRect(ox + 30, 330, 260, 40);
    const route = L.routes[Math.floor(Math.random() * L.routes.length)];
    y.fillStyle = '#ff9a1a'; y.font = '900 30px "Arial Black", Impact, sans-serif'; y.textAlign = 'center'; y.textBaseline = 'middle';
    const tw = y.measureText(route).width; y.save(); y.translate(ox + 160, 351); y.scale(Math.min(1, 240 / tw), 1); y.fillText(route, 0, 0); y.restore();
    if (front) { y.fillStyle = 'rgba(160,190,220,0.25)'; y.fillRect(ox + 20, 380, 280, 150); }
    x.fillStyle = '#ffffff'; x.font = '900 34px "Arial Black", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(L.name.split(' ')[0], ox + 160, 600);
  }
  x.fillStyle = '#8c9096'; x.fillRect(640, 320, 384, 320); // roof
  x.fillStyle = '#0d0d0d'; x.fillRect(0, 640, 64, 64);
  const ct = tex(c), et = tex(e);
  const R = { side: [0, 1 - 320 / S, 1, 1], front: [0, 1 - 640 / S, 320 / S, 1 - 320 / S], back: [320 / S, 1 - 640 / S, 640 / S, 1 - 320 / S],
    roof: [640 / S, 1 - 640 / S, 1, 1 - 320 / S], dark: [0, 1 - 704 / S, 64 / S, 1 - 640 / S] };
  return { map: ct, emissive: et, R };
}

function lorryAtlas() {
  const [c, x] = canvas(512, 512);
  // side: painted wooden body
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#d2442a'); g.addColorStop(1, '#8a3a1a');
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 8; i++) { x.fillStyle = 'rgba(40,20,10,0.5)'; x.fillRect(0, i * 32, 512, 3); }
  const cols = ['#f2c200', '#1f9a4a', '#1f6fd0', '#ffffff'];
  for (let i = 0; i < 16; i++) { x.fillStyle = cols[i % 4]; x.beginPath(); x.arc(16 + i * 32, 230, 9, 0, 7); x.fill(); }
  x.fillStyle = '#f2c200'; x.font = '900 40px "Arial Black", Impact, sans-serif'; x.textAlign = 'center'; x.fillText('NATIONAL PERMIT', 256, 130);
  // back: HORN OK PLEASE
  x.fillStyle = '#f2c200'; x.fillRect(0, 256, 256, 256);
  x.fillStyle = '#c4161c'; x.font = '900 46px "Arial Black", Impact, sans-serif'; x.fillText('HORN', 128, 330); x.fillText('OK', 128, 390);
  x.fillStyle = '#1f6fd0'; x.font = '900 40px "Arial Black", Impact, sans-serif'; x.fillText('PLEASE', 128, 450);
  x.strokeStyle = '#1a1a1a'; x.lineWidth = 8; x.strokeRect(8, 264, 240, 240);
  x.fillStyle = '#6a6a6a'; x.fillRect(256, 256, 256, 256); // tarp
  return { map: tex(c), R: { side: [0, 0.5, 1, 1], back: [0, 0, 0.5, 0.5], tarp: [0.5, 0, 1, 0.5] } };
}

// Procedural Indian vehicles (vertex-coloured; white parts take the per-vehicle instance colour).
function indianModels(T, mapId) {
  const W = [1, 1, 1], DARK = [0.06, 0.06, 0.07], GLASS = [0.08, 0.1, 0.13], SKIN = [0.5, 0.36, 0.26];
  const [roof, body, stripe] = T.autoColors || [[0.95, 0.76, 0.05], [0.07, 0.07, 0.07], [0.12, 0.48, 0.23]];
  const vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });
  const M = {};
  M.auto = {
    geo: mergeGeometries([
      box(1.3, 0.55, 2.3, 0, 0.62, -0.15, body), box(0.9, 0.9, 0.45, 0, 0.95, 1.0, body), box(1.32, 0.08, 2.32, 0, 0.93, -0.15, stripe),
      box(1.38, 0.08, 2.0, 0, 1.78, -0.2, roof), box(1.38, 0.95, 0.08, 0, 1.3, -1.2, roof),
      box(0.05, 0.42, 1.1, 0.68, 1.55, -0.6, roof), box(0.05, 0.42, 1.1, -0.68, 1.55, -0.6, roof),
      box(0.06, 0.9, 0.06, 0.6, 1.3, 0.78, DARK), box(0.06, 0.9, 0.06, -0.6, 1.3, 0.78, DARK), box(1.0, 0.62, 0.04, 0, 1.38, 0.98, GLASS),
      box(0.4, 0.55, 0.3, 0, 1.2, 0.45, [0.25, 0.3, 0.45]), ball(0.13, 0, 1.62, 0.45, SKIN), box(1.0, 0.45, 0.5, 0, 1.1, -0.55, [0.35, 0.3, 0.28]),
      wheel(0.22, 0.16, 0, 0.22, 1.05), wheel(0.22, 0.16, 0.6, 0.22, -0.85), wheel(0.22, 0.16, -0.6, 0.22, -0.85),
    ]),
    head: box(0.2, 0.14, 0.05, 0, 1.08, 1.24, HEAD), tail: mergeGeometries([box(0.14, 0.1, 0.04, 0.5, 0.75, -1.28, TAIL), box(0.14, 0.1, 0.04, -0.5, 0.75, -1.28, TAIL)]),
    dims: { w: 1.4, l: 2.8 }, mat: vmat, tint: false,
  };
  const twoWheeler = (withBox) => ({
    geo: mergeGeometries([
      box(0.32, 0.4, 1.25, 0, 0.55, 0, [0.85, 0.87, 0.9]), box(0.48, 0.75, 0.14, 0, 0.72, 0.6, [0.85, 0.87, 0.9]), box(0.6, 0.05, 0.05, 0, 1.08, 0.58, DARK),
      box(0.3, 0.35, 0.55, 0, 0.88, -0.05, [0.12, 0.14, 0.2]), box(0.42, 0.58, 0.28, 0, 1.33, -0.08, W), ball(0.16, 0, 1.78, -0.04, withBox ? DARK : [0.6, 0.1, 0.1]),
      box(0.1, 0.42, 0.1, 0.22, 1.25, 0.25, W), box(0.1, 0.42, 0.1, -0.22, 1.25, 0.25, W),
      ...(withBox ? [box(0.52, 0.5, 0.46, 0, 1.24, -0.55, W)] : [box(0.3, 0.32, 0.25, 0, 1.12, -0.42, [0.12, 0.14, 0.2])]),
      wheel(0.22, 0.1, 0, 0.22, 0.55), wheel(0.22, 0.1, 0, 0.22, -0.55),
    ]),
    head: box(0.14, 0.1, 0.05, 0, 0.98, 0.69, HEAD), tail: box(0.12, 0.08, 0.04, 0, 0.78, -0.66, TAIL),
    dims: { w: 0.7, l: 1.8 }, mat: vmat, tint: true, palette: withBox ? DELIVERY : RIDER,
  });
  M.scooter = twoWheeler(true);
  M.bike = twoWheeler(false);
  // City bus with operator livery atlas; several liveries become separate types (bus, bus2, ...).
  const liveries = CITY_BUSES[mapId] || ['bmtc'];
  [...new Set(liveries)].forEach((id, k) => {
    const A = busAtlas({ ...LIVERY[id], routes: CITY_ROUTES[mapId]?.[id] || LIVERY[id].routes });
    const mat = new THREE.MeshStandardMaterial({ map: A.map, emissiveMap: A.emissive, emissive: 0xffffff, emissiveIntensity: 1.3, roughness: 0.45, metalness: 0.2 });
    const R = A.R;
    M[k ? 'bus' + k : 'bus'] = {
      geo: mergeGeometries([atlasBox(2.55, 2.9, 11.5, 0, 1.85, 0, [R.side, R.side, R.roof, R.dark, R.front, R.back])]),
      extra: mergeGeometries([wheel(0.5, 0.3, 1.1, 0.5, 3.8), wheel(0.5, 0.3, -1.1, 0.5, 3.8), wheel(0.5, 0.3, 1.1, 0.5, -3.6), wheel(0.5, 0.3, -1.1, 0.5, -3.6),
        box(2.6, 0.3, 0.3, 0, 0.5, 5.75, [0.08, 0.08, 0.08]), box(2.6, 0.3, 0.3, 0, 0.5, -5.75, [0.08, 0.08, 0.08])]),
      head: mergeGeometries([box(0.35, 0.15, 0.05, 0.9, 0.95, 5.77, HEAD), box(0.35, 0.15, 0.05, -0.9, 0.95, 5.77, HEAD)]),
      tail: mergeGeometries([box(0.3, 0.2, 0.05, 1.0, 1.0, -5.77, TAIL), box(0.3, 0.2, 0.05, -1.0, 1.0, -5.77, TAIL)]),
      dims: { w: 2.55, l: 11.5 }, mat, tint: null, liveryOf: id, massKey: 'bus',
    };
  });
  // Painted goods lorry
  const LA = lorryAtlas();
  const lmat = new THREE.MeshStandardMaterial({ map: LA.map, roughness: 0.7 });
  M.lorry = {
    geo: atlasBox(2.5, 2.4, 5.4, 0, 2.15, -1.3, [LA.R.side, LA.R.side, LA.R.tarp, LA.R.tarp, LA.R.tarp, LA.R.back]),
    extra: mergeGeometries([box(2.3, 2.2, 1.9, 0, 1.75, 2.45, [0.95, 0.55, 0.1]), box(2.2, 0.8, 0.05, 0, 2.3, 3.41, GLASS), box(2.4, 0.4, 7.4, 0, 0.7, 0.2, [0.12, 0.12, 0.12]),
      wheel(0.5, 0.35, 1.05, 0.5, 2.6), wheel(0.5, 0.35, -1.05, 0.5, 2.6), wheel(0.5, 0.35, 1.05, 0.5, -2.4), wheel(0.5, 0.35, -1.05, 0.5, -2.4), wheel(0.5, 0.35, 1.05, 0.5, -3.5), wheel(0.5, 0.35, -1.05, 0.5, -3.5)]),
    head: mergeGeometries([box(0.3, 0.2, 0.05, 0.85, 1.1, 3.42, HEAD), box(0.3, 0.2, 0.05, -0.85, 1.1, 3.42, HEAD)]),
    tail: mergeGeometries([box(0.3, 0.2, 0.05, 1.0, 1.0, -4.02, TAIL), box(0.3, 0.2, 0.05, -1.0, 1.0, -4.02, TAIL)]),
    dims: { w: 2.5, l: 7.6 }, mat: lmat, tint: null,
  };
  return M;
}

function beamTexture() {
  const [c, x] = canvas(64, 128);
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.moveTo(24, 0); x.lineTo(40, 0); x.lineTo(64, 128); x.lineTo(0, 128); x.fill();
  return new THREE.CanvasTexture(c);
}

export class Traffic {
  constructor(scene, track, models, T, mapId, groundY) {
    this.track = track;
    this.enabled = true;
    this.closed = track.closed;
    this.groundY = groundY || ((x, z) => track.nearest(x, z).y);
    const r = rng(4242);
    const L = track.length;
    this.cars = [];
    const plan = [];
    const all = { ...models, ...(T.traffic ? indianModels(T, mapId) : {}) };
    const busTypes = Object.keys(all).filter((k) => k === 'bus' || /^bus\d$/.test(k));
    if (track.closed || !T.traffic) {
      LOOP_LANES.forEach((lat, li) => {
        const count = Math.round((li === 0 ? 8 : li === 3 ? 5 : 7) * (L / 4600));
        const pool = li === 0 ? LOOP_SLOW : LOOP_FAST;
        for (let i = 0; i < count; i++) {
          let type = pool[Math.floor(r() * pool.length)];
          if (type === 'firetruck' && r() < 0.6) type = 'truck';
          plan.push({ type, lat, dir: 1, speed: LOOP_SPEED[li], wobble: 0.05, d0: 140 + ((i + r() * 0.5) / count) * (L - 300) });
        }
      });
    } else {
      const weights = { ...T.traffic, bike: (T.traffic.scooter ?? 0) * 0.8, lorry: T.traffic.truck ?? 1 };
      for (const dir of [1, -1]) for (const lane of ROAD_LANES) {
        const kinds = lane.kinds.filter((k) => (weights[k] ?? 0) > 0);
        if (!kinds.length) continue;
        const total = kinds.reduce((s, k) => s + weights[k], 0);
        const count = Math.max(2, Math.round((L / 1000) * lane.perKm));
        for (let i = 0; i < count; i++) {
          let x = r() * total, kind = kinds[0];
          for (const k of kinds) { x -= weights[k]; if (x <= 0) { kind = k; break; } }
          let opts = KIND_MODELS[kind];
          if (kind === 'bus') opts = busTypes;
          const type = opts[Math.floor(r() * opts.length)];
          plan.push({ type, lat: lane.lat * dir, dir, speed: lane.speed * (dir > 0 ? 1 : 1.04), wobble: lane.wobble, d0: ((i + 0.15 + r() * 0.5) / count) * (L + 60), gap: (L + 60) / count });
        }
      }
    }
    const byType = {};
    for (const p of plan) if (all[p.type]) (byType[p.type] ||= []).push(p);
    const headMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const tailMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const extraMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    this.meshes = [];
    const col = new THREE.Color();
    let total = 0;
    for (const type in byType) {
      const list = byType[type], m = all[type], n = list.length;
      let mat = m.mat;
      if (m.tint === undefined) { // Kenney cars: glossy clear-coated paint, varied colours
        mat = new THREE.MeshPhysicalMaterial({ map: m.mat.map, roughness: 0.35, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 });
      }
      const mk = (geo, material) => {
        const im = new THREE.InstancedMesh(geo, material, n);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false;
        scene.add(im); this.meshes.push(im);
        return im;
      };
      const meshes = { body: mk(m.geo, mat), head: mk(m.head, headMat), tail: mk(m.tail, tailMat) };
      if (m.extra) meshes.extra = mk(m.extra, extraMat);
      list.forEach((p, i) => {
        if (m.tint === undefined) meshes.body.setColorAt(i, col.set(PAINT[Math.floor(r() * PAINT.length)]).lerp(new THREE.Color(1, 1, 1), 0.35));
        else if (m.tint) meshes.body.setColorAt(i, col.set(m.palette[Math.floor(r() * m.palette.length)]));
        else if (m.tint === false) meshes.body.setColorAt(i, col.setRGB(1, 1, 1));
        meshes.tail.setColorAt(i, col.setRGB(1, 1, 1));
        const dims = m.dims;
        this.cars.push({
          ...p, meshes, idx: i, gi: total + i, half: dims.l / 2, r: Math.min(1.3, (dims.w / 2) * 0.95), mass: MASS[m.massKey || type] || 1500,
          x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, on: true, ph: r() * 6.28, ph2: r() * 6.28, amp: Math.min(12, (p.gap || 40) * 0.25), knocked: null,
        });
      });
      total += n;
      for (const k in meshes) if (meshes[k].instanceColor) meshes[k].instanceColor.needsUpdate = true;
    }
    this.cars.sort((a, b) => a.gi - b.gi);
    // headlight beams on the road
    this.beams = new THREE.InstancedMesh(new THREE.PlaneGeometry(4, 16).rotateX(-Math.PI / 2).translate(0, 0.06, 10),
      new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xfff1d8, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }), this.cars.length);
    this.beams.frustumCulled = false;
    scene.add(this.beams); this.meshes.push(this.beams);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._s = new THREE.Vector3(1, 1, 1); this._z = new THREE.Vector3(0, 0, 0);
    this._tmp = {}; this._c = new THREE.Color();
    this.onKnock = null;
  }

  setEnabled(on) {
    this.enabled = on;
    for (const m of this.meshes) m.visible = on;
  }

  // Mass-based collision with a dynamic body (player car, cop). Light vehicles get launched.
  collideBody(body, mass, e = 0.25) {
    if (!this.enabled) return { impact: 0 };
    let best = { impact: 0 };
    for (const c of this.cars) {
      if (!c.on) continue;
      const heavy = c.mass >= 5000;
      const vx0 = c.vx, vz0 = c.vz;
      const imp = collide(body, c, 1 / mass, heavy ? 0 : 1 / c.mass, e);
      if (imp <= 0) continue;
      if (c.knocked) { const k = c.knocked; k.x = c.x; k.z = c.z; k.vx = c.vx; k.vz = c.vz; k.vy = Math.max(k.vy, Math.min(4, imp * 0.15)); k.rest = 0; }
      if (imp > best.impact) best = { impact: imp, car: c };
      if (!heavy && imp > 2.5) this.knock(c, imp, vx0, vz0, true);
    }
    return best;
  }

  knock(c, imp, vx0, vz0, local, preset = null) {
    const light = c.mass < 700;
    const k = preset || {
      x: c.x, y: c.y, z: c.z, vx: c.vx, vz: c.vz,
      vy: light ? Math.min(10, 1.5 + imp * 0.35) : Math.min(2.5, imp * 0.06),
      yaw: c.yaw, pitch: 0, roll: 0,
      wy: (Math.random() - 0.5) * imp * (light ? 0.6 : 0.15), wp: light ? (Math.random() - 0.5) * imp * 0.5 : 0, wr: light ? (Math.random() - 0.5) * imp * 0.6 : (Math.random() - 0.5) * 0.4,
    };
    k.t = 0; k.rest = 0;
    c.knocked = k;
    if (local && this.onKnock) this.onKnock(c.gi, k, imp);
  }

  applyRemoteKnock(gi, k) {
    const c = this.cars[gi];
    if (c) this.knock(c, 0, 0, 0, false, { ...k });
  }

  // t: seconds on the shared race clock
  update(t, dt = 0.016, camX = 0, camZ = 0) {
    if (!this.enabled) return;
    const s = this._tmp, L = this.track.length, E = this._e, col = this._c;
    for (const c of this.cars) {
      let pitch = 0, roll = 0, brake = 1;
      if (c.knocked) {
        const k = c.knocked;
        k.t += dt;
        k.vy -= 9.81 * dt;
        k.x += k.vx * dt; k.y += k.vy * dt; k.z += k.vz * dt;
        k.yaw += k.wy * dt; k.pitch += k.wp * dt; k.roll += k.wr * dt;
        const gy = this.groundY(k.x, k.z) + 0.02;
        if (k.y <= gy) {
          k.y = gy;
          if (k.vy < -2.5) { k.vy *= -0.32; k.wp *= 0.6; k.wr *= 0.6; } else k.vy = 0;
          const f = Math.exp(-dt * 2.2);
          k.vx *= f; k.vz *= f; k.wy *= f; k.wp *= f * f; k.wr *= f * f;
          if (Math.abs(k.wp) < 0.5) k.pitch += (Math.round(k.pitch / Math.PI) * Math.PI - k.pitch) * Math.min(1, dt * 3);
          if (Math.abs(k.wr) < 0.5) k.roll += (Math.round(k.roll / Math.PI) * Math.PI - k.roll) * Math.min(1, dt * 3);
          if (Math.hypot(k.vx, k.vz) < 0.6) k.rest += dt;
        }
        c.x = k.x; c.z = k.z; c.y = k.y; c.yaw = k.yaw; c.vx = k.vx; c.vz = k.vz;
        pitch = k.pitch; roll = k.roll;
        const far = Math.hypot(k.x - camX, k.z - camZ) > 90;
        if ((k.rest > 6 && far) || k.t > 25) c.knocked = null;
        c.on = true;
      } else {
        let d;
        // gentle speed changes (never enough to reach the vehicle ahead in the same lane)
        const mod = c.amp * Math.sin(t * 0.11 + c.ph);
        const vmod = c.amp * 0.11 * Math.cos(t * 0.11 + c.ph);
        brake = vmod < -0.6 ? 4 : 1;
        if (this.closed) d = c.d0 + c.speed * t + mod;
        else {
          const span = L + 60;
          const u = (((c.d0 + c.speed * t + mod) % span) + span) % span - 30;
          d = c.dir > 0 ? u : L - u;
        }
        c.on = this.closed || (d > 0 && d < L);
        const lat = c.lat + c.wobble * Math.sin(t * 0.7 + c.ph2);
        this.track.sample(d, lat, s);
        c.x = s.x; c.z = s.z; c.y = s.y;
        c.yaw = c.dir > 0 ? s.yaw : s.yaw + Math.PI;
        const v = (c.speed + vmod) * c.dir;
        c.vx = s.tx * v; c.vz = s.tz * v; c.dist = s.dist;
        pitch = -Math.atan(s.grade * c.dir);
        if (!c.on) { c.x = c.z = 1e6; }
      }
      E.set(pitch, c.yaw, roll);
      this._q.setFromEuler(E);
      this._p.set(c.x, c.y + 0.02, c.z);
      this._m.compose(this._p, this._q, c.on ? this._s : this._z);
      for (const key in c.meshes) c.meshes[key].setMatrixAt(c.idx, this._m);
      c.meshes.tail.setColorAt(c.idx, col.setRGB(brake, brake, brake));
      this.beams.setMatrixAt(c.gi, c.knocked ? this._m.compose(this._p, this._q, this._z) : this._m);
    }
    for (const m of this.meshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}
