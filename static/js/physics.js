import { HW } from './track.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const GEARS = [0, 17, 30, 44, 58, 73, 115];

export class CarPhysics {
  constructor(track, opts = {}) {
    this.track = track;
    this.x = 0; this.z = 0; this.yaw = 0; this.vx = 0; this.vz = 0; this.yawRate = 0;
    this.half = 2.25; this.r = 1.05;
    this.fwd = 0; this.lat = 0; this.speed = 0; this.slip = 0;
    this.steer = 0; this.throttle = 0; this.brake = 0; this.handbrake = false;
    this.nitro = 1; this.nitroOn = false; this.drifting = false; this.driftLatch = false;
    this.rpm = 900; this.gear = 1; this.shift = 0;
    this.hint = -1; this.dist = 0; this.lateral = 0; this.tx = 0; this.tz = 1;
    this.wallImpact = 0; this.scraping = false; this.frozen = false;
    this.power = opts.power ?? 1; this.grip = opts.grip ?? 1;
    this._n = {};
  }

  place(dist, lateral = 0, speed = 0) {
    const p = this.track.sample(dist, lateral);
    this.x = p.x; this.z = p.z; this.yaw = p.yaw; this.yawRate = 0;
    this.vx = p.tx * speed; this.vz = p.tz * speed;
    this.hint = -1;
    this.updateTrack();
  }

  updateTrack() {
    const n = this.track.nearest(this.x, this.z, this.hint, this._n);
    this.hint = n.i; this.dist = n.dist; this.lateral = n.lateral; this.tx = n.tx; this.tz = n.tz;
  }

  step(dt, inp) {
    this.wallImpact = 0; this.scraping = false;
    this.steer = inp.steer; this.throttle = inp.throttle; this.brake = inp.brake; this.handbrake = inp.handbrake;
    if (this.frozen) {
      this.vx = this.vz = this.yawRate = 0; this.nitroOn = false; this.drifting = false;
      this.rpm += (900 + inp.throttle * 6800 - this.rpm) * Math.min(1, dt * 7);
      this.speed = this.fwd = this.lat = 0;
      return;
    }
    let fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let fwd = this.vx * fx + this.vz * fz;
    const sAbs = Math.abs(fwd);

    // Steering: limited by lateral grip so normal cornering stays planted; the handbrake latches a drift
    // that allows over-rotation.
    if ((inp.handbrake && sAbs > 12) || (inp.brake > 0.5 && Math.abs(inp.steer) > 0.6 && fwd > 25)) this.driftLatch = true;
    const k = Math.min(sAbs / 6, 1);
    let turn = Math.min(k * (2.3 - 1.25 * Math.min(sAbs / 95, 1)), ((this.driftLatch ? 56 : 28) * this.grip) / Math.max(sAbs, 1));
    if (this.driftLatch || inp.handbrake) turn *= 1.25;
    const target = -inp.steer * turn * (fwd >= 0 ? 1 : -1);
    this.yawRate += (target - this.yawRate) * Math.min(1, dt * (this.drifting ? 5 : 9));
    this.yawRate = clamp(this.yawRate, -4, 4);
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    fx = Math.sin(this.yaw); fz = Math.cos(this.yaw);
    fwd = this.vx * fx + this.vz * fz;
    let lat = this.vx * fz - this.vz * fx;

    // Longitudinal
    const thr = inp.throttle;
    const nitroOn = inp.nitro && this.nitro > 0.005 && thr > 0.1 && fwd > -1;
    this.nitroOn = nitroOn;
    if (nitroOn) this.nitro = Math.max(0, this.nitro - dt / 4.5);
    const pw = this.power * (nitroOn ? 1.65 : 1);
    let acc = 0;
    if (inp.brake > 0.05) {
      if (fwd > 1) acc -= 24 * inp.brake;
      else if (fwd > -16) acc -= 7 * inp.brake;
    }
    if (thr > 0) {
      if (fwd < -1) acc += 24 * thr;
      else acc += thr * Math.min(10.5 * pw, (560 * pw) / (Math.max(fwd, 0) + 9)) + (nitroOn ? 3 : 0);
    } else if (inp.brake <= 0.05) {
      acc -= Math.sign(fwd) * Math.min(Math.abs(fwd) * 5, 1.6);
    }
    acc -= 0.00078 * fwd * Math.abs(fwd) + 0.25 * Math.sign(fwd) * Math.min(1, Math.abs(fwd));
    if (inp.handbrake) acc -= Math.sign(fwd) * Math.min(Math.abs(fwd) * 4, 5);
    fwd += acc * dt;

    // Lateral grip: handbrake breaks traction, throttle holds a drift.
    const slip = Math.atan2(Math.abs(lat), Math.max(Math.abs(fwd), 1));
    let grip = 9 * this.grip;
    if (inp.handbrake && sAbs > 8) grip = 1.3;
    else if (this.driftLatch && slip > 0.1 && sAbs > 14) grip = thr > 0.3 ? 1.9 : 4.5;
    if (this.driftLatch && !inp.handbrake && (slip < 0.08 || sAbs < 10)) this.driftLatch = false;
    const latBefore = lat;
    lat *= Math.exp(-grip * dt);
    if (slip > 0.16 && thr > 0.3 && fwd > 0) fwd += Math.abs(latBefore - lat) * 0.35; // carry speed through slides
    this.slip = slip;
    this.drifting = slip > 0.2 && sAbs > 14;
    if (this.drifting) this.nitro = Math.min(1, this.nitro + dt * 0.11 * Math.min(1, sAbs / 45));
    this.nitro = Math.min(1, this.nitro + dt * 0.012);

    this.vx = fx * fwd + fz * lat;
    this.vz = fz * fwd - fx * lat;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Walls: keep the car's rotated footprint inside the road.
    this.updateTrack();
    const cosR = Math.abs(fx * this.tx + fz * this.tz), sinR = Math.abs(fx * this.tz - fz * this.tx);
    const ext = 0.98 * cosR + 2.2 * sinR;
    const lim = HW - ext;
    if (Math.abs(this.lateral) > lim) {
      const s = Math.sign(this.lateral);
      const nx = this.tz * s, nz = -this.tx * s;
      const pen = Math.abs(this.lateral) - lim;
      this.x -= nx * pen; this.z -= nz * pen;
      this.lateral -= s * pen;
      const vn = this.vx * nx + this.vz * nz;
      if (vn > 0) {
        this.wallImpact = vn;
        this.vx -= nx * vn * 1.3; this.vz -= nz * vn * 1.3;
        const fr = Math.max(0.55, 1 - vn * 0.025);
        this.vx *= fr; this.vz *= fr;
        const tdot = fx * this.tx + fz * this.tz;
        this.yawRate += (tdot >= 0 ? 1 : -1) * s * Math.min(vn, 20) * 0.03;
      }
      const sp = Math.hypot(this.vx, this.vz);
      if (sp > 4) {
        this.scraping = true; this.vx *= 1 - dt * 0.4; this.vz *= 1 - dt * 0.4;
        let ty = Math.atan2(this.tx, this.tz);
        if (Math.abs(wrapAngle(ty - this.yaw)) > Math.PI / 2) ty += Math.PI;
        this.yaw = wrapAngle(this.yaw + clamp(wrapAngle(ty - this.yaw), -1, 1) * dt * 2.5);
      }
    }

    if (!this.track.closed) { // road-closed barriers at both ends
      for (const [lim, dir] of [[2.5, 1], [this.track.length - 2.5, -1]]) {
        const over = (lim - this.dist) * dir;
        if (over > 0) {
          this.x += this.tx * over * dir; this.z += this.tz * over * dir;
          const vt = (this.vx * this.tx + this.vz * this.tz) * dir;
          if (vt < 0) { this.wallImpact = Math.max(this.wallImpact, -vt); this.vx -= this.tx * vt * dir * 1.3; this.vz -= this.tz * vt * dir * 1.3; }
          this.updateTrack();
        }
      }
    }
    this.speed = Math.hypot(this.vx, this.vz);
    this.fwd = this.vx * fx + this.vz * fz;
    this.lat = this.vx * fz - this.vz * fx;

    // Gearbox / rpm for HUD + audio
    const v = Math.max(0, this.fwd);
    let g = 1;
    while (g < 6 && v > GEARS[g] * 0.97) g++;
    if (g !== this.gear) { this.shift = 0.16; this.gear = g; }
    this.shift = Math.max(0, this.shift - dt);
    let rpmT = 1100 + (v / GEARS[g]) * 6900;
    if (thr > 0.1 && v < 12) rpmT += thr * 2000 * (1 - v / 12);
    if (this.drifting && thr > 0.3) rpmT += 900;
    if (this.fwd < -0.5) rpmT = 1100 + (-this.fwd / 16) * 4000;
    this.rpm += (Math.min(8400, rpmT) - this.rpm) * Math.min(1, dt * (this.shift > 0 ? 25 : 10));
  }
}

// --- body collisions (each body: x,z,yaw,vx,vz,yawRate,half,r) ---
const CA = [[0, 0], [0, 0], [0, 0]], CB = [[0, 0], [0, 0], [0, 0]];
function circles(b, out) {
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  const o = b.half - b.r;
  if (b.half > 3.2) {
    out[0][0] = b.x + fx * o; out[0][1] = b.z + fz * o;
    out[1][0] = b.x; out[1][1] = b.z;
    out[2][0] = b.x - fx * o; out[2][1] = b.z - fz * o;
    return 3;
  }
  out[0][0] = b.x + fx * o; out[0][1] = b.z + fz * o;
  out[1][0] = b.x - fx * o; out[1][1] = b.z - fz * o;
  return 2;
}

// wa/wb: inverse-mass weights (0 = immovable). Returns impact speed (0 if no hit).
export function collide(a, b, wa, wb, e = 0.25) {
  const reach = a.half + b.half + 0.5;
  if (Math.abs(a.x - b.x) > reach || Math.abs(a.z - b.z) > reach) return 0;
  const na = circles(a, CA), nb = circles(b, CB);
  const wsum = wa + wb;
  if (wsum === 0) return 0;
  let impact = 0;
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
    let dx = CA[i][0] - CB[j][0], dz = CA[i][1] - CB[j][1];
    const d = Math.hypot(dx, dz), rr = a.r + b.r;
    if (d >= rr || d < 1e-5) continue;
    dx /= d; dz /= d;
    const pen = rr - d;
    a.x += dx * pen * wa / wsum; a.z += dz * pen * wa / wsum;
    b.x -= dx * pen * wb / wsum; b.z -= dz * pen * wb / wsum;
    const vn = (a.vx - b.vx) * dx + (a.vz - b.vz) * dz;
    if (vn < 0) {
      const jj = (-(1 + e) * vn) / wsum;
      a.vx += dx * jj * wa; a.vz += dz * jj * wa;
      b.vx -= dx * jj * wb; b.vz -= dz * jj * wb;
      const oax = CA[i][0] - a.x, oaz = CA[i][1] - a.z;
      a.yawRate = clamp(a.yawRate + (oaz * dx - oax * dz) * jj * wa * 0.035, -4, 4);
      const obx = CB[j][0] - b.x, obz = CB[j][1] - b.z;
      b.yawRate = clamp(b.yawRate - (obz * dx - obx * dz) * jj * wb * 0.035, -4, 4);
      impact = Math.max(impact, -vn);
    }
  }
  return impact;
}
