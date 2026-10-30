import * as THREE from 'three';
import { EffectComposer } from '../vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../vendor/addons/postprocessing/OutputPass.js';
import { SMAAPass } from '../vendor/addons/postprocessing/SMAAPass.js';
import { OrbitControls } from '../vendor/addons/controls/OrbitControls.js';
import { TAU, clamp, lerp, ss, damp, wrap, hgt, coastR, roadR, Track, Spring, canvasTex } from './util.js';
import { createWorld } from './world.js';
import { Rider, makeFish } from './rider.js';
import { AudioEngine } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem('velo.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('velo.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
async function progress(p, label) { $('bar').style.width = (p * 100).toFixed(0) + '%'; $('loadmsg').textContent = label; await nextFrame(); }
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- renderer
function webglOK() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }
if (!webglOK()) {
  $('loader').classList.add('fail');
  $('loadmsg').textContent = '你的浏览器没有开启 WebGL，无法显示 3D 场景。请换用新版 Chrome、Edge、Safari 或 Firefox。';
  throw new Error('WebGL unavailable');
}

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#bcd5e6', 0.0045);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 2500);
camera.position.set(80, 40, 80);

const U = {
  uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
  uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
  uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() }, uCloud: { value: 0.2 },
  uNight: { value: 0 }, uRain: { value: 0 }, uRainbow: { value: 0 }, uWind: { value: 0.6 },
  uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uFogColor: { value: new THREE.Color() },
  uFogDensity: { value: 0.0045 }, uAmbient: { value: new THREE.Color() },
};

// ---------------------------------------------------------------- lights
const sun = new THREE.DirectionalLight('#ffffff', 3);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 160 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#bcd8ff', '#6b5a3a', 0.5); scene.add(hemi);

// ---------------------------------------------------------------- post-processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.55, 0.9);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.32 }, uCA: { value: 0.002 }, uGrain: { value: 0.035 }, uFlash: { value: 0 }, uSat: { value: 1.06 }, uTilt: { value: 0 }, uLines: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: [
    'uniform sampler2D tDiffuse; uniform float uTime, uVig, uCA, uGrain, uFlash, uSat, uTilt, uLines; uniform vec2 uRes;',
    'varying vec2 vUv;',
    'float h11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }',
    'void main(){',
    '  float asp = uRes.x / uRes.y;',
    '  vec2 c = vUv - 0.5; float r = length(c * vec2(asp, 1.0)) / length(vec2(asp, 1.0)) * 1.42;',
    '  vec2 off = c * uCA * r;',
    '  vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);',
    '  if (uTilt > 0.001) {',
    '    float b = uTilt * pow(clamp(abs(vUv.y - 0.55) * 2.2, 0.0, 1.0), 2.0) * 3.0 / uRes.y;',
    '    vec3 acc = col;',
    '    for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398;',
    '      acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a) * asp) * b * 2.0).rgb;',
    '      acc += texture2D(tDiffuse, vUv + vec2(cos(a + 0.39), sin(a + 0.39) * asp) * b * 4.0).rgb; }',
    '    col = acc / 17.0;',
    '  }',
    '  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));',
    '  col = mix(vec3(l), col, uSat);',
    '  if (uLines > 0.001) {',
    '    float a = atan(c.y, c.x * asp);',
    '    float s = step(0.93, h11(floor(a * 70.0) + floor(uTime * 14.0) * 7.0)) * smoothstep(0.35, 0.8, r);',
    '    col += s * uLines * 0.3 * (0.5 + l);',
    '  }',
    '  col *= 1.0 - uVig * smoothstep(0.3, 0.95, r);',
    '  col += uFlash * vec3(0.75, 0.82, 1.0);',
    '  float g = fract(sin(dot(vUv * uRes + fract(uTime) * 91.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;',
    '  col *= 1.0 + g * uGrain;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'].join('\n'),
});
composer.addPass(grade);
composer.addPass(new OutputPass());
const smaa = new SMAAPass(innerWidth, innerHeight);
composer.addPass(smaa);

// ---------------------------------------------------------------- state
const track = new Track();
const initialCam = ['chase', 'cinema', 'orbit', 'pov'].includes(params.get('cam')) ? params.get('cam') : null;
const st = {
  started: false, paused: false, time: 0, tod: clamp(parseFloat(params.get('t') ?? '0.69'), 0, 1), flow: params.get('flow') !== '0', daySec: 480,
  weather: ['clear', 'cloudy', 'rain'].includes(params.get('weather')) ? params.get('weather') : 'clear',
  s: track.len * 0.02, lat: 0.4, latVel: 0, speed: 0, cruise: 7, boost: false, brake: false, auto: params.get('auto') !== '0',
  y: 0, vy: 0, grounded: true, airT: 0, lean: 0, steer: 0, cadence: 0, effort: 0, pitch: 0, coasting: false, onRamp: null,
  distance: 0, laps: 0, fish: 0, gold: 0, score: 0, combo: 1, comboT: 0, best: store.get('best', 0),
  cam: 'cinema', quality: store.get('quality', 'auto'), night: 0, rain: 0, flash: 0, rainbow: 0, wave: 0, soundWanted: false,
};
const env = { night: 0, rain: 0, day: 1 };
const input = { left: false, right: false, up: false, down: false };
const audio = new AudioEngine();
audio.music = store.get('music', true);

let world, rider, rain, sparks, dust, bolt, controls, pmrem, envRT, envScene;
const fishes = [], ramps = [];
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), F = {}, F2 = {};

// ---------------------------------------------------------------- particles
class Particles {
  constructor(max, blending, size) {
    this.max = max; this.i = 0; this.size = size;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.a = new Float32Array(max); this.sz = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.max0 = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: 1 } }, transparent: true, depthWrite: false, blending, vertexColors: true,
      vertexShader: 'uniform float uPx; attribute float alpha; attribute float size; varying float vA; varying vec3 vC; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = alpha; vC = color; gl_PointSize = uPx * size * 300.0 / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC, a); }',
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
  }
  emit(p, n, { speed = 2, up = 1, color = [1, 1, 1], life = 1, size = this.size, drag = 1.5, grav = -2, spread = 0.1 } = {}) {
    for (let k = 0; k < n; k++) {
      const i = this.i = (this.i + 1) % this.max;
      const th = Math.random() * TAU, ph = Math.acos(Math.random() * 2 - 1), v = speed * (0.4 + Math.random() * 0.6);
      this.pos.set([p.x + (Math.random() - 0.5) * spread, p.y + (Math.random() - 0.5) * spread, p.z + (Math.random() - 0.5) * spread], i * 3);
      this.vel.set([Math.sin(ph) * Math.cos(th) * v, Math.abs(Math.cos(ph)) * v * up, Math.sin(ph) * Math.sin(th) * v], i * 3);
      this.col.set(typeof color === 'function' ? color() : color, i * 3);
      this.life[i] = this.max0[i] = life * (0.6 + Math.random() * 0.4);
      this.sz[i] = size * (0.6 + Math.random() * 0.8); this.drag[i] = drag; this.grav[i] = grav;
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.a[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(this.life[i], 0) / this.max0[i];
      this.a[i] = Math.sin(Math.PI * Math.sqrt(1 - t)) * t * 1.6;
    }
    const at = this.points.geometry.attributes;
    at.position.needsUpdate = at.alpha.needsUpdate = at.color.needsUpdate = at.size.needsUpdate = true;
  }
}

function makeRain() {
  const N = 6000, pos = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = Math.random() * 60, y = Math.random(), z = Math.random() * 60;
    pos.set([x, y, z, x, y, z], i * 6); end[i * 2] = 0; end[i * 2 + 1] = 1;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('end', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uRain: U.uRain, uLit: { value: new THREE.Color() } }, transparent: true, depthWrite: false,
    vertexShader: [
      'uniform float uTime; attribute float end; varying float vE;',
      'void main(){',
      '  vec3 p = position;',
      '  float sp = 18.0 + fract(p.x * 7.13 + p.z * 3.7) * 8.0;',
      '  float y = mod(p.y * 30.0 - uTime * sp, 30.0) - 6.0;',
      '  vec3 w = vec3(mod(p.x - cameraPosition.x, 60.0) - 30.0 + cameraPosition.x, cameraPosition.y + y, mod(p.z - cameraPosition.z, 60.0) - 30.0 + cameraPosition.z);',
      '  w -= normalize(vec3(2.5, -sp, 1.0)) * end * 0.55;',
      '  vE = end;',
      '  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);',
      '}'].join('\n'),
    fragmentShader: 'uniform float uRain; uniform vec3 uLit; varying float vE; void main(){ gl_FragColor = vec4(uLit, (1.0 - vE) * 0.32 * uRain); }',
  });
  const m = new THREE.LineSegments(g, mat); m.frustumCulled = false; m.renderOrder = 6;
  return m;
}

function glowTex() {
  return canvasTex(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,200,0.45)'); gr.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
}

// ---------------------------------------------------------------- ramps & fish
function buildRamps() {
  const tex = canvasTex(256, 128, (g, w, h) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#9a6838' : '#c08a52'; g.fillRect(0, i * 16, w, 16); }
    g.fillStyle = '#ffcf33';
    for (let x = -h; x < w; x += 48) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 24, h); g.lineTo(x + 24 + h * 0.5, h * 0.5); g.lineTo(x + h * 0.5, h * 0.5); g.fill(); }
  });
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 });
  const side = new THREE.MeshStandardMaterial({ color: '#7d5530', roughness: 0.85 });
  const shape = new THREE.Shape([new THREE.Vector2(-1, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 0.42), new THREE.Vector2(0.92, 0.42)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.5, bevelEnabled: false }).translate(0, 0, -0.75);
  for (const frac of [0.14, 0.33, 0.58, 0.84]) {
    const s = track.len * frac, f = track.frame(s, 0, {});
    const m = new THREE.Mesh(geo, [side, top]);
    m.position.set(f.x, f.y - 0.02, f.z); m.rotation.set(0, f.heading, 0, 'YXZ');
    m.castShadow = m.receiveShadow = true; scene.add(m);
    ramps.push({ s, lat: 0, mesh: m });
  }
}

function rampHeight(s, lat) {
  for (const r of ramps) {
    let ds = s - r.s; ds -= Math.round(ds / track.len) * track.len;
    if (ds > -1 && ds < 1 && Math.abs(lat - r.lat) < 0.75) return { h: 0.42 * (ds + 1) / 2, ramp: r, ds };
  }
  return null;
}

function buildFish() {
  const halo = new THREE.SpriteMaterial({ map: glowTex(), color: '#ffe9b0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 });
  const goldHalo = halo.clone(); goldHalo.color.set('#ffc640'); goldHalo.opacity = 0.9;
  const add = (s, lat, high, gold) => {
    const g = new THREE.Group(), fish = makeFish(3.2, gold); g.add(fish);
    const sp = new THREE.Sprite(gold ? goldHalo : halo); sp.scale.setScalar(gold ? 1.7 : 1.1); g.add(sp);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    fishes.push({ s, lat, high, gold, g, fish, active: true, respawn: 0, phase: Math.random() * TAU });
  };
  const n = 40;
  for (let i = 0; i < n; i++) {
    const s = track.len * (0.06 + (i / n) * 0.94) + Math.sin(i * 7.1) * 1.2;
    if (ramps.some((r) => Math.abs(wrap(s - r.s + track.len / 2, track.len) - track.len / 2) < 8)) continue;
    add(s, Math.sin(i * 2.17) * 1.35, false, i % 8 === 5);
  }
  for (const r of ramps) { add(r.s + 4.2, 0, true, true); add(r.s + 6.4, 0, true, false); }
}

function placeFish(f, t) {
  track.frame(f.s, f.lat, F2);
  f.g.position.set(F2.x, F2.y + (f.high ? 2.75 : 1.55) + Math.sin(t * 2 + f.phase) * 0.12, F2.z);
  f.fish.rotation.set(0, t * 1.6 + f.phase, Math.sin(t * 3 + f.phase) * 0.25);
  f.fish.userData.tail.rotation.y = Math.sin(t * 10 + f.phase) * 0.5;
}

// ---------------------------------------------------------------- environment palette
const KEYS = [
  { h: -0.4, top: '#02040b', hor: '#0b1324', sun: '#7d8fd0', amb: 0.16, fog: '#0a111d', deep: '#010812', shallow: '#0b3240', cl: '#2a3352', cs: '#06090f', gnd: '#04070c' },
  { h: -0.1, top: '#0e1838', hor: '#5d4a6a', sun: '#ff8a64', amb: 0.3, fog: '#352f48', deep: '#041726', shallow: '#185862', cl: '#c98a8a', cs: '#2a2440', gnd: '#141220' },
  { h: 0.02, top: '#2e4f93', hor: '#ff9e6a', sun: '#ff9a52', amb: 0.55, fog: '#d39a7f', deep: '#0b2f4f', shallow: '#2f8f95', cl: '#ffc08e', cs: '#7a5a72', gnd: '#5a4a48' },
  { h: 0.16, top: '#3a74c8', hor: '#f3d6b5', sun: '#ffd9a8', amb: 0.8, fog: '#d8d4cb', deep: '#0c3d63', shallow: '#33b0ae', cl: '#fff3e2', cs: '#9aa3b7', gnd: '#8a8270' },
  { h: 0.5, top: '#2a69cc', hor: '#b5d6f0', sun: '#fff6ea', amb: 1.0, fog: '#b6d2e8', deep: '#0a4170', shallow: '#3cc6c0', cl: '#ffffff', cs: '#a7b4c8', gnd: '#8b8a7a' },
  { h: 1.0, top: '#1f5fc6', hor: '#a8cff0', sun: '#ffffff', amb: 1.05, fog: '#acd0ea', deep: '#08447a', shallow: '#3fcfc6', cl: '#ffffff', cs: '#aab6c8', gnd: '#8b8a7a' },
].map((k) => { const o = { h: k.h, amb: k.amb }; for (const n of ['top', 'hor', 'sun', 'fog', 'deep', 'shallow', 'cl', 'cs', 'gnd']) o[n] = new THREE.Color(k[n]); return o; });
const PAL = { top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), fog: new THREE.Color(), deep: new THREE.Color(), shallow: new THREE.Color(), cl: new THREE.Color(), cs: new THREE.Color(), gnd: new THREE.Color(), amb: 1 };
const GREY = new THREE.Color('#6d7682'), GREY_D = new THREE.Color('#3b434e'), MOON = new THREE.Color('#9db0ff'), WHITE = new THREE.Color(1, 1, 1);
const greyMix = new THREE.Color();
const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
let envDirty = 1e9, lastEnvKey = '';

function updateEnvironment(dt) {
  if (st.flow && st.started) st.tod = wrap(st.tod + dt / st.daySec, 1);
  const ang = (st.tod - 0.25) * TAU;
  sunDir.set(Math.cos(ang), Math.sin(ang) * 0.92, 0.42).normalize();
  const h = sunDir.y;
  let i = 0; while (i < KEYS.length - 2 && h > KEYS[i + 1].h) i++;
  const A = KEYS[i], B = KEYS[i + 1], k = ss(A.h, B.h, h);
  for (const n of ['top', 'hor', 'sun', 'fog', 'deep', 'shallow', 'cl', 'cs', 'gnd']) PAL[n].copy(A[n]).lerp(B[n], k);
  PAL.amb = lerp(A.amb, B.amb, k);
  const cloudTarget = { clear: 0.15, cloudy: 0.62, rain: 0.97 }[st.weather];
  U.uCloud.value = damp(U.uCloud.value, cloudTarget, 0.4, dt);
  st.rain = damp(st.rain, st.weather === 'rain' ? 1 : 0, 0.35, dt);
  const rn = st.rain, cl = U.uCloud.value;
  const grey = rn * 0.75 + Math.max(cl - 0.3, 0) * 0.35;
  const dayK = ss(-0.12, 0.15, h);
  greyMix.copy(GREY_D).lerp(GREY, dayK).multiplyScalar(lerp(0.15, 1, dayK));
  for (const n of ['top', 'hor', 'fog']) PAL[n].lerp(greyMix, grey * 0.8);
  PAL.cl.lerp(GREY, grey * 0.7 * dayK);
  PAL.cs.lerp(GREY_D, grey * 0.6);
  st.night = env.night = 1 - ss(-0.16, 0.02, h);
  env.rain = rn; env.day = dayK;
  U.uNight.value = st.night; U.uRain.value = rn;
  U.uSunDir.value.copy(sunDir); U.uSunColor.value.copy(PAL.sun);
  U.uTop.value.copy(PAL.top); U.uHorizon.value.copy(PAL.hor); U.uGround.value.copy(PAL.gnd);
  U.uCloudLit.value.copy(PAL.cl); U.uCloudShade.value.copy(PAL.cs);
  U.uDeep.value.copy(PAL.deep).multiplyScalar(lerp(1, 0.6, rn)); U.uShallow.value.copy(PAL.shallow).lerp(GREY, rn * 0.4);
  U.uFogColor.value.copy(PAL.fog);
  const dens = lerp(0.0042, 0.0055, st.night) + rn * 0.011 + cl * 0.0012;
  U.uFogDensity.value = dens; scene.fog.density = dens; scene.fog.color.copy(PAL.fog);
  U.uAmbient.value.copy(WHITE).lerp(PAL.hor, 0.3).multiplyScalar(PAL.amb * (1 - rn * 0.35) + st.flash * 1.5);
  U.uWind.value = damp(U.uWind.value, 0.6 + rn * 1.3 + cl * 0.3, 0.5, dt);
  // a rainbow lingers after a storm while the sun is low and out
  if (st.weather === 'rain') st.rainbow = Math.max(st.rainbow, rn); else st.rainbow = Math.max(0, st.rainbow - dt / 45);
  U.uRainbow.value = (st.weather !== 'rain' ? st.rainbow * (1 - rn) * 3 : 0) * ss(0.02, 0.1, h) * (1 - ss(0.55, 0.7, h)) * (1 - cl * 0.6);
  // key light: sun by day, moon by night
  moonDir.copy(sunDir).negate(); moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.25; moonDir.normalize();
  const sunK = ss(-0.04, 0.08, h) * (1 - rn * 0.75) * (1 - Math.max(cl - 0.4, 0) * 0.8);
  const moonK = st.night * (1 - rn * 0.7) * (1 - cl * 0.5);
  const useSun = h > -0.03;
  const dir = useSun ? sunDir : moonDir;
  sun.color.copy(useSun ? PAL.sun : MOON);
  sun.intensity = useSun ? 3.4 * sunK : 0.55 * moonK;
  hemi.color.copy(PAL.top).lerp(PAL.hor, 0.5); hemi.groundColor.copy(PAL.gnd);
  hemi.intensity = 0.25 + PAL.amb * 0.45 + st.flash * 4;
  const rp = rider ? rider.root.position : tmp.set(0, 0, 0);
  sun.position.copy(rp).addScaledVector(dir, 70); sun.target.position.copy(rp);
  renderer.toneMappingExposure = lerp(1.0, 1.45, st.night) * lerp(1, 1.12, rn);
  // refresh image-based lighting when the sky changes noticeably
  envDirty += dt;
  const key = [h.toFixed(2), cl.toFixed(1), rn.toFixed(1)].join();
  if ((key !== lastEnvKey && envDirty > 1.2) || envDirty > 20) { lastEnvKey = key; envDirty = 0; refreshEnv(); }
}

function refreshEnv() {
  if (!pmrem) return;
  const old = envRT;
  envRT = pmrem.fromScene(envScene, 0.02, 0.1, 2000);
  scene.environment = envRT.texture;
  if (old) old.dispose();
}

// ---------------------------------------------------------------- simulation
const susp = new Spring(160, 14, 0);
let shake = 0;
function simulate(dt) {
  track.frame(st.s, st.lat, F);
  const target = st.brake ? 0 : st.boost ? 13.5 : st.cruise;
  const pedalling = st.started && !st.paused && st.speed < target - 0.2 && st.grounded;
  st.coasting = !pedalling;
  let acc = 0;
  if (pedalling) acc += 3.2 * (1 - st.speed / 17) * (st.boost ? 1.4 : 1);
  acc -= 0.08 + 0.0055 * st.speed * st.speed;
  if (st.grounded) acc -= 9.8 * Math.sin(Math.atan(F.slope)) * 0.9;
  if (st.brake || st.speed > target + 1.5) acc -= st.brake ? 6 : 1.2;
  if (!st.started) acc = (3.5 - st.speed) * 0.8; // attract mode: steady cruise
  st.speed = clamp(st.speed + acc * dt, 0, 18);
  st.effort = damp(st.effort, pedalling || !st.started ? clamp(0.3 + F.slope * 5 + (st.boost ? 0.6 : 0) + (target - st.speed) * 0.08, 0, 1) : 0, 4, dt);
  const cadTarget = pedalling || !st.started ? st.speed / 0.367 / 2.4 + 1.5 : 0;
  st.cadence = damp(st.cadence, cadTarget, 5, dt);

  // steering: autopilot chases fish and lines up ramps, manual follows the keys
  if (st.auto || !st.started) {
    let best = null, bd = 1e9, latTarget = null;
    for (const f of fishes) {
      if (!f.active) continue;
      const d = wrap(f.s - st.s, track.len);
      if (d > 3 && d < 28 && d < bd) { bd = d; best = f; }
    }
    for (const r of ramps) { const d = wrap(r.s - st.s, track.len); if (d > 0 && d < 16) { latTarget = r.lat; break; } }
    if (latTarget === null) latTarget = best ? best.lat : Math.sin(st.distance * 0.05) * 0.9;
    st.latVel = damp(st.latVel, clamp((latTarget - st.lat) * 1.6, -1.7, 1.7), 4, dt);
  } else {
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    st.latVel = damp(st.latVel, dir * 2.3, 6, dt);
  }
  st.lat = clamp(st.lat + st.latVel * dt * clamp(st.speed / 3, 0.2, 1), -1.75, 1.75);
  st.s = wrap(st.s + st.speed * dt, track.len);
  st.distance += st.speed * dt;
  const lap = Math.floor(st.distance / track.len);
  if (lap > st.laps) { st.laps = lap; if (st.started) { toast('第 ' + lap + ' 圈完成 · 奖励 +100', 'gold'); addScore(100, false); } }

  // vertical: ground, ramps, jumps
  track.frame(st.s, st.lat, F);
  const rh = rampHeight(st.s, st.lat);
  const ground = F.y + (rh ? rh.h : 0);
  if (st.grounded) {
    const wasOn = st.onRamp;
    st.onRamp = rh ? rh.ramp : null;
    st.y = ground; st.vy = 0;
    if (wasOn && !st.onRamp && st.speed > 1.5) launch(2.6 + st.speed * 0.2, true);
  } else {
    st.vy -= 9.8 * dt; st.y += st.vy * dt; st.airT += dt;
    if (st.y <= ground) {
      st.y = ground; st.grounded = true;
      const impact = clamp(-st.vy / 5, 0.2, 1.4);
      susp.kick(-impact * 1.6); shake = reduceMotion ? 0 : impact * 0.3;
      audio.thump(impact);
      dust.emit(tmp.set(F.x, F.y + 0.1, F.z), 26, { speed: 2.2 * impact, up: 0.5, color: () => [0.85, 0.78, 0.62], life: 1.1, size: 0.35, drag: 2.2, grav: 0.2, spread: 0.6 });
      if (st.airT > 0.55 && st.started) { const b = Math.round(st.airT * 60); toast('腾空 ' + st.airT.toFixed(2) + ' 秒 · +' + b); addScore(b, false); }
      st.airT = 0;
    }
  }
  const sp = susp.step(0, dt);

  // pose: lean into curves, pitch with slope, yaw follows lane changes
  st.lean = damp(st.lean, clamp(Math.atan((st.speed * st.speed * F.k) / 9.8) + st.latVel * 0.14, -0.55, 0.55), 5, dt);
  st.steer = damp(st.steer, -clamp(Math.atan(F.k * 1.04) * 1.5 + st.latVel * 0.09, -0.5, 0.5), 6, dt);
  const hd = F.heading - Math.atan2(st.latVel * clamp(st.speed / 3, 0.2, 1), Math.max(st.speed, 0.6));
  const pitch = st.grounded ? Math.atan(F.slope) + (rh ? Math.atan(0.21) : 0) : Math.atan2(st.vy, Math.max(st.speed, 1)) * 0.5;
  st.pitch = damp(st.pitch, pitch, st.grounded ? 12 : 3, dt);
  rider.root.position.set(F.x, st.y + Math.min(sp, 0) * 0.05, F.z);
  rider.root.rotation.set(st.lean, hd, st.pitch, 'YXZ');
  rider.root.updateMatrixWorld(true);

  // where the pelican looks: the next fish, the camera during cinematic face shots, or idly around
  let look = { yaw: Math.sin(st.time * 0.35) * 0.25, pitch: 0 }, jaw = st.speed > 9 ? 0.06 + Math.sin(st.time * 20) * 0.02 : 0;
  let nearest = null, nd = 1e9;
  for (const f of fishes) { if (!f.active) continue; const d = wrap(f.s - st.s, track.len); if (d < 14 && d < nd) { nd = d; nearest = f; } }
  if (nearest) {
    tmp.copy(nearest.g.position); rider.root.worldToLocal(tmp);
    look = { yaw: clamp(Math.atan2(-tmp.z, tmp.x), -0.9, 0.9), pitch: clamp(Math.atan2(tmp.y - 1.75, Math.max(tmp.x, 0.5)), -0.4, 0.6) };
    if (nd < 3.5) jaw = Math.max(jaw, 0.28);
  } else if (st.cam === 'cinema' && cine.shot && cine.shot.face) {
    tmp.copy(camera.position); rider.root.worldToLocal(tmp);
    if (tmp.x > 0) look = { yaw: clamp(Math.atan2(-tmp.z, tmp.x), -0.9, 0.9), pitch: 0.05 };
  }
  st.wave = Math.max(0, st.wave - dt);
  rider.update(dt, { time: st.time, speed: st.speed, cadence: st.cadence, steer: st.steer, effort: st.effort, lean: st.lean, look, jaw, wave: st.wave > 0 && st.grounded, flap: st.grounded ? 0 : clamp(st.airT * 4, 0, 1) });
  rider.root.updateMatrixWorld(true);
  const vel = tmp2.set(F.tx, 0, F.tz).multiplyScalar(st.speed); vel.y = st.vy;
  rider.updateScarf(dt, vel, tmp.set(1.5, 0, 0.8).multiplyScalar(U.uWind.value), st.time);

  // fish pickup
  const head = tmp.set(0.5, 1.75, 0).applyMatrix4(rider.root.matrixWorld);
  for (const f of fishes) {
    if (!f.active) {
      f.respawn -= dt;
      if (f.respawn <= 0 && wrap(f.s - st.s, track.len) > 40) { f.active = true; f.g.visible = true; f.g.scale.setScalar(0.01); }
      continue;
    }
    if (f.g.scale.x < 1) f.g.scale.setScalar(Math.min(1, f.g.scale.x + dt * 2));
    if (f.g.position.distanceTo(head) < 1.05) collect(f);
  }
  st.comboT = Math.max(0, st.comboT - dt); if (st.comboT === 0) st.combo = 1;
}

function launch(vy, fromRamp) {
  if (!st.grounded) return;
  st.grounded = false; st.vy = vy; st.airT = 0; st.onRamp = null;
  audio.whoosh();
  track.frame(st.s, st.lat, F);
  dust.emit(tmp.set(F.x, F.y + 0.05, F.z), fromRamp ? 10 : 6, { speed: 1.4, up: 0.4, color: () => [0.82, 0.76, 0.62], life: 0.8, size: 0.25, drag: 2.5, grav: 0.1, spread: 0.4 });
}
function jump() { if (st.grounded && st.speed > 0.5) launch(3.3, false); }

function addScore(n, combo = true) {
  st.score += Math.round(n * (combo ? st.combo : 1));
  if (st.score > st.best) { st.best = st.score; store.set('best', st.best); }
}

function collect(f) {
  f.active = false; f.g.visible = false; f.respawn = 25;
  const pts = (f.gold ? 50 : 10) * (f.high ? 2 : 1);
  if (st.started) {
    toast((f.gold ? '金鱼！' : '小鱼 ') + '+' + Math.round(pts * st.combo) + (st.combo > 1 ? '  ×' + st.combo : ''), f.gold ? 'gold' : '');
    addScore(pts);
    st.fish++; if (f.gold) st.gold++;
    st.combo = Math.min(st.combo + 1, 8); st.comboT = 4.5;
  }
  rider.gulp(); audio.collect(f.gold);
  const c = f.gold ? () => [1.0, 0.75 + Math.random() * 0.2, 0.25] : () => [0.75 + Math.random() * 0.25, 0.92, 1.0];
  sparks.emit(f.g.position, f.gold ? 70 : 36, { speed: f.gold ? 5 : 3.5, up: 1, color: c, life: 1.1, size: f.gold ? 0.24 : 0.16, drag: 2.4, grav: -1.5, spread: 0.3 });
}

// ---------------------------------------------------------------- cameras
const cine = { i: -1, t: 0, shot: null, cut: false, fixed: new THREE.Vector3() };
const chase = { yaw: 0, pitch: 0, drag: false, idle: 0, px: 0, py: 0 };
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), lastRider = new THREE.Vector3();

function riderBasis() {
  return {
    p: new THREE.Vector3().setFromMatrixPosition(rider.root.matrixWorld),
    fwd: new THREE.Vector3(F.tx, 0, F.tz).normalize(), right: new THREE.Vector3(F.rx, 0, F.rz).normalize(), up: new THREE.Vector3(0, 1, 0),
  };
}

// The track's right vector points inland, so negative "right" offsets put the camera on the sea side.
const SHOTS = [
  { name: '侧面跟拍', dur: 7, f: (b, t) => ({ pos: b.p.clone().addScaledVector(b.right, -5.2).addScaledVector(b.fwd, 0.6 + Math.sin(t * 0.3) * 0.6).add(V3(0, 1.25, 0)), look: b.p.clone().add(V3(0, 1.05, 0)), fov: 42 }) },
  { name: '正面低机位', dur: 6, face: true, f: (b, t) => ({ pos: b.p.clone().addScaledVector(b.fwd, 4.8 - t * 0.15).addScaledVector(b.right, -0.9).add(V3(0, 0.55, 0)), look: b.p.clone().add(V3(0, 1.2, 0)), fov: 46 }) },
  { name: '航拍', dur: 8, tilt: 1, f: (b, t) => ({ pos: b.p.clone().addScaledVector(b.fwd, -10 + t * 1.2).addScaledVector(b.right, -9).add(V3(0, 15 - t * 0.4, 0)), look: b.p.clone().addScaledVector(b.fwd, 2), fov: 38 }) },
  { name: '车轮特写', dur: 5, f: (b, t) => ({ pos: b.p.clone().addScaledVector(b.right, -1.35).addScaledVector(b.fwd, -0.9 + t * 0.12).add(V3(0, 0.42, 0)), look: b.p.clone().addScaledVector(b.fwd, 0.1).add(V3(0, 0.55, 0)), fov: 50 }) },
  { name: '路边定点', dur: 7, face: true, fixed: true, f: (b) => ({ pos: cine.fixed, look: b.p.clone().add(V3(0, 1.1, 0)), fov: 34 }) },
  { name: '环绕', dur: 9, face: true, f: (b, t) => { const a = t * 0.45 + 0.5; return { pos: b.p.clone().addScaledVector(b.fwd, Math.cos(a) * 6).addScaledVector(b.right, -Math.sin(a) * 6).add(V3(0, 2.2, 0)), look: b.p.clone().add(V3(0, 1.1, 0)), fov: 44 }; } },
  { name: '灯塔远景', dur: 8, tilt: 0.6, f: (b) => { const lh = world.lighthouse, d = b.p.clone().sub(lh).setY(0).normalize(); return { pos: b.p.clone().addScaledVector(d, 14).addScaledVector(b.fwd, -6).add(V3(0, 6.5, 0)), look: b.p.clone().lerp(lh, 0.3).add(V3(0, 2, 0)), fov: 50 }; } },
];

function nextShot() {
  cine.i = (cine.i + 1) % SHOTS.length; cine.t = 0; cine.shot = SHOTS[cine.i];
  if (cine.shot.fixed) { track.frame(st.s + st.speed * 3.2 + 4, -3.8, F2); cine.fixed.set(F2.x, F2.y + 1.15, F2.z); }
  cine.cut = true;
  const el = $('shotname'); el.textContent = cine.shot.name; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

function updateCamera(dt) {
  const b = riderBasis();
  let pos, look, fov = 55, tilt = 0, snap = false, lambda = 5;
  if (st.cam === 'orbit') {
    const d = b.p.clone().sub(lastRider);
    camera.position.add(d); controls.target.add(d); controls.update();
    lastRider.copy(b.p);
    camera.fov = damp(camera.fov, 50, 3, dt); camera.updateProjectionMatrix();
    grade.uniforms.uTilt.value = damp(grade.uniforms.uTilt.value, 0, 4, dt);
    return;
  }
  if (st.cam === 'chase') {
    if (!chase.drag) { chase.idle += dt; if (chase.idle > 2.5) { chase.yaw = damp(chase.yaw, 0, 1.5, dt); chase.pitch = damp(chase.pitch, 0, 1.5, dt); } }
    const back = b.fwd.clone().negate().applyAxisAngle(b.up, chase.yaw);
    const dist = 4.4 + st.speed * 0.13;
    pos = b.p.clone().addScaledVector(back, dist * Math.cos(chase.pitch)).add(V3(0, 1.85 + dist * Math.sin(chase.pitch), 0)).addScaledVector(b.right, -0.25);
    look = b.p.clone().add(V3(0, 1.15, 0)).addScaledVector(b.fwd, 1.6);
    fov = 54 + st.speed * 1.05 + (st.boost ? 4 : 0); lambda = 4.5;
  } else if (st.cam === 'cinema') {
    cine.t += dt;
    if (!cine.shot || cine.t > cine.shot.dur) nextShot();
    const r = cine.shot.f(b, cine.t); pos = r.pos; look = r.look; fov = r.fov; tilt = cine.shot.tilt || 0;
    snap = cine.cut; cine.cut = false; lambda = 7;
  } else {
    rider.headG.updateMatrixWorld();
    pos = V3(0.02, 0.1, 0).applyMatrix4(rider.headG.matrixWorld);
    look = pos.clone().addScaledVector(b.fwd.clone().applyAxisAngle(b.up, rider.head.yaw * 0.5), 10).add(V3(0, -1.2, 0));
    fov = 72 + st.speed * 0.8; snap = true;
  }
  if (snap) { camPos.copy(pos); camLook.copy(look); }
  else {
    camPos.set(damp(camPos.x, pos.x, lambda, dt), damp(camPos.y, pos.y, lambda, dt), damp(camPos.z, pos.z, lambda, dt));
    camLook.lerp(look, 1 - Math.exp(-lambda * 1.6 * dt));
  }
  camera.position.copy(camPos);
  if (st.cam !== 'pov') camera.position.y = Math.max(camera.position.y, hgt(camera.position.x, camera.position.z) + 0.35, 0.6);
  if (shake > 0.001) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake = damp(shake, 0, 8, dt); }
  camera.lookAt(camLook);
  camera.fov = snap && st.cam === 'cinema' ? fov : damp(camera.fov, fov, 3, dt); camera.updateProjectionMatrix();
  grade.uniforms.uTilt.value = snap ? tilt : damp(grade.uniforms.uTilt.value, tilt, 3, dt);
  lastRider.copy(b.p);
}

const CAM_NAMES = { chase: '跟随', cinema: '电影', orbit: '自由环绕', pov: '鹈鹕视角' };
function setCam(mode) {
  st.cam = mode;
  controls.enabled = mode === 'orbit';
  const b = riderBasis();
  if (mode === 'orbit') {
    controls.target.copy(b.p).add(V3(0, 1, 0)); lastRider.copy(b.p);
    const d = camera.position.distanceTo(controls.target);
    if (d > 30 || d < 1.5) camera.position.copy(b.p).addScaledVector(b.right, -6).add(V3(0, 3, 0));
    controls.update();
  }
  if (mode === 'cinema') cine.t = 99;
  if (mode === 'chase') { chase.yaw = chase.pitch = 0; }
  $('camlabel').textContent = CAM_NAMES[mode];
  document.body.dataset.cam = mode;
}

// ---------------------------------------------------------------- UI
const toasts = $('toasts');
function toast(text, kind = '') {
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = text;
  toasts.appendChild(el);
  setTimeout(() => el.classList.add('out'), 1800); setTimeout(() => el.remove(), 2400);
  while (toasts.children.length > 4) toasts.firstChild.remove();
}

const WEATHER = { clear: '晴', cloudy: '多云', rain: '雷雨' };
let lightningT = 6;
function setWeather(w, quiet) {
  st.weather = w; $('weatherlabel').textContent = WEATHER[w];
  if (!quiet) toast(w === 'rain' ? '乌云压过来了…' : w === 'cloudy' ? '起风了，云多了起来' : '雨过天晴' + (st.rainbow > 0.3 ? '，看看天边' : ''));
  lightningT = 3 + Math.random() * 4;
}

let pixelScale = 1;
function setQuality(q) { st.quality = q; store.set('quality', q); $('qlabel').textContent = { auto: '自动', high: '高', low: '省电' }[q]; applyQuality(); }
function applyQuality() {
  const q = st.quality;
  const cap = q === 'low' ? 1 : q === 'high' ? 2 : 1.75;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, cap) * (q === 'auto' ? pixelScale : 1));
  const size = q === 'low' ? 1024 : 2048;
  if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  smaa.enabled = q !== 'low';
  resize();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio();
  grade.uniforms.uRes.value.set(w * pr, h * pr);
  for (const p of [sparks, dust]) if (p) p.mat.uniforms.uPx.value = pr * h / 900;
  if (world) world.ffMat.uniforms.uPx.value = pr * h / 900;
}
addEventListener('resize', resize);

function setSound(on) {
  if (on) audio.start(); else audio.stop();
  $('btn-sound').setAttribute('aria-pressed', String(on));
}

// minimap
const mapC = $('map'), mg = mapC.getContext('2d');
let mapBase = null;
function drawMapBase() {
  const S = mapC.width, sc = S / 150, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  const ring = (fn) => { g.beginPath(); for (let i = 0; i <= 200; i++) { const a = (i / 200) * TAU, r = fn(a) * sc; g.lineTo(r * Math.cos(a), r * Math.sin(a)); } };
  g.fillStyle = 'rgba(30,110,140,0.45)'; g.beginPath(); g.arc(0, 0, S / 2 - 2, 0, TAU); g.fill();
  ring((a) => coastR(a) - 5); g.fillStyle = '#e9d6a3'; g.fill();
  ring((a) => roadR(a) - 2.5); g.fillStyle = '#7fae55'; g.fill();
  ring(roadR); g.strokeStyle = '#3a3d44'; g.lineWidth = 3.2; g.stroke();
  g.strokeStyle = '#f2c544'; g.lineWidth = 0.8; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]);
  const lh = world.lighthouse; g.fillStyle = '#e04b40'; g.beginPath(); g.arc(lh.x * sc, lh.z * sc, 3.2, 0, TAU); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
  for (const r of ramps) { track.frame(r.s, 0, F2); g.fillStyle = '#ffcf33'; g.fillRect(F2.x * sc - 2, F2.z * sc - 2, 4, 4); }
  mapBase = c;
}
function drawMap() {
  const S = mapC.width, sc = S / 150;
  mg.clearRect(0, 0, S, S); mg.drawImage(mapBase, 0, 0);
  mg.save(); mg.translate(S / 2, S / 2);
  for (const f of fishes) { if (!f.active) continue; mg.fillStyle = f.gold ? '#ffc640' : '#bfefff'; mg.beginPath(); mg.arc(f.g.position.x * sc, f.g.position.z * sc, f.gold ? 2.4 : 1.6, 0, TAU); mg.fill(); }
  const p = rider.root.position;
  mg.translate(p.x * sc, p.z * sc); mg.rotate(Math.atan2(F.tz, F.tx));
  mg.fillStyle = '#ff5a5f'; mg.strokeStyle = '#fff'; mg.lineWidth = 1.5;
  mg.beginPath(); mg.moveTo(7, 0); mg.lineTo(-5, 4.5); mg.lineTo(-2.5, 0); mg.lineTo(-5, -4.5); mg.closePath(); mg.fill(); mg.stroke();
  mg.restore();
}

function fmtTime(t) { const m = Math.floor(wrap(t, 1) * 1440); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
let hudT = 0;
function updateHUD(dt) {
  hudT -= dt; if (hudT > 0) return; hudT = 0.1;
  $('speed').textContent = (st.speed * 3.6).toFixed(0);
  $('dist').textContent = st.distance < 1000 ? st.distance.toFixed(0) + ' m' : (st.distance / 1000).toFixed(2) + ' km';
  $('fish').textContent = st.fish + (st.gold ? '（金 ' + st.gold + '）' : '');
  $('score').textContent = st.score;
  $('best').textContent = st.best;
  $('combo').textContent = st.combo > 1 ? '×' + st.combo : '';
  $('clock').textContent = fmtTime(st.tod);
  if (document.activeElement !== $('tod')) $('tod').value = st.tod.toFixed(3);
  $('effort').style.setProperty('--e', st.effort.toFixed(2));
  drawMap();
}

function setAuto(on, quiet) {
  st.auto = on; $('btn-auto').setAttribute('aria-pressed', String(on));
  if (!quiet) toast(on ? '自动巡航：鹈鹕自己找鱼' : '手动驾驶：← → 换道，↑ 加速，↓ 刹车，空格跳');
}

function bindUI() {
  const btn = (id, fn) => $(id).addEventListener('click', (e) => { fn(e); e.currentTarget.blur(); });
  btn('btn-start', () => startRide(true));
  btn('btn-start-quiet', () => startRide(false));
  btn('btn-auto', () => setAuto(!st.auto));
  btn('btn-cam', () => { const o = ['chase', 'cinema', 'orbit', 'pov']; setCam(o[(o.indexOf(st.cam) + 1) % o.length]); toast('镜头：' + CAM_NAMES[st.cam]); });
  btn('btn-weather', () => { const o = ['clear', 'cloudy', 'rain']; setWeather(o[(o.indexOf(st.weather) + 1) % 3]); });
  btn('btn-flow', () => { st.flow = !st.flow; $('btn-flow').setAttribute('aria-pressed', String(st.flow)); });
  btn('btn-bell', ring);
  btn('btn-jump', jump);
  btn('btn-sound', () => { st.soundWanted = !audio.on; setSound(!audio.on); });
  btn('btn-music', () => { audio.setMusic(!audio.music); store.set('music', audio.music); $('btn-music').setAttribute('aria-pressed', String(audio.music)); });
  btn('btn-photo', photo);
  btn('btn-quality', () => { const o = ['auto', 'high', 'low']; setQuality(o[(o.indexOf(st.quality) + 1) % 3]); });
  btn('btn-help', () => $('help').showModal());
  btn('btn-help-close', () => $('help').close());
  btn('btn-share', share);
  btn('btn-pause', () => setPaused(!st.paused));
  btn('btn-resume', () => setPaused(false));
  $('tod').addEventListener('input', (e) => { st.tod = parseFloat(e.target.value); $('clock').textContent = fmtTime(st.tod); });
  $('cruise').addEventListener('input', (e) => { st.cruise = parseFloat(e.target.value); $('cruiseval').textContent = Math.round(st.cruise * 3.6) + ' km/h'; });
  $('btn-auto').setAttribute('aria-pressed', String(st.auto));
  $('btn-flow').setAttribute('aria-pressed', String(st.flow));
  $('btn-music').setAttribute('aria-pressed', String(audio.music));
  $('qlabel').textContent = { auto: '自动', high: '高', low: '省电' }[st.quality];

  const keys = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
  addEventListener('keydown', (e) => {
    if ($('help').open) return;
    if (e.target.tagName === 'INPUT' && e.target.type === 'range' && e.code.startsWith('Arrow')) return;
    const k = keys[e.code];
    if (k) {
      input[k] = true; e.preventDefault();
      if ((k === 'left' || k === 'right') && st.auto && st.started) { setAuto(false, true); toast('已切换到手动驾驶（按 M 恢复自动）'); }
    }
    if (!e.repeat) switch (e.code) {
      case 'Space': e.preventDefault(); if (!st.started) startRide(true); else jump(); break;
      case 'Enter': if (!st.started) startRide(true); break;
      case 'KeyB': ring(); break;
      case 'KeyC': $('btn-cam').click(); break;
      case 'KeyN': st.tod = st.night > 0.5 ? 0.42 : 0.9; break;
      case 'KeyR': $('btn-weather').click(); break;
      case 'KeyM': setAuto(!st.auto); break;
      case 'KeyP': photo(); break;
      case 'KeyH': document.body.classList.toggle('clean'); break;
      case 'Escape': if (st.started) setPaused(!st.paused); break;
      case 'Slash': $('help').showModal(); break;
      default:
    }
    syncInput();
  });
  addEventListener('keyup', (e) => { const k = keys[e.code]; if (k) { input[k] = false; syncInput(); } });
  addEventListener('blur', () => { for (const k in input) input[k] = false; syncInput(); });
  for (const el of document.querySelectorAll('[data-hold]')) {
    const k = el.dataset.hold;
    const on = (e) => { e.preventDefault(); input[k] = true; if ((k === 'left' || k === 'right') && st.auto) setAuto(false, true); el.classList.add('down'); syncInput(); };
    const off = () => { input[k] = false; el.classList.remove('down'); syncInput(); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  canvas.addEventListener('pointerdown', (e) => { if (st.cam !== 'chase') return; chase.drag = true; chase.px = e.clientX; chase.py = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!chase.drag) return;
    chase.yaw -= (e.clientX - chase.px) * 0.006; chase.pitch = clamp(chase.pitch + (e.clientY - chase.py) * 0.004, -0.15, 1.1);
    chase.px = e.clientX; chase.py = e.clientY; chase.idle = 0;
  });
  const endDrag = () => { chase.drag = false; chase.idle = 0; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', () => { if (st.started) ring(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && st.started) setPaused(true); });
}
function syncInput() { st.boost = input.up; st.brake = input.down; }

function ring() { rider.ring(); audio.bell(); st.wave = 1.6; }
function setPaused(p) {
  if (!st.started) return;
  st.paused = p; document.body.classList.toggle('paused', p);
  $('btn-pause').setAttribute('aria-pressed', String(p));
  if (p) audio.stop(); else if (st.soundWanted) audio.start();
}

function startRide(sound) {
  if (st.started) return;
  st.started = true; st.soundWanted = sound;
  document.body.classList.add('riding');
  $('start').classList.add('gone');
  setSound(sound);
  setCam(initialCam || 'chase');
  camPos.copy(camera.position);
  toast('出发！跟着小鱼走，按 B 打铃');
}

function photo() {
  composer.render(0);
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a'); a.href = url; a.download = 'pelican-velo-' + fmtTime(st.tod).replace(':', '') + '.png'; a.click();
  document.body.classList.add('flash'); setTimeout(() => document.body.classList.remove('flash'), 250);
  toast('已保存截图');
}

async function share() {
  const u = new URL(location.href.split('?')[0]);
  u.searchParams.set('t', st.tod.toFixed(3)); u.searchParams.set('weather', st.weather); u.searchParams.set('cam', st.cam);
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: '鹈鹕骑车环岛', url: u.toString() });
    else { await navigator.clipboard.writeText(u.toString()); toast('当前时间、天气和镜头的链接已复制'); }
  } catch { prompt('复制这个链接：', u.toString()); }
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6.5, 9), fog: false, transparent: true });
const RAIN_WHITE = new THREE.Color(1, 1, 1);
function strike() {
  const a = Math.random() * TAU, d = 220 + Math.random() * 180, base = rider.root.position;
  const pts = []; let x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d;
  for (let y = 150; y > 0; y -= 10 + Math.random() * 12) { pts.push(new THREE.Vector3(x, y, z)); x += (Math.random() - 0.5) * 18; z += (Math.random() - 0.5) * 18; }
  pts.push(new THREE.Vector3(x, -2, z));
  if (bolt) { scene.remove(bolt); bolt.geometry.dispose(); }
  bolt = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.7, 5), boltMat);
  bolt.userData.life = 0.35; scene.add(bolt);
  st.flash = 1; audio.thunder(0.4 + d / 340);
}

let perfT = 0, perfN = 0;
function frame() {
  requestAnimationFrame(frame);
  const raw = clock.getDelta();
  let dt = Math.min(raw, 1 / 20);
  if (st.paused) dt = 0;
  st.time += dt; U.uTime.value = st.time; grade.uniforms.uTime.value = st.time;
  updateEnvironment(dt);
  simulate(dt);
  for (const f of fishes) if (f.active) placeFish(f, st.time);
  world.update(dt, st.time, env);
  sparks.update(dt); dust.update(dt);
  rain.material.uniforms.uLit.value.copy(PAL.hor).lerp(RAIN_WHITE, 0.4).multiplyScalar(0.6 + st.flash * 2);
  rain.visible = st.rain > 0.01;
  if (st.weather === 'rain' && st.rain > 0.6 && dt > 0) { lightningT -= dt; if (lightningT < 0) { lightningT = 7 + Math.random() * 12; strike(); } }
  st.flash = Math.max(0, st.flash - dt * 3.2);
  if (bolt) {
    bolt.userData.life -= dt; boltMat.opacity = clamp(bolt.userData.life * 4, 0, 1) * (Math.random() < 0.3 ? 0.4 : 1);
    if (bolt.userData.life <= 0) { scene.remove(bolt); bolt.geometry.dispose(); bolt = null; }
  }
  rider.headlight.intensity = damp(rider.headlight.intensity, (st.night > 0.35 || st.rain > 0.5) ? 40 : 0, 3, dt);
  rider.lensMat.emissiveIntensity = 0.4 + (rider.headlight.intensity / 40) * 6;
  rider.tailMat.emissiveIntensity = 1.5 + st.night * 4 * (Math.sin(st.time * 8) > 0 ? 1 : 0.4);
  updateCamera(dt);
  grade.uniforms.uFlash.value = st.flash * 0.35;
  grade.uniforms.uCA.value = reduceMotion ? 0 : 0.0015 + clamp((st.speed - 8) / 6, 0, 1) * 0.004;
  grade.uniforms.uLines.value = reduceMotion || st.cam !== 'chase' ? 0 : clamp((st.speed - 10) / 4, 0, 1);
  grade.uniforms.uVig.value = 0.3 + st.night * 0.15;
  bloom.strength = 0.28 + st.night * 0.35;
  audio.update(dt, { speed: st.speed, rain: st.rain, night: st.night, time: st.time, coasting: st.coasting, grounded: st.grounded, air: st.grounded ? 0 : 1 });
  composer.render(dt);
  updateHUD(dt);
  // adaptive resolution keeps slower GPUs smooth
  if (st.quality === 'auto' && !st.paused && !document.hidden) {
    perfT += raw; perfN++;
    if (perfT > 2.5) {
      const avg = perfT / perfN;
      const ns = avg > 1 / 40 ? Math.max(0.55, pixelScale - 0.15) : avg < 1 / 57 ? Math.min(1, pixelScale + 0.1) : pixelScale;
      if (ns !== pixelScale) { pixelScale = ns; applyQuality(); }
      perfT = 0; perfN = 0;
    }
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  await progress(0.08, '测量环岛公路…');
  await progress(0.18, '堆起沙滩和山丘…');
  world = createWorld(scene, track, U);
  await progress(0.5, '给鹈鹕梳理羽毛…');
  rider = new Rider(); scene.add(rider.root, rider.scarf);
  await progress(0.66, '摆放跳台和小鱼…');
  buildRamps(); buildFish();
  rain = makeRain(); scene.add(rain);
  sparks = new Particles(500, THREE.AdditiveBlending, 0.18); scene.add(sparks.points);
  dust = new Particles(300, THREE.NormalBlending, 0.3); scene.add(dust.points);
  await progress(0.78, '调配天空的颜色…');
  pmrem = new THREE.PMREMGenerator(renderer);
  envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(world.sky.geometry, world.sky.material));
  controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enabled: false, enableDamping: true, maxDistance: 40, minDistance: 2, maxPolarAngle: Math.PI * 0.49 });
  setWeather(st.weather, true);
  if (st.weather === 'rain') { st.rain = 1; U.uCloud.value = 0.97; } else if (st.weather === 'cloudy') U.uCloud.value = 0.62;
  updateEnvironment(0); refreshEnv();
  st.speed = 3.5; simulate(0.016);
  setCam(initialCam || 'cinema');
  bindUI();
  applyQuality();
  drawMapBase();
  await progress(0.9, '编译着色器…');
  renderer.compile(scene, camera);
  composer.render(0);
  await progress(1, '准备出发');
  $('loader').classList.add('done');
  $('start').classList.remove('hidden');
  clock.getDelta();
  frame();
  if (params.get('ui') === '0') document.body.classList.add('clean');
  if (params.get('autostart') === '1') startRide(false);
  window.__velo = { st, rider, camera, scene, renderer, track, fishes, ramps, setCam, setWeather, setQuality, jump, ring, startRide, collect, setPaused, composer, bloom, grade, info: () => renderer.info };
}
boot().catch((e) => {
  console.error(e);
  $('loader').classList.add('fail');
  $('loadmsg').textContent = '加载失败：' + e.message;
  window.__veloError = String((e && e.stack) || e);
});
