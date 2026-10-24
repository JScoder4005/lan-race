import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HW, rng } from './track.js';

export const JP = '"NeonJP", "Noto Sans CJK JP", "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif';
const BLADES = ['ラーメン', '居酒屋', 'カラオケ', 'ホテル', '寿司', '焼肉', '喫茶', 'パチンコ', 'ゲーム', '24時間', '営業中', '駐車場',
  '酒場', '薬局', '歌舞伎町', '湾岸', '首都高', '東京', '新宿', '渋谷', '六本木', '秋葉原', '銀座', 'ネオン', 'うどん', 'そば',
  '天ぷら', 'ニトロ', 'ターボ', 'バー', '餃子', '本日'];
const SHOPS = [['コンビニ', 'konbini'], ['ラーメン', 'noren'], ['居酒屋', 'noren'], ['カラオケ', 'neon'], ['パチンコ', 'pachinko'],
  ['寿司', 'noren'], ['書店', 'warm'], ['薬局', 'konbini']];
const NEON = ['#ff2e88', '#39e6ff', '#ffd23f', '#7cff6b', '#b56bff', '#ff5a36', '#ffffff', '#ff77ff'];
const SW = () => HW + 0.5 + 5; // sidewalk outer edge

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
export function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

// Quad with normal = right x up; u along right, v along up.
export function quad(pos, uv, col, c, right, up, w, h, u0, v0, u1, v1, color) {
  const p = (sx, sy) => [c[0] + right[0] * w * sx + up[0] * h * sy, c[1] + right[1] * w * sx + up[1] * h * sy, c[2] + right[2] * w * sx + up[2] * h * sy];
  const V = [[p(-0.5, -0.5), u0, v0], [p(0.5, -0.5), u1, v0], [p(0.5, 0.5), u1, v1], [p(-0.5, 0.5), u0, v1]];
  for (const i of [0, 1, 2, 0, 2, 3]) {
    pos.push(...V[i][0]);
    if (uv) uv.push(V[i][1], V[i][2]);
    if (col) col.push(color[0], color[1], color[2]);
  }
}
export function geo(pos, uv, col) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
export const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

function bladeAtlas(r) {
  const W = 128, H = 512, cols = 16;
  const [c, x] = canvas(W * cols, H * 2);
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
  const meta = [];
  BLADES.forEach((txt, k) => {
    const ox = (k % cols) * W, oy = Math.floor(k / cols) * H;
    const col = NEON[k % NEON.length];
    const lightbox = k % 3 === 1;
    const chars = [...txt];
    const size = Math.min(100, (H - 60) / chars.length);
    x.save();
    if (lightbox) {
      const bg = ['#fff3d6', '#ffe14a', '#e9f6ff', '#ffffff'][k % 4];
      x.fillStyle = bg; x.fillRect(ox + 6, oy + 6, W - 12, H - 12);
      x.strokeStyle = '#d11a1a'; x.lineWidth = 6; x.strokeRect(ox + 12, oy + 12, W - 24, H - 24);
      x.fillStyle = k % 2 ? '#c4121a' : '#10131c';
    } else {
      x.fillStyle = '#07070b'; x.fillRect(ox + 6, oy + 6, W - 12, H - 12);
      x.shadowColor = col; x.shadowBlur = 14; x.strokeStyle = col; x.lineWidth = 4;
      x.strokeRect(ox + 14, oy + 14, W - 28, H - 28);
      x.fillStyle = col;
    }
    x.font = `900 ${size}px ${JP}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    const top = oy + H / 2 - (chars.length - 1) * size * 0.52;
    chars.forEach((ch, i) => {
      x.fillText(ch, ox + W / 2, top + i * size * 1.04);
      if (!lightbox) { x.shadowBlur = 3; x.fillStyle = '#fff'; x.globalAlpha = 0.7; x.fillText(ch, ox + W / 2, top + i * size * 1.04); x.globalAlpha = 1; x.fillStyle = col; x.shadowBlur = 14; }
    });
    x.restore();
    meta.push({ u0: ox / c.width, u1: (ox + W) / c.width, v1: 1 - oy / c.height, v0: 1 - (oy + H) / c.height, color: lightbox ? '#fff1c8' : col });
  });
  return { tex: tex(c), meta };
}

function shopAtlas(r) {
  const W = 512, H = 256;
  const [c, x] = canvas(W * 4, H * 2);
  const meta = [];
  SHOPS.forEach(([name, style], k) => {
    const ox = (k % 4) * W, oy = Math.floor(k / 4) * H;
    x.save(); x.beginPath(); x.rect(ox, oy, W, H); x.clip();
    x.fillStyle = '#0b0b10'; x.fillRect(ox, oy, W, H);
    const signH = 62;
    const interior = style === 'konbini' ? ['#dcecfa', '#9fc2e6'] : style === 'pachinko' ? ['#ffe28a', '#ff7a2e'] : style === 'neon' ? ['#c4489f', '#3a1a8a'] : ['#ffd79a', '#b9682c'];
    const g = x.createLinearGradient(0, oy + signH, 0, oy + H);
    g.addColorStop(0, interior[0]); g.addColorStop(1, interior[1]);
    x.fillStyle = g; x.fillRect(ox + 10, oy + signH + 8, W - 20, H - signH - 16);
    x.fillStyle = 'rgba(20,20,30,0.55)';
    for (let i = 0; i < 6; i++) x.fillRect(ox + 20 + i * 82, oy + signH + 50 + r() * 30, 50 + r() * 20, 6);
    for (let i = 1; i < 4; i++) { x.fillStyle = '#16161c'; x.fillRect(ox + i * W / 4 - 3, oy + signH + 8, 6, H - signH - 16); }
    if (style === 'konbini') {
      x.fillStyle = '#fff'; x.fillRect(ox, oy, W, signH);
      x.fillStyle = k % 2 ? '#1b62d8' : '#16a34a'; x.fillRect(ox, oy + 14, W, 14); x.fillRect(ox, oy + 36, W, 8);
      x.fillStyle = '#123'; x.font = `900 34px ${JP}`;
    } else if (style === 'noren') {
      x.fillStyle = k % 2 ? '#b3121b' : '#1a2a5c'; x.fillRect(ox, oy, W, signH);
      for (let i = 0; i < 5; i++) { x.fillStyle = k % 2 ? '#a0101a' : '#18244e'; x.fillRect(ox + 40 + i * 88, oy + signH + 8, 78, 70); }
      x.fillStyle = '#fff'; x.font = `900 40px ${JP}`;
    } else if (style === 'pachinko') {
      x.fillStyle = '#2a0634'; x.fillRect(ox, oy, W, signH);
      for (let i = 0; i < 60; i++) { x.fillStyle = NEON[i % NEON.length]; x.beginPath(); x.arc(ox + (i % 30) * 17 + 8, oy + (i < 30 ? 6 : signH - 6), 4, 0, 7); x.fill(); }
      x.fillStyle = '#ffd23f'; x.font = `900 40px ${JP}`;
    } else {
      x.fillStyle = '#120612'; x.fillRect(ox, oy, W, signH);
      x.fillStyle = style === 'neon' ? '#ff2e88' : '#ffcf7a'; x.shadowColor = x.fillStyle; x.shadowBlur = 12;
      x.font = `900 40px ${JP}`;
    }
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(name, ox + W / 2, oy + signH / 2 + 2);
    x.restore();
    meta.push({ u0: ox / c.width, u1: (ox + W) / c.width, v1: 1 - oy / c.height, v0: 1 - (oy + H) / c.height, glow: interior[0] });
  });
  return { tex: tex(c), meta };
}

function billboardAtlas() {
  const W = 512, H = 288;
  const [c, x] = canvas(W * 2, H * 2);
  const ads = [
    ['#ff2e88', '#3a0b6b', 'ネオンハーバー', 'NIGHT RACE'],
    ['#00c2ff', '#06142e', 'ターボ', 'ENERGY DRINK'],
    ['#ffd23f', '#5b1200', '東京ナイト', 'LIVE 24H'],
    ['#7cff6b', '#002a2a', 'ニトロ', 'FEEL THE BOOST'],
  ];
  ads.forEach(([a, b, jp, en], k) => {
    const ox = (k % 2) * W, oy = Math.floor(k / 2) * H;
    const g = x.createLinearGradient(ox, oy, ox + W, oy + H);
    g.addColorStop(0, b); g.addColorStop(1, '#000');
    x.fillStyle = g; x.fillRect(ox, oy, W, H);
    for (let i = 0; i < 6; i++) { x.fillStyle = a; x.globalAlpha = 0.18; x.beginPath(); x.arc(ox + W * 0.78, oy + H * 0.5, 30 + i * 26, 0, 7); x.fill(); }
    x.globalAlpha = 1;
    x.fillStyle = a; x.font = `900 64px ${JP}`; x.textBaseline = 'middle';
    x.shadowColor = a; x.shadowBlur = 18; x.fillText(jp, ox + 28, oy + H * 0.42);
    x.shadowBlur = 0; x.fillStyle = '#fff'; x.font = 'italic 900 34px "Arial Black", Impact, sans-serif'; x.fillText(en, ox + 30, oy + H * 0.72);
    x.strokeStyle = '#000'; x.lineWidth = 10; x.strokeRect(ox + 5, oy + 5, W - 10, H - 10);
  });
  return tex(c);
}

export function lineTex(draw, w = 64, h = 64) { const [c, x] = canvas(w, h); draw(x, w, h); return tex(c); }

export function buildTokyo(scene, track, world) {
  const r = rng(777);
  const near = world.boxes.filter((b) => b.near);
  const L = track.length;
  const [t0, t1] = track.tunnel;
  const inTunnel = (d) => d > t0 - 15 && d < t1 + 15;
  const up = [0, 1, 0];
  const reflections = []; // [x, z, tx, tz, len, width, color[3], strength]
  const out = { update: () => {} };

  // --- vertical blade signs + facade lightboxes
  const blades = bladeAtlas(r);
  const bp = [], bu = [];
  for (const b of near) {
    if (b.h < 12 || r() < 0.25) continue;
    const nx = -b.front * Math.cos(b.yaw), nz = b.front * Math.sin(b.yaw);
    const tx = Math.sin(b.yaw), tz = Math.cos(b.yaw);
    const n = 1 + Math.floor(r() * 2.2);
    for (let i = 0; i < n; i++) {
      const m = blades.meta[Math.floor(r() * blades.meta.length)];
      const along = (r() - 0.5) * (b.w - 3);
      const h = 4.5 + r() * 2.5, w = h / 4;
      const y = 4 + h / 2 + r() * Math.max(0, Math.min(16, b.h - h - 6));
      const out2 = b.d / 2 + 0.4 + w / 2;
      const c = [b.x + nx * out2 + tx * along, y, b.z + nz * out2 + tz * along];
      const N = [tx, 0, tz];
      const right = [N[2], 0, -N[0]]; // up x N
      quad(bp, bu, null, [c[0] + N[0] * 0.05, c[1], c[2] + N[2] * 0.05], right, up, w, h, m.u0, m.v0, m.u1, m.v1);
      quad(bp, bu, null, [c[0] - N[0] * 0.05, c[1], c[2] - N[2] * 0.05], [-right[0], 0, -right[2]], up, w, h, m.u0, m.v0, m.u1, m.v1);
      const s = track.nearest(c[0], c[2]);
      reflections.push([s.x + s.tz * Math.sign(s.lateral) * (HW - 2.2), s.z - s.tx * Math.sign(s.lateral) * (HW - 2.2), s.tx, s.tz, 16, 2.6, rgb(m.color), 0.5]);
    }
  }
  scene.add(new THREE.Mesh(geo(bp, bu), new THREE.MeshBasicMaterial({ map: blades.tex, color: new THREE.Color(1.5, 1.5, 1.5) })));

  // --- ground floor shop fronts + sidewalk spill light
  const shops = shopAtlas(r);
  const sp = [], su = [], glowP = [], glowC = [];
  for (const b of near) {
    if (r() < 0.15) continue;
    const nx = -b.front * Math.cos(b.yaw), nz = b.front * Math.sin(b.yaw);
    const tx = Math.sin(b.yaw) * b.front, tz = Math.cos(b.yaw) * b.front;
    const count = Math.max(1, Math.floor((b.w - 1) / 8));
    const w = (b.w - 1) / count;
    for (let i = 0; i < count; i++) {
      const m = shops.meta[Math.floor(r() * shops.meta.length)];
      const along = -b.w / 2 + 0.5 + w * (i + 0.5);
      const c = [b.x + nx * (b.d / 2 + 0.06) + tx * along, 2.05, b.z + nz * (b.d / 2 + 0.06) + tz * along];
      quad(sp, su, null, c, [tx, 0, tz], up, w - 0.3, 3.8, m.u0, m.v0, m.u1, m.v1);
      const gc = rgb(m.glow);
      const gx = c[0] + nx * 3, gz = c[2] + nz * 3;
      quad(glowP, null, glowC, [gx, 0.2, gz], [-tx, 0, -tz], [nx, 0, nz], w, 6, 0, 0, 1, 1, gc);
    }
  }
  scene.add(new THREE.Mesh(geo(sp, su), new THREE.MeshBasicMaterial({ map: shops.tex, color: new THREE.Color(0.85, 0.85, 0.85) })));
  scene.add(new THREE.Mesh(geo(glowP, null, glowC), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false })));

  // --- rooftop LED billboards
  const bb = billboardAtlas();
  const bbp = [], bbu = [];
  for (const b of near) {
    if (b.h < 28 || r() > 0.22) continue;
    const k = Math.floor(r() * 4), u0 = (k % 2) * 0.5, v1 = 1 - Math.floor(k / 2) * 0.5;
    const nx = -b.front * Math.cos(b.yaw), nz = b.front * Math.sin(b.yaw);
    const tx = Math.sin(b.yaw) * b.front, tz = Math.cos(b.yaw) * b.front;
    const w = Math.min(b.w * 0.85, 18), h = w * 0.5625;
    const y = b.h - h / 2 - 2 - r() * 6;
    quad(bbp, bbu, null, [b.x + nx * (b.d / 2 + 0.2), y, b.z + nz * (b.d / 2 + 0.2)], [tx, 0, tz], up, w, h, u0, v1 - 0.5, u0 + 0.5, v1);
  }
  scene.add(new THREE.Mesh(geo(bbp, bbu), new THREE.MeshBasicMaterial({ map: bb, color: new THREE.Color(1.35, 1.35, 1.35) })));

  // --- vending machines on the sidewalk
  const vendFront = lineTex((x, w, h) => {
    x.fillStyle = '#f4f8ff'; x.fillRect(0, 0, w, h);
    for (let row = 0; row < 4; row++) for (let i = 0; i < 6; i++) {
      x.fillStyle = NEON[(row * 6 + i) % NEON.length]; x.fillRect(5 + i * 20, 18 + row * 34, 14, 22);
      x.fillStyle = '#2a3a5c'; x.fillRect(5 + i * 20, 42 + row * 34, 14, 4);
    }
    x.fillStyle = '#12161f'; x.fillRect(10, 160, 108, 70);
    x.fillStyle = '#ff3b3b'; x.fillRect(90, 175, 20, 10);
  }, 128, 256);
  const vb = [], vp = [], vu = [];
  for (let d = 60; d < L; d += 90 + r() * 140) {
    if (inTunnel(d) || r() < 0.3) continue;
    const side = r() < 0.5 ? 1 : -1;
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const p = track.sample(d + i * 1.1, side * (SW() - 0.55));
      const nx = -side * p.tz, nz = side * p.tx; // toward road
      const m = new THREE.Matrix4().makeRotationY(Math.atan2(nx, nz)).setPosition(p.x, 0.17 + 0.95, p.z);
      vb.push(new THREE.BoxGeometry(1.0, 1.9, 0.75).applyMatrix4(m));
      quad(vp, vu, null, [p.x + nx * 0.385, 1.22, p.z + nz * 0.385], [nz, 0, -nx], up, 0.86, 1.7, 0, 0, 1, 1);
      reflections.push([p.x + nx * 7, p.z + nz * 7, p.tx, p.tz, 6, 2, [0.8, 0.9, 1], 0.25]);
    }
  }
  if (vb.length) {
    scene.add(new THREE.Mesh(mergeGeometries(vb), new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.4, metalness: 0.3 })));
    scene.add(new THREE.Mesh(geo(vp, vu), new THREE.MeshBasicMaterial({ map: vendFront, color: new THREE.Color(1.6, 1.6, 1.6) })));
  }

  buildShared(scene, track, world, r);

  // --- landmark tower on the skyline
  {
    const lattice = lineTex((x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.strokeStyle = '#fff'; x.lineWidth = 5;
      x.strokeRect(2, 2, w - 4, h - 4);
      x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.moveTo(w, 0); x.lineTo(0, h); x.stroke();
    }, 128, 128);
    lattice.wrapS = lattice.wrapT = THREE.RepeatWrapping;
    lattice.repeat.set(6, 16);
    const mat = new THREE.MeshBasicMaterial({ map: lattice, color: new THREE.Color(4.5, 1.5, 0.35), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    const T = new THREE.Group();
    T.position.set(-380, 0, 1380);
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(9, 34, 130, 4, 1, true), mat); s1.position.y = 65; s1.rotation.y = Math.PI / 4;
    const s2 = new THREE.Mesh(new THREE.CylinderGeometry(3, 9, 95, 4, 1, true), mat); s2.position.y = 130 + 47.5 + 8; s2.rotation.y = Math.PI / 4;
    const deckMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.6, 3) });
    const d1 = new THREE.Mesh(new THREE.BoxGeometry(22, 8, 22), deckMat); d1.position.y = 134;
    const d2 = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 9), deckMat); d2.position.y = 210;
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 50, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4) })); ant.position.y = 255;
    T.add(s1, s2, d1, d2, ant);
    scene.add(T);
  }

  out.setWet = buildReflections(scene, track, world, reflections).setWet;
  return out;
}

// Flyovers, utility poles with overhead wires and zebra crossings (used by every city theme).
export function buildShared(scene, track, world, r, opts = {}) {
  const L = track.length;
  const [t0, t1] = track.tunnel;
  const inTunnel = (d) => d > t0 - 15 && d < t1 + 15;
  const skipPoles = opts.skipPoles || (() => false);
  // --- elevated expressway overpasses
  const concrete = new THREE.MeshStandardMaterial({ color: 0x5a5d63, roughness: 0.85 });
  const ovGeos = [], ovStrip = [];
  for (const o of track.overpasses) {
    const p = track.sample(o.dist);
    const ang = Math.atan2(p.tx, p.tz) + Math.PI / 2 + o.skew;
    const m = new THREE.Matrix4().makeRotationY(ang).setPosition(p.x, p.y, p.z);
    const len = 420, y = o.h;
    ovGeos.push(new THREE.BoxGeometry(16, 1.8, len).translate(0, y, 0).applyMatrix4(m));
    for (const s of [-1, 1]) {
      ovGeos.push(new THREE.BoxGeometry(0.4, 1.3, len).translate(s * 7.8, y + 1.55, 0).applyMatrix4(m));
      ovStrip.push(new THREE.BoxGeometry(0.1, 0.12, len).translate(s * 8.06, y + 0.4, 0).applyMatrix4(m));
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        const zz = k * 34 + (k > 0 ? -10 : 10);
        ovGeos.push(new THREE.BoxGeometry(2.2, y, 2.2).translate(s * 4.2, y / 2, zz).applyMatrix4(m));
      }
    }
    ovGeos.push(new THREE.BoxGeometry(14, 1.2, 2.6).translate(0, y - 1.3, 30).applyMatrix4(m), new THREE.BoxGeometry(14, 1.2, 2.6).translate(0, y - 1.3, -30).applyMatrix4(m));
    world.lamps.push({ x: p.x, z: p.z, y: p.y + y - 1.2, color: 0xcfdcff });
  }
  if (ovGeos.length) {
    scene.add(new THREE.Mesh(mergeGeometries(ovGeos), concrete));
    scene.add(new THREE.Mesh(mergeGeometries(ovStrip), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.6, 0.6) })));
  }

  // --- utility poles + sagging overhead wires
  const poles = [], wire = [];
  const prev = { 1: null, '-1': null };
  for (let d = 15; d < L; d += 34) {
    for (const side of [1, -1]) {
      if (inTunnel(d) || skipPoles(d, side) || track.overpasses.some((o) => Math.abs(track.delta(d, o.dist)) < 25)) { prev[side] = null; continue; }
      const p = track.sample(d, side * (SW() - 0.35));
      const m = new THREE.Matrix4().makeRotationY(p.yaw).setPosition(p.x, p.y, p.z);
      poles.push(new THREE.CylinderGeometry(0.15, 0.2, 11, 7).translate(0, 5.5, 0).applyMatrix4(m));
      poles.push(new THREE.BoxGeometry(2.0, 0.12, 0.12).translate(0, 9.6, 0).applyMatrix4(m), new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, 10.3, 0).applyMatrix4(m));
      if (r() < 0.25) poles.push(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 8).translate(0.45, 8.3, 0).applyMatrix4(m));
      const lx = p.tz, lz = -p.tx;
      const anchors = [[-0.9, 9.62], [0.9, 9.62], [-0.6, 10.32], [0.6, 10.32]].map(([o, y]) => [p.x + lx * o, y + p.y, p.z + lz * o]);
      if (prev[side]) {
        anchors.forEach((a, i) => {
          const b = prev[side][i];
          for (let k = 0; k < 8; k++) {
            const t0 = k / 8, t1 = (k + 1) / 8;
            const sag = (t) => 4 * t * (1 - t) * 0.7;
            wire.push(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0 - sag(t0), a[2] + (b[2] - a[2]) * t0,
              a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1 - sag(t1), a[2] + (b[2] - a[2]) * t1);
          }
        });
      }
      prev[side] = anchors;
      if (side === 1 && r() < 0.12) { // wire crossing the street
        const q = track.sample(d, -(SW() - 0.35));
        for (let k = 0; k < 10; k++) {
          const t0 = k / 10, t1 = (k + 1) / 10, sag = (t) => 4 * t * (1 - t) * 1.2;
          const y0 = p.y + (q.y - p.y) * t0, y1 = p.y + (q.y - p.y) * t1;
          wire.push(p.x + (q.x - p.x) * t0, y0 + 9.6 - sag(t0), p.z + (q.z - p.z) * t0, p.x + (q.x - p.x) * t1, y1 + 9.6 - sag(t1), p.z + (q.z - p.z) * t1);
        }
      }
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(poles), new THREE.MeshStandardMaterial({ color: 0x6d6f73, roughness: 0.8 })));
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x050507 })));

  // --- zebra crossings
  const zp = [];
  for (let d = 420; d < L - 200; d += 520) {
    if (inTunnel(d) || track.overpasses.some((o) => Math.abs(track.delta(d, o.dist)) < 30)) continue;
    const p = track.sample(d);
    for (let lat = -HW + 0.9; lat < HW - 0.5; lat += 1.0) {
      const q = track.sample(d, lat);
      quad(zp, null, null, [q.x, q.y + 0.032, q.z], [p.tz, 0, -p.tx], [p.tx, 0, p.tz], 0.5, 4, 0, 0, 1, 1);
    }
  }
  const zg = geo(zp); zg.computeVertexNormals();
  scene.add(new THREE.Mesh(zg, new THREE.MeshStandardMaterial({ color: 0xcfcfc8, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide })));

}

// Additive colored streaks on the wet road under lamps, signs and shop lights.
export function buildReflections(scene, track, world, reflections) {
  // --- fake wet-road reflections (colored streaks under lights/signs)
  for (const l of world.lamps) {
    const s = track.nearest(l.x, l.z);
    reflections.push([l.x, l.z, s.tx, s.tz, 12, 1.8, rgb(l.color), l.tunnel ? 0.25 : 0.35]);
  }
  const streak = lineTex((x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }, 64, 64);
  const rp = [], ru = [], rc = [];
  for (const [x0, z0, tx, tz, len, wd, c, k] of reflections) {
    quad(rp, ru, rc, [x0, track.nearest(x0, z0).y + 0.04, z0], [tz, 0, -tx], [tx, 0, tz], wd, len, 0, 0, 1, 1, [c[0] * k, c[1] * k, c[2] * k]);
  }
  const rg = geo(rp, ru, rc);
  const refl = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ map: streak, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  scene.add(refl);
  return { setWet: (wet) => { refl.material.opacity = wet ? 1 : 0.45; } };
}
