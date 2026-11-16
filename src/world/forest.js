// Forests: thousands of instanced trees that react to magic. They topple away from blasts, burn and
// spread fire, freeze, can be uprooted into real rigid bodies, and can be grown back by creation spells.
// Also the grass wildfire: a spreading fire front painted into the terrain state map.
import * as THREE from 'three';
import { G, LAYER_SCENE } from '../core/globals.js';
import { makeRng, rand, rr, fbm2, clamp, smoothstep, sat } from '../core/util.js';
import { occupied, WORLD_R, LAKES } from './layout.js';
import { K_PUFF, K_DOT } from '../fx/particles.js';
import { loadTreeAssets, makeTreeVariants, foliageMaterial, foliageDepthMaterial, barkMaterial, treeUniforms } from './treekit.js';

const MAX = 7600, CELL = 24, LOD_DIST = 170;
const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _ax = new THREE.Vector3(), _c = new THREE.Color(), _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const CHAR = new THREE.Color(0.02, 0.016, 0.012), RIME = new THREE.Color(0.75, 0.87, 0.98), BARK_CHAR = new THREE.Color(0.06, 0.05, 0.045), BARK_RIME = new THREE.Color(1.9, 2.1, 2.4);

function noisyGeo(geo, amp, seed) {
  const pos = geo.attributes.position, r = makeRng(seed), map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 200)},${Math.round(pos.getY(i) * 200)},${Math.round(pos.getZ(i) * 200)}`;
    let d = map.get(k); if (d === undefined) { d = 1 + (r() - 0.5) * amp; map.set(k, d); }
    pos.setXYZ(i, pos.getX(i) * d, pos.getY(i) * (1 + (d - 1) * 0.4), pos.getZ(i) * d);
  }
  geo.computeVertexNormals();
  return geo;
}

export class Forest {
  constructor() { this.trees = []; this.grid = new Map(); this.active = new Set(); this.burning = 0; this.fires = []; this.fireT = 0; this.soundT = 0; }

  async load() { this.assets = await loadTreeAssets(); return this; }

  build() {
    const A = this.assets;
    const fMat = foliageMaterial(A.atlas), dMat = foliageDepthMaterial(A.atlas);
    const bark = { bark: barkMaterial(A.tex.bark_diff, A.tex.bark_nor), pinebark: barkMaterial(A.tex.pinebark_diff, A.tex.pinebark_nor) };
    const mk = (geo, mat) => { const im = new THREE.InstancedMesh(geo, mat, MAX); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.layers.set(LAYER_SCENE); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); for (let i = 0; i < MAX; i++) im.setColorAt(i, _c.setRGB(1, 1, 1)); G.scene.add(im); return im; };
    // every species is one instanced crown mesh and one instanced trunk-and-limbs mesh
    // every species has a full mesh (near) and a light one (far); both are refilled every frame by cull()
    this.variants = makeTreeVariants().map((v) => {
      const set = (fgeo, tgeo, shadows) => {
        const fx = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2); fx.setUsage(THREE.DynamicDrawUsage);
        fgeo.setAttribute('aFx', fx);                          // per tree: leaves burnt away, frost
        const fol = mk(fgeo, fMat), trunk = mk(tgeo, bark[v.bark]); fol.customDepthMaterial = dMat;
        trunk.instanceMatrix = fol.instanceMatrix;             // (one transform buffer for both)
        fol.castShadow = trunk.castShadow = shadows;
        return { fol, trunk, fx, m: fol.instanceMatrix.array, c: fol.instanceColor.array, tc: trunk.instanceColor.array, f: fx.array };
      };
      return { ...v, n: 0, near: set(v.foliage, v.trunk, true), far: set(v.foliageLo, v.trunkLo, false),
        mat: new Float32Array(MAX * 16), pos: new Float32Array(MAX * 4).fill(-1), col: new Float32Array(MAX * 3), tcol: new Float32Array(MAX * 3), fxm: new Float32Array(MAX * 2) };
    });
    this._populate();
    for (const t of this.trees) this._place(t);
    this._flush(true);
    console.log(`[game] forest: ${this.trees.length} trees (${this.variants.map((v) => v.n).join(' / ')}), ${A.counts.join('/')} leaf, frond and twig scans`);
    return this;
  }

  _populate() {
    const rng = makeRng(4711), Tn = G.terrain;
    let tries = 0;
    while (this.trees.length < 5200 && tries++ < 90000) {
      const a = rng() * Math.PI * 2, rad = Math.sqrt(rng()) * (WORLD_R + 30), x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      // forests are noise blobs, with scattered singles in between
      const f = fbm2(x * 0.0085 + 40, z * 0.0085 - 13, 3);
      const dens = smoothstep(0.0, 0.22, f) * 0.95 + 0.035;
      if (rng() > dens) continue;
      if (occupied(x, z, 7)) continue;
      const n = Tn.normalAt(x, z, _v); if (n.y < 0.86) continue;
      this.addTree(x, z, f > 0.12 ? (rng() < 0.78 ? 'pine' : 'oak') : rng() < 0.4 ? 'pine' : 'oak', 0.75 + rng() * 0.7, 1, rng);
    }
  }

  addTree(x, z, type, size = 1, grow = 1, rng = Math.random) {
    if (this.trees.length >= MAX) return null;
    const y = G.terrain.heightAt(x, z);
    const pine = type === 'pine';
    const vi = pine ? (rng() < 0.55 ? 3 : 4) : rng() < 0.3 ? 2 : rng() < 0.5 ? 0 : 1, vr = this.variants[vi];
    const h = vr.height * size * (0.9 + rng() * 0.2), g = 0.86 + rng() * 0.26, hue = rng() - 0.5;
    const t = {
      x, y, z, h, r: vr.crownR * h, type, size, vi, slot: vr.n++, wide: 0.9 + rng() * 0.24, yaw: rng() * 6.28, grow, state: 0, burn: 0, burnt: 0, frozen: 0, ang: 0, vel: 0, fx: 1, fz: 0,
      col: new THREE.Color(g * (1 + hue * 0.14), g, g * (1 - hue * 0.2) * (pine ? 0.95 : 0.88)), collider: null, lean: (rng() - 0.5) * 0.07,
    };
    this.trees.push(t);
    const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let c = this.grid.get(k); if (!c) this.grid.set(k, (c = [])); c.push(t);
    const P = G.physics, R = P.RAPIER, th = h * 0.5;
    t.collider = P.world.createCollider(R.ColliderDesc.cylinder(th / 2, 0.32 * size).setTranslation(x, y + th / 2, z).setCollisionGroups(P.GROUP_TERRAIN));
    t.collider._tree = t;
    if (grow < 1) this.active.add(t);
    return t;
  }

  // Every tree's transform and colours live in plain arrays (one set per species). cull() copies the trees that
  // can be seen into the instanced meshes each frame: the full mesh for near trees, a light one for far trees.
  _place(t) {
    const vr = this.variants[t.vi], s = t.slot, P = vr.pos;
    if (t.state === 3) { P[s * 4 + 3] = -1; return; }           // gone
    const g = t.grow * t.grow * (3 - 2 * t.grow), h = Math.max(0.02, t.h * g);
    // base transform: lean / fall about a ground axis perpendicular to the fall direction
    _ax.set(t.fz, 0, -t.fx); _q.setFromAxisAngle(_ax, t.ang + t.lean); _q2.setFromAxisAngle(UP, t.yaw); _q.multiply(_q2);
    _m.compose(_p.set(t.x, t.y - 0.1, t.z), _q, _s.set(h * t.wide, h, h * t.wide));
    _m.toArray(vr.mat, s * 16);
    P[s * 4] = t.x; P[s * 4 + 1] = t.y + h * 0.5; P[s * 4 + 2] = t.z; P[s * 4 + 3] = h * 1.1;   // bounding sphere (covers it lying down too)
    vr.fxm[s * 2] = t.burnt; vr.fxm[s * 2 + 1] = t.frozen;      // (a burnt-out tree's leaves are all discarded: a bare black skeleton)
    // colour: alive green -> glowing embers -> charred
    const b = sat(t.burn / 6);
    _c.copy(t.col).lerp(CHAR, Math.max(b, t.burnt)).toArray(vr.col, s * 3);
    _c.setRGB(1, 1, 1).lerp(BARK_CHAR, Math.max(b * 0.8, t.burnt)).lerp(BARK_RIME, t.frozen * 0.7).toArray(vr.tcol, s * 3);
  }
  _flush() {}
  cull() {
    const cam = G.camera, e = cam.position, ex = e.x, ey = e.y, ez = e.z;
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    const pl = _fr.planes, FAR2 = LOD_DIST * LOD_DIST;
    let shown = 0;
    for (const v of this.variants) {
      const P = v.pos, M = v.mat, C = v.col, TC = v.tcol, FX = v.fxm, n = v.n;
      const sets = [v.near, v.far], cnt = [0, 0];
      for (let s = 0; s < n; s++) {
        const r = P[s * 4 + 3]; if (r < 0) continue;
        const x = P[s * 4], y = P[s * 4 + 1], z = P[s * 4 + 2], dx = x - ex, dy = y - ey, dz = z - ez, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 3600) {
          // outside the view? (near trees get a generous margin: their shadows may reach into it)
          const rr = d2 < 48400 ? r + 45 : r; let out = false;
          for (let p = 0; p < 6; p++) { const q = pl[p], N = q.normal; if (N.x * x + N.y * y + N.z * z + q.constant < -rr) { out = true; break; } }
          if (out) continue;
        }
        const k = d2 > FAR2 ? 1 : 0, S = sets[k], i = cnt[k]++, o = s * 16, d = i * 16, A = S.m;
        A[d] = M[o]; A[d + 1] = M[o + 1]; A[d + 2] = M[o + 2]; A[d + 3] = M[o + 3]; A[d + 4] = M[o + 4]; A[d + 5] = M[o + 5]; A[d + 6] = M[o + 6]; A[d + 7] = M[o + 7];
        A[d + 8] = M[o + 8]; A[d + 9] = M[o + 9]; A[d + 10] = M[o + 10]; A[d + 11] = M[o + 11]; A[d + 12] = M[o + 12]; A[d + 13] = M[o + 13]; A[d + 14] = M[o + 14]; A[d + 15] = M[o + 15];
        const c3 = s * 3, d3 = i * 3; S.c[d3] = C[c3]; S.c[d3 + 1] = C[c3 + 1]; S.c[d3 + 2] = C[c3 + 2]; S.tc[d3] = TC[c3]; S.tc[d3 + 1] = TC[c3 + 1]; S.tc[d3 + 2] = TC[c3 + 2];
        S.f[i * 2] = FX[s * 2]; S.f[i * 2 + 1] = FX[s * 2 + 1];
      }
      for (let k = 0; k < 2; k++) {
        const S = sets[k], c = cnt[k]; shown += c;
        S.fol.count = S.trunk.count = c; S.fol.visible = S.trunk.visible = c > 0;
        if (!c) continue;
        for (const [a, per] of [[S.fol.instanceMatrix, 16], [S.fol.instanceColor, 3], [S.trunk.instanceColor, 3], [S.fx, 2]]) { a.clearUpdateRanges(); a.addUpdateRange(0, c * per); a.needsUpdate = true; }
      }
    }
    this.shown = shown;
  }
  _dropCollider(t) { if (t.collider) { G.physics.world.removeCollider(t.collider, false); t.collider = null; } }

  each(x, z, r, fn) {
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL), r2 = r * r;
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const cell = this.grid.get(`${cx},${cz}`); if (!cell) continue;
      for (const t of cell) { if (t.state === 3) continue; const dx = t.x - x, dz = t.z - z, d2 = dx * dx + dz * dz; if (d2 < r2) fn(t, Math.sqrt(d2), dx, dz); }
    }
  }

  // ---- reactions -----------------------------------------------------------------
  topple(t, dx, dz, vel = 1.5) {
    if (t.state !== 0) return;
    const l = Math.hypot(dx, dz) || 1;
    t.state = 1; t.fx = dx / l; t.fz = dz / l; t.vel = vel; this._dropCollider(t); this.active.add(t);
    if (G.realTime - this.soundT > 0.45) { this.soundT = G.realTime; G.audio?.sample(['tree_fall', 'tree_fall2'], { vol: 0.5, pos: _p.set(t.x, t.y, t.z), size: 3, rate: rr(0.85, 1.15) }); }
  }
  vaporize(t, splinters = true) {
    if (t.state === 3) return;
    t.state = 3; this._dropCollider(t); this._place(t); this.active.delete(t);
    if (splinters && G.fx) { _p.set(t.x, t.y + t.h * 0.4, t.z); G.fx.dust(_p, 3, 6, 1.6, 1.6, [0.3, 0.24, 0.16], 0.4, 0.7); if (rand() < 0.5) G.physics.spawnRubble(_p, 2, 12, 0.5, 'wood', 0, 0.8); }
    G.addScore?.(2);
  }
  // turn a tree into a real log the physics engine can throw around (tornado, black hole, telekinesis)
  uproot(t) {
    if (t.state === 3) return null;
    const b = G.physics.add({ shape: 'cyl', mat: 'wood', x: t.x, y: t.y + t.h * 0.3, z: t.z, sx: 0.8 * t.size, sy: t.h * 0.55, sz: 0.8 * t.size, sleeping: false, tint: 0.6, struct: false });
    this.vaporize(t, false);
    return b;
  }
  ignite(t) { if (t.state === 3 || t.burn > 0 || t.burnt >= 1 || this.burning > 320) return; t.burn = 0.01; t.frozen = 0; this.burning++; this.active.add(t); }
  blast(pos, radius, strength = 1, heat = 0) {
    this.each(pos.x, pos.z, radius, (t, d, dx, dz) => {
      const k = 1 - d / radius;
      if (k > 0.72) this.vaporize(t); else { this.topple(t, dx, dz, 0.9 + k * 3.2 * strength); if (heat > 0 && rand() < heat * (0.3 + k)) this.ignite(t); }
    });
  }
  igniteArea(x, z, r, prob = 1) { this.each(x, z, r, (t) => { if (rand() < prob) this.ignite(t); }); }
  extinguish(x, z, r) { this.each(x, z, r, (t) => { if (t.burn > 0) { t.burn = 0; this.burning--; t.burnt = Math.max(t.burnt, 0.35); this._place(t); } }); this.fires = this.fires.filter((f) => (f.x - x) ** 2 + (f.z - z) ** 2 > r * r); }
  frostArea(x, z, r) { this.each(x, z, r, (t) => { if (t.burn > 0) { t.burn = 0; this.burning--; } t.frozen = 1; this._place(t); }); this.fires = this.fires.filter((f) => (f.x - x) ** 2 + (f.z - z) ** 2 > r * r); }
  thawArea(x, z, r) { this.each(x, z, r, (t) => { if (t.frozen) { t.frozen = 0; this._place(t); } }); }
  // sprout new trees (creation magic)
  grow(x, z, r, count) {
    let n = 0, tries = 0;
    const e = G.player?.pos;                                   // never sprout a tree on top of the caster
    while (n < count && tries++ < count * 6) {
      const a = rand() * 6.28, d = Math.sqrt(rand()) * r, tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
      if (Math.hypot(tx, tz) > WORLD_R + 20 || LAKES.some((l) => Math.hypot(tx - l.x, tz - l.z) < l.r)) continue;
      if (e && Math.hypot(tx - e.x, tz - e.z) < 14) continue;
      const t = this.addTree(tx, tz, rand() < 0.5 ? 'pine' : 'oak', rr(0.7, 1.35), 0.02);
      if (!t) break;
      t.growDelay = d / r * 1.6 + rand() * 0.5; n++;
    }
    return n;
  }
  // re-seat trees on reshaped ground
  settle(x, z, r) { this.each(x, z, r, (t) => { t.y = G.terrain.heightAt(t.x, t.z); this._place(t); }); }
  // restore every tree (Restoration)
  restoreAll() {
    for (const t of this.trees) {
      if (t.state === 0 && !t.burn && !t.burnt && !t.frozen) continue;
      const gone = t.state !== 0;
      t.state = 0; t.burn = 0; t.burnt = 0; t.frozen = 0; t.ang = 0; t.vel = 0;
      if (gone) { t.grow = 0.02; t.growDelay = rand() * 1.5; this.active.add(t); }
      if (!t.collider) { const P = G.physics, th = t.h * 0.5; t.collider = P.world.createCollider(P.RAPIER.ColliderDesc.cylinder(th / 2, 0.32 * t.size).setTranslation(t.x, t.y + th / 2, t.z).setCollisionGroups(P.GROUP_TERRAIN)); t.collider._tree = t; }
      this._place(t);
    }
    this.burning = 0; this.fires = [];
  }

  // ---- grass wildfire ------------------------------------------------------------
  igniteGround(x, z, budget = 26) { if (this.fires.length < 420) this.fires.push({ x, z, t: 0, gen: budget }); }

  update(dt) {
    this.cull();
    if (dt <= 0) return;
    const fx = G.fx, P = fx?.P, cam = G.camera.position, Tn = G.terrain, wet = G.sky?.rain > 0.4;
    // wind and the light that shines through the leaves
    treeUniforms.uTimeF.value = G.time; treeUniforms.uWindF.value = 1 + (G.sky?.storm || 0) * 3.5;
    if (G.sunDir) treeUniforms.uSunDirF.value.copy(G.sunDir);
    if (G.sky?.sun) treeUniforms.uSunColF.value.copy(G.sky.sun.color).multiplyScalar(G.sky.sun.intensity / (G.sky.baseSun || 1));
    for (const t of this.active) {
      let keep = false;
      if (t.grow < 1) { if (t.growDelay > 0) t.growDelay -= dt; else t.grow = Math.min(1, t.grow + dt / 2.4); keep = t.grow < 1; if (P && rand() < 0.3) P.spawn(t.x + rr(-1, 1), t.y + t.h * t.grow * rr(0.2, 1), t.z + rr(-1, 1), rr(-0.5, 0.5), rr(0.5, 2), rr(-0.5, 0.5), rr(0.6, 1.2), 0.09, 0.02, 2, 9, 2.5, 1, 0.5, 4, 0.6, 0.2, 1, -0.1, K_DOT, 0.5, 1); }
      if (t.state === 1) {
        t.vel += Math.sin(Math.max(0.05, t.ang)) * 3.2 * dt; t.ang += t.vel * dt;
        if (t.ang >= 1.47) { t.ang = 1.47; if (t.vel > 1.2) { t.vel *= -0.22; if (fx && cam.distanceToSquared(_p.set(t.x + t.fx * t.h * 0.6, t.y, t.z + t.fz * t.h * 0.6)) < 160 * 160) { fx.dust(_p, 4, 5, 1.8, 2, [0.4, 0.35, 0.28], 0.35, 0.3); G.player.shakeFrom(_p, 0.12, 45); } } else t.state = 2; }
        keep = keep || t.state === 1;
      }
      if (t.burn > 0) {
        t.burn += dt * (wet ? 3 : 1); keep = true;
        const near = cam.distanceToSquared(_p.set(t.x, t.y, t.z)) < 260 * 260;
        if (P && near && !wet) {
          // flames wrap the crown (or the fallen trunk)
          const k = t.state === 0 ? 1 : 0.3, n = t.burn < 7 ? 2 : 1;
          for (let i = 0; i < n; i++) {
            const hh = t.h * rr(0.35, 0.95) * k, ox = t.state === 0 ? rr(-1, 1) * t.r * 0.7 : t.fx * t.h * rr(0.2, 0.9), oz = t.state === 0 ? rr(-1, 1) * t.r * 0.7 : t.fz * t.h * rr(0.2, 0.9);
            const s = rr(1.4, 2.6) * t.size;
            P.spawn(t.x + ox, t.y + hh, t.z + oz, rr(-0.6, 0.6), rr(2, 4.5), rr(-0.6, 0.6), rr(0.5, 1.0), s, s * 0.4, 4.4, 1.4, 0.22, 0.85, 1.2, 0.12, 0.01, 0, 0.9, -0.45, K_PUFF, 0.45, 1, rr(-2, 2), 0.03, 0.15);
          }
          if (rand() < 0.22) { const s = rr(2.5, 4); P.spawn(t.x, t.y + t.h * k, t.z, rr(0.4, 1.4), rr(3, 5.5), rr(0.2, 1), rr(4, 7), s, s * 3.6, 0.05, 0.047, 0.045, 0.55, 0.13, 0.125, 0.12, 0, 0.35, -0.12, K_PUFF, 0.5, 0, rr(-0.3, 0.3), 0.03, 0.12); }
          if (rand() < 0.12) P.spawn(t.x, t.y + t.h * 0.7 * k, t.z, rr(-2, 2), rr(3, 8), rr(-2, 2), rr(1.5, 3.5), 0.07, 0.02, 10, 3, 0.5, 1, 3, 0.4, 0, 0, 0.5, -0.25, K_DOT, 1.5, 1);
        }
        if (rand() < dt * 0.8) Tn.scorch(t.x + rr(-2, 2), t.z + rr(-2, 2), rr(2, 3.6), 0.5, 0.7);
        if (!wet && rand() < dt * 0.55) this.each(t.x, t.z, 10, (o) => { if (o !== t && rand() < 0.22) this.ignite(o); });
        if (!wet && rand() < dt * 0.35) this.igniteGround(t.x + rr(-3, 3), t.z + rr(-3, 3), 10);
        if (t.burn > 6) t.burnt = Math.min(1, t.burnt + dt * 0.4);
        if (t.burn > 10 || (wet && t.burn > 2)) { t.burn = 0; this.burning--; keep = t.state === 1 || t.grow < 1; }
      }
      this._place(t);
      if (!keep) this.active.delete(t);
    }
    // grass fire front
    this.fireT -= dt;
    const tick = this.fireT <= 0; if (tick) this.fireT = 0.22;
    if (this.fires.length) {
      const ctl = Tn.controlData, MAPN = 1024, SIZE = 1024;
      for (const f of this.fires) {
        f.t += dt;
        if (P && cam.distanceToSquared(_p.set(f.x, 0, f.z).setY(cam.y)) < 200 * 200 && rand() < 0.7) {
          const y = Tn.heightAt(f.x, f.z), s = rr(0.8, 1.7);
          P.spawn(f.x + rr(-1.2, 1.2), y + 0.2, f.z + rr(-1.2, 1.2), rr(-0.4, 0.4), rr(1.5, 3.4), rr(-0.4, 0.4), rr(0.4, 0.8), s, s * 0.3, 4.4, 1.4, 0.22, 0.85, 1.3, 0.14, 0.01, 0, 0.9, -0.4, K_PUFF, 0.35, 1, rr(-2, 2), 0.03, 0.15);
          if (rand() < 0.1) P.spawn(f.x, y + 1, f.z, rr(0.3, 1.2), rr(1.5, 2.6), rr(0.2, 0.9), rr(2.5, 4.5), 1.6, 5, 0.05, 0.047, 0.045, 0.4, 0.13, 0.125, 0.12, 0, 0.5, -0.2, K_PUFF, 0.5, 0, 0.3, 0.03, 0.2);
        }
        if (!tick) continue;
        Tn.scorch(f.x, f.z, 2.6, 0.7, 0.85);
        if (f.t > 0.5 && !f.spread) {
          f.spread = true;
          if (f.gen > 0 && !wet) {
            for (let k = 0; k < 3; k++) {
              const a = rand() * 6.28, d = rr(3, 4.6), nx = f.x + Math.cos(a) * d + 0.9, nz = f.z + Math.sin(a) * d + 0.6; // wind drifts it north-east
              const i = clamp(((nx / SIZE + 0.5) * MAPN) | 0, 0, MAPN - 1), j = clamp(((nz / SIZE + 0.5) * MAPN) | 0, 0, MAPN - 1), q = (i + j * MAPN) * 4;
              if (ctl[q + 2] < 110 || Tn.stateData[q] > 70 || Tn.stateData[q + 2] > 80 || rand() > 0.62) continue;
              this.igniteGround(nx, nz, f.gen - 1);
            }
            if (rand() < 0.3) this.igniteArea(f.x, f.z, 4, 0.6);
          }
        }
      }
      if (tick) this.fires = this.fires.filter((f) => f.t < (wet ? 0.6 : 2.6));
    }
    this._flush();
  }
}
