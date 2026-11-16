// FX manager: dynamic light pool, volumetric fireballs, shockwaves, lightning, beams, rune circles,
// emitters, and the composite "explosion" used by most spells.
import * as THREE from 'three';
import { G, LAYER_FX, LAYER_DISTORT } from '../core/globals.js';
import { rand, rr, randUnit, clamp, sat, easeOutCubic, lerp } from '../core/util.js';
import { FX_DEPTH_GLSL } from '../render/post.js';
import { GLSL_NOISE3, GLSL_MAGIC_CIRCLE } from '../render/glsl.js';
import { ParticleSystem, K_PUFF, K_STREAK, K_DOT, K_RING } from './particles.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const fxMat = (o) => new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, ...o });
const PREMULT = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };
const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor };

// ---------------------------------------------------------------- fireball (volumetric-looking explosion core)
const FIREBALL_VS = /* glsl */ `
${GLSL_NOISE3}
uniform float uAge, uSeed, uDisp, uFreq;
varying vec3 vObj; varying vec3 vN; varying vec3 vV; varying float vNoise;
void main(){
  vec3 q = position * 1.6 * uFreq + vec3(uSeed, uSeed * 1.7 - uAge * 1.2, uSeed * 0.3);
  float n = fbm3(q);
  vNoise = n;
  vec3 p = position * (1.0 + (n - 0.45) * uDisp);
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FIREBALL_FS = /* glsl */ `
precision highp float;
${FX_DEPTH_GLSL}
${GLSL_NOISE3}
uniform float uAge, uSeed, uHeat, uFreq; uniform vec3 uTint;
varying vec3 vObj; varying vec3 vN; varying vec3 vV; varying float vNoise;
vec3 ramp(float t){
  vec3 c = mix(vec3(0.02, 0.01, 0.008), vec3(0.9, 0.08, 0.01), smoothstep(0.0, 0.35, t));
  c = mix(c, vec3(2.4, 0.55, 0.05), smoothstep(0.3, 0.62, t));
  c = mix(c, vec3(4.6, 2.0, 0.4), smoothstep(0.62, 1.0, t));
  return c;
}
void main(){
  float n = fbm3(vObj * 3.3 * uFreq + vec3(uSeed, -uAge * 2.2 + uSeed, 0.0)) * 0.6 + vNoise * 0.4;
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float temp = n * 1.35 + (0.78 - uAge * 1.75) * uHeat - (1.0 - facing) * 0.25;
  float er = uAge * 1.25 - 0.3;
  float alpha = smoothstep(er, er + 0.28, n * 0.8 + facing * 0.25) * smoothstep(0.0, 0.3, facing + n * 0.35);
  alpha *= softFade(0.8) * (1.0 - smoothstep(0.82, 1.0, uAge));
  float emis = smoothstep(0.12, 0.45, temp);
  vec3 fire = ramp(clamp(temp, 0.0, 1.0)) * uTint;
  vec3 smoke = vec3(0.045, 0.04, 0.036) * (0.6 + n);
  vec3 col = mix(smoke, fire, emis);
  gl_FragColor = vec4(col * alpha, alpha * (1.0 - emis * 0.9));
}`;

// ---------------------------------------------------------------- shock shell (visible + distortion)
const SHELL_VS = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const SHELL_FS = /* glsl */ `
precision highp float;
${FX_DEPTH_GLSL}
uniform float uAlpha, uPower; uniform vec3 uColor;
varying vec3 vN; varying vec3 vV;
void main(){
  vec3 N = normalize(vN);
  float f = pow(1.0 - abs(dot(N, normalize(vV))), uPower);
  float s = softFade(1.2);
  #ifdef DISTORT
    gl_FragColor = vec4(N.xy * f * uAlpha * s * 0.07, 0.0, 1.0);
  #else
    gl_FragColor = vec4(uColor * f * uAlpha * s, 1.0);
  #endif
}`;
// ground ring
const RING_FS = /* glsl */ `
precision highp float;
${FX_DEPTH_GLSL}
uniform float uAlpha, uWidth; uniform vec3 uColor; uniform sampler2D tNoise;
varying vec2 vUv;
void main(){
  vec2 d = vUv - 0.5; float r = length(d) * 2.0;
  float a = atan(d.y, d.x);
  float n = texture2D(tNoise, vec2(a * 0.6, r * 0.5)).r;
  float ring = smoothstep(uWidth, 0.0, abs(r - (0.9 - uWidth))) * (0.5 + n);
  float inner = smoothstep(0.9, 0.0, r) * 0.08;
  gl_FragColor = vec4(uColor * (ring + inner) * uAlpha * softFade(0.6), 1.0);
}`;
const UV_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// ---------------------------------------------------------------- lightning ribbon
const BOLT_FS = /* glsl */ `
precision highp float;
${FX_DEPTH_GLSL}
uniform vec3 uColor; uniform float uAlpha;
varying vec2 vUv;
void main(){
  float x = abs(vUv.x - 0.5) * 2.0;
  float core = smoothstep(0.22, 0.0, x);
  float glow = pow(1.0 - x, 3.0);
  float ends = smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
  vec3 c = (vec3(1.0) * core * 14.0 + uColor * glow * 5.0) * uAlpha * ends;
  gl_FragColor = vec4(c * softFade(0.15), 1.0);
}`;

// ---------------------------------------------------------------- energy beam
// A camera-facing ribbon shaded as the chord through a cylinder, so it reads as a solid shaft of light from the
// side AND in first person (looking almost straight down its axis), where a real cylinder mesh all but vanishes.
const BEAM_VS = /* glsl */ `
uniform vec3 uA, uB; uniform float uRad, uTaper0, uTaperLen;
varying vec2 vUv; varying float vS; varying float vLen;
void main(){
  float t = pow(uv.y, 2.2);                                   // more slices near the origin, where the taper is
  vec3 ax = uB - uA; float len = max(length(ax), 1e-4); ax /= len;
  vec3 P = uA + ax * (t * len);
  vec3 side = cross(ax, cameraPosition - P); float sl = length(side);
  side = sl > 1e-6 ? side / sl : vec3(1.0, 0.0, 0.0);
  float s = t * len;
  float r = uRad * mix(uTaper0, 1.0, smoothstep(0.0, uTaperLen, s));
  vUv = vec2(position.x, t); vS = s; vLen = len;
  gl_Position = projectionMatrix * viewMatrix * vec4(P + side * (position.x * r), 1.0);
}`;
const BEAM_FS = /* glsl */ `
precision highp float;
${FX_DEPTH_GLSL}
uniform vec3 uColor; uniform float uAlpha, uTime, uFlow, uRad; uniform sampler2D tNoise;
varying vec2 vUv; varying float vS; varying float vLen;
void main(){
  float q = max(0.0, 1.0 - vUv.x * vUv.x);
  float along = vS / max(uRad, 0.05);
  float n = texture2D(tNoise, vec2(vUv.x * 0.5 + along * 0.02, along * 0.045 - uTime * uFlow)).r;
  float n2 = texture2D(tNoise, vec2(vUv.x * 0.75 - along * 0.03, along * 0.09 - uTime * uFlow * 1.7)).g;
  float core = pow(q, 2.5);
  float sheath = pow(q, 0.65) * (0.35 + n * 0.9 + n2 * 0.6);
  float ends = smoothstep(0.0, 0.25, vS) * smoothstep(vLen, vLen * 0.985 - 0.3, vS);
  vec3 c = (vec3(1.0, 0.97, 0.92) * core * 16.0 + uColor * sheath * 6.0) * uAlpha * ends;
  gl_FragColor = vec4(c * softFade(0.5), 1.0);
}`;

// ---------------------------------------------------------------- rune circle quad
const RUNE_FS = /* glsl */ `
precision highp float;
${FX_DEPTH_GLSL}
${GLSL_MAGIC_CIRCLE}
uniform vec3 uColor; uniform float uAlpha, uTime, uSpin, uReveal;
varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * 2.12;
  float r = length(p);
  float v = magicCircle(p, uTime * uSpin);
  float reveal = smoothstep(uReveal, uReveal - 0.15, r); // draws outward from the centre
  float glow = exp(-r * r * 3.0) * 0.08;
  vec3 c = uColor * (v * 3.0 + glow) * uAlpha * reveal;
  c += vec3(1.0) * v * v * 0.6 * uAlpha * reveal;
  gl_FragColor = vec4(c * softFade(0.25), 1.0);
}`;

export class FX {
  constructor() {
    const P = G.particles = new ParticleSystem(G.quality === 'low' ? 16000 : 48000, false);
    this.P = P;
    this.D = new ParticleSystem(1500, true);
    this.density = G.quality === 'low' ? 0.45 : G.quality === 'medium' ? 0.7 : 1;
    // ---- lights
    this.lights = [];
    for (let i = 0; i < 8; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 30, 2);
      L.layers.enableAll(); L.userData = { life: 0, age: 0, base: 0, radius: 30, flicker: 0, follow: null, hold: false };
      G.scene.add(L); this.lights.push(L);
    }
    // ---- fireballs
    this.fireballs = [];
    const fbGeo = new THREE.IcosahedronGeometry(1, 5);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(fbGeo, fxMat({ vertexShader: FIREBALL_VS, fragmentShader: FIREBALL_FS, ...PREMULT, uniforms: { ...G.fxU, uAge: { value: 0 }, uSeed: { value: 0 }, uDisp: { value: 0.5 }, uHeat: { value: 1 }, uFreq: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) } } }));
      m.visible = false; m.layers.set(LAYER_FX); m.frustumCulled = false; m.renderOrder = 5;
      m.userData = { age: 0, life: 0, radius: 1, rise: 0 };
      G.scene.add(m); this.fireballs.push(m);
    }
    this.orbs = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(fbGeo, fxMat({ vertexShader: FIREBALL_VS, fragmentShader: FIREBALL_FS, ...PREMULT, uniforms: { ...G.fxU, uAge: { value: 0.12 }, uSeed: { value: i * 7.1 }, uDisp: { value: 0.55 }, uHeat: { value: 1.25 }, uFreq: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) } } }));
      m.visible = false; m.layers.set(LAYER_FX); m.frustumCulled = false; m.renderOrder = 6; m.userData.used = false;
      G.scene.add(m); this.orbs.push(m);
    }
    // ---- shock shells
    this.shells = [];
    const shGeo = new THREE.SphereGeometry(1, 48, 24);
    for (let i = 0; i < 8; i++) {
      const vis = new THREE.Mesh(shGeo, fxMat({ vertexShader: SHELL_VS, fragmentShader: SHELL_FS, ...ADD, uniforms: { ...G.fxU, uAlpha: { value: 0 }, uPower: { value: 3.5 }, uColor: { value: new THREE.Color(1, 0.8, 0.6) } } }));
      const dis = new THREE.Mesh(shGeo, fxMat({ vertexShader: SHELL_VS, fragmentShader: SHELL_FS, ...ADD, defines: { DISTORT: 1 }, uniforms: { ...G.fxU, uAlpha: { value: 0 }, uPower: { value: 2.2 }, uColor: { value: new THREE.Color() } } }));
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), fxMat({ vertexShader: UV_VS, fragmentShader: RING_FS, ...ADD, side: THREE.DoubleSide, uniforms: { ...G.fxU, uAlpha: { value: 0 }, uWidth: { value: 0.12 }, uColor: { value: new THREE.Color(1, 0.7, 0.4) }, tNoise: { value: G.noiseTex } } }));
      vis.layers.set(LAYER_FX); dis.layers.set(LAYER_DISTORT); ring.layers.set(LAYER_FX);
      for (const m of [vis, dis, ring]) { m.visible = false; m.frustumCulled = false; G.scene.add(m); }
      this.shells.push({ vis, dis, ring, age: 0, life: 0, radius: 1, strength: 1, active: false });
    }
    // ---- lightning bolts
    this.bolts = [];
    const MAXP = 72;
    for (let i = 0; i < 36; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const uv = new Float32Array(MAXP * 2 * 2), idx = [];
      for (let k = 0; k < MAXP; k++) { uv[k * 4] = 0; uv[k * 4 + 1] = k / (MAXP - 1); uv[k * 4 + 2] = 1; uv[k * 4 + 3] = k / (MAXP - 1); if (k < MAXP - 1) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
      const m = new THREE.Mesh(g, fxMat({ vertexShader: UV_VS, fragmentShader: BOLT_FS, ...ADD, side: THREE.DoubleSide, uniforms: { ...G.fxU, uColor: { value: new THREE.Color(0.4, 0.6, 1) }, uAlpha: { value: 1 } } }));
      m.visible = false; m.frustumCulled = false; m.layers.set(LAYER_FX); m.renderOrder = 20;
      G.scene.add(m);
      this.bolts.push({ mesh: m, pts: [], n: 0, life: 0, age: 0, width: 0.1, a: new THREE.Vector3(), b: new THREE.Vector3(), jitter: 0.2, regen: 0, flick: 0.05, active: false, MAXP });
    }
    // ---- beams
    this.beams = [];
    const bGeo = new THREE.PlaneGeometry(2, 1, 1, 32);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(bGeo, fxMat({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, ...ADD, side: THREE.DoubleSide, uniforms: { ...G.fxU, uColor: { value: new THREE.Color(1, 0.4, 0.9) }, uAlpha: { value: 0 }, uFlow: { value: 2.5 }, uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3(0, 1, 0) }, uRad: { value: 1 }, uTaper0: { value: 1 }, uTaperLen: { value: 3 }, tNoise: { value: G.noiseTex } } }));
      m.visible = false; m.frustumCulled = false; m.layers.set(LAYER_FX); m.renderOrder = 15;
      G.scene.add(m); this.beams.push(m);
    }
    // ---- rune circles
    this.runes = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fxMat({ vertexShader: UV_VS, fragmentShader: RUNE_FS, ...ADD, side: THREE.DoubleSide, uniforms: { ...G.fxU, uColor: { value: new THREE.Color(1, 0.5, 0.2) }, uAlpha: { value: 0 }, uSpin: { value: 1 }, uReveal: { value: 1.3 } } }));
      m.visible = false; m.frustumCulled = false; m.layers.set(LAYER_FX); m.renderOrder = 12;
      G.scene.add(m); this.runes.push(m);
    }
    this.emitters = [];
    this.timers = [];
    this.fracCount = 0; this.plumed = new Set();
    this._hookPhysics();
  }

  // ---------------------------------------------------------------- scheduling helpers
  after(delay, fn) { this.timers.push({ t: delay, fn }); }
  addEmitter(e) { e.age = 0; e.acc = 0; this.emitters.push(e); return e; }

  // ---------------------------------------------------------------- lights
  light(pos, color, intensity, radius, life = 0.4, opts = {}) {
    let L = this.lights[0], best = Infinity;
    for (const l of this.lights) { const u = l.userData; const score = u.life <= 0 && !u.hold ? -1 : u.hold ? 1e9 : l.intensity; if (score < best) { best = score; L = l; } }
    L.position.copy(pos); L.color.set(color); L.intensity = intensity; L.distance = radius;
    Object.assign(L.userData, { life, age: 0, base: intensity, radius, flicker: opts.flicker || 0, follow: opts.follow || null, hold: !!opts.hold, curve: opts.curve || 2 });
    return L;
  }
  releaseLight(L, fade = 0.25) { if (!L) return; const u = L.userData; u.hold = false; u.life = fade; u.age = 0; u.base = L.intensity; }
  topLights(n) { return this.lights.filter((l) => l.intensity > 1).sort((a, b) => b.intensity - a.intensity).slice(0, n); }

  // ---------------------------------------------------------------- primitives
  fireball(pos, radius, life = 1.4, tint = null, heat = 1, rise = 1.5) {
    let m = this.fireballs.find((f) => !f.visible) || this.fireballs.reduce((a, b) => (a.userData.age / a.userData.life > b.userData.age / b.userData.life ? a : b));
    m.visible = true; m.position.copy(pos);
    Object.assign(m.userData, { age: 0, life, radius, rise });
    const u = m.material.uniforms; u.uSeed.value = rand() * 50; u.uHeat.value = heat * (radius > 6 ? 0.82 : 1); u.uAge.value = 0; u.uFreq.value = clamp(radius * 0.36, 1, 4.2);
    if (tint) u.uTint.value.copy(tint); else u.uTint.value.setRGB(1, 1, 1);
    m.scale.setScalar(radius * 0.2);
    return m;
  }
  shockwave(pos, radius, life = 0.5, strength = 1, color = null, ground = true) {
    const s = this.shells.find((x) => !x.active) || this.shells[0];
    Object.assign(s, { age: 0, life, radius, strength, active: true, ground });
    for (const m of [s.vis, s.dis, s.ring]) { m.visible = true; m.position.copy(pos); }
    s.ring.visible = ground; if (ground) s.ring.position.y = G.terrain.heightAt(pos.x, pos.z) + 0.35;
    if (color) { s.vis.material.uniforms.uColor.value.copy(color); s.ring.material.uniforms.uColor.value.copy(color); }
    else { s.vis.material.uniforms.uColor.value.setRGB(1, 0.8, 0.6); s.ring.material.uniforms.uColor.value.setRGB(1, 0.7, 0.4); }
    return s;
  }

  // jagged lightning from a to b. Returns the bolt (reused if `reuse` is passed and still active).
  bolt(a, b, o = {}) {
    let B = o.reuse && o.reuse.active ? o.reuse : this.bolts.find((x) => !x.active);
    if (!B) return null;
    B.active = true; B.a.copy(a); B.b.copy(b); B.life = o.life ?? 0.18; B.age = 0; B.width = o.width ?? 0.14; B.jitter = o.jitter ?? 0.16;
    B.flick = o.flick ?? 0.045; B.regen = 0; B.alpha = o.alpha ?? 1; B.detail = o.detail ?? 5;
    B.mesh.material.uniforms.uColor.value.copy(o.color || _c.setRGB(0.45, 0.65, 1.0));
    B.mesh.visible = true;
    this._genBolt(B);
    const branches = o.branches ?? 0;
    for (let i = 0; i < branches; i++) {
      const t = rr(0.2, 0.85), k = Math.floor(t * (B.n - 1));
      const p0 = B.pts[k];
      _v.subVectors(b, a); const len = _v.length() * rr(0.15, 0.4);
      randUnit(_v2).multiplyScalar(0.9).add(_v.normalize()).normalize().multiplyScalar(len).add(p0);
      this.bolt(p0, _v2.clone(), { life: B.life * rr(0.5, 0.9), width: B.width * 0.5, jitter: B.jitter * 1.3, color: o.color, alpha: (o.alpha ?? 1) * 0.6, detail: 4, branches: 0 });
    }
    return B;
  }
  _genBolt(B) {
    let pts = [B.a.clone(), B.b.clone()];
    const len = B.a.distanceTo(B.b);
    let amp = len * B.jitter;
    for (let it = 0; it < B.detail; it++) {
      const np = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const m = pts[i].clone().add(pts[i + 1]).multiplyScalar(0.5);
        m.add(randUnit(_v3).multiplyScalar(amp * rr(0.3, 1)));
        np.push(m, pts[i + 1]);
      }
      pts = np; amp *= 0.52;
    }
    B.pts = pts; B.n = Math.min(pts.length, B.MAXP);
    this._writeBolt(B);
  }
  _writeBolt(B) {
    const pos = B.mesh.geometry.attributes.position, cam = G.camera.position, n = B.n;
    for (let i = 0; i < B.MAXP; i++) {
      const k = Math.min(i, n - 1), p = B.pts[k];
      const pa = B.pts[Math.max(k - 1, 0)], pb = B.pts[Math.min(k + 1, n - 1)];
      _v.subVectors(pb, pa).normalize(); _v2.subVectors(cam, p).normalize();
      _v3.crossVectors(_v, _v2).normalize();
      const dist = cam.distanceTo(p);
      const w = (B.width + dist * 0.0016) * (0.75 + 0.5 * Math.sin(k * 1.7 + B.age * 40)) * (i < n ? 1 : 0);
      pos.setXYZ(i * 2, p.x - _v3.x * w, p.y - _v3.y * w, p.z - _v3.z * w);
      pos.setXYZ(i * 2 + 1, p.x + _v3.x * w, p.y + _v3.y * w, p.z + _v3.z * w);
    }
    pos.needsUpdate = true;
  }

  // call every frame while the orb should exist (it hides itself otherwise)
  setOrb(i, pos, radius, tint = null, heat = 1.25) {
    const m = this.orbs[i]; m.visible = true; m.userData.used = true; m.position.copy(pos); m.scale.setScalar(radius);
    const u = m.material.uniforms; u.uSeed.value = i * 7.1 + G.time * 1.7; u.uHeat.value = heat; u.uAge.value = 0.1 + 0.05 * Math.sin(G.time * 9 + i);
    if (tint) u.uTint.value.copy(tint); else u.uTint.value.setRGB(1, 1, 1);
    m.rotation.set(G.time * 1.3, G.time * 0.9, 0);
  }
  beam(i) { return this.beams[i]; }
  // taper0 / taperLen: the shaft starts at taper0 x radius and reaches full width taperLen metres along
  setBeam(i, a, b, radius, color, alpha, flow = 2.5, taper0 = 1, taperLen = 3) {
    const m = this.beams[i];
    if (alpha <= 0.001) { m.visible = false; return; }
    m.visible = true;
    const u = m.material.uniforms; u.uA.value.copy(a); u.uB.value.copy(b); u.uRad.value = radius; u.uTaper0.value = taper0; u.uTaperLen.value = taperLen;
    u.uColor.value.copy(color); u.uAlpha.value = alpha; u.uFlow.value = flow;
  }
  rune(i) { return this.runes[i]; }
  setRune(i, pos, normal, radius, color, alpha, spin = 1, reveal = 1.3) {
    const m = this.runes[i];
    if (alpha <= 0.001) { m.visible = false; return; }
    m.visible = true; m.position.copy(pos); m.scale.setScalar(radius);
    m.quaternion.setFromUnitVectors(_v.set(0, 0, 1), _v2.copy(normal).normalize());
    const u = m.material.uniforms; u.uColor.value.copy(color); u.uAlpha.value = alpha; u.uSpin.value = spin; u.uReveal.value = reveal;
  }

  // ---------------------------------------------------------------- particle presets
  sparks(pos, n, speed, color = [14, 6, 1.2], life = 1.1, grav = 1.3, up = 0.5, size = 0.05) {
    const P = this.P; n = Math.ceil(n * this.density);
    for (let i = 0; i < n; i++) {
      randUnit(_v); _v.y = _v.y * (1 - up) + up * Math.abs(_v.y) + up * 0.4; _v.normalize().multiplyScalar(speed * rr(0.25, 1.15));
      P.spawn(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, life * rr(0.4, 1.2), size * rr(0.6, 1.4), size * 0.3, color[0], color[1], color[2], 1, color[0] * 0.35, color[1] * 0.12, color[2] * 0.05, 0.6, 0.7, grav, K_STREAK, 0, 1, 0, 0.03, 0.01);
    }
  }
  embers(pos, n, spread, color = [9, 2.6, 0.4], life = 3.5, rise = 0.25) {
    const P = this.P; n = Math.ceil(n * this.density);
    for (let i = 0; i < n; i++) {
      randUnit(_v).multiplyScalar(spread * rand());
      randUnit(_v2).multiplyScalar(rr(0.5, 3)); _v2.y = Math.abs(_v2.y) + 1;
      P.spawn(pos.x + _v.x, pos.y + Math.abs(_v.y), pos.z + _v.z, _v2.x, _v2.y, _v2.z, life * rr(0.5, 1.3), rr(0.035, 0.085), 0.02, color[0], color[1], color[2], 1, color[0] * 0.4, color[1] * 0.1, 0, 0.8, 1.1, -rise, K_DOT, 1.1, 1, 0, 0.03, 0.05);
    }
  }
  fire(pos, n, speed, size, life = 0.8, tint = [1, 1, 1]) {
    const P = this.P; n = Math.ceil(n * this.density);
    for (let i = 0; i < n; i++) {
      randUnit(_v); _v.y = Math.abs(_v.y) * 0.8 + 0.25; _v.multiplyScalar(speed * rr(0.2, 1));
      const s = size * rr(0.6, 1.3);
      P.spawn(pos.x + _v.x * 0.03, pos.y + _v.y * 0.03, pos.z + _v.z * 0.03, _v.x, _v.y, _v.z, life * rr(0.6, 1.3), s * 0.45, s * 1.9, 4.4 * tint[0], 1.4 * tint[1], 0.22 * tint[2], 0.85, 1.1 * tint[0], 0.1 * tint[1], 0.01 * tint[2], 0.0, 2.6, -0.7, K_PUFF, 0.5, 1, rr(-1.5, 1.5), 0.03, 0.08);
    }
  }
  smoke(pos, n, speed, size, life = 3.5, dark = 0.05, alpha = 0.7, delay = 0.25, rise = 0.4) {
    const P = this.P; n = Math.ceil(n * this.density);
    for (let i = 0; i < n; i++) {
      randUnit(_v); _v.y = Math.abs(_v.y) * 0.9 + 0.2; _v.multiplyScalar(speed * rr(0.25, 1));
      const s = size * rr(0.7, 1.4), c = dark * rr(0.7, 1.5);
      P.spawn(pos.x + _v.x * 0.05, pos.y + _v.y * 0.05, pos.z + _v.z * 0.05, _v.x, _v.y, _v.z, life * rr(0.6, 1.3), s * 0.5, s * 2.6, c, c * 0.95, c * 0.9, alpha, c * 2.4, c * 2.3, c * 2.2, 0, 1.5, -rise, K_PUFF, 0.45, 0, rr(-0.6, 0.6), 0.03, 0.14, 0, rand() * delay);
    }
  }
  dust(pos, n, speed, size, life = 2.2, color = [0.4, 0.34, 0.26], alpha = 0.45, upward = 0.25) {
    const P = this.P; n = Math.ceil(n * this.density);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, sp = speed * rr(0.35, 1);
      const s = size * rr(0.6, 1.5), k = rr(0.75, 1.2);
      P.spawn(pos.x + Math.cos(a) * 0.3, pos.y + rr(0, 0.4), pos.z + Math.sin(a) * 0.3, Math.cos(a) * sp, sp * upward * rr(0.2, 1.4), Math.sin(a) * sp, life * rr(0.6, 1.3), s * 0.5, s * 2.4, color[0] * k, color[1] * k, color[2] * k, alpha, color[0] * k, color[1] * k, color[2] * k, 0, 2.3, -0.04, K_PUFF, 0.35, 0, rr(-0.5, 0.5), 0.03, 0.12);
    }
  }
  glow(pos, size, color, life = 0.15, alpha = 1) {
    this.P.spawn(pos.x, pos.y, pos.z, 0, 0, 0, life, size, size * 1.5, color[0], color[1], color[2], alpha, color[0] * 0.4, color[1] * 0.3, color[2] * 0.3, 0, 1, 0, K_DOT, 0, 1, 0, 0.03, 0.02);
  }
  motes(pos, n, spread, speed, color, life = 1.2, size = 0.06, grav = -0.1) {
    const P = this.P; n = Math.ceil(n * this.density);
    for (let i = 0; i < n; i++) {
      randUnit(_v).multiplyScalar(spread * Math.cbrt(rand())); randUnit(_v2).multiplyScalar(speed * rr(0.3, 1));
      P.spawn(pos.x + _v.x, pos.y + _v.y, pos.z + _v.z, _v2.x, _v2.y, _v2.z, life * rr(0.5, 1.3), size * rr(0.5, 1.5), 0.01, color[0], color[1], color[2], 1, color[0] * 0.5, color[1] * 0.5, color[2] * 0.5, 0.2, 1.4, grav, K_DOT, 0.8, 1, 0, 0.03, 0.1);
    }
  }
  // particles that spiral into a point (charging, black hole feeding)
  implode(center, n, radius, color, life = 0.8, size = 0.07, kind = K_STREAK, spin = 1) {
    const P = this.P; n = Math.ceil(n * this.density);
    for (let i = 0; i < n; i++) {
      randUnit(_v).multiplyScalar(radius * rr(0.5, 1));
      P.spawn(center.x + _v.x, center.y + _v.y, center.z + _v.z, center.x, center.y, center.z, life * rr(0.6, 1.2), size * rr(0.6, 1.4), size * 0.4, color[0], color[1], color[2], 1, color[0], color[1], color[2], 1, 1, 0, kind, 0, 1, spin * rr(0.6, 1.4), 0.02, 0.2, 1);
    }
  }
  heatHaze(pos, n, size, life = 1.2, strength = 1, rise = 2) {
    for (let i = 0; i < n; i++) {
      randUnit(_v).multiplyScalar(size * 0.3);
      this.D.spawn(pos.x + _v.x, pos.y + Math.abs(_v.y), pos.z + _v.z, rr(-0.5, 0.5), rise * rr(0.5, 1.2), rr(-0.5, 0.5), life * rr(0.7, 1.3), size * 0.6, size * 1.6, strength, 0, 0, 1, strength, 0, 0, 0, 0.8, 0, K_PUFF, 0, 1, 0, 0.03, 0.2);
    }
  }
  // fill the segment a->b with trail particles (call each frame with previous and current position)
  trailFire(a, b, size, intensity = 1, smokeToo = true) {
    const P = this.P, d = a.distanceTo(b), n = Math.max(1, Math.ceil((d / (size * 0.35)) * this.density));
    for (let i = 0; i < n; i++) {
      const t = (i + rand()) / n;
      const x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t), z = lerp(a.z, b.z, t);
      randUnit(_v).multiplyScalar(size * 0.6);
      P.spawn(x + _v.x * 0.3, y + _v.y * 0.3, z + _v.z * 0.3, _v.x, _v.y + 0.5, _v.z, rr(0.25, 0.6), size * rr(0.7, 1.1), size * 2.0, 4.6 * intensity, 1.5 * intensity, 0.25 * intensity, 0.8, 1.0, 0.1, 0.01, 0, 2.5, -0.5, K_PUFF, 0.4, 1, rr(-2, 2), 0.03, 0.05);
      if (smokeToo && rand() < 0.4) P.spawn(x, y, z, _v.x * 0.5, _v.y * 0.5 + 0.6, _v.z * 0.5, rr(1.2, 2.6), size * 0.9, size * 3.2, 0.05, 0.047, 0.045, 0.5, 0.14, 0.135, 0.13, 0, 1.2, -0.3, K_PUFF, 0.4, 0, rr(-0.5, 0.5), 0.03, 0.2, 0, 0.08);
    }
  }

  // ---------------------------------------------------------------- the big one
  explosion(pos, s = 1, o = {}) {
    const P = this.P, T = G.terrain, ph = G.physics;
    const gy = T.heightAt(pos.x, pos.z), nearGround = pos.y - gy < 2.2 * s + 1;
    const tint = o.tint || [1, 1, 1];
    const D = this.density;
    // physics
    ph.explode(pos, (o.radius ?? 7.5) * s, (o.strength ?? 20) + 7 * s, { heat: o.heat ?? 1, up: o.up ?? 0.4, speed: 95 + 25 * s, fracture: o.fracture ?? 1 });
    if (nearGround) {
      T.scorch(pos.x, pos.z, 3.4 * s + 1, 1, 1);
      if (o.crater !== false && s >= 0.8) T.crater(pos.x, pos.z, (o.craterR ?? 1.9) * s, (o.craterD ?? 0.55) * s);
      G.grass.shock(pos.x, pos.z, 1.5, 42 + 10 * s, 2.5 + 1.5 * s, 1.3 + 0.4 * s);
      if (o.rubble !== false) ph.spawnRubble(_v.set(pos.x, gy, pos.z), Math.round(5 * s * D + 2), 9 + 5 * s, 0.22 + 0.06 * s, 'stone', 0.9);
    }
    if (G.forest) {
      G.forest.blast(pos, 7 * s + 5, 0.5 + 0.5 * s, o.heat === 0 ? 0 : 0.45);
      if (nearGround && o.heat !== 0) for (let i = 0; i < Math.round(2 + s * 2); i++) { const a = rand() * 6.28, r = rr(2, 4 + 3 * s); G.forest.igniteGround(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r, 14); }
    }
    G.water?.splash(pos.x, pos.z, Math.min(2.5, s));
    // core
    this.fireball(pos, 2.5 * s, 1.15 + 0.45 * s, o.color || null, 1, 1.2 + s);
    this.glow(pos, 6 * s, [8 * tint[0], 4.2 * tint[1], 1.4 * tint[2]], 0.1, 1);
    this.glow(pos, 15 * s, [1.3 * tint[0], 0.55 * tint[1], 0.16 * tint[2]], 0.25, 0.6);
    this.shockwave(pos, 8.5 * s, 0.38 + 0.12 * s, 1, null, nearGround);
    this.light(pos, _c.setRGB(1 * tint[0], 0.56 * tint[1], 0.22 * tint[2]), 1500 * s * s, 26 * s + 12, 0.7 + 0.3 * s, { curve: 2.5 });
    // fire puffs
    let n = Math.ceil(26 * s * D);
    for (let i = 0; i < n; i++) {
      randUnit(_v); _v.y = _v.y * 0.6 + 0.35; _v.multiplyScalar(rr(3, 13) * Math.sqrt(s));
      const sz = rr(0.9, 1.6) * s;
      P.spawn(pos.x + _v.x * 0.05, pos.y + _v.y * 0.05, pos.z + _v.z * 0.05, _v.x, _v.y, _v.z, rr(0.45, 1.05) * (0.8 + 0.2 * s), sz * 0.8, sz * 3.0, 4.6 * tint[0], 1.5 * tint[1], 0.24 * tint[2], 0.9, 1.0 * tint[0], 0.1 * tint[1], 0.01 * tint[2], 0, 2.4, -0.6, K_PUFF, 0.55, 1, rr(-1.5, 1.5), 0.03, 0.05);
    }
    // smoke
    this.smoke(pos, 18 * s, 6 * Math.sqrt(s), 1.6 * s, 3.6 + s, 0.045, 0.75, 0.4, 0.38);
    // sparks + embers
    this.sparks(pos, 55 * s, 30 + 10 * s, [14 * tint[0], 6 * tint[1], 1.2 * tint[2]], 1.2, 1.4, 0.45, 0.05 + 0.01 * s);
    this.embers(pos, 26 * s, 2.5 * s, [9 * tint[0], 2.6 * tint[1], 0.4 * tint[2]], 3.8, 0.22);
    // ground dust ring
    if (nearGround) {
      this.dust(_v.set(pos.x, gy + 0.2, pos.z), 26 * s, 19 * Math.sqrt(s), 1.3 * s, 2.3, [0.42, 0.36, 0.28], 0.42, 0.14);
      // lingering ground fires
      const fires = Math.round(rr(2, 4) * Math.min(s, 2.5));
      for (let i = 0; i < fires; i++) {
        const a = rand() * 6.28, r = rr(0.5, 2.6) * s, fx = pos.x + Math.cos(a) * r, fz = pos.z + Math.sin(a) * r;
        this.groundFire(new THREE.Vector3(fx, T.heightAt(fx, fz), fz), rr(0.5, 1.1) * Math.min(s, 1.6), rr(3.5, 7));
      }
    }
    this.heatHaze(pos, 5, 3 * s, 1.4, 1.2, 2.5);
    // camera + post + audio
    G.player.shakeFrom(pos, 0.42 + 0.3 * s, 45 + 25 * s);
    const d = pos.distanceTo(G.camera.position);
    const close = sat(1 - d / (40 + 30 * s));
    G.post.flash(close * close * (0.25 + 0.2 * s)); G.post.punch(close * (0.8 + 0.5 * s));
    G.audio?.play('explosion', { size: s, pos });
    G.addScore?.(10 * s);
  }

  // tall column of dark smoke over a burning ruin
  plume(pos, life) {
    this.addEmitter({
      pos, life, rate: 7 * this.density, isPlume: true,
      emit: (e, k) => {
        const s = rr(2.2, 3.6), c = rr(0.035, 0.07);
        this.P.spawn(e.pos.x + rr(-1.2, 1.2), e.pos.y + rr(0, 1.5), e.pos.z + rr(-1.2, 1.2), rr(-0.6, 0.6) + 1.2, rr(4.5, 7.5), rr(-0.6, 0.6) + 0.7, rr(6, 10), s, s * 4.2, c, c * 0.95, c * 0.9, 0.62, c * 2.2, c * 2.1, c * 2.0, 0, 0.32, -0.12, K_PUFF, 0.5, 0, rr(-0.3, 0.3), 0.03, 0.12);
        if (rand() < 0.5) this.P.spawn(e.pos.x + rr(-1, 1), e.pos.y + 0.4, e.pos.z + rr(-1, 1), rr(-0.5, 0.5), rr(2.5, 5), rr(-0.5, 0.5), rr(0.6, 1.1), rr(1.2, 2.2), 0.5, 4.2, 1.3, 0.2, 0.85, 1.3, 0.15, 0.01, 0, 0.8, -0.4, K_PUFF, 0.4, 1, rr(-2, 2), 0.03, 0.15);
        if (rand() < 0.3) this.P.spawn(e.pos.x, e.pos.y + 1, e.pos.z, rr(-2, 2), rr(4, 9), rr(-2, 2), rr(2, 4), 0.07, 0.02, 10, 3, 0.5, 1, 3, 0.4, 0, 0, 0.5, -0.25, K_DOT, 1.5, 1);
      },
    });
  }

  groundFire(pos, size, life) {
    const L = null;
    this.addEmitter({
      pos, life, rate: 34 * this.density, size,
      emit: (e, k) => {
        const s = e.size * (0.4 + 0.6 * k);
        const x = e.pos.x + rr(-0.5, 0.5) * s, z = e.pos.z + rr(-0.5, 0.5) * s;
        this.P.spawn(x, e.pos.y + 0.1, z, rr(-0.3, 0.3), rr(1.2, 2.6) * s, rr(-0.3, 0.3), rr(0.4, 0.8), s * 0.7, s * 0.25, 4.2, 1.3, 0.2, 0.85, 1.4, 0.16, 0.01, 0, 0.9, -0.4, K_PUFF, 0.35, 1, rr(-2, 2), 0.03, 0.15);
        if (rand() < 0.16) this.P.spawn(x, e.pos.y + s, z, rr(-0.3, 0.3), rr(1.5, 2.6), rr(-0.3, 0.3), rr(1.8, 3.2), s * 0.8, s * 2.6, 0.04, 0.038, 0.036, 0.45, 0.12, 0.115, 0.11, 0, 0.7, -0.3, K_PUFF, 0.5, 0, 0.3, 0.03, 0.25);
        if (rand() < 0.1) this.P.spawn(x, e.pos.y + 0.3, z, rr(-1, 1), rr(2, 5), rr(-1, 1), rr(0.8, 2), 0.05, 0.02, 10, 3, 0.5, 1, 3, 0.4, 0, 0, 0.7, -0.3, K_DOT, 1.4, 1);
      },
    });
  }

  // ---------------------------------------------------------------- physics callbacks: impacts kick up dust, sparks, sound
  _hookPhysics() {
    const ph = G.physics;
    ph.onImpact = (b, dv) => {
      const big = Math.max(b.sx, b.sy, b.sz);
      if (b.rubble && dv < 8) return;
      _v.set(b.x, b.y - b.sy * 0.3, b.z);
      const d2 = _v.distanceToSquared(G.camera.position);
      if (d2 > 160 * 160) return;
      if (b.mat === 'wood') this.dust(_v, 2, 2 + dv * 0.15, 0.4 * big, 1.2, [0.35, 0.27, 0.18], 0.3, 0.6);
      else {
        this.dust(_v, Math.min(5, 1 + big * 1.5), 2.5 + dv * 0.2, 0.5 + big * 0.45, 1.6, [0.4, 0.36, 0.3], 0.34, 0.5);
        if (dv > 9 && rand() < 0.5) this.sparks(_v, 4, dv * 0.5, [8, 4, 1.2], 0.4, 1.5, 0.5, 0.03);
      }
      G.audio?.play(b.mat === 'wood' ? 'woodhit' : 'rockhit', { pos: _v, size: clamp(big * 0.5, 0.2, 1.5), vel: dv });
      if (dv > 10 && big > 1) G.player.shakeFrom(_v, 0.1 + big * 0.03, 22);
    };
    ph.onFracture = (t, b, n) => {
      _v.set(t.x, t.y, t.z);
      const big = Math.max(b.sx, b.sy, b.sz), near = _v.distanceToSquared(G.camera.position) < 150 * 150;
      if (near) {
        if (b.mat === 'wood') this.dust(_v, 3, 4, big * 0.6, 1.2, [0.38, 0.28, 0.18], 0.35, 0.7);
        else if (b.mat === 'roof' || b.shape === 'prism') this.dust(_v, 4, 5, 0.6 + big * 0.35, 1.8, [0.5, 0.3, 0.22], 0.42, 0.6);
        else this.dust(_v, 4, 5, 0.5 + big * 0.5, 1.9, [0.46, 0.42, 0.36], 0.4, 0.6);
      }
      G.audio?.play(b.mat === 'wood' ? 'woodbreak' : 'rockbreak', { pos: _v, size: clamp(big * 0.4, 0.3, 1.6), glass: b.mat === 'plaster' && b.gen === 0 && b.shape === 'box' });
      // a building coming down
      this.fracCount += b.struct ? 1 : 0.25;
      if (this.fracCount > 6) { this.fracCount = 0; G.audio?.play('collapse', { pos: _v }); G.player.shakeFrom(_v, 0.25, 70); }
      // wreckage that was torn apart by heat keeps burning, and each ruined house sends up a column of smoke
      if (b.heat > 0.3 && rand() < 0.3 && this.emitters.length < 30) this.groundFire(new THREE.Vector3(t.x, Math.max(G.terrain.heightAt(t.x, t.z), t.y - big * 0.45), t.z), rr(0.7, 1.4), rr(7, 13));
      if (b.struct && b.house !== -1 && b.heat > 0.15 && !this.plumed.has(b.house) && this.plumed.size < 22 && rand() < 0.5) { this.plumed.add(b.house); this.plume(new THREE.Vector3(t.x, G.terrain.heightAt(t.x, t.z) + 1, t.z), rr(16, 26)); }
      G.addScore?.(4 + big * 3);
    };
    ph.onDestroyed = (b, dv) => { G.addScore?.(Math.min(6, dv * 0.15)); };
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (dt <= 0) return;
    this.fracCount = Math.max(0, this.fracCount - dt * 2.5);
    for (const m of this.orbs) { if (!m.userData.used) m.visible = false; m.userData.used = false; }
    // timers
    if (this.timers.length) {
      const due = [];
      for (const t of this.timers) { t.t -= dt; if (t.t <= 0) due.push(t); }
      if (due.length) { this.timers = this.timers.filter((t) => t.t > 0); for (const t of due) t.fn(); }
    }
    // emitters
    for (const e of this.emitters) {
      e.age += dt;
      const k = e.life === Infinity ? 1 : sat(1 - e.age / e.life);
      if (e.update) e.update(e, dt);
      e.acc += e.rate * dt * (e.life === Infinity ? 1 : Math.min(1, k * 3));
      let guard = 0;
      while (e.acc >= 1 && guard++ < 200) { e.acc -= 1; e.emit(e, k); }
      if (e.age >= e.life || e.dead) e.done = true;
    }
    if (this.emitters.some((e) => e.done)) this.emitters = this.emitters.filter((e) => !e.done);
    // lights
    for (const L of this.lights) {
      const u = L.userData;
      if (u.follow) L.position.copy(u.follow);
      if (u.hold) { if (u.flicker) L.intensity = u.base * (1 - u.flicker * rand()); continue; }
      if (u.life <= 0) { L.intensity = 0; continue; }
      u.age += dt;
      const k = Math.max(0, 1 - u.age / u.life);
      L.intensity = u.base * Math.pow(k, u.curve) * (1 - u.flicker * rand());
      if (u.age >= u.life) { u.life = 0; L.intensity = 0; }
    }
    // fireballs
    for (const m of this.fireballs) {
      if (!m.visible) continue;
      const u = m.userData; u.age += dt;
      const t = u.age / u.life;
      if (t >= 1) { m.visible = false; continue; }
      m.material.uniforms.uAge.value = t;
      m.scale.setScalar(u.radius * (0.25 + 0.75 * easeOutCubic(Math.min(1, t * 2.6))) * (1 + t * 0.35));
      m.position.y += u.rise * dt * (0.3 + t);
      m.material.uniforms.uDisp.value = 0.35 + t * 0.5;
    }
    // shells
    for (const s of this.shells) {
      if (!s.active) continue;
      s.age += dt; const t = s.age / s.life;
      if (t >= 1) { s.active = false; s.vis.visible = s.dis.visible = s.ring.visible = false; continue; }
      const r = s.radius * easeOutCubic(t);
      s.vis.scale.setScalar(r); s.dis.scale.setScalar(r * 1.02);
      const a = (1 - t) * (1 - t);
      s.vis.material.uniforms.uAlpha.value = a * 0.9 * s.strength;
      s.dis.material.uniforms.uAlpha.value = a * 1.6 * s.strength;
      if (s.ground) { const rr2 = r * 1.5; s.ring.scale.set(rr2, 1, rr2); s.ring.material.uniforms.uAlpha.value = a * 2.4 * s.strength; s.ring.material.uniforms.uWidth.value = 0.06 + t * 0.12; }
    }
    // bolts
    for (const B of this.bolts) {
      if (!B.active) continue;
      B.age += dt;
      if (B.age >= B.life) { B.active = false; B.mesh.visible = false; continue; }
      B.regen -= dt;
      if (B.regen <= 0) { B.regen = B.flick; this._genBolt(B); } else this._writeBolt(B);
      const k = 1 - B.age / B.life;
      B.mesh.material.uniforms.uAlpha.value = B.alpha * Math.pow(k, 0.7) * (0.65 + 0.35 * rand());
    }
    this.D.update();
  }
}
