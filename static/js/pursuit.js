import { CarPhysics, collide, wrapAngle, clamp } from './physics.js';
import { CarVisual, POLICE_CAR } from './cars.js';

const MAX_COPS = [0, 2, 3, 4, 5, 6];
const LANES = [-6.75, -2.25, 2.25, 6.75];

export class Pursuit {
  constructor(scene, track) {
    this.scene = scene; this.track = track;
    this.cops = [];
    this.reset();
  }

  reset() {
    for (const c of this.cops) c.vis.dispose();
    this.cops = [];
    this.heat = 1; this.state = 'idle'; this.idleT = 4;
    this.bust = 0; this.cool = 0; this.bounty = 0; this.banked = 0;
    this.heatT = 0; this.spawnT = 0; this.blockT = 20; this.takedowns = 0;
  }

  clear() { for (const c of this.cops) c.vis.dispose(); this.cops = []; }

  spawn(me, ahead, roadblock = null) {
    const ph = new CarPhysics(this.track, { power: 1.12, grip: 1.05 });
    if (roadblock) {
      const p = this.track.sample(roadblock.dist, roadblock.lat);
      ph.x = p.x; ph.z = p.z; ph.yaw = p.yaw + Math.PI / 2 * (roadblock.lat > 0 ? 1 : -1);
      ph.updateTrack();
    } else if (ahead) {
      ph.place(me.dist + 240, LANES[Math.floor(Math.random() * 4)], 0);
      ph.yaw = wrapAngle(ph.yaw + Math.PI);
    } else {
      ph.place(me.dist - 150 - Math.random() * 60, LANES[Math.floor(Math.random() * 4)], Math.max(20, me.speed * 0.9));
    }
    const vis = new CarVisual(POLICE_CAR, 0x08090c, { police: true, beam: !roadblock });
    this.scene.add(vis.root);
    this.cops.push({ ph, vis, health: 100, dead: false, deadT: 0, stuckT: 0, block: !!roadblock, blockDist: roadblock?.dist });
  }

  // events: array to push {type, ...}
  update(dt, me, inputs, events, traffic, fx) {
    const T = this.track;
    if (this.state === 'idle') {
      this.idleT -= dt;
      if (this.idleT <= 0) { this.state = 'pursuit'; this.spawn(me, true); this.spawnT = 6; this.heatT = 0; events.push({ type: 'pursuit' }); }
    }
    const inPursuit = this.state === 'pursuit';

    if (inPursuit) {
      this.heatT += dt;
      if (this.heatT > 38 && this.heat < 5) { this.heat++; this.heatT = 0; events.push({ type: 'heat', heat: this.heat }); }
      this.spawnT -= dt;
      const alive = this.cops.filter((c) => !c.dead && !c.block).length;
      if (this.spawnT <= 0 && alive < MAX_COPS[this.heat]) { this.spawn(me, Math.random() < 0.25); this.spawnT = 7 - this.heat; }
      this.blockT -= dt;
      if (this.heat >= 3 && this.blockT <= 0) {
        const dist = me.dist + 650, gap = Math.floor(Math.random() * 4);
        LANES.forEach((lat, i) => { if (i !== gap) this.spawn(me, false, { dist, lat }); });
        this.blockT = 45;
        events.push({ type: 'roadblock' });
      }
      this.bounty += dt * this.heat * 40;
    }

    let nearest = Infinity;
    for (const c of this.cops) {
      const p = c.ph;
      if (c.dead) {
        c.deadT += dt;
        p.step(dt, { throttle: 0, brake: 0.3, steer: 0, handbrake: true, nitro: false });
        c.vis.lightsOn = false;
        if (Math.random() < 0.5) fx.smoke.emit(p.x, p.y + 1, p.z, (Math.random() - 0.5), 2.5, (Math.random() - 0.5), 2.5, 2, 3, 0.35);
      } else if (c.block) {
        p.vx = p.vz = 0;
        if (T.delta(me.dist, c.blockDist) > 160) c.remove = true;
      } else {
        this.drive(c, me, dt);
      }
      // collisions: player <-> cop
      const imp = collide(me, p, 1, c.block && !c.dead ? 0.15 : 0.8, 0.3);
      if (imp > 2) {
        events.push({ type: 'hit', impact: imp, x: p.x, z: p.z });
        if (!c.dead) {
          c.health -= imp * (c.block ? 4 : 3);
          if (inPursuit) this.bounty += 50;
          if (c.block && imp > 14) { c.block = false; c.health = 0; }
        }
      }
      if (traffic?.enabled) {
        const ti = traffic.collideBody(p, 1700, 0.2).impact;
        if (ti > 6 && !c.dead) c.health -= ti * 3;
      }
      if (p.wallImpact > 14 && !c.dead) c.health -= p.wallImpact * 2;
      if (!c.dead && c.health <= 0) {
        c.dead = true;
        this.takedowns++;
        if (inPursuit) { this.bounty += 1000 * this.heat; this.heatT += 8; }
        events.push({ type: 'takedown', x: p.x, z: p.z });
      }
      if (!c.dead) nearest = Math.min(nearest, Math.hypot(p.x - me.x, p.z - me.z));
      if (c.deadT > 6 || (c.block && c.remove)) c.gone = true;
      c.vis.update(dt, { x: p.x, z: p.z, y: p.y, pitch: p.pitch, yaw: p.yaw, fwd: p.fwd, steer: p.steer, braking: p.brake > 0.3 }, performance.now() / 1000);
    }
    // cop <-> cop
    for (let i = 0; i < this.cops.length; i++) for (let j = i + 1; j < this.cops.length; j++) {
      const a = this.cops[i], b = this.cops[j];
      collide(a.ph, b.ph, a.block ? 0 : 1, b.block ? 0 : 1, 0.2);
    }
    for (const c of this.cops) if (c.gone) c.vis.dispose();
    this.cops = this.cops.filter((c) => !c.gone);
    this.nearest = nearest;

    if (inPursuit) {
      if (nearest < 14 && me.speed < 5.5) this.bust = Math.min(1, this.bust + dt / 3);
      else this.bust = Math.max(0, this.bust - dt * 0.7);
      if (nearest > 230) this.cool = Math.min(1, this.cool + dt / 9);
      else if (nearest < 160) this.cool = Math.max(0, this.cool - dt * 0.6);
      if (this.bust >= 1) {
        events.push({ type: 'busted', lost: Math.floor(this.bounty) });
        this.bounty = 0; this.heat = 1; this.bust = 0; this.cool = 0;
        this.state = 'idle'; this.idleT = 8; this.clear();
      } else if (this.cool >= 1) {
        events.push({ type: 'evaded', bounty: Math.floor(this.bounty) });
        this.banked += Math.floor(this.bounty); this.bounty = 0; this.cool = 0; this.bust = 0;
        this.state = 'idle'; this.idleT = 10; this.clear();
      }
    }
  }

  drive(c, me, dt) {
    const p = c.ph, T = this.track;
    const d = Math.hypot(me.x - p.x, me.z - p.z);
    let tx, tz;
    if (d < 90) {
      const lead = Math.min(0.7, d / 45);
      tx = me.x + me.vx * lead; tz = me.z + me.vz * lead;
    } else {
      const along = T.delta(me.dist, p.dist);
      const dir = along >= 0 ? 1 : -1;
      const look = T.sample(p.dist + dir * 35, clamp(me.lateral, -6, 6));
      tx = look.x; tz = look.z;
    }
    const want = Math.atan2(tx - p.x, tz - p.z);
    const err = wrapAngle(want - p.yaw);
    const steer = clamp(-err * 2.6, -1, 1);
    let throttle = 1, brake = 0, handbrake = false;
    const curv = Math.abs(T.curv[T.idxAt(p.dist + 25 + p.speed * 0.9)[0]]);
    const corner = Math.sqrt(24 / Math.max(curv, 1e-4));
    if (d > 40 && p.fwd > corner + 3) { throttle = 0; brake = p.fwd > corner + 10 ? 1 : 0.4; }
    if (Math.abs(err) > 1.3) { if (p.fwd > 14) { throttle = 0; brake = 1; } handbrake = p.speed > 6 && p.speed < 30; }
    else if (Math.abs(err) > 0.55 && p.fwd > 48) throttle = 0.3;
    p.power = d > 260 ? 1.6 : d > 90 ? 1.28 : 1.1;
    const nitro = d > 140 && Math.abs(err) < 0.25;
    p.step(dt, { throttle, brake, steer, handbrake, nitro });
    if (p.speed < 2) c.stuckT += dt; else c.stuckT = 0;
    if (c.stuckT > 3 && d > 60) { p.place(me.dist - 160, LANES[Math.floor(Math.random() * 4)], Math.max(20, me.speed * 0.9)); c.stuckT = 0; }
  }

  // compact form for network: [[x,z,yaw,dead],...]
  snapshot() {
    return this.cops.map((c) => [Math.round(c.ph.x * 10) / 10, Math.round(c.ph.z * 10) / 10, Math.round(c.ph.yaw * 100) / 100, c.dead || !c.vis.lightsOn ? 1 : 0, Math.round(c.ph.y * 10) / 10]);
  }
}
