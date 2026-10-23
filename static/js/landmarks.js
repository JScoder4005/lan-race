import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HW } from './track.js';
import { FONTS, WELCOME, waterSideAt } from './themes.js';

const RESERVE = { palace: 110, gopuram: 45, lighthouse: 25, charminar: 40, buddha: 30, fort: 70, mall: 80, glassTowers: 60, techpark: 90, viewpoint: 20, gateway: 0, bridgeArches: 0 };
const OFFSET = { palace: 150, gopuram: 70, lighthouse: 90, charminar: 55, buddha: 260, fort: 110, mall: 110, glassTowers: 80, techpark: 140, viewpoint: 45 };

// Decide where each landmark of a theme sits; buildings keep clear of the returned circles.
export function planLandmarks(track, T) {
  const out = [];
  const span = track.closed ? track.length : track.finishDist - track.startDist;
  const waterAt = (d) => (T.water ? waterSideAt(track, d, T.water.dir) : 1);
  for (const lm of T.landmarks || []) {
    let d;
    let ahead = false;
    if (lm.at === 'start') d = track.startDist + (lm.type === 'gateway' ? 35 : 160);
    else if (lm.at === 'end') { d = track.finishDist - (lm.type === 'gateway' ? 40 : 0); ahead = lm.type !== 'gateway'; }
    else d = track.startDist + lm.at * span;
    const p = track.sample(d);
    let x = p.x, z = p.z, yaw = p.yaw;
    if (ahead && !track.closed) {
      const e = track.sample(track.length);
      const dist = (OFFSET[lm.type] || 80) * 0.7 + 40;
      x = e.x + e.tx * dist; z = e.z + e.tz * dist; yaw = e.yaw + Math.PI;
    } else if (lm.type !== 'gateway' && lm.type !== 'bridgeArches') {
      let side = lm.side ?? 1;
      if (side === 'water') side = waterAt(d);
      if (side === 'land') side = -waterAt(d);
      const off = OFFSET[lm.type] || 80;
      x = p.x + p.tz * side * off; z = p.z - p.tx * side * off;
      yaw = Math.atan2(-p.tz * side, p.tx * side); // face the road
    }
    out.push({ ...lm, d, x, z, yaw, r: RESERVE[lm.type] ?? 40 });
  }
  return out;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const basic = (color, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

function labelSign(text, sub, color, w = 30, font = '"Arial Black", Impact, sans-serif') {
  const t = canvasTex(1024, 256, (x, W, H) => {
    x.fillStyle = 'rgba(0,0,0,0)'; x.clearRect(0, 0, W, H);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `900 ${sub ? 110 : 140}px ${font}`;
    const tw = x.measureText(text).width; const sc = Math.min(1, (W - 40) / tw);
    x.save(); x.translate(W / 2, sub ? H * 0.38 : H / 2); x.scale(sc, 1);
    x.shadowColor = color; x.shadowBlur = 24; x.fillStyle = color; x.fillText(text, 0, 0);
    x.shadowBlur = 0; x.fillStyle = '#ffffff'; x.globalAlpha = 0.85; x.fillText(text, 0, 0); x.restore();
    if (sub) { x.globalAlpha = 1; x.font = '700 54px Arial, sans-serif'; x.fillStyle = '#ffffff'; x.fillText(sub, W / 2, H * 0.8); }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t, transparent: true, color: new THREE.Color(1.8, 1.8, 1.8), side: THREE.DoubleSide, depthWrite: false }));
  return m;
}

// Thousands of tiny bulbs outlining a box (Mysore Palace style illumination).
function bulbOutline(boxes, spacing, color) {
  const pts = [];
  for (const [cx, cy, cz, w, h, d] of boxes) {
    const xs = [cx - w / 2, cx + w / 2], ys = [cy - h / 2, cy + h / 2], zs = [cz - d / 2, cz + d / 2];
    const edge = (a, b) => { const n = Math.max(1, Math.round(a.distanceTo(b) / spacing)); for (let i = 0; i <= n; i++) pts.push(a.clone().lerp(b, i / n)); };
    for (const y of ys) {
      edge(new THREE.Vector3(xs[0], y, zs[0]), new THREE.Vector3(xs[1], y, zs[0]));
      edge(new THREE.Vector3(xs[0], y, zs[1]), new THREE.Vector3(xs[1], y, zs[1]));
      edge(new THREE.Vector3(xs[0], y, zs[0]), new THREE.Vector3(xs[0], y, zs[1]));
      edge(new THREE.Vector3(xs[1], y, zs[0]), new THREE.Vector3(xs[1], y, zs[1]));
    }
    for (const x of xs) for (const z of zs) edge(new THREE.Vector3(x, ys[0], z), new THREE.Vector3(x, ys[1], z));
  }
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 5, 3), basic(color, 6), pts.length);
  const m = new THREE.Matrix4();
  pts.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  return im;
}

function dome(r, h, color, spike = true) {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), color);
  s.scale.y = h / r; g.add(s);
  if (spike) { const c = new THREE.Mesh(new THREE.ConeGeometry(r * 0.12, r * 0.9, 8), basic(0xffc94a, 1.6)); c.position.y = h + r * 0.4; g.add(c); }
  return g;
}

const BUILD = {
  palace(T) {
    const g = new THREE.Group();
    const stone = std(0xd9cfb8);
    const parts = [[0, 10, 0, 110, 20, 45], [0, 25, 0, 80, 10, 34], [0, 41, 0, 18, 22, 18]];
    for (const [x, y, z, w, h, d] of parts) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stone); b.position.set(x, y, z); g.add(b); }
    const gold = std(0xd9a441, { metalness: 0.6, roughness: 0.35 });
    const big = dome(10, 14, gold); big.position.y = 52; g.add(big);
    for (const [x, z] of [[-48, 18], [48, 18], [-48, -18], [48, -18], [-30, 12], [30, 12]]) { const dm = dome(4, 6, gold); dm.position.set(x, x * x > 1000 ? 20 : 30, z); g.add(dm); }
    g.add(bulbOutline(parts.map(([x, y, z, w, h, d]) => [x, y, z, w + 0.2, h + 0.1, d + 0.2]).concat([[0, 26, 23.2, 60, 6, 0.2]]), 1.1, 0xffd27a));
    return g;
  },
  gopuram(T) {
    const g = new THREE.Group();
    const sculpt = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#c9a46a'; x.fillRect(0, 0, w, h);
      const cols = ['#d8442f', '#2f7bd8', '#e8b92f', '#2fa85a', '#e8e0d0'];
      for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
        x.fillStyle = cols[(i + j) % cols.length]; x.fillRect(i * 32 + 6, j * 64 + 14, 20, 40);
        x.fillStyle = '#7a5a30'; x.fillRect(i * 32 + 2, j * 64 + 56, 30, 6);
      }
    });
    sculpt.wrapS = sculpt.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshBasicMaterial({ map: sculpt, color: new THREE.Color(1.15, 1.05, 0.95) });
    const base = new THREE.Mesh(new THREE.BoxGeometry(34, 10, 24), std(0xb89a72)); base.position.y = 5; g.add(base);
    let w = 30, d = 20, y = 10;
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 5.4, d), mat); b.position.y = y + 2.7; g.add(b);
      y += 5.4; w *= 0.88; d *= 0.86;
    }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.6, d * 0.6, w, 16, 1, false, 0, Math.PI), std(0xd9a441, { metalness: 0.5 }));
    top.rotation.z = Math.PI / 2; top.position.y = y; g.add(top);
    for (let i = -2; i <= 2; i++) { const k = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3, 8), basic(0xffc94a, 1.8)); k.position.set(i * w / 5, y + d * 0.6 + 1, 0); g.add(k); }
    return g;
  },
  lighthouse(T, lm) {
    const g = new THREE.Group();
    const stripes = canvasTex(64, 256, (x, w, h) => {
      for (let i = 0; i < 8; i++) { x.fillStyle = lm.stripes === false ? '#eeeeee' : i % 2 ? '#f2f2f2' : '#c4161c'; x.fillRect(0, i * h / 8, w, h / 8); }
    });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 4.2, 46, 20), new THREE.MeshBasicMaterial({ map: stripes, color: new THREE.Color(0.7, 0.7, 0.7) }));
    tower.position.y = 23; g.add(tower);
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.6, 20), std(0x222222)); gallery.position.y = 46.3; g.add(gallery);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 3.4, 16), basic(0xfff2c8, 5)); lantern.position.y = 48.3; g.add(lantern);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.4, 16), std(0x1a1a1a)); cap.position.y = 51.2; g.add(cap);
    const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.2), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Group(); beam.position.y = 48.3;
    for (const s of [1, -1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(9, 260, 16, 1, true), beamMat); c.rotation.z = s * Math.PI / 2; c.position.x = s * 130; beam.add(c); }
    g.add(beam);
    g.userData.update = (t) => { beam.rotation.y = t * 0.8; };
    return g;
  },
  charminar() {
    const g = new THREE.Group();
    const stone = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.85, 0.66) });
    const arches = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#e8d6ae'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#1a140c'; x.beginPath(); x.moveTo(60, h); x.lineTo(60, 110); x.quadraticCurveTo(128, 10, 196, 110); x.lineTo(196, h); x.fill();
      x.strokeStyle = '#b8a070'; x.lineWidth = 6; x.strokeRect(8, 8, w - 16, h - 16);
    });
    const face = new THREE.MeshBasicMaterial({ map: arches, color: new THREE.Color(1.05, 1, 0.9) });
    const base = new THREE.Mesh(new THREE.BoxGeometry(30, 20, 30), [face, face, stone, stone, face, face]); base.position.y = 10; g.add(base);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(26, 8, 26), stone); upper.position.y = 24; g.add(upper);
    for (const [x, z] of [[-15, -15], [15, -15], [-15, 15], [15, 15]]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 52, 12), stone); m.position.set(x, 26, z); g.add(m);
      for (const y of [22, 34, 44]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.8, 12), stone); b.position.set(x, y, z); g.add(b); }
      const dm = dome(2, 3, stone); dm.position.set(x, 52, z); g.add(dm);
    }
    g.add(bulbOutline([[0, 10, 0, 30.2, 20.1, 30.2]], 1.4, 0xfff0c8));
    return g;
  },
  buddha() {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(12, 1), std(0x55524c)); rock.scale.y = 0.45; rock.position.y = 1; g.add(rock);
    const white = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.28, 1.2) });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4, 4, 16), white); ped.position.y = 7; g.add(ped);
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 13, 16), white); robe.position.y = 15.5; g.add(robe);
    const sh = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 10), white); sh.scale.y = 0.6; sh.position.y = 22; g.add(sh);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), white); head.position.y = 24.4; g.add(head);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), white); top.position.y = 25.9; g.add(top);
    return g;
  },
  fort() {
    const g = new THREE.Group();
    const laterite = std(0x8a4a2e);
    const S = 70, H = 9;
    for (const [x, z, w, d] of [[0, -S / 2, S, 3], [0, S / 2, S, 3], [-S / 2, 0, 3, S], [S / 2, 0, 3, S]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), laterite); wall.position.set(x, H / 2, z); g.add(wall);
      const n = Math.round(Math.max(w, d) / 3);
      for (let i = 0; i < n; i += 2) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(w > d ? 1.5 : 3, 1.4, w > d ? 3 : 1.5), laterite);
        c.position.set(x + (w > d ? -w / 2 + i * 3 : 0), H + 0.7, z + (w > d ? 0 : -d / 2 + i * 3)); g.add(c);
      }
    }
    for (const [x, z] of [[-S / 2, -S / 2], [S / 2, -S / 2], [-S / 2, S / 2], [S / 2, S / 2]]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, H + 2, 16), laterite); b.position.set(x, (H + 2) / 2, z); g.add(b);
    }
    return g;
  },
  mall(T, lm) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(130, 26, 70), std(0x2c2f36)); body.position.y = 13; g.add(body);
    for (const y of [6, 14, 22]) { const band = new THREE.Mesh(new THREE.BoxGeometry(130.4, 0.8, 70.4), basic(0x9fd8ff, 2.2)); band.position.y = y; g.add(band); }
    const sign = labelSign(lm.label || 'MALL', 'SHOPPING · FOOD · CINEMA', '#ff7a2e', 60); sign.position.set(0, 30, 36); g.add(sign);
    return g;
  },
  glassTowers(T, lm) {
    const g = new THREE.Group();
    const glass = canvasTex(256, 512, (x, w, h) => {
      x.fillStyle = '#0c1a2a'; x.fillRect(0, 0, w, h);
      for (let j = 0; j < 32; j++) for (let i = 0; i < 16; i++) if (Math.random() < 0.55) { x.fillStyle = Math.random() < 0.8 ? '#cfe6ff' : '#ffe2b0'; x.fillRect(i * 16 + 2, j * 16 + 3, 12, 10); }
    });
    glass.wrapS = glass.wrapT = THREE.RepeatWrapping;
    for (const [x, h, w] of [[-22, 86, 30], [24, 70, 28]]) {
      const tm = glass.clone(); tm.needsUpdate = true; tm.repeat.set(w / 16, h / 32);
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, 26), new THREE.MeshBasicMaterial({ map: tm, color: new THREE.Color(1.1, 1.1, 1.2) }));
      t.position.set(x, h / 2, 0); g.add(t);
      const crown = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.6, 26.4), basic(0x39e6ff, 3)); crown.position.set(x, h - 0.3, 0); g.add(crown);
    }
    const sign = labelSign(lm.label, null, '#39e6ff', 40); sign.position.set(-22, 92, 14); g.add(sign);
    return g;
  },
  techpark(T, lm) {
    const g = new THREE.Group();
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0e1f33, metalness: 0.9, roughness: 0.15, emissive: 0x16304a, emissiveIntensity: 0.6 });
    for (const [x, z, h] of [[-45, -30, 48], [0, -40, 62], [45, -30, 40], [-30, 25, 36], [35, 25, 52]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(34, h, 26), glassMat); b.position.set(x, h / 2, z); g.add(b);
      for (let y = 4; y < h; y += 4) { const band = new THREE.Mesh(new THREE.BoxGeometry(34.3, 0.4, 26.3), basic(0xbfe0ff, Math.random() < 0.6 ? 1.6 : 0.3)); band.position.set(x, y, z); g.add(band); }
    }
    const sign = labelSign(lm.label, 'TECH PARK', '#7cff6b', 56); sign.position.set(0, 70, 0); g.add(sign);
    return g;
  },
  viewpoint(T, lm) {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 1.2, 1.2), std(0x6b6660)); wall.position.y = 0.6; g.add(wall);
    const sign = labelSign(lm.label, WELCOME[T.lang] ? `${WELCOME[T.lang]} · WAYANAD` : null, '#ffd23f', 26, FONTS[T.lang] + ', Arial'); sign.position.set(0, 9, 0); g.add(sign);
    for (const sx of [-12, 12]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), std(0x333333)); p.position.set(sx, 4.5, -0.3); g.add(p); }
    return g;
  },
};

function gateway(track, lm, T) {
  const p = track.sample(lm.d);
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.z); g.rotation.y = p.yaw;
  const pillarMat = std(0xe8d8b8);
  for (const sx of [-1, 1]) {
    const pil = new THREE.Mesh(new THREE.BoxGeometry(2.4, 11, 2.4), pillarMat); pil.position.set(sx * (HW + 2.5), 5.5, 0); g.add(pil);
    const dm = dome(1.6, 2.4, std(0xd9a441, { metalness: 0.5 })); dm.position.set(sx * (HW + 2.5), 11, 0); g.add(dm);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 7, 3.2, 1.4), std(0x7a1f1f)); beam.position.y = 12.2; g.add(beam);
  const t = canvasTex(1024, 160, (x, W, H) => {
    x.fillStyle = '#7a1f1f'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#ffd27a'; x.lineWidth = 8; x.strokeRect(8, 8, W - 16, H - 16);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#ffe9a8';
    x.font = `900 64px ${FONTS[T.lang]}, Arial`; x.fillText(WELCOME[T.lang] || 'WELCOME', W * 0.24, H / 2 + 4);
    x.font = '900 58px "Arial Black", Impact, sans-serif';
    const tw = x.measureText(lm.label).width; const sc = Math.min(1, (W * 0.55) / tw);
    x.save(); x.translate(W * 0.68, H / 2 + 4); x.scale(sc, 1); x.fillText(lm.label, 0, 0); x.restore();
  });
  for (const zf of [-0.71, 0.71]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + 6.6, 3), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.4, 1.4, 1.4) }));
    m.position.set(0, 12.2, zf); if (zf < 0) m.rotation.y = Math.PI; g.add(m);
  }
  g.add(bulbOutline([[0, 12.2, 0, HW * 2 + 7.2, 3.4, 1.6]], 0.9, 0xffd27a));
  return g;
}

function bridgeArches(track, lm) {
  const g = new THREE.Group();
  const mat = basic(0x39e6ff, 2.4), mat2 = basic(0xff2e88, 2.4);
  for (let k = 0; k < 3; k++) {
    const p = track.sample(lm.d + k * 42 + 21);
    for (const side of [1, -1]) {
      const a = new THREE.Mesh(new THREE.TorusGeometry(20, 0.35, 6, 40, Math.PI), k % 2 ? mat2 : mat);
      a.position.set(p.x + p.tz * side * (HW + 1.2), 0, p.z - p.tx * side * (HW + 1.2));
      a.rotation.y = p.yaw + Math.PI / 2;
      g.add(a);
    }
  }
  return g;
}

export function buildLandmarks(scene, track, T, plans) {
  const updates = [];
  for (const lm of plans) {
    let obj;
    if (lm.type === 'gateway') obj = gateway(track, lm, T);
    else if (lm.type === 'bridgeArches') obj = bridgeArches(track, lm);
    else if (BUILD[lm.type]) {
      obj = BUILD[lm.type](T, lm);
      obj.position.set(lm.x, 0, lm.z);
      obj.rotation.y = lm.yaw;
    }
    if (!obj) continue;
    scene.add(obj);
    if (obj.userData.update) updates.push(obj.userData.update);
  }
  return (t) => { for (const u of updates) u(t); };
}
