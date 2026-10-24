import * as THREE from 'three';

const PVS = `
attribute float size; attribute float alpha; varying float vA; uniform float scale;
void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * scale / -mv.z; }`;
const PFS = `
uniform vec3 color; varying float vA;
void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d) * vA; gl_FragColor = vec4(color, a); }`;

export class Particles {
  constructor(scene, max, color, additive) {
    this.max = max; this.n = 0; this.head = 0;
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max); this.a0 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.floor = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(...color) }, scale: { value: 600 } },
      vertexShader: PVS, fragmentShader: PFS, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, size, grow, alpha, grav = 0, drag = 0) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grow[i] = grow;
    this.a0[i] = alpha; this.alpha[i] = alpha; this.grav[i] = grav; this.drag[i] = drag; this.floor[i] = y - 0.4;
    this.busy = true;
  }

  update(dt, scale) {
    if (!this.busy) return;
    this.mat.uniforms.scale.value = scale;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      alive++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 2] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < this.floor[i]) { this.pos[i * 3 + 1] = this.floor[i]; this.vel[i * 3 + 1] *= -0.3; }
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.a0[i] * k * Math.min(1, (1 - k) * 8);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true; a.size.needsUpdate = true; a.alpha.needsUpdate = true;
    if (alive === 0) this.busy = false;
  }
}

export class Skidmarks {
  constructor(scene, max = 3000) {
    this.max = max; this.head = 0;
    this.pos = new Float32Array(max * 6 * 3);
    this.alpha = new Float32Array(max * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.01,0.01,0.012, vA); }',
      transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.last = new Map();
    this.dirty = false;
  }

  // key identifies one tire track; call every frame while sliding, stop() when not.
  add(key, x, z, dx, dz, strength, gy = 0) {
    const prev = this.last.get(key);
    this.last.set(key, [x, z]);
    if (!prev) return;
    const [px, pz] = prev;
    const seg = Math.hypot(x - px, z - pz);
    if (seg < 0.05 || seg > 4) return;
    const w = 0.16, nx = -dz * w, nz = dx * w, y = gy + 0.03;
    const q = [[px + nx, pz + nz], [px - nx, pz - nz], [x - nx, z - nz], [x + nx, z + nz]];
    const i = this.head; this.head = (this.head + 1) % this.max;
    const o = i * 18;
    const order = [0, 1, 2, 0, 2, 3];
    for (let k = 0; k < 6; k++) {
      const v = q[order[k]];
      this.pos[o + k * 3] = v[0]; this.pos[o + k * 3 + 1] = y; this.pos[o + k * 3 + 2] = v[1];
      this.alpha[i * 6 + k] = Math.min(0.6, strength);
    }
    this.dirty = true;
  }

  stop(key) { this.last.delete(key); }

  flush() {
    if (!this.dirty) return;
    const a = this.mesh.geometry.attributes;
    a.position.needsUpdate = true; a.alpha.needsUpdate = true;
    this.dirty = false;
  }
}

export class Rain {
  constructor(scene, n = 2600) {
    this.n = n;
    this.pos = new Float32Array(n * 6);
    this.seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.seed[i * 3] = Math.random(); this.seed[i * 3 + 1] = Math.random(); this.seed[i * 3 + 2] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(0.55, 0.62, 0.8), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.t = 0;
  }

  setCount(n) { this.count = Math.min(n, this.n); this.lines.geometry.setDrawRange(0, this.count * 2); }

  set visible(v) { this.lines.visible = v; }
  get visible() { return this.lines.visible; }

  // Drops live in a box that scrolls with the camera; vx/vz tilt streaks with player motion.
  update(dt, cam, vx, vz) {
    if (!this.lines.visible) return;
    this.t += dt;
    const S = 70, H = 34, fall = 26, len = 0.75;
    const tx = -vx * 0.025, tz = -vz * 0.025;
    for (let i = 0; i < (this.count ?? this.n); i++) {
      const sx = this.seed[i * 3], sy = this.seed[i * 3 + 1], sz = this.seed[i * 3 + 2];
      const x = cam.x + ((((sx * S - cam.x) % S) + S) % S) - S / 2;
      const z = cam.z + ((((sz * S - cam.z) % S) + S) % S) - S / 2;
      const y = cam.y + H * 0.6 - ((sy * H + this.t * fall) % H);
      const o = i * 6;
      this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
      this.pos[o + 3] = x + tx; this.pos[o + 4] = y - len; this.pos[o + 5] = z + tz;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
