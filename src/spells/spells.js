// The archmage's grimoire. Every spell acts on the world through the physics engine.
import * as THREE from 'three';
import { G, LAYER_FX } from '../core/globals.js';
import { rand, rr, randUnit, clamp, sat, lerp, damp, easeOutCubic } from '../core/util.js';
import { FX_DEPTH_GLSL } from '../render/post.js';
import { K_PUFF, K_STREAK, K_DOT, K_RING } from '../fx/particles.js';
import { X } from './spells2.js';

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _d = V(), _col = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
export const SPELLS = [
  { id: 'inferno', name: 'INFERNO ORB', key: '1', color: new THREE.Color(1.0, 0.42, 0.1) },
  { id: 'lightning', name: 'CHAIN LIGHTNING', key: '2', color: new THREE.Color(0.35, 0.62, 1.0) },
  { id: 'singularity', name: 'SINGULARITY', key: '3', color: new THREE.Color(0.62, 0.28, 1.0) },
  { id: 'starfall', name: 'STARFALL', key: '4', color: new THREE.Color(1.0, 0.62, 0.22) },
  { id: 'ray', name: 'ANNIHILATION RAY', key: '5', color: new THREE.Color(1.0, 0.25, 0.6) },
  { id: 'earthshatter', name: 'EARTHSHATTER', key: '6', color: new THREE.Color(1.0, 0.5, 0.18) },
  { id: 'dragon', name: "DRAGON'S BREATH", key: '7', color: new THREE.Color(1.0, 0.36, 0.08) },
  { id: 'eruption', name: 'ERUPTION', key: '8', color: new THREE.Color(1.0, 0.3, 0.05) },
  { id: 'winter', name: "WINTER'S GRASP", key: '9', color: new THREE.Color(0.55, 0.82, 1.0) },
  { id: 'tempest', name: 'TEMPEST', key: '0', color: new THREE.Color(0.7, 0.78, 0.85) },
  // ---- page two: dominion over the world
  { id: 'rise', name: 'STONESHAPE: RISE', key: '1', color: new THREE.Color(0.95, 0.75, 0.4) },
  { id: 'abyss', name: 'STONESHAPE: ABYSS', key: '2', color: new THREE.Color(0.6, 0.35, 0.9) },
  { id: 'deluge', name: 'DELUGE', key: '3', color: new THREE.Color(0.3, 0.65, 1.0) },
  { id: 'bloom', name: 'VERDANT BLOOM', key: '4', color: new THREE.Color(0.4, 1.0, 0.4) },
  { id: 'monolith', name: 'MONOLITH', key: '5', color: new THREE.Color(0.45, 0.9, 1.0) },
  { id: 'ascension', name: 'ASCENSION', key: '6', color: new THREE.Color(0.7, 0.45, 1.0) },
  { id: 'chrono', name: 'CHRONOSTASIS', key: '7', color: new THREE.Color(0.6, 0.85, 1.0) },
  { id: 'storm', name: 'THUNDERSTORM', key: '8', color: new THREE.Color(0.55, 0.7, 1.0) },
  { id: 'eclipse', name: 'ECLIPSE', key: '9', color: new THREE.Color(0.75, 0.55, 1.0) },
  { id: 'restoration', name: 'RESTORATION', key: '0', color: new THREE.Color(1.0, 0.88, 0.5) },
];
export const SPELL_INDEX = Object.fromEntries(SPELLS.map((s, i) => [s.id, i]));
export const EXTRA = {
  force: { name: 'FORCE BLAST', key: 'F', color: new THREE.Color(0.75, 0.9, 1.0) },
  tk: { name: 'TELEKINESIS', key: 'RMB', color: new THREE.Color(0.3, 1.0, 0.8) },
  cataclysm: { name: 'CATACLYSM', key: 'Q', color: new THREE.Color(1.0, 0.8, 0.45) },
  blink: { name: 'BLINK', key: 'G', color: new THREE.Color(0.6, 0.8, 1.0) },
  fly: { name: 'SKYWALK', key: 'V', color: new THREE.Color(0.9, 0.95, 1.0) },
};

// black hole: event horizon (true black, photon ring) + accretion disc
const HOLE_VS = /* glsl */ `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const HOLE_FS = /* glsl */ `
precision highp float; ${FX_DEPTH_GLSL}
uniform vec3 uColor; uniform float uAlpha;
varying vec3 vN; varying vec3 vV;
void main(){
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float ring = pow(f, 5.0) * 9.0 + pow(f, 1.6) * 0.5;
  float a = softFade(0.3) * uAlpha;
  gl_FragColor = vec4((uColor * ring + vec3(1.0, 0.9, 0.8) * pow(f, 12.0) * 14.0) * a, a);
}`;
const DISC_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DISC_FS = /* glsl */ `
precision highp float; ${FX_DEPTH_GLSL}
uniform vec3 uColor; uniform float uAlpha, uTime; uniform sampler2D tNoise;
varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float a = atan(p.y, p.x);
  float sw = a / 6.2831853 + uTime * 0.35 / max(r, 0.15) * 0.25 + 1.6 / (r + 0.25);
  float n = texture2D(tNoise, vec2(sw * 2.0, r * 1.7 - uTime * 0.06)).r;
  float n2 = texture2D(tNoise, vec2(sw * 5.0 + 0.3, r * 4.0)).g;
  float band = smoothstep(0.26, 0.36, r) * smoothstep(1.0, 0.55, r);
  float streak = pow(n, 1.6) * 1.8 + n2 * 0.5;
  vec3 hot = mix(vec3(1.0, 0.85, 0.6) * 5.0, uColor * 2.2, smoothstep(0.3, 0.8, r));
  gl_FragColor = vec4(hot * streak * band * uAlpha * softFade(0.4), 1.0);
}`;

export class Spells {
  constructor() {
    this.sel = 0; this.cool = {}; this.charge = 0; this.firing = false; this.prevFire = false; this.prevAlt = false;
    this.projectiles = []; this.holes = []; this.meteors = []; this.aimHit = null;
    this.banner = { text: '', t: 0, color: SPELLS[0].color };
    this.ray = { on: false, t: 0, hitT: 0, trenchT: 0, light: null, light2: null };
    this.lt = { on: false, tick: 0, light: null };
    this.tk = { on: false, blocks: [], dist: 8, bolt: null, t: 0 };
    this.cata = null; this.star = { on: false, n: 1 }; this.orbLight = null; this.idleT = 0;
    this.freeUlt = false; this.x = {}; this.page = 0;
    const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
    const PRE = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };
    const mk = (geo, vs, fs, blend, extra = {}) => { const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false, ...blend, uniforms: { ...G.fxU, uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, tNoise: { value: G.noiseTex } }, ...extra })); m.visible = false; m.frustumCulled = false; m.layers.set(LAYER_FX); G.scene.add(m); return m; };
    this.holeMesh = mk(new THREE.SphereGeometry(1, 40, 20), HOLE_VS, HOLE_FS, PRE); this.holeMesh.renderOrder = 30;
    this.discMesh = mk(new THREE.PlaneGeometry(2, 2), DISC_VS, DISC_FS, ADD, { side: THREE.DoubleSide }); this.discMesh.renderOrder = 29;
  }

  // ---------------------------------------------------------------- helpers
  aim(max = 260) {
    const pl = G.player, o = pl.eye, d = pl.forward;
    const hit = G.physics.raycast(o, d, max);
    if (hit) return hit;
    return { point: V().copy(o).addScaledVector(d, max), normal: V().set(0, 1, 0), block: null, terrain: false, dist: max, miss: true };
  }
  say(sp) { this.banner.text = sp.name; this.banner.t = 2.2; this.banner.color = sp.color; }
  ready(id) { return (this.cool[id] || 0) <= 0; }
  get current() { return SPELLS[this.sel]; }

  onEvent(e) {
    if (e.type === 'select') this.select(this.page * 10 + e.i);
    else if (e.type === 'page') { this.page = 1 - this.page; this.select(this.page * 10 + (this.sel % 10), true); }
    else if (e.type === 'cycle') this.select((this.sel + e.dir + SPELLS.length) % SPELLS.length);
    else if (e.type === 'cast' && e.name === 'force') this.force();
    else if (e.type === 'cast' && e.name === 'blink') this.blink();
    else if (e.type === 'cast' && e.name === 'fly') this.fly();
    else if (e.type === 'cast' && e.name === 'cataclysm') this.cataclysm();
    else if (e.type === 'reset') { G.world.reset(); G.water?.reset(); G.score = 0; }
    else if (e.type === 'hud') G.hud && (G.hud.visible = !G.hud.visible);
    else if (e.type === 'cam') {
      G.setCam(G.cam.mode === 'steady' ? 'cinematic' : 'steady');
      try { localStorage.setItem('archmage.cam', G.cam.mode); } catch (err) { /* no storage */ }
      this.say({ name: G.cam.mode === 'steady' ? 'STEADY CAMERA' : 'CINEMATIC CAMERA', color: new THREE.Color(0.8, 0.85, 1) });
    }
  }
  select(i, force = false) {
    if ((i === this.sel && !force) || this.firing || this.cata) return;
    this.page = Math.floor(i / 10);
    this._release(true);
    this.sel = i; this.say(SPELLS[i]);
    G.hand.setGlow(SPELLS[i].color, 0.35); G.hand.kick(0, -0.25, 0.15, -0.6, 0, 0);
    G.audio?.play('select', { i });
    G.fx.motes(G.hand.palm, 14, 0.06, 0.5, [SPELLS[i].color.r * 5, SPELLS[i].color.g * 5, SPELLS[i].color.b * 5], 0.6, 0.02, -0.05);
  }

  // ---------------------------------------------------------------- main update
  update(dt) {
    const inp = G.input, fire = inp.fireHeld && !this.cata, alt = inp.altHeld && !this.cata;
    const cdt = G.castDt ?? dt;
    for (const k in this.cool) this.cool[k] = Math.max(0, this.cool[k] - cdt);
    this.banner.t = Math.max(0, this.banner.t - G.realDt);
    const id = this.current.id;
    if (fire && !this.prevFire && this.ready(id) && !this.tk.on) this._press(id);
    if (fire && this.firing) this._hold(id, cdt);
    if (!fire && this.prevFire && this.firing) this._release(false);
    this.prevFire = fire;
    if (alt && !this.prevAlt && !this.firing) this.tkGrab();
    if (!alt && this.prevAlt && this.tk.on) this.tkThrow();
    this.prevAlt = alt;
    if (this.tk.on) this.tkUpdate(dt);
    this.updateProjectiles(dt); this.updateHoles(dt); this.updateMeteors(dt); this.updateCataclysm(dt);
    for (const k in X) X[k].update?.(this, dt);
    if (G.player.fly) this._flyFx(dt);
    if (!this.firing && !this.tk.on && !this.cata) {
      this.idleT += dt;
      if (this.idleT > 0.5 && G.hand.pose !== 'idle') { G.hand.setPose('idle'); G.hand.setSpeed(5.5); G.hand.trembleTarget = 0; G.hand.setGlow(this.current.color, 0.2); }
    } else this.idleT = 0;
  }

  _press(id) {
    this.firing = true; this.charge = 0;
    if (X[id]) { X[id].press(this); return; }
    const H = G.hand, c = this.current.color;
    if (id === 'inferno') { H.setPose('cup'); H.setSpeed(7); H.setGlow(c, 0.7); this.orbLight = G.fx.light(H.palm, c, 0, 5, 1, { hold: true, flicker: 0.25, follow: H.palm }); G.audio?.loop('charge', 'fire_roar', { vol: 0.05, rate: 0.7, fade: 0.2 }); }
    else if (id === 'lightning') { H.setPose('claw'); H.setSpeed(9); H.setGlow(c, 1.2); H.trembleTarget = 1; this.lt.on = true; this.lt.tick = 0; this.lt.light = G.fx.light(H.palm, c, 2.2, 8, 1, { hold: true, flicker: 0.6, follow: H.palm }); G.audio?.loop('arc', 'electric_loop', { vol: 0.9, rate: 1.0, fade: 0.08 }); G.audio?.play('thunder', { vol: 0.5 }); this.say(this.current); }
    else if (id === 'singularity') { H.setPose('fist'); H.setSpeed(6); H.setGlow(c, 1.0); H.trembleTarget = 0.5; G.audio?.loop('charge', 'drone2', { vol: 0.5, rate: 1.2, fade: 0.3 }); }
    else if (id === 'starfall') { H.setPose('point'); H.setSpeed(6); H.setGlow(c, 0.9); this.star.on = true; this.star.n = 1; G.audio?.play('star_cast'); this.say(this.current); }
    else if (id === 'ray') { H.setPose('ray'); H.setSpeed(8); H.setGlow(c, 1.3); H.trembleTarget = 0.4; this.ray.on = true; this.ray.t = 0; G.audio?.play('ray_start'); this.say(this.current); }
  }

  _hold(id, dt) {
    const H = G.hand, fx = G.fx, P = fx.P, c = this.current.color;
    if (X[id]) { this.charge = Math.min(1, this.charge + dt / 2.2); X[id].hold?.(this, dt); return; }
    this.charge = Math.min(1, this.charge + dt / (id === 'starfall' ? 2.4 : id === 'singularity' ? 1.0 : 1.25));
    const ch = this.charge;
    if (id === 'inferno') {
      // a growing ball of fire hovering over the upturned palm
      _a.copy(H.palm).addScaledVector(H.palmNormal, 0.07 + ch * 0.05);
      const r = 0.026 + ch * 0.05;
      fx.setOrb(0, _a, r * 1.15);
      fx.glow(_a, r * 4.5, [1.5, 0.5, 0.1], 0.06, 0.7); fx.glow(_a, r * 1.2, [4, 2.2, 0.8], 0.05, 0.8);
      for (let i = 0; i < 3; i++) { randUnit(_b).multiplyScalar(r * 0.7); P.spawn(_a.x + _b.x, _a.y + _b.y, _a.z + _b.z, _b.x * 1.5, 0.12 + rand() * 0.3, _b.z * 1.5, rr(0.14, 0.3), r * 1.3, r * 0.4, 4, 1.2, 0.2, 0.9, 1.2, 0.12, 0.01, 0, 2, -0.3, K_PUFF, 0.12, 1, rr(-3, 3), 0.03, 0.1); }
      if (rand() < 0.5) fx.implode(_a, 1, 0.35, [12, 5, 1], 0.35, 0.012, K_STREAK, 2);
      if (this.orbLight) this.orbLight.userData.base = 0.3 + ch * 1.6;
      H.trembleTarget = ch * 0.5; H.setGlow(c, 0.6 + ch);
      G.audio?.setLoop('charge', { vol: 0.08 + ch * 0.3, rate: 0.7 + ch * 0.5 });
    } else if (id === 'lightning') this._lightningTick(dt);
    else if (id === 'singularity') {
      _a.copy(H.palm).addScaledVector(H.fingerDir, 0.02);
      fx.implode(_a, 2, 0.4, [6, 2.6, 12], 0.4, 0.012, K_STREAK, 3);
      fx.glow(_a, 0.08 + ch * 0.1, [2.2, 0.9, 5], 0.07, 0.8);
      G.audio?.setLoop('charge', { vol: 0.3 + ch * 0.5, rate: 1.2 - ch * 0.5 });
    } else if (id === 'starfall') {
      this.star.n = 1 + Math.floor(ch * 5.999);
      const hit = this.aim(230); this.aimHit = hit;
      G.terrain.setRune(0, hit.point.x, hit.point.z, 6 + this.star.n * 1.6, _col.setRGB(3.5, 1.6, 0.4), 1.0, 1.4);
      fx.glow(H.tipWorld[1], 0.05 + ch * 0.05, [8, 4, 1.1], 0.07, 1);
      if (rand() < 0.5) fx.motes(H.tipWorld[1], 1, 0.03, 0.6, [10, 5, 1.5], 0.5, 0.012, -0.2);
    } else if (id === 'ray') this._rayTick(dt);
  }

  _release(cancel) {
    if (!this.firing) return;
    const id = this.current.id, H = G.hand, ch = this.charge;
    this.firing = false;
    if (X[id]) { X[id].release?.(this, cancel); return; }
    G.audio?.stopLoop('charge', 0.15);
    if (id === 'inferno') {
      if (this.orbLight) { G.fx.releaseLight(this.orbLight, 0.2); this.orbLight = null; }
      if (!cancel) this.castInferno(Math.max(0.25, ch));
    } else if (id === 'lightning') {
      this.lt.on = false; G.fx.releaseLight(this.lt.light, 0.2); this.lt.light = null; G.audio?.stopLoop('arc', 0.12); H.trembleTarget = 0; this.cool.lightning = 0.25;
    } else if (id === 'singularity') { H.trembleTarget = 0; if (!cancel) this.castSingularity(); }
    else if (id === 'starfall') { this.star.on = false; if (!cancel && this.aimHit) this.castStarfall(this.aimHit.point, this.star.n); else G.terrain.setRune(0, 0, 0, 1, null, 0); }
    else if (id === 'ray') { this._rayStop(); }
  }

  // ---------------------------------------------------------------- 1. inferno orb
  castInferno(ch) {
    const H = G.hand, pl = G.player, hit = this.aim(240);
    const from = V().copy(H.palm).addScaledVector(H.palmNormal, 0.12);
    const speed = 62, dir = V().subVectors(hit.point, from); const dist = dir.length(); dir.normalize();
    const tFly = dist / speed; dir.multiplyScalar(speed); dir.y += 0.5 * 5 * tFly; // lob slightly to counter gravity
    this.projectiles.push({ type: 'fire', pos: from, prev: from.clone(), vel: dir, life: 4, size: 0.6 + ch * 0.8, charge: ch, light: G.fx.light(from, _col.setRGB(1, 0.5, 0.15), 260 + ch * 500, 18, 1, { hold: true, flicker: 0.2 }) });
    H.setPose('throw'); H.setSpeed(13, 0.6); H.kick(0, 0.3, -1.6, 2.5, 0, 0); H.setGlow(this.current.color, 0.4);
    pl.recoil.kick(0.5 + ch * 0.6); pl.fovKick.kick(14 + ch * 14); pl.addTrauma(0.12 + ch * 0.12);
    G.fx.sparks(from, 14, 6, [14, 6, 1.2], 0.4, 0.5, 0.2, 0.012); G.fx.heatHaze(from, 2, 0.6, 0.5, 0.8);
    G.audio?.play('fire_cast'); this.say(this.current);
    this.cool.inferno = 0.3;
  }

  updateProjectiles(dt) {
    if (dt <= 0) return;
    const fx = G.fx, ph = G.physics;
    for (const p of this.projectiles) {
      if (p.boost === undefined) p.boost = G.timeStop > 0 ? 0.24 : 0;
      const pdt = p.boost > 0 ? G.realDt : dt; p.boost -= G.realDt;
      p.prev.copy(p.pos); p.life -= pdt;
      if (p.type === 'fire') p.vel.y -= 5 * pdt;
      p.pos.addScaledVector(p.vel, pdt);
      _a.subVectors(p.pos, p.prev); const d = _a.length(); _a.multiplyScalar(1 / (d + 1e-6));
      const hit = d > 0 ? ph.raycast(p.prev, _a, d + 0.3) : null;
      if (p.light) p.light.position.copy(p.pos);
      if (p.type === 'fire') {
        fx.trailFire(p.prev, p.pos, p.size * 0.55, 1, true);
        fx.setOrb(1, p.pos, p.size * 0.55);
        fx.glow(p.pos, p.size * 2.6, [3.2, 1.2, 0.3], 0.06, 0.9); fx.glow(p.pos, p.size * 0.8, [10, 6.5, 3], 0.05, 1);
        if (rand() < 0.6) fx.sparks(p.pos, 2, 5, [14, 6, 1.2], 0.5, 0.8, 0.1, 0.02);
        if (rand() < 0.3) fx.heatHaze(p.pos, 1, p.size * 1.5, 0.6, 0.8, 0.5);
      } else if (p.type === 'void') {
        fx.glow(p.pos, 1.6, [2.2, 0.8, 5.5], 0.07, 0.9);
        fx.implode(p.pos, 3, 1.4, [5, 2, 11], 0.3, 0.03, K_STREAK, 3);
        P_trailDark(fx.P, p.prev, p.pos);
      }
      if (hit || p.life <= 0 || p.pos.y < G.terrain.heightAt(p.pos.x, p.pos.z)) {
        const at = hit ? hit.point : p.pos;
        p.dead = true; if (p.light) fx.releaseLight(p.light, 0.1);
        if (p.type === 'fire') {
          _b.copy(at).addScaledVector(hit ? hit.normal : UP, 0.4);
          fx.explosion(_b, 1.05 + p.charge * 1.15, { strength: 19 + p.charge * 9 });
        } else if (p.type === 'void') this.openSingularity(at, hit ? hit.normal : UP);
      }
    }
    if (this.projectiles.some((p) => p.dead)) this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  // ---------------------------------------------------------------- 2. chain lightning
  _lightningTick(dt) {
    const L = this.lt, fx = G.fx, ph = G.physics, H = G.hand, c = this.current.color;
    L.tick -= dt;
    // crackle around the fingers every frame
    for (let i = 0; i < 2; i++) { const a = H.tipWorld[(rand() * 5) | 0], b = H.tipWorld[(rand() * 5) | 0]; if (a !== b) fx.bolt(a, b, { life: 0.05, width: 0.004, jitter: 0.35, color: c, detail: 3, alpha: 0.8 }); }
    if (L.tick > 0) return;
    L.tick = 0.075;
    const hit = this.aim(110);
    const from = _a.copy(H.tipWorld[1]).add(H.tipWorld[2]).add(H.tipWorld[3]).multiplyScalar(1 / 3).clone();
    const target = hit.point.clone();
    fx.bolt(from, target, { life: 0.11, width: 0.11, jitter: 0.11, color: c, branches: 3, flick: 0.035 });
    fx.bolt(H.tipWorld[(rand() * 5) | 0], target, { life: 0.08, width: 0.05, jitter: 0.16, color: c, alpha: 0.7 });
    if (hit.miss) return;
    fx.light(target, c, 900, 22, 0.14, { curve: 1 });
    fx.sparks(target, 10, 14, [6, 9, 16], 0.5, 1.2, 0.4, 0.03);
    fx.glow(target, 3.2, [4, 7, 14], 0.09, 1);
    G.terrain.scorch(target.x, target.z, 1.4, 0.35, 0.5);
    G.forest?.blast(target, 4.5, 0.5, 0.8); G.forest?.igniteGround(target.x, target.z, 16);
    G.audio?.play('zap', { pos: target, vol: 0.5 });
    // strike: shove / shatter the struck body and arc onward to its neighbours
    ph.explode(target, 3.6, 9, { heat: 0.55, up: 0.6, speed: 200, fracture: 1.4 });
    const near = ph.blocksInRadius(target, 13, []);
    let prev = target, n = 0;
    while (near.length && n < 5) {
      const b = near.splice((rand() * near.length) | 0, 1)[0];
      if (!b.alive) continue;
      const pt = V().set(b.x, b.y, b.z);
      if (pt.distanceTo(prev) > 11) continue;
      fx.bolt(prev, pt, { life: 0.1, width: 0.07, jitter: 0.2, color: c, branches: 1, alpha: 0.85 });
      fx.sparks(pt, 5, 9, [6, 9, 16], 0.4, 1.2, 0.4, 0.025);
      ph.heatBlock(b, 0.6, 0.35); ph.lightsOut(b);
      const m = b.mass; b.body.applyImpulse({ x: rr(-3, 3) * m, y: rr(3, 8) * m, z: rr(-3, 3) * m }, true);
      b.body.applyTorqueImpulse({ x: rr(-2, 2) * m, y: rr(-2, 2) * m, z: rr(-2, 2) * m }, true);
      if (rand() < 0.3) ph.fracture(b, null, 5, 0.6);
      prev = pt; n++;
    }
    G.player.addTrauma(0.035); G.post.punch(0.12);
    if (rand() < 0.12) G.audio?.play('thunder', { pos: target, vol: 0.45 });
  }

  // ---------------------------------------------------------------- 3. singularity
  castSingularity() {
    const H = G.hand, hit = this.aim(170), from = V().copy(H.palm).addScaledVector(H.fingerDir, 0.1);
    const dir = V().subVectors(hit.point, from).normalize().multiplyScalar(48);
    this.projectiles.push({ type: 'void', pos: from, prev: from.clone(), vel: dir, life: 4.5, light: G.fx.light(from, _col.setRGB(0.6, 0.3, 1), 200, 14, 1, { hold: true }) });
    H.setPose('throw'); H.setSpeed(12, 0.6); H.kick(0, 0.2, -1.3, 2, 0, 0);
    G.player.recoil.kick(0.5); G.player.fovKick.kick(10);
    G.audio?.play('void_cast'); this.say(this.current); this.cool.singularity = 1.2;
  }
  openSingularity(at, normal) {
    const pos = V().copy(at).addScaledVector(normal, 1.2); pos.y = Math.max(pos.y, G.terrain.heightAt(pos.x, pos.z) + 3.2);
    const h = { pos, t: 0, life: 6.2, r: 0.5, eaten: 0, mass: 0, state: 'grow', blob: G.grass.blob(pos.x, pos.z, 16, -1.3), light: G.fx.light(pos, _col.setRGB(0.55, 0.3, 1), 900, 34, 1, { hold: true, flicker: 0.3 }), eatT: 0 };
    this.holes.push(h);
    G.fx.shockwave(pos, 9, 0.5, 1.2, _col.setRGB(0.6, 0.3, 1), false);
    G.fx.glow(pos, 12, [3, 1.2, 7], 0.3, 0.8);
    G.audio?.play('void_open', { pos });
    G.audio?.loop('hole', 'drone', { vol: 0.55, rate: 0.75, fade: 0.4 }); G.audio?.loop('hole2', 'hum_loop', { vol: 0.5, rate: 0.6, fade: 0.6 });
    G.player.shakeFrom(pos, 0.5, 90);
    G.sky.setStorm(0.45, 0);
  }
  updateHoles(dt) {
    const post = G.post, fx = G.fx, ph = G.physics;
    if (!this.holes.length) { if (post.lens.active) { post.lens.active = false; this.holeMesh.visible = false; this.discMesh.visible = false; } return; }
    if (dt <= 0) return;
    const h = this.holes[0];
    h.t += dt;
    const k = h.t / h.life;
    const collapseAt = h.life - 0.55;
    if (h.state === 'grow' && h.t > collapseAt) { h.state = 'collapse'; G.audio?.play('void_collapse', { pos: h.pos }); G.audio?.stopLoop('hole', 0.5); G.audio?.stopLoop('hole2', 0.5); }
    const grow = easeOutCubic(Math.min(1, h.t / 1.2));
    h.r = h.state === 'collapse' ? lerp(h.r, 0.05, 1 - Math.exp(-dt * 9)) : (0.7 + 1.5 * Math.min(1, h.t / 4) + Math.min(1.2, h.mass * 0.012)) * grow;
    const R = 30 + Math.min(10, h.mass * 0.05), pull = (h.state === 'collapse' ? 120 : 36 + k * 30) * grow;
    // water is dragged in too, and what reaches the middle is gone
    if (G.water && h.pos.y - G.terrain.heightAt(h.pos.x, h.pos.z) < 45) h.mass += G.water.pull(h.pos.x, h.pos.z, R * 1.4, pull * 0.11, dt) * 0.002;
    // gravity: accelerate everything nearby towards the hole, with a swirl; swallow what crosses the horizon
    const list = ph.blocks; let fed = 0;
    for (let i = 0, n = list.length; i < n; i++) {
      const b = list[i]; if (!b.alive || b.fixed) continue;
      const dx = h.pos.x - b.x, dy = h.pos.y - b.y, dz = h.pos.z - b.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R * R) continue;
      const d = Math.sqrt(d2) + 0.001;
      if (d < h.r * 1.35 + 0.5) {
        h.eaten++; h.mass += b.mass; fed++;
        if (fed < 4) fx.implode(h.pos, 5, h.r * 2.2, [7, 3, 14], 0.3, 0.05, K_STREAK, 3);
        ph.remove(b); G.addScore?.(3); continue;
      }
      const massK = clamp(Math.pow(1 / Math.max(b.mass, 0.05), 0.25), 0.25, 1.6);
      // only rip structures apart inside the inner zone; further out it just tugs loose debris
      const asleep = b.frozen || b.body.isSleeping();
      const inner = d < 13 + k * 9;
      if (asleep && !inner) continue;
      if (asleep && inner && rand() > dt * (3.5 + k * 6) * (1 - d / (24 + k * 9) + 0.2)) continue;
      const a = pull * massK * (1 - d / R) * (1 - d / R) * 3.2 + (inner ? 10 : 0);
      const inv = 1 / d, sw = 0.55;
      const vx = (dx * inv + (-dz * inv) * sw) * a * dt, vy = (dy * inv + 0.25) * a * dt, vz = (dz * inv + (dx * inv) * sw) * a * dt;
      const m = b.mass;
      b.body.applyImpulse({ x: vx * m, y: vy * m, z: vz * m }, true);
      b.pvx += vx; b.pvy += vy; b.pvz += vz;
      if (b.lit > 0) ph.lightsOut(b);
      if (d < 9 && !b.rubble && b.gen < 2 && rand() < dt * 2.5) ph.fracture(b, null, 2, 0);
    }
    { let up = 0; G.forest?.each(h.pos.x, h.pos.z, 30, (tr, d) => { if (up < 2 && rand() < dt * (d < 15 ? 4 : 0.8)) { G.forest.uproot(tr); up++; } }); }
    // visuals
    post.lens.active = true; post.lens.pos.copy(h.pos); post.lens.radius = h.r * 2.6; post.lens.strength = Math.min(1, grow) * (h.state === 'collapse' ? 1.6 : 1);
    const c = SPELLS[2].color;
    this.holeMesh.visible = true; this.holeMesh.position.copy(h.pos); this.holeMesh.scale.setScalar(h.r);
    this.holeMesh.material.uniforms.uColor.value.copy(c); this.holeMesh.material.uniforms.uAlpha.value = Math.min(1, h.t * 3);
    this.discMesh.visible = true; this.discMesh.position.copy(h.pos); this.discMesh.scale.setScalar(h.r * 4.6);
    this.discMesh.rotation.set(-Math.PI / 2 + 0.38, 0, h.t * 0.25, 'YXZ'); this.discMesh.rotation.y = h.t * 0.13;
    this.discMesh.material.uniforms.uColor.value.copy(c); this.discMesh.material.uniforms.uAlpha.value = Math.min(1, h.t * 2) * (h.state === 'collapse' ? 2 : 1);
    fx.implode(h.pos, Math.ceil(5 * fx.density), 6 + h.r * 5, [5, 2.2, 11], 0.7, 0.045, K_STREAK, 1.5);
    if (rand() < 0.5) fx.implode(h.pos, 2, 12 + h.r * 4, [9, 5, 3], 1.0, 0.06, K_DOT, 1.2);
    // dust dragged off the ground
    const gy = G.terrain.heightAt(h.pos.x, h.pos.z);
    for (let i = 0; i < 2; i++) { const a = rand() * 6.28, rd = rr(4, 15); fx.P.spawn(h.pos.x + Math.cos(a) * rd, gy + 0.3, h.pos.z + Math.sin(a) * rd, h.pos.x, h.pos.y, h.pos.z, rr(0.9, 1.5), 1.2, 0.4, 0.3, 0.26, 0.22, 0.4, 0.2, 0.12, 0.3, 0.5, 1, 0, K_PUFF, 0, 0, 1.3, 0.03, 0.25, 1); }
    h.light.userData.base = 700 + 500 * Math.sin(h.t * 9) + (h.state === 'collapse' ? 3000 : 0);
    h.blob.w = 14 + h.r * 3; h.blob.s = -1.4 * grow;
    G.player.addTrauma(dt * (0.12 + k * 0.3) * clamp(1 - h.pos.distanceTo(G.player.eye) / 140, 0.15, 1));
    G.audio?.setLoop('hole', { vol: 0.5 + k * 0.5, rate: 0.75 + k * 0.5 });
    if (h.t >= h.life) {
      // detonation: everything it swallowed comes back out as burning debris
      this.holes.shift(); h.blob.life = 0; fx.releaseLight(h.light, 0.3);
      const s = 2.4 + Math.min(1.6, h.mass * 0.012);
      fx.explosion(h.pos, s, { tint: [0.75, 0.55, 1.6], color: _col.setRGB(0.8, 0.55, 1.5), strength: 30, radius: 8, craterR: 1.5, craterD: 0.4 });
      fx.shockwave(h.pos, 55, 1.1, 1.4, _col.setRGB(0.7, 0.45, 1), true);
      ph.explode(h.pos, 48, 26, { speed: 85, heat: 0.3, up: 0.5, fracture: 0.9 });
      G.forest?.blast(h.pos, 52, 1.8, 0.2);
      G.grass.shock(h.pos.x, h.pos.z, 2, 60, 6, 2.2);
      const n = Math.min(70, 12 + Math.round(h.eaten * 0.6));
      for (let i = 0; i < n; i++) {
        randUnit(_a); _a.y = Math.abs(_a.y) * 0.9 + 0.25; _a.normalize();
        const sp = rr(18, 46), sz = rr(0.35, 1.3);
        const b = ph.add({ shape: rand() < 0.6 ? 'rock' : 'box', mat: rand() < 0.5 ? 'plaster' : 'stone', x: h.pos.x + _a.x * 1.5, y: h.pos.y + _a.y * 1.5, z: h.pos.z + _a.z * 1.5, sx: sz * rr(0.7, 1.4), sy: sz * rr(0.5, 1), sz: sz * rr(0.7, 1.4), sleeping: false, vel: { x: _a.x * sp, y: _a.y * sp, z: _a.z * sp }, angvel: { x: rr(-9, 9), y: rr(-9, 9), z: rr(-9, 9) }, rubble: sz < 0.6, life: sz < 0.6 ? rr(6, 10) : Infinity, gen: 2, style: [0, 0, 0, 1], tint: 0.6 });
        if (b) ph.heatBlock(b, rr(0.6, 1), 0.5);
      }
      post.flash(0.9, _col.setRGB(0.85, 0.7, 1)); post.radialBlur = 1.2; G.player.addTrauma(0.7);
      G.audio?.play('void_boom', { pos: h.pos });
      G.sky.setStorm(0, 0);
      G.timeScale = 0.35; // a breath of slow motion, eases back by itself
    }
  }

  // ---------------------------------------------------------------- 4. starfall
  castStarfall(target, n) {
    const H = G.hand, pl = G.player;
    H.setPose('slam'); H.setSpeed(14, 0.55); H.kick(0, -1.4, -0.4, -3.5, 0, 0);
    pl.recoil.kick(-0.5); pl.addTrauma(0.15);
    const t0 = target.clone();
    for (let i = 0; i < n; i++) {
      const off = i === 0 ? V() : V().set(rr(-1, 1), 0, rr(-1, 1)).normalize().multiplyScalar(rr(5, 9 + n * 2.2));
      const tgt = t0.clone().add(off); tgt.y = G.terrain.heightAt(tgt.x, tgt.z);
      // come in from high behind the caster's shoulder so they streak across the sky
      const from = tgt.clone().add(_a.set(-pl.forward.x * 120 + pl.right.x * rr(40, 90), rr(200, 250), -pl.forward.z * 120 + pl.right.z * rr(40, 90)));
      this.meteors.push({ delay: 0.25 + i * 0.3 + rand() * 0.1, from, tgt, pos: from.clone(), prev: from.clone(), time: 1.55, t: 0, size: rr(1.6, 2.2), started: false });
    }
    G.fx.after(0.6 + n * 0.3, () => G.terrain.setRune(0, 0, 0, 1, null, 0));
    this.cool.starfall = 0.8;
  }
  updateMeteors(dt) {
    if (dt <= 0 || !this.meteors.length) return;
    const fx = G.fx;
    for (const m of this.meteors) {
      if (m.delay > 0) { m.delay -= dt; continue; }
      if (!m.started) { m.started = true; m.light = fx.light(m.pos, _col.setRGB(1, 0.6, 0.25), 9000, 90, 1, { hold: true, flicker: 0.2 }); G.audio?.play('meteor_in', { pos: m.tgt, time: m.time }); }
      m.t += dt; m.prev.copy(m.pos);
      const k = Math.min(1, m.t / m.time);
      m.pos.lerpVectors(m.from, m.tgt, k);
      m.light.position.copy(m.pos);
      const s = m.size;
      fx.setOrb(2 + (this.meteors.indexOf(m) % 2), m.pos, s * 1.25, null, 1.4);
      fx.trailFire(m.prev, m.pos, s * 1.5, 1.4, true);
      fx.glow(m.pos, s * 5, [5, 2.2, 0.6], 0.07, 1); fx.glow(m.pos, s * 2, [14, 9.5, 5], 0.06, 1);
      _a.subVectors(m.pos, m.prev).multiplyScalar(0.2);
      fx.P.spawn(m.pos.x, m.pos.y, m.pos.z, _a.x, _a.y, _a.z, 0.5, s * 2.2, s * 0.6, 14, 8, 3, 1, 4, 0.8, 0.1, 0, 3, 0, K_DOT, 0, 1);
      if (rand() < 0.7) fx.sparks(m.pos, 3, 16, [14, 7, 2], 0.9, 0.6, 0.0, 0.08);
      if (k >= 1) {
        m.dead = true; fx.releaseLight(m.light, 0.2);
        const at = m.tgt.clone(); at.y += 0.6;
        fx.explosion(at, 2.3, { strength: 30, radius: 9, craterR: 2.1, craterD: 0.7 });
        fx.shockwave(at, 30, 0.8, 1.1, null, true);
        fx.dust(at, 40, 26, 3.2, 3.5, [0.42, 0.37, 0.3], 0.5, 0.5);
        fx.smoke(at, 16, 12, 4.5, 6, 0.05, 0.8, 0.3, 0.8);
        G.physics.spawnRubble(at, 10, 24, 0.5, 'stone', 1, 0.9);
        G.post.radialBlur = Math.max(G.post.radialBlur, 0.6);
      }
    }
    if (this.meteors.some((m) => m.dead)) this.meteors = this.meteors.filter((m) => !m.dead);
  }

  // ---------------------------------------------------------------- 5. annihilation ray
  _rayTick(dt) {
    const R = this.ray, fx = G.fx, H = G.hand, ph = G.physics, c = this.current.color;
    R.t += dt;
    const from = _a.copy(H.palm).addScaledVector(H.palmNormal, 0.05).clone();
    if (R.t < 0.32) { fx.implode(from, 5, 0.6, [14, 4, 9], 0.25, 0.012, K_STREAK, 3); fx.glow(from, 0.1 + R.t * 0.5, [8, 2.4, 5.5], 0.06, 1); return; }
    if (!R.live) {
      R.live = true; R.light = fx.light(from, c, 3, 10, 1, { hold: true, flicker: 0.3, follow: H.palm }); R.light2 = fx.light(from, c, 2500, 30, 1, { hold: true, flicker: 0.4 });
      G.audio?.loop('beam', 'beam_loop', { vol: 0.75, rate: 0.62, fade: 0.06 }); G.audio?.loop('beam2', 'fire_roar', { vol: 0.4, rate: 0.55, fade: 0.1 }); G.audio?.loop('beam3', 'electric_loop', { vol: 0.6, rate: 0.7, fade: 0.1 });
      G.player.fovKick.kick(-16); G.post.punch(1.2); H.kick(0, 0, 0.6, 1.2, 0, 0);
    }
    const hit = this.aim(190), to = hit.point;
    const w = 0.24 + Math.sin(G.time * 55) * 0.03;
    fx.setBeam(0, from, to, w, c, 1, 3.5, 0.3, 3.5);                 // tapered at the palm so it does not swallow the view
    fx.setBeam(2, from, to, w * 2.6, _col.setRGB(c.r * 0.5, c.g * 0.5, c.b * 0.5), 0.3, 1.5, 0.14, 10);
    if (rand() < 0.6) fx.bolt(from, to, { life: 0.07, width: 0.035, jitter: 0.012 + rand() * 0.02, color: c, detail: 6, alpha: 0.9 });
    fx.glow(from, 0.3, [10, 3.5, 7], 0.05, 1);
    R.light2.position.copy(to).addScaledVector(hit.normal, 0.6);
    G.player.addTrauma(dt * 0.5); H.trembleTarget = 0.9;
    G.player.recoil.kick(dt * 0.9);
    if (hit.miss) return;
    fx.glow(to, 3, [7, 2.5, 5], 0.07, 1); fx.glow(to, 1.1, [14, 11, 12], 0.06, 1);
    fx.sparks(to, 5, 22, [16, 6, 11], 0.7, 1.3, 0.5, 0.035);
    fx.fire(to, 2, 5, 1.3, 0.5, [1, 0.5, 0.9]);
    if (rand() < 0.35) fx.smoke(to, 1, 3, 1.6, 2.8, 0.05, 0.6, 0.1, 0.6);
    if (rand() < 0.3) fx.heatHaze(to, 1, 2.5, 0.8, 1.3, 2);
    R.hitT -= dt; R.trenchT -= dt;
    if (R.hitT <= 0) {
      R.hitT = 0.085;
      ph.explode(to, 4.6, 15, { heat: 1, up: 0.25, speed: 240, fracture: 1.6 });
      G.terrain.scorch(to.x, to.z, 1.8, 0.6, 1);
      G.forest?.blast(to, 5, 0.7, 1); G.forest?.igniteGround(to.x, to.z, 22);
      if (G.water?.at(to.x, to.z) && G.terrain.heightAt(to.x, to.z) < G.water.at(to.x, to.z).level) G.water.splash(to.x, to.z, 0.6);
      if (G.audio?.limit('rayhit', 0.3)) G.audio.play('explosion', { size: 0.6, pos: to });
    }
    // a line of delayed detonations follows the cut
    R.boomT = (R.boomT || 0) - dt;
    if (R.boomT <= 0) { R.boomT = 0.24; const q = to.clone(); fx.after(0.32, () => fx.explosion(q, 0.9 + rand() * 0.35, { strength: 16, radius: 6.5, craterR: 1.4, craterD: 0.45, tint: [1, 0.62, 0.85] })); }
    if (R.trenchT <= 0 && hit.terrain) { R.trenchT = 0.2; G.terrain.crater(to.x, to.z, 1.3, 0.28); G.physics.spawnRubble(to, 1, 9, 0.2, 'stone', 1); }
  }
  _rayStop() {
    const R = this.ray, fx = G.fx;
    fx.setBeam(0, _a, _a, 0, _col, 0); fx.setBeam(2, _a, _a, 0, _col, 0);
    if (R.light) fx.releaseLight(R.light, 0.2); if (R.light2) fx.releaseLight(R.light2, 0.3);
    if (R.live) { G.audio?.stopLoop('beam', 0.15); G.audio?.stopLoop('beam2', 0.3); G.audio?.stopLoop('beam3', 0.15); G.audio?.play('ray_end'); }
    R.on = false; R.live = false; R.light = R.light2 = null; G.hand.trembleTarget = 0; this.cool.ray = 0.5;
  }

  // ---------------------------------------------------------------- G: blink, V: skywalk
  blink() {
    if (!this.ready('blink') || this.cata) return;
    const pl = G.player, fx = G.fx, hit = this.aim(260), c = EXTRA.blink.color;
    const from = pl.eye.clone(), to = hit.point.clone().addScaledVector(hit.normal, 0.6);
    const g = G.terrain.heightAt(to.x, to.z); if (to.y < g + 0.2 || hit.terrain) to.y = Math.max(to.y, g);
    this.cool.blink = 1.1; this.say(EXTRA.blink);
    fx.implode(from, 40, 2.4, [5, 8, 16], 0.3, 0.05, K_STREAK, 2); fx.glow(from, 4, [3, 5, 10], 0.2, 0.9);
    fx.bolt(from, to.clone().add(new THREE.Vector3(0, 1.2, 0)), { life: 0.16, width: 0.12, jitter: 0.03, color: c, detail: 6 });
    pl.teleport(to.x, to.z); pl.pos.y = to.y; pl.body.setTranslation({ x: to.x, y: to.y + 0.84, z: to.z }, true); pl.vel.set(0, 0, 0);
    // arrival: the air it displaces has to go somewhere
    const at = to.clone(); at.y += 1;
    fx.shockwave(at, 13, 0.45, 1.3, c, true); fx.glow(at, 7, [3, 5, 10], 0.18, 1);
    fx.sparks(at, 30, 16, [6, 9, 16], 0.6, 0.8, 0.5, 0.04); fx.dust(at, 14, 13, 1.6, 1.8, [0.42, 0.38, 0.32], 0.4, 0.3);
    G.physics.explode(at, 11, 13, { up: 0.5, heat: 0, fracture: 0.7 }); G.forest?.blast(at, 9, 0.7, 0); G.grass.shock(at.x, at.z, 1.6, 40, 3, 1);
    pl.fovKick.kick(24); pl.addTrauma(0.3); G.post.punch(1.4); G.post.radialBlur = 1; G.post.cutBlur();
    G.hand.setPose('fist'); G.hand.kick(0, -0.4, 0.6, -1.5, 0, 0); G.hand.setGlow(c, 1.2); this.idleT = -0.2;
    G.audio?.play('blink');
  }
  fly() {
    const pl = G.player; pl.fly = !pl.fly; this.say({ name: pl.fly ? 'SKYWALK' : 'GROUNDED', color: EXTRA.fly.color });
    if (pl.fly) { pl.vel.y = 9; G.fx.shockwave(pl.pos.clone(), 9, 0.4, 1, EXTRA.fly.color, true); G.grass.shock(pl.pos.x, pl.pos.z, 1.4, 30, 3, 0.9); this.flyBlob = G.grass.blob(pl.pos.x, pl.pos.z, 7, 0.9); } else if (this.flyBlob) { this.flyBlob.life = 0; this.flyBlob = null; }
    G.audio?.play('fly');
  }
  _flyFx(dt) {
    const pl = G.player, P = G.fx.P, c = EXTRA.fly.color;
    if (this.flyBlob) { this.flyBlob.x = pl.pos.x; this.flyBlob.z = pl.pos.z; this.flyBlob.s = 0.9 * Math.max(0, 1 - (pl.pos.y - G.terrain.heightAt(pl.pos.x, pl.pos.z)) / 30); }
    if (dt > 0) for (let i = 0; i < 2; i++) P.spawn(pl.pos.x + rr(-0.5, 0.5), pl.pos.y + rr(0, 0.4), pl.pos.z + rr(-0.5, 0.5), rr(-1, 1), rr(-5, -2), rr(-1, 1), rr(0.4, 0.9), 0.07, 0.02, c.r * 4, c.g * 5, c.b * 7, 1, c.r, c.g * 2, c.b * 4, 0.2, 1, 0, K_DOT, 0.4, 1);
  }

  // ---------------------------------------------------------------- F: force blast
  force() {
    if (!this.ready('force') || this.cata) return;
    const pl = G.player, H = G.hand, fx = G.fx, d = pl.forward;
    this.cool.force = 1.0; this.say(EXTRA.force);
    H.setPose('palm'); H.setSpeed(15, 0.55); H.kick(0, 0.2, -2.2, 1.5, 0, 0); H.setGlow(EXTRA.force.color, 1.2); this.idleT = -0.25;
    pl.recoil.kick(0.7); pl.fovKick.kick(18); pl.addTrauma(0.3);
    const o = pl.eye.clone();
    G.physics.push(o, d, 46, 34, 0.55);
    G.water?.impulse(o.x + d.x * 11, o.z + d.z * 11, 17, 2.4);
    G.forest?.each(o.x + d.x * 22, o.z + d.z * 22, 30, (tr, dd, dx, dz) => { _a.set(tr.x - o.x, 0, tr.z - o.z); const l = _a.length(); if (l < 46 && (_a.x * d.x + _a.z * d.z) / l > 0.55) G.forest.topple(tr, d.x, d.z, 1.2 + (1 - l / 46) * 3); });
    for (let i = 1; i <= 4; i++) { const p = o.clone().addScaledVector(d, i * 6); fx.after(i * 0.035, () => { fx.shockwave(p, 3 + i * 2.2, 0.35, 1.3 - i * 0.2, _col.setRGB(0.8, 0.9, 1), false); G.grass.shock(p.x, p.z, 1.1, 30, 3 + i, 0.8); }); }
    // dust kicked up along the cone
    for (let i = 0; i < 26; i++) {
      const t = rr(2, 26), sp = rr(-0.5, 0.5);
      const x = o.x + d.x * t + pl.right.x * sp * t * 0.6, z = o.z + d.z * t + pl.right.z * sp * t * 0.6, y = G.terrain.heightAt(x, z) + 0.2;
      fx.P.spawn(x, y, z, d.x * rr(8, 20) + pl.right.x * sp * 6, rr(0.5, 3), d.z * rr(8, 20) + pl.right.z * sp * 6, rr(0.9, 1.8), 0.7, 3.2, 0.42, 0.37, 0.3, 0.38, 0.4, 0.36, 0.3, 0, 2.2, -0.04, K_PUFF, 0.3, 0, rr(-0.5, 0.5), 0.03, 0.1, 0, t * 0.012);
    }
    fx.D.spawn(o.x + d.x * 2, o.y + d.y * 2, o.z + d.z * 2, d.x * 60, d.y * 60, d.z * 60, 0.5, 3, 14, 3, 0, 0, 1, 3, 0, 0, 0, 1.5, 0, K_RING, 0, 1);
    G.post.punch(0.9); G.post.radialBlur = Math.max(G.post.radialBlur, 0.5);
    G.audio?.play('force');
  }

  // ---------------------------------------------------------------- RMB: telekinesis
  tkGrab() {
    const hit = this.aim(70), ph = G.physics, T = this.tk;
    let main = hit.block && !hit.block.fixed ? hit.block : null;
    const near = ph.blocksInRadius(hit.point, main ? 2.6 : 4.5, []);
    if (!main && near.length) main = near.sort((a, b) => b.mass - a.mass)[0];
    if (!main) return;
    const set = [main, ...near.filter((b) => b !== main && b.mass < 9).slice(0, 7)];
    T.blocks = set.map((b) => ({ b, off: V().set(b.x - main.x, b.y - main.y, b.z - main.z).multiplyScalar(0.6) }));
    for (const { b } of T.blocks) { b.held = true; b.body.wakeUp(); ph.lightsOut(b); b.body.setGravityScale?.(0, true); }
    const big = set.reduce((m, b) => Math.max(m, b.sx, b.sy, b.sz), 0);
    T.on = true; T.dist = Math.max(clamp(hit.dist * 0.5, 6, 13), 4.5 + big * 2.2); T.t = 0; T.main = main;
    G.hand.setPose('grip'); G.hand.setSpeed(8); G.hand.setGlow(EXTRA.tk.color, 1.1); G.hand.trembleTarget = 0.3;
    this.say(EXTRA.tk); G.audio?.play('tk_grab'); G.audio?.loop('tk', 'hum_loop', { vol: 0.6, rate: 1.25, fade: 0.2 });
  }
  tkUpdate(dt) {
    const T = this.tk, pl = G.player, fx = G.fx, c = EXTRA.tk.color;
    T.t += dt;
    T.blocks = T.blocks.filter((e) => e.b.alive);
    if (!T.blocks.length) { this.tkEnd(); return; }
    const tgt = _a.copy(pl.eye).addScaledVector(pl.forward, T.dist).clone(); tgt.y += 0.6;
    for (const e of T.blocks) {
      const b = e.b, p = b.body.translation(), v = b.body.linvel();
      const cs = Math.cos(T.t * 0.9), sn = Math.sin(T.t * 0.9);
      const ox = e.off.x * cs - e.off.z * sn, oz = e.off.x * sn + e.off.z * cs;
      const dx = tgt.x + ox - p.x, dy = tgt.y + e.off.y - p.y, dz = tgt.z + oz - p.z;
      const k = Math.min(1, dt * 9);
      b.body.setLinvel({ x: lerp(v.x, dx * 7, k), y: lerp(v.y, dy * 7, k), z: lerp(v.z, dz * 7, k) }, true);
      b.body.setAngvel({ x: 0.6, y: 0.9, z: 0.3 }, true);
      b.pvx = v.x; b.pvy = v.y; b.pvz = v.z;
      if (rand() < 0.3) fx.motes(_b.set(p.x, p.y, p.z), 1, Math.max(b.sx, b.sy, b.sz) * 0.6, 0.6, [c.r * 6, c.g * 6, c.b * 6], 0.7, 0.05, -0.1);
    }
    const mp = T.blocks[0].b.body.translation();
    if ((T.bt = (T.bt || 0) - dt) <= 0) { T.bt = 0.05; fx.bolt(G.hand.palm, _b.set(mp.x, mp.y, mp.z), { life: 0.09, width: 0.022, jitter: 0.07, color: c, alpha: 0.8, detail: 5 }); }
    fx.glow(G.hand.palm, 0.14, [c.r * 4, c.g * 4, c.b * 4], 0.06, 0.8);
  }
  tkThrow() {
    const T = this.tk, pl = G.player, hit = this.aim(200);
    for (const e of T.blocks) {
      const b = e.b; if (!b.alive) continue;
      const p = b.body.translation();
      _a.set(hit.point.x - p.x, hit.point.y - p.y, hit.point.z - p.z).normalize().multiplyScalar(68 + rand() * 8); _a.y += 3;
      b.body.setLinvel({ x: _a.x, y: _a.y, z: _a.z }, true); b.body.setAngvel({ x: rr(-6, 6), y: rr(-6, 6), z: rr(-6, 6) }, true);
      b.body.enableCcd?.(true); b.body.setGravityScale?.(1, true);
      b.pvx = _a.x; b.pvy = _a.y; b.pvz = _a.z; b.thrown = G.time;
      G.fx.after(0.12, () => { b.held = false; });
    }
    G.hand.setPose('throw'); G.hand.setSpeed(15, 0.55); G.hand.kick(0, 0.3, -2, 2.5, 0, 0);
    pl.recoil.kick(0.6); pl.fovKick.kick(12); pl.addTrauma(0.2);
    G.fx.shockwave(_b.copy(pl.eye).addScaledVector(pl.forward, 4), 5, 0.3, 0.8, EXTRA.tk.color, false);
    G.audio?.play('tk_throw');
    this.tkEnd(true);
  }
  tkEnd(thrown = false) {
    const T = this.tk;
    if (!thrown) for (const e of T.blocks) { e.b.held = false; e.b.body.setGravityScale?.(1, true); }
    T.on = false; T.blocks = []; G.hand.trembleTarget = 0; G.audio?.stopLoop('tk', 0.2);
  }

  // ---------------------------------------------------------------- Q: cataclysm
  cataclysm(force = false) {
    if (this.cata || (G.ult < 1 && !force && !this.freeUlt)) return;
    if (this.firing) this._release(true);
    if (this.tk.on) this.tkEnd();
    const hit = this.aim(220);
    const target = hit.point.clone(); target.y = G.terrain.heightAt(target.x, target.z);
    const CH = 4.6;
    this.cata = { t: 0, target, charge: CH, struck: false, boltT: 0, done: false, top: target.clone().add(V().set(0, 150, 0)), beamT: 0 };
    G.ult = 0;
    const H = G.hand, c = EXTRA.cataclysm.color;
    H.setPose('raise'); H.setSpeed(4.5, 0.8); H.setGlow(c, 1.4); H.trembleTarget = 0.5;
    this.say(EXTRA.cataclysm);
    _a.subVectors(this.cata.top, G.player.eye).normalize();
    G.sky.setStorm(0.92, 1, _a, _col.setRGB(1.0, 0.5, 0.2));
    G.post.letterboxTarget = 1;
    G.audio?.play('cata_start', { time: CH }); G.audio?.setLoop('music', { vol: 0.2, tau: 0.5 });
    G.fx.after(CH - 3.6, () => G.audio?.play('cata_riser'));
    this.cata.light = G.fx.light(target.clone().add(V().set(0, 12, 0)), c, 0, 120, 1, { hold: true, flicker: 0.3 });
  }
  updateCataclysm(dt) {
    const C = this.cata; if (!C) return;
    const fx = G.fx, ph = G.physics, T = G.terrain, c = EXTRA.cataclysm.color, tg = C.target, real = G.realDt;
    C.t += real;
    const k = sat(C.t / C.charge);
    if (!C.struck) {
      // sigils: one burning into the ground, three stacked in the sky like the barrel of a cannon
      T.setRune(1, tg.x, tg.z, 34 * easeOutCubic(k), _col.setRGB(4, 2.2, 0.7), 0.4 + k * 1.2, 0.8);
      const down = _a.set(0, -1, 0);
      fx.setRune(0, C.top, down, 78 * easeOutCubic(sat(k * 1.3)), _col.setRGB(1, 0.62, 0.25), 1.2 + k, 0.5, 1.4 * sat(k * 1.6));
      fx.setRune(1, _b.copy(tg).add(_c.set(0, 98, 0)), down, 46 * easeOutCubic(sat(k * 1.3 - 0.15)), _col.setRGB(1, 0.75, 0.4), 1.4 + k, -0.9, 1.4 * sat(k * 1.6 - 0.2));
      fx.setRune(2, _b.copy(tg).add(_c.set(0, 58, 0)), down, 24 * easeOutCubic(sat(k * 1.3 - 0.3)), _col.setRGB(1, 0.85, 0.6), 1.6 + k, 1.6, 1.4 * sat(k * 1.6 - 0.4));
      C.light.userData.base = 600 + k * 5000;
      // the city starts to come apart: light debris lifts, lightning rakes the ground
      if (dt > 0) {
        for (const b of ph.blocks) {
          if (!b.alive || b.fixed || b.mass > 2.4) continue;
          const dx = b.x - tg.x, dz = b.z - tg.z, d2 = dx * dx + dz * dz;
          if (d2 > 26 * 26 || rand() > dt * (0.4 + k * 2.5)) continue;
          b.body.applyImpulse({ x: rr(-0.5, 0.5) * b.mass, y: rr(3, 6.5) * b.mass, z: rr(-0.5, 0.5) * b.mass }, true); ph.lightsOut(b);
        }
        for (let i = 0; i < 3; i++) { const a = rand() * 6.28, r = Math.sqrt(rand()) * 30; fx.P.spawn(tg.x + Math.cos(a) * r, tg.y + rr(0, 1.5), tg.z + Math.sin(a) * r, rr(-0.5, 0.5), rr(4, 11), rr(-0.5, 0.5), rr(1.2, 2.6), rr(0.08, 0.2), 0.02, 12, 7, 2.2, 1, 6, 2.5, 0.4, 0.3, 0.4, -0.5, K_DOT, 0.6, 1); }
      }
      C.boltT -= real;
      if (C.boltT <= 0 && k > 0.12) {
        C.boltT = lerp(0.42, 0.1, k) * rr(0.6, 1.3);
        const a = rand() * 6.28, r = Math.sqrt(rand()) * 34, gx = tg.x + Math.cos(a) * r, gz = tg.z + Math.sin(a) * r;
        const g = V().set(gx, T.heightAt(gx, gz), gz);
        const hit = ph.raycast(_d.set(gx, tg.y + 60, gz), _c.set(0, -1, 0), 70); if (hit) g.copy(hit.point);
        const from = V().set(tg.x + Math.cos(a) * r * 0.5, C.top.y - 52 - rand() * 30, tg.z + Math.sin(a) * r * 0.5);
        fx.bolt(from, g, { life: 0.22, width: 0.3, jitter: 0.1, color: _col.setRGB(1, 0.75, 0.45), branches: 3, flick: 0.04 });
        fx.light(g, c, 5000, 45, 0.25, { curve: 1 });
        fx.sparks(g, 20, 22, [16, 10, 4], 0.9, 1.3, 0.5, 0.05); fx.glow(g, 7, [14, 9, 4], 0.12, 1);
        ph.explode(g, 5.5, 13, { heat: 0.7, up: 0.7, fracture: 1.3 }); T.scorch(g.x, g.z, 2.2, 0.7, 0.9);
        G.post.flash(0.1, c); G.player.addTrauma(0.1);
        G.audio?.play('thunder', { pos: g, vol: 0.75 });
      }
      G.player.addTrauma(real * 0.25 * k);
      if (k > 0.86) { G.hand.setPose('crush'); G.hand.setSpeed(11, 0.6); G.timeScaleTarget = 0.32; }
      if (k >= 1) this._strike(C);
    } else {
      const s = C.t - C.charge;
      // pillar of light
      const bk = sat(1 - s / 1.25);
      if (bk > 0) {
        const w = 10 * Math.pow(bk, 0.5) * (1 + 0.08 * Math.sin(G.realTime * 70));
        fx.setBeam(1, _b.copy(tg).add(_c.set(0, -2, 0)), C.top, w, _col.setRGB(1, 0.86, 0.6), bk * 1.4, 6);
        fx.setBeam(3, _b, C.top, w * 2.3, _col.setRGB(1, 0.55, 0.2), bk * 0.4, 3);
      } else { fx.setBeam(1, tg, tg, 0, _col, 0); fx.setBeam(3, tg, tg, 0, _col, 0); }
      const rk = sat(1 - s / 2.2);
      for (let i = 0; i < 3; i++) fx.runes[i].material.uniforms.uAlpha.value *= rk > 0 ? 0.93 : 0;
      if (rk <= 0) for (let i = 0; i < 3; i++) fx.runes[i].visible = false;
      T.setRune(1, tg.x, tg.z, 34, null, Math.max(0, 1.6 - s * 0.8));
      if (s > 0.9) G.timeScaleTarget = 1;
      if (s > 3.2 && !C.cleared) { C.cleared = true; G.sky.setStorm(0.35, 0); G.post.letterboxTarget = 0; G.audio?.setLoop('music', { vol: 0.42, tau: 2 }); }
      if (s > 9) { G.sky.setStorm(0, 0); this.cata = null; }
    }
  }
  _strike(C) {
    const fx = G.fx, ph = G.physics, T = G.terrain, tg = C.target, c = EXTRA.cataclysm.color;
    C.struck = true;
    fx.releaseLight(C.light, 2.5); C.light.userData.base = 60000; C.light.intensity = 60000;
    const at = tg.clone(); at.y += 1.5;
    fx.explosion(at, 5.2, { strength: 46, radius: 9, craterR: 2.9, craterD: 0.85, tint: [1, 0.9, 0.75] });
    ph.explode(at, 205, 62, { speed: 76, heat: 0.45, up: 0.55, fracture: 1.0 });
    fx.shockwave(at, 250, 3.0, 1.6, _col.setRGB(1, 0.8, 0.55), true);
    G.forest?.blast(at, 215, 3, 0.5);
    G.water?.impulse(tg.x, tg.z, 215, 2.2);
    for (let i = 0; i < 30; i++) { const a = rand() * 6.28, r = rr(20, 70); G.forest?.igniteGround(tg.x + Math.cos(a) * r, tg.z + Math.sin(a) * r, 18); }
    G.grass.shock(tg.x, tg.z, 2.4, 55, 8, 3.2);
    T.scorch(tg.x, tg.z, 30, 1, 1);
    // rising column + rolling dust wall + ring of secondary blasts
    fx.fireball(at.clone().add(_a.set(0, 7, 0)), 13, 3.6, null, 1.2, 6);
    fx.after(0.35, () => fx.fireball(at.clone().add(_a.set(0, 20, 0)), 10, 3.4, null, 1.1, 8));
    fx.after(0.8, () => fx.fireball(at.clone().add(_a.set(0, 34, 0)), 13, 4.2, null, 1.0, 5));
    for (let i = 0; i < 150; i++) {
      const a = rand() * 6.28, sp = rr(24, 96), sz = rr(3, 8);
      fx.P.spawn(tg.x + Math.cos(a) * 6, tg.y + rr(0.3, 3), tg.z + Math.sin(a) * 6, Math.cos(a) * sp, rr(0.5, 7), Math.sin(a) * sp, rr(3, 6.5), sz, sz * 3, 0.36, 0.31, 0.25, 0.55, 0.3, 0.27, 0.23, 0, 0.9, -0.05, K_PUFF, 0.4, 0, rr(-0.4, 0.4), 0.03, 0.08);
    }
    for (let i = 0; i < 46; i++) { randUnit(_a); _a.y = Math.abs(_a.y) + 0.5; const sp = rr(6, 20); fx.P.spawn(at.x + _a.x * 4, at.y + _a.y * 4, at.z + _a.z * 4, _a.x * sp, _a.y * sp * 1.6, _a.z * sp, rr(4, 8), rr(5, 9), rr(14, 22), 0.045, 0.04, 0.036, 0.8, 0.13, 0.12, 0.115, 0, 0.5, -0.35, K_PUFF, 0.5, 0, rr(-0.4, 0.4), 0.03, 0.1, 0, rand() * 0.6); }
    for (let i = 0; i < 30; i++) {
      const inner = i < 12, a = (i / (inner ? 12 : 18)) * 6.28 + rr(-0.2, 0.2), r = inner ? rr(15, 34) : rr(60, 165), x = tg.x + Math.cos(a) * r, z = tg.z + Math.sin(a) * r;
      fx.after(0.12 + r * 0.012 + rand() * 0.2, () => fx.explosion(V().set(x, T.heightAt(x, z) + 1.5, z), inner ? rr(1.2, 1.9) : rr(1.6, 2.6), { strength: 24, crater: true }));
    }
    fx.sparks(at, 260, 70, [16, 9, 3], 2.6, 1.0, 0.7, 0.09);
    fx.embers(at, 160, 26, [10, 3.5, 0.6], 7, 0.5);
    ph.spawnRubble(at, 40, 38, 0.6, 'stone', 1, 1.1);
    // ash and embers keep falling for a while
    fx.addEmitter({ pos: at, life: 9, rate: 70, emit: (e) => { const a = rand() * 6.28, r = Math.sqrt(rand()) * 70; fx.P.spawn(tg.x + Math.cos(a) * r, tg.y + rr(14, 40), tg.z + Math.sin(a) * r, rr(-1, 1), rr(-3, -1), rr(-1, 1), rr(3, 6), rr(0.05, 0.12), 0.03, 9, 2.6, 0.4, 1, 1.5, 0.2, 0.02, 0, 0.6, 0.12, K_DOT, 1.4, 1); } });
    G.post.flash(1.5, _col.setRGB(1, 0.95, 0.85)); G.post.radialBlur = 1.6; G.post.punch(3);
    G.player.addTrauma(1.2); G.player.fovKick.kick(-26);
    G.timeScale = 0.22; G.timeScaleTarget = 0.3;
    G.hand.setPose('fist'); G.hand.kick(0, -0.6, 0.5, -2, 0, 0); G.hand.trembleTarget = 0;
    G.audio?.muffle(700, 0.05); fx.after(0.5, () => G.audio?.muffle(20000, 1.4));
    G.audio?.play('thunder_big', { vol: 1 });
  }
}

function P_trailDark(P, a, b) {
  const n = 3;
  for (let i = 0; i < n; i++) { const t = (i + Math.random()) / n; P.spawn(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t), 0, 0, 0, 0.5, 0.9, 0.2, 0.02, 0.0, 0.05, 0.85, 0.05, 0.0, 0.1, 0, 1, 0, K_PUFF, 0.1, 0, 1, 0.03, 0.1); }
}
