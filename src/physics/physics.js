// Rapier world + instanced rigid "blocks" (masonry, plaster facades with procedural windows/timber,
// roof slabs, gables, spires, column drums, rocks, wood) with fracture, pressure-wave explosions,
// impact detection and helper queries.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { G, LAYER_SCENE } from '../core/globals.js';
import { rand, rr, randUnit, makeRng, clamp } from '../core/util.js';

const GRAVITY = 15;
// live play: above DEBRIS_SOFT bodies in motion nothing new is fractured; above DEBRIS_HARD the cloud is thinned out
// (the number of bodies allowed in motion adapts to the machine: see `budget` in step())
const STEP_TARGET_MS = 6.5, BUDGET_MIN = 400, BUDGET_MAX = 3600;
const THAW_ON = ['applyImpulse', 'applyTorqueImpulse', 'applyImpulseAtPoint', 'addForce', 'addTorque', 'setLinvel', 'setAngvel', 'setGravityScale', 'wakeUp'];
// installed on the body of a block that has been turned fixed: thaw it, then do what was asked
const THAW_FN = {}, ZERO3 = { x: 0, y: 0, z: 0 }, GCELL = 4, gkey = (x, y, z) => ((x + 512) * 1024 + (z + 512)) * 128 + (y + 32);
for (const k of THAW_ON) THAW_FN[k] = function (v, wake) {
  if ((k === 'setLinvel' || k === 'setAngvel') && !wake && v && !v.x && !v.y && !v.z) return;      // "stop": it already has
  if (k === 'wakeUp' && thawer.realDyn >= REAL_MAX) return;                                       // "wake up" alone moves nothing
  const b = this.__blk; thawer.thaw(b);
  if (Object.prototype.hasOwnProperty.call(this, k)) for (const j of THAW_ON) delete this[j];   // (never loop back into this wrapper)
  const tgt = b.body; return tgt[k].apply(tgt, arguments);                                        // (the block may have become a ghost)
};
let thawer = null;

// ---- cheap debris -----------------------------------------------------------------------------------------------
// At most REAL_MAX bodies are simulated in full at once. Whatever else a spell sets in motion becomes a ghost: it
// keeps its velocity and spin, falls under gravity, bounces on the ground, and is a normal static block again
// where it comes to rest. Ghosts do not collide with each other or with buildings, which is what makes them cheap.
const REAL_MAX = 340, LAND_PER_FRAME = 120, TRASH_PER_FRAME = 3;
class GhostBody {
  constructor(b, body) {
    const t = body.translation(), r = body.rotation(), v = body.linvel(), w = body.angvel();
    this.p = { x: t.x, y: t.y, z: t.z }; this.q = { x: r.x, y: r.y, z: r.z, w: r.w };
    this.v = { x: v.x, y: v.y, z: v.z }; this.w = { x: w.x, y: w.y, z: w.z };
    this.m = b.mass; this.gs = 1; this.i = 12 / (b.mass * (b.sx * b.sx + b.sy * b.sy + b.sz * b.sz) + 1e-6);
  }
  translation() { return this.p; } rotation() { return this.q; } linvel() { return this.v; } angvel() { return this.w; }
  isSleeping() { return false; } mass() { return this.m; }
  applyImpulse(j) { const k = 1 / this.m; this.v.x += j.x * k; this.v.y += j.y * k; this.v.z += j.z * k; }
  applyImpulseAtPoint(j) { this.applyImpulse(j); }
  applyTorqueImpulse(j) { const k = this.i; this.w.x += j.x * k; this.w.y += j.y * k; this.w.z += j.z * k; }
  setLinvel(v) { this.v.x = v.x; this.v.y = v.y; this.v.z = v.z; }
  setAngvel(w) { this.w.x = w.x; this.w.y = w.y; this.w.z = w.z; }
  setGravityScale(g) { this.gs = g; }
  setTranslation(t) { this.p.x = t.x; this.p.y = t.y; this.p.z = t.z; }
  wakeUp() {} sleep() {} addForce() {} addTorque() {} setAdditionalSolverIterations() {} setBodyType() {}
}
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export const MATS = {
  stone: { density: 2.4, friction: 0.82, rest: 0.08, frac: 9 },
  ashlar: { density: 2.2, friction: 0.86, rest: 0.06, frac: 8 },
  plaster: { density: 1.5, friction: 0.82, rest: 0.05, frac: 5.5 },
  roof: { density: 1.3, friction: 0.95, rest: 0.05, frac: 5 },
  wood: { density: 0.6, friction: 0.62, rest: 0.18, frac: 5 },
  ice: { density: 0.9, friction: 0.3, rest: 0.05, frac: 4.5 },
};

class InstPool {
  constructor(geometry, material, capacity) {
    this.capacity = capacity;
    this.seed = new Float32Array(capacity * 4);
    this.style = new Float32Array(capacity * 4);
    this.col2 = new Float32Array(capacity * 3).fill(1);
    geometry.setAttribute('aCol2', new THREE.InstancedBufferAttribute(this.col2, 3));
    this.col2Attr = geometry.attributes.aCol2;
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(this.seed, 4));
    geometry.setAttribute('aStyle', new THREE.InstancedBufferAttribute(this.style, 4));
    this.seedAttr = geometry.attributes.aSeed; this.styleAttr = geometry.attributes.aStyle;
    this.seedAttr.setUsage(THREE.DynamicDrawUsage); this.styleAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.mesh.layers.set(LAYER_SCENE);
    this.mesh.count = 0;
    this.free = []; this.high = 0; this.dirty = false; this.seedDirty = false; this.styleDirty = false; this.colorDirty = false;
    for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, _c.setRGB(1, 1, 1));
  }
  alloc() {
    let i;
    if (this.free.length) i = this.free.pop();
    else if (this.high < this.capacity) i = this.high++;
    else return -1;
    this.mesh.count = this.high;
    const o = i * 4;
    this.seed[o] = rand(); this.seed[o + 1] = rand(); this.seed[o + 2] = 0; this.seed[o + 3] = 0;
    this.style[o] = 0; this.style[o + 1] = 0; this.style[o + 2] = 0; this.style[o + 3] = 0;
    this.seedDirty = true; this.styleDirty = true;
    return i;
  }
  release(i) { this.mesh.setMatrixAt(i, ZERO); this.free.push(i); this.dirty = true; }
  flush() {
    if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; }
    if (this.seedDirty) { this.seedAttr.needsUpdate = true; this.seedDirty = false; }
    if (this.styleDirty) { this.styleAttr.needsUpdate = true; this.styleDirty = false; }
    if (this.col2Dirty) { this.col2Attr.needsUpdate = true; this.col2Dirty = false; }
    if (this.colorDirty) { this.mesh.instanceColor.needsUpdate = true; this.colorDirty = false; }
  }
}

// Procedural old-town facade drawn on the two large faces of a wall panel:
// aStyle = (feature, timberPattern, litFraction, isFragment)
//   feature: 0 blank, 1 windows, 2 door + windows, 3 tall windows, 4 round window, 5 stained glass, 6 clock face
const FACADE_GLSL = /* glsl */ `
  float fHash(float n){ return fract(sin(n * 127.1) * 43758.5453); }
  vec3 stained(vec2 q){
    vec2 id = floor(q); float h = fHash(id.x * 7.3 + id.y * 13.7);
    vec3 c = h < 0.25 ? vec3(0.9, 0.08, 0.06) : h < 0.5 ? vec3(0.08, 0.2, 0.95) : h < 0.75 ? vec3(1.0, 0.62, 0.08) : vec3(0.1, 0.75, 0.3);
    vec2 f = abs(fract(q) - 0.5);
    return c * step(max(f.x, f.y), 0.43);
  }
`;
const FACADE_MAIN = /* glsl */ `
  {
    vec3 fal = abs(vLocal);
    if (vStyle.w > 0.5) {
      // broken fragment: exposed brick / rubble core showing through the render
      float bn = texture2D(tNoiseB, vMapUv * 0.9 + vSeed.xy * 3.0).r;
      vec3 brick = vec3(0.42, 0.17, 0.1) * (0.6 + 0.8 * texture2D(tNoiseB, vMapUv * 5.0).b);
      vec2 bq = vMapUv * vec2(9.0, 22.0); bq.x += step(1.0, mod(bq.y, 2.0)) * 0.5;
      vec2 bf = abs(fract(bq) - 0.5);
      brick *= mix(0.45, 1.0, step(bf.y, 0.42) * step(bf.x, 0.47));
      diffuseColor.rgb = mix(diffuseColor.rgb, brick, smoothstep(0.42, 0.56, bn + vSeed.y * 0.25));
    } else if (fal.z > 0.455) {
      vec2 hs = vIScale.xy * 0.5;
      vec2 p = vLocal.xy * vIScale.xy;
      float nb = max(1.0, floor(vIScale.x / 2.5 + 0.5));
      float cw = vIScale.x / nb;
      float bx = (p.x + hs.x) / cw;
      float bay = floor(bx);
      float cx = (fract(bx) - 0.5) * cw;
      vec3 woodC = texture2D(tWoodF, vec2(p.x * 0.55 + vSeed.x * 3.0, p.y * 0.2 + vSeed.y)).rgb;
      vec3 beamC = woodC * mix(vec3(0.2, 0.15, 0.11), vec3(0.38, 0.28, 0.2), vSeed.y);
      vec3 frameC = mix(vec3(0.78, 0.74, 0.66), beamC * 1.3, step(0.55, vSeed.x));
      float feat = vStyle.x, pat = vStyle.y;
      float timber = 0.0;
      vec3 col = diffuseColor.rgb;
      // grime: darker towards the ground, soft vertical streaks
      col *= mix(0.78, 1.0, smoothstep(-hs.y, -hs.y + 1.1, p.y)) * (0.9 + 0.2 * texture2D(tNoiseB, vec2(p.x * 0.07 + vSeed.x, p.y * 0.02)).r);
      #ifdef PRISM
        float eSlope = (1.0 - abs(p.x) / hs.x - (p.y + hs.y) / (2.0 * hs.y)) * (2.0 * hs.x * hs.y) / length(vec2(2.0 * hs.y, hs.x));
        float eBase = p.y + hs.y;
        if (pat > 0.5) {
          timber = max(step(eSlope, 0.17), step(eBase, 0.14));
          timber = max(timber, step(abs(p.x), 0.065));
          if (pat > 1.5) timber = max(timber, step(abs(p.y + hs.y * 0.3), 0.06));
          if (pat > 2.5) timber = max(timber, step(abs(abs(p.x) - (p.y + hs.y) * 0.55), 0.07) * step(p.y, -hs.y * 0.3));
        }
        if (feat > 3.5 && feat < 4.5) {
          float rr0 = min(0.5, hs.y * 0.3);
          float rd = length(p - vec2(0.0, -hs.y * 0.28)) - rr0;
          if (rd < 0.09) { col = frameC; timber = 0.0; }
          if (rd < 0.0) {
            float mull = max(step(abs(p.x), 0.03), step(abs(p.y + hs.y * 0.28), 0.03));
            if (mull < 0.5) { fGlass = 1.0; col = vec3(0.012, 0.016, 0.024); if (fHash(vSeed.x * 91.0) < vStyle.z) fEmit = vec3(1.0, 0.56, 0.2) * 1.7; }
          }
        }
        if (feat > 4.5 && feat < 5.5) { // rose window
          float R0 = min(hs.x, hs.y) * 0.55;
          vec2 rc = p - vec2(0.0, -hs.y * 0.15);
          float rd = length(rc) - R0;
          if (rd < 0.16) col = vec3(0.3, 0.28, 0.25);
          if (rd < 0.0) {
            float an = atan(rc.y, rc.x); float rl = length(rc) / R0;
            float spoke = step(abs(fract(an / 6.2831853 * 12.0) - 0.5), 0.44) * step(0.05, abs(rl - 0.55));
            vec3 sg = stained(vec2(an * 3.82, rl * 4.0)) * spoke;
            col = sg * 0.25; fGlass = 0.6; fEmit = sg * 2.6 * vStyle.z;
          }
        }
      #else
        if (pat > 0.5) {
          float e = min(hs.x - abs(p.x), hs.y - abs(p.y));
          timber = step(e, 0.125);
          timber = max(timber, step(cw * 0.5 - abs(cx), 0.06));
          if (pat > 1.5) timber = max(timber, step(abs(p.y + hs.y * 0.44), 0.055));
          if (pat > 2.5) {
            float dgl = abs(abs(cx) / (cw * 0.5) - (p.y + hs.y) / (hs.y * 0.56));
            timber = max(timber, step(dgl, 0.1) * step(p.y, -hs.y * 0.44));
          }
        }
        if (feat > 0.5 && feat < 3.5) {
          float doorBay = step(1.5, feat) * step(feat, 2.5) * step(abs(bay - floor(nb * 0.5)), 0.5);
          if (doorBay > 0.5) {
            vec2 dq = abs(vec2(cx, p.y + hs.y - 1.1)) - vec2(0.58, 1.1);
            float dd = max(dq.x, dq.y);
            if (dd < 0.11) { col = beamC * 0.8; timber = 0.0; }
            if (dd < 0.0) {
              float hue = fHash(vSeed.x * 31.0);
              vec3 dc = hue < 0.3 ? vec3(0.13, 0.26, 0.16) : hue < 0.55 ? vec3(0.34, 0.09, 0.07) : hue < 0.75 ? vec3(0.1, 0.17, 0.3) : vec3(0.3, 0.2, 0.12);
              col = texture2D(tWoodF, vec2(cx * 0.8, p.y * 0.25)).rgb * dc * 2.4;
              col *= 0.7 + 0.3 * step(0.07, abs(fract(cx * 4.2) - 0.5));
              col = mix(col, vec3(0.9, 0.7, 0.3), step(length(vec2(cx - 0.38, p.y + hs.y - 1.05)), 0.045));
            }
          } else {
            float tall = step(2.5, feat);
            float wy = mix(0.14, 0.05, tall);
            vec2 whs = mix(vec2(0.5, 0.68), vec2(0.56, hs.y * 0.6), tall);
            vec2 wq = abs(vec2(cx, p.y - wy)) - whs;
            float wd = max(wq.x, wq.y);
            if (abs(p.y - (wy - whs.y - 0.09)) < 0.06 && abs(cx) < whs.x + 0.18) { col = frameC * 0.85; timber = 0.0; }
            float sh = step(0.45, fHash(vSeed.y * 57.0));
            if (sh > 0.5 && abs(p.y - wy) < whs.y && abs(abs(cx) - (whs.x + 0.3)) < 0.21) {
              float hue = fHash(vSeed.x * 31.0);
              vec3 sc = hue < 0.35 ? vec3(0.1, 0.22, 0.14) : hue < 0.6 ? vec3(0.3, 0.08, 0.06) : hue < 0.8 ? vec3(0.09, 0.15, 0.27) : vec3(0.24, 0.16, 0.1);
              col = sc * (0.75 + 0.5 * step(0.2, fract(p.y * 9.0))); timber = 0.0;
            }
            if (wd < 0.085) { col = frameC; timber = 0.0; }
            if (wd < 0.0) {
              float mull = max(step(abs(cx), 0.026), step(abs(p.y - wy - whs.y * 0.3), 0.026));
              if (mull < 0.5) {
                fGlass = 1.0; col = vec3(0.012, 0.016, 0.024);
                if (fHash(bay * 3.7 + vSeed.x * 91.0) < vStyle.z) {
                  float curtain = 0.55 + 0.45 * smoothstep(0.1, 0.45, abs(cx) / whs.x + 0.05 * sin(p.y * 9.0 + vSeed.y * 20.0));
                  float lamp = 0.5 + 0.5 * smoothstep(whs.y, -whs.y, p.y - wy);
                  fEmit = mix(vec3(1.0, 0.5, 0.16), vec3(1.0, 0.72, 0.36), fHash(bay + vSeed.y * 40.0)) * curtain * lamp * 2.1;
                }
              }
            }
          }
        }
        if (feat > 4.5 && feat < 5.5) { // tall arched stained glass
          float ar = min(0.82, cw * 0.36);
          float ytop = hs.y * 0.42, ybot = -hs.y * 0.62;
          float inArch = max(step(length(vec2(cx, p.y - ytop)), ar), step(abs(cx), ar) * step(p.y, ytop) * step(ybot, p.y));
          float inFrame = max(step(length(vec2(cx, p.y - ytop)), ar + 0.14), step(abs(cx), ar + 0.14) * step(p.y, ytop) * step(ybot - 0.14, p.y));
          if (inFrame > 0.5) col = vec3(0.32, 0.3, 0.27);
          if (inArch > 0.5) {
            vec3 sg = stained(vec2(cx * 4.6 + bay * 3.0, p.y * 3.4 + vSeed.x * 9.0));
            sg *= step(0.035, abs(cx));
            col = sg * 0.22; fGlass = 0.6; fEmit = sg * 2.4 * vStyle.z;
          }
        }
        if (feat > 5.5 && feat < 6.5) { // clock face
          float R0 = min(hs.x, hs.y) * 0.72; float rl = length(p) / R0;
          if (rl < 1.12) col = vec3(0.12, 0.09, 0.05);
          if (rl < 1.0) {
            float an = atan(p.x, p.y);
            vec3 face = vec3(0.92, 0.84, 0.62);
            float tick = step(abs(fract(an / 6.2831853 * 12.0 + 0.5) - 0.5), 0.07) * step(0.78, rl) * step(rl, 0.93);
            float hA = 5.2, mA = 1.05;
            float hh = step(abs(sin(an - hA)) * rl, 0.045) * step(0.0, cos(an - hA)) * step(rl, 0.55);
            float mh = step(abs(sin(an - mA)) * rl, 0.03) * step(0.0, cos(an - mA)) * step(rl, 0.82);
            float ink = max(max(tick, hh), max(mh, step(rl, 0.06)));
            col = mix(face, vec3(0.05, 0.04, 0.03), ink);
            fEmit = col * 1.5 * vStyle.z;
          }
        }
      #endif
      col = mix(col, beamC, timber);
      diffuseColor.rgb = col;
    }
  }
`;

function makeChamferBox(r = 0.03) {
  const pos = [], nor = [], uv = [], idx = [], h = 0.5, k = 0.5 - r;
  const pt = (a, va, b, vb, c, vc) => { const p = [0, 0, 0]; p[a] = va; p[b] = vb; p[c] = vc; return p; };
  const face = (pts, n) => {
    const o = pos.length / 3, l = Math.hypot(n[0], n[1], n[2]);
    for (const p of pts) { pos.push(p[0], p[1], p[2]); nor.push(n[0] / l, n[1] / l, n[2] / l); uv.push(0, 0); }
    const [a, b, c] = pts, ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const ccw = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] > 0;
    for (let i = 1; i < pts.length - 1; i++) { if (ccw) idx.push(o, o + i, o + i + 1); else idx.push(o, o + i + 1, o + i); }
  };
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    for (const sa of [-1, 1]) {
      face([pt(a, sa * h, b, -k, c, -k), pt(a, sa * h, b, k, c, -k), pt(a, sa * h, b, k, c, k), pt(a, sa * h, b, -k, c, k)], pt(a, sa, b, 0, c, 0));            // the six faces
      for (const sb of [-1, 1]) face([pt(a, sa * h, b, sb * k, c, -k), pt(a, sa * h, b, sb * k, c, k), pt(a, sa * k, b, sb * h, c, k), pt(a, sa * k, b, sb * h, c, -k)], pt(a, sa, b, sb, c, 0));   // twelve bevels
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) face([[sx * h, sy * k, sz * k], [sx * k, sy * h, sz * k], [sx * k, sy * k, sz * h]], [sx, sy, sz]);                   // eight corners
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

function blockMaterial(diff, nor, arm, uvMode, { texScale = 0.42, facade = false, prism = false, col2 = false, ...opts } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: diff, normalMap: nor, roughnessMap: arm, aoMap: arm, roughness: 1, metalness: 0, envMapIntensity: 0.9, ...opts });
  m.normalScale.set(1.1, 1.1);
  if (facade) m.defines = { ...(m.defines || {}), FACADE: 1, ...(prism ? { PRISM: 1 } : {}) };
  m.customProgramCacheKey = () => `blk${uvMode}${+col2}${+facade}${+prism}${texScale}`;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tNoiseB = { value: G.noiseTex };
    sh.uniforms.tWoodF = { value: G.tex.wood_diff };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aCol2; flat varying vec3 vCol2; attribute vec4 aSeed; attribute vec4 aStyle; flat varying vec4 vSeed; flat varying vec4 vStyle; varying vec3 vLocal; flat varying vec3 vIScale;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_INSTANCING
          vec3 iScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vec2 buv;
          ${uvMode === 0 ? `vec3 an = abs(normal); vec3 sp = position * iScale;
            if (an.x > an.y && an.x > an.z) buv = sp.zy; else if (an.y > an.z) buv = sp.xz; else buv = sp.xy;`
        : uvMode === 3 ? 'buv = vec2(position.z * iScale.z, position.y * iScale.y * 1.38);'
        : uvMode === 1 ? 'buv = uv * vec2(3.14159 * iScale.x, iScale.y);'
          : 'buv = uv * (iScale.x + iScale.y + iScale.z) * 0.3333;'}
          buv = buv * ${texScale.toFixed(3)} + aSeed.xy * 9.0;
          vMapUv = buv;
          #ifdef USE_NORMALMAP
            vNormalMapUv = buv;
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv = buv;
          #endif
          #ifdef USE_AOMAP
            vAoMapUv = buv;
          #endif
          vSeed = aSeed; vStyle = aStyle; vLocal = position; vIScale = iScale; vCol2 = aCol2;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        flat varying vec3 vCol2; flat varying vec4 vSeed; flat varying vec4 vStyle; varying vec3 vLocal; flat varying vec3 vIScale; uniform sampler2D tNoiseB, tWoodF;
        float fGlass = 0.0; vec3 fEmit = vec3(0.0);
        ${facade ? FACADE_GLSL : ''}`)
      .replace('#include <color_fragment>', `${col2 ? 'diffuseColor.rgb *= vCol2;' : '#include <color_fragment>'}
        ${facade ? FACADE_MAIN : ''}
        ${uvMode === 0 ? `// seams / grime where blocks meet
        vec3 ed = (0.5 - abs(vLocal)) * vIScale;
        float edge = min(min(max(ed.x, ed.y), max(ed.y, ed.z)), max(ed.x, ed.z));
        diffuseColor.rgb *= mix(${facade ? '0.8' : '0.6'}, 1.0, smoothstep(0.0, 0.09, edge));` : ''}
        float charK = vSeed.z;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.09 + vec3(0.008), charK * 0.92);
        fEmit *= (1.0 - charK);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.07, fGlass);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (fGlass > 0.3) normal = nonPerturbedNormal;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += fEmit;
        if (vSeed.w > 0.004) {
          float hn = abs(texture2D(tNoiseB, vMapUv * 0.5 + vSeed.xy).r - 0.5) + abs(texture2D(tNoiseB, vMapUv * 1.7 + vSeed.yx).g - 0.4) * 0.5;
          float hot = vSeed.w * (0.3 + 1.1 * smoothstep(0.2, 0.02, hn));
          totalEmissiveRadiance += vec3(1.0, 0.16, 0.012) * pow(hot, 1.6) * 4.0 + vec3(1.0, 0.55, 0.18) * pow(hot, 4.0) * 6.0;
        }`);
  };
  return m;
}

// irregular rock: displaced icosphere, per-face projected UVs, smoothed normals
function makeRockGeometry(seed, detail = 2) {
  const rng = makeRng(seed);
  const ico = new THREE.IcosahedronGeometry(0.5, detail);
  const pos = ico.attributes.position;
  const offs = []; for (let i = 0; i < 7; i++) offs.push([randUnitRng(rng), 0.3 + rng() * 0.5]);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    let r = 0.5;
    for (const [d, a] of offs) { const k = n.dot(d); if (k > 0.25) r -= (k - 0.25) * a * 0.42; }
    r += Math.sin(n.x * 9 + seed) * Math.cos(n.y * 7 - seed) * 0.02;
    v.copy(n).multiplyScalar(Math.max(0.2, r));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  ico.computeVertexNormals();
  const map = new Map(), nor = ico.attributes.normal;
  const key = (i) => `${Math.round(pos.getX(i) * 500)},${Math.round(pos.getY(i) * 500)},${Math.round(pos.getZ(i) * 500)}`;
  for (let i = 0; i < pos.count; i++) { const k = key(i); const e = map.get(k) || new THREE.Vector3(); e.add(v.fromBufferAttribute(nor, i)); map.set(k, e); }
  const fn = new THREE.Vector3(), sm = new THREE.Vector3();
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 3) {
    fn.set(0, 0, 0); for (let k = 0; k < 3; k++) fn.add(v.fromBufferAttribute(nor, i + k));
    const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k), y = pos.getY(i + k), z = pos.getZ(i + k);
      if (ax > ay && ax > az) { uv[(i + k) * 2] = z; uv[(i + k) * 2 + 1] = y; } else if (ay > az) { uv[(i + k) * 2] = x; uv[(i + k) * 2 + 1] = z; } else { uv[(i + k) * 2] = x; uv[(i + k) * 2 + 1] = y; }
    }
  }
  for (let i = 0; i < pos.count; i++) { sm.copy(map.get(key(i))).normalize(); v.fromBufferAttribute(nor, i).lerp(sm, 0.6).normalize(); nor.setXYZ(i, v.x, v.y, v.z); }
  ico.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return ico;
}
function randUnitRng(rng) { const u = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u); return new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a)); }

function makeDrumGeometry() {
  const pts = [new THREE.Vector2(0, -0.5), new THREE.Vector2(0.47, -0.5), new THREE.Vector2(0.5, -0.47), new THREE.Vector2(0.5, 0.47), new THREE.Vector2(0.47, 0.5), new THREE.Vector2(0, 0.5)];
  const g = new THREE.LatheGeometry(pts, 72);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(x, z);
    if (r > 0.4 && Math.abs(y) < 0.48) {
      const a = Math.atan2(z, x);
      const k = 1 - 0.045 * Math.pow(Math.max(0, Math.cos(a * 18)), 0.6);
      pos.setXYZ(i, x * k, y, z * k);
    }
  }
  g.computeVertexNormals();
  return g;
}
// flat-shaded geometry from triangles [[a,b,c],...] (CCW outward)
function flatGeometry(tris) {
  const pos = [], nor = [], uv = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (const t of tris) {
    a.fromArray(t[0]); b.fromArray(t[1]); c.fromArray(t[2]);
    n.subVectors(b, a).cross(_v.subVectors(c, a)).normalize();
    for (const p of t) { pos.push(...p); nor.push(n.x, n.y, n.z); uv.push(p[0], p[1]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
const PRISM_PTS = [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0, 0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0, 0.5, -0.5]];
function makePrismGeometry() {
  const P = PRISM_PTS;
  const g = flatGeometry([[P[0], P[1], P[2]], [P[4], P[3], P[5]], [P[3], P[4], P[1]], [P[3], P[1], P[0]], [P[1], P[4], P[5]], [P[1], P[5], P[2]], [P[3], P[0], P[2]], [P[3], P[2], P[5]]]);
  g.addGroup(0, 12, 0); g.addGroup(12, 12, 1);
  return g;
}
const PYR_PTS = [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5], [0, 0.5, 0]];
function makePyramidGeometry() {
  const P = PYR_PTS;
  return flatGeometry([[P[3], P[2], P[4]], [P[2], P[1], P[4]], [P[1], P[0], P[4]], [P[0], P[3], P[4]], [P[0], P[1], P[2]], [P[0], P[2], P[3]]]);
}

export class Physics {
  constructor() {
    this.RAPIER = RAPIER;
    this.blocks = []; this.byCollider = new Map(); this.hot = new Set(); this.waves = []; this.rubble = [];
    this.maxRubble = 800; this.maxBodies = 46000;
    this.onImpact = null; this.onFracture = null; this.onDestroyed = null;
    this.GROUP_TERRAIN = (0x0001 << 16) | 0xffff;
    this.GROUP_BLOCK = (0x0002 << 16) | 0xffff;
    this.GROUP_PLAYER = (0x0004 << 16) | 0x0003;
    this.GROUP_RUBBLE = (0x0008 << 16) | 0x0003;
    this.GROUP_QUERY = (0xffff << 16) | 0x000b;
    this.impactBudget = 0; this.stats = { awake: 0, alive: 0 };
    this.live = !!G.liveSim; this.frozen = []; this.fzI = 0; this.debrisRoom = Infinity;
    this.buildFrozen = false; this.groups = []; this.awakeGroups = new Set(); this.groupHash = null; thawer = this;
    this.budget = 2200; this.stepMs = 0; this.realDyn = 0; this.ghosts = 0; this.trash = [];
    this.structTotal = 0; this.structDown = 0; this.growing = [];
  }
  // scale a (sleeping) body in from nothing: used when magic raises structures out of the ground
  growIn(b, delay = 0, dur = 0.5) { if (!b) return; b.shrink = 0.001; this.growing.push({ b, t: -delay, dur }); this._writeMatrix(b, b.body.translation(), b.body.rotation()); }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.numSolverIterations = 6;
    const T = G.tex;
    const warm = new THREE.Color(1.32, 1.2, 1.02);
    const boxGeo = () => makeChamferBox(0.03);
    const mk = {
      stone: () => blockMaterial(T.stone_diff, T.stone_nor, T.stone_arm, 0, { texScale: 0.4, color: warm }),
      ashlar: () => blockMaterial(T.ashlar_diff, T.ashlar_nor, T.ashlar_arm, 0, { texScale: 0.3, facade: true, color: new THREE.Color(1.25, 1.18, 1.08) }),
      plaster: (prism) => blockMaterial(T.plaster_diff, T.plaster_nor, T.plaster_arm, 0, { texScale: 0.35, facade: true, prism, color: new THREE.Color(1.3, 1.26, 1.18) }),
      roof: () => blockMaterial(T.roof_diff, T.roof_nor, T.roof_arm, 0, { texScale: 0.42, color: new THREE.Color(1.1, 1.1, 1.1) }),
      wood: (mode) => blockMaterial(T.wood_diff, T.wood_nor, T.wood_arm, mode, { texScale: 0.7 }),
    };
    const big = G.quality !== 'low';
    this.pools = {
      box: new InstPool(boxGeo(), mk.stone(), 9000),
      ashlar: new InstPool(boxGeo(), mk.ashlar(), 14000),
      plaster: new InstPool(boxGeo(), mk.plaster(false), big ? 26000 : 18000),
      roof: new InstPool(boxGeo(), mk.roof(), 7000),
      wood: new InstPool(boxGeo(), mk.wood(0), 11000),
      cyl: new InstPool(makeDrumGeometry(), blockMaterial(T.stone_diff, T.stone_nor, T.stone_arm, 1, { texScale: 0.4, color: warm }), 900),
      barrel: new InstPool(new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1), mk.wood(1), 900),
      rock: new InstPool(makeRockGeometry(3, 2), blockMaterial(T.darkstone_diff, T.darkstone_nor, T.darkstone_arm, 2, { texScale: 0.9 }), 5000),
      prism: new InstPool(makePrismGeometry(), [mk.plaster(true), blockMaterial(T.roof_diff, T.roof_nor, T.roof_arm, 3, { texScale: 0.42, col2: true, color: new THREE.Color(1.1, 1.1, 1.1) })], 2800),
      pyr: new InstPool(makePyramidGeometry(), mk.roof(), 640),
      ice: new InstPool(boxGeo(), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.55, 0.78, 0.98), roughness: 0.1, metalness: 0, emissive: new THREE.Color(0.02, 0.05, 0.09), envMapIntensity: 1.8 }), 900),
      icepyr: new InstPool(makePyramidGeometry(), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.6, 0.82, 1.0), roughness: 0.08, metalness: 0, emissive: new THREE.Color(0.03, 0.07, 0.12), envMapIntensity: 1.9, flatShading: true }), 500),
    };
    for (const p of Object.values(this.pools)) G.scene.add(p.mesh);
    this.rockHullPoints = this._hullPoints(this.pools.rock.mesh.geometry);
    return this;
  }
  _hullPoints(geo) {
    const pos = geo.attributes.position, seen = new Set(), pts = [];
    for (let i = 0; i < pos.count; i++) {
      const k = `${Math.round(pos.getX(i) * 100)},${Math.round(pos.getY(i) * 100)},${Math.round(pos.getZ(i) * 100)}`;
      if (!seen.has(k)) { seen.add(k); pts.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
    }
    return new Float32Array(pts);
  }
  _poolFor(shape, mat) {
    if (shape === 'rock') return this.pools.rock;
    if (shape === 'cyl') return mat === 'wood' ? this.pools.barrel : this.pools.cyl;
    if (shape === 'prism') return this.pools.prism;
    if (shape === 'pyr') return mat === 'ice' ? this.pools.icepyr : this.pools.pyr;
    return this.pools[mat === 'stone' ? 'box' : mat] || this.pools.box;
  }

  // ---- creation ----------------------------------------------------------------
  // o: {shape:'box'|'cyl'|'rock'|'prism'|'pyr', mat, x,y,z, sx,sy,sz (full size), q, sleeping, fixed, tint|color,
  //     style:[feat,timber,lit,frag], rubble, life, vel}
  add(o) {
    const minor = !!o.rubble || (o.gen ?? 0) > 0;           // debris may be refused; conjured and structural bodies may not
    if (minor && this.blocks.length >= this.maxBodies) return null;
    const mat = o.mat || 'stone', shape = o.shape || 'box';
    const pool = this._poolFor(shape, mat);
    let idx = pool.alloc();
    if (idx < 0 && !minor && this._evict(pool)) idx = pool.alloc();
    if (idx < 0) return null;
    const R = RAPIER, M = MATS[mat] || MATS.stone;
    const bd = o.fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic();
    bd.setTranslation(o.x, o.y, o.z);
    if (o.q) bd.setRotation({ x: o.q.x, y: o.q.y, z: o.q.z, w: o.q.w });
    if (!o.fixed) {
      bd.setSleeping(o.sleeping !== false).setLinearDamping(0.02).setAngularDamping(0.12);
      if (o.vel) bd.setLinvel(o.vel.x, o.vel.y, o.vel.z);
      if (o.angvel) bd.setAngvel({ x: o.angvel.x, y: o.angvel.y, z: o.angvel.z });
      if (o.ccd) bd.setCcdEnabled(true);
    }
    const body = this.world.createRigidBody(bd);
    if (this.live && !o.fixed && !o.rubble && !(o.gen > 0)) body.setAdditionalSolverIterations(4);
    const sx = o.sx, sy = o.sy, sz = o.sz;
    let cd, volK = 1;
    const hull = (src) => { const pts = new Float32Array(src.length * 3); src.forEach((p, i) => { pts[i * 3] = p[0] * sx; pts[i * 3 + 1] = p[1] * sy; pts[i * 3 + 2] = p[2] * sz; }); return R.ColliderDesc.convexHull(pts); };
    if (shape === 'cyl') { cd = R.ColliderDesc.cylinder(sy / 2, sx / 2); volK = 0.785; }
    else if (shape === 'prism') { cd = hull(PRISM_PTS) || R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2); volK = 0.5; }
    else if (shape === 'pyr') { cd = hull(PYR_PTS) || R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2); volK = 0.333; }
    else if (shape === 'rock' && !o.rubble && Math.max(sx, sy, sz) > 0.9) {
      const pts = new Float32Array(this.rockHullPoints.length);
      for (let i = 0; i < pts.length; i += 3) { pts[i] = this.rockHullPoints[i] * sx; pts[i + 1] = this.rockHullPoints[i + 1] * sy; pts[i + 2] = this.rockHullPoints[i + 2] * sz; }
      cd = R.ColliderDesc.convexHull(pts) || R.ColliderDesc.cuboid(sx * 0.4, sy * 0.4, sz * 0.4); volK = 0.4;
    } else if (shape === 'rock') { cd = R.ColliderDesc.cuboid(sx * 0.36, sy * 0.36, sz * 0.36); volK = 0.4; }
    else cd = R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
    cd.setDensity(o.density ?? M.density).setFriction(o.friction ?? M.friction).setRestitution(M.rest)
      .setCollisionGroups(o.rubble ? this.GROUP_RUBBLE : this.GROUP_BLOCK);
    const collider = this.world.createCollider(cd, body);
    const desc = cd;
    const b = {
      body, collider, pool, idx, shape, mat, sx, sy, sz, fixed: !!o.fixed, alive: true, rubble: !!o.rubble,
      life: o.life ?? Infinity, vol: sx * sy * sz * volK,
      pvx: 0, pvy: 0, pvz: 0, wasAwake: true, heat: 0, char: 0, gen: o.gen ?? 0, shrink: 1, held: false, tag: o.tag || null, noFracture: !!o.noFracture,
      mass: body.mass(), spawnT: G.time, frac: M.frac, lit: 0, house: o.house ?? -1,
      struct: !!o.struct, counted: false, ox: o.x, oy: o.y, oz: o.z, desc,
    };
    if (b.struct) this.structTotal++;
    if (o.vel) { b.pvx = o.vel.x; b.pvy = o.vel.y; b.pvz = o.vel.z; }
    this.byCollider.set(collider.handle, b);
    this.blocks.push(b);
    if (o.rubble) { this.rubble.push(b); if (this.rubble.length > this.maxRubble) { const old = this.rubble.shift(); if (old.alive) old.life = Math.min(old.life, 0.4); } }
    if (o.color) pool.mesh.setColorAt(idx, o.color);
    else { const t = o.tint ?? 1, hue = (rand() - 0.5) * 0.06; pool.mesh.setColorAt(idx, _c.setRGB(t * (1 + hue), t, t * (1 - hue))); }
    pool.colorDirty = true;
    if (o.color2) { pool.col2[idx * 3] = o.color2.r; pool.col2[idx * 3 + 1] = o.color2.g; pool.col2[idx * 3 + 2] = o.color2.b; pool.col2Dirty = true; }
    if (o.style) { const k = idx * 4; pool.style[k] = o.style[0]; pool.style[k + 1] = o.style[1]; pool.style[k + 2] = o.style[2]; pool.style[k + 3] = o.style[3] || 0; b.lit = o.style[2]; }
    if (o.char) { b.char = o.char; pool.seed[idx * 4 + 2] = o.char; }
    if (o.heat) this.heatBlock(b, o.heat);
    this._writeMatrix(b, body.translation(), body.rotation());
    if (this.buildFrozen && !b.fixed && !o.rubble && !(o.gen > 0)) { b.still = true; this._fix(b, false); }
    else if (this.live && !b.fixed && o.sleeping === false) { if (this.realDyn >= REAL_MAX) this._ghost(b); else this.realDyn++; }
    return b;
  }

  // free a slot in a full pool by retiring the least important piece of debris in it (rubble first, then the furthest)
  _evict(pool) {
    const e = G.player?.pos; let best = null, score = -1;
    for (const b of this.blocks) {
      if (!b.alive || b.pool !== pool || b.held || !(b.rubble || b.gen > 0)) continue;
      const dx = e ? b.x - e.x : 0, dz = e ? b.z - e.z : 0, s = dx * dx + dz * dz + (b.rubble ? 1e6 : 0);
      if (s > score) { score = s; best = b; }
    }
    if (best) this.remove(best);
    return best;
  }

  _writeMatrix(b, t, r) {
    _p.set(t.x, t.y, t.z); _q.set(r.x, r.y, r.z, r.w); _s.set(b.sx * b.shrink, b.sy * b.shrink, b.sz * b.shrink);
    _m.compose(_p, _q, _s);
    b.pool.mesh.setMatrixAt(b.idx, _m); b.pool.dirty = true;
    b.x = t.x; b.y = t.y; b.z = t.z;
  }

  remove(b) {
    if (!b.alive) return;
    if (b.frozen && !this.bulk) this.thaw(b);
    if (b.struct && !b.counted) { b.counted = true; this.structDown++; }
    b.alive = false;
    if (b.ghost) { this.byCollider.delete(b.park.col.handle); this.trash.push(b.park.body); }      // (parked body: taken out later, a few per frame)
    else { this.byCollider.delete(b.collider.handle); this.world.removeRigidBody(b.body); }
    b.pool.release(b.idx);
    this.hot.delete(b);
  }

  heatBlock(b, amount, char = 0.5) {
    if (!b.alive) return;
    b.heat = Math.min(1, Math.max(b.heat, amount));
    b.char = Math.min(1, b.char + amount * char);
    b.pool.seed[b.idx * 4 + 2] = b.char; b.pool.seed[b.idx * 4 + 3] = b.heat; b.pool.seedDirty = true;
    this.hot.add(b);
  }
  // windows go dark once a wall is disturbed
  lightsOut(b) { if (b.lit > 0 && b.alive) { b.lit = 0; b.pool.style[b.idx * 4 + 2] = 0; b.pool.styleDirty = true; } }

  // ---- fracture ------------------------------------------------------------------
  fracture(b, impulseDir = null, speed = 6, hot = 0) {
    if (!b.alive || b.fixed || b.noFracture) return false;
    if (b.frozen) this.thaw(b);
    const big = Math.max(b.sx, b.sy, b.sz);
    if (big < 0.5 || b.gen >= 3) return false;
    if (this.blocks.length > this.maxBodies - 60) return false;
    const t = b.body.translation(), r = b.body.rotation(), lv = b.body.linvel();
    const q0 = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const pieces = [];
    const minCut = b.mat === 'stone' || b.mat === 'ashlar' ? 0.62 : 0.8;
    if (b.shape === 'box') {
      const cut = (len) => (len > minCut ? [rr(0.36, 0.64)] : null);
      const cx = cut(b.sx), cy = cut(b.sy), cz = cut(b.sz);
      const spans = (len, c) => (c ? [[-0.5, c[0] - 0.5], [c[0] - 0.5, 0.5]] : [[-0.5, 0.5]]).map(([a, e]) => [((a + e) / 2) * len, (e - a) * len]);
      for (const [ox, lx] of spans(b.sx, cx)) for (const [oy, ly] of spans(b.sy, cy)) for (const [oz, lz] of spans(b.sz, cz))
        pieces.push({ ox, oy, oz, sx: lx, sy: ly, sz: lz });
    } else if (b.shape === 'cyl') {
      const n = 5, rad = b.sx / 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand();
        for (let h = 0; h < (b.sy > 1.2 ? 2 : 1); h++) {
          const hh = b.sy > 1.2 ? b.sy / 2 : b.sy;
          pieces.push({ ox: Math.cos(a) * rad * 0.5, oy: b.sy > 1.2 ? (h - 0.5) * hh : 0, oz: Math.sin(a) * rad * 0.5, sx: rad, sy: hh * 0.95, sz: rad, rock: b.mat !== 'wood' });
        }
      }
    } else if (b.shape === 'prism') {
      const sl = Math.hypot(b.sx / 2, b.sy), phi = Math.atan2(b.sy, b.sx / 2), th = Math.min(0.28, b.sy * 0.08), half = b.sz > 9;
      for (const s of [-1, 1]) for (const zz of half ? [-0.25, 0.25] : [0]) pieces.push({ ox: s * b.sx / 4, oy: 0, oz: zz * b.sz, sx: sl, sy: th, sz: half ? b.sz / 2 : b.sz, rz: -s * phi, mat: 'roof', col2: true });
      const gt = Math.min(0.42, b.sz * 0.1);
      for (const s of [-1, 1]) pieces.push({ ox: 0, oy: -b.sy * 0.22, oz: s * (b.sz / 2 - gt / 2 - 0.02), sx: b.sx * 0.5, sy: b.sy * 0.5, sz: gt, mat: 'plaster' });
      for (const s of [-1, 0, 1]) pieces.push({ ox: s * b.sx * 0.2, oy: -b.sy * 0.3, oz: 0, sx: 0.2, sy: 0.2, sz: b.sz * 0.85, mat: 'wood' });
    } else if (b.shape === 'pyr') {
      const th = Math.min(0.3, b.sx * 0.12);
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; pieces.push({ ox: Math.cos(a) * b.sx * 0.2, oy: -b.sy * 0.15, oz: Math.sin(a) * b.sx * 0.2, sx: i % 2 ? b.sx * 0.6 : th, sy: b.sy * 0.55, sz: i % 2 ? th : b.sx * 0.6 }); }
      pieces.push({ ox: 0, oy: b.sy * 0.25, oz: 0, sx: b.sx * 0.3, sy: b.sy * 0.4, sz: b.sx * 0.3 });
    } else {
      const n = big > 1.6 ? 6 : 4;
      for (let i = 0; i < n; i++) { randUnit(_v).multiplyScalar(big * 0.22); pieces.push({ ox: _v.x, oy: _v.y, oz: _v.z, sx: b.sx * rr(0.42, 0.62), sy: b.sy * rr(0.42, 0.62), sz: b.sz * rr(0.42, 0.62), rock: true }); }
    }
    if (pieces.length < 2) return false;
    if (pieces.length > this.debrisRoom) return false;       // live play: too much already in motion, it stays in one piece
    this.debrisRoom -= pieces.length;
    const mat = b.mat === 'ice' ? 'ice' : b.shape === 'pyr' ? 'roof' : b.shape === 'prism' ? 'plaster' : b.mat, gen = b.gen + 1, char = b.char, heat = Math.max(b.heat, hot);
    const color = new THREE.Color(); b.pool.mesh.getColorAt(b.idx, color);
    const color2 = new THREE.Color(b.pool.col2[b.idx * 3], b.pool.col2[b.idx * 3 + 1], b.pool.col2[b.idx * 3 + 2]);
    const stoneLike = mat === 'stone' || mat === 'ashlar';
    const house = b.house;
    this.remove(b);
    for (const pc of pieces) {
      _v.set(pc.ox, pc.oy, pc.oz).applyQuaternion(q0);
      const pmax = Math.max(pc.sx, pc.sy, pc.sz);
      const small = pmax < 0.5 || (pmax < 0.95 && gen >= 3);
      const pmat = pc.mat || mat;
      const asRock = pc.rock || (stoneLike && !pc.mat && pmax < 0.75 && rand() < 0.75);
      const out = _p.copy(_v).normalize();
      const vel = { x: lv.x + out.x * speed * rr(0.3, 1) + (impulseDir ? impulseDir.x * speed : 0), y: lv.y + out.y * speed * rr(0.3, 1) + (impulseDir ? impulseDir.y * speed : 0) + speed * 0.15, z: lv.z + out.z * speed * rr(0.3, 1) + (impulseDir ? impulseDir.z * speed : 0) };
      const k = asRock ? 1.25 : 0.97;
      const nb = this.add({
        shape: asRock ? 'rock' : 'box', mat: pmat, x: t.x + _v.x, y: t.y + _v.y, z: t.z + _v.z, sx: pc.sx * k, sy: pc.sy * k, sz: pc.sz * k,
        q: asRock ? q0.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6))) : pc.rz ? q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_s.set(0, 0, 1), pc.rz)) : q0, sleeping: false, vel,
        angvel: { x: rr(-5, 5), y: rr(-5, 5), z: rr(-5, 5) }, gen, rubble: small, life: small ? rr(7, 13) : Infinity, char,
        color: asRock ? null : pc.col2 ? color2 : pmat === 'wood' ? null : color, tint: pmat === 'wood' ? 0.7 : 0.9, style: [0, 0, 0, 1], house,
      });
      if (nb && heat > 0.05) this.heatBlock(nb, heat * rr(0.5, 1), 0.2);
    }
    b.heat = heat;
    this.onFracture?.(t, b, pieces.length);
    return true;
  }

  // small cosmetic debris chunks
  spawnRubble(pos, count, speed, size = 0.25, mat = 'stone', heat = 0, up = 0.6) {
    if (this.live) { if (this.debrisRoom < 500) return; this.debrisRoom -= count; }
    for (let i = 0; i < count; i++) {
      randUnit(_v); _v.y = Math.abs(_v.y) * (1 + up) + up * 0.3; _v.normalize().multiplyScalar(speed * rr(0.35, 1.1));
      const s = size * rr(0.5, 1.5);
      const b = this.add({
        shape: mat === 'wood' ? 'box' : 'rock', mat, x: pos.x + rr(-0.5, 0.5), y: pos.y + rr(0.1, 0.6), z: pos.z + rr(-0.5, 0.5),
        sx: s * rr(0.7, 1.4), sy: s * rr(0.5, 1.1), sz: s * rr(0.7, 1.4), sleeping: false, vel: { x: _v.x, y: _v.y, z: _v.z },
        angvel: { x: rr(-12, 12), y: rr(-12, 12), z: rr(-12, 12) }, rubble: true, life: rr(5, 10), gen: 3, tint: 0.85,
      });
      if (b && heat > 0) this.heatBlock(b, heat * rr(0.4, 1), 0.4);
    }
  }

  // ---- forces --------------------------------------------------------------------
  // Pressure wave: expands at `speed`, kicking bodies as the front passes them.
  explode(pos, radius, strength, opts = {}) {
    this.waves.push({
      x: pos.x, y: pos.y, z: pos.z, r: 0, prev: 0, radius, strength, speed: opts.speed ?? 110, up: opts.up ?? 0.35,
      fracture: opts.fracture ?? 1, heat: opts.heat ?? 0, inward: !!opts.inward, done: false,
    });
  }
  _applyWave(w, dt) {
    w.prev = w.r; w.r = Math.min(w.radius, w.r + w.speed * dt);
    const r0 = w.prev, r1 = w.r, list = this.blocks;
    for (let i = 0, n = list.length; i < n; i++) {
      const b = list[i];
      if (!b.alive || b.fixed) continue;
      const dx = b.x - w.x, dy = b.y - w.y, dz = b.z - w.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= r1 || (d < r0 && r0 > 0)) continue;
      const f = 1 - d / w.radius;
      const fall = f * f * (3 - 2 * f) * 0.6 + f * 0.4;
      const dv = w.strength * fall * clamp(Math.pow(0.9 / Math.max(b.mass, 0.02), 0.3), 0.3, 1.7);
      if (dv < 0.25) continue;
      const inv = 1 / (d + 0.001);
      let nx = dx * inv, ny = dy * inv + w.up, nz = dz * inv;
      if (w.inward) { nx = -nx; ny = -dy * inv + 0.1; nz = -nz; }
      const nl = 1 / Math.hypot(nx, ny, nz); nx *= nl; ny *= nl; nz *= nl;
      if (b.lit > 0) this.lightsOut(b);
      if (w.fracture > 0 && dv * w.fracture > b.frac * (1 + b.gen * 0.6) && rand() < 0.9) {
        _v.set(nx, ny, nz);
        if (this.fracture(b, _v, dv * 0.55, w.heat * fall)) continue;
      }
      const m = b.mass;
      b.body.applyImpulse({ x: nx * dv * m, y: ny * dv * m, z: nz * dv * m }, true);
      const tq = dv * m * 0.22 * Math.max(b.sx, b.sy, b.sz);
      b.body.applyTorqueImpulse({ x: rr(-tq, tq), y: rr(-tq, tq), z: rr(-tq, tq) }, true);
      b.pvx += nx * dv; b.pvy += ny * dv; b.pvz += nz * dv;
      if (w.heat > 0) this.heatBlock(b, w.heat * fall, 0.6);
      if (dv > 2) this.onDestroyed?.(b, dv);
    }
    if (w.r >= w.radius) w.done = true;
  }

  // directional cone shove
  push(origin, dir, range, strength, cosHalf = 0.6) {
    let n = 0;
    for (const b of this.blocks) {
      if (!b.alive || b.fixed) continue;
      _v.set(b.x - origin.x, b.y - origin.y, b.z - origin.z);
      const d = _v.length(); if (d > range) continue;
      _v.multiplyScalar(1 / (d + 1e-3));
      const c = _v.dot(dir); if (c < cosHalf) continue;
      const k = (1 - d / range) * (0.4 + 0.6 * (c - cosHalf) / (1 - cosHalf));
      const dv = strength * k * clamp(Math.pow(0.9 / Math.max(b.mass, 0.02), 0.3), 0.35, 1.6), m = b.mass;
      if (b.lit > 0) this.lightsOut(b);
      if (dv > b.frac * 1.6 * (1 + b.gen * 0.6) && rand() < 0.6) { if (this.fracture(b, dir, dv * 0.5)) { n++; continue; } }
      b.body.applyImpulse({ x: (dir.x * 0.8 + _v.x * 0.2) * dv * m, y: (dir.y * 0.8 + _v.y * 0.2 + 0.22) * dv * m, z: (dir.z * 0.8 + _v.z * 0.2) * dv * m }, true);
      b.pvx += dir.x * dv; b.pvy += dir.y * dv; b.pvz += dir.z * dv;
      this.onDestroyed?.(b, dv); n++;
    }
    return n;
  }

  wakeArea(x, z, r) {
    for (const b of this.blocks) if (b.alive && !b.fixed) { const dx = b.x - x, dz = b.z - z; if (dx * dx + dz * dz < r * r) b.body.wakeUp(); }
  }

  // ---- queries -------------------------------------------------------------------
  raycast(origin, dir, maxDist = 400, solid = true) {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxDist, solid, undefined, this.GROUP_QUERY);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    const block = this.byCollider.get(hit.collider.handle) || null;
    return {
      dist: t, point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), block, terrain: !block,
    };
  }
  blocksInRadius(pos, r, out = []) {
    out.length = 0; const r2 = r * r;
    for (const b of this.blocks) { if (!b.alive || b.fixed) continue; const dx = b.x - pos.x, dy = b.y - pos.y, dz = b.z - pos.z; if (dx * dx + dy * dy + dz * dz < r2) out.push(b); }
    return out;
  }

  // ---- step ----------------------------------------------------------------------
  // The engine's own World.step() also re-synchronises its JavaScript object maps with the simulation on every
  // call, walking every body and collider (twice). With 20,000 colliders that is several milliseconds per frame
  // for nothing: every body here is created and removed through the world's own API, which keeps the maps right.
  _worldStep() {
    const w = this.world;
    if (this.fastStep === undefined) this.fastStep = !!(w.physicsPipeline && w.softBodies && w.mapNewSoftBodies);
    if (this.fastStep) w.physicsPipeline.step(w.gravity, w.integrationParameters, w.islands, w.broadPhase, w.narrowPhase, w.bodies, w.colliders, w.softBodies, w.impulseJoints, w.multibodyJoints, w.ccdSolver, undefined, undefined);
    else w.step();
  }

  // ---- things at rest are static (live play) -------------------------------------
  // A sleeping rigid body still costs the engine something every step, and a city of them is one huge contact
  // island: touch one stone and thousands wake. So in live play nothing is simulated until it has to be:
  //  * every block of the freshly built realm starts as a fixed body. Blocks belong to a group (one house, or
  //    one connected piece of masonry such as the city wall or a tower). The moment anything tries to move a
  //    block, or something heavy flies at it, its whole group turns dynamic; when the group has come to rest
  //    again its blocks turn back into fixed bodies where they stand.
  //  * loose debris turns fixed as soon as it has come to rest, and dynamic again when it is pushed or when
  //    whatever it was lying on goes away.
  _fix(b, fresh = true) {
    let body = b.body;
    if (fresh) {
      // The engine never takes a body off its list of active bodies when it is switched to fixed (thousands of them
      // pile up there after a big spell), and it keeps a contact pair for everything the block ever touched.
      // A brand-new fixed body with a new collider has neither problem.
      const t = body.translation(), r = body.rotation();
      for (const k of THAW_ON) delete body[k];
      this.byCollider.delete(b.collider.handle);
      // (taking a body out of the engine costs about 0.3 ms, so the old one is switched off now and removed later, a few per frame)
      b.collider.setCollisionGroups(0); body.setLinvel(ZERO3, false); body.setAngvel(ZERO3, false);
      body.setBodyType(RAPIER.RigidBodyType.Fixed, false); this.trash.push(body);
      body = b.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(t.x, t.y, t.z).setRotation(r).setLinearDamping(0.02).setAngularDamping(0.12));
      if (b.still) body.setAdditionalSolverIterations(4);
      b.collider = this.world.createCollider(b.desc, body);
      this.byCollider.set(b.collider.handle, b);
    } else {
      body.setLinvel(ZERO3, false); body.setAngvel(ZERO3, false);
      body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
    }
    b.frozen = true; b.rest = 0; b.wasAwake = false; b.pvx = b.pvy = b.pvz = 0;
    body.__blk = b;
    for (const k of THAW_ON) body[k] = THAW_FN[k];           // any attempt to move it thaws it first
  }
  freeze(b) {                                                  // a piece of debris that has come to rest
    if (b.frozen || !b.alive || b.fixed) return;
    this._fix(b); this.frozen.push(b);
  }
  _thawOne(b) {
    const body = b.body;
    for (const k of THAW_ON) delete body[k];
    b.frozen = false; b.rest = 0; b.wasAwake = true;
    if (!b.alive) return;
    if (this.realDyn >= REAL_MAX) { this._ghost(b); return; }     // enough is being simulated in full already
    this.realDyn++;
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  }
  _ghost(b) {
    const body = b.body, col = b.collider;
    b.body = new GhostBody(b, body); b.ghost = true; b.wasAwake = true; b.gr = 0.5 * Math.min(b.sx, b.sy, b.sz);
    // its real body stays parked where it was, static and touching nothing, until the ghost lands
    b.park = { body, col, groups: col.collisionGroups() };
    col.setCollisionGroups(0);
    if (!body.isFixed()) { body.setLinvel(ZERO3, false); body.setAngvel(ZERO3, false); body.setBodyType(RAPIER.RigidBodyType.Fixed, false); }
    b.collider = null;
  }
  // back to a static block, where it lies
  _land(b) {
    const g = b.body;
    const { body, col, groups } = b.park; b.park = null;
    body.setTranslation(g.p, false); body.setRotation(g.q, false); col.setCollisionGroups(groups);
    b.body = body; b.collider = col;
    b.ghost = false; b.frozen = true; b.rest = 0; b.wasAwake = false; b.pvx = b.pvy = b.pvz = 0;
    body.__blk = b; for (const k of THAW_ON) body[k] = THAW_FN[k];
    this.frozen.push(b);
  }
  _ghostStep(b, dt, mayLand) {
    const g = b.body, p = g.p, v = g.v, w = g.w, q = g.q;
    v.y -= GRAVITY * g.gs * dt;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    const hx = w.x * dt * 0.5, hy = w.y * dt * 0.5, hz = w.z * dt * 0.5, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    q.x = qx + hx * qw + hy * qz - hz * qy; q.y = qy + hy * qw + hz * qx - hx * qz; q.z = qz + hz * qw + hx * qy - hy * qx; q.w = qw - hx * qx - hy * qy - hz * qz;
    const l = 1 / Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w); q.x *= l; q.y *= l; q.z *= l; q.w *= l;
    if (Math.abs(p.x) > 620 || Math.abs(p.z) > 620 || p.y < -80) { this.remove(b); return false; }
    let landed = false;
    const gy = G.terrain.heightAt(p.x, p.z) + b.gr;
    if (p.y < gy) {
      p.y = gy;
      if (v.y < -4) { v.y *= -0.2; v.x *= 0.6; v.z *= 0.6; w.x *= 0.5; w.y *= 0.5; w.z *= 0.5; }
      else {
        v.y = 0; const k = Math.max(0, 1 - 7 * dt); v.x *= k; v.z *= k; w.x *= k; w.y *= k; w.z *= k;
        if (mayLand && !b.held && g.gs > 0 && v.x * v.x + v.z * v.z < 0.6) landed = true;
      }
    }
    this._writeMatrix(b, p, q);
    if (!b.loose && b.gen === 0 && !b.rubble) {
      const ex = p.x - b.ox, ey = p.y - b.oy, ez = p.z - b.oz;
      if (ex * ex + ey * ey + ez * ez > 2.0) { b.loose = true; b.still = false; if (b.struct && !b.counted) { b.counted = true; this.structDown++; } }
    }
    if (landed) this._land(b);
    return landed;
  }
  thaw(b) {
    if (!b.frozen) return;
    this._thawOne(b);
    const g = b.grp; if (g && b.still) this._wakeGroup(g);          // (also when the group is already awake: some of it may have settled)
  }
  _wakeGroup(g) {
    g.awake = true; g.t = 0; this.awakeGroups.add(g);
    for (const m of g.members) if (m.alive && m.frozen && m.still) { if (this.realDyn >= REAL_MAX) { g.partial = true; break; } this._thawOne(m); }
  }
  // groups near a point (a heavy piece of debris about to hit, a blast...) turn dynamic
  wakeNear(x, y, z, r) {
    const H = this.groupHash; if (!H) return;
    const c0 = Math.floor((x - r) / GCELL), c1 = Math.floor((x + r) / GCELL), d0 = Math.floor((y - r) / GCELL), d1 = Math.floor((y + r) / GCELL), e0 = Math.floor((z - r) / GCELL), e1 = Math.floor((z + r) / GCELL);
    for (let cx = c0; cx <= c1; cx++) for (let cy = d0; cy <= d1; cy++) for (let cz = e0; cz <= e1; cz++) {
      const list = H.get(gkey(cx, cy, cz)); if (!list) continue;
      for (const g of list) if (!g.awake) this._wakeGroup(g);
    }
  }
  // Called around a (re)build of the realm: everything created in between starts fixed, and is then sorted into groups.
  beginStatic() { for (const body of this.trash) this.world.removeRigidBody(body); this.trash = []; this.realDyn = 0; this.ghosts = 0; this.buildFrozen = this.live; this.groups = []; this.awakeGroups = new Set(); this.groupHash = null; this.frozen = []; }
  endStatic() {
    if (!this.buildFrozen) return;
    this.buildFrozen = false;
    const t0 = performance.now(), still = this.blocks.filter((b) => b.alive && b.still);
    // world-space bounding boxes
    const q = new THREE.Quaternion(), m = new THREE.Matrix4();
    for (const b of still) {
      const r = b.body.rotation(); q.set(r.x, r.y, r.z, r.w); m.makeRotationFromQuaternion(q); const e = m.elements, hx = b.sx / 2, hy = b.sy / 2, hz = b.sz / 2;
      b.ax = Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz; b.ay = Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz; b.az = Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz;
    }
    // a house is a group; everything else is grouped by what it touches
    const byHouse = new Map(), free = [];
    for (const b of still) { if (b.house >= 0) { let g = byHouse.get(b.house); if (!g) byHouse.set(b.house, (g = { members: [], awake: false, t: 0 })); g.members.push(b); b.grp = g; } else free.push(b); }
    const parent = new Int32Array(free.length).map((_, i) => i), find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const cells = new Map(), EPS = 0.08;
    free.forEach((b, i) => {
      for (let cx = Math.floor((b.x - b.ax - EPS) / GCELL); cx <= Math.floor((b.x + b.ax + EPS) / GCELL); cx++) for (let cy = Math.floor((b.y - b.ay - EPS) / GCELL); cy <= Math.floor((b.y + b.ay + EPS) / GCELL); cy++) for (let cz = Math.floor((b.z - b.az - EPS) / GCELL); cz <= Math.floor((b.z + b.az + EPS) / GCELL); cz++) {
        const k = gkey(cx, cy, cz); let list = cells.get(k); if (!list) cells.set(k, (list = []));
        for (const j of list) { const o = free[j]; if (Math.abs(o.x - b.x) < o.ax + b.ax + EPS && Math.abs(o.y - b.y) < o.ay + b.ay + EPS && Math.abs(o.z - b.z) < o.az + b.az + EPS) { const a = find(i), c = find(j); if (a !== c) parent[a] = c; } }
        list.push(i);
      }
    });
    const comp = new Map();
    free.forEach((b, i) => { const r = find(i); let g = comp.get(r); if (!g) comp.set(r, (g = { members: [], awake: false, t: 0 })); g.members.push(b); b.grp = g; });
    // a long structure is cut into stretches, so that hitting one end of the city wall does not wake all of it
    const pieces = [];
    for (const g of comp.values()) {
      if (g.members.length <= 90) { pieces.push(g); continue; }
      const cut = new Map();
      for (const b of g.members) { const k = Math.floor(b.x / 14) * 4096 + Math.floor(b.z / 14); let p = cut.get(k); if (!p) cut.set(k, (p = { members: [], awake: false, t: 0 })); p.members.push(b); b.grp = p; }
      pieces.push(...cut.values());
    }
    this.groups = [...byHouse.values(), ...pieces];
    // where each group is, for wakeNear()
    const H = this.groupHash = new Map();
    for (const g of this.groups) for (const b of g.members) {
      for (let cx = Math.floor((b.x - b.ax) / GCELL); cx <= Math.floor((b.x + b.ax) / GCELL); cx++) for (let cy = Math.floor((b.y - b.ay) / GCELL); cy <= Math.floor((b.y + b.ay) / GCELL); cy++) for (let cz = Math.floor((b.z - b.az) / GCELL); cz <= Math.floor((b.z + b.az) / GCELL); cz++) {
        const k = gkey(cx, cy, cz); let list = H.get(k); if (!list) H.set(k, (list = [])); if (list[list.length - 1] !== g && !list.includes(g)) list.push(g);
      }
    }
    let big = 0; for (const g of this.groups) if (g.members.length > big) big = g.members.length;
    console.log(`[game] static realm: ${still.length} blocks in ${this.groups.length} groups (largest ${big}) in ${(performance.now() - t0).toFixed(0)} ms`);
  }
  // groups that have come to rest go back to being fixed
  _settleGroups(dt) {
    let rays = 250;                                              // support checks are spread over frames
    for (const g of this.awakeGroups) {
      g.t += dt; if (g.t < 0.5) continue;
      if (g.partial) { if (rays <= 0) { g.t = 0.45; continue; } rays -= g.members.length; }
      g.t = 0;
      let moving = false, dropped = false;
      for (const m of g.members) {
        if (!m.alive || !m.still) continue;
        if (!m.frozen) { if (!m.ghost && m.body.isSleeping() && !m.held) this._fix(m); else moving = true; }
        else if (g.partial && !this._supported(m, m.body.translation())) { this.thaw(m); dropped = true; }      // nothing left under it
      }
      if (!moving && !dropped) { g.awake = false; g.partial = false; this.awakeGroups.delete(g); }
    }
  }
  // is this piece lying on something?
  _supported(b, t) {
    const ray = this.ray || (this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
    ray.origin.x = t.x; ray.origin.y = t.y; ray.origin.z = t.z;
    return !!this.world.castRay(ray, 0.5 * Math.max(b.sx, b.sy, b.sz) + 0.35, true, undefined, this.GROUP_QUERY, undefined, b.body);
  }
  // a few frozen pieces of debris per frame: is there still something under you?
  _supportSweep() {
    const F = this.frozen, now = G.time; let n = Math.min(F.length, 140);
    while (n-- > 0 && F.length) {
      if (this.fzI >= F.length) this.fzI = 0;
      const b = F[this.fzI];
      if (!b.alive || !b.frozen) { F[this.fzI] = F[F.length - 1]; F.pop(); continue; }
      this.fzI++;
      const t = b.body.translation();
      const ray = this.ray || (this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
      ray.origin.x = t.x; ray.origin.y = t.y; ray.origin.z = t.z;
      if (!this.world.castRay(ray, 0.5 * Math.max(b.sx, b.sy, b.sz) + 0.3, true, undefined, this.GROUP_QUERY, undefined, b.body)) { this.thaw(b); b.nofz = now + 1.5; }
    }
  }

  step(dt) {
    if (dt <= 0) return;
    this.acc = (this.acc || 0) + dt;
    if (this.acc < 0.0035) return;
    dt = this.acc; this.acc = 0;
    const live = this.live;
    // Intact masonry is solved with 6 iterations (2 + 4 extra per body, see add()); islands made only of loose
    // debris get 2, which is a third of the work. While recording everything gets 6, as before.
    this.world.numSolverIterations = live ? 2 : 6;
    // live play: how many new pieces this frame may still create before the simulation is overloaded
    this.debrisRoom = live ? Math.max(0, this.budget * 0.8 - this.stats.awake) : Infinity;
    for (const w of this.waves) this._applyWave(w, dt);
    if (this.waves.length) this.waves = this.waves.filter((w) => !w.done);
    this.world.timestep = Math.min(dt, 1 / 30);
    const t0 = live ? performance.now() : 0;
    this._worldStep();
    if (live) {
      // keep the simulation inside its time budget: fewer pieces in motion on a slower machine, more on a faster one
      const ms = performance.now() - t0; this.stepMs += (ms - this.stepMs) * 0.12;
      if (this.stepMs > STEP_TARGET_MS) this.budget = Math.max(BUDGET_MIN, Math.min(this.budget, this.stats.awake + 400) - (this.stepMs / STEP_TARGET_MS - 1) * 40);
      else if (this.stepMs < STEP_TARGET_MS * 0.75) this.budget = Math.min(BUDGET_MAX, this.budget + 10);
    }
    this.impactBudget = Math.min(6, this.impactBudget + dt * 40);
    if (this.growing.length) {
      for (const g of this.growing) { g.t += dt; const s = g.t <= 0 ? 0.001 : Math.min(1, g.t / g.dur); g.b.shrink = s >= 1 ? 1 : Math.max(0.001, s * s * (3 - 2 * s)); if (s >= 1 && g.b.alive) { this._writeMatrix(g.b, g.b.body.translation(), g.b.body.rotation()); g.done = true; } }
      this.growing = this.growing.filter((g) => !g.done && g.b.alive);
    }
    const list = this.blocks; let awake = 0, dead = 0;
    const e = G.player?.pos, ex0 = e ? e.x : 0, ez0 = e ? e.z : 0;
    // live play only (never while recording): once the realm is buried in debris, quietly retire settled
    // fragments that are far from the player so the frame rate holds up over a long session
    if (!this.liveCap) this.liveCap = list.length + 6000;        // the freshly built realm plus a generous debris allowance
    if (live && list.length > this.liveCap) {
      for (let j = 0, k = 0; j < 500 && k < 14; j++) {
        const b = list[(this.sweepI = ((this.sweepI || 0) + 1) % list.length)];
        if (!b.alive || b.fixed || b.held || b.life !== Infinity || !(b.gen > 0) || !(b.frozen || b.body.isSleeping())) continue;
        if ((b.x - ex0) * (b.x - ex0) + (b.z - ez0) * (b.z - ez0) < 4900) continue;
        b.life = 0.5; k++;
      }
    }
    // live play: when far more pieces are in motion than the machine can simulate smoothly, thin the cloud out,
    // furthest pieces first (fragments, and under extreme load blocks that have been blown loose)
    for (let k = 0; k < TRASH_PER_FRAME && this.trash.length; k++) this.world.removeRigidBody(this.trash.pop());
    let ghostN = 0, landed = 0;
    // with thousands of ghosts in the air, each one is moved every second or third frame (with a longer step)
    const gskip = this.ghosts > 3500 ? 3 : this.ghosts > 1500 ? 2 : 1, gphase = G.frame % gskip;
    const over = live ? this.realDyn - this.budget : 0;
    const pKill = over > 0 ? Math.min(0.7, (over / this.stats.awake) * dt * 6) : 0;
    // (the further over its time budget the step is, the sooner tumbling pieces are stopped)
    const slow = 0.6 + Math.min(2.6, (Math.max(0, over) / this.budget) * 3) + Math.min(3.5, Math.max(0, this.stepMs / STEP_TARGET_MS - 1.5)), slow2 = slow * slow, restFor = over > 0 ? 0.3 : 1.0;
    const now = G.time;
    for (let i = 0, n = list.length; i < n; i++) {
      const b = list[i];
      if (!b.alive) { dead++; continue; }
      if (b.fixed) continue;
      if (b.life !== Infinity) {
        b.life -= dt;
        if (b.life < 0.5) { b.shrink = Math.max(0, b.life / 0.5); if (b.life <= 0) { this.remove(b); continue; } }
      }
      if (b.ghost) { ghostN++; if (gskip > 1 && i % gskip !== gphase) continue; if (this._ghostStep(b, dt * gskip, landed < LAND_PER_FRAME)) landed++; continue; }
      const sleeping = b.frozen || b.body.isSleeping();
      if (sleeping && !b.wasAwake && b.shrink === 1) continue;
      b.wasAwake = !sleeping;
      awake++;
      const t = b.body.translation();
      if (t.y < -80 || Math.abs(t.x) > 620 || Math.abs(t.z) > 620) { this.remove(b); continue; }
      this._writeMatrix(b, t, b.body.rotation());
      if (!b.loose && b.gen === 0 && !b.rubble) {
        const ex = t.x - b.ox, ey = t.y - b.oy, ez = t.z - b.oz;
        if (ex * ex + ey * ey + ez * ez > 2.0) {
          b.loose = true; b.still = false;                        // knocked out of its building: from now on it is debris
          if (live) b.body.setAdditionalSolverIterations(0);
          if (b.struct && !b.counted) { b.counted = true; this.structDown++; }
        }
      }
      if (sleeping) continue;
      // impact detection from sudden velocity change
      const v = b.body.linvel();
      const ax = v.x - b.pvx, ay = v.y - b.pvy + GRAVITY * dt, az = v.z - b.pvz;
      const dv = Math.sqrt(ax * ax + ay * ay + az * az);
      b.pvx = v.x; b.pvy = v.y; b.pvz = v.z;
      if (dv > 4.5 && G.time - b.spawnT > 0.08 && !b.held) {
        if (b.lit > 0) this.lightsOut(b);
        if (dv > b.frac * 1.7 * (1 + b.gen * 0.5) && !b.rubble && this.fracture(b, null, dv * 0.18)) continue;
        if (this.impactBudget >= 1 && this.onImpact) { this.impactBudget -= 1; this.onImpact(b, dv); }
      }
      if (live && this.groupHash && ((i ^ G.frame) & 1) === 0) {
        const sp2 = v.x * v.x + v.y * v.y + v.z * v.z;
        if (sp2 > 6.25 && b.mass * Math.sqrt(sp2) > 5) this.wakeNear(t.x + v.x * 0.07, t.y + v.y * 0.07, t.z + v.z * 0.07, 0.5 * Math.max(b.sx, b.sy, b.sz) + 1.0);
      }
      if (live && b.still && !b.held) {
        // a block of a woken structure that has not moved for a second goes back to being part of the scenery
        if (v.x * v.x + v.y * v.y + v.z * v.z < 0.0025) { const w = b.body.angvel(); if (w.x * w.x + w.y * w.y + w.z * w.z < 0.01) { b.rest = (b.rest || 0) + dt; if (b.rest > restFor) this._fix(b); } else b.rest = 0; } else b.rest = 0;
      }
      if (live && !b.held && (b.gen > 0 || b.loose || b.rubble)) {
        // stuck debris (wedged and vibrating, never coming to rest): if it has gone nowhere in two seconds, freeze it too
        b.jt = (b.jt || 0) + dt;
        if (b.jt > 2) { const jx = t.x - (b.jx ?? 1e9), jy = t.y - (b.jy ?? 1e9), jz = t.z - (b.jz ?? 1e9); b.jt = 0; b.jx = t.x; b.jy = t.y; b.jz = t.z; if (jx * jx + jy * jy + jz * jz < 0.09 && !(b.nofz > now) && now - (b.wetT || -9) > 0.3) { this.freeze(b); continue; } }
        if (v.x * v.x + v.y * v.y + v.z * v.z < 0.05) {
          const w = b.body.angvel();
          if (w.x * w.x + w.y * w.y + w.z * w.z < 0.3 && !(b.nofz > now) && now - (b.wetT || -9) > 0.3) { b.rest = (b.rest || 0) + dt; if (b.rest > 0.55) this.freeze(b); } else b.rest = 0;
        } else {
          b.rest = 0;
          if (over > 0) {
            // overloaded: whatever has nearly stopped and is lying on something is frozen where it is (it stays as rubble)...
            if (v.x * v.x + v.y * v.y + v.z * v.z < slow2 && !(b.nofz > now) && now - (b.wetT || -9) > 0.3 && this._supported(b, t)) { this.freeze(b); continue; }
            // ...and only small fragments are retired, the furthest first
            if (pKill > 0 && b.life === Infinity && (b.rubble || b.gen >= 2)) {
              const dx = t.x - ex0, dz = t.z - ez0, far = Math.min(4, Math.max(0.2, (dx * dx + dz * dz) / 3600));
              if (rand() < pKill * far) b.life = 0.45;
            }
          }
        }
      }
    }
    if (live && awake > 0 && this.frozen.length) this._supportSweep();
    if (live && this.awakeGroups.size) this._settleGroups(dt);
    if (this.hot.size) {
      const k = Math.exp(-dt * 0.55);
      for (const b of this.hot) {
        b.heat = b.heat * k - dt * 0.012;
        if (b.heat <= 0.004) { b.heat = 0; this.hot.delete(b); }
        b.pool.seed[b.idx * 4 + 3] = b.heat; b.pool.seedDirty = true;
      }
    }
    if (dead > 1500) this.blocks = list.filter((b) => b.alive);
    for (const p of Object.values(this.pools)) p.flush();
    this.realDyn = awake; this.ghosts = ghostN;
    this.stats.awake = awake + ghostN; this.stats.alive = list.length - dead;
  }
}
