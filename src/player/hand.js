// The wizard's hand: rigged first-person hand with spring-driven poses, arcane glow and a
// wrist that dissolves into embers (only the hand is ever drawn).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { G, LAYER_SCENE } from '../core/globals.js';
import { Spring, Spring3, damp, rr, rand, clamp } from '../core/util.js';
import { K_DOT } from '../fx/particles.js';
import { GLSL_MAGIC_CIRCLE } from '../render/glsl.js';

const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const X = new THREE.Vector3(1, 0, 0), Yv = new THREE.Vector3(0, 1, 0), Zv = new THREE.Vector3(0, 0, 1);

// pos: camera space (x right, y up, z back). rot: [pitch, yaw, roll] added on top of the base "handshake" orientation.
// curl: thumb..pinky 0..1, spread 0..1
export const POSES = {
  idle: { pos: [0.27, -0.25, -0.47], rot: [0.62, 0.3, 0.9], curl: [0.2, 0.22, 0.3, 0.38, 0.46], spread: 0.25 },
  cup: { pos: [0.19, -0.25, -0.48], rot: [0.2, 0.25, -1.55], curl: [0.2, 0.42, 0.46, 0.5, 0.55], spread: 0.45 },
  throw: { pos: [0.1, -0.1, -0.72], rot: [1.3, 0.1, 1.45], curl: [0.0, 0.0, 0.0, 0.04, 0.08], spread: 1.0 },
  claw: { pos: [0.18, -0.15, -0.6], rot: [1.05, 0.2, 1.35], curl: [0.25, 0.5, 0.52, 0.56, 0.6], spread: 1.0 },
  fist: { pos: [0.22, -0.16, -0.5], rot: [0.95, 0.3, 1.05], curl: [0.85, 1, 1, 1, 1], spread: 0 },
  point: { pos: [0.2, -0.05, -0.5], rot: [1.45, 0.15, 1.2], curl: [0.7, 0.0, 0.05, 0.95, 1.0], spread: 0.2 },
  slam: { pos: [0.16, -0.3, -0.58], rot: [0.0, 0.2, 1.4], curl: [0.6, 0.0, 0.05, 0.9, 1.0], spread: 0.1 },
  grip: { pos: [0.22, -0.15, -0.56], rot: [0.75, 0.3, -1.45], curl: [0.3, 0.55, 0.58, 0.62, 0.66], spread: 0.7 },
  palm: { pos: [0.14, -0.12, -0.64], rot: [1.35, 0.12, 1.5], curl: [0.05, 0.02, 0.0, 0.04, 0.1], spread: 0.6 },
  ray: { pos: [0.27, -0.21, -0.58], rot: [1.35, 0.12, 1.5], curl: [0.05, 0.02, 0.0, 0.04, 0.1], spread: 0.6 },   // palm low and wide so the beam crosses the view
  raise: { pos: [0.2, 0.05, -0.5], rot: [1.5, 0.2, 1.35], curl: [0.05, 0.1, 0.1, 0.14, 0.2], spread: 0.9 },
  crush: { pos: [0.18, 0.02, -0.5], rot: [1.3, 0.25, 1.15], curl: [0.9, 1, 1, 1, 1], spread: 0 },
};

export class Hand {
  constructor() {
    this.pos = new Spring3(0.27, -0.5, -0.4, 6.5, 0.72);
    this.rot = new Spring3(0.62, 0.3, 0.9, 6.5, 0.72);
    this.curl = FINGERS.map(() => new Spring(0.3, 9, 0.8));
    this.spread = new Spring(0.2, 8, 0.85);
    this.sway = new THREE.Vector2(); this.tremble = 0; this.trembleTarget = 0;
    this.glowColor = new THREE.Color(1, 0.5, 0.15); this.glowTarget = new THREE.Color(1, 0.5, 0.15);
    this.power = 0.15; this.powerTarget = 0.15;
    this.pose = 'idle';
    this.root = new THREE.Group(); this.root.name = 'hand';
    this._lastYaw = 0; this._lastPitch = 0;
    this.tips = []; this.tipWorld = FINGERS.map(() => new THREE.Vector3());
    this.palm = new THREE.Vector3(); this.palmNormal = new THREE.Vector3(); this.fingerDir = new THREE.Vector3();
  }

  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    let mesh = null; const bones = {};
    model.traverse((o) => { if (o.isSkinnedMesh) mesh = o; if (o.isBone || (o.name && /(wrist|finger|thumb)/.test(o.name))) bones[o.name] = o; });
    this.mesh = mesh; this.bones = bones;
    model.updateMatrixWorld(true);
    // build a proper hierarchy (the WebXR model keeps every joint flat in model space)
    const wrist = bones['wrist'];
    const chain = (f) => (f === 'thumb' ? ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']
      : [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`]);
    this.chains = FINGERS.map((f) => {
      const names = chain(f); let parent = wrist;
      const js = names.map((n) => { const b = bones[n]; parent.attach(b); parent = b; return b; });
      return js;
    });
    model.updateMatrixWorld(true);
    this.rest = new Map();
    for (const b of Object.values(bones)) this.rest.set(b, b.quaternion.clone());
    this.tips = this.chains.map((c) => c[c.length - 1]);

    // material: skin with arcane veins + dissolving wrist
    const U = this.uniforms = { uGlowCol: { value: new THREE.Color(1, 0.5, 0.15) }, uPower: { value: 0.2 }, tNoiseH: { value: G.noiseTex }, uTimeH: G.fxU.uTime };
    const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(0.7, 0.5, 0.41, THREE.SRGBColorSpace), roughness: 0.46, metalness: 0, sheen: 0.25, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.5, 0.12, 0.08), envMapIntensity: 0.9 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying vec3 vObjN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vObjN = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying vec3 vObjN; uniform vec3 uGlowCol; uniform float uPower, uTimeH; uniform sampler2D tNoiseH;\n' + GLSL_MAGIC_CIRCLE + '\nfloat fingerLine(vec3 p, float y0, float z0, float m){ float d = abs(p.z - (z0 + m * (p.y - y0))); return smoothstep(0.0017, 0.0004, d) * step(p.y, y0 + 0.012); }')
        .replace('#include <map_fragment>', `
          // wrist dissolve (model +Y is towards the forearm)
          float wn = texture2D(tNoiseH, vObj.xz * 9.0 + vec2(0.0, uTimeH * 0.05)).r;
          float cut = vObj.y - 0.052 + (wn - 0.5) * 0.035;
          if (cut > 0.0) discard;
          float edgeGlow = smoothstep(-0.018, 0.0, cut);
          // skin tone variation: redder knuckles / fingertips, paler palm
          float back = smoothstep(-0.2, 0.6, vObjN.x);
          float n1 = texture2D(tNoiseH, vObj.yz * 14.0).g;
          vec3 skin = diffuseColor.rgb * mix(vec3(1.06, 0.93, 0.88), vec3(0.96, 1.0, 1.0), back);
          skin *= 0.92 + 0.16 * n1;
          skin = mix(skin, skin * vec3(1.12, 0.8, 0.76), smoothstep(-0.085, -0.125, vObj.y) * 0.55);
          diffuseColor.rgb = skin;
          // arcane markings: a sigil on the back of the hand and a filament running up each finger
          vec2 sp = (vObj.zy - vec2(0.009, 0.014)) / 0.031;
          float sigil = magicCircle(sp, uTimeH * 0.5) * step(length(sp), 1.05);
          float fl = fingerLine(vObj, -0.033, -0.0144, -0.05) + fingerLine(vObj, -0.036, 0.0074, -0.106) + fingerLine(vObj, -0.029, 0.0266, -0.229) + fingerLine(vObj, -0.018, 0.0442, -0.264);
          float pulse = 0.7 + 0.3 * sin(uTimeH * 2.6 + vObj.y * 60.0);
          float veins = (sigil * 0.8 + fl * pulse) * back;
          diffuseColor.rgb *= 1.0 - veins * 0.5;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.5);
          totalEmissiveRadiance += uGlowCol * (veins * (1.1 + uPower * 7.0) + fres * uPower * 0.55 + edgeGlow * (2.5 + uPower * 5.0));
          totalEmissiveRadiance += vec3(0.5, 0.12, 0.06) * fres * 0.25; // faint subsurface rim`);
    };
    mesh.material = mat; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.layers.set(LAYER_SCENE);
    // pivot at the wrist, then the base "handshake" orientation (fingers forward, thumb up, palm facing left)
    const wp = new THREE.Vector3(); wrist.getWorldPosition(wp);
    this.pivot = new THREE.Group();
    model.position.copy(wp).multiplyScalar(-1);
    this.pivot.add(model);
    this.pivot.quaternion.setFromAxisAngle(X, Math.PI / 2);
    this.root.add(this.pivot);
    this.root.scale.setScalar(1.3);
    G.camera.add(this.root);
    if (!G.camera.parent) G.scene.add(G.camera);
    this.setPose('idle', true);
    return this;
  }

  setPose(name, snap = false) {
    const p = POSES[name]; if (!p) return;
    this.pose = name;
    this.pos.target.set(...p.pos); this.rot.target.set(...p.rot);
    p.curl.forEach((c, i) => (this.curl[i].target = c));
    this.spread.target = p.spread;
    if (snap) { this.pos.x.copy(this.pos.target); this.rot.x.copy(this.rot.target); this.curl.forEach((c) => (c.x = c.target)); this.spread.x = p.spread; }
  }
  setSpeed(f, z = 0.72) { this.pos.freq = f; this.rot.freq = f; this.pos.zeta = z; this.rot.zeta = z; }
  kick(px, py, pz, rx = 0, ry = 0, rz = 0) { this.pos.v.x += px; this.pos.v.y += py; this.pos.v.z += pz; this.rot.v.x += rx; this.rot.v.y += ry; this.rot.v.z += rz; }
  setGlow(color, power) { if (color) this.glowTarget.copy(color); this.powerTarget = power; }

  _applyFingers() {
    const sp = this.spread.x;
    for (let f = 0; f < 5; f++) {
      const c = clamp(this.curl[f].x, -0.2, 1.15), js = this.chains[f];
      if (f === 0) {
        // thumb: swing across the palm then flex
        const a = [0.55, 0.5, 0.75];
        for (let k = 0; k < 3; k++) {
          _q.setFromAxisAngle(X, -c * a[k]);
          if (k === 0) _q.premultiply(new THREE.Quaternion().setFromAxisAngle(Yv, c * 0.5 - sp * 0.3)).premultiply(new THREE.Quaternion().setFromAxisAngle(Zv, c * 0.35));
          js[k].quaternion.copy(this.rest.get(js[k])).multiply(_q);
        }
      } else {
        const a = [1.35, 1.6, 1.05];
        const side = (f - 2.4) * 0.16 * (sp - 0.25); // fan out around the middle finger
        for (let k = 0; k < 3; k++) {
          _q.setFromAxisAngle(X, -c * a[k]);
          if (k === 0) _q.premultiply(new THREE.Quaternion().setFromAxisAngle(Yv, -side));
          js[k + 1].quaternion.copy(this.rest.get(js[k + 1])).multiply(_q);
        }
      }
    }
  }

  update(dt, realDt) {
    if (!this.mesh) return;
    const pl = G.player, T = G.realTime;
    // look lag (the hand trails the camera a little) + movement bob + breathing
    const dyaw = pl.yaw - this._lastYaw, dpitch = pl.pitch - this._lastPitch;
    this._lastYaw = pl.yaw; this._lastPitch = pl.pitch;
    this.sway.x = damp(this.sway.x, clamp(dyaw / Math.max(realDt, 1e-3) * 0.012, -0.08, 0.08), 7, realDt);
    this.sway.y = damp(this.sway.y, clamp(-dpitch / Math.max(realDt, 1e-3) * 0.012, -0.08, 0.08), 7, realDt);
    this.pos.update(realDt); this.rot.update(realDt); this.spread.update(realDt);
    for (const c of this.curl) c.update(realDt);
    this.tremble = damp(this.tremble, this.trembleTarget, 8, realDt);
    const tr = this.tremble;
    const bob = pl.bobAmp;
    const px = this.pos.x.x + this.sway.x + Math.cos(pl.bobT) * 0.012 * bob + Math.sin(T * 47) * 0.004 * tr;
    const py = this.pos.x.y + this.sway.y + Math.sin(pl.bobT * 2) * 0.014 * bob + Math.sin(T * 1.3) * 0.006 + Math.sin(T * 53 + 1) * 0.004 * tr;
    const pz = this.pos.x.z + Math.sin(T * 41 + 2) * 0.003 * tr;
    this.root.position.set(px, py, pz);
    _e.set(this.rot.x.x + Math.sin(T * 1.1) * 0.02 + this.sway.y * 1.5 + Math.sin(T * 44) * 0.02 * tr, this.rot.x.y - this.sway.x * 2.0, this.rot.x.z + Math.sin(T * 0.8 + 1) * 0.025 + Math.sin(T * 39) * 0.03 * tr, 'YXZ');
    this.root.quaternion.setFromEuler(_e);
    // finger micro-motion
    for (let i = 0; i < 5; i++) this.curl[i].x += Math.sin(T * (1.7 + i * 0.31) + i) * 0.0009 + (rand() - 0.5) * 0.02 * tr * realDt * 60 * 0.3;
    this._applyFingers();
    // glow
    this.power = damp(this.power, this.powerTarget, 6, realDt);
    this.glowColor.lerp(this.glowTarget, 1 - Math.exp(-6 * realDt));
    this.uniforms.uPower.value = this.power; this.uniforms.uGlowCol.value.copy(this.glowColor);
    // world-space anchors for spells
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < 5; i++) this.tips[i].getWorldPosition(this.tipWorld[i]);
    const wrist = this.bones['wrist'], mid = this.chains[2][1];
    wrist.getWorldPosition(_v); mid.getWorldPosition(_v2);
    this.fingerDir.subVectors(_v2, _v).normalize();
    this.palm.addVectors(_v, _v2).multiplyScalar(0.5);
    // palm normal = model -X
    this.palmNormal.set(-1, 0, 0).transformDirection(this.mesh.matrixWorld);
    this.palm.addScaledVector(this.palmNormal, 0.03);
    // embers streaming off the dissolving wrist
    if (G.particles && dt > 0 && rand() < 0.55) {
      _v.addScaledVector(this.fingerDir, -0.03);
      const c = this.glowColor, k = 2.5 + this.power * 5;
      G.particles.spawn(_v.x + rr(-0.03, 0.03), _v.y + rr(-0.03, 0.03), _v.z + rr(-0.03, 0.03), rr(-0.08, 0.08) - this.fingerDir.x * 0.25, rr(0.02, 0.2), rr(-0.08, 0.08) - this.fingerDir.z * 0.25, rr(0.4, 0.9), rr(0.006, 0.014), 0.002, c.r * k, c.g * k, c.b * k, 1, c.r * k, c.g * k * 0.5, c.b * k * 0.3, 0, 1.5, -0.05, K_DOT, 0.25, 1, 0, 0.03, 0.1);
    }
  }
}
