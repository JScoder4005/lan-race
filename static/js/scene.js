import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const C = (r, g, b) => new THREE.Color().setRGB(r, g, b);
export const SKIES = {
  tokyo: { top: C(0.003, 0.004, 0.02), horizon: C(0.04, 0.025, 0.085), glow: C(0.28, 0.05, 0.3), fog: C(0.045, 0.03, 0.075), density: 0.0008, panels: [0xff2e88, 0x39e6ff, 0xd6e6ff, 0xffc890] },
  sodium: { top: C(0.004, 0.005, 0.016), horizon: C(0.06, 0.04, 0.045), glow: C(0.36, 0.15, 0.05), fog: C(0.06, 0.045, 0.04), density: 0.0009, panels: [0xffb066, 0xffd9a0, 0xdfe8ff, 0x7cff6b] },
  coastal: { top: C(0.003, 0.006, 0.02), horizon: C(0.03, 0.045, 0.07), glow: C(0.18, 0.1, 0.16), fog: C(0.035, 0.045, 0.065), density: 0.0007, panels: [0xffb066, 0xdfe8ff, 0x39e6ff, 0xffd9a0] },
  hill: { top: C(0.006, 0.01, 0.02), horizon: C(0.05, 0.065, 0.08), glow: C(0.06, 0.06, 0.07), fog: C(0.06, 0.07, 0.08), density: 0.0024, panels: [0xdfe8ff, 0xffd9a0, 0xb8c8d8, 0xdfe8ff] },
};
export const FOG_COLOR = SKIES.tokyo.fog;

function skyMaterial(stars, sky = SKIES.tokyo) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: sky.top.clone() }, horizon: { value: sky.horizon.clone() }, glow: { value: sky.glow.clone() },
      moonDir: { value: new THREE.Vector3(-0.45, 0.42, -0.79).normalize() }, stars: { value: stars ? 1 : 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 top, horizon, glow, moonDir; uniform float stars; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 col = mix(horizon, top, smoothstep(-0.02, 0.5, h));
        col += glow * exp(-max(h, 0.0) * 10.0) * 0.55;
        float st = step(0.9982, hash(floor(d * 380.0))) * smoothstep(0.06, 0.35, h) * stars;
        col += vec3(0.9, 0.95, 1.0) * st * (0.6 + 0.6 * hash(floor(d * 97.0)));
        float m = dot(d, moonDir);
        col += vec3(1.0, 0.96, 0.88) * (smoothstep(0.99935, 0.9996, m) * 5.0 + pow(max(m, 0.0), 600.0) * 0.5 + pow(max(m, 0.0), 30.0) * 0.03);
        if (h < 0.0) col = mix(horizon + glow * 0.3, horizon * 0.5, smoothstep(0.0, -0.2, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export function addSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), skyMaterial(true));
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

export function applySky(sky, scene, name) {
  const s = SKIES[name] || SKIES.tokyo;
  const u = sky.material.uniforms;
  u.top.value.copy(s.top); u.horizon.value.copy(s.horizon); u.glow.value.copy(s.glow);
  scene.fog.color.copy(s.fog); scene.fog.density = s.density;
}

// Night-city reflection environment: dark sky, warm/cool light panels around the horizon.
export function buildEnvironment(renderer, name = 'tokyo') {
  const sky = SKIES[name] || SKIES.tokyo;
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(false, sky)));
  const mk = (color, i) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(i), side: THREE.DoubleSide });
  const [pc0, pc1, pc2, pc3] = sky.panels;
  const pink = mk(pc0, 3.5), cyan = mk(pc1, 3.5), cool = mk(pc2, 3), warm = mk(pc3, 2.5);
  const r = (a) => Math.sin(a * 12.9898) * 43758.5453 % 1;
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const mat = i % 3 === 0 ? pink : i % 3 === 1 ? cyan : i % 4 === 0 ? warm : cool;
    const w = 4 + Math.abs(r(i)) * 10, h = 1 + Math.abs(r(i + 9)) * 3;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    p.position.set(Math.cos(a) * 60, 3 + Math.abs(r(i + 3)) * 14, Math.sin(a) * 60);
    p.lookAt(0, 0, 0);
    env.add(p);
  }
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(6, 160), mk(0xdfe8ff, 1.6));
  strip.position.y = 40; strip.rotation.x = Math.PI / 2;
  env.add(strip);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x050506 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1;
  env.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, blur: { value: 0 }, time: { value: 0 }, mw: { value: 0 }, aspect: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float blur, time, mw, aspect; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 dir = vUv - 0.5;
      vec3 col;
      if (blur > 0.01) {
        float edge = smoothstep(0.12, 0.7, length(dir * vec2(aspect, 1.0)));
        float amt = blur * 0.07 * edge;
        col = vec3(0.0);
        for (int i = 0; i < 6; i++) {
          float s = 1.0 - amt * float(i) / 5.0;
          col.r += texture2D(tDiffuse, 0.5 + dir * (s - amt * 0.08)).r;
          col.g += texture2D(tDiffuse, 0.5 + dir * s).g;
          col.b += texture2D(tDiffuse, 0.5 + dir * (s + amt * 0.08)).b;
        }
        col /= 6.0;
      } else col = texture2D(tDiffuse, vUv).rgb;
      // tone mapping + sRGB here instead of a separate OutputPass (one less full-screen pass)
      col = linearToOutputTexel(vec4(toneMapping(col), 1.0)).rgb;
      if (mw > 0.5) {
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(l * 1.12, l * 0.98, l * 0.68), 0.58);
        col = clamp((col - 0.5) * 1.18 + 0.52, 0.0, 1.0) * vec3(1.06, 1.0, 0.86);
      }
      float v = smoothstep(0.95, 0.3, length(dir * vec2(aspect * 0.8, 1.0)));
      col *= mix(0.55, 1.0, v);
      col += (hash(vUv * 1000.0 + time) - 0.5) * 0.025;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createComposer(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.5, 0.32, 2.4);
  // Blur chain from quarter resolution instead of half: ~4x cheaper, the glow looks the same.
  const setBloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => setBloomSize(w / 2, h / 2);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  return { composer, bloom, grade };
}
