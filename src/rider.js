import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, damp, taperTube, updateTube, canvasTex, paint, paintGradient } from './util.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);

// Cylinder from a to b (radius r0 at a, r1 at b).
function seg(a, b, r0, r1 = r0, radial = 12) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, radial, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

// Two-bone IK: returns the middle joint.
const _d = new THREE.Vector3(), _p = new THREE.Vector3();
function ik(A, C, l1, l2, pole, out) {
  _d.subVectors(C, A); let d = _d.length(); _d.divideScalar(d || 1);
  d = clamp(d, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  return out.copy(A).addScaledVector(_d, a).addScaledVector(_p, h);
}

// Orient a group at A so its local +x points to B and local +y follows the hint.
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
function aim(obj, A, B, hint) {
  _x.subVectors(B, A).normalize();
  _y.copy(hint).addScaledVector(_x, -hint.dot(_x)).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  obj.position.copy(A); obj.quaternion.setFromRotationMatrix(_m);
}

function ellipsoid(rx, ry, rz, mat, ws = 20, hs = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, ws, hs), mat);
  m.scale.set(rx, ry, rz); m.castShadow = true; return m;
}

function featherTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 18; row++) for (let col = 0; col < 14; col++) {
      const x = (col + (row % 2) * 0.5) * (w / 13), y = row * (h / 16);
      const gr = g.createRadialGradient(x, y + 10, 2, x, y + 4, 16);
      gr.addColorStop(0, '#b8b8b8'); gr.addColorStop(0.8, '#7a7a7a'); gr.addColorStop(1, '#5a5a5a');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y + 6, 11, 14, 0, 0, Math.PI); g.fill();
    }
  }, { repeat: [3, 3], srgb: false });
}

export class Rider {
  constructor() {
    this.root = new THREE.Group();
    this.bike = new THREE.Group(); this.root.add(this.bike);
    this.mats = {};
    this.buildBike();
    this.buildPelican();
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = !o.userData.noShadow; o.receiveShadow = true; } });
    this.wheelAngle = 0; this.crank = 0; this.blink = 0; this.nextBlink = 2; this.ringT = 0; this.gulpT = 0;
    this.head = { yaw: 0, pitch: 0 };
  }

  buildBike() {
    const paintMat = new THREE.MeshPhysicalMaterial({ color: '#13a8a0', metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    const chrome = new THREE.MeshStandardMaterial({ color: '#e8ecef', metalness: 1, roughness: 0.18 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2d31', metalness: 0.4, roughness: 0.5 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.92 });
    const leather = new THREE.MeshPhysicalMaterial({ color: '#7a4a2a', roughness: 0.55, clearcoat: 0.4, sheen: 0.6, sheenColor: new THREE.Color('#d9a066') });
    this.mats.paint = paintMat;
    const AY = 0.367, RA = V(-0.52, AY), FA = V(0.52, AY), BB = V(-0.04, 0.32), SC = V(-0.2, 0.8), HT = V(0.36, 0.84), HB = V(0.41, 0.66);
    Object.assign(this, { AY, RA, FA, BB, SC, HT, HB });
    const frame = [
      seg(BB, SC, 0.022), seg(SC, HT, 0.019), seg(BB, HB, 0.026, 0.024), seg(HB, HT, 0.03),
      seg(BB.clone().setZ(0.055), RA.clone().setZ(0.065), 0.013), seg(BB.clone().setZ(-0.055), RA.clone().setZ(-0.065), 0.013),
      seg(SC.clone().setZ(0.03), RA.clone().setZ(0.065), 0.011), seg(SC.clone().setZ(-0.03), RA.clone().setZ(-0.065), 0.011),
      new THREE.CylinderGeometry(0.035, 0.035, 0.1, 16).rotateX(Math.PI / 2).translate(BB.x, BB.y, 0),
    ];
    this.bike.add(new THREE.Mesh(mergeGeometries(frame), paintMat));
    // rear rack and fender in chrome
    const rack = [seg(V(-0.3, 0.74, 0.07), V(-0.68, 0.74, 0.07), 0.007), seg(V(-0.3, 0.74, -0.07), V(-0.68, 0.74, -0.07), 0.007),
      seg(V(-0.68, 0.74, 0.07), RA.clone().setZ(0.07), 0.006), seg(V(-0.68, 0.74, -0.07), RA.clone().setZ(-0.07), 0.006),
      seg(V(-0.68, 0.74, -0.07), V(-0.68, 0.74, 0.07), 0.007)];
    this.bike.add(new THREE.Mesh(mergeGeometries(rack), chrome));
    const fender = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 6, 30, 1.9).scale(1, 1, 1.8), chrome);
    fender.position.copy(RA); fender.rotation.z = 0.6; this.bike.add(fender);
    // seat post + saddle
    const sdir = new THREE.Vector3().subVectors(SC, BB).normalize(), post = SC.clone().addScaledVector(sdir, 0.13);
    this.bike.add(new THREE.Mesh(seg(SC, post, 0.013), chrome));
    const sg = new THREE.SphereGeometry(1, 24, 12); const sp = sg.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
      sp.setXYZ(i, x * 0.14, y * (y > 0 ? 0.035 : 0.02), z * 0.095 * (1 - 0.62 * clamp((x + 0.1) / 1.1, 0, 1)));
    }
    sg.computeVertexNormals();
    const saddle = new THREE.Mesh(sg, leather); saddle.position.set(post.x + 0.02, post.y + 0.02, 0); saddle.rotation.z = -0.05; this.bike.add(saddle);
    this.saddleTop = saddle.position.y + 0.035;
    // tail light
    this.tailMat = new THREE.MeshStandardMaterial({ color: '#ff2a1a', emissive: '#ff1a0a', emissiveIntensity: 1.5 });
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.07), this.tailMat); tl.position.set(-0.7, 0.73, 0); this.bike.add(tl);

    // wheels
    const wheel = () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.TorusGeometry(0.345, 0.022, 12, 56), rubber));
      g.add(new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.011, 8, 56), chrome));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 12).rotateX(Math.PI / 2), chrome));
      const sp = [];
      for (let i = 0; i < 32; i++) {
        const side = i % 2 ? 1 : -1, a = (i / 32) * TAU, hubA = a + side * 0.35;
        sp.push(seg(V(Math.cos(hubA) * 0.02, Math.sin(hubA) * 0.02, side * 0.045), V(Math.cos(a) * 0.32, Math.sin(a) * 0.32, 0), 0.0022, 0.0022, 4));
      }
      const spMat = new THREE.MeshStandardMaterial({ color: '#d9dde0', metalness: 1, roughness: 0.25, transparent: true });
      const spokes = new THREE.Mesh(mergeGeometries(sp), spMat); spokes.castShadow = false; g.add(spokes);
      const blurTex = canvasTex(128, 128, (c, w) => {
        const gr = c.createRadialGradient(w / 2, w / 2, w * 0.04, w / 2, w / 2, w / 2);
        gr.addColorStop(0, 'rgba(220,225,230,0.0)'); gr.addColorStop(0.2, 'rgba(220,225,230,0.7)'); gr.addColorStop(0.95, 'rgba(220,225,230,0.5)'); gr.addColorStop(1, 'rgba(220,225,230,0)');
        c.fillStyle = gr; c.fillRect(0, 0, w, w);
      });
      const blurMat = new THREE.MeshBasicMaterial({ map: blurTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.32, 40), blurMat); disc.userData.noShadow = true; g.add(disc);
      g.userData = { spMat, blurMat };
      return g;
    };
    this.rearWheel = wheel(); this.rearWheel.position.copy(RA); this.bike.add(this.rearWheel);

    // crankset
    this.crankG = new THREE.Group(); this.crankG.position.copy(BB); this.bike.add(this.crankG);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.006, 6, 40), chrome); ring.position.z = 0.075; this.crankG.add(ring);
    const ringDisk = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.004, 40).rotateX(Math.PI / 2), dark); ringDisk.position.z = 0.075; this.crankG.add(ringDisk);
    for (let i = 0; i < 5; i++) { const a = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.006), chrome); a.position.set(Math.cos(i * 1.2566) * 0.045, Math.sin(i * 1.2566) * 0.045, 0.078); a.rotation.z = i * 1.2566 - Math.PI / 2; this.crankG.add(a); }
    this.pedals = [];
    for (const side of [1, -1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.19, 0.012).translate(0, -0.085, 0), chrome);
      arm.position.z = side * 0.09; if (side < 0) arm.rotation.z = Math.PI; this.crankG.add(arm);
      const pedal = new THREE.Group(); pedal.position.set(0, -0.17, side * 0.04); arm.add(pedal);
      pedal.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.075).translate(0, 0, side * 0.045), dark));
      pedal.add(new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.008, 0.08).translate(0, 0.006, side * 0.045), new THREE.MeshStandardMaterial({ color: '#ffb000', emissive: '#ff8800', emissiveIntensity: 0.3 })));
      this.pedals.push(pedal);
    }
    const cog = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.006, 6, 24), chrome); cog.position.set(RA.x, RA.y, 0.075); this.bike.add(cog);
    this.cog = cog;
    // chain as instanced links riding a stadium loop
    const r1 = 0.1, r2 = 0.042, c1 = new THREE.Vector2(BB.x, BB.y), c2 = new THREE.Vector2(RA.x, RA.y);
    const u = c2.clone().sub(c1).normalize(), n = new THREE.Vector2(-u.y, u.x); if (n.y < 0) n.negate();
    const pts = [];
    const arc = (c, r, a0, a1, k) => { for (let i = 0; i <= k; i++) { const a = a0 + (a1 - a0) * (i / k); pts.push(new THREE.Vector2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r)); } };
    const na = Math.atan2(n.y, n.x);
    pts.push(c1.clone().addScaledVector(n, r1)); pts.push(c2.clone().addScaledVector(n, r2));
    arc(c2, r2, na, na + Math.PI, 16);
    pts.push(c1.clone().addScaledVector(n, -r1));
    arc(c1, r1, na + Math.PI, na + TAU, 24);
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.chain = { pts, cum, len: cum[cum.length - 1], r1 };
    const nLinks = Math.floor(this.chain.len / 0.0254);
    this.chainLinks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.024, 0.009, 0.01), dark, nLinks);
    this.chainLinks.castShadow = false; this.chainLinks.frustumCulled = false; this.bike.add(this.chainLinks);
    this.chainSpacing = this.chain.len / nLinks;

    // steering assembly
    const axis = new THREE.Vector3().subVectors(HT, HB).normalize();
    this.pivot = new THREE.Group(); this.pivot.position.copy(HB); this.pivot.quaternion.setFromUnitVectors(Y, axis); this.bike.add(this.pivot);
    this.steer = new THREE.Group(); this.pivot.add(this.steer);
    this.pivot.updateMatrix();
    const inv = this.pivot.matrix.clone().invert();
    const faL = FA.clone().applyMatrix4(inv);
    const crown = V(0, -0.02, 0);
    const steerParts = [
      seg(V(0, -0.03, 0.055), faL.clone().setZ(0.055), 0.012, 0.009), seg(V(0, -0.03, -0.055), faL.clone().setZ(-0.055), 0.012, 0.009),
      new THREE.BoxGeometry(0.05, 0.03, 0.14).translate(crown.x, crown.y, 0),
    ];
    this.steer.add(new THREE.Mesh(mergeGeometries(steerParts), paintMat));
    const hlen = HT.distanceTo(HB);
    this.steer.add(new THREE.Mesh(mergeGeometries([seg(V(0, hlen, 0), V(0, hlen + 0.08, 0), 0.014), seg(V(0, hlen + 0.07, 0), V(0.1, hlen + 0.1, 0), 0.014)]), chrome));
    const barPts = [V(-0.09, hlen + 0.14, -0.29), V(0.04, hlen + 0.11, -0.17), V(0.1, hlen + 0.1, 0), V(0.04, hlen + 0.11, 0.17), V(-0.09, hlen + 0.14, 0.29)];
    this.steer.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(barPts), 40, 0.011, 8), chrome));
    this.gripsL = [];
    for (const side of [1, -1]) {
      const gp = barPts[side > 0 ? 4 : 0];
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.1, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c9864a', roughness: 0.7 }));
      grip.position.copy(gp).add(V(-0.005, 0, -side * 0.035)); this.steer.add(grip);
      this.gripsL.push(grip.position.clone());
    }
    // bell
    this.bell = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 8, 0, TAU, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 1, roughness: 0.15 }));
    this.bell.position.copy(barPts[1]).add(V(0.0, 0.018, 0.02)); this.steer.add(this.bell);
    // front wheel
    this.frontWheel = wheel(); this.frontWheel.position.copy(faL); this.frontWheel.quaternion.copy(this.pivot.quaternion).invert(); this.steer.add(this.frontWheel);
    const ffender = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 6, 30, 1.6).scale(1, 1, 1.8), chrome);
    ffender.position.copy(faL); ffender.rotation.z = 1.05; this.steer.add(ffender);
    // wicker basket with fish
    const weave = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#8a5a2b'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
        const off = ((y / 16) % 2) * 8;
        const gr = g.createLinearGradient(0, y, 0, y + 14); gr.addColorStop(0, '#e2b06a'); gr.addColorStop(1, '#a8743a');
        g.fillStyle = gr; g.beginPath(); g.ellipse(x + off + 8, y + 7, 9, 6, 0, 0, TAU); g.fill();
      }
    }, { repeat: [4, 1] });
    const basketMat = new THREE.MeshStandardMaterial({ map: weave, roughness: 0.9, side: THREE.DoubleSide, bumpMap: weave, bumpScale: 2 });
    const basket = new THREE.Group(); basket.position.set(0.27, hlen + 0.0, 0); basket.quaternion.copy(this.pivot.quaternion).invert(); this.steer.add(basket);
    basket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.2, 28, 1, true), basketMat));
    basket.add(new THREE.Mesh(new THREE.CircleGeometry(0.14, 28).rotateX(-Math.PI / 2).translate(0, -0.1, 0), basketMat));
    basket.add(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 6, 32).rotateX(Math.PI / 2).translate(0, 0.1, 0), new THREE.MeshStandardMaterial({ color: '#b07a3e', roughness: 0.8 })));
    this.basketFish = [];
    for (let i = 0; i < 3; i++) {
      const f = makeFish(0.7 + i * 0.1);
      f.position.set(-0.03 + i * 0.04, 0.08 + i * 0.03, -0.06 + i * 0.06); f.rotation.set(0.3 * i, i * 1.4, 1.1 + i * 0.25);
      basket.add(f); this.basketFish.push(f);
    }
    // headlight
    const lampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.06, 16).rotateZ(Math.PI / 2), chrome);
    lampBody.position.set(0.16, hlen + 0.05, 0); this.steer.add(lampBody);
    this.lensMat = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff2c0', emissiveIntensity: 0.4 });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16).rotateY(Math.PI / 2), this.lensMat); lens.position.set(0.191, hlen + 0.05, 0); this.steer.add(lens);
    this.headlight = new THREE.SpotLight('#fff1cc', 0, 26, 0.55, 0.5, 1.4);
    this.headlight.position.set(0.2, hlen + 0.05, 0); this.steer.add(this.headlight);
    this.headlight.target.position.set(4, hlen - 1.2, 0); this.steer.add(this.headlight.target);
  }

  buildPelican() {
    const ft = featherTex();
    const white = new THREE.MeshPhysicalMaterial({ color: '#f6f2ea', roughness: 0.78, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color('#fff3e0'), bumpMap: ft, bumpScale: 1.2 });
    const cream = new THREE.MeshPhysicalMaterial({ color: '#f1e6c8', roughness: 0.8, sheen: 1, sheenColor: new THREE.Color('#fff0c8') });
    const black = new THREE.MeshPhysicalMaterial({ color: '#1e1f22', roughness: 0.6, sheen: 0.8, sheenColor: new THREE.Color('#5a6070') });
    const bill = new THREE.MeshPhysicalMaterial({ color: '#f6a333', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const pouchMat = new THREE.MeshPhysicalMaterial({ color: '#f08a4b', roughness: 0.45, transmission: 0.0, sheen: 0.4, sheenColor: new THREE.Color('#ffc59a'), side: THREE.DoubleSide });
    const leg = new THREE.MeshStandardMaterial({ color: '#f39a3d', roughness: 0.55 });
    const scarfMat = new THREE.MeshPhysicalMaterial({ color: '#e23b4e', roughness: 0.7, sheen: 1, sheenColor: new THREE.Color('#ff9aa8'), side: THREE.DoubleSide });
    Object.assign(this.mats, { white, black, bill, pouchMat, leg, scarfMat });

    // torso
    this.torso = new THREE.Group(); this.torso.position.set(-0.11, 1.22, 0); this.root.add(this.torso);
    const body = ellipsoid(0.36, 0.25, 0.27, white, 32, 24); body.rotation.z = 0.78; this.torso.add(body);
    const belly = ellipsoid(0.3, 0.2, 0.235, cream, 28, 18); belly.position.set(0.05, -0.04, 0); belly.rotation.z = 0.78; this.torso.add(belly);
    // tail fan
    const tail = new THREE.Group(); tail.position.set(-0.24, -0.2, 0); this.torso.add(tail);
    for (let i = -2; i <= 2; i++) {
      const f = ellipsoid(0.13, 0.02, 0.04, i % 2 ? white : cream, 12, 6);
      f.position.set(-0.08, -0.02, i * 0.04); f.rotation.set(0, i * 0.18, -0.45); tail.add(f);
    }
    this.tail = tail;
    this.shoulderL = [V(0.08, 0.17, 0.22), V(0.08, 0.17, -0.22)]; // torso-local, [right(+z), left(-z)]
    this.neckBaseL = V(0.16, 0.24, 0);
    this.hipL = [V(-0.08, -0.2, 0.11), V(-0.08, -0.2, -0.11)];

    // neck (animated tube)
    this.neckR = (t) => lerp(0.085, 0.052, Math.pow(t, 0.8));
    this.neckPts = [V(0, 1.4), V(0, 1.55), V(0.1, 1.7), V(0.2, 1.78)];
    this.neckGeo = taperTube(this.neckPts, 14, this.neckR, 28);
    this.neck = new THREE.Mesh(this.neckGeo, white); this.neck.frustumCulled = false; this.root.add(this.neck);

    // head
    this.headG = new THREE.Group(); this.root.add(this.headG);
    const skull = ellipsoid(0.1, 0.085, 0.078, white, 28, 20); this.headG.add(skull);
    const crest = new THREE.Group(); crest.position.set(-0.04, 0.07, 0); this.headG.add(crest);
    for (let i = 0; i < 5; i++) { const c = ellipsoid(0.05, 0.012, 0.02, cream, 8, 6); c.position.set(-0.02 - i * 0.012, 0.005 * i, (i - 2) * 0.01); c.rotation.z = 0.5 + i * 0.12; crest.add(c); }
    this.crest = crest;
    this.eyes = [];
    for (const s of [1, -1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.006, 8, 18), new THREE.MeshStandardMaterial({ color: '#ffc68a', roughness: 0.5 }));
      ring.position.set(0.035, 0.022, s * 0.066); ring.rotation.y = s * 0.45; this.headG.add(ring);
      const eye = new THREE.Group(); eye.position.copy(ring.position); eye.rotation.y = s * 0.45; this.headG.add(eye);
      eye.add(new THREE.Mesh(new THREE.SphereGeometry(0.017, 16, 12), new THREE.MeshStandardMaterial({ color: '#f3e9b0', roughness: 0.2 })));
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), new THREE.MeshPhysicalMaterial({ color: '#08090a', roughness: 0.05, clearcoat: 1 }));
      pupil.position.z = s * 0.012; pupil.position.x = 0.004; eye.add(pupil);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.003, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      glint.position.set(0.008, 0.005, s * 0.019); eye.add(glint);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0225, 16, 10), white); lid.scale.y = 0.05; lid.userData.noShadow = true; eye.add(lid);
      this.eyes.push({ eye, lid });
    }
    // bill: upper mandible
    const L = 0.56;
    const ug = new THREE.BoxGeometry(L, 0.03, 0.075, 28, 2, 4).translate(L / 2, 0, 0);
    const up = ug.attributes.position;
    for (let i = 0; i < up.count; i++) {
      const x = up.getX(i), t = x / L; let y = up.getY(i), z = up.getZ(i);
      z *= lerp(1, 0.62, t) * (1 - 0.3 * Math.pow(t, 6));
      y = y * lerp(1.1, 0.7, t) + Math.abs(z) * -0.25 - t * 0.012;
      if (t > 0.92) y -= Math.pow((t - 0.92) / 0.08, 2) * 0.03;
      up.setXYZ(i, x, y, z);
    }
    ug.computeVertexNormals();
    const upperBill = new THREE.Group(); upperBill.position.set(0.07, -0.01, 0); upperBill.rotation.z = -0.38; this.headG.add(upperBill);
    upperBill.add(new THREE.Mesh(paintGradient(ug, '#f39b2f', '#ffd25a', 0, L, 'x'), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.6 })));
    const ridge = new THREE.Mesh(seg(V(0.02, 0.016, 0), V(L * 0.95, 0.002, 0), 0.007, 0.004, 6), new THREE.MeshStandardMaterial({ color: '#e8752a', roughness: 0.4 })); upperBill.add(ridge);
    const nail = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshStandardMaterial({ color: '#d4552a', roughness: 0.3 })); nail.position.set(L - 0.005, -0.02, 0); nail.scale.set(1, 1.3, 0.9); upperBill.add(nail);
    // lower jaw + pouch (opens around the base)
    this.jaw = new THREE.Group(); this.jaw.position.set(0.06, -0.035, 0); this.jaw.rotation.z = -0.38; this.headG.add(this.jaw);
    const pg = new THREE.SphereGeometry(1, 32, 16); const pp = pg.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      const t = (x + 1) / 2, X = t * (L * 0.96);
      const depth = 0.15 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 1.2) + 0.012;
      const wid = lerp(0.04, 0.024, t);
      const Yv = y > 0 ? y * 0.008 : y * depth;
      pp.setXYZ(i, X, Yv, z * wid * (y > 0 ? 1 : 0.7 + 0.3 * (1 + y)));
    }
    pg.computeVertexNormals();
    const pouch = new THREE.Mesh(pg, pouchMat); this.jaw.add(pouch); this.pouch = pouch;
    const lowerEdge = new THREE.Mesh(seg(V(0, 0, 0), V(L * 0.96, -0.004, 0), 0.012, 0.006, 8).scale(1, 0.6, 3.2), bill); this.jaw.add(lowerEdge);

    // wings: upper arm, forearm, primaries
    this.wing = [];
    for (const s of [1, -1]) {
      const up = new THREE.Group(), fore = new THREE.Group(); this.root.add(up, fore);
      const u = ellipsoid(0.19, 0.1, 0.035, white, 20, 12); u.position.set(0.17, -0.035, 0); up.add(u);
      const cover = ellipsoid(0.16, 0.06, 0.03, cream, 16, 10); cover.position.set(0.16, 0.02, s * 0.012); up.add(cover);
      const f = ellipsoid(0.2, 0.075, 0.03, white, 20, 12); f.position.set(0.18, -0.02, 0); fore.add(f);
      for (let i = 0; i < 5; i++) {
        const p = ellipsoid(0.16 - i * 0.012, 0.025, 0.012, black, 12, 6);
        p.position.set(0.24 + i * 0.02, -0.04 - i * 0.014, s * (0.005 + i * 0.004)); p.rotation.z = -0.35 - i * 0.18; fore.add(p);
      }
      for (let i = 0; i < 6; i++) {
        const p = ellipsoid(0.12, 0.02, 0.011, black, 10, 6);
        p.position.set(0.04 + i * 0.05, -0.085, s * 0.004); p.rotation.z = -1.25 + i * 0.07; fore.add(p);
      }
      this.wing.push({ up, fore, s, l1: 0.34, l2: 0.37, elbow: new THREE.Vector3() });
    }

    // legs
    this.legs = [];
    for (const s of [1, -1]) {
      const thigh = new THREE.Group(), shin = new THREE.Group(), foot = new THREE.Group(); this.root.add(thigh, shin, foot);
      const th = ellipsoid(0.22, 0.075, 0.075, white, 16, 10); th.position.x = 0.17; thigh.add(th);
      const sh = new THREE.Mesh(seg(V(0, 0, 0), V(0.43, 0, 0), 0.03, 0.022, 10), leg); shin.add(sh);
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), leg); shin.add(knee);
      // webbed foot: toes fanned forward, membrane between them
      const toeTips = [V(0.15, -0.01, -0.06), V(0.17, -0.01, 0), V(0.15, -0.01, 0.06)];
      for (const tp of toeTips) foot.add(new THREE.Mesh(seg(V(0, 0, 0), tp, 0.012, 0.007, 6), leg));
      const web = new THREE.BufferGeometry();
      web.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, ...toeTips[0].toArray(), ...toeTips[1].toArray(), 0, 0, 0, ...toeTips[1].toArray(), ...toeTips[2].toArray()], 3));
      web.computeVertexNormals();
      foot.add(new THREE.Mesh(web, new THREE.MeshStandardMaterial({ color: '#ef8f35', roughness: 0.6, side: THREE.DoubleSide })));
      this.legs.push({ thigh, shin, foot, s, l1: 0.42, l2: 0.43, knee: new THREE.Vector3() });
    }

    // scarf: knot ring + simulated ribbon tail in world space
    this.knot = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.025, 10, 24), scarfMat); this.root.add(this.knot);
    this.scarfN = 14;
    this.scarfP = Array.from({ length: this.scarfN }, () => new THREE.Vector3());
    this.scarfO = Array.from({ length: this.scarfN }, () => new THREE.Vector3());
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.scarfN * 2 * 3), 3));
    const sidx = []; for (let i = 0; i < this.scarfN - 1; i++) { const a = i * 2; sidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    sgeo.setIndex(sidx);
    const stripe = canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#e23b4e'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; for (let y = 0; y < h; y += 64) g.fillRect(0, y + 40, w, 12); g.fillStyle = '#ffd166'; g.fillRect(0, h - 18, w, 18); });
    const uv = new Float32Array(this.scarfN * 4); for (let i = 0; i < this.scarfN; i++) { uv.set([0, i / (this.scarfN - 1), 1, i / (this.scarfN - 1)], i * 4); }
    sgeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.scarf = new THREE.Mesh(sgeo, new THREE.MeshPhysicalMaterial({ map: stripe, roughness: 0.75, sheen: 1, sheenColor: new THREE.Color('#ffb0b8'), side: THREE.DoubleSide }));
    this.scarf.frustumCulled = false; this.scarf.castShadow = true;
    this.scarfInit = false;
  }

  // Transform a point from object space up to rider-root space.
  toRoot(obj, v, out = new THREE.Vector3()) {
    out.copy(v);
    for (let o = obj; o && o !== this.root; o = o.parent) { o.updateMatrix(); out.applyMatrix4(o.matrix); }
    return out;
  }

  update(dt, s) {
    const t = s.time;
    // wheels and crank
    const omega = s.speed / 0.367;
    this.wheelAngle -= omega * dt;
    this.rearWheel.rotation.z = this.wheelAngle; this.frontWheel.rotation.z = this.wheelAngle;
    for (const w of [this.rearWheel, this.frontWheel]) {
      const b = clamp((omega - 6) / 18, 0, 1);
      w.userData.spMat.opacity = 1 - b * 0.85; w.userData.blurMat.opacity = b * 0.55;
    }
    this.crank += s.cadence * dt;
    this.crankG.rotation.z = -this.crank;
    this.pedals[0].rotation.z = this.crank;
    this.pedals[1].rotation.z = this.crank - Math.PI;
    this.cog.rotation.z = this.wheelAngle;
    // chain
    const C = this.chain, M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), Z = new THREE.Vector3(0, 0, 1);
    const off = -this.crank * C.r1;
    for (let i = 0; i < this.chainLinks.count; i++) {
      const d = ((i * this.chainSpacing + off) % C.len + C.len) % C.len;
      let k = 1; while (k < C.cum.length - 1 && C.cum[k] < d) k++;
      const a = C.pts[k - 1], b = C.pts[k], f = (d - C.cum[k - 1]) / (C.cum[k] - C.cum[k - 1] || 1);
      P.set(lerp(a.x, b.x, f), lerp(a.y, b.y, f), 0.075);
      Q.setFromAxisAngle(Z, Math.atan2(b.y - a.y, b.x - a.x));
      M.compose(P, Q, S); this.chainLinks.setMatrixAt(i, M);
    }
    this.chainLinks.instanceMatrix.needsUpdate = true;

    // steering and bell
    this.steer.rotation.y = s.steer;
    this.ringT = Math.max(0, this.ringT - dt);
    this.bell.rotation.x = Math.sin(this.ringT * 60) * 0.35 * this.ringT;

    // torso bob with pedalling, lean forward with effort
    const pump = Math.sin(this.crank * 2);
    this.torso.position.set(-0.11 + s.effort * 0.03, 1.22 + pump * 0.006 * (0.3 + s.effort), 0);
    this.torso.rotation.set(s.lean * 0.25 + Math.sin(this.crank) * 0.03 * s.effort, 0, -0.05 - s.effort * 0.08 + pump * 0.01);
    this.tail.rotation.y = Math.sin(t * 2.3) * 0.08; this.tail.rotation.z = Math.sin(t * 1.7) * 0.05;
    const tp = (v) => this.toRoot(this.torso, v);

    // legs follow pedals
    const pedalPos = [
      V(this.BB.x + -0.17 * Math.sin(this.crank), this.BB.y - 0.17 * Math.cos(this.crank), 0.17),
      V(this.BB.x + 0.17 * Math.sin(this.crank), this.BB.y + 0.17 * Math.cos(this.crank), -0.17),
    ];
    this.legs.forEach((L, i) => {
      const hip = tp(this.hipL[i]);
      const ankle = pedalPos[i].clone().add(V(-0.035, 0.05, 0));
      ik(hip, ankle, L.l1, L.l2, V(1, 0.2, L.s * 0.25), L.knee);
      aim(L.thigh, hip, L.knee, V(0, 1, 0));
      aim(L.shin, L.knee, ankle, V(0, 1, 0));
      L.foot.position.copy(ankle); L.foot.rotation.set(0, 0, -0.35);
    });

    // wings hold the grips; one can wave
    this.pivot.updateMatrix(); this.steer.updateMatrix();
    this.wave = damp(this.wave || 0, s.wave ? 1 : 0, 6, dt);
    this.wing.forEach((Wg, i) => {
      const sh = tp(this.shoulderL[i]);
      let grip = this.toRoot(this.steer, this.gripsL[i]);
      let pole = V(-0.35, -0.6, Wg.s * 1.0);
      if (i === 0 && this.wave > 0.01) {
        const wv = V(0.1 + Math.sin(t * 9) * 0.05, 1.65 + Math.sin(t * 9) * 0.06, 0.55 + Math.cos(t * 9) * 0.06);
        grip.lerp(wv, this.wave); pole.lerp(V(-0.2, -1, 0.4), this.wave);
      }
      if (s.flap > 0) {
        const fl = V(-0.05, sh.y + Math.sin(t * 16) * 0.35, Wg.s * 0.75);
        grip.lerp(fl, s.flap); pole.lerp(V(0, 1, 0), s.flap * 0.5);
      }
      ik(sh, grip, Wg.l1, Wg.l2, pole, Wg.elbow);
      aim(Wg.up, sh, Wg.elbow, V(0.3, 1, 0));
      aim(Wg.fore, Wg.elbow, grip, V(-0.3, 1, 0));
    });

    // head and neck
    const base = tp(this.neckBaseL);
    const look = s.look; // root-space yaw/pitch targets
    this.head.yaw = damp(this.head.yaw, look.yaw, 4, dt);
    this.head.pitch = damp(this.head.pitch, look.pitch, 4, dt);
    const bob = Math.sin(this.crank * 2) * 0.008 + Math.sin(t * 1.3) * 0.006;
    const hp = V(0.2 + s.effort * 0.07 + Math.cos(this.head.yaw) * 0.02 - 0.02, 1.77 - s.effort * 0.05 + bob + this.head.pitch * 0.04, -Math.sin(this.head.yaw) * 0.09 + s.lean * 0.12);
    this.headG.position.copy(hp);
    this.headG.rotation.set(-s.lean * 0.5, this.head.yaw, -0.08 + this.head.pitch + (this.gulpT > 0 ? Math.sin(this.gulpT * 14) * 0.08 : 0), 'YXZ');
    const toHead = V(-0.09, -0.02, 0).applyEuler(this.headG.rotation).add(hp);
    this.neckPts[0].copy(base); this.neckPts[1].copy(base).add(V(-0.07, 0.17, 0)); this.neckPts[2].copy(toHead).add(V(-0.06, -0.06, 0)); this.neckPts[3].copy(toHead);
    updateTube(this.neckGeo, this.neckPts, 14, this.neckR, 28);
    this.crest.rotation.z = Math.sin(t * 7) * 0.08 * (0.3 + s.speed * 0.05);

    // jaw: talks / gulps / opens in the wind
    this.gulpT = Math.max(0, this.gulpT - dt);
    const jawOpen = Math.max(s.jaw, this.gulpT > 0 ? Math.sin((1 - this.gulpT) * Math.PI) * 0.35 : 0);
    this.jaw.rotation.z = -0.38 - jawOpen;
    this.pouch.scale.y = 1 + Math.sin(t * 5) * 0.03 + jawOpen * 0.6 + (this.gulpT > 0 ? Math.sin(this.gulpT * 10) * 0.12 : 0);

    // blink
    this.nextBlink -= dt;
    if (this.nextBlink < 0) { this.blink = 0.16; this.nextBlink = 2 + Math.random() * 4; }
    this.blink = Math.max(0, this.blink - dt);
    const closed = this.blink > 0 ? Math.sin((this.blink / 0.16) * Math.PI) : 0;
    for (const e of this.eyes) { e.lid.visible = closed > 0.02; e.lid.scale.y = Math.max(closed, 0.05); }

    // scarf knot sits on the neck
    const curve = new THREE.CatmullRomCurve3(this.neckPts);
    const kp = curve.getPointAt(0.28), kt = curve.getTangentAt(0.28);
    this.knot.position.copy(kp); this.knot.quaternion.setFromUnitVectors(V(0, 0, 1), kt);
    this.knotLocal = kp.clone().add(V(-0.06, -0.01, 0));
  }

  // Ribbon physics, in world space. Call after the root matrix is updated.
  updateScarf(dt, worldVel, wind, time) {
    const anchor = this.knotLocal.clone().applyMatrix4(this.root.matrixWorld);
    const P = this.scarfP, O = this.scarfO, n = this.scarfN, segL = 0.055;
    if (!this.scarfInit) {
      const back = new THREE.Vector3(-1, 0, 0).transformDirection(this.root.matrixWorld);
      for (let i = 0; i < n; i++) { P[i].copy(anchor).addScaledVector(back, i * segL); O[i].copy(P[i]); }
      this.scarfInit = true;
    }
    const h = Math.min(dt, 1 / 30);
    const air = wind.clone().sub(worldVel), al = air.length();
    const side = new THREE.Vector3(0, 0, 1).transformDirection(this.root.matrixWorld);
    for (let i = 1; i < n; i++) {
      const p = P[i], o = O[i];
      const vx = (p.x - o.x) * 0.97, vy = (p.y - o.y) * 0.97, vz = (p.z - o.z) * 0.97;
      o.copy(p);
      const k = i / n, fl = (Math.sin(time * 17 + i * 0.9) * 0.6 + Math.sin(time * 29 + i * 1.7) * 0.35) * (2 + al * 1.6) * k;
      const ax = air.x * al * 0.35 + side.x * fl, ay = air.y * al * 0.35 - 9.8 + fl * 0.6, az = air.z * al * 0.35 + side.z * fl;
      p.x += vx + ax * h * h; p.y += vy + ay * h * h; p.z += vz + az * h * h;
    }
    P[0].copy(anchor);
    for (let it = 0; it < 4; it++) for (let i = 1; i < n; i++) {
      const a = P[i - 1], b = P[i], d = b.clone().sub(a), l = d.length() || 1;
      b.copy(a).addScaledVector(d, segL / l);
    }
    const pos = this.scarf.geometry.attributes.position; side.set(0, 0, 0);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(this.root.matrixWorld);
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, n - 1)];
      side.subVectors(b, a).cross(up).normalize().multiplyScalar(0.045 * (1 - i / n * 0.3));
      side.applyAxisAngle(new THREE.Vector3().subVectors(b, a).normalize(), Math.sin(time * 9 + i * 0.6) * 0.5);
      pos.setXYZ(i * 2, P[i].x - side.x, P[i].y - side.y, P[i].z - side.z);
      pos.setXYZ(i * 2 + 1, P[i].x + side.x, P[i].y + side.y, P[i].z + side.z);
    }
    pos.needsUpdate = true; this.scarf.geometry.computeVertexNormals();
  }

  ring() { this.ringT = 0.6; }
  gulp() { this.gulpT = 1; }
}

export function makeFish(scale = 1, gold = false) {
  const g = new THREE.Group();
  const body = new THREE.SphereGeometry(1, 20, 12); const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setXYZ(i, x * 0.11, p.getY(i) * 0.04 * (1 - 0.5 * Math.max(-x, 0)), p.getZ(i) * 0.018); }
  body.computeVertexNormals();
  const top = gold ? '#c98a12' : '#2f5f80', belly = gold ? '#fff2a8' : '#e4f2f8';
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: gold ? 1 : 0.7, roughness: gold ? 0.18 : 0.28, iridescence: gold ? 0.3 : 1, iridescenceIOR: 1.6, clearcoat: 1,
    emissive: gold ? '#ffb200' : '#000000', emissiveIntensity: gold ? 0.35 : 0 });
  g.add(new THREE.Mesh(paintGradient(body, belly, top, -0.03, 0.04), mat));
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([-0.1, 0, 0, -0.16, 0.05, 0, -0.16, -0.05, 0], 3)); tail.computeVertexNormals();
  g.add(new THREE.Mesh(tail, new THREE.MeshStandardMaterial({ color: gold ? '#f0b52a' : '#4f86a8', metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide })));
  const fin = new THREE.BufferGeometry();
  fin.setAttribute('position', new THREE.Float32BufferAttribute([0.03, 0.035, 0, -0.04, 0.03, 0, -0.02, 0.065, 0], 3)); fin.computeVertexNormals();
  g.add(new THREE.Mesh(fin, g.children[1].material));
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#111111' });
  for (const z of [0.0125, -0.0125]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), eyeMat); e.position.set(0.075, 0.008, z); g.add(e); }
  g.scale.setScalar(scale);
  g.userData.tail = g.children[1];
  return g;
}
