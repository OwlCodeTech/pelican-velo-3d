import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrap = (x, m) => ((x % m) + m) % m;

// Deterministic PRNG so the island looks the same on every visit.
export function rng(seed = 1) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Island shape. JS and GLSL versions must stay identical. ----------
export const coastR = (a) => 58 + 5 * Math.sin(3 * a + 0.5) + 3 * Math.sin(7 * a + 1.3) + 1.0 * Math.sin(11 * a + 2.1);
export const roadR = (a) => 46 + 5 * Math.sin(3 * a + 0.5) + 3 * Math.sin(7 * a + 1.3);

export function hgt(x, z) {
  const r = Math.hypot(x, z), a = Math.atan2(z, x);
  const d = r - coastR(a);
  const land = 1 - ss(-9, 3, d);
  const hills = 11 * (1 - ss(6, 38, r)) * (0.75 + 0.25 * Math.sin(3 * a + 1.0));
  const bumps = 0.8 * Math.sin(x * 0.21 + z * 0.13) * Math.sin(z * 0.17 - x * 0.07) * (1 - ss(28, 40, r));
  return -4.2 + 5.6 * land + 0.7 * Math.sin(4 * a + 0.3) * land + hills + bumps - 6 * ss(3, 40, d);
}

export const H_GLSL = /* glsl */`
float coastR(float a){ return 58.0 + 5.0*sin(3.0*a+0.5) + 3.0*sin(7.0*a+1.3) + 1.0*sin(11.0*a+2.1); }
float hgt(float x, float z){
  float r = length(vec2(x, z)); float a = atan(z, x);
  float d = r - coastR(a);
  float land = 1.0 - smoothstep(-9.0, 3.0, d);
  float hills = 11.0 * (1.0 - smoothstep(6.0, 38.0, r)) * (0.75 + 0.25*sin(3.0*a + 1.0));
  float bumps = 0.8*sin(x*0.21 + z*0.13)*sin(z*0.17 - x*0.07)*(1.0 - smoothstep(28.0, 40.0, r));
  return -4.2 + 5.6*land + 0.7*sin(4.0*a + 0.3)*land + hills + bumps - 6.0*smoothstep(3.0, 40.0, d);
}`;

// ---------- Ocean waves. One table drives both the shader and the boats. ----------
const RAW_WAVES = [[1, 0.3, 22, 0.30], [-0.4, 1, 13, 0.17], [0.7, -0.7, 7.5, 0.08], [-0.9, -0.2, 4.2, 0.045]];
export const WAVES = RAW_WAVES.map(([dx, dz, L, A]) => {
  const l = Math.hypot(dx, dz), k = TAU / L;
  return { dx: dx / l, dz: dz / l, k, w: Math.sqrt(9.8 * k), A };
});
export function waveH(x, z, t) {
  let h = 0;
  for (const W of WAVES) h += W.A * Math.sin(W.k * (W.dx * x + W.dz * z) - W.w * t);
  return h;
}
const f = (n) => n.toFixed(5);
export const WAVE_GLSL = /* glsl */`
vec3 waveField(vec2 p, float t, float att){
  // returns (height, dh/dx, dh/dz)
  vec3 r = vec3(0.0); float ph;
  ${WAVES.map((W) => `ph = ${f(W.k)}*dot(vec2(${f(W.dx)},${f(W.dz)}), p) - ${f(W.w)}*t;
  r.x += ${f(W.A)}*sin(ph); r.yz += ${f(W.A * W.k)}*cos(ph)*vec2(${f(W.dx)},${f(W.dz)});`).join('\n  ')}
  return r * att;
}`;

export const NOISE_GLSL = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1.0,0.0)), u.x), mix(hash12(i+vec2(0.0,1.0)), hash12(i+vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vnoise(p); p = mat2(1.6,1.2,-1.2,1.6)*p; a *= 0.5; } return s; }`;

export function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

export class Spring {
  constructor(k = 120, c = 10, x = 0) { this.k = k; this.c = c; this.x = x; this.v = 0; }
  step(target, dt) {
    const a = this.k * (target - this.x) - this.c * this.v;
    this.v += a * dt; this.x += this.v * dt;
    return this.x;
  }
  kick(v) { this.v += v; }
}

// Wind sway for instanced vegetation. Height in local space drives the bend.
export function addWind(material, uniforms, amp = 0.05, freq = 1.6) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uWind = uniforms.uWind;
    sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
      #else
        vec2 ip = vec2(0.0);
      #endif
      float sway = sin(uTime*${freq.toFixed(2)} + ip.x*0.37 + ip.y*0.21) + 0.5*sin(uTime*${(freq * 2.3).toFixed(2)} + ip.x*0.9);
      float hk = max(position.y, 0.0);
      transformed.x += sway * ${amp.toFixed(4)} * hk * hk * uWind;
      transformed.z += cos(uTime*${(freq * 0.8).toFixed(2)} + ip.y*0.3) * ${(amp * 0.6).toFixed(4)} * hk * hk * uWind;
    `);
  };
  material.customProgramCacheKey = () => 'wind' + amp + '_' + freq;
}

export function paint(geo, color) {
  const g = clean(geo);
  const c = new THREE.Color(color), n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export function paintGradient(geo, c0, c1, min, max, axis = 'y') {
  const g = clean(geo);
  const a = new THREE.Color(c0), b = new THREE.Color(c1), t = new THREE.Color();
  const p = g.attributes.position, n = p.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = axis === 'x' ? p.getX(i) : axis === 'z' ? p.getZ(i) : p.getY(i);
    t.copy(a).lerp(b, clamp((v - min) / (max - min), 0, 1));
    arr[i * 3] = t.r; arr[i * 3 + 1] = t.g; arr[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Strip attributes down to position/normal/color so mergeGeometries never complains.
export function clean(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'color'].includes(k)) out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}


// Tube with a radius that varies along the curve.
export function taperTube(points, radial, rFn, segs = points.length * 10) {
  const curve = new THREE.CatmullRomCurve3(points);
  const fr = curve.computeFrenetFrames(segs, false);
  const pos = [], uv = [], idx = [], P = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; curve.getPointAt(t, P);
    const N = fr.normals[i], B = fr.binormals[i], r = rFn(t);
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * TAU, c = Math.cos(v) * r, s = Math.sin(v) * r;
      pos.push(P.x + N.x * c + B.x * s, P.y + N.y * c + B.y * s, P.z + N.z * c + B.z * s);
      uv.push(t, j / radial);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Rewrites an existing tube in place (used for the animated neck).
export function updateTube(g, points, radial, rFn, segs) {
  const curve = new THREE.CatmullRomCurve3(points);
  const fr = curve.computeFrenetFrames(segs, false);
  const p = g.attributes.position, P = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; curve.getPointAt(t, P);
    const N = fr.normals[i], B = fr.binormals[i], r = rFn(t);
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * TAU, c = Math.cos(v) * r, s = Math.sin(v) * r;
      p.setXYZ(k++, P.x + N.x * c + B.x * s, P.y + N.y * c + B.y * s, P.z + N.z * c + B.z * s);
    }
  }
  p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
}

// Arc-length parametrised road loop around the island.
export class Track {
  constructor(n = 3000) {
    this.n = n; this.px = new Float32Array(n + 1); this.pz = new Float32Array(n + 1); this.cum = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) { const a = (i / n) * TAU, r = roadR(a); this.px[i] = r * Math.cos(a); this.pz[i] = r * Math.sin(a); }
    for (let i = 1; i <= n; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(this.px[i] - this.px[i - 1], this.pz[i] - this.pz[i - 1]);
    this.len = this.cum[n];
  }
  xz(s, out) {
    s = wrap(s, this.len);
    let lo = 0, hi = this.n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const t = (s - this.cum[lo]) / (this.cum[hi] - this.cum[lo] || 1);
    out.x = this.px[lo] + (this.px[hi] - this.px[lo]) * t; out.z = this.pz[lo] + (this.pz[hi] - this.pz[lo]) * t;
    return out;
  }
  // Position, unit tangent, right vector, signed curvature (toward right) and slope at arc length s.
  frame(s, lateral = 0, out = {}) {
    const a = this.xz(s - 0.6, {}), b = this.xz(s + 0.6, {}), c = this.xz(s, {});
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    const a2 = this.xz(s - 3, {}), a3 = this.xz(s - 2, {}), b2 = this.xz(s + 2, {}), b3 = this.xz(s + 3, {});
    let t1x = a3.x - a2.x, t1z = a3.z - a2.z, t2x = b3.x - b2.x, t2z = b3.z - b2.z;
    const l1 = Math.hypot(t1x, t1z), l2 = Math.hypot(t2x, t2z); t1x /= l1; t1z /= l1; t2x /= l2; t2z /= l2;
    const rx = -tz, rz = tx;
    out.k = ((t2x - t1x) * rx + (t2z - t1z) * rz) / 5;
    out.x = c.x + rx * lateral; out.z = c.z + rz * lateral;
    out.y = hgt(out.x, out.z) + 0.07;
    out.tx = tx; out.tz = tz; out.rx = rx; out.rz = rz;
    out.slope = (hgt(out.x + tx, out.z + tz) - hgt(out.x - tx, out.z - tz)) / 2;
    out.heading = Math.atan2(-tz, tx);
    return out;
  }
}
