// Procedural walled old town. Every wall panel, floor, roof slab, gable, tower block and stall
// is a real rigid body (asleep until disturbed), so the whole city can be torn apart.
import * as THREE from 'three';
import { G, LAYER_SCENE } from '../core/globals.js';
import { rr, rand, makeRng } from '../core/util.js';
import { CITY, SITES } from './layout.js';
import { buildSettlements } from './settlements.js';
import { buildBoroughs } from './boroughs.js';

const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const yawQ = (a) => new THREE.Quaternion().setFromAxisAngle(Y, a);
const GAP = 0.004;
const C = (r, g, b) => new THREE.Color(r, g, b);
const WALLS = [[0.95, 0.9, 0.78], [0.93, 0.8, 0.56], [0.88, 0.64, 0.5], [0.74, 0.82, 0.84], [0.8, 0.84, 0.7], [0.97, 0.95, 0.92], [0.9, 0.72, 0.62], [0.84, 0.77, 0.64], [0.92, 0.86, 0.66], [0.78, 0.7, 0.62]];
const ROOFS = [[0.82, 0.76, 0.74], [0.7, 0.62, 0.6], [0.9, 0.74, 0.66], [0.6, 0.52, 0.5], [0.78, 0.68, 0.58], [0.48, 0.47, 0.5], [0.66, 0.56, 0.5]];
const STONE = C(0.86, 0.82, 0.76), SLATE = C(0.42, 0.42, 0.47);

export class World {
  constructor() { this.statics = []; this.houses = []; }

  build() {
    const t0 = performance.now();
    this.rng = makeRng(2026);
    this.y0 = SITES[0].h;
    this.cx = CITY.x; this.cz = CITY.z;
    const P = G.physics;
    P.structTotal = 0; P.structDown = 0;
    this.houses = [];
    this.reserved = [[-19.5, -17.5, 19.5, 17.5], [19.5, -27.8, 51, -4.6], [-19, -30.5, 9.5, -17.5]];
    this.buildCathedral();
    this.buildTownHall();
    this.buildWalls();
    this.buildHouses();
    this.buildPlaza();
    this.buildProps();
    this.oldTownHouses = this.houses.length;
    buildBoroughs(this);         // the city outside the walls (src/world/boroughs.js)
    buildSettlements(this);
    // Rapier wakes bodies when their first contacts appear: let everything touch down once, then put the city to sleep.
    const t1 = performance.now();
    P.world.timestep = 1 / 120; P.world.step();
    for (const b of P.blocks) if (b.alive && !b.fixed) { b.body.setLinvel({ x: 0, y: 0, z: 0 }, false); b.body.setAngvel({ x: 0, y: 0, z: 0 }, false); b.body.sleep(); b.pvx = b.pvy = b.pvz = 0; }
    this.buildMs = performance.now() - t0;
    console.log(`[game] city: ${this.houses.length} houses (${this.oldTownHouses} in the old town), ${this.townHouses.length} in the other settlements, ${P.structTotal} structural bodies, ${P.blocks.length} total; built in ${this.buildMs.toFixed(0)} ms (settle step ${(performance.now() - t1).toFixed(0)} ms)`);
  }

  reset() {
    const P = G.physics;
    for (const b of P.blocks) if (b.alive) P.remove(b);
    P.blocks = []; P.rubble = []; P.waves = [];
    for (const s of this.statics) { G.scene.remove(s.mesh); if (s.collider) P.world.removeCollider(s.collider, false); }
    this.statics = [];
    this.build();
  }

  // ---------------------------------------------------------------- helpers
  add(o) { return G.physics.add({ struct: true, ...o }); }
  // city-local (u, v) box
  B(u, y, v, sx, sy, sz, yaw = 0, o = {}) { return this.add({ shape: 'box', x: this.cx + u, y, z: this.cz + v, sx, sy, sz, q: yawQ(yaw), ...o }); }

  addStatic(geo, x, y, z, colliderDesc, material = null) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = new Float32Array(pos.count * 2), s = 0.3;
    for (let i = 0; i < pos.count; i++) {
      const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      if (ay >= ax && ay >= az) { uv[i * 2] = px * s; uv[i * 2 + 1] = pz * s; } else if (ax > az) { uv[i * 2] = pz * s; uv[i * 2 + 1] = py * s; } else { uv[i * 2] = px * s; uv[i * 2 + 1] = py * s; }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (!this.staticMat) {
      const T = G.tex;
      this.staticMat = new THREE.MeshStandardMaterial({ map: T.ashlar_diff, normalMap: T.ashlar_nor, roughnessMap: T.ashlar_arm, aoMap: T.ashlar_arm, roughness: 1, metalness: 0, color: C(1.1, 1.05, 0.97) });
    }
    const mesh = new THREE.Mesh(geo, material || this.staticMat);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; mesh.layers.set(LAYER_SCENE);
    G.scene.add(mesh);
    const P = G.physics;
    const collider = colliderDesc ? P.world.createCollider(colliderDesc.setTranslation(x, y, z).setFriction(0.9).setCollisionGroups(P.GROUP_TERRAIN)) : null;
    this.statics.push({ mesh, collider });
    return mesh;
  }

  // gabled roof: one solid prism (tiles on the slopes, timber/plaster on the gable ends) that sits on
  // the top floor slab. It breaks into tiled slabs, gable chunks and rafters. Returns ridge height.
  roof(x, yTop, z, w, d, yaw, ridge, pitchDeg, wallCol, roofCol, pat, lit, T, o = {}) {
    const ry = ridge === 'x' ? yaw : yaw + Math.PI / 2;
    const L = ridge === 'x' ? w : d, S = ridge === 'x' ? d : w;
    const th = THREE.MathUtils.degToRad(pitchDeg), ov = o.ov ?? 0.45;
    const span = S + ov * 2, rise = (span / 2) * Math.tan(th);
    this.lastRoof = this.add({ shape: 'prism', mat: 'plaster', x, y: yTop + rise / 2 + GAP, z, sx: span, sy: rise, sz: L + (o.ovL ?? 0.5), q: yawQ(ry + Math.PI / 2), color: wallCol, color2: roofCol, style: [o.gableFeat ?? (rand() < 0.55 ? 4 : 0), pat, lit, 0], house: o.house, tag: o.tag });
    return yTop + rise;
  }

  // timber-framed town house
  house(h) {
    const { x, z, w, d, floors, yaw, pat, lit } = h;
    const T = h.t || 0.42, FH = h.fh || 2.8, ST = 0.22;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const L2W = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    const qF = yawQ(yaw), qS = yawQ(yaw + Math.PI / 2);
    const col = C(...h.color), colG = h.ground ? C(...h.ground) : col.clone().multiplyScalar(0.92);
    const mat = h.mat || 'plaster', tag = h.tag;
    // lean houses (towns, outer boroughs) use one panel per wall face and storey; the facade shader still draws a
    // window bay every ~2.5 m, so they look the same but cost two bodies less per storey
    const n = h.lean ? 1 : Math.max(1, Math.round(w / 3.7)), pw = w / n;
    let y = h.y0 ?? this.y0;
    for (let f = 0; f < floors; f++) {
      const cy = y + FH / 2 + GAP, c = f === 0 ? colG : col, tp = f === 0 ? (h.groundTimber ? pat : 0) : pat;
      for (let i = 0; i < n; i++) {
        const lx = (i - (n - 1) / 2) * pw, door = f === 0 && i === Math.floor(n / 2);
        let [wx, wz] = L2W(lx, d / 2 - T / 2);
        this.add({ shape: 'box', mat, x: wx, y: cy, z: wz, sx: pw - 0.012, sy: FH, sz: T, q: qF, color: c, style: [door ? 2 : h.tallWin ? 3 : 1, tp, f === 0 ? lit * 0.7 : lit, 0], house: h.id, tag });
        [wx, wz] = L2W(lx, -d / 2 + T / 2);
        this.add({ shape: 'box', mat, x: wx, y: cy, z: wz, sx: pw - 0.012, sy: FH, sz: T, q: qF, color: c, style: [h.backWin === false ? 0 : 1, tp, lit * 0.6, 0], house: h.id, tag });
      }
      for (const s of [-1, 1]) {
        const [wx, wz] = L2W(s * (w / 2 - T / 2), 0);
        this.add({ shape: 'box', mat, x: wx, y: cy, z: wz, sx: d - 2 * T - 0.012, sy: FH, sz: T, q: qS, color: c, style: [h.sideWin ? 1 : 0, tp, lit * 0.5, 0], house: h.id, tag });
      }
      y += FH + GAP;
      this.add({ shape: 'box', mat: 'wood', x, y: y + ST / 2 + GAP, z, sx: w - 0.03, sy: ST, sz: d - 0.03, q: qF, tint: 0.8, house: h.id, tag });
      y += ST + GAP;
    }
    if (h.flat) return y;
    return this.roof(x, y, z, w, d, yaw, h.ridge, h.pitch, h.gable ? C(...h.gable) : col, C(...h.roof), pat, lit, T, { house: h.id, tag, ...(h.roofOpts || {}) });
  }

  // square tower from solid courses (very stable until hit hard). styleAt(layer) -> facade style
  tower(u, v, side, layers, lh, t, o = {}) {
    let y = o.y0 ?? this.y0;
    const rot = o.rot || 0;
    for (let k = 0; k < layers; k++) {
      const H = (o.tall && o.tall[k]) || lh, taper = 1 - (o.taper || 0) * (k / layers);
      this.B(u, y + H / 2 + GAP, v, side * taper, H, side * taper, rot + (k % 2 ? 0 : Math.PI / 2), { mat: o.mat || 'ashlar', color: o.color || STONE, style: o.styleAt ? o.styleAt(k, 0) : [0, 0, 0, 0], tag: o.tag });
      y += H + GAP;
    }
    const top = side * (1 - (o.taper || 0));
    if (o.cap !== false) { this.B(u, y + 0.25 + GAP, v, top + 0.5, 0.5, top + 0.5, rot, { mat: 'ashlar', color: o.color || STONE, tag: o.tag }); y += 0.5 + GAP; }
    if (o.spire) {
      this.lastSpire = this.add({ shape: 'pyr', mat: 'roof', x: this.cx + u, y: y + o.spire / 2 + GAP, z: this.cz + v, sx: top + 0.2, sy: o.spire, sz: top + 0.2, q: yawQ(rot), color: o.spireColor || C(0.9, 0.78, 0.7), friction: 1.2, tag: o.tag });
      y += o.spire;
    }
    if (o.merlons) {
      const cs = Math.cos(rot), sn = Math.sin(rot);
      for (const [mx, mz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const lx = mx * (top / 2 - 0.35), lz = mz * (top / 2 - 0.35);
        this.B(u + lx * cs + lz * sn, y + 0.45 + GAP, v - lx * sn + lz * cs, 1.3, 0.9, 1.3, rot, { mat: 'ashlar', color: o.color || STONE });
      }
    }
    return y;
  }

  // ---------------------------------------------------------------- landmarks
  buildCathedral() {
    const y0 = this.y0, T = 0.8, PH = 5, tiers = 2;
    const u0 = 21, u1 = 49, vS = -12.5, vN = -25.5, cu = (u0 + u1) / 2, cv = (vS + vN) / 2;
    const n = 7, pw = (u1 - u0) / n;
    for (let tier = 0; tier < tiers; tier++) {
      const y = y0 + PH * (tier + 0.5) + GAP * (tier + 1);
      for (let i = 0; i < n; i++) {
        const u = u0 + pw * (i + 0.5);
        this.B(u, y, vS - T / 2, pw - 0.012, PH, T, 0, { mat: 'ashlar', color: STONE, style: [tier === 1 ? 5 : 0, 0, 1, 0], tag: 'cathedral' });
        this.B(u, y, vN + T / 2, pw - 0.012, PH, T, 0, { mat: 'ashlar', color: STONE, style: [tier === 1 ? 5 : 0, 0, 1, 0], tag: 'cathedral' });
      }
      const ew = (vS - vN - 2 * T) / 2;
      for (const s of [-1, 1]) {
        this.B(u0 + T / 2, y, cv + s * ew / 2, ew - 0.012, PH, T, Math.PI / 2, { mat: 'ashlar', color: STONE, style: [tier === 0 ? 2 : 5, 0, 1, 0], tag: 'cathedral' });
        this.B(u1 - T / 2, y, cv + s * ew / 2, ew - 0.012, PH, T, Math.PI / 2, { mat: 'ashlar', color: STONE, style: [tier === 1 ? 5 : 0, 0, 1, 0], tag: 'cathedral' });
      }
    }
    const yTop = y0 + PH * tiers + GAP * tiers;
    this.roof(this.cx + cu, yTop, this.cz + cv, u1 - u0, vS - vN, 0, 'x', 52, STONE, SLATE, 0, 1, T, { gableFeat: 5, ov: 0.6, ovL: 0.5, tag: 'cathedral' });
    for (let i = 1; i < n; i++) {
      const u = u0 + pw * i;
      if (u > 29) this.B(u, y0 + 3.6 + GAP, vS + 0.72, 1.0, 7.2, 1.4, 0, { mat: 'ashlar', color: STONE });
      this.B(u, y0 + 3.6 + GAP, vN - 0.72, 1.0, 7.2, 1.4, 0, { mat: 'ashlar', color: STONE });
    }
    // bell tower with clock, belfry and spire
    const layers = 18;
    this.tower(24.5, vS + 3.56, 7, layers, 1.6, 1.0, {
      tall: { 13: 3.4 }, spire: 13.5, spireColor: SLATE, tag: 'belltower',
      styleAt: (k) => (k === 13 ? [6, 0, 1, 0] : k >= 15 ? [3, 0, 1, 0] : k === 5 || k === 9 ? [1, 0, 0.6, 0] : [0, 0, 0, 0]),
    });
    this.bell = this.lastSpire;
  }

  buildTownHall() {
    this.house({ id: -2, x: this.cx - 2, z: this.cz - 23.6, w: 20, d: 11, floors: 3, fh: 3.1, yaw: 0, pat: 3, lit: 0.85, color: [0.96, 0.9, 0.74], ground: [0.8, 0.76, 0.7], roof: [0.95, 0.78, 0.68], ridge: 'x', pitch: 50, tallWin: false, sideWin: true, t: 0.5, roofOpts: { rt: 0.26 } });
    this.tower(-15.2, -23.6, 5.2, 12, 1.5, 0.85, {
      tall: { 10: 3.2 }, spire: 8.5, spireColor: C(0.5, 0.62, 0.56), tag: 'clocktower',
      styleAt: (k) => (k === 10 ? [6, 0, 1, 0] : k === 3 || k === 7 ? [1, 0, 0.7, 0] : [0, 0, 0, 0]),
    });
  }

  buildWalls() {
    const R = CITY.wallR, bl = 3.3, bh = 1.5, bt = 1.5, layers = 4, y0 = this.y0;
    const n = Math.floor((2 * Math.PI * R) / (bl + 0.04));
    const gates = [Math.PI / 2, -Math.PI / 2]; // south (+v, faces the overlook) and north
    const gateHalf = 3.7;
    const gateDist = (a) => Math.min(...gates.map((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) * R));
    for (let L = 0; L < layers; L++) {
      for (let i = 0; i < n; i++) {
        const a = ((i + (L % 2) * 0.5) / n) * Math.PI * 2, gd = gateDist(a);
        if (gd < gateHalf + (L === layers - 1 ? bl : bl * 0.5)) continue;
        this.B(Math.cos(a) * R, y0 + bh * (L + 0.5) + GAP * (L + 1), Math.sin(a) * R, bl, bh, bt, -(a + Math.PI / 2), { mat: 'ashlar', color: STONE, tag: 'wall' });
      }
    }
    const yt = y0 + bh * layers + GAP * layers;
    for (let i = 0; i < n; i += 2) {
      const a = ((i + 0.25) / n) * Math.PI * 2;
      if (gateDist(a) < gateHalf + bl) continue;
      this.B(Math.cos(a) * (R + 0.2), yt + 0.5 + GAP, Math.sin(a) * (R + 0.2), 1.6, 1.0, 1.0, -(a + Math.PI / 2), { mat: 'ashlar', color: STONE });
    }
    // gates: lintel over the opening, flanking towers outside the wall
    for (const g of gates) {
      const gu = Math.cos(g) * R, gv = Math.sin(g) * R, s = Math.sign(Math.sin(g));
      this.B(gu, y0 + bh * (layers - 0.5) + GAP * layers, gv, gateHalf * 2 + bl * 2.3, bh, bt, 0, { mat: 'ashlar', color: STONE, tag: 'gate' });
      this.B(gu, yt + 0.6 + GAP, gv, gateHalf * 2 + 2, 1.2, bt * 0.8, 0, { mat: 'ashlar', color: STONE, tag: 'gate' });
      for (const k of [-1, 1]) {
        this.tower(gu + k * (gateHalf + 2.9), gv + s * (bt / 2 + 2.9), 5.6, 7, 1.5, 0.9, { spire: 6.5, tag: 'gate', styleAt: (L) => (L === 4 ? [1, 0, 0.8, 0] : [0, 0, 0, 0]) });
      }
    }
    // wall towers
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + Math.PI / 10 + Math.PI / 2, rr2 = R + bt / 2 + 2.7;
      this.tower(Math.cos(a) * rr2, Math.sin(a) * rr2, 5.2, 6, 1.5, 0.9, { rot: -(a + Math.PI / 2), spire: k % 2 ? 5.5 : 0, merlons: k % 2 === 0, tag: 'walltower', styleAt: (L) => (L === 4 ? [1, 0, 0.6, 0] : [0, 0, 0, 0]) });
    }
  }

  buildHouses() {
    const rng = this.rng, R = CITY.wallR - 4.6;
    const streets = [{ axis: 'v', c: 0, a: -R, b: R, w: 7.6 }, { axis: 'u', c: 0, a: -R, b: R, w: 7.6 }];
    for (const c of [-27, 27, -54, 54]) { const e = Math.sqrt(R * R - c * c) - 1; streets.push({ axis: 'v', c, a: -e, b: e, w: 3.8 }, { axis: 'u', c, a: -e, b: e, w: 3.8 }); }
    const sRects = streets.map((s) => (s.axis === 'v' ? [s.c - s.w / 2, s.a, s.c + s.w / 2, s.b] : [s.a, s.c - s.w / 2, s.b, s.c + s.w / 2]));
    const placed = [];
    const hit = (a, b, m) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;
    const fits = (r) => {
      for (const [u, v] of [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]]) if (u * u + v * v > R * R) return false;
      for (const p of placed) if (hit(r, p, -0.05)) return false;
      for (const p of this.reserved) if (hit(r, p, 0.7)) return false;
      for (const p of sRects) if (hit(r, p, -0.1)) return false;
      return true;
    };
    let id = 0;
    for (const st of streets) for (const side of [-1, 1]) {
      let t = st.a + 1.2;
      while (t < st.b - 5) {
        const wH = 5.2 + rng() * 2.8, dH = 6.0 + rng() * 2.2;
        const along = t + wH / 2, lat = st.c + side * (st.w / 2 + 0.25 + dH / 2);
        const cu = st.axis === 'v' ? lat : along, cv = st.axis === 'v' ? along : lat;
        const hu = st.axis === 'v' ? dH / 2 : wH / 2, hv = st.axis === 'v' ? wH / 2 : dH / 2;
        const r = [cu - hu, cv - hv, cu + hu, cv + hv];
        if (!fits(r)) { t += 1.0; continue; }
        placed.push(r);
        const central = Math.hypot(cu, cv) < 42, f = rng();
        const floors = central ? (f < 0.6 ? 3 : 2) : f < 0.14 ? 1 : f < 0.74 ? 2 : 3;
        const yaw = st.axis === 'v' ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : side > 0 ? Math.PI : 0;
        const wc = WALLS[(rng() * WALLS.length) | 0], rc = ROOFS[(rng() * ROOFS.length) | 0];
        const h = {
          id: id++, x: this.cx + cu, z: this.cz + cv, w: wH, d: dH, floors, yaw, color: wc, roof: rc,
          pat: rng() < 0.22 ? 0 : 1 + ((rng() * 3) | 0), lit: 0.35 + rng() * 0.5, ridge: rng() < 0.45 ? 'z' : 'x', pitch: 43 + rng() * 9,
          groundTimber: rng() < 0.35, ground: rng() < 0.4 ? [0.78, 0.75, 0.7] : null, sideWin: rng() < 0.4, tallWin: rng() < 0.12,
        };
        this.house(h);
        this.houses.push(h);
        t += wH + (rng() < 0.12 ? 2.0 : 0.1);
      }
    }
    // infill: squeeze smaller houses into the remaining yards so the core feels dense
    for (let i = 0; i < 900; i++) {
      const a = rng() * Math.PI * 2, rad = Math.sqrt(rng()) * R, cu = Math.cos(a) * rad, cv = Math.sin(a) * rad;
      const wH = 4.8 + rng() * 2.4, dH = 4.8 + rng() * 2.2, k = (rng() * 4) | 0, sw = k % 2 === 1;
      const hu = (sw ? dH : wH) / 2, hv = (sw ? wH : dH) / 2;
      const r = [cu - hu, cv - hv, cu + hu, cv + hv];
      if (!fits(r)) continue;
      placed.push(r);
      const wc = WALLS[(rng() * WALLS.length) | 0], rc = ROOFS[(rng() * ROOFS.length) | 0];
      const h = { id: id++, x: this.cx + cu, z: this.cz + cv, w: wH, d: dH, floors: rng() < 0.55 ? 2 : rng() < 0.6 ? 1 : 3, yaw: k * Math.PI / 2, color: wc, roof: rc, pat: rng() < 0.3 ? 0 : 1 + ((rng() * 3) | 0), lit: 0.3 + rng() * 0.5, ridge: rng() < 0.5 ? 'z' : 'x', pitch: 43 + rng() * 9, groundTimber: rng() < 0.35, ground: null, sideWin: true, tallWin: false };
      this.house(h); this.houses.push(h);
    }
  }

  buildPlaza() {
    const P = G.physics, R = P.RAPIER, x = this.cx, z = this.cz, y0 = this.y0;
    // fountain: static basin with water, breakable centre piece
    const basin = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(3.5, 0), new THREE.Vector2(3.5, 0.75), new THREE.Vector2(3.05, 0.75), new THREE.Vector2(3.05, 0.3), new THREE.Vector2(0, 0.3)], 40);
    this.addStatic(basin, x, y0 - 0.02, z, null);
    const ringCol = P.world.createCollider(R.ColliderDesc.cylinder(0.375, 3.5).setTranslation(x, y0 + 0.37, z).setCollisionGroups(P.GROUP_TERRAIN));
    this.statics[this.statics.length - 1].collider = ringCol;
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.05, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c3a44, roughness: 0.04, metalness: 0.2, envMapIntensity: 1.6 }));
    water.position.set(x, y0 + 0.62, z); water.layers.set(LAYER_SCENE); water.receiveShadow = true;
    G.scene.add(water); this.statics.push({ mesh: water, collider: null });
    let y = y0 + 0.76;
    for (const [dia, hh] of [[1.3, 1.5], [1.0, 1.3]]) { this.add({ shape: 'cyl', mat: 'stone', x, y: y + hh / 2 + GAP, z, sx: dia, sy: hh, sz: dia, tint: 0.95 }); y += hh + GAP; }
    this.add({ shape: 'cyl', mat: 'stone', x, y: y + 0.2 + GAP, z, sx: 2.6, sy: 0.4, sz: 2.6, tint: 0.95 }); y += 0.4 + GAP;
    this.fountainTop = this.add({ shape: 'cyl', mat: 'stone', x, y: y + 0.6 + GAP, z, sx: 0.6, sy: 1.2, sz: 0.6, tint: 0.95 });
    this.fountainPos = new THREE.Vector3(x, y + 1.25, z);
    // market stalls
    const cloth = [[1.6, 0.3, 0.25], [1.5, 1.4, 1.2], [0.35, 0.6, 1.5], [1.6, 1.1, 0.3], [0.4, 1.1, 0.5]];
    const spots = [[-11, 8, 0.2], [-12, -6, -0.3], [10, 9, 0.5], [12, -8, 0.1], [-4, 12, 1.4], [5, -12, 1.7], [-13, 1, 1.5], [13, 1, 1.6]];
    spots.forEach(([u, v, yaw], i) => {
      const cs = Math.cos(yaw), sn = Math.sin(yaw), q = yawQ(yaw);
      const at = (lx, lz) => [x + u + lx * cs + lz * sn, z + v - lx * sn + lz * cs];
      for (const [lx, lz] of [[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.9], [1.3, 0.9]]) { const [px, pz] = at(lx, lz); this.add({ shape: 'box', mat: 'wood', x: px, y: y0 + 1.15 + GAP, z: pz, sx: 0.16, sy: 2.3, sz: 0.16, q, tint: 0.7, struct: false }); }
      const [cx2, cz2] = at(0, 0);
      const c = cloth[i % cloth.length];
      this.add({ shape: 'box', mat: 'wood', x: cx2, y: y0 + 2.3 + 0.06 + GAP * 2, z: cz2, sx: 3.1, sy: 0.1, sz: 2.3, q, color: C(c[0], c[1], c[2]), struct: false });
      this.add({ shape: 'box', mat: 'wood', x: cx2, y: y0 + 0.45 + GAP, z: cz2, sx: 2.3, sy: 0.9, sz: 1.0, q, tint: 0.85, struct: false });
      for (let k = 0; k < 3; k++) { const [px, pz] = at(rr(-0.9, 0.9), rr(-0.3, 0.3)); this.add({ shape: 'box', mat: 'wood', x: px, y: y0 + 0.9 + 0.2 + GAP * 2, z: pz, sx: 0.4, sy: 0.4, sz: 0.4, q: yawQ(rand() * 3), color: C(rr(0.6, 1.6), rr(0.5, 1.3), rr(0.3, 0.9)), struct: false }); }
      const [bx, bz] = at(2.1, rr(-0.5, 0.5));
      this.add({ shape: 'cyl', mat: 'wood', x: bx, y: y0 + 0.56, z: bz, sx: 0.8, sy: 1.1, sz: 0.8, tint: 0.8, struct: false });
    });
  }

  buildProps() {
    const rng = this.rng, y0 = this.y0;
    // barrels, crates and carts' worth of clutter along the streets
    for (let i = 0; i < 90; i++) {
      const onMain = rng() < 0.5, t = (rng() * 2 - 1) * 70, off = (rng() < 0.5 ? -1 : 1) * (onMain ? 3.2 : 1.5), lane = onMain ? 0 : rng() < 0.5 ? -27 : 27;
      const u = rng() < 0.5 ? lane + off : t, v = u === t ? lane + off : t;
      if (Math.hypot(u, v) > CITY.wallR - 5 || this.reserved.some((r) => u > r[0] - 1 && u < r[2] + 1 && v > r[1] - 1 && v < r[3] + 1)) continue;
      if (rng() < 0.5) this.add({ shape: 'cyl', mat: 'wood', x: this.cx + u, y: y0 + 0.56, z: this.cz + v, sx: 0.78, sy: 1.1, sz: 0.78, q: yawQ(rng() * 6), tint: 0.7 + rng() * 0.3, struct: false });
      else { const s = 0.7 + rng() * 0.4; this.add({ shape: 'box', mat: 'wood', x: this.cx + u, y: y0 + s / 2 + 0.01, z: this.cz + v, sx: s, sy: s, sz: s, q: yawQ(rng() * 6), tint: 0.75 + rng() * 0.35, struct: false }); }
    }
    // boulders on the slopes outside the walls
    let placed = 0, tries = 0;
    while (placed < 26 && tries++ < 400) {
      const a = rng() * Math.PI * 2, r = CITY.wallR + 9 + rng() * 34, x = this.cx + Math.cos(a) * r, z = this.cz + Math.sin(a) * r;
      if (Math.abs(x) < 7 && z > 30) continue;
      const big = rng() < 0.3, sc = big ? 1.8 + rng() * 1.6 : 0.6 + rng() * 0.9;
      const sx = sc * (0.8 + rng() * 0.5), sy = sc * (0.6 + rng() * 0.35), sz = sc * (0.8 + rng() * 0.5);
      this.add({ shape: 'rock', x, y: G.terrain.heightAt(x, z) + sy * 0.3, z, sx, sy, sz, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 0.5, rng() * 6.28, rng() * 0.5)), tint: 0.75 + rng() * 0.35, struct: false });
      placed++;
    }
  }
}
