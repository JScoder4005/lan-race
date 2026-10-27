import { HW } from './track.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(track) {
    this.tach = $('tach').getContext('2d');
    this.mm = $('minimap').getContext('2d');
    this.sb = $('stopbar').getContext('2d');
    this.stops = [];
    this.setTrack(track);
    this.bigTimer = 0;
    this.cache = {};
    this.els = {};
  }

  // Writes to the DOM only when a value changes (avoids per-frame layout work).
  put(id, prop, v) {
    const k = id + prop;
    if (this.cache[k] === v) return;
    this.cache[k] = v;
    const el = this.els[id] ||= $(id);
    if (prop === 'width' || prop === 'display') el.style[prop] = v; else el[prop] = v;
  }

  // Route checkpoints (real bus stops / landmarks), shown on the minimap and as a line diagram under it.
  setStops(stops, endName) {
    this.stops = stops; this.endName = endName;
    this.put('stopbar', 'display', stops.length ? 'block' : 'none');
  }

  drawStops(me, next, t) {
    const c = this.sb, W = 480, H = 150, tr = this.track, x0 = 30, x1 = W - 30, y = 40;
    const span = tr.finishDist - tr.startDist, fx = (d) => x0 + Math.max(0, Math.min(1, (d - tr.startDist) / span)) * (x1 - x0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(5,8,14,0.7)'; c.strokeStyle = 'rgba(57,230,255,0.6)'; c.lineWidth = 3;
    c.beginPath(); c.roundRect(2, 2, W - 4, H - 4, 18); c.fill(); c.stroke();
    const px = fx(me.dist);
    c.lineCap = 'round'; c.lineWidth = 8;
    c.strokeStyle = 'rgba(160,170,190,0.35)'; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
    c.strokeStyle = '#39e6ff'; c.beginPath(); c.moveTo(x0, y); c.lineTo(px, y); c.stroke();
    const ring = (x, r, fill, stroke) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = 4; c.stroke(); } };
    ring(x0, 10, '#7cff6b'); ring(x1, 10, '#ff2e88');
    this.stops.forEach((s, i) => {
      const x = fx(s.d);
      if (i < next) ring(x, 9, '#ffb400');
      else if (i === next) { ring(x, 10 + Math.sin(t * 6) * 2, '#0a0e16', '#ffffff'); }
      else ring(x, 8, '#0a0e16', 'rgba(200,210,230,0.7)');
    });
    c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(px, y - 12); c.lineTo(px - 9, y - 28); c.lineTo(px + 9, y - 28); c.closePath(); c.fill();
    const target = this.stops[next], name = target ? target.name : this.endName, d = (target ? target.d : tr.finishDist) - me.dist;
    c.textBaseline = 'alphabetic';
    c.font = '800 22px Arial, sans-serif'; c.fillStyle = '#39e6ff'; c.textAlign = 'left';
    c.fillText(target ? `NEXT STOP ${next + 1}/${this.stops.length}` : 'FINISH', 22, 92);
    c.textAlign = 'right'; c.fillStyle = '#ffffff';
    c.fillText(d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(d))} m`, W - 22, 92);
    c.textAlign = 'left'; c.font = 'italic 900 30px "Arial Black", Impact, sans-serif';
    const text = String(name).toUpperCase(), maxW = W - 44, w = c.measureText(text).width;
    c.save(); c.translate(22, 130); if (w > maxW) c.scale(maxW / w, 1); c.fillText(text, 0, 0); c.restore();
  }

  setTrack(track) {
    this.track = track;
    this.path = new Path2D();
    const end = track.closed ? track.n : track.n - 1;
    for (let i = 0; i <= end; i++) {
      const k = i % track.n;
      if (i === 0) this.path.moveTo(track.px[k], track.pz[k]); else this.path.lineTo(track.px[k], track.pz[k]);
    }
  }

  show(on) { $('hud').classList.toggle('hidden', !on); }

  setMode(mode) {
    $('racePanel').style.display = mode === 'race' ? '' : 'none';
    $('copPanel').style.display = mode === 'pursuit' ? '' : 'none';
    if (mode !== 'pursuit') { this.put('pbar', 'display', 'none'); this.put('cool', 'display', 'none'); }
  }

  big(html, color = '#fff', dur = 1.2) {
    const b = $('big');
    b.innerHTML = html; b.style.color = color;
    b.classList.remove('anim'); void b.offsetWidth; b.classList.add('anim');
    this.bigTimer = dur;
  }

  popup(text, color = '#39e6ff', sub = '') {
    const d = document.createElement('div');
    d.className = 'pop'; d.style.color = color;
    d.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
    $('popups').appendChild(d);
    setTimeout(() => d.remove(), 1600);
  }

  tick(dt) {
    if (this.bigTimer > 0) { this.bigTimer -= dt; if (this.bigTimer <= 0) $('big').innerHTML = ''; }
  }

  race(info) {
    this.put('pos', 'innerHTML', `<b>${info.pos}</b><span>/${info.total}</span>`);
    this.put('lap', 'textContent', info.remain != null ? `${(info.remain / 1000).toFixed(1)} KM TO ${info.dest}` : `LAP ${Math.min(info.lap, info.laps)}/${info.laps}`);
    this.put('tCur', 'textContent', fmt(info.lapTime));
    this.put('tBest', 'textContent', 'BEST ' + (info.best ? fmt(info.best) : '--'));
    this.put('standings', 'innerHTML', info.order.map((o, i) =>
      `<div class="${o.me ? 'me' : ''}"><span>${i + 1}</span><i style="background:${o.color}"></i>${esc(o.name)}<em>${o.done ? fmt(o.done / 1000) : o.gap}</em></div>`).join(''));
  }

  pursuit(p) {
    this.put('stars', 'innerHTML', '<b>' + '★'.repeat(p.heat) + '</b>' + '★'.repeat(5 - p.heat));
    this.put('bounty', 'textContent', 'BOUNTY ' + Math.floor(p.bounty).toLocaleString());
    this.put('banked', 'textContent', 'BANKED ' + p.banked.toLocaleString());
    const alive = p.cops.filter((c) => !c.dead).length;
    this.put('copCount', 'textContent', p.state === 'pursuit' ? `COPS IN PURSUIT: ${alive}` : 'PATROLS SEARCHING…');
    const inP = p.state === 'pursuit';
    const showCool = inP && p.cool > 0.01 && p.nearest > 160;
    this.put('pbar', 'display', inP && !showCool ? 'flex' : 'none');
    this.put('cool', 'display', showCool ? 'flex' : 'none');
    const ev = Math.min(1, Math.max(0, (p.nearest - 40) / 190));
    this.els.ev ||= $('pbar').querySelector('.ev'); this.els.bu ||= $('pbar').querySelector('.bu'); this.els.co ||= $('cool').querySelector('i');
    this.put('ev', 'width', Math.round(ev * 50) + '%');
    this.put('bu', 'width', Math.round(p.bust * 50) + '%');
    this.put('co', 'width', Math.round(p.cool * 100) + '%');
  }

  wrongWay(on) { this.put('wrongway', 'display', on ? 'block' : 'none'); }
  net(text) { this.put('net', 'textContent', text); }

  drawTach(car) {
    const c = this.tach, S = 320, cx = 170, cy = 170, R = 128;
    c.clearRect(0, 0, S, S);
    const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5, max = 9000;
    const ang = (rpm) => a0 + (rpm / max) * sweep;
    c.lineCap = 'butt';
    c.beginPath(); c.arc(cx, cy, R + 14, 0, Math.PI * 2); c.fillStyle = 'rgba(5,8,14,0.55)'; c.fill();
    c.lineWidth = 6; c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.beginPath(); c.arc(cx, cy, R, a0, ang(7500)); c.stroke();
    c.strokeStyle = '#ff2a2a'; c.beginPath(); c.arc(cx, cy, R, ang(7500), ang(max)); c.stroke();
    c.lineWidth = 6; c.strokeStyle = car.rpm > 7500 ? '#ff4040' : '#39e6ff';
    c.shadowColor = c.strokeStyle; c.shadowBlur = 12;
    c.beginPath(); c.arc(cx, cy, R, a0, ang(Math.min(max, car.rpm))); c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = '#cfd6e4'; c.font = 'italic 900 15px Arial Black, Impact'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i <= 9; i++) {
      const a = ang(i * 1000);
      c.strokeStyle = i >= 8 ? '#ff4040' : '#fff'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12)); c.lineTo(cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24)); c.stroke();
      c.fillText(String(i), cx + Math.cos(a) * (R - 40), cy + Math.sin(a) * (R - 40));
    }
    const a = ang(Math.min(max, car.rpm));
    c.strokeStyle = '#ff2e88'; c.lineWidth = 4; c.shadowColor = '#ff2e88'; c.shadowBlur = 10;
    c.beginPath(); c.moveTo(cx - Math.cos(a) * 14, cy - Math.sin(a) * 14); c.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); c.stroke();
    c.shadowBlur = 0;
    // nitro arc
    c.lineWidth = 9; c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.beginPath(); c.arc(cx, cy, R + 14, Math.PI * 0.62, Math.PI * 0.38, true); c.stroke();
    const nGrad = c.createLinearGradient(cx - R, 0, cx + R, 0);
    nGrad.addColorStop(0, '#2a6bff'); nGrad.addColorStop(1, '#39e6ff');
    c.strokeStyle = nGrad; c.shadowColor = '#39e6ff'; c.shadowBlur = car.nitroOn ? 18 : 6;
    if (car.nitro > 0.01) { c.beginPath(); c.arc(cx, cy, R + 14, Math.PI * 0.62, Math.PI * (0.62 - car.nitro * 0.24), true); c.stroke(); }
    c.shadowBlur = 0;
    // speed + gear
    const kmh = Math.round(Math.abs(car.fwd) * 3.6);
    c.fillStyle = '#fff'; c.font = 'italic 900 64px Arial Black, Impact';
    c.fillText(String(kmh), cx + 4, cy + 34);
    c.fillStyle = '#8a93a6'; c.font = '700 13px Arial'; c.fillText('KM/H', cx, cy + 72);
    c.fillStyle = '#39e6ff'; c.font = 'italic 900 34px Arial Black, Impact';
    c.fillText(car.fwd < -0.5 ? 'R' : car.speed < 0.5 && car.throttle < 0.1 ? 'N' : String(car.gear), cx, cy - 34);
    c.fillStyle = '#39e6ff'; c.font = '700 11px Arial'; c.fillText('NOS', cx, cy + R + 4);
  }

  drawMinimap(me, others, cops, otherCops, t) {
    const c = this.mm, S = 240, cx = 120, cy = 120, s = 0.19;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.arc(cx, cy, 116, 0, Math.PI * 2); c.fillStyle = 'rgba(5,8,14,0.7)'; c.fill(); c.clip();
    const co = Math.cos(me.yaw), si = Math.sin(me.yaw);
    const A = -co * s, B = -si * s, C = si * s, D = -co * s;
    c.setTransform(A, B, C, D, cx - (A * me.x + C * me.z), cy - (B * me.x + D * me.z));
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(57,230,255,0.25)'; c.lineWidth = HW * 2 + 14; c.stroke(this.path);
    c.strokeStyle = '#cfd6e4'; c.lineWidth = HW * 2; c.stroke(this.path);
    const s0 = this.track.sample(0);
    c.strokeStyle = '#ffb400'; c.lineWidth = 10;
    c.beginPath(); c.moveTo(s0.x + s0.tz * HW, s0.z - s0.tx * HW); c.lineTo(s0.x - s0.tz * HW, s0.z + s0.tx * HW); c.stroke();
    const dot = (x, z, r, col) => { c.beginPath(); c.arc(x, z, r / s, 0, Math.PI * 2); c.fillStyle = col; c.fill(); };
    for (const st of this.stops) { // checkpoints: amber once passed, white ahead
      c.lineWidth = 2.5 / s; c.strokeStyle = '#0a0e16';
      c.beginPath(); c.arc(st.x, st.z, 6 / s, 0, Math.PI * 2); c.fillStyle = st.d <= me.dist ? '#ffb400' : '#ffffff'; c.fill(); c.stroke();
    }
    const flash = Math.floor(t * 6) % 2 ? '#ff2a2a' : '#2a5bff';
    for (const cp of otherCops) dot(cp[0], cp[1], 4, flash);
    for (const cp of cops) dot(cp.ph.x, cp.ph.z, 5, cp.dead ? '#555' : flash);
    for (const o of others) dot(o.x, o.z, 6, o.color);
    c.restore();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#39e6ff'; c.beginPath(); c.moveTo(cx, cy - 10); c.lineTo(cx + 7, cy + 7); c.lineTo(cx, cy + 3); c.lineTo(cx - 7, cy + 7); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(57,230,255,0.6)'; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, 116, 0, Math.PI * 2); c.stroke();
  }
}

export function fmt(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
export function esc(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
