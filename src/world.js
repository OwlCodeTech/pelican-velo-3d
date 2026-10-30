import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';
import {
  TAU, clamp, lerp, ss, rng, coastR, roadR, hgt, waveH, H_GLSL, WAVE_GLSL, NOISE_GLSL,
  canvasTex, addWind, paint, paintGradient, clean, taperTube,
} from './util.js';

const R = rng(20261030);
const rr = (a, b) => a + R() * (b - a);

export function vn(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const h = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return lerp(lerp(h(xi, zi), h(xi + 1, zi), u), lerp(h(xi, zi + 1), h(xi + 1, zi + 1), u), v);
}

function instanced(geo, mat, items, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();
  items.forEach((it, i) => {
    P.set(it.x, it.y, it.z); E.set(it.rx || 0, it.ry || 0, it.rz || 0); Q.setFromEuler(E);
    S.setScalar(it.s || 1);
    M.compose(P, Q, S); m.setMatrixAt(i, M);
    if (it.c) m.setColorAt(i, it.c);
  });
  m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false;
  return m;
}

const at = (g, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => g.applyMatrix4(new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s)));

// ------------------------------------------------------------------ sky
function makeSky(U) {
  const mat = new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vDir = w.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * w;
        gl_Position.z = gl_Position.w * 0.99999;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uSunColor, uTop, uHorizon, uGround, uCloudLit, uCloudShade;
      uniform float uTime, uCloud, uNight, uRain, uRainbow;
      uniform vec3 uFogColor;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 col = mix(uHorizon, uTop, pow(smoothstep(0.0, 1.0, y), 0.5));
        col = mix(col, uGround, smoothstep(0.0, -0.2, y));
        float sd = max(dot(d, uSunDir), 0.0);
        float clear = 1.0 - uRain * 0.85;
        col += uSunColor * (pow(sd, 6.0) * 0.25 + pow(sd, 90.0) * 0.8) * clear;
        col += uSunColor * smoothstep(0.99935, 0.9997, sd) * 22.0 * (1.0 - uRain) * smoothstep(-0.05, 0.0, y);
        float low = 1.0 - smoothstep(-0.05, 0.3, uSunDir.y);
        float toward = pow(dot(normalize(d.xz + 1e-4), normalize(uSunDir.xz + 1e-4)) * 0.5 + 0.5, 3.0);
        col += uSunColor * low * 0.55 * pow(1.0 - abs(y), 7.0) * toward * clear;
        vec3 md = -uSunDir; md.y = abs(md.y) * 0.8 + 0.25; md = normalize(md);
        float mdot = max(dot(d, md), 0.0);
        if (uNight > 0.001) {
          vec3 g = floor(d * 260.0);
          float h = hash13(g);
          float tw = 0.55 + 0.45 * sin(uTime * (2.0 + h * 5.0) + h * 80.0);
          float star = smoothstep(0.9965, 1.0, h) * tw;
          col += vec3(0.8, 0.88, 1.0) * star * 2.5 * uNight * smoothstep(0.02, 0.25, y) * (1.0 - uCloud) * clear;
          float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.2, 1.0))) * 3.0, 2.0)) * fbm(d.xy * 6.0 + d.z * 3.0);
          col += vec3(0.25, 0.22, 0.4) * band * 0.25 * uNight * (1.0 - uCloud) * clear * smoothstep(0.0, 0.3, y);
          col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.9993, 0.9996, mdot) * 6.0 + pow(mdot, 200.0) * 0.6 + pow(mdot, 12.0) * 0.08) * uNight * clear;
        }
        if (uRainbow > 0.001) {
          float ang = acos(clamp(dot(d, -uSunDir), -1.0, 1.0));
          float x = (ang - 0.705) / 0.045;
          if (x > 0.0 && x < 1.0) {
            float hue = (1.0 - x) * 0.78;
            vec3 rb = clamp(abs(mod(hue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
            col += rb * sin(x * 3.14159) * 0.28 * uRainbow * smoothstep(-0.01, 0.12, y);
          }
        }
        if (y > -0.02) {
          vec2 uv = d.xz / (y + 0.12) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
          float n = fbm(uv * 1.4);
          float n2 = fbm(uv * 1.4 + uSunDir.xz * 0.12);
          float cover = mix(0.66, 0.28, uCloud);
          float c = smoothstep(cover, cover + 0.28, n) * smoothstep(-0.02, 0.18, y);
          float lit = clamp(0.55 + (n - n2) * 4.0 + pow(sd, 3.0) * 0.6, 0.0, 1.0);
          vec3 cc = mix(uCloudShade, uCloudLit, lit);
          cc += uSunColor * pow(sd, 10.0) * 0.6 * (1.0 - c) * clear;
          col = mix(col, cc, c * 0.94);
        }
        float hz = 1.0 - smoothstep(-0.03, 0.16, y);
        col = mix(col, uFogColor, hz * 0.85);
        col += uSunColor * (pow(sd, 24.0) * 0.5 * low + smoothstep(0.99935, 0.9997, sd) * 10.0 * (1.0 - uRain)) * hz * step(-0.02, y);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.SphereGeometry(1000, 48, 24);
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false; sky.renderOrder = -10;
  return sky;
}

// ------------------------------------------------------------------ ocean
function radialGrid(r0, r1, rings, segs) {
  const pos = [], idx = [];
  for (let i = 0; i < rings; i++) {
    const r = r0 * Math.pow(r1 / r0, i / (rings - 1));
    for (let j = 0; j <= segs; j++) { const a = (j / segs) * TAU; pos.push(r * Math.cos(a), 0, r * Math.sin(a)); }
  }
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * (segs + 1) + j, b = a + segs + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
}

function makeOcean(U) {
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, fog: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vW;
      ${WAVE_GLSL}
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        float att = 1.0 - smoothstep(140.0, 520.0, length(w.xz - cameraPosition.xz));
        w.y += waveField(w.xz, uTime, att).x;
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uSunColor, uTop, uHorizon, uDeep, uShallow, uFogColor, uAmbient;
      uniform float uTime, uFogDensity, uNight, uRain;
      varying vec3 vW;
      ${WAVE_GLSL}
      ${H_GLSL}
      ${NOISE_GLSL}
      void main(){
        vec2 p = vW.xz;
        float dist = length(cameraPosition - vW);
        vec3 wf = waveField(p, uTime, 1.0 - smoothstep(140.0, 520.0, length(p - cameraPosition.xz)));
        float fade = 1.0 - smoothstep(30.0, 260.0, dist);
        vec2 q = p * 0.55 + vec2(uTime * 0.21, uTime * 0.13);
        float e = 0.35;
        float n0 = vnoise(q) + 0.5 * vnoise(q * 2.3 - uTime * 0.3);
        float nx = vnoise(q + vec2(e, 0.0)) + 0.5 * vnoise((q + vec2(e, 0.0)) * 2.3 - uTime * 0.3);
        float nz = vnoise(q + vec2(0.0, e)) + 0.5 * vnoise((q + vec2(0.0, e)) * 2.3 - uTime * 0.3);
        vec2 dn = vec2(nx - n0, nz - n0) * (0.55 + uRain * 0.8) * fade;
        vec3 N = normalize(vec3(-wf.y - dn.x, 1.0, -wf.z - dn.y));
        vec3 V = normalize(cameraPosition - vW);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 Rf = reflect(-V, N); Rf.y = abs(Rf.y);
        vec3 sky = mix(uHorizon, uTop, pow(Rf.y, 0.5));
        float floorH = hgt(vW.x, vW.z);
        float depth = max(vW.y - floorH, 0.0);
        vec3 water = mix(uShallow, uDeep, 1.0 - exp(-depth * 0.32)) * uAmbient;
        float sss = pow(max(dot(V, -uSunDir) * 0.5 + 0.5, 0.0), 3.0) * clamp(wf.x * 2.0 + 0.4, 0.0, 1.0);
        water += uShallow * uSunColor * sss * 0.25;
        vec3 col = mix(water, sky, fres);
        float rs = max(dot(Rf, uSunDir), 0.0);
        col += uSunColor * (pow(rs, 360.0) * 9.0 + pow(rs, 30.0) * 0.18) * (1.0 - uRain * 0.9) * step(0.0, uSunDir.y + 0.04);
        vec3 md = -uSunDir; md.y = abs(md.y) * 0.8 + 0.25; md = normalize(md);
        col += vec3(0.8, 0.85, 1.0) * pow(max(dot(Rf, md), 0.0), 160.0) * 3.0 * uNight;
        float fn = vnoise(p * 1.6 + vec2(uTime * 0.5, -uTime * 0.3));
        float shore = exp(-depth * 1.6);
        float band = sin(depth * 4.5 - uTime * 1.8 + fn * 2.0) * 0.5 + 0.5;
        float foam = shore * smoothstep(0.45, 0.85, band * 0.7 + fn * 0.5);
        foam = max(foam, smoothstep(0.35, 0.05, depth));
        foam = max(foam, smoothstep(0.32, 0.5, wf.x + fn * 0.12) * 0.55 * fade);
        vec3 foamCol = uAmbient * 1.15 + uSunColor * max(uSunDir.y, 0.0) * 0.6;
        col = mix(col, foamCol, clamp(foam, 0.0, 1.0) * 0.85);
        float alpha = mix(0.25, 0.97, smoothstep(0.0, 2.2, depth));
        alpha = max(alpha, foam * 0.9);
        float ff = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, ff);
        gl_FragColor = vec4(col, mix(alpha, 1.0, ff));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(radialGrid(1, 1400, 220, 300), mat);
  m.frustumCulled = false; m.renderOrder = 1;
  return m;
}

// ------------------------------------------------------------------ terrain
function makeTerrain() {
  const geo = new THREE.PlaneGeometry(320, 320, 300, 300);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, hgt(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, col = new Float32Array(p.count * 3);
  const C = (h) => new THREE.Color(h);
  const sand = C('#ead6a6'), wet = C('#b59c74'), sea = C('#8f8463'), g1 = C('#79a845'), g2 = C('#4e8236'), dry = C('#b4ad5c'), rock = C('#8d867b'), path = C('#a99470');
  const c = new THREE.Color(), t = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z), a = Math.atan2(z, x);
    const n = vn(x * 0.07, z * 0.07), n2 = vn(x * 0.33 + 9, z * 0.33);
    const dr = r - roadR(a);
    c.copy(g1).lerp(g2, ss(0.3, 0.8, n));
    c.lerp(dry, ss(0.55, 0.95, n2) * 0.45 + ss(6, 14, y) * 0.3);
    c.lerp(path, ss(-3.6, -2.6, dr) * (1 - ss(2.6, 3.6, dr)));
    t.copy(sand).lerp(wet, ss(0.9, 0.05, y));
    c.lerp(t, ss(2.5, 3.6, dr + (n - 0.5) * 1.5));
    c.lerp(sea, ss(0.0, -2.5, y));
    c.lerp(rock, ss(0.8, 0.62, nrm.getY(i)) * 0.9);
    const v = 0.92 + 0.16 * n2;
    col[i * 3] = c.r * v; col[i * 3 + 1] = c.g * v; col[i * 3 + 2] = c.b * v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const detail = canvasTex(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = (i / w) | 0;
      const v = 205 + 25 * vn(x * 0.09, y * 0.09) + 25 * Math.random();
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.min(255, v); img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: [90, 90] });
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95, metalness: 0 }));
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ road
function makeRoad(track) {
  const W = 4.4, period = track.len / Math.round(track.len / 16);
  const tex = canvasTex(256, 1024, (g, w, h) => {
    g.fillStyle = '#3d3f44'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 45 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v + 4},0.55)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 6; i++) g.fillRect(w * 0.22 + Math.random() * 6, 0, 18, h);
    for (let i = 0; i < 6; i++) g.fillRect(w * 0.7 + Math.random() * 6, 0, 18, h);
    g.fillStyle = '#ecebe4'; g.fillRect(w * 0.035, 0, w * 0.03, h); g.fillRect(w * 0.935, 0, w * 0.03, h);
    g.fillStyle = '#f2c544'; g.fillRect(w * 0.485, 0, w * 0.03, h * 0.2); g.fillRect(w * 0.485, h * 0.5, w * 0.03, h * 0.2);
  });
  const N = Math.ceil(track.len / 0.5), cols = [-1, -0.5, 0, 0.5, 1];
  const mk = (width, lift, withUV) => {
    const pos = [], uv = [], idx = [], f = {};
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * track.len; track.frame(s, 0, f);
      for (const c of cols) {
        const x = f.x + f.rx * c * width / 2, z = f.z + f.rz * c * width / 2;
        pos.push(x, hgt(x, z) + lift, z);
        uv.push((c + 1) / 2, s / period);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < cols.length - 1; j++) {
      const a = i * cols.length + j, b = a + cols.length;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (withUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const nn = g.attributes.normal; let sum = 0; for (let i = 0; i < nn.count; i++) sum += nn.getY(i);
    if (sum < 0) { const flip = []; for (let k = 0; k < idx.length; k += 3) flip.push(idx[k], idx[k + 2], idx[k + 1]); g.setIndex(flip); g.computeVertexNormals(); }
    return g;
  };
  const roadMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const road = new THREE.Mesh(mk(W, 0.07, true), roadMat); road.receiveShadow = true;
  const shoulderMat = new THREE.MeshStandardMaterial({ color: '#9a8c74', roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const shoulder = new THREE.Mesh(mk(W + 1.8, 0.035, false), shoulderMat); shoulder.receiveShadow = true;
  return { road, shoulder, roadMat, W };
}

// ------------------------------------------------------------------ vegetation & props geometry
function palmGeo() {
  const trunkPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.15, 1.8, 0), new THREE.Vector3(0.6, 3.6, 0), new THREE.Vector3(1.2, 5.2, 0)];
  const parts = [paintGradient(taperTube(trunkPts, 7, (t) => 0.24 - 0.11 * t, 18), '#7a5a3a', '#a68356', 0, 5.2)];
  const top = new THREE.Vector3(1.2, 5.2, 0);
  for (let i = 0; i < 8; i++) {
    const L = 2.8 + (i % 3) * 0.3;
    const g = new THREE.PlaneGeometry(L, 0.75, 8, 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const u = (p.getX(k) + L / 2) / L, v = p.getY(k);
      p.setXYZ(k, u * L, -u * u * 1.4 + Math.abs(v) * 0.35, v * (1 - u * 0.85) * (0.6 + Math.sin(u * Math.PI) * 0.5));
    }
    g.computeVertexNormals();
    at(g, 0, 0, 0, 0, (i / 8) * TAU + (i % 2) * 0.2, 0.25 + (i % 2) * 0.25);
    g.translate(top.x, top.y, top.z);
    parts.push(paintGradient(g, '#2f7a32', '#7cc048', top.x - 2.5, top.x + 2.5, 'x'));
  }
  for (let i = 0; i < 3; i++) parts.push(paint(at(new THREE.IcosahedronGeometry(0.17, 0), top.x + Math.cos(i * 2.1) * 0.25, top.y - 0.2, Math.sin(i * 2.1) * 0.25), '#6a4a26'));
  return mergeGeometries(parts);
}

function roundTreeGeo() {
  const parts = [paintGradient(new THREE.CylinderGeometry(0.13, 0.22, 2.4, 6).translate(0, 1.2, 0), '#5d4128', '#7a5634', 0, 2.4)];
  [[0, 2.9, 0, 1.35], [0.7, 2.5, 0.3, 0.95], [-0.6, 2.6, -0.4, 1.0], [0.1, 3.7, -0.1, 0.9]].forEach(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, 1); const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const f = 1 + 0.12 * Math.sin(p.getX(k) * 5 + i) * Math.cos(p.getZ(k) * 4); p.setXYZ(k, p.getX(k) * f, p.getY(k) * f, p.getZ(k) * f); }
    parts.push(paintGradient(g.translate(x, y, z), '#3d7a2e', '#8cc152', 1.8, 4.6));
  });
  return mergeGeometries(parts);
}

function pineGeo() {
  const parts = [paint(new THREE.CylinderGeometry(0.1, 0.18, 1.6, 6).translate(0, 0.8, 0), '#5a3e27')];
  for (let i = 0; i < 4; i++) parts.push(paintGradient(new THREE.ConeGeometry(1.5 - i * 0.3, 1.9, 8).translate(0, 1.6 + i * 1.0, 0), '#21502c', '#3e7f3f', 1 + i, 2.6 + i));
  return mergeGeometries(parts);
}

function tuftGeo() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.BufferGeometry();
    const w = 0.05, h = 0.32 + (i % 3) * 0.08;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, 0.12, h, 0], 3));
    parts.push(paintGradient(at(g, 0, 0, 0, 0, (i / 5) * Math.PI, 0), '#3f6f2a', '#a9cf63', 0, h));
  }
  const m = mergeGeometries(parts);
  const n = m.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return m;
}

function flowerGeo() {
  const parts = [paint(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 3).translate(0, 0.15, 0), '#4f7d2f')];
  for (let i = 0; i < 5; i++) parts.push(paint(new THREE.SphereGeometry(0.05, 5, 3).scale(1, 0.5, 1).translate(Math.cos(i * 1.256) * 0.06, 0.31, Math.sin(i * 1.256) * 0.06), '#ffffff'));
  parts.push(paint(new THREE.SphereGeometry(0.035, 5, 3).translate(0, 0.33, 0), '#ffd23f'));
  return mergeGeometries(parts);
}

function rockGeo(seed) {
  const g = new THREE.DodecahedronGeometry(1, 1); const p = g.attributes.position; const r = rng(seed);
  const o1 = r() * 10, o2 = r() * 10;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const f = 0.8 + 0.35 * vn(x * 1.7 + o1, z * 1.7 + y * 1.3 + o2);
    p.setXYZ(k, x * f, y * f * 0.7, z * f);
  }
  g.computeVertexNormals();
  return paintGradient(g, '#6f6a62', '#a7a196', -0.6, 0.7);
}

// ------------------------------------------------------------------ landmarks
function makeLighthouse(U, group, exclusions) {
  const a = 0.36, r = coastR(a) + 2.5, x = r * Math.cos(a), z = r * Math.sin(a);
  exclusions.push([x, z, 7]);
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const s = 2.0 + R() * 2.0, ang = R() * TAU, d = R() * 3.5;
    parts.push(at(rockGeo(i + 11), Math.cos(ang) * d, -0.4 + R() * 0.6, Math.sin(ang) * d, 0, R() * 3, 0, s));
  }
  const by = 0.5;
  const base = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  base.position.set(x, by, z); base.castShadow = base.receiveShadow = true; group.add(base);
  const tower = new THREE.CylinderGeometry(1.05, 1.55, 11, 28, 11, true).translate(0, 5.5, 0);
  const tp = tower.attributes.position, tc = new Float32Array(tp.count * 3), red = new THREE.Color('#d6403a'), wht = new THREE.Color('#f4f1ea');
  for (let i = 0; i < tp.count; i++) { const cc = Math.floor(tp.getY(i) / 2.2 + 0.001) % 2 ? red : wht; tc.set([cc.r, cc.g, cc.b], i * 3); }
  tower.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  const lh = new THREE.Group(); lh.position.set(x, by + 1.6, z); group.add(lh);
  const tm = new THREE.Mesh(tower, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })); tm.castShadow = true; lh.add(tm);
  const dark = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.5, metalness: 0.6 });
  const gal = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.25, 28), dark); gal.position.y = 11.1; lh.add(gal);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.04, 6, 40), dark); rail.rotation.x = Math.PI / 2; rail.position.y = 11.8; lh.add(rail);
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffd27a', emissiveIntensity: 1, roughness: 0.2 });
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.4, 20), lampMat); lamp.position.y = 12; lh.add(lamp);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.15, 1.3, 20), new THREE.MeshStandardMaterial({ color: '#c23b35', roughness: 0.45, metalness: 0.2 })); roof.position.y = 13.35; lh.add(roof);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uNight: U.uNight }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying float vL; varying vec3 vN; varying vec3 vV; void main(){ vL = uv.y; vec4 w = modelMatrix*vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: 'uniform float uNight; varying float vL; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); float a = pow(vL, 2.0) * edge * uNight * 0.45; gl_FragColor = vec4(vec3(1.0, 0.86, 0.55) * a, a); }',
  });
  const beamGeo = new THREE.CylinderGeometry(0.3, 7, 90, 24, 1, true).translate(0, -45, 0).rotateZ(Math.PI / 2);
  const beam = new THREE.Group(); beam.position.y = 12; lh.add(beam);
  const b2 = new THREE.Mesh(beamGeo, beamMat); b2.rotation.y = Math.PI;
  beam.add(new THREE.Mesh(beamGeo, beamMat), b2);
  return { beam, lampMat, pos: new THREE.Vector3(x, by + 14, z) };
}

function makeTurbine(x, z, group) {
  const g = new THREE.Group(); g.position.set(x, hgt(x, z) - 0.2, z);
  const white = new THREE.MeshStandardMaterial({ color: '#f1f3f4', roughness: 0.45, metalness: 0.1 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.48, 15, 14).translate(0, 7.5, 0), white); tower.castShadow = true; g.add(tower);
  const head = new THREE.Group(); head.position.y = 15; head.rotation.y = rr(0, TAU); g.add(head);
  const nac = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.4, 4, 10).rotateZ(Math.PI / 2), white); nac.castShadow = true; head.add(nac);
  const rotor = new THREE.Group(); rotor.position.x = 1.15; head.add(rotor);
  rotor.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10).scale(1.4, 1, 1), white));
  const blade = new THREE.BoxGeometry(0.06, 6.5, 0.45, 1, 6, 1).translate(0, 3.4, 0);
  const bp = blade.attributes.position; for (let k = 0; k < bp.count; k++) bp.setZ(k, bp.getZ(k) * (1 - bp.getY(k) / 8.5));
  blade.computeVertexNormals();
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(blade, white); b.rotation.x = (i / 3) * TAU; b.castShadow = true; rotor.add(b); }
  group.add(g);
  return { rotor, speed: rr(0.8, 1.2) };
}

function makeVillage(track, group, windowMat, exclusions) {
  const houseParts = [], winParts = [];
  const palette = ['#f6e7c8', '#f3c7b5', '#c9e4de', '#f9dc8c', '#d7c6ef', '#fbfaf5', '#bcd8f2'];
  const roofs = ['#b8473d', '#2f5d8a', '#9a5b3c', '#46686b', '#c46b3d'];
  const f = {}, spots = [];
  for (let i = 0; i < 9; i++) spots.push([track.len * 0.39 + i * 7.5 + rr(-1, 1), 8 + rr(0, 4) + (i % 2) * 6]);
  for (let i = 0; i < 5; i++) spots.push([track.len * 0.74 + i * 9 + rr(-1, 1), 8 + rr(0, 4)]);
  for (const [s, lat] of spots) {
    track.frame(s, lat, f);
    const w = rr(3.2, 4.6), d = rr(3.2, 4.2), h = rr(2.6, 3.4) * (R() < 0.25 ? 1.6 : 1);
    const yaw = f.heading + Math.PI + rr(-0.12, 0.12);
    let y = Infinity; for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) y = Math.min(y, hgt(f.x + ox * w * 0.5, f.z + oz * d * 0.5));
    const M = new THREE.Matrix4().compose(new THREE.Vector3(f.x, y, f.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
    const wall = palette[(R() * palette.length) | 0], roof = roofs[(R() * roofs.length) | 0];
    const tri = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.35, 0), new THREE.Vector2(w / 2 + 0.35, 0), new THREE.Vector2(0, w * 0.42)]);
    houseParts.push(...[
      paint(new THREE.BoxGeometry(w, h + 1.2, d).translate(0, (h + 1.2) / 2 - 1.2, 0), wall),
      paint(new THREE.ExtrudeGeometry(tri, { depth: d + 0.5, bevelEnabled: false }).translate(0, h, -d / 2 - 0.25), roof),
      paint(new THREE.BoxGeometry(0.8, 1.6, 0.08).translate(w * 0.18, 0.8, d / 2 + 0.03), '#6b4a33'),
      paint(new THREE.BoxGeometry(0.45, 1.3, 0.45).translate(-w * 0.25, h + w * 0.3, -d * 0.15), '#8b5e4a'),
    ].map((g) => g.applyMatrix4(M)));
    const wins = [[-w * 0.22, h * 0.55], [w * 0.3, h * 0.55 + (h > 4 ? 1.4 : 0)]];
    if (h > 4) wins.push([-w * 0.22, h * 0.55 + 1.6]);
    for (const [wx, wy] of wins) winParts.push(clean(new THREE.PlaneGeometry(0.75, 0.75).translate(wx, wy, d / 2 + 0.02)).applyMatrix4(M));
    for (const sgn of [-1, 1]) winParts.push(clean(new THREE.PlaneGeometry(0.7, 0.7).rotateY(sgn * Math.PI / 2).translate(sgn * (w / 2 + 0.02), h * 0.55, 0)).applyMatrix4(M));
    exclusions.push([f.x, f.z, Math.max(w, d) * 0.8 + 1.5]);
  }
  const houses = new THREE.Mesh(mergeGeometries(houseParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  houses.castShadow = houses.receiveShadow = true; group.add(houses);
  group.add(new THREE.Mesh(mergeGeometries(winParts), windowMat));
}

function makePier(track, group, exclusions) {
  const s = track.len * 0.62, f = track.frame(s, 0, {});
  const ox = -f.rx, oz = -f.rz, start = 3.4, L = 26, parts = [];
  const M = new THREE.Matrix4().compose(new THREE.Vector3(f.x + ox * start, 0, f.z + oz * start), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-oz, ox), 0)), new THREE.Vector3(1, 1, 1));
  const deckY = Math.max(hgt(f.x + ox * start, f.z + oz * start) + 0.15, 0.9);
  for (let i = 0; i < L / 0.5; i++) parts.push(paint(new THREE.BoxGeometry(0.42, 0.08, 2.2).translate(i * 0.5 + 0.25, deckY, 0), i % 3 ? '#9a7550' : '#87633f'));
  for (let i = 0; i <= L / 3; i++) for (const sz of [-1.05, 1.05]) {
    parts.push(paint(new THREE.CylinderGeometry(0.1, 0.12, 6, 6).translate(i * 3 + 0.2, deckY - 2.8, sz), '#5f4630'));
    parts.push(paint(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 5).translate(i * 3 + 0.2, deckY + 0.5, sz), '#e8e1d3'));
  }
  for (const sz of [-1.05, 1.05]) parts.push(paint(new THREE.BoxGeometry(L, 0.06, 0.06).translate(L / 2, deckY + 0.95, sz), '#e8e1d3'));
  const pier = new THREE.Mesh(mergeGeometries(parts.map((g) => g.applyMatrix4(M))), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  pier.castShadow = pier.receiveShadow = true; group.add(pier);
  for (let k = 0; k < 14; k++) exclusions.push([f.x + ox * (start + k * 2), f.z + oz * (start + k * 2), 2.5]);
  return new THREE.Vector3(f.x + ox * (start + L), deckY, f.z + oz * (start + L));
}

function makeBoat(color, sailColor) {
  const g = new THREE.Group();
  const hull = new THREE.BoxGeometry(4.2, 0.9, 1.5, 8, 2, 2); const p = hull.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k), f = x / 2.1;
    let zz = z * (f > 0 ? 1 - Math.pow(f, 1.6) * 0.95 : 1 - Math.pow(-f, 3) * 0.3);
    if (y < 0) zz *= 0.45;
    p.setXYZ(k, x, y + (f > 0 ? f * f * 0.25 : 0), zz);
  }
  hull.computeVertexNormals();
  const hm = new THREE.Mesh(hull, new THREE.MeshStandardMaterial({ color, roughness: 0.5 })); hm.castShadow = true; g.add(hm);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 1.1).translate(-0.4, 0.45, 0), new THREE.MeshStandardMaterial({ color: '#c9a77a', roughness: 0.8 })));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 5.6).translate(0.3, 3.2, 0), new THREE.MeshStandardMaterial({ color: '#eeeeee', roughness: 0.4 })));
  const sail = new THREE.BufferGeometry(); sail.setAttribute('position', new THREE.Float32BufferAttribute([0.25, 0.8, 0, 0.25, 5.8, 0, -1.9, 0.9, 0, 0.35, 5.2, 0, 0.35, 0.9, 0, 2.0, 0.85, 0], 3)); sail.computeVertexNormals();
  const sm = new THREE.Mesh(sail, new THREE.MeshStandardMaterial({ color: sailColor, roughness: 0.7, side: THREE.DoubleSide })); sm.castShadow = true; g.add(sm);
  return g;
}

function makeGull() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6).scale(2.2, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: '#f5f5f2', roughness: 0.7 })));
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0.15, 0, 0, -0.18, 0, 0, -0.05, 0, 0.9, 0.25, 0, 0.55], 3));
  wingGeo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 0.2, 0.2, 0.22, 0.9, 0.9, 0.9], 3));
  wingGeo.setIndex([0, 1, 2, 0, 2, 3]); wingGeo.computeVertexNormals();
  const wmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
  const L = new THREE.Mesh(wingGeo, wmat), Rw = new THREE.Mesh(wingGeo, wmat); Rw.scale.z = -1;
  g.add(L, Rw);
  return { g, L, R: Rw };
}

// ------------------------------------------------------------------ world
export function createWorld(scene, track, U) {
  const group = new THREE.Group(); scene.add(group);
  const sky = makeSky(U); scene.add(sky);
  const ocean = makeOcean(U); group.add(ocean);
  const terrain = makeTerrain(); group.add(terrain);
  const roadParts = makeRoad(track); group.add(roadParts.road, roadParts.shoulder);
  const exclusions = [];

  const windowMat = new THREE.MeshStandardMaterial({ color: '#4b5866', emissive: '#ffbf66', emissiveIntensity: 0, roughness: 0.2, metalness: 0.3 });
  makeVillage(track, group, windowMat, exclusions);
  const pierEnd = makePier(track, group, exclusions);
  const light = makeLighthouse(U, group, exclusions);
  const turbines = [0.19, 2.28, 4.37].map((a) => { const x = 15 * Math.cos(a), z = 15 * Math.sin(a); exclusions.push([x, z, 4]); return makeTurbine(x, z, group); });

  // roadside furniture: reflector posts on the sea side, street lamps on the inland side
  const f = {}, posts = [], lamps = [], pools = [];
  for (let s = 0; s < track.len; s += 7) { track.frame(s, -3.05, f); posts.push({ x: f.x, y: hgt(f.x, f.z), z: f.z, ry: f.heading }); }
  for (let s = 10; s < track.len; s += 34) {
    track.frame(s, 3.2, f); lamps.push({ x: f.x, y: hgt(f.x, f.z), z: f.z, ry: f.heading + Math.PI });
    track.frame(s, 1.6, f); pools.push({ x: f.x, y: hgt(f.x, f.z) + 0.11, z: f.z, rx: -Math.PI / 2 });
    exclusions.push([f.x, f.z, 2.5]);
  }
  const postGeo = mergeGeometries([paint(new THREE.BoxGeometry(0.1, 0.7, 0.1).translate(0, 0.35, 0), '#f2f0ea'), paint(new THREE.BoxGeometry(0.11, 0.12, 0.11).translate(0, 0.6, 0), '#222222')]);
  group.add(instanced(postGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), posts));
  const reflectorMat = new THREE.MeshStandardMaterial({ color: '#ff5533', emissive: '#ff3311', emissiveIntensity: 0.4 });
  group.add(instanced(new THREE.BoxGeometry(0.115, 0.05, 0.115).translate(0, 0.6, 0), reflectorMat, posts, false));
  const poleGeo = mergeGeometries([
    paint(new THREE.CylinderGeometry(0.06, 0.09, 4.6, 8).translate(0, 2.3, 0), '#39424d'),
    paint(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6).rotateX(Math.PI / 2).translate(0, 4.55, 0.7), '#39424d'),
    paint(new THREE.CylinderGeometry(0.12, 0.28, 0.22, 10).translate(0, 4.45, 1.45), '#39424d'),
  ]);
  group.add(instanced(poleGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.7 }), lamps));
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffcf7a', emissiveIntensity: 0 });
  group.add(instanced(new THREE.SphereGeometry(0.13, 10, 6).translate(0, 4.3, 1.45), bulbMat, lamps, false));
  const poolTex = canvasTex(128, 128, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,200,120,0.9)'); gr.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  group.add(instanced(new THREE.PlaneGeometry(5.5, 5.5), poolMat, pools, false));

  // vegetation
  const free = (x, z, pad = 0) => exclusions.every(([ex, ez, er]) => Math.hypot(x - ex, z - ez) > er + pad);
  const roadDist = (x, z) => Math.abs(Math.hypot(x, z) - roadR(Math.atan2(z, x)));
  const palms = [], trees = [], pines = [], tufts = [], flowers = [], rocks = [];
  let guard = 0;
  while (palms.length < 70 && guard++ < 5000) {
    const a = rr(0, TAU), rad = roadR(a) + rr(3.6, 8.5), x = rad * Math.cos(a), z = rad * Math.sin(a), y = hgt(x, z);
    if (y > 0.35 && free(x, z)) palms.push({ x, y: y - 0.1, z, ry: rr(0, TAU), s: rr(0.75, 1.15), rz: rr(-0.08, 0.08) });
  }
  guard = 0;
  while (trees.length + pines.length < 260 && guard++ < 20000) {
    const a = rr(0, TAU), rad = Math.sqrt(R()) * 44, x = rad * Math.cos(a), z = rad * Math.sin(a);
    if (roadDist(x, z) < 4.5 || rad > roadR(a) || !free(x, z, 1)) continue;
    if (vn(x * 0.06 + 3, z * 0.06) < 0.42) continue;
    const y = hgt(x, z), it = { x, y: y - 0.1, z, ry: rr(0, TAU), s: rr(0.7, 1.3) };
    (y > 6.5 || R() < 0.3 ? pines : trees).push(it);
  }
  guard = 0;
  while (tufts.length < 3200 && guard++ < 30000) {
    const a = rr(0, TAU), rad = Math.sqrt(R()) * 50, x = rad * Math.cos(a), z = rad * Math.sin(a);
    if (rad - roadR(a) > -2.8 || !free(x, z)) continue;
    tufts.push({ x, y: hgt(x, z) - 0.02, z, ry: rr(0, TAU), s: rr(0.7, 1.6) });
    if (R() < 0.3) {
      const c = new THREE.Color().setHSL([0.0, 0.12, 0.6, 0.8, 0.95][(R() * 5) | 0], 0.75, 0.62);
      const fx = x + rr(-0.4, 0.4), fz = z + rr(-0.4, 0.4);
      flowers.push({ x: fx, y: hgt(fx, fz) - 0.02, z: fz, ry: rr(0, TAU), s: rr(0.8, 1.3), c });
    }
  }
  guard = 0;
  while (rocks.length < 110 && guard++ < 6000) {
    const a = rr(0, TAU), rad = coastR(a) + rr(-7, 6), x = rad * Math.cos(a), z = rad * Math.sin(a), y = hgt(x, z);
    if (y > 0.9 || roadDist(x, z) < 3.5 || !free(x, z)) continue;
    rocks.push({ x, y: y + 0.1, z, ry: rr(0, TAU), rx: rr(-0.3, 0.3), s: rr(0.35, 1.6) });
  }
  const windMat = (amp, freq, opts = {}) => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, ...opts }); addWind(m, U, amp, freq); return m; };
  group.add(instanced(palmGeo(), windMat(0.006, 1.1, { side: THREE.DoubleSide }), palms));
  group.add(instanced(roundTreeGeo(), windMat(0.004, 1.4, { flatShading: true }), trees));
  group.add(instanced(pineGeo(), windMat(0.003, 1.2, { flatShading: true }), pines));
  group.add(instanced(tuftGeo(), windMat(0.35, 2.2, { side: THREE.DoubleSide }), tufts, false));
  group.add(instanced(flowerGeo(), windMat(0.3, 2.0), flowers, false));
  group.add(instanced(rockGeo(3), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), rocks));

  // boats
  const boats = [];
  [['#e9eef2', '#ff7a59'], ['#2f4f7a', '#f6f1e6'], ['#c0392b', '#fdf6e3'], ['#f4d35e', '#ffffff'], ['#1f7a6d', '#ffd166']].forEach(([c, s], i) => {
    const g = makeBoat(c, s); group.add(g);
    boats.push({ g, a: (i / 5) * TAU + 0.6, r: rr(82, 125), w: rr(0.004, 0.009) * (i % 2 ? 1 : -1) });
  });

  // gulls circling the lighthouse and the pier
  const gulls = [];
  for (let i = 0; i < 16; i++) {
    const gu = makeGull(); group.add(gu.g);
    const c = i < 8 ? light.pos : pierEnd;
    gulls.push({ ...gu, cx: c.x, cz: c.z, r: rr(6, 18), h: rr(8, 18), w: rr(0.25, 0.45) * (R() < 0.5 ? 1 : -1), ph: rr(0, TAU), fl: rr(5, 7) });
  }

  // fireflies
  const ffN = 260, ffPos = new Float32Array(ffN * 3), ffSeed = new Float32Array(ffN);
  for (let i = 0; i < ffN; i++) { const a = rr(0, TAU), rad = roadR(a) - rr(4, 16), x = rad * Math.cos(a), z = rad * Math.sin(a); ffPos.set([x, hgt(x, z) + rr(0.4, 2.4), z], i * 3); ffSeed[i] = R() * 100; }
  const ffGeo = new THREE.BufferGeometry(); ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3)); ffGeo.setAttribute('seed', new THREE.BufferAttribute(ffSeed, 1));
  const ffMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uNight: U.uNight, uPx: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'uniform float uTime; uniform float uPx; attribute float seed; varying float vA; void main(){ vec3 p = position + vec3(sin(uTime*0.7+seed)*0.8, sin(uTime*1.3+seed*2.)*0.4, cos(uTime*0.6+seed*1.7)*0.8); vec4 mv = modelViewMatrix*vec4(p,1.); vA = 0.5+0.5*sin(uTime*3.+seed*7.); gl_PointSize = uPx*(40.0/-mv.z); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform float uNight; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d); a = a*a*vA*uNight; gl_FragColor = vec4(vec3(0.75,1.0,0.35)*a*3.0, a); }',
  });
  const fireflies = new THREE.Points(ffGeo, ffMat); fireflies.frustumCulled = false; group.add(fireflies);

  return {
    sky, ocean, ffMat, roadWidth: roadParts.W, lighthouse: light.pos, pierEnd,
    update(dt, t, env) {
      light.beam.rotation.y = t * 0.9;
      light.lampMat.emissiveIntensity = 1.2 + env.night * 9;
      windowMat.emissiveIntensity = env.night * 2.6;
      bulbMat.emissiveIntensity = env.night * 14;
      reflectorMat.emissiveIntensity = 0.3 + env.night * 2.5;
      poolMat.opacity = env.night * 0.55;
      roadParts.roadMat.roughness = lerp(0.82, 0.3, env.rain);
      roadParts.roadMat.color.setScalar(lerp(1, 0.7, env.rain));
      for (const tb of turbines) tb.rotor.rotation.x = t * tb.speed * (0.6 + U.uWind.value * 0.8);
      for (const b of boats) {
        b.a += b.w * dt;
        const x = b.r * Math.cos(b.a), z = b.r * Math.sin(b.a), sg = Math.sign(b.w);
        const hx = waveH(x + 1, z, t) - waveH(x - 1, z, t), hz = waveH(x, z + 1, t) - waveH(x, z - 1, t);
        b.g.position.set(x, waveH(x, z, t) + 0.15, z);
        b.g.rotation.set(Math.atan(hz * 0.5) * 0.8, Math.atan2(Math.cos(b.a) * sg, -Math.sin(b.a) * sg) - Math.PI / 2, -Math.atan(hx * 0.5) * 0.8, 'YXZ');
      }
      for (const gu of gulls) {
        gu.ph += gu.w * dt;
        gu.g.position.set(gu.cx + Math.cos(gu.ph) * gu.r, gu.h + Math.sin(t * 0.7 + gu.r) * 1.2, gu.cz + Math.sin(gu.ph) * gu.r);
        gu.g.rotation.set(0, -gu.ph - (gu.w > 0 ? 0 : Math.PI), Math.sign(gu.w) * 0.35, 'YXZ');
        const flap = Math.sin(t * gu.fl + gu.r) * 0.6 * (0.5 + 0.5 * Math.sin(t * 0.4 + gu.r * 3));
        gu.L.rotation.x = -flap; gu.R.rotation.x = flap;
      }
    },
  };
}
