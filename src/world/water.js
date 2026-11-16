// Water: a real-time shallow-water simulation over the whole realm.
//
// Every lake, the Greywater reservoir and the river Aldwater are one body of simulated water on a
// 512 x 512 grid of 2 m cells. Water runs downhill, pools in hollows, overtops banks, pours through
// breaches and carries what it meets. It reads the live terrain, so craters fill, fissures drain lakes and
// raised ground dams rivers; masonry registered as an obstacle (the dam) holds water back until its blocks
// are knocked out of place.
//
// Solver: the inertial long-wave scheme used for flood modelling (Bates et al. 2010): a unit-width flux on
// every cell face is accelerated by the water-surface slope and held back by Manning friction, then
// depths are updated from the face fluxes. Fluxes are limited so a cell can never lose more water than it
// holds, which keeps wetting/drying fronts stable. Only tiles that are doing something are simulated.
import * as THREE from 'three';
import { G, LAYER_SCENE } from '../core/globals.js';
import { LAKES, RESERVOIR, RIVER, riverAt } from './layout.js';
import { TERRAIN_CONST } from './terrain.js';
import { rr, rand } from '../core/util.js';
import { K_PUFF, K_DOT } from '../fx/particles.js';

const FN = 512, L = 2, HALF = 512;            // grid size, cell size (m), half the world
const TS = 16, TN = FN / TS;                  // tile size (cells), tiles per side
const GRAV = 9.81, MANN2 = 0.042 * 0.042, VMAX = 24, DRY = 0.012, WET = 0.03;
const TH = 0.8, TH2 = (1 - TH) / 2;           // flux smoothing (see step A)
const DENS = { wood: 0.6, plaster: 1.4, roof: 1.8, ashlar: 2.4, stone: 2.4, ice: 0.9 };
const _p = new THREE.Vector3();

export class Water {
  constructor() {
    const n = FN * FN;
    this.tb = new Float32Array(n);            // terrain height at the cell centre
    this.ob = new Float32Array(n).fill(-1e9); // top of any obstacle (dam masonry) standing in the cell
    this.b = new Float32Array(n);             // effective bed = max(terrain, obstacle)
    this.d = new Float32Array(n);             // water depth
    this.qx = new Float32Array(n);            // unit-width flux across the face to cell i+1
    this.qz = new Float32Array(n);            // ... to cell j+1
    this.ks = new Float32Array(n).fill(1);
    this.vx = new Float32Array(n); this.vz = new Float32Array(n);
    this.foam = new Float32Array(n); this.ice = new Float32Array(n);
    this.perm = new Uint8Array(n);            // permanent water (no seepage)
    this.wm = new Uint8Array(n);
    this.tAct = new Uint8Array(TN * TN); this.tMark = new Uint8Array(TN * TN); this.sim = [];
    this.dRef = new Float32Array(n); this.tCnt = new Uint8Array(TN * TN); this.tFoam = new Float32Array(TN * TN);   // steady-state detection, foam per tile
    this.acc = 0; this.tick = 0;
    this.obstacles = []; this.obCells = new Map();
    this.sources = []; this.time = 0; this.roar = 0; this.rr = 0; this.treeI = 0; this.volume = 0; this.breach = 0;
  }

  // ---------------------------------------------------------------- set-up
  build() {
    const n = FN * FN;
    this.dataA = new Float32Array(n * 4);     // R surface elevation, G depth, B/A velocity
    this.dataB = new Uint8Array(n * 4);       // R foam, G ice, B wet
    this.texA = new THREE.DataTexture(this.dataA, FN, FN, THREE.RGBAFormat, THREE.FloatType);
    this.texA.minFilter = this.texA.magFilter = THREE.LinearFilter; this.texA.wrapS = this.texA.wrapT = THREE.ClampToEdgeWrapping;
    this.texB = new THREE.DataTexture(this.dataB, FN, FN, THREE.RGBAFormat);
    this.texB.minFilter = this.texB.magFilter = THREE.LinearFilter;
    this.readTerrain(0, 0, FN - 1, FN - 1);
    this._makeMesh();
    this.fillAll(false);
    return this;
  }

  cell(x, z) { const i = Math.floor((x + HALF) / L), j = Math.floor((z + HALF) / L); return i < 0 || j < 0 || i >= FN || j >= FN ? -1 : i + j * FN; }

  readTerrain(i0, j0, i1, j1) {
    const H = G.terrain.heights, VN = TERRAIN_CONST.VN, { tb, ob, b } = this;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = i + j * FN, h = H[2 * i + 1 + (2 * j + 1) * VN]; tb[c] = h; b[c] = h > ob[c] ? h : ob[c]; }
  }
  // the terrain was reshaped inside this world-space box
  terrainChanged(x0, z0, x1, z1) {
    const i0 = Math.max(0, Math.floor((x0 + HALF) / L) - 1), i1 = Math.min(FN - 1, Math.floor((x1 + HALF) / L) + 1);
    const j0 = Math.max(0, Math.floor((z0 + HALF) / L) - 1), j1 = Math.min(FN - 1, Math.floor((z1 + HALF) / L) + 1);
    if (i0 > i1 || j0 > j1) return;
    this.readTerrain(i0, j0, i1, j1); this.wakeCells(i0, j0, i1, j1);
  }
  wakeCells(i0, j0, i1, j1, frames = 90) {
    const a0 = Math.max(0, (i0 / TS) | 0), a1 = Math.min(TN - 1, (i1 / TS) | 0), b0 = Math.max(0, (j0 / TS) | 0), b1 = Math.min(TN - 1, (j1 / TS) | 0);
    for (let tz = b0; tz <= b1; tz++) for (let tx = a0; tx <= a1; tx++) { const t = tx + tz * TN; if (this.tAct[t] < frames) this.tAct[t] = frames; }
  }
  wake(x, z, r) { this.wakeCells(Math.floor((x - r + HALF) / L), Math.floor((z - r + HALF) / L), Math.floor((x + r + HALF) / L), Math.floor((z + r + HALF) / L)); }

  // flood-fill a basin from (x, z) up to `level`. Masonry (obstacle cells) always bounds the basin, even
  // where it is lower than the level, so a reservoir is filled behind its dam and not through the spillway.
  fillBasin(x, z, level) {
    const s = this.cell(x, z); if (s < 0 || this.b[s] >= level) return 0;
    const { d, ob } = this, b = new Float32Array(this.b), seen = new Uint8Array(FN * FN), q = [s]; seen[s] = 1; let n = 0;
    for (let c = 0; c < b.length; c++) if (ob[c] > -1e8) b[c] = 1e9;
    while (q.length) {
      const c = q.pop(), i = c % FN, j = (c / FN) | 0;
      if (level - b[c] > d[c]) d[c] = level - b[c]; n++;
      if (i > 0 && !seen[c - 1] && b[c - 1] < level) { seen[c - 1] = 1; q.push(c - 1); }
      if (i < FN - 1 && !seen[c + 1] && b[c + 1] < level) { seen[c + 1] = 1; q.push(c + 1); }
      if (j > 0 && !seen[c - FN] && b[c - FN] < level) { seen[c - FN] = 1; q.push(c - FN); }
      if (j < FN - 1 && !seen[c + FN] && b[c + FN] < level) { seen[c + FN] = 1; q.push(c + FN); }
    }
    return n;
  }

  // (re)create the realm's water: lakes, the reservoir behind its dam, the river; then let it settle
  fillAll(prewarm = true) {
    const { d, qx, qz, vx, vz, foam, ice, perm, tAct } = this;
    d.fill(0); qx.fill(0); qz.fill(0); vx.fill(0); vz.fill(0); foam.fill(0); ice.fill(0); perm.fill(0); tAct.fill(0);
    for (const k of LAKES) this.fillBasin(k.x, k.z, k.level);
    if (this.obstacles.length) this.fillBasin(RESERVOIR.x, RESERVOIR.z, RESERVOIR.level);
    // the river bed downstream of the dam starts with its normal depth of water
    const bx = RIVER.box;
    for (let j = Math.max(0, Math.floor((bx[1] - 20 + HALF) / L)); j <= Math.min(FN - 1, Math.floor((bx[3] + 20 + HALF) / L)); j++) for (let i = Math.max(0, Math.floor((bx[0] - 20 + HALF) / L)); i <= Math.min(FN - 1, Math.floor((bx[2] + 20 + HALF) / L)); i++) {
      const c = i + j * FN, rv = riverAt(-HALF + i * L + 1, -HALF + j * L + 1, RIVER.half + 4);
      if (!rv || rv.u >= RIVER.uDam - 3) continue;
      const s = RIVER.surfAt(rv.u) - 0.25; if (s - this.b[c] > d[c]) d[c] = s - this.b[c];
    }
    // spring that keeps the reservoir topped up, and the lake's outflow
    const disc = (x, z, r) => { const out = []; for (let j = Math.floor((z - r + HALF) / L); j <= Math.floor((z + r + HALF) / L); j++) for (let i = Math.floor((x - r + HALF) / L); i <= Math.floor((x + r + HALF) / L); i++) { const cx = -HALF + i * L + 1, cz = -HALF + j * L + 1; if ((cx - x) ** 2 + (cz - z) ** 2 < r * r) out.push(i + j * FN); } return out; };
    const mm = LAKES.find((k) => k.id === 'mirrormere');
    this.sources = [];
    if (this.obstacles.length) this.sources.push({ cells: disc(RESERVOIR.x + 14, RESERVOIR.z - 16, 10), probe: this.cell(RESERVOIR.x, RESERVOIR.z), level: RESERVOIR.level, max: 34, sign: 1 });
    if (mm) this.sources.push({ cells: disc(mm.x, mm.z, 14), probe: this.cell(mm.x, mm.z), level: mm.level, max: 46, sign: -1 });
    this._wakeWet();
    if (prewarm && this.obstacles.length) { const t0 = performance.now(); this.quiet = true; for (let i = 0; i < 900; i++) this.step(1 / 20); this.quiet = false; console.log(`[game] water settled in ${(performance.now() - t0).toFixed(0)} ms, ${this.sim.length} tiles awake`); }
    for (let c = 0; c < d.length; c++) if (d[c] > WET) perm[c] = 1;
    this._wakeWet();
    // remember the settled realm so Restoration can bring it back instantly
    if (prewarm && this.obstacles.length) this.snap = { d: d.slice(), qx: qx.slice(), qz: qz.slice(), vx: vx.slice(), vz: vz.slice(), perm: perm.slice(), tAct: tAct.slice(), foam: foam.slice(), tFoam: this.tFoam.slice() };
    this._upload(true);
  }
  reset() {
    const s = this.snap; if (!s) return this.fillAll(true);
    this.d.set(s.d); this.qx.set(s.qx); this.qz.set(s.qz); this.vx.set(s.vx); this.vz.set(s.vz); this.perm.set(s.perm); this.tAct.set(s.tAct);
    this.foam.set(s.foam); this.tFoam.set(s.tFoam); this.dRef.set(s.d); this.ice.fill(0); this._upload(true);
  }
  _wakeWet() { const { d, tAct } = this; tAct.fill(0); for (let c = 0; c < d.length; c++) if (d[c] > 0) tAct[((c % FN) / TS | 0) + (((c / FN) | 0) / TS | 0) * TN] = 60; }

  // ---------------------------------------------------------------- obstacles (the dam)
  // A block registered here holds water back for as long as it stays where it was built.
  // `flow` = {tx, tz}: the direction the held-back water would run (lets a wall worn thin burst under pressure).
  addObstacle(blk, flow = null) {
    const o = { blk, x: blk.x, y: blk.y, z: blk.z, top: blk.y + blk.sy / 2, cells: [], on: true, tx: flow?.tx, tz: flow?.tz };
    const r = blk.body.rotation(), yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)), cs = Math.cos(yaw), sn = Math.sin(yaw);
    const hx = blk.sx / 2 + 0.75, hz = blk.sz / 2 + 0.75, R = Math.hypot(hx, hz);
    for (let j = Math.floor((blk.z - R + HALF) / L); j <= Math.floor((blk.z + R + HALF) / L); j++) for (let i = Math.floor((blk.x - R + HALF) / L); i <= Math.floor((blk.x + R + HALF) / L); i++) {
      if (i < 0 || j < 0 || i >= FN || j >= FN) continue;
      const dx = -HALF + i * L + 1 - blk.x, dz = -HALF + j * L + 1 - blk.z, lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      if (Math.abs(lx) > hx || Math.abs(lz) > hz) continue;
      const c = i + j * FN; o.cells.push(c);
      let list = this.obCells.get(c); if (!list) this.obCells.set(c, (list = [])); list.push(o);
      if (o.top > this.ob[c]) { this.ob[c] = o.top; if (o.top > this.b[c]) this.b[c] = o.top; }
    }
    this.obstacles.push(o); blk.holding = true;
    return o;
  }
  clearObstacles() { this.obstacles = []; this.obCells.clear(); this.ob.fill(-1e9); this.b.set(this.tb); this.breach = 0; }
  _dropObstacle(o) {
    o.on = false; o.blk.holding = false;
    if (!this.quiet && ++this.breach === 8) {
      _p.set(o.x, o.y, o.z);
      G.audio?.sample('avalanche', { vol: 1.1, pos: _p, size: 14 }); G.audio?.sample('splash', { vol: 1.0, rate: 0.5, pos: _p, size: 14 }); G.audio?.sample('boom3', { vol: 0.8, pos: _p, size: 10 });
      G.player?.shakeFrom(_p, 0.8, 320);
    }
    for (const c of o.cells) {
      let top = -1e9; for (const p of this.obCells.get(c)) if (p.on && p.top > top) top = p.top;
      this.ob[c] = top; this.b[c] = this.tb[c] > top ? this.tb[c] : top;
      const i = c % FN, j = (c / FN) | 0; this.wakeCells(i - 1, j - 1, i + 1, j + 1, 240);
    }
  }

  // ---------------------------------------------------------------- gameplay API
  // what is at (x, z): null when dry, else { level (surface elevation), depth, vx, vz, speed, frozen }
  at(x, z) {
    const c = this.cell(x, z); if (c < 0 || this.d[c] < WET) return null;
    const vx = this.vx[c], vz = this.vz[c];
    return { level: this.b[c] + this.d[c], depth: this.d[c], vx, vz, speed: Math.hypot(vx, vz), frozen: this.ice[c], c };
  }
  each(x, z, r, fn) {
    for (let j = Math.max(0, Math.floor((z - r + HALF) / L)); j <= Math.min(FN - 1, Math.floor((z + r + HALF) / L)); j++) for (let i = Math.max(0, Math.floor((x - r + HALF) / L)); i <= Math.min(FN - 1, Math.floor((x + r + HALF) / L)); i++) {
      const cx = -HALF + i * L + 1, cz = -HALF + j * L + 1, dd = (cx - x) * (cx - x) + (cz - z) * (cz - z);
      if (dd < r * r) fn(i + j * FN, Math.sqrt(dd) / r, cx, cz);
    }
  }
  // add (or, with a negative volume, remove) water in a disc; returns the volume actually moved
  addWater(x, z, r, volume, shape = 1) {
    let w = 0; this.each(x, z, r, (c, q) => { w += Math.pow(1 - q * q, shape); });
    if (w <= 0) return 0;
    let moved = 0;
    this.each(x, z, r, (c, q) => {
      if (this.ice[c] > 0.5) return;
      const dd = (volume / w) * Math.pow(1 - q * q, shape) / (L * L), nd = Math.max(0, this.d[c] + dd);
      moved += (nd - this.d[c]) * L * L; this.d[c] = nd;
    });
    this.wake(x, z, r + 4);
    return moved;
  }
  // summon a body of water (Deluge): `depth` metres at the centre of a disc of radius r
  flood(x, z, r, depth) { return this.addWater(x, z, r, depth * Math.PI * r * r * 0.5, 1); }
  // drag water towards a point (Singularity); what reaches the middle is swallowed. Returns the volume swallowed.
  pull(x, z, r, acc, dt) {
    const { d, qx, qz } = this; let any = false;
    this.each(x, z, r, (c, q, cx, cz) => {
      if (d[c] < 0.08 || this.ice[c] > 0.5) return;
      any = true;
      const ti = (((c % FN) / TS) | 0) + ((((c / FN) | 0) / TS) | 0) * TN; if (this.tAct[ti] < 90) this.tAct[ti] = 90;
      const l = Math.hypot(cx - x, cz - z) || 1, f = (1 - q) * acc * Math.min(d[c], 4) * dt;
      qx[c] -= ((cx - x) / l) * f; qz[c] -= ((cz - z) / l) * f;
    });
    if (!any) return 0;
    this.wake(x, z, r + 6);
    return -this.addWater(x, z, 7, -acc * 14 * dt, 1);
  }
  // shove water outwards (explosions, Force Blast): a crater in the surface that rebounds as a ring wave
  impulse(x, z, r, strength = 1) {
    const { d, qx, qz } = this; let any = false;
    this.each(x, z, r, (c, q, cx, cz) => {
      if (d[c] < 0.08 || this.ice[c] > 0.5) return;
      any = true;
      const ti = (((c % FN) / TS) | 0) + ((((c / FN) | 0) / TS) | 0) * TN; if (this.tAct[ti] < 90) this.tAct[ti] = 90;
      const k = (1 - q) * strength, l = Math.hypot(cx - x, cz - z) || 1, f = k * Math.min(d[c], 3) * 5;
      qx[c] += ((cx - x) / l) * f; qz[c] += ((cz - z) / l) * f;
      this.foam[c] = Math.min(1, this.foam[c] + k);
    });
    return any;
  }
  freeze(x, z, r) { this.each(x, z, r, (c) => { if (this.d[c] > WET) { this.ice[c] = 1; this.qx[c] = this.qz[c] = 0; if (c > 0) this.qx[c - 1] = 0; if (c >= FN) this.qz[c - FN] = 0; this.vx[c] = this.vz[c] = 0; } }); this.wake(x, z, r + 4); }
  thaw(x, z, r) { let any = false; this.each(x, z, r, (c) => { if (this.ice[c] > 0) { this.ice[c] = 0; any = true; } }); if (any) this.wake(x, z, r + 4); }

  // something hit the water / an explosion went off in it: spray, sound, and a real wave
  splash(x, z, size = 1) {
    const w = this.at(x, z); if (!w || w.frozen > 0.5 || w.depth < 0.15) return false;
    this.impulse(x, z, 5 + size * 5, 0.5 + size * 0.9);
    if (this.quiet || !G.fx) return true;
    const P = G.fx.P, y = w.level;
    for (let i = 0; i < 26 * size; i++) { const a = rand() * 6.28, sp = rr(2, 9) * Math.sqrt(size); P.spawn(x, y + 0.2, z, Math.cos(a) * sp, rr(6, 18) * Math.sqrt(size), Math.sin(a) * sp, rr(0.8, 1.6), 0.5 * size, 2.2 * size, 0.75, 0.82, 0.86, 0.5, 0.75, 0.82, 0.86, 0, 0.6, 1.3, K_PUFF, 0.2, 0, rr(-1, 1), 0.03, 0.1); }
    for (let i = 0; i < 30 * size; i++) { const a = rand() * 6.28, sp = rr(3, 12); P.spawn(x, y + 0.3, z, Math.cos(a) * sp, rr(8, 22), Math.sin(a) * sp, rr(0.7, 1.5), 0.09, 0.04, 0.7, 0.78, 0.86, 0.9, 0.5, 0.58, 0.66, 0.4, 0.3, 1.5, K_DOT, 0, 0.15); }
    G.audio?.sample('splash', { vol: 0.7 * Math.min(1.4, size), pos: { x, y, z }, size: 3 });
    return true;
  }

  // ---------------------------------------------------------------- the solver
  step(dt) {
    const { b, d, qx, qz, ks, vx, vz, foam, ice, perm, tAct, tMark, sim } = this;
    sim.length = 0; tMark.fill(0);
    for (let t = 0; t < TN * TN; t++) {
      if (!tAct[t]) continue;
      const tx = t % TN, tz = (t / TN) | 0;
      for (let a = tz > 0 ? tz - 1 : 0; a <= (tz < TN - 1 ? tz + 1 : tz); a++) for (let e = tx > 0 ? tx - 1 : 0; e <= (tx < TN - 1 ? tx + 1 : tx); e++) { const n = e + a * TN; if (!tMark[n]) { tMark[n] = 1; sim.push(n); } }
    }
    if (!sim.length) return false;
    // springs and outflows hold their basins at level
    for (const s of this.sources) {
      if (!tMark[(((s.probe % FN) / TS) | 0) + ((((s.probe / FN) | 0) / TS) | 0) * TN]) continue;
      const surf = b[s.probe] + d[s.probe], q = Math.max(0, Math.min(s.max, (s.level - surf) * s.sign * 60));
      if (q <= 0) continue;
      const dd = (s.sign * q * dt) / (s.cells.length * L * L);
      for (const c of s.cells) { const nd = d[c] + dd; d[c] = nd > 0 ? nd : 0; }
    }
    const gdt = (GRAV * dt) / L, fr = GRAV * dt * MANN2, idt = dt / L, inv = 1 / dt;
    // A: accelerate the flux on every face
    for (let s = 0; s < sim.length; s++) {
      const t = sim[s], i0 = (t % TN) * TS, j0 = ((t / TN) | 0) * TS, i1 = i0 + TS, j1 = j0 + TS;
      for (let j = j0; j < j1; j++) {
        let c = i0 + j * FN;
        for (let i = i0; i < i1; i++, c++) {
          const bc = b[c], dc = d[c], ec = bc + dc, ok = ice[c] <= 0.5;
          if (i < FN - 1) {
            const n = c + 1, bn = b[n], dn = d[n], en = bn + dn, hf = (ec > en ? ec : en) - (bc > bn ? bc : bn);
            let q = 0;
            if (hf > DRY && ok && ice[n] <= 0.5) {
              q = qx[c]; if (i > 0) q = TH * q + TH2 * (qx[c - 1] + qx[n]);
              q = (q - gdt * hf * (en - ec)) / (1 + (fr * (q < 0 ? -q : q)) / (hf * hf * Math.cbrt(hf)));
              const m = hf * VMAX; if (q > m) q = m; else if (q < -m) q = -m;
              if ((q > 0 && dc <= 0) || (q < 0 && dn <= 0)) q = 0;
            }
            qx[c] = q;
          }
          if (j < FN - 1) {
            const n = c + FN, bn = b[n], dn = d[n], en = bn + dn, hf = (ec > en ? ec : en) - (bc > bn ? bc : bn);
            let q = 0;
            if (hf > DRY && ok && ice[n] <= 0.5) {
              q = qz[c]; if (j > 0) q = TH * q + TH2 * (qz[c - FN] + qz[n]);
              q = (q - gdt * hf * (en - ec)) / (1 + (fr * (q < 0 ? -q : q)) / (hf * hf * Math.cbrt(hf)));
              const m = hf * VMAX; if (q > m) q = m; else if (q < -m) q = -m;
              if ((q > 0 && dc <= 0) || (q < 0 && dn <= 0)) q = 0;
            }
            qz[c] = q;
          }
        }
      }
    }
    // B: no cell may give away more water than it holds
    for (let s = 0; s < sim.length; s++) {
      const t = sim[s], i0 = (t % TN) * TS, j0 = ((t / TN) | 0) * TS, i1 = i0 + TS, j1 = j0 + TS;
      for (let j = j0; j < j1; j++) {
        let c = i0 + j * FN;
        for (let i = i0; i < i1; i++, c++) {
          let out = 0, q = qx[c]; if (q > 0) out += q;
          if (i > 0) { q = qx[c - 1]; if (q < 0) out -= q; }
          q = qz[c]; if (q > 0) out += q;
          if (j > 0) { q = qz[c - FN]; if (q < 0) out -= q; }
          ks[c] = out * dt > d[c] * L ? (d[c] * L) / (out * dt) : 1;
        }
      }
    }
    for (let s = 0; s < sim.length; s++) {
      const t = sim[s], i0 = (t % TN) * TS, j0 = ((t / TN) | 0) * TS, i1 = i0 + TS, j1 = j0 + TS;
      for (let j = j0; j < j1; j++) {
        let c = i0 + j * FN;
        for (let i = i0; i < i1; i++, c++) {
          let q = qx[c]; if (q > 0) { if (ks[c] < 1) qx[c] = q * ks[c]; } else if (q < 0 && i < FN - 1 && ks[c + 1] < 1) qx[c] = q * ks[c + 1];
          q = qz[c]; if (q > 0) { if (ks[c] < 1) qz[c] = q * ks[c]; } else if (q < 0 && j < FN - 1 && ks[c + FN] < 1) qz[c] = q * ks[c + FN];
        }
      }
    }
    // C: move the water; derive velocity and foam; decide which tiles stay awake
    let vol = 0;
    for (let s = 0; s < sim.length; s++) {
      const t = sim[s], i0 = (t % TN) * TS, j0 = ((t / TN) | 0) * TS, i1 = i0 + TS, j1 = j0 + TS;
      let maxC = 0, maxF = 0;
      for (let j = j0; j < j1; j++) {
        let c = i0 + j * FN;
        for (let i = i0; i < i1; i++, c++) {
          const qL = i > 0 ? qx[c - 1] : 0, qR = qx[c], qU = j > 0 ? qz[c - FN] : 0, qD = qz[c], od = d[c];
          let nd = od + idt * (qL - qR + qU - qD);
          if (nd > 0 && !perm[c]) nd -= dt * (nd < 0.12 ? 0.02 : nd < 0.5 ? 0.005 : 0.0015);    // water on dry land soaks away
          if (nd < 0) nd = 0;
          d[c] = nd;
          const ch = nd > od ? nd - od : od - nd; if (ch > maxC) maxC = ch;
          let f = foam[c];
          if (nd > WET) {
            const k = 0.5 / (nd > 0.15 ? nd : 0.15), ux = (qL + qR) * k, uz = (qU + qD) * k, sp = Math.sqrt(ux * ux + uz * uz);
            vx[c] = ux; vz[c] = uz; vol += nd;
            // white water: where the flow is supercritical (Froude number near or above 1) and at rising fronts
            const fr = sp / Math.sqrt(GRAV * (nd > 0.1 ? nd : 0.1));
            f += dt * ((fr > 1.0 ? Math.min(1.3, (fr - 1.0) * 0.85) : 0) + (nd > od ? Math.min(2.5, (nd - od) * inv * 0.9) : 0));
          } else { vx[c] = 0; vz[c] = 0; }
          f -= dt * 0.55 * (f + 0.15); f = f > 1 ? 1 : f < 0 ? 0 : f; foam[c] = f; if (f > maxF) maxF = f;
        }
      }
      this.tFoam[t] = maxF;
      // every 32 steps: has the water in this tile actually moved since last time?
      if (++this.tCnt[t] >= 32) {
        this.tCnt[t] = 0; const dRef = this.dRef; let net = 0;
        for (let j = j0; j < j1; j++) for (let c = i0 + j * FN, e = c + TS; c < e; c++) { const x = d[c] - dRef[c]; if (x > net) net = x; else if (-x > net) net = -x; dRef[c] = d[c]; }
        if (net > 0.012 && tAct[t] < 45) tAct[t] = 45;
      }
      if (maxC > 4e-3) { if (tAct[t] < 45) tAct[t] = 45; }
      else if (tAct[t] > 0) tAct[t]--;                       // steady: the tile sleeps and keeps its flow
    }
    this.volume = vol * L * L;
    this.time += dt;
    return true;
  }

  // ---------------------------------------------------------------- per-frame
  update(dt) {
    if (dt <= 0) return;                       // time is stopped: the water hangs where it is
    this._obstacles(dt);
    this._bodies(dt);
    this._spray(dt);
    this._sound(dt);
    // the solver runs at 30 Hz in live play (every frame while recording), in steps of at most 1/30 s
    this.acc += dt;
    if (G.liveSim && this.acc < 0.03 && (++this.tick & 1)) return;
    const T = Math.min(this.acc, 0.1); this.acc = 0;
    const n = Math.max(1, Math.ceil(T / 0.0334));
    let ran = false; for (let i = 0; i < n; i++) ran = this.step(T / n) || ran;
    if (ran) { this._trees(T); this._upload(false); }
  }

  // masonry that has been knocked out of place stops holding water; fast water worries at the edges of a breach
  _obstacles(dt) {
    const { d, vx, vz } = this;
    for (const o of this.obstacles) {
      if (!o.on) continue;
      const k = o.blk;
      if (!k.alive || (k.x - o.x) ** 2 + (k.y - o.y) ** 2 + (k.z - o.z) ** 2 > 0.49) { this._dropObstacle(o); continue; }
      if (k.fixed) continue;
      // pressure: where the wall has been reduced to a single stone's thickness, the water behind it pushes that stone out.
      // (o.nb = the stones that were built directly up- or downstream of this one, in the same course)
      if (o.tx !== undefined) {
        if (!o.nb) {
          o.nb = [];
          for (const p of this.obstacles) {
            if (p === o || p.tx === undefined) continue;
            const dx = p.x - o.x, dz = p.z - o.z, df = dx * o.tx + dz * o.tz, da = dx * -o.tz + dz * o.tx;
            if (Math.abs(p.y - o.y) < k.sy * 0.6 && Math.abs(df) > 1 && Math.abs(df) < 4.2 && Math.abs(da) < (k.sx + p.blk.sx) * 0.45) o.nb.push(p);
          }
        }
        let thin = o.nb.length > 0; for (const p of o.nb) if (p.on) { thin = false; break; }
        if (thin) {
          const cw = this.cell(o.x - o.tx * 5.4, o.z - o.tz * 5.4), head = cw >= 0 ? this.b[cw] + d[cw] - (k.y - k.sy * 0.5) : 0;
          if (cw >= 0 && d[cw] > 0.5 && head > 1.2 && rand() < dt * 5) {
            const m = k.mass, v = Math.min(9, 2.5 + head * 0.6);
            k.body.wakeUp(); k.body.applyImpulse({ x: o.tx * v * m, y: 0.6 * m, z: o.tz * v * m }, true);
            continue;
          }
        }
      }
      if (!this.breach || !(k.frozen || k.body.isSleeping())) continue;      // (an undamaged dam is not worn away by its own spillway)
      // erosion: once the dam is breached, a block standing next to fast, deep water is torn loose
      const c0 = o.cells[(rand() * o.cells.length) | 0]; if (c0 === undefined) continue;
      for (const c of [c0 - 1, c0 + 1, c0 - FN, c0 + FN]) {
        if (c < 0 || c >= d.length || d[c] < 1.3) continue;            // (deeper and faster than the spillway ever runs)
        const sp = Math.hypot(vx[c], vz[c]); if (sp < 4 || this.b[c] + d[c] < k.y - k.sy * 0.5) continue;
        if (rand() < dt * 3 * Math.min(2.5, sp / 4)) { const m = k.mass; k.body.wakeUp(); k.body.applyImpulse({ x: vx[c] * 0.5 * m, y: 0.6 * m, z: vz[c] * 0.5 * m }, true); }
        break;
      }
    }
  }

  // buoyancy and drag on rigid bodies; fast water wakes and carries off what stands in it
  _bodies(dt) {
    const list = G.physics.blocks, { d, tb, vx, vz, ice } = this, n = list.length;
    const phase = (this.rr = (this.rr + 1) & 7), now = G.time;
    for (let i = 0; i < n; i++) {
      const o = list[i]; if (!o.alive || o.fixed || o.holding) continue;
      const awake = o.wasAwake;
      if (!awake && (i & 7) !== phase) continue;
      const ci = Math.floor((o.x + HALF) / L), cj = Math.floor((o.z + HALF) / L); if (ci < 0 || cj < 0 || ci >= FN || cj >= FN) continue;
      const c = ci + cj * FN, dep = d[c]; if (dep < 0.12 || ice[c] > 0.5) { if (awake && dep < 0.05) o.wet = false; continue; }
      const surf = tb[c] + dep, bottom = o.y - o.sy * 0.5; if (surf <= bottom) continue;
      if (!awake && o.mat === 'wood' && surf - (o.y + o.sy * 0.5) > 0.5) { o.body.wakeUp(); continue; }      // the water rose over a floating timber
      const sub = Math.min(1, (surf - bottom) / Math.max(0.3, o.sy));
      const ux = vx[c], uz = vz[c];
      const Lc = Math.max(0.25, Math.min(o.sx, o.sy, o.sz)), cd = Math.min(3, Math.max(0.05, 0.9 / ((DENS[o.mat] || 2) * Lc)));
      if (!awake) {
        // asleep (still part of a building): only violent water can tear it loose
        const sp2 = ux * ux + uz * uz;
        if (cd * sp2 * sub > 4.2 && rand() < dt * 8 * 2.5) { o.body.wakeUp(); const m = o.mass; o.body.applyImpulse({ x: ux * 0.35 * m, y: 0.3 * m, z: uz * 0.35 * m }, true); G.physics.lightsOut?.(o); }
        continue;
      }
      o.wetT = now;                                      // (afloat: the physics will not freeze it in place)
      const v = o.body.linvel(), m = o.mass, rx = ux - v.x, rz = uz - v.z, rs = Math.sqrt(rx * rx + rz * rz);
      const k = Math.min(0.5, cd * 1.7 * rs * dt * sub + dt * 0.8 * sub);
      const lift = (o.mat === 'wood' ? 26 : o.mat === 'plaster' || o.mat === 'roof' ? 9 : 5) * sub, kv = Math.min(1, dt * 2.2) * sub;
      o.body.applyImpulse({ x: rx * k * m, y: (lift * dt - v.y * kv) * m, z: rz * k * m }, false);
      if (!o.wet && sub < 0.7) { o.wet = true; if (v.y < -5) this.splash(o.x, o.z, Math.min(1.2, 0.3 + o.vol * 0.2)); }
    }
  }

  // a flood fells trees and floats the trunks away
  _trees(dt) {
    const F = G.forest; if (!F || !F.trees.length) return;
    const { d, vx, vz } = this, T = F.trees, n = Math.min(T.length, 260);
    for (let k = 0; k < n; k++) {
      const t = T[(this.treeI = (this.treeI + 1) % T.length)]; if (t.state !== 0) continue;
      const c = this.cell(t.x, t.z); if (c < 0 || d[c] < 0.9) continue;
      const sp = Math.hypot(vx[c], vz[c]); if (sp < 3.2) continue;
      if (d[c] > 1.6 && sp > 5.5 && rand() < 0.5) F.uproot(t); else F.topple(t, vx[c], vz[c], 1 + sp * 0.2);
    }
  }

  // white water: spray where it runs fast or falls, mist at the foot of falls
  _spray(dt) {
    const P = G.fx?.P; if (!P || this.quiet) return;
    const cam = G.camera.position, { d, tb, vx, vz, foam, tFoam } = this;
    const sim = (this.foamy ||= []);
    if ((this.sprayT = (this.sprayT || 0) + 1) % 20 === 1) { sim.length = 0; for (let t = 0; t < TN * TN; t++) if (tFoam[t] > 0.3) sim.push(t); }
    if (!sim.length) { this.roarTarget = 0; return; }
    let roar = 0;
    const tries = Math.min(260, sim.length * 6);
    for (let k = 0; k < tries; k++) {
      const t = sim[(rand() * sim.length) | 0], c = (t % TN) * TS + ((rand() * TS) | 0) + (((t / TN) | 0) * TS + ((rand() * TS) | 0)) * FN;
      const f = foam[c]; if (f < 0.3 || d[c] < 0.15) continue;
      const x = -HALF + (c % FN) * L + rr(0, 2), z = -HALF + ((c / FN) | 0) * L + rr(0, 2), y = tb[c] + d[c];
      const dist = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
      const near = Math.max(0, 1 - dist / 240); if (near > 0) roar = Math.max(roar, f * near);
      if (dist > 300 || rand() > f) continue;
      const ux = vx[c], uz = vz[c], sp = Math.hypot(ux, uz), s0 = rr(0.9, 1.8) * (1 + dist * 0.004);
      P.spawn(x, y + 0.2, z, ux * 0.7 + rr(-1, 1), rr(1.5, 4) + sp * 0.35, uz * 0.7 + rr(-1, 1), rr(0.7, 1.4), s0, s0 * 2.6, 0.62, 0.68, 0.74, 0.34, 0.62, 0.68, 0.74, 0, 0.8, 0.9, K_PUFF, 0.25, 0, rr(-1, 1), 0.03, 0.12);
      if (dist < 130 && rand() < 0.5) P.spawn(x, y + 0.3, z, ux * 0.9 + rr(-2, 2), rr(3, 8) + sp * 0.5, uz * 0.9 + rr(-2, 2), rr(0.6, 1.2), 0.06, 0.03, 0.62, 0.7, 0.78, 0.8, 0.5, 0.58, 0.66, 0.3, 0.3, 1.5, K_DOT, 0, 0.12);
    }
    this.roarTarget = roar;
  }

  _sound(dt) {
    const A = G.audio; if (!A || this.quiet) return;
    this.roar += ((this.roarTarget || 0) - this.roar) * Math.min(1, dt * 2.5);
    const v = Math.min(1.3, this.roar * 1.6);
    if (v > 0.03 && !this.loopOn) { this.loopOn = true; A.loop('water_roar', 'waterfall', { vol: v, rate: 0.85, fade: 0.5 }); }
    else if (this.loopOn) { if (v < 0.015) { this.loopOn = false; A.stopLoop('water_roar', 1.5); } else A.setLoop('water_roar', { vol: v, tau: 0.4 }); }
  }

  // ---------------------------------------------------------------- rendering
  _upload(all) {
    const A = this.dataA, B = this.dataB, { b, d, vx, vz, foam, ice, wm } = this;
    const tiles = all ? Array.from({ length: TN * TN }, (_, i) => i) : this.sim;
    for (const t of tiles) {
      const i0 = (t % TN) * TS, j0 = ((t / TN) | 0) * TS;
      for (let j = j0; j < j0 + TS; j++) for (let c = i0 + j * FN, e = c + TS; c < e; c++) {
        const k = c * 4, wet = d[c] > WET;
        if (wet) {
          let s = (b[c] + d[c]) * 4, w = 4;
          if (d[c - 1] > WET) { s += b[c - 1] + d[c - 1]; w++; } if (d[c + 1] > WET) { s += b[c + 1] + d[c + 1]; w++; }
          if (d[c - FN] > WET) { s += b[c - FN] + d[c - FN]; w++; } if (d[c + FN] > WET) { s += b[c + FN] + d[c + FN]; w++; }
          A[k] = s / w; A[k + 1] = d[c]; A[k + 2] = vx[c]; A[k + 3] = vz[c]; wm[c] = 1;
        }
        else { A[k + 1] = 0; A[k + 2] = 0; A[k + 3] = 0; wm[c] = 0; }
        B[k] = foam[c] * 255; B[k + 1] = ice[c] * 255; B[k + 2] = wet ? 255 : 0; B[k + 3] = this.perm[c] ? 0 : 255;   // A: flood water on dry land (muddy)
      }
    }
    // dry cells next to water carry the neighbouring surface level outwards (two rings), so the sheet meets
    // the shore at the true water level and the terrain itself draws the waterline
    const pend = [];
    for (let ring = 1; ring <= 2; ring++) {
      pend.length = 0;
      for (const t of tiles) {
        const i0 = (t % TN) * TS, j0 = ((t / TN) | 0) * TS;
        for (let j = j0; j < j0 + TS; j++) for (let i = i0, c = i0 + j * FN; i < i0 + TS; i++, c++) {
          if (wm[c]) continue;
          let sum = 0, cnt = 0;
          for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= FN) continue; for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= FN || (!di && !dj)) continue; const m = wm[ii + jj * FN]; if (m && m <= ring) { sum += A[(ii + jj * FN) * 4]; cnt++; } } }
          if (cnt) { A[c * 4] = sum / cnt; pend.push(c); } else if (ring === 2) A[c * 4] = b[c] - 0.6;
        }
      }
      for (const c of pend) wm[c] = ring + 1;
    }
    this.texA.needsUpdate = true; this.texB.needsUpdate = true;
  }

  _makeMesh() {
    const { CELL, VN } = TERRAIN_CONST;
    const pos = new Float32Array(FN * FN * 3);
    for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) { const k = (i + j * FN) * 3; pos[k] = -HALF + i * L + 1; pos[k + 2] = -HALF + j * L + 1; }
    const idx = new Uint32Array((FN - 1) * (FN - 1) * 6); let q = 0;
    for (let j = 0; j < FN - 1; j++) for (let i = 0; i < FN - 1; i++) { const a = i + j * FN, e = a + 1, c = a + FN, f = c + 1; idx[q++] = a; idx[q++] = c; idx[q++] = e; idx[q++] = e; idx[q++] = c; idx[q++] = f; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const nor = new Float32Array(FN * FN * 3); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const U = this.U = {
      tFluidA: { value: this.texA }, tFluidB: { value: this.texB }, tHeightW: { value: G.terrain.heightTex }, tNoiseW: { value: G.noiseTex }, uTimeW: G.fxU.uTime,
      uTerrainUvW: { value: new THREE.Vector2(1 / (CELL * VN), (HALF / CELL + 0.5) / VN) },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.14, metalness: 0, envMapIntensity: 0.72 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPosW; uniform sampler2D tFluidA;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          transformed.y = texture2D(tFluidA, (position.xz + 512.0) / 1024.0).r;
          vWPosW = transformed;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPosW; uniform sampler2D tFluidA, tFluidB, tHeightW, tNoiseW; uniform float uTimeW; uniform vec2 uTerrainUvW;
          vec2 ripW(vec2 p) { return vec2(texture2D(tNoiseW, p).r, texture2D(tNoiseW, p + vec2(0.37, 0.11)).g) - 0.5; }`)
        .replace('#include <map_fragment>', `
          vec2 fuv = (vWPosW.xz + 512.0) / 1024.0;
          vec4 fb = texture2D(tFluidB, fuv);
          if (fb.b < 0.5) discard;
          float gh = texture2D(tHeightW, vWPosW.xz * uTerrainUvW.x + uTerrainUvW.y).r;
          float depthW = vWPosW.y - gh;
          if (depthW < 0.012) discard;
          vec4 fa = texture2D(tFluidA, fuv);
          vec2 velW = fa.ba; float spdW = length(velW);
          float iceW = smoothstep(0.35, 0.65, fb.g);
          // the big shape of the surface: slope of the simulated water level
          float eW = 1.0 / 512.0;
          float sxW = texture2D(tFluidA, fuv + vec2(eW, 0.0)).r - texture2D(tFluidA, fuv - vec2(eW, 0.0)).r;
          float szW = texture2D(tFluidA, fuv + vec2(0.0, eW)).r - texture2D(tFluidA, fuv - vec2(0.0, eW)).r;
          vec2 slopeW = vec2(sxW, szW) * 0.25;
          float steepW = smoothstep(0.22, 0.9, length(slopeW));
          // ripples carried along by the current (two phases cross-faded so the pattern never stretches)
          vec2 wv = vWPosW.xz;
          vec2 flowW = velW + vec2(0.22, 0.13);
          float phA = fract(uTimeW * 0.28), phB = fract(uTimeW * 0.28 + 0.5), wA = 1.0 - abs(1.0 - 2.0 * phA), wB = 1.0 - wA;
          vec2 oA = flowW * (phA - 0.5) * 3.4, oB = flowW * (phB - 0.5) * 3.4;
          // (the noise tile is sampled at three unrelated scales and angles so no repeat shows, even on a wide flood)
          mat2 rA = mat2(0.80, -0.60, 0.60, 0.80), rB = mat2(0.28, 0.96, -0.96, 0.28);
          vec2 pA = wv - oA, pB = wv - oB;
          vec2 rip = (ripW(rA * pA * 0.061) * 1.2 + ripW(rB * pA * 0.157 + 0.3) * 0.8 + ripW(pA * 0.43 + 0.6) * 0.45) * wA
                   + (ripW(rA * pB * 0.061 + 0.5) * 1.2 + ripW(rB * pB * 0.157 + 0.8) * 0.8 + ripW(pB * 0.43 + 0.1) * 0.45) * wB;
          float camW = length(vViewPosition);
          float bigW = texture2D(tNoiseW, wv * 0.011 + uTimeW * 0.004).r;                 // slow, large-scale variation hides the tiling
          float chopW = (0.5 + smoothstep(0.3, 4.0, spdW) * 1.1) * mix(1.0, 0.35, smoothstep(50.0, 260.0, camW)) * (0.6 + 0.8 * bigW);
          // colour: clear over the shallows, dark in the deeps, muddy where it runs fast
          vec3 deep = vec3(0.012, 0.038, 0.040), shallow = vec3(0.070, 0.120, 0.085);
          vec3 wcol = mix(shallow, deep, smoothstep(0.0, 3.4, depthW));
          float mudW = max(smoothstep(2.6, 6.5, spdW) * (0.45 + 0.55 * smoothstep(5.0, 0.4, depthW)), fb.a * 0.9);
          wcol = mix(wcol, vec3(0.170, 0.122, 0.068) * (0.7 + 0.6 * bigW), mudW * 0.94);
          // foam: breaking fronts and fast water (simulated), falls, and the line where water meets land
          float fnA = texture2D(tNoiseW, rB * pA * 0.052).r * 0.6 + texture2D(tNoiseW, rA * pA * 0.137 + 0.4).g * 0.4;
          float fnB = texture2D(tNoiseW, rB * pB * 0.052 + 0.5).r * 0.6 + texture2D(tNoiseW, rA * pB * 0.137 + 0.9).g * 0.4;
          float fnW = clamp((fnA * wA + fnB * wB - 0.5) * 2.3 + 0.5 + (texture2D(tNoiseW, wv * 0.61).g - 0.5) * 0.3, 0.0, 1.0);
          float foamAmt = clamp(fb.r * 1.2 + steepW * 0.8 + smoothstep(0.3, 0.0, depthW) * 0.5 * (1.0 - fb.a * 0.85), 0.0, 1.0) * (1.0 - iceW);
          float covW = foamAmt * (0.3 + 0.3 * bigW);
          float foam = smoothstep(0.93 - covW, 1.07 - covW, fnW) * step(0.02, foamAmt);
          foam = mix(foam, covW * 0.9, smoothstep(50.0, 200.0, camW));                    // far away the streaks average out
          wcol = mix(wcol, mix(vec3(0.60, 0.66, 0.68), vec3(0.40, 0.34, 0.25), mudW * 0.9), foam * 0.92);
          // ice: milky blue-white with dark cracks
          float wn1 = texture2D(tNoiseW, wv * 0.045).r, wn2 = texture2D(tNoiseW, wv * 0.13).g;
          float crack = smoothstep(0.03, 0.0, abs(texture2D(tNoiseW, wv * 0.06).r - 0.5)) + smoothstep(0.02, 0.0, abs(texture2D(tNoiseW, wv * 0.17 + 0.4).g - 0.45)) * 0.6;
          vec3 iceC = mix(vec3(0.62, 0.78, 0.9), vec3(0.9, 0.96, 1.0), wn1) * (1.0 - crack * 0.45);
          diffuseColor.rgb = mix(wcol, iceC, iceW);`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.16 + foam * 0.5 + mudW * 0.2, 0.36 + wn2 * 0.25, iceW);')
        .replace('#include <normal_fragment_maps>', `
          vec3 nW = normalize(vec3(-slopeW.x * 1.0 + rip.x * 0.34 * chopW * (1.0 - iceW * 0.9), 1.0, -slopeW.y * 1.0 + rip.y * 0.34 * chopW * (1.0 - iceW * 0.9)));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`);
    };
    mat.customProgramCacheKey = () => 'fluidwater7';
    const mesh = this.mesh = new THREE.Group();
    const TT = 8, tn = FN / TT, span = (FN * L) / TT;
    for (let tz = 0; tz < TT; tz++) for (let tx = 0; tx < TT; tx++) {
      const i1 = Math.min(FN - 1, (tx + 1) * tn), j1 = Math.min(FN - 1, (tz + 1) * tn), ti = new Uint32Array((i1 - tx * tn) * (j1 - tz * tn) * 6); let w = 0;
      for (let j = tz * tn; j < j1; j++) for (let i = tx * tn; i < i1; i++) { const a = i + j * FN, e = a + 1, c = a + FN, f = c + 1; ti[w++] = a; ti[w++] = c; ti[w++] = e; ti[w++] = e; ti[w++] = c; ti[w++] = f; }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', geo.attributes.position); tg.setAttribute('normal', geo.attributes.normal); tg.setIndex(new THREE.BufferAttribute(ti, 1));
      tg.boundingSphere = new THREE.Sphere(new THREE.Vector3(-HALF + (tx + 0.5) * span, 8, -HALF + (tz + 0.5) * span), span * 0.71 + 45);
      const m = new THREE.Mesh(tg, mat); m.receiveShadow = true; m.castShadow = false; m.layers.set(LAYER_SCENE); m.renderOrder = 2;
      mesh.add(m);
    }
    G.scene.add(mesh);
  }
}
