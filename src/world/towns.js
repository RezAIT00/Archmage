// The settlements of the realm outside the capital. Each builder reads its site (flattened by the
// terrain at start-up) and raises real rigid bodies on it. Layout choices use seeded RNGs only.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { makeRng } from '../core/util.js';
import { SITES, LAKES } from './layout.js';
import {
  GAP, yawQ, C, col, pickR, between, frame, faceYaw, Plot, tower, drumTower, wallRun, shell, pier, tint,
  barrel, crate, hayBale, logPile, stoneStack, fence, dryWall, sails, banner,
} from './kit.js';

const TAU = Math.PI * 2;
let HID = 5000;
export function resetIds() { HID = 5000; }
const siteOf = (id) => SITES.find((s) => s.id === id);

// village lanes (local [u, v] metres in the village frame) — also painted on the ground as dirt tracks
const VILLAGE_STREETS = {
  barleyford: { yaw: -0.2, segs: [[[-46, 6], [-11, 0], 4], [[11, 0], [46, -7], 4], [[2, -46], [0, -11], 3.6], [[0, 11], [-5, 46], 3.6]], ring: [13, 3.2] },
  norbury: { yaw: 0.3, segs: [[[-34, 0], [34, 0], 4.6], [[0, -34], [0, 34], 4.6]] },
  tarnside: { yaw: Math.atan2(0.866, -0.5), segs: [[[-27, -4], [27, -4], 3.6], [[2, -2], [2, 24], 3.2]] },
};
export function villageRoads(sites) {
  const out = [];
  for (const [id, v] of Object.entries(VILLAGE_STREETS)) {
    const s = sites.find((q) => q.id === id), F = frame(s.x, s.z, v.yaw), P = ([u, w]) => F.at(u, w).map((t) => +t.toFixed(2));
    for (const [a, b, w] of v.segs) out.push({ w: w * 0.5, pts: [P(a), P(b)] });
    if (v.ring) { const pts = []; for (let i = 0; i <= 16; i++) { const a = (i / 16) * TAU; pts.push([s.x + Math.cos(a) * v.ring[0], s.z + Math.sin(a) * v.ring[0]]); } out.push({ w: v.ring[1] * 0.5, pts }); }
  }
  return out;
}

// (a town whose flat ground grew past its old site keeps its old layout inside `core`; townsx.js builds the new streets
// round it and finds this context in W.townCtx)
function ctxFor(W, id, seed, margin = 2.6) {
  const s = siteOf(id), ctx = { W, site: s, y0: s.h, rng: makeRng(seed), tag: id, plot: new Plot(s, margin + s.r - (s.core ?? s.r)), houses: [] };
  (W.townCtx ||= {})[id] = ctx;
  return ctx;
}

// ------------------------------------------------------------------ palettes (wanted average linear colours)
const R = (r, g, b) => tint('roof', r, g, b), P = (r, g, b) => tint('plaster', r, g, b), A = (r, g, b) => tint('ashlar', r, g, b), S_ = (r, g, b) => tint('stone', r, g, b);
const SLATE = R(0.105, 0.106, 0.11), SLATE_D = R(0.066, 0.067, 0.07), SLATE_B = R(0.09, 0.095, 0.106);
const THATCH = [R(0.27, 0.19, 0.08), R(0.22, 0.155, 0.065), R(0.3, 0.215, 0.095)];
const TILE_BROWN = R(0.2, 0.09, 0.05), TILE_DARK = R(0.13, 0.065, 0.04), COPPER = R(0.1, 0.19, 0.155);
const GABLE_GREY = P(0.3, 0.29, 0.27), GABLE_DARK = P(0.2, 0.19, 0.18);

// ------------------------------------------------------------------ houses
const OV = 0.35, OVL = 0.3;
// footprint including the roof overhang, so neighbouring roofs never interpenetrate
function fpOf(s, x = 0, z = 0, yaw = 0) {
  const ov = s.roofOpts?.ov ?? OV, ovl = (s.roofOpts?.ovL ?? OVL) / 2;
  const ew = s.flat ? 0.05 : s.ridge === 'x' ? ovl : ov, ed = s.flat ? 0.05 : s.ridge === 'x' ? ov : ovl;
  return { x, z, hw: s.w / 2 + ew, hd: s.d / 2 + ed, yaw };
}
function house(ctx, s) {
  const h = { id: HID++, y0: ctx.y0, tag: ctx.tag, t: 0.4, lean: true, ...s, roofOpts: { ov: OV, ovL: OVL, tag: ctx.tag, ...(s.roofOpts || {}) } };
  h.top = ctx.W.house(h); ctx.houses.push(h); (ctx.W.townHouses ||= []).push(h);
  return h;
}
// place a house at a fixed spot if it fits the plot
function houseAt(ctx, s, x, z, yaw, m = 0.06) {
  const fp = fpOf(s, x, z, yaw);
  if (!ctx.plot.fits(fp, m)) return null;
  ctx.plot.take(fp);
  return house(ctx, { ...s, x, z, yaw });
}
// a row of houses along one side of a straight street A->B (side: +1 left, -1 right), fronts facing it
function row(ctx, A, B, sw, side, gen, o = {}) {
  const { plot, rng } = ctx;
  const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz * side, nz = ux * side;
  let t = o.start ?? 0.3, placed = 0;
  while (t < L - (o.endTrim ?? 2)) {
    const s = gen(rng, o), e = fpOf(s);
    const along = t + e.hw, off = sw / 2 + (o.setback ?? 0.3) + e.hd;
    const x = A[0] + ux * along + nx * off, z = A[1] + uz * along + nz * off, yaw = faceYaw(-nx, -nz);
    const fp = { ...e, x, z, yaw };
    if (!plot.fits(fp, 0.06)) { t += 0.9; continue; }
    plot.take(fp); house(ctx, { ...s, x, z, yaw }); placed++;
    t += e.hw * 2 + 0.08 + (o.gap ? o.gap(rng) : 0);
    if (o.max && placed >= o.max) break;
  }
  return placed;
}
const rows = (ctx, A, B, sw, gen, o) => row(ctx, A, B, sw, 1, gen, o) + row(ctx, A, B, sw, -1, gen, o);
// streets round a circle (n chords), houses on both sides
function ring(ctx, cx, cz, r, n, sw, gen, o = {}) {
  const pts = []; for (let i = 0; i <= n; i++) { const a = (o.a0 || 0) + (i / n) * TAU; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  for (let i = 0; i < n; i++) ctx.plot.street(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], sw);
  pts.r = r * Math.cos(Math.PI / n);
  return pts;
}
// houses round a circular street of radius r (side +1: inside the ring, -1: outside), fronts facing it
function ringRow(ctx, cx, cz, r, sw, side, gen, o = {}) {
  const { plot, rng } = ctx;
  let a = o.a0 || 0, placed = 0;
  const end = a + TAU;
  while (a < end) {
    const s = gen(rng, o), e = fpOf(s);
    const front = r - side * (sw / 2 + (o.setback ?? 0.45)), rc = front - side * e.hd;
    const x = cx + Math.cos(a) * rc, z = cz + Math.sin(a) * rc, yaw = faceYaw(side * Math.cos(a), side * Math.sin(a));
    const fp = { ...e, x, z, yaw };
    const rTight = side > 0 ? front - 2 * e.hd : front;
    if (!plot.fits(fp, 0.06)) { a += 0.8 / front; continue; }
    plot.take(fp); house(ctx, { ...s, x, z, yaw }); placed++;
    a += (e.hw * 2 + 0.1 + (o.gap ? o.gap(rng) : 0)) / Math.max(4, rTight);
  }
  return placed;
}
// scatter houses into the remaining space
function infill(ctx, tries, gen, o = {}) {
  const { site: S, rng, plot } = ctx;
  let placed = 0;
  for (let i = 0; i < tries; i++) {
    const a = rng() * TAU, r0 = o.rMin ?? 0, rad = r0 + Math.sqrt(rng()) * (plot.R - r0), x = S.x + Math.cos(a) * rad, z = S.z + Math.sin(a) * rad;
    const s = gen(rng, o);
    const yaw = o.yaw !== undefined ? o.yaw + ((rng() * 4) | 0) * (Math.PI / 2) : faceYaw(S.x - x, S.z - z) + (rng() - 0.5) * 0.4;
    const fp = fpOf(s, x, z, yaw);
    if (!plot.fits(fp, o.m ?? 0.5)) continue;
    plot.take(fp); house(ctx, { ...s, x, z, yaw }); placed++;
    if (o.max && placed >= o.max) break;
  }
  return placed;
}
// barrels / crates against the front walls of some houses
function frontProps(ctx, frac = 0.3) {
  const { rng, y0 } = ctx;
  for (const h of ctx.houses) {
    if (h.noProps || rng() > frac) continue;
    const F = frame(h.x, h.z, h.yaw), side = rng() < 0.5 ? -1 : 1, lx = side * (h.w / 2 - 0.55), lz = h.d / 2 + 0.5;
    const [px, pz] = F.at(lx, lz), y = h.y0 ?? y0;
    if (rng() < 0.55) barrel(px, y, pz, rng, ctx.tag); else crate(px, y, pz, rng, ctx.tag);
    if (rng() < 0.35) { const [qx, qz] = F.at(lx - side * 0.95, lz); crate(qx, y, qz, rng, ctx.tag); }
  }
}
// market stall (loose props)
export function stall(ctx, x, z, yaw, cloth) {
  const { rng, y0 } = ctx, Ph = G.physics, F = frame(x, z, yaw);
  for (const [lx, lz] of [[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.9], [1.3, 0.9]]) { const [px, pz] = F.at(lx, lz); Ph.add({ shape: 'box', mat: 'wood', x: px, y: y0 + 1.15 + GAP, z: pz, sx: 0.16, sy: 2.3, sz: 0.16, q: F.q, tint: 0.7, tag: ctx.tag }); }
  Ph.add({ shape: 'box', mat: 'wood', x, y: y0 + 2.36 + 2 * GAP, z, sx: 3.1, sy: 0.1, sz: 2.3, q: F.q, color: col(cloth), tag: ctx.tag });
  Ph.add({ shape: 'box', mat: 'wood', x, y: y0 + 0.45 + GAP, z, sx: 2.3, sy: 0.9, sz: 1.0, q: F.q, tint: 0.85, tag: ctx.tag });
  for (let k = 0; k < 3; k++) { const [px, pz] = F.at((rng() - 0.5) * 1.8, (rng() - 0.5) * 0.6); Ph.add({ shape: 'box', mat: 'wood', x: px, y: y0 + 1.1 + 2 * GAP, z: pz, sx: 0.4, sy: 0.4, sz: 0.4, q: yawQ(rng() * 3), color: C(0.6 + rng(), 0.5 + rng() * 0.8, 0.3 + rng() * 0.6), tag: ctx.tag }); }
}
// stepped plinth + column + little pyramid (market cross, shrine)
export function cross(W, x, z, y0, tag, o = {}) {
  const c = col(o.color || S_(0.32, 0.31, 0.29));
  let y = y0;
  for (const [s, h] of o.steps || [[2.4, 0.4], [1.6, 0.4]]) { W.add({ shape: 'box', mat: 'stone', x, y: y + h / 2 + GAP, z, sx: s, sy: h, sz: s, color: c, tag }); y += h + GAP; }
  for (let k = 0; k < (o.drums || 2); k++) { W.add({ shape: 'cyl', mat: 'stone', x, y: y + 0.65 + GAP, z, sx: o.dia || 0.6, sy: 1.3, sz: o.dia || 0.6, color: c, tag }); y += 1.3 + GAP; }
  W.add({ shape: 'box', mat: 'stone', x, y: y + 0.15 + GAP, z, sx: 0.9, sy: 0.3, sz: 0.9, color: c, tag }); y += 0.3 + GAP;
  W.add({ shape: 'pyr', mat: 'roof', x, y: y + 0.5 + GAP, z, sx: 0.9, sy: 1.0, sz: 0.9, color: col(o.cap || SLATE), friction: 1.2, tag });
}
export function well(W, x, z, y0, tag) {
  W.add({ shape: 'cyl', mat: 'stone', x, y: y0 + 0.45 + GAP, z, sx: 1.9, sy: 0.9, sz: 1.9, color: col(S_(0.26, 0.25, 0.24)), tag });
}
// simple church: optional west tower + nave shell + roof. Local +x runs from the tower to the altar.
// Returns { fp (footprint to reserve), tower }.
export function church(ctx, cx, cz, yaw, o) {
  const { W, y0, tag } = ctx;
  const F = frame(cx, cz, yaw), stone = col(o.stone || A(0.34, 0.32, 0.28)), roofC = col(o.roof || SLATE), gable = col(o.gable || GABLE_GREY);
  const w = o.w, d = o.d, T = o.t || 0.7, tiers = o.tiers || 1, th = o.th || 5;
  const yTop = shell(W, {
    x: cx, z: cz, y0, yaw, w, d, t: T, tiers, th, mat: 'ashlar', color: stone, panel: o.panel || 3.8, tag, house: HID++,
    style: (side, k) => (side === 'front' || side === 'back') ? (k === tiers - 1 ? [o.glass ? 5 : 3, 0, 0.8, 0] : [0, 0, 0, 0])
      : side === 'left' && k === 0 && !o.tower ? [2, 0, 0.5, 0] : side === 'right' && k === tiers - 1 ? [5, 0, 0.9, 0] : [0, 0, 0, 0],
  });
  W.roof(cx, yTop, cz, w, d, yaw, 'x', o.pitch || 52, gable, roofC, 0, 1, T, { gableFeat: o.rose ? 5 : 4, ov: 0.45, ovL: 0.4, tag });
  let res = null;
  const ts = o.tower ? o.tower.side : 0, x0 = -w / 2 - (o.tower ? 0.25 + ts : 0) - 0.4, x1 = w / 2 + 0.45, [fx, fz] = F.at((x0 + x1) / 2, 0);
  const fp = { x: fx, z: fz, hw: (x1 - x0) / 2, hd: d / 2 + (o.buttress ? 1.5 : 0.5), yaw };
  if (o.tower) {
    const [tx, tz] = F.at(-w / 2 - 0.25 - ts / 2, 0);
    res = tower(W, tx, tz, y0, ts, o.tower.layers, o.tower.lh || 1.6, {
      rot: yaw, color: stone, tag, spire: o.tower.spire, spireColor: o.tower.spireColor || o.roof || SLATE, merlons: o.tower.merlons, tall: o.tower.tall,
      styleAt: o.tower.styleAt || ((k) => (k === o.tower.layers - 2 ? [3, 0, 0.8, 0] : k === 1 ? [2, 0, 0.4, 0] : k % 4 === 3 ? [1, 0, 0.5, 0] : [0, 0, 0, 0])),
    });
  }
  return { fp, tower: res };
}
// tower windmill (sails are an attached visual that flies apart when the cap is hit)
export function windmill(ctx, x, z, y0, yaw, o = {}) {
  const { W, tag } = ctx;
  const wallC = col(o.color || P(0.42, 0.41, 0.38));
  const t = tower(W, x, z, y0, o.side || 5.4, o.layers || 7, o.lh || 1.55, {
    mat: 'plaster', color: wallC, taper: 0.3, rot: yaw, tag, capMat: 'wood', capOver: 0.3,
    styleAt: (k) => (k === 0 ? [2, 0, 0.3, 0] : k % 2 ? [1, 0, 0.45, 0] : [0, 0, 0, 0]),
  });
  const cw = t.top + 0.3;
  W.roof(x, t.y, z, cw, cw * 1.2, yaw, 'z', 50, col(P(0.16, 0.11, 0.08)), col(o.roof || TILE_DARK), 1, 0, 0.3, { gableFeat: 0, ov: 0.25, ovL: 0.2, tag });
  const capBody = W.lastRoof;
  // hub in front of the cap (+z of the mill frame), axle tilted up a little
  const F = frame(x, z, yaw), [hx, hz] = F.at(0, cw * 0.6 + 0.55);
  const rise = ((cw + 0.5) / 2) * Math.tan(THREE.MathUtils.degToRad(50));
  const Md = new THREE.Matrix4().compose(new THREE.Vector3(hx, t.y + rise * 0.3, hz), yawQ(yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.14)), new THREE.Vector3(1, 1, 1));
  if (capBody) {
    const Mb = new THREE.Matrix4().compose(new THREE.Vector3(capBody.x, capBody.y, capBody.z), new THREE.Quaternion().copy(capBody.body.rotation()), new THREE.Vector3(1, 1, 1));
    sails(W, capBody, Mb.invert().multiply(Md), o.speed ?? 0.45);
  }
  return t;
}
// wooden pier from (ax, az) heading along yaw (local +z), deck top at yDeck. Posts stand on the ground/lake bed.
export function woodPier(ctx, ax, az, yaw, len, yDeck, o = {}) {
  const { W, tag } = ctx, F = frame(ax, az, yaw), span = o.span || 3, wid = o.w || 2.6;
  const n = Math.round(len / span), capH = 0.3, deckT = 0.22, capY = yDeck - deckT - GAP - capH / 2 - GAP;
  const ground = (x, z) => G.terrain.heightAt(x, z);
  // pilings are static (driven into the bank / lake bed, so they never slide down the slope);
  // the cap beams and deck planks on top are ordinary breakable bodies
  const Rp = G.physics.RAPIER, pileMat = W.pileMat || (W.pileMat = new THREE.MeshStandardMaterial({ map: G.tex.wood_diff, roughness: 0.9, metalness: 0, color: C(0.62, 0.5, 0.42) }));
  for (let i = 0; i <= n; i++) {
    const lz = i * span;
    for (const s of [-1, 1]) {
      const [px, pz] = F.at(s * (wid / 2 - 0.2), lz);
      let gy = 1e9; for (const [ox, oz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) gy = Math.min(gy, ground(px + ox, pz + oz));
      const top = capY - capH / 2 - GAP, bot = gy - 1.2, hgt = top - bot;
      if (top - gy < 0.25) continue;
      const m = W.addStatic(new THREE.BoxGeometry(0.34, hgt, 0.34), px, bot + hgt / 2, pz, Rp.ColliderDesc.cuboid(0.17, hgt / 2, 0.17).setRotation(F.q), pileMat);
      m.quaternion.copy(F.q);
    }
    const [cx, cz] = F.at(0, lz);
    W.add({ shape: 'box', mat: 'wood', x: cx, y: capY, z: cz, sx: wid + 0.3, sy: capH, sz: 0.42, q: F.q, tint: 0.6, tag });
    if (i < n) {
      const [dx2, dz2] = F.at(0, lz + span / 2);
      W.add({ shape: 'box', mat: 'wood', x: dx2, y: yDeck - deckT / 2, z: dz2, sx: wid, sy: deckT, sz: span - 0.012, q: F.q, tint: 0.85, tag });
    }
  }
  return F;
}

// ================================================================== WESTMARCH — market town
export function buildWestmarch(W) {
  const ctx = ctxFor(W, 'westmarch', 7101), { site: S, y0, rng, plot } = ctx, tag = 'westmarch';
  const yaw0 = 0.12, F = frame(S.x, S.z, yaw0), L = (u, v) => F.at(u, v);
  const lob = (u, v, hw, hd, yaw = yaw0) => { const [x, z] = L(u, v); return { x, z, hw, hd, yaw }; };
  const WALLS = [P(0.3, 0.11, 0.07), P(0.4, 0.26, 0.1), P(0.42, 0.38, 0.28), P(0.27, 0.3, 0.22), P(0.42, 0.26, 0.22), P(0.25, 0.29, 0.33), P(0.38, 0.28, 0.08), P(0.33, 0.28, 0.34), P(0.4, 0.36, 0.3), P(0.36, 0.16, 0.1)];
  const ROOFS = [R(0.24, 0.08, 0.035), R(0.2, 0.09, 0.05), R(0.28, 0.12, 0.05), R(0.16, 0.1, 0.08), R(0.3, 0.1, 0.04), TILE_DARK];
  const gen = (r, o = {}) => {
    const f = r();
    return {
      w: between(r, 4.4, 6.2), d: between(r, 6.4, 8.4), floors: o.big ? (f < 0.45 ? 4 : 3) : f < 0.25 ? 2 : f < 0.85 ? 3 : 4, fh: between(r, 2.7, 3.0),
      color: pickR(r, WALLS), roof: pickR(r, ROOFS), ridge: r() < 0.72 ? 'z' : 'x', pitch: between(r, 50, 60), pat: r() < 0.3 ? 0 : 1 + ((r() * 3) | 0),
      lit: 0.3 + r() * 0.55, groundTimber: r() < 0.3, ground: r() < 0.45 ? P(0.34, 0.31, 0.27) : null, sideWin: r() < 0.3, tallWin: r() < 0.15, roofOpts: { ov: 0.28 },
    };
  };
  // ---- landmarks first
  plot.reserve(lob(0, 0, 14, 10));                               // market square
  plot.reserve(church(ctx, ...L(15.2, -16.3), yaw0, {
    w: 13.6, d: 9.6, tiers: 2, th: 4.4, t: 0.75, stone: A(0.42, 0.3, 0.17), gable: P(0.4, 0.33, 0.24), roof: R(0.2, 0.085, 0.05), glass: true, rose: true,
    tower: { side: 5.6, layers: 13, spire: 11, spireColor: COPPER, tall: { 10: 3.0 }, styleAt: (k) => (k === 10 ? [3, 0, 0.9, 0] : k === 8 ? [6, 0, 1, 0] : k === 1 ? [2, 0, 0.4, 0] : k % 3 === 2 ? [1, 0, 0.5, 0] : [0, 0, 0, 0]) },
  }).fp);
  // market hall on stone columns
  {
    const [hx, hz] = L(-6.3, -6.0), H = frame(hx, hz, yaw0);
    for (const cxl of [-4.6, -1.53, 1.53, 4.6]) for (const czl of [-2.55, 2.55]) {
      const [px, pz] = H.at(cxl, czl);
      for (let k = 0; k < 2; k++) W.add({ shape: 'cyl', mat: 'stone', x: px, y: y0 + 0.675 + k * (1.35 + GAP) + GAP, z: pz, sx: 0.75, sy: 1.35, sz: 0.75, color: col(S_(0.34, 0.3, 0.25)), tag });
    }
    const sy = y0 + 2.7 + 3 * GAP;
    W.add({ shape: 'box', mat: 'wood', x: hx, y: sy + 0.15 + GAP, z: hz, sx: 11.2, sy: 0.3, sz: 6.3, q: H.q, tint: 0.7, tag });
    house(ctx, { x: hx, z: hz, yaw: yaw0, w: 11, d: 6, floors: 1, fh: 3, y0: sy + 0.3 + 2 * GAP, color: P(0.42, 0.34, 0.2), roof: R(0.2, 0.08, 0.04), ridge: 'x', pitch: 52, pat: 3, lit: 0.6, sideWin: true, roofOpts: { ov: 0.55, ovL: 0.5, gableFeat: 4 }, noProps: true });
    plot.reserve(lob(-6.3, -6.0, 6.2, 3.6));
  }
  // guild hall facing the square
  { const [gx, gz] = L(-8.3, 14.2); house(ctx, { x: gx, z: gz, yaw: yaw0 + Math.PI, w: 11, d: 7.6, floors: 3, fh: 3.3, color: P(0.26, 0.08, 0.06), ground: P(0.34, 0.31, 0.27), roof: TILE_DARK, ridge: 'x', pitch: 54, pat: 3, lit: 0.8, tallWin: true, sideWin: true, t: 0.5, roofOpts: { gableFeat: 4 }, noProps: true }); plot.reserve(lob(-8.3, 14.2, 5.7, 4.2)); }
  // east gate: two towers and a lintel over the main street
  {
    const GS = A(0.36, 0.28, 0.2), tops = [];
    for (const s of [-1, 1]) { const [tx, tz] = L(46, s * 5.6); tops.push(tower(W, tx, tz, y0, 5, 9, 1.5, { rot: yaw0, color: GS, tag, styleAt: (k) => (k === 6 ? [1, 0, 0.6, 0] : [0, 0, 0, 0]) })); plot.reserve(lob(46, s * 5.6, 2.9, 2.9)); }
    const [lx, lz] = L(46, 0), ly = Math.min(tops[0].y, tops[1].y);
    const lin = W.add({ shape: 'box', mat: 'ashlar', x: lx, y: ly + 0.7 + GAP, z: lz, sx: 3.6, sy: 1.4, sz: 16.7, q: yawQ(yaw0), color: col(GS), tag });
    for (let i = 0; i < 6; i++) { const [mx, mz] = L(46 + 1.2, -7.5 + i * 3); W.add({ shape: 'box', mat: 'ashlar', x: mx, y: ly + 1.4 + 0.45 + 2 * GAP, z: mz, sx: 0.8, sy: 0.9, sz: 1.2, q: yawQ(yaw0), color: col(GS), tag }); }
    banner(W, lin, 0.7, [0.85, 0.65, 0.12], yaw0);
  }
  // ---- streets: the cross, a ring and four diagonal lanes
  const ST = [[[-62, 0], [62, 0], 5.6], [[0, -62], [0, 62], 4.6]];
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) ST.push([[Math.cos(a) * 33.5, Math.sin(a) * 33.5], [Math.cos(a) * 60, Math.sin(a) * 60], 3.2]);
  for (const [a, b, w] of ST) plot.street(...L(...a), ...L(...b), w);
  const rp = ring(ctx, S.x, S.z, 30, 24, 3.4, gen, { a0: 0.05 });
  // square frontage first (tall houses), then the cross, the ring and the lanes, then the yards
  row(ctx, L(-14, -10), L(14, -10), 0, -1, gen, { big: true, endTrim: 0.5 });
  row(ctx, L(-14, 10), L(14, 10), 0, 1, gen, { big: true, endTrim: 0.5 });
  row(ctx, L(-14, -10), L(-14, 10), 0, 1, gen, { big: true, endTrim: 0.5 });
  row(ctx, L(14, -10), L(14, 10), 0, -1, gen, { big: true, endTrim: 0.5 });
  for (const [a, b, w] of ST.slice(0, 2)) rows(ctx, L(...a), L(...b), w, gen);
  ringRow(ctx, S.x, S.z, rp.r, 3.4, 1, gen); ringRow(ctx, S.x, S.z, rp.r, 3.4, -1, gen, { a0: 0.07 });
  for (const [a, b, w] of ST.slice(2)) rows(ctx, L(...a), L(...b), w, gen);
  ringRow(ctx, S.x, S.z, plot.R - 0.1, 0, 1, (r) => ({ ...gen(r), d: between(r, 5.2, 7) }), { setback: 0.2 });
  infill(ctx, 600, (r) => ({ ...gen(r), w: between(r, 4.4, 6), d: between(r, 5, 7), floors: r() < 0.5 ? 2 : 3 }), { yaw: yaw0, m: 0.3 });
  infill(ctx, 1500, (r) => ({ ...gen(r), w: between(r, 3.8, 5.2), d: between(r, 4.2, 5.8), floors: r() < 0.6 ? 2 : 3 }), { m: 0.15, rMin: 20 });
  // ---- the square: market cross, well, stalls
  cross(W, ...L(7, 6), y0, tag, { color: S_(0.36, 0.32, 0.26) });
  well(W, ...L(-10.5, 5.2), y0, tag);
  const cloth = [[1.6, 0.3, 0.25], [1.5, 1.4, 1.2], [0.35, 0.6, 1.5], [1.6, 1.1, 0.3], [0.4, 1.1, 0.5]];
  [[7.5, -6, 0.1], [11, 5.5, 1.5], [-4.5, 6.6, 0.2], [2.6, 7.2, -0.1], [10.5, -2.2, 1.6]].forEach(([u, v, a], i) => stall(ctx, ...L(u, v), yaw0 + a, cloth[i % cloth.length]));
  frontProps(ctx, 0.3);
  return ctx.houses.length;
}

// ================================================================== RAVENSCAR — hill castle
export function buildCastle(W) {
  const ctx = ctxFor(W, 'castle', 7202), { site: S, y0, rng } = ctx;
  const tag = 'castle', STONE_C = S_(0.17, 0.165, 0.16), KEEP_C = A(0.23, 0.22, 0.21), RED = [0.75, 0.07, 0.06], GOLD = [0.95, 0.72, 0.15];
  const Rr = 31, N = 8, rad = 3.6, bt = 2.2;
  const V = []; for (let k = 0; k < N; k++) { const a = ((k + 0.5) / N) * TAU; V.push([S.x + Math.cos(a) * Rr, S.z + Math.sin(a) * Rr]); }
  // round drum towers at the corners
  V.forEach(([vx, vz], k) => {
    const t = drumTower(W, vx, vz, y0, rad * 2, 9, 1.8, { color: STONE_C, tag });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; W.add({ shape: 'box', mat: 'stone', x: vx + Math.cos(a) * (rad - 0.55), y: t.y + 0.5 + GAP, z: vz + Math.sin(a) * (rad - 0.55), sx: 0.7, sy: 1.0, sz: 1.3, q: yawQ(-a), color: col(STONE_C), tag }); }
    if (k % 2 === 1) banner(W, t.last, 0.9, RED, k);
  });
  // curtain walls between the towers; the east side (between V[7] and V[0]) has the gate
  const trim = Math.sqrt((rad + 0.08) ** 2 - (bt / 2) ** 2);
  for (let k = 0; k < N; k++) {
    const [ax, az] = V[k], [bx, bz] = V[(k + 1) % N], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const gate = k === N - 1, Lr = L - 2 * trim;
    wallRun(W, ax + ux * trim, az + uz * trim, bx - ux * trim, bz - uz * trim, y0, {
      layers: 5, bh: 1.5, bt, bl: 3.3, mat: 'stone', color: STONE_C, tag, merlons: true, merlonSide: -1,
      openings: gate ? [{ t0: Lr / 2 - 2.3, t1: Lr / 2 + 2.3, layers: 3, bear: 1.4 }] : [],
    });
  }
  // gatehouse: two square towers in front of the gate with a bridge block between them
  {
    const gx = S.x + Rr * Math.cos(Math.PI / 8), gz = S.z, out = bt / 2 + 2.45 + 0.1, tops = [];
    for (const s of [-1, 1]) tops.push(tower(W, gx + out, gz + s * 4.9, y0, 4.8, 8, 1.5, { color: STONE_C, mat: 'stone', tag, styleAt: () => [0, 0, 0, 0] }));
    const ly = Math.min(tops[0].y, tops[1].y);
    W.add({ shape: 'box', mat: 'stone', x: gx + out, y: ly + 0.6 + GAP, z: gz, sx: 5.2, sy: 1.2, sz: 13.0, color: col(STONE_C), tag });
    for (let i = 0; i < 5; i++) W.add({ shape: 'box', mat: 'stone', x: gx + out + 2.0, y: ly + 1.2 + 0.5 + 2 * GAP, z: gz - 6 + i * 3, sx: 0.8, sy: 1.0, sz: 1.3, color: col(STONE_C), tag });
  }
  // the keep: four storeys of ashlar, corner turrets, battlements
  const kx = S.x - 8.5, kz = S.z, kw = 13;
  const top = shell(W, {
    x: kx, z: kz, y0, yaw: Math.PI / 2, w: kw, d: kw, t: 1.0, tiers: 4, th: [5, 4.2, 4.2, 4.2], mat: 'ashlar', color: KEEP_C, panel: 4.3, slab: 'top', slabT: 0.4, tag, house: HID++,
    style: (side, k, i, n) => (k === 0 ? (side === 'front' && i === (n >> 1) ? [2, 0, 0.4, 0] : [0, 0, 0, 0]) : (i + k) % 2 === 0 ? [1, 0, 0.55, 0] : [0, 0, 0, 0]),
  });
  const KF = frame(kx, kz, Math.PI / 2);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const [tx, tz] = KF.at(sx * (kw / 2 - 1.45), sz * (kw / 2 - 1.45));
    const t = tower(W, tx, tz, top, 2.8, 3, 1.4, { color: KEEP_C, tag, spire: 3.6, spireColor: SLATE_D, styleAt: (k) => (k === 1 ? [1, 0, 0.6, 0] : [0, 0, 0, 0]) });
    if (sx > 0 && sz > 0) banner(W, t.cap, 0.25 + 3.6, GOLD, 0.6);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const l = (i - 1) * 2.6;
    for (const [mx, mz, ry] of [[s * (kw / 2 - 0.35), l, Math.PI / 2], [l, s * (kw / 2 - 0.35), 0]]) {
      const [px, pz] = KF.at(mx, mz);
      W.add({ shape: 'box', mat: 'ashlar', x: px, y: top + 0.5 + GAP, z: pz, sx: 1.2, sy: 1.0, sz: 0.6, q: yawQ(Math.PI / 2 + ry), color: col(KEEP_C), tag });
    }
  }
  // inner buildings against the walls
  const inner = new Plot({ x: S.x, z: S.z, r: 27.2 }, 2.4);
  inner.reserve({ x: kx, z: kz, hw: kw / 2 + 0.6, hd: kw / 2 + 0.6, yaw: 0 });
  inner.reserve({ x: S.x + 22, z: S.z, hw: 8, hd: 3.5, yaw: 0 });  // gate passage
  const ictx = { ...ctx, plot: inner };
  houseAt(ictx, { w: 16, d: 8, floors: 2, fh: 3.4, mat: 'ashlar', color: KEEP_C, gable: GABLE_DARK, roof: SLATE_D, ridge: 'x', pitch: 50, pat: 0, lit: 0.8, tallWin: true, sideWin: true, t: 0.6, roofOpts: { gableFeat: 4 } }, S.x + 5, S.z - 16.5, 0);
  houseAt(ictx, { w: 10, d: 6.5, floors: 1, fh: 5, mat: 'ashlar', color: A(0.28, 0.27, 0.25), gable: GABLE_GREY, roof: SLATE_D, ridge: 'x', pitch: 55, pat: 0, lit: 0.9, tallWin: true, sideWin: true, t: 0.6, roofOpts: { gableFeat: 4 } }, S.x + 6, S.z + 17.5, Math.PI);
  const BAR = (r, w) => ({ w, d: 5, floors: r() < 0.5 ? 1 : 2, fh: 3, color: pickR(r, [P(0.4, 0.37, 0.31), P(0.33, 0.29, 0.24)]), roof: SLATE_D, ridge: 'x', pitch: 46, pat: 1 + ((r() * 2) | 0), lit: 0.5, sideWin: true });
  for (const [x, z, yaw, w] of [[10, -8.5, 0, 10], [-10, -13, 0.5, 7], [-10, 13, Math.PI - 0.5, 7], [-19.6, 0, Math.PI / 2, 6]]) houseAt(ictx, BAR(rng, w), S.x + x, S.z + z, yaw, 0.3);
  houseAt(ictx, { w: 9, d: 5, floors: 1, fh: 3.2, mat: 'wood', color: [0.5, 0.36, 0.26], gable: P(0.16, 0.11, 0.08), roof: SLATE_D, ridge: 'x', pitch: 40, pat: 1, lit: 0, sideWin: false, backWin: false, noProps: true }, S.x + 11, S.z + 8.5, Math.PI, 0.3);
  well(W, S.x + 4, S.z - 3, y0, tag); inner.take({ circle: true, x: S.x + 4, z: S.z - 3, r: 1.2 });
  for (let i = 0; i < 4; i++) { const hx = S.x + 18 + (i % 2) * 2.3, hz = S.z + 7 + ((i / 2) | 0) * 2.3; hayBale(hx, y0, hz, rng, tag, false); inner.take({ circle: true, x: hx, z: hz, r: 0.8 }); }
  for (let i = 0; i < 14; i++) { const a = rng() * TAU, r = 6 + rng() * 14, x = S.x + 4 + Math.cos(a) * r * 0.6, z = S.z + Math.sin(a) * r; if (inner.fits({ circle: true, x, z, r: 0.8 }, 0.2)) { if (rng() < 0.5) barrel(x, y0, z, rng, tag); else crate(x, y0, z, rng, tag); inner.take({ circle: true, x, z, r: 0.6 }); } }
  return ctx.houses.length;
}

// ================================================================== ST ALDHELM'S ABBEY
export function buildAbbey(W) {
  const ctx = ctxFor(W, 'abbey', 7303), { site: S, y0, rng } = ctx, tag = 'abbey';
  const yaw0 = -0.06, F = frame(S.x, S.z, yaw0), L = (u, v) => F.at(u, v);
  const ST = A(0.33, 0.32, 0.3), SL = SLATE_B, GB = GABLE_GREY;
  // precinct wall with a west gate
  const cs = [[-30, -25], [30, -25], [30, 25], [-30, 25]].map(([u, v]) => L(u, v));
  for (let i = 0; i < 4; i++) {
    const a = cs[i], b = cs[(i + 1) % 4];
    wallRun(W, a[0], a[1], b[0], b[1], y0, { layers: 2, bh: 1.2, bt: 0.9, bl: 2.8, mat: 'stone', color: S_(0.3, 0.29, 0.27), tag, openings: i === 3 ? [{ t0: 2.5, t1: 7.5, layers: 2 }] : [] });
  }
  for (const v of [18.05, 21.95]) { const [px, pz] = L(-30, v); pier(W, px, pz, y0, 1.0, 3.0, 1.0, yaw0, { tag, color: ST }); W.add({ shape: 'pyr', mat: 'roof', x: px, y: y0 + 3.0 + 0.7 + 2 * GAP, z: pz, sx: 1.1, sy: 1.4, sz: 1.1, q: yawQ(yaw0), color: col(SL), friction: 1.2, tag }); }
  // abbey church: nave + choir + north transept + west tower
  const [nx, nz] = L(-1, -12);
  const yTop = shell(W, {
    x: nx, z: nz, y0, yaw: yaw0, w: 28, d: 11, t: 0.85, tiers: 2, th: [5, 5], mat: 'ashlar', color: ST, panel: 4, tag, house: HID++,
    style: (side, k) => (side === 'front' || side === 'back') ? (k === 1 ? [5, 0, 0.9, 0] : [0, 0, 0, 0]) : side === 'right' && k === 1 ? [5, 0, 1, 0] : [0, 0, 0, 0],
  });
  W.roof(nx, yTop, nz, 28, 11, yaw0, 'x', 55, col(GB), col(SL), 0, 1, 0.85, { gableFeat: 5, ov: 0.5, ovL: 0.4, tag });
  for (let i = 1; i < 7; i++) { const u = -15 + i * 4; if (u > -0.5 && u < 11.5) continue; const [bx, bz] = L(u, -17.5 - 0.72); pier(W, bx, bz, y0, 0.9, 7.4, 1.4, yaw0, { tag, color: ST }); }
  const [chx, chz] = L(17.9, -12);
  const cTop = shell(W, { x: chx, z: chz, y0, yaw: yaw0, w: 9.4, d: 8.4, t: 0.75, tiers: 1, th: [6.6], mat: 'ashlar', color: ST, panel: 3.2, tag, house: HID++, style: (side) => (side === 'left' ? [0, 0, 0, 0] : [5, 0, 1, 0]) });
  W.roof(chx, cTop, chz, 9.4, 8.4, yaw0, 'x', 55, col(GB), col(SL), 0, 1, 0.75, { gableFeat: 5, ov: 0.4, ovL: 0.3, tag });
  const [trx, trz] = L(6, -21.1);
  const tTop = shell(W, { x: trx, z: trz, y0, yaw: yaw0 + Math.PI / 2, w: 6.8, d: 9.2, t: 0.75, tiers: 1, th: [8], mat: 'ashlar', color: ST, panel: 3.4, tag, house: HID++, style: (side) => (side === 'back' || side === 'front' ? [0, 0, 0, 0] : [5, 0, 1, 0]) });
  W.roof(trx, tTop, trz, 6.8, 9.2, yaw0 + Math.PI / 2, 'x', 55, col(GB), col(SL), 0, 1, 0.75, { gableFeat: 5, ov: 0.35, ovL: 0.2, tag });
  const [twx, twz] = L(-18.85, -12);
  const tw = tower(W, twx, twz, y0, 7, 15, 1.6, { rot: yaw0, color: ST, tag, tall: { 11: 3.2 }, spire: 13, spireColor: SL, styleAt: (k) => (k === 11 ? [3, 0, 0.9, 0] : k === 8 ? [6, 0, 1, 0] : k === 1 ? [2, 0, 0.4, 0] : k === 4 ? [1, 0, 0.5, 0] : [0, 0, 0, 0]) });
  W.abbeyBell = tw.spire;
  // cloister: arcade of stone columns and lintels round the garth. North/south arcades carry their lintels
  // on two drums; the east/west ones have a third, shorter drum so their lintels pass over the corner lintels.
  const g0u = -14, g1u = 4, g0v = -3, g1v = 15, sp = 3, CC = col(S_(0.3, 0.29, 0.27));
  const colAt = (u, v, extra) => { const [px, pz] = L(u, v); let y = y0; for (const h of extra ? [1.4, 1.4, 0.6] : [1.4, 1.4]) { W.add({ shape: 'cyl', mat: 'stone', x: px, y: y + h / 2 + GAP, z: pz, sx: 0.72, sy: h, sz: 0.72, color: CC, tag }); y += h + GAP; } };
  const ly = y0 + 2.8 + 3 * GAP + 0.3, ly2 = ly + 0.6 + GAP;
  for (let i = 0; i <= 6; i++) { colAt(g0u + i * sp, g0v); colAt(g0u + i * sp, g1v); if (i > 0 && i < 6) { colAt(g0u, g0v + i * sp, true); colAt(g1u, g0v + i * sp, true); } }
  for (let i = 0; i < 6; i++) {
    for (const v of [g0v, g1v]) { const [px, pz] = L(g0u + (i + 0.5) * sp, v); W.add({ shape: 'box', mat: 'ashlar', x: px, y: ly, z: pz, sx: sp - 0.012, sy: 0.6, sz: 0.78, q: yawQ(yaw0), color: col(ST), tag }); }
    for (const u of [g0u, g1u]) { const [px, pz] = L(u, g0v + (i + 0.5) * sp); W.add({ shape: 'box', mat: 'ashlar', x: px, y: ly2, z: pz, sx: sp - 0.012, sy: 0.6, sz: 0.78, q: yawQ(yaw0 + Math.PI / 2), color: col(ST), tag }); }
  }
  cross(W, ...L(-5, 6), y0, tag, { steps: [[2, 0.35]], drums: 1 });
  // claustral ranges
  const R2 = { mat: 'ashlar', color: ST, gable: GB, roof: SL, pat: 0, lit: 0.55, sideWin: true, t: 0.55, noProps: true };
  house(ctx, { ...R2, x: L(11, 7.5)[0], z: L(11, 7.5)[1], yaw: yaw0 - Math.PI / 2, w: 20, d: 7, floors: 2, fh: 3.2, ridge: 'x', pitch: 50 });
  house(ctx, { ...R2, x: L(-1.5, 21.5)[0], z: L(-1.5, 21.5)[1], yaw: yaw0 + Math.PI, w: 31, d: 5.8, floors: 1, fh: 5, ridge: 'x', pitch: 50, tallWin: true });
  house(ctx, { ...R2, x: L(-21, 7)[0], z: L(-21, 7)[1], yaw: yaw0 + Math.PI / 2, w: 20, d: 7, floors: 2, fh: 3.2, ridge: 'x', pitch: 50 });
  // abbot's lodging, guest house, porter's lodge
  house(ctx, { ...R2, x: L(22.5, 4)[0], z: L(22.5, 4)[1], yaw: yaw0 - Math.PI / 2, w: 9, d: 7, floors: 2, fh: 3, ridge: 'z', pitch: 52, lit: 0.7 });
  house(ctx, { ...R2, x: L(22.5, 16.5)[0], z: L(22.5, 16.5)[1], yaw: yaw0 - Math.PI / 2, w: 10, d: 7, floors: 2, fh: 3, ridge: 'x', pitch: 48, mat: 'plaster', color: P(0.42, 0.4, 0.35), gable: null, pat: 1 });
  house(ctx, { ...R2, x: L(-25.5, -20.5)[0], z: L(-25.5, -20.5)[1], yaw: yaw0, w: 6, d: 5, floors: 1, fh: 3, ridge: 'x', pitch: 50 });
  // cemetery east of the choir
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) { const [px, pz] = L(15 + i * 2.6, -23.2 + j * 1.6 + (i % 2) * 0.3); G.physics.add({ shape: 'box', mat: 'stone', x: px, y: y0 + 0.4 + GAP, z: pz, sx: 0.65, sy: 0.8, sz: 0.18, q: yawQ(yaw0 + (rng() - 0.5) * 0.15), color: col(S_(0.24, 0.24, 0.23)), tag }); }
  // herb garden (low walls) and the cellarer's barrels
  dryWall(W, [L(16, -5.2), L(28, -5.2), L(28, -2.2), L(16, -2.2)], y0, tag, true, { layers: 1, bh: 0.5, color: S_(0.3, 0.29, 0.27) });
  for (let i = 0; i < 6; i++) { const [px, pz] = L(-26.5, -4 + i * 2.5); barrel(px, y0, pz, rng, tag); }
  return ctx.houses.length;
}

// ================================================================== MIRRORMERE — lakeside town
export function buildMirrormere(W) {
  const ctx = ctxFor(W, 'mirrormere', 7404), { site: S, y0, rng, plot } = ctx, tag = 'mirrormere';
  const lake = LAKES.find((l) => l.id === 'mirrormere');
  const ad = Math.hypot(S.x - lake.x, S.z - lake.z), yawT = faceYaw((S.x - lake.x) / ad, (S.z - lake.z) / ad);
  const F = frame(S.x, S.z, yawT), L = (u, v) => F.at(u, v);  // local +z = inland, -z = towards the water
  const WALLS = [P(0.42, 0.41, 0.38), P(0.3, 0.35, 0.42), P(0.2, 0.3, 0.3), P(0.42, 0.33, 0.15), P(0.4, 0.24, 0.17), P(0.3, 0.34, 0.27), P(0.36, 0.38, 0.42), P(0.22, 0.08, 0.06), P(0.18, 0.22, 0.3)];
  const ROOFS = [SLATE, SLATE_D, SLATE_B, SLATE, TILE_DARK, R(0.17, 0.075, 0.045)];
  const gen = (r, o = {}) => ({
    w: between(r, 4.8, 6.8), d: between(r, 4.6, 5.6), floors: o.quay ? (r() < 0.5 ? 3 : 2) : r() < 0.7 ? 2 : 3, fh: between(r, 2.7, 2.9),
    color: pickR(r, WALLS), roof: pickR(r, ROOFS), ridge: r() < 0.75 ? 'x' : 'z', pitch: between(r, 40, 48), pat: r() < 0.72 ? 0 : 1, lit: 0.35 + r() * 0.5,
    sideWin: r() < 0.5, tallWin: r() < 0.08, ground: r() < 0.3 ? P(0.3, 0.3, 0.3) : null, gable: null,
  });
  // ---- lighthouse island + stone causeway (static footings, breakable deck)
  const deckY = y0 + 0.9, deckT = 0.45, isl = L(0, -(ad - 36)), islTop = deckY - deckT - GAP;
  {
    const Rp = G.physics.RAPIER, rngI = makeRng(99), yBot = lake.level - 8, Hh = islTop - yBot;
    const pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(9.5 - 3.5 * t + (i > 0 && i < 8 ? (rngI() - 0.5) * 1.2 : 0), -Hh / 2 + Hh * t)); }
    pts.push(new THREE.Vector2(0, Hh / 2));
    const rockMat = W.rockMat || (W.rockMat = new THREE.MeshStandardMaterial({ map: G.tex.cliff_diff, normalMap: G.tex.cliff_nor, roughness: 0.95, metalness: 0, color: C(0.82, 0.8, 0.76) }));
    W.addStatic(new THREE.LatheGeometry(pts, 28), isl[0], (islTop + yBot) / 2, isl[1], Rp.ColliderDesc.cylinder(Hh / 2, 6), rockMat);
    // causeway footings every ~5 m from the quay to the island
    const z0 = -(S.r - 1.5), z1 = -(ad - 36) + 5.4, n = 5, step = (z1 - z0) / n, q = yawQ(yawT);
    for (let i = 0; i < n; i++) {
      const [px, pz] = L(0, z0 + i * step);
      const gb = Math.min(G.terrain.heightAt(px, pz), lake.level) - 1.5, hh = islTop - gb;
      const m = W.addStatic(new THREE.BoxGeometry(3.6, hh, 2.0), px, gb + hh / 2, pz, Rp.ColliderDesc.cuboid(1.8, hh / 2, 1.0).setRotation(q));
      m.quaternion.copy(q);
      const [dx2, dz2] = L(0, z0 + (i + 0.5) * step);
      W.add({ shape: 'box', mat: 'ashlar', x: dx2, y: deckY - deckT / 2, z: dz2, sx: 3.6, sy: deckT, sz: Math.abs(step) - 0.012, q, color: col(A(0.36, 0.33, 0.29)), tag });
      for (const s of [-1, 1]) { const [qx, qz] = L(s * 1.6, z0 + (i + 0.5) * step); W.add({ shape: 'box', mat: 'stone', x: qx, y: deckY + 0.3 + GAP, z: qz, sx: 0.38, sy: 0.6, sz: Math.abs(step) - 0.05, q, color: col(S_(0.3, 0.29, 0.28)), tag }); }
    }
    // lighthouse: striped drums, gallery, lantern with lit windows, cap
    const lt = drumTower(W, isl[0], isl[1], islTop, 4.6, 8, 1.8, { taper: 0.18, colorAt: (k) => (k % 2 ? S_(0.42, 0.05, 0.04) : S_(0.5, 0.5, 0.48)), tag });
    let y = lt.y;
    W.add({ shape: 'box', mat: 'stone', x: isl[0], y: y + 0.2 + GAP, z: isl[1], sx: 5.0, sy: 0.4, sz: 5.0, q, color: col(S_(0.14, 0.14, 0.15)), tag }); y += 0.4 + GAP;
    W.add({ shape: 'box', mat: 'plaster', x: isl[0], y: y + 1.3 + GAP, z: isl[1], sx: 2.8, sy: 2.6, sz: 2.8, q, color: col(P(0.42, 0.41, 0.38)), style: [3, 0, 1, 0], tag }); y += 2.6 + GAP;
    W.lighthouse = W.add({ shape: 'pyr', mat: 'roof', x: isl[0], y: y + 1.1 + GAP, z: isl[1], sx: 3.4, sy: 2.2, sz: 3.4, q, color: col(R(0.03, 0.06, 0.12)), friction: 1.2, tag });
    banner(W, W.lighthouse, 1.1, [0.95, 0.85, 0.2], 0.4);
  }
  // ---- streets: quay, three streets along the shore, a main cross street and two lanes
  const zq = -(S.r - 10);
  const ST = [[[-46, zq], [46, zq], 5], [[-46, -10], [46, -10], 4.4], [[-46, 9], [46, 9], 4], [[-46, 26], [46, 26], 3.6], [[0, zq - 2], [0, 46], 4.4], [[-21, -8], [-21, 46], 3.2], [[21, zq + 2.5], [21, 46], 3.2]];
  for (const [a, b, w] of ST) plot.street(...L(...a), ...L(...b), w);
  plot.reserve({ circle: true, x: L(0, -(S.r - 3))[0], z: L(0, -(S.r - 3))[1], r: 3 });
  // harbour chapel with a small tower, between the middle and back streets
  plot.reserve(church(ctx, ...L(-11.5, -2.3), yawT + Math.PI / 2, { w: 9, d: 6.6, tiers: 1, th: 5, stone: A(0.42, 0.41, 0.4), roof: SLATE_D, tower: { side: 3.6, layers: 9, lh: 1.4, spire: 7, spireColor: SLATE_D } }).fp);
  // warehouse on the quay
  houseAt(ctx, { w: 13, d: 7, floors: 3, fh: 3, color: P(0.22, 0.08, 0.06), gable: P(0.22, 0.08, 0.06), roof: SLATE_D, ridge: 'x', pitch: 45, pat: 1, lit: 0.3, sideWin: true, t: 0.5, roofOpts: { gableFeat: 4 } }, ...L(12, zq + 2.5 + 0.3 + 3.85), yawT + Math.PI);
  row(ctx, L(-46, zq), L(46, zq), 5, 1, gen, { quay: true });
  for (const [a, b, w] of ST.slice(1)) rows(ctx, L(...a), L(...b), w, gen);
  infill(ctx, 600, (r) => ({ ...gen(r), w: between(r, 4.4, 6), d: between(r, 4.4, 5.4), floors: r() < 0.6 ? 1 : 2 }), { yaw: yawT, m: 0.25 });
  infill(ctx, 600, (r) => ({ ...gen(r), w: between(r, 3.8, 5), d: between(r, 4, 5), floors: r() < 0.6 ? 1 : 2 }), { m: 0.2 });
  // ---- piers into the lake
  for (const u of [-17, 17]) {
    const [px, pz] = L(u, -(S.r - 1.2));
    const Fp = woodPier(ctx, px, pz, yawT + Math.PI, 24, y0 + 0.8);
    for (let i = 0; i < 3; i++) { const [bx, bz] = Fp.at((i - 1) * 0.8, 22.5); barrel(bx, y0 + 0.8, bz, rng, tag); }
    const [cx2, cz2] = Fp.at(0.6, 12); crate(cx2, y0 + 0.8, cz2, rng, tag);
  }
  // quay clutter
  for (let i = 0; i < 18; i++) { const u = -28 + i * 3.3 + rng(), [px, pz] = L(u, zq - 2.5 - 1.1 - rng() * 0.6); if (Math.abs(u) < 3.5 || Math.abs(Math.abs(u) - 17) < 2.4) continue; if (Math.hypot(px - S.x, pz - S.z) > S.r - 1.5) continue; if (rng() < 0.55) barrel(px, y0, pz, rng, tag); else crate(px, y0, pz, rng, tag); }
  frontProps(ctx, 0.25);
  return ctx.houses.length;
}

// ================================================================== BARLEYFORD — farming village
export function buildBarleyford(W) {
  const ctx = ctxFor(W, 'barleyford', 7505), { site: S, y0, rng, plot } = ctx, tag = 'barleyford';
  const yaw0 = VILLAGE_STREETS.barleyford.yaw, F = frame(S.x, S.z, yaw0), L = (u, v) => F.at(u, v);
  const WALLS = [P(0.44, 0.42, 0.37), P(0.42, 0.38, 0.28), P(0.42, 0.33, 0.28), P(0.4, 0.4, 0.34), P(0.44, 0.38, 0.24)];
  const gen = (r) => ({
    w: between(r, 5.4, 7.6), d: between(r, 4.6, 5.6), floors: r() < 0.72 ? 1 : 2, fh: between(r, 2.6, 2.9), color: pickR(r, WALLS), roof: pickR(r, THATCH),
    ridge: 'x', pitch: between(r, 52, 58), pat: r() < 0.5 ? 1 + ((r() * 3) | 0) : 0, lit: 0.25 + r() * 0.4, sideWin: r() < 0.4, groundTimber: true, roofOpts: { ov: 0.5 },
  });
  // village green, chapel, windmill
  plot.reserve({ circle: true, x: S.x, z: S.z, r: 10.5 });
  plot.reserve(church(ctx, ...L(14, -19), yaw0 + 0.5, { w: 11, d: 6.6, tiers: 1, th: 5, stone: A(0.34, 0.3, 0.24), roof: TILE_BROWN, tower: { side: 3.8, layers: 9, lh: 1.4, spire: 6.5, spireColor: SLATE_D } }).fp);
  const [mx, mz] = L(27, 17);
  windmill(ctx, mx, mz, y0, faceYaw(S.x - mx, S.z - mz) + 0.4, {});
  plot.reserve({ circle: true, x: mx, z: mz, r: 8.5 });
  well(W, S.x + 3, S.z + 2, y0, tag);
  // lanes and the ring round the green
  const LN = VILLAGE_STREETS.barleyford.segs;
  for (const [a, b, w] of LN) plot.street(...L(...a), ...L(...b), w);
  const rp = ring(ctx, S.x, S.z, VILLAGE_STREETS.barleyford.ring[0], 12, 3.2, gen);
  // barns with paddocks (placed first so they get room)
  const BARN = (r) => (r() < 0.6
    ? { w: between(r, 11, 14), d: between(r, 7.5, 8.5), floors: 1, fh: 4.4, mat: 'wood', color: pickR(r, [[0.62, 0.3, 0.24], [0.55, 0.45, 0.36], [0.46, 0.34, 0.28]]), gable: P(0.2, 0.1, 0.06), roof: pickR(r, [SLATE_D, TILE_DARK]), ridge: 'x', pitch: 46, pat: 1, lit: 0, backWin: false, t: 0.3, noProps: true, roofOpts: { gableFeat: 0 } }
    : { w: between(r, 10, 12), d: 7.5, floors: 1, fh: 4.2, color: P(0.4, 0.36, 0.28), roof: pickR(r, THATCH), ridge: 'x', pitch: 50, pat: 3, lit: 0.1, groundTimber: true, t: 0.35, noProps: true });
  const paddocks = [];
  for (let i = 0, tries = 0; i < 4 && tries < 400; tries++) {
    const a = rng() * TAU, rad = 22 + rng() * 12, x = S.x + Math.cos(a) * rad, z = S.z + Math.sin(a) * rad, yaw = faceYaw(S.x - x, S.z - z);
    const b = BARN(rng), fp = fpOf(b, x, z, yaw);
    if (!plot.fits(fp, 2.5)) continue;
    plot.take(fp); const h = house(ctx, { ...b, x, z, yaw }); i++;
    const Fb = frame(x, z, yaw);
    for (const s of [1, -1]) {
      const [px, pz] = Fb.at(0, s * (b.d / 2 + 4.9)), pd = { x: px, z: pz, hw: b.w / 2 + 1.3, hd: 3.8, yaw };
      if (plot.fits(pd, 0.4)) { plot.take(pd); paddocks.push({ h, s }); break; }
    }
  }
  LN.forEach(([a, b, w]) => rows(ctx, L(...a), L(...b), w, gen, { gap: (r) => r() * 1.6 }));
  for (let i = 0; i < rp.length - 1; i++) row(ctx, rp[i], rp[i + 1], 3.2, -1, gen, { max: 2, endTrim: 0.5 });
  infill(ctx, 600, gen, { m: 0.8, max: 30 });
  // fences, hay and log piles in the farmyards
  for (const { h, s } of paddocks) {
    const Fb = frame(h.x, h.z, h.yaw), z0 = s * (h.d / 2 + 1.4), z1 = s * (h.d / 2 + 8.4);
    fence([Fb.at(-h.w / 2 - 1, z0), Fb.at(-h.w / 2 - 1, z1), Fb.at(h.w / 2 + 1, z1), Fb.at(h.w / 2 + 1, z0)], y0, tag);
    for (let k = 0; k < 4; k++) { const [hx, hz] = Fb.at(-h.w / 2 + 1.8 + k * ((h.w - 3.6) / 3), s * (h.d / 2 + 4.9)); hayBale(hx, y0, hz, rng, tag, true); }
  }
  for (let i = 0; i < 5; i++) { const a = rng() * TAU, r = 4 + rng() * 4.5; hayBale(S.x + Math.cos(a) * r, y0, S.z + Math.sin(a) * r, rng, tag, false); }
  for (let i = 0, k = 0; i < 40 && k < 4; i++) { const a = rng() * TAU, r = 16 + rng() * 20, x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r, fp = { x, z, hw: 1.9, hd: 0.9, yaw: a }; if (plot.fits(fp, 0.5)) { plot.take(fp); logPile(x, y0, z, a, rng, tag); k++; } }
  frontProps(ctx, 0.25);
  return ctx.houses.length;
}

// ================================================================== NORBURY — crossroads hamlet in the north
export function buildNorbury(W) {
  const ctx = ctxFor(W, 'norbury', 7606), { site: S, y0, rng, plot } = ctx, tag = 'norbury';
  const yaw0 = VILLAGE_STREETS.norbury.yaw, F = frame(S.x, S.z, yaw0), L = (u, v) => F.at(u, v);
  const WALLS = [P(0.38, 0.35, 0.3), P(0.42, 0.39, 0.32), P(0.34, 0.31, 0.27), P(0.44, 0.42, 0.37)];
  const gen = (r) => {
    const stone = r() < 0.45;
    return {
      w: between(r, 5, 7), d: between(r, 5.5, 7), floors: r() < 0.55 ? 2 : 1, fh: 2.8, mat: stone ? 'ashlar' : 'plaster', color: stone ? A(0.3, 0.27, 0.22) : pickR(r, WALLS), gable: stone ? P(0.32, 0.29, 0.24) : null,
      roof: pickR(r, [TILE_BROWN, TILE_DARK, SLATE_D]), ridge: r() < 0.6 ? 'x' : 'z', pitch: between(r, 45, 54), pat: stone ? 0 : r() < 0.5 ? 2 : 0, lit: 0.3 + r() * 0.5, sideWin: true,
    };
  };
  plot.reserve({ circle: true, x: S.x, z: S.z, r: 6 });
  cross(W, S.x, S.z, y0, tag);
  // the inn at the crossroads and a little church
  houseAt(ctx, { w: 13, d: 8, floors: 3, fh: 2.9, color: P(0.42, 0.38, 0.28), ground: P(0.32, 0.29, 0.25), roof: TILE_DARK, ridge: 'x', pitch: 50, pat: 3, lit: 0.9, sideWin: true, t: 0.5, roofOpts: { gableFeat: 4 } }, ...L(-12.2, -7.4), yaw0);
  plot.reserve(church(ctx, ...L(14.5, -11), yaw0, { w: 12, d: 7, tiers: 1, th: 5.5, stone: A(0.3, 0.28, 0.24), roof: SLATE_D, tower: { side: 4.2, layers: 10, lh: 1.5, merlons: true } }).fp);
  const ST = VILLAGE_STREETS.norbury.segs;
  for (const [a, b, w] of ST) plot.street(...L(...a), ...L(...b), w);
  for (const [a, b, w] of ST) rows(ctx, L(...a), L(...b), w, gen, { gap: (r) => r() * 1.2 });
  infill(ctx, 400, gen, { yaw: yaw0, m: 0.8, max: 16 });
  dryWall(W, [L(-26, 9), L(-26, 20), L(-15, 20)], y0, tag, false, { layers: 1, color: S_(0.28, 0.27, 0.25) });
  frontProps(ctx, 0.35);
  return ctx.houses.length;
}

// ================================================================== GREYSTONE — quarry hamlet on the south-east heights
export function buildGreystone(W) {
  const ctx = ctxFor(W, 'greystone', 7707), { site: S, y0, rng, plot } = ctx, tag = 'greystone';
  const toRoad = Math.atan2(-S.z + 270, -S.x + 266); // roughly towards the north-west
  const back = toRoad + Math.PI;                       // the quarry face is on the far side
  // stepped quarry face: three concentric terraces of big cut blocks
  for (const [rr, layers] of [[19.5, 2], [22.3, 3], [25.1, 4]]) {
    const a0 = back - 1.0, a1 = back + 1.0, n = Math.round(((a1 - a0) * rr) / 2.6);
    for (let k = 0; k < layers; k++) for (let i = 0; i < n; i++) {
      const off = (k % 2) * 0.5, t0 = (i + off) / n, t1 = Math.min(1, (i + 1 + off) / n);
      if (t1 <= t0 + 0.05) continue;
      const a = a0 + ((a1 - a0) * (t0 + t1)) / 2, len = (a1 - a0) * (rr - 1.3) * (t1 - t0) - 0.05;
      W.add({ shape: 'box', mat: 'stone', x: S.x + Math.cos(a) * rr, y: y0 + 0.8 + k * (1.6 + GAP) + GAP, z: S.z + Math.sin(a) * rr, sx: len, sy: 1.6, sz: 2.6, q: yawQ(-a - Math.PI / 2), color: col(S_(0.24 + rng() * 0.04, 0.235, 0.22)), tag });
    }
  }
  plot.reserve({ circle: true, x: S.x + Math.cos(back) * 22, z: S.z + Math.sin(back) * 22, r: 9 });
  for (const s of [-1, 1]) { const a = back + s * 0.75; plot.reserve({ circle: true, x: S.x + Math.cos(a) * 21, z: S.z + Math.sin(a) * 21, r: 7 }); }
  // stacks of cut blocks in the yard
  for (let i = 0, tries = 0; i < 7 && tries < 200; tries++) {
    const a = back + (rng() - 0.5) * 2.2, r = 8 + rng() * 9, x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r, yaw = rng() * 3;
    const fp = { x, z, hw: 2.6, hd: 1.2, yaw };
    if (!plot.fits(fp, 0.8)) continue;
    plot.take(fp); stoneStack(W, x, y0, z, yaw, rng, tag, 2 + ((rng() * 2) | 0)); i++;
  }
  // mason's lodge: open shed on posts with a flat roof
  {
    const a = back + 1.35, x = S.x + Math.cos(a) * 14, z = S.z + Math.sin(a) * 14, yaw = faceYaw(S.x - x, S.z - z), Fm = frame(x, z, yaw);
    for (const [lx, lz] of [[-3.6, -2], [0, -2], [3.6, -2], [-3.6, 2], [0, 2], [3.6, 2]]) { const [px, pz] = Fm.at(lx, lz); W.add({ shape: 'box', mat: 'wood', x: px, y: y0 + 1.5 + GAP, z: pz, sx: 0.36, sy: 3.0, sz: 0.36, q: Fm.q, tint: 0.55, tag }); }
    W.add({ shape: 'box', mat: 'wood', x, y: y0 + 3.0 + 0.15 + 2 * GAP, z, sx: 8.4, sy: 0.3, sz: 5.0, q: Fm.q, tint: 0.65, tag });
    for (let i = 0; i < 3; i++) { const [px, pz] = Fm.at(-2.5 + i * 2.5, 0); W.add({ shape: 'box', mat: 'stone', x: px, y: y0 + 0.45 + GAP, z: pz, sx: 1.4, sy: 0.9, sz: 1.0, q: Fm.q, color: col(S_(0.3, 0.29, 0.28)), tag, struct: false }); }
    plot.reserve({ x, z, hw: 4.6, hd: 3, yaw });
  }
  // beacon tower
  {
    const a = toRoad + 0.9, x = S.x + Math.cos(a) * 17, z = S.z + Math.sin(a) * 17;
    const t = tower(W, x, z, y0, 5, 11, 1.5, { color: A(0.26, 0.255, 0.25), tag, merlons: 3, styleAt: (k) => (k === 1 ? [2, 0, 0.3, 0] : k === 6 || k === 9 ? [1, 0, 0.5, 0] : [0, 0, 0, 0]) });
    banner(W, t.cap, 0.25 + 0.9, [0.2, 0.3, 0.7], 1.2);
    plot.reserve({ circle: true, x, z, r: 4.2 });
  }
  // stone cottages
  const gen = (r) => ({ w: between(r, 5, 7), d: between(r, 4.8, 6), floors: r() < 0.6 ? 1 : 2, fh: 2.7, mat: 'ashlar', color: pickR(r, [A(0.26, 0.255, 0.25), A(0.3, 0.29, 0.27), A(0.22, 0.215, 0.21)]), gable: GABLE_GREY, roof: pickR(r, [SLATE, SLATE_D]), ridge: 'x', pitch: between(r, 38, 46), pat: 0, lit: 0.35 + r() * 0.4, sideWin: r() < 0.4 });
  const lane = [[S.x + Math.cos(toRoad) * 30, S.z + Math.sin(toRoad) * 30], [S.x, S.z]];
  plot.street(lane[0][0], lane[0][1], lane[1][0], lane[1][1], 4);
  rows(ctx, lane[0], lane[1], 4, gen, { gap: (r) => 0.4 + r() * 1.5 });
  infill(ctx, 400, gen, { m: 0.8, max: 16 });
  // loose blocks
  for (let i = 0; i < 10; i++) { const a = back + (rng() - 0.5) * 2.4, r = 6 + rng() * 10, x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r; if (plot.fits({ circle: true, x, z, r: 0.9 }, 0.3)) { G.physics.add({ shape: 'box', mat: 'stone', x, y: y0 + 0.4 + GAP, z, sx: 1.1, sy: 0.8, sz: 0.9, q: yawQ(rng() * 3), color: col(S_(0.28, 0.27, 0.26)), tag }); plot.take({ circle: true, x, z, r: 0.7 }); } }
  frontProps(ctx, 0.3);
  return ctx.houses.length;
}

// ================================================================== TARNSIDE — fishing hamlet on the tarn
export function buildTarnside(W) {
  const ctx = ctxFor(W, 'tarnside', 8404), { site: S, y0, rng, plot } = ctx, tag = 'tarnside';
  const V = VILLAGE_STREETS.tarnside, yawT = V.yaw, F = frame(S.x, S.z, yawT), L = (u, v) => F.at(u, v);  // -v towards the water
  const WALLS = [P(0.4, 0.39, 0.36), P(0.36, 0.33, 0.28), P(0.3, 0.32, 0.33), P(0.42, 0.4, 0.34), P(0.24, 0.27, 0.3)];
  const gen = (r) => ({
    w: between(r, 5, 6.6), d: between(r, 4.4, 5.2), floors: r() < 0.7 ? 1 : 2, fh: 2.6, color: pickR(r, WALLS), roof: pickR(r, [...THATCH, SLATE_D, SLATE]),
    ridge: 'x', pitch: between(r, 46, 56), pat: r() < 0.35 ? 1 : 0, lit: 0.3 + r() * 0.4, sideWin: r() < 0.4, roofOpts: { ov: 0.45 },
  });
  for (const [a, b, w] of V.segs) plot.street(...L(...a), ...L(...b), w);
  // boathouse and smokehouse on the water side of the shore street
  houseAt(ctx, { w: 9, d: 6, floors: 1, fh: 3.4, mat: 'wood', color: [0.48, 0.38, 0.3], gable: P(0.16, 0.11, 0.08), roof: SLATE_D, ridge: 'z', pitch: 44, pat: 1, lit: 0, backWin: false, t: 0.3, noProps: true }, ...L(-9, -9.4), yawT + Math.PI);
  houseAt(ctx, { w: 4.4, d: 4, floors: 1, fh: 2.8, mat: 'ashlar', color: A(0.26, 0.25, 0.23), gable: GABLE_DARK, roof: SLATE_D, ridge: 'x', pitch: 50, pat: 0, lit: 0.2, sideWin: false, backWin: false, noProps: true }, ...L(10.5, -8.6), yawT + Math.PI);
  { const [qx, qz] = L(2, -15); plot.reserve({ circle: true, x: qx, z: qz, r: 2.4 }); }
  rows(ctx, L(-27, -4), L(27, -4), 3.6, gen, { gap: (r) => r() * 1.0 });
  rows(ctx, L(2, -2), L(2, 24), 3.2, gen, { gap: (r) => r() * 1.0 });
  infill(ctx, 400, gen, { m: 0.5, max: 8 });
  // jetty into the tarn, nets drying on racks, a boat-builder's timber
  const [jx, jz] = L(2, -15.5), Fj = woodPier(ctx, jx, jz, yawT + Math.PI, 27, y0 + 0.4, { w: 2.2 });
  for (let i = 0; i < 2; i++) { const [bx, bz] = Fj.at((i - 0.5) * 0.85, 25.8); barrel(bx, y0 + 0.4, bz, rng, tag); }
  { const [cx2, cz2] = Fj.at(0.4, 9); crate(cx2, y0 + 0.4, cz2, rng, tag); }
  for (const u of [16, -17]) { const a = L(u - 2.4, -9.5), b = L(u + 2.4, -9.5); if (plot.fits({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, hw: 2.7, hd: 0.5, yaw: yawT }, 0.2)) fence([a, b], y0, tag); }
  for (let i = 0, k = 0; i < 30 && k < 2; i++) { const a = rng() * TAU, r = 8 + rng() * 9, x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r, fp = { x, z, hw: 1.9, hd: 0.9, yaw: a }; if (plot.fits(fp, 0.4)) { plot.take(fp); logPile(x, y0, z, a, rng, tag); k++; } }
  frontProps(ctx, 0.35);
  return ctx.houses.length;
}

// ================================================================== the smaller places
export function buildInn(W) {
  const ctx = ctxFor(W, 'inn', 7808, 2.0), { site: S, y0, rng } = ctx, tag = 'inn';
  const yaw0 = faceYaw(0, -1) + 0.25, F = frame(S.x, S.z, yaw0), L = (u, v) => F.at(u, v);
  houseAt(ctx, { w: 14, d: 9, floors: 3, fh: 2.9, color: P(0.42, 0.36, 0.22), ground: P(0.3, 0.27, 0.22), roof: R(0.18, 0.08, 0.05), ridge: 'x', pitch: 52, pat: 3, lit: 0.95, sideWin: true, t: 0.5, groundTimber: true, roofOpts: { gableFeat: 4 } }, ...L(-1, -4), yaw0);
  houseAt(ctx, { w: 10, d: 6, floors: 1, fh: 3.6, mat: 'wood', color: [0.5, 0.38, 0.28], gable: P(0.16, 0.11, 0.08), roof: SLATE_D, ridge: 'x', pitch: 42, pat: 1, lit: 0, backWin: false, t: 0.3, noProps: true }, ...L(9.6, 5.2), yaw0 - Math.PI / 2);
  well(W, ...L(-4, 5.5), y0, tag);
  for (let i = 0; i < 6; i++) { const [px, pz] = L(-7 + i * 0.95, 1.3 + (i % 2) * 0.2); barrel(px, y0, pz, rng, tag); }
  for (let i = 0; i < 4; i++) { const [px, pz] = L(2 + (i % 2) * 1.0, 6 + ((i / 2) | 0) * 1.0); crate(px, y0, pz, rng, tag); }
  cross(W, ...L(-9, 7.5), y0, tag, { steps: [[1.2, 0.3]], drums: 1, dia: 0.4, cap: R(0.4, 0.05, 0.03) });
  return 2;
}

export function buildStoneCircle(W) {
  const s = siteOf('ninestones'), y0 = s.h, rng = makeRng(7909), tag = 'ninestones', SC = () => col(S_(0.19 + rng() * 0.05, 0.19, 0.18));
  for (let i = 0; i < 13; i++) {
    if (i === 4 || i === 9) continue;       // fallen gaps
    const a = (i / 13) * TAU, hh = 2.6 + rng() * 1.2, x = s.x + Math.cos(a) * 8.2, z = s.z + Math.sin(a) * 8.2;
    W.add({ shape: 'box', mat: 'stone', x, y: y0 + hh / 2 + GAP, z, sx: 1.3 + rng() * 0.3, sy: hh, sz: 0.9, q: yawQ(-a - Math.PI / 2 + (rng() - 0.5) * 0.2), color: SC(), tag });
  }
  // two trilithons and an altar stone
  for (const a of [0.6, 0.6 + Math.PI]) {
    const cx = s.x + Math.cos(a) * 3.6, cz = s.z + Math.sin(a) * 3.6, F = frame(cx, cz, -a), hh = 3.6;
    for (const sx of [-1, 1]) { const [px, pz] = F.at(sx * 1.25, 0); W.add({ shape: 'box', mat: 'stone', x: px, y: y0 + hh / 2 + GAP, z: pz, sx: 1.1, sy: hh, sz: 1.0, q: F.q, color: SC(), tag }); }
    W.add({ shape: 'box', mat: 'stone', x: cx, y: y0 + hh + 0.4 + 2 * GAP, z: cz, sx: 4.0, sy: 0.8, sz: 1.0, q: F.q, color: SC(), tag });
  }
  W.add({ shape: 'box', mat: 'stone', x: s.x, y: y0 + 0.35 + GAP, z: s.z, sx: 2.8, sy: 0.7, sz: 1.4, q: yawQ(0.6 + Math.PI / 2), color: SC(), tag });
  for (const i of [4, 9]) { const a = (i / 13) * TAU; G.physics.add({ shape: 'box', mat: 'stone', x: s.x + Math.cos(a) * 9.4, y: y0 + 0.45 + GAP, z: s.z + Math.sin(a) * 9.4, sx: 3.0, sy: 0.9, sz: 1.3, q: yawQ(-a + 0.3), color: SC(), tag }); }
}

export function buildRuins(W) {
  const s = siteOf('ruins'), y0 = s.h, rng = makeRng(8010), tag = 'ruins';
  const yaw = 0.4, F = frame(s.x, s.z, yaw), L = (u, v) => F.at(u, v), STN = S_(0.24, 0.23, 0.2);
  // roofless chapel with broken walls
  const w = 13, d = 7.5;
  const segs = [[[-w / 2, -d / 2], [w / 2, -d / 2]], [[w / 2, -d / 2], [w / 2, d / 2]], [[w / 2, d / 2], [-w / 2, d / 2]], [[-w / 2, d / 2], [-w / 2, -d / 2]]];
  segs.forEach(([a, b], si) => {
    const [ax, az] = L(...a), [bx, bz] = L(...b), Ls = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(Ls / 3.4));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, layers = [4, 1, 3, 5, 2, 0, 4][(si * 3 + i) % 7];
      if (!layers) continue;
      // inset at the corners so the runs never overlap
      const e0 = t0 === 0 ? 0.45 / Ls : 0.006, e1 = t1 === 1 ? 0.45 / Ls : 0.006;
      wallRun(W, ax + (bx - ax) * (t0 + e0), az + (bz - az) * (t0 + e0), ax + (bx - ax) * (t1 - e1), az + (bz - az) * (t1 - e1), y0, { layers, bh: 1.1, bt: 0.85, bl: 1.6, mat: 'stone', color: STN, tag });
    }
  });
  // broken tower at the west end
  const [tx, tz] = L(-w / 2 - 3.2, 0);
  tower(W, tx, tz, y0, 4.6, 7, 1.5, { rot: yaw, color: STN, mat: 'stone', tag, cap: false, styleAt: () => [0, 0, 0, 0] });
  for (const [ox, oz, sz] of [[-1.1, -1.1, 1.6], [1.0, -0.9, 1.2], [-0.9, 1.2, 1.0]]) { const [px, pz] = frame(tx, tz, yaw).at(ox, oz); W.add({ shape: 'box', mat: 'stone', x: px, y: y0 + 7 * (1.5 + GAP) + (sz * 0.6) / 2 + GAP, z: pz, sx: sz, sy: sz * 0.6, sz, q: yawQ(yaw), color: col(STN), tag }); }
  // tumbled blocks and boulders (inside the nave or clear of the walls)
  const IF = frame(0, 0, -yaw);
  for (let i = 0; i < 40; i++) {
    const a = rng() * TAU, r = 2 + rng() * 10, x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r, sc = 0.6 + rng() * 0.7;
    if (Math.hypot(x - s.x, z - s.z) > s.r - 2) continue;
    const [lu, lv] = IF.at(x - s.x, z - s.z);
    const inside = Math.abs(lu) < w / 2 - 1.6 && Math.abs(lv) < d / 2 - 1.6, outside = Math.abs(lu) > w / 2 + 1.4 || Math.abs(lv) > d / 2 + 1.4;
    if (!(inside || outside) || Math.hypot(lu + w / 2 + 3.2, lv) < 4.6) continue;
    G.physics.add({ shape: rng() < 0.5 ? 'rock' : 'box', mat: 'stone', x, y: y0 + sc * 0.5 + 0.02, z, sx: sc * 1.3, sy: sc, sz: sc, q: yawQ(rng() * 6), color: col(STN), tag });
  }
}

export function buildWatchtower(W, id, o = {}) {
  const s = siteOf(id), y0 = s.h, rng = makeRng(8100 + id.length * 7), tag = id;
  const t = tower(W, s.x, s.z, y0, o.side || 5.4, o.layers || 12, 1.5, {
    rot: o.rot || 0, color: o.color || A(0.3, 0.27, 0.22), tag, spire: o.spire, spireColor: o.spireColor || SLATE_D, merlons: o.spire ? false : 3,
    styleAt: (k) => (k === 0 ? [2, 0, 0.3, 0] : k % 4 === 2 ? [1, 0, 0.6, 0] : [0, 0, 0, 0]),
  });
  if (o.flag) banner(W, t.cap, 0.25 + (o.spire ? 0 : 0.9), o.flag, 0.3);
  for (let i = 0; i < 3; i++) { const a = rng() * TAU; barrel(s.x + Math.cos(a) * 4.2, y0, s.z + Math.sin(a) * 4.2, rng, tag); }
}

export function buildMillHill(W) {
  const s = siteOf('millhill'), ctx = { W, site: s, y0: s.h, rng: makeRng(8202), tag: 'millhill', houses: [] };
  windmill(ctx, s.x, s.z, s.h, 0.9, { roof: TILE_BROWN, speed: 0.38 });
  for (let i = 0; i < 4; i++) crate(s.x + 4.5, s.h, s.z - 1.5 + i * 0.95, ctx.rng, 'millhill', 0.7);
}

export function buildFarm(W, id, seed) {
  const ctx = ctxFor(W, id, seed, 2.0), { site: S, y0, rng } = ctx, tag = id;
  const yaw0 = rng() * TAU, F = frame(S.x, S.z, yaw0), L = (u, v) => F.at(u, v);
  const WALLS = [P(0.44, 0.42, 0.37), P(0.42, 0.37, 0.28), P(0.4, 0.4, 0.36)];
  houseAt(ctx, { w: 8.5, d: 6, floors: 2, fh: 2.7, color: pickR(rng, WALLS), roof: pickR(rng, THATCH), ridge: 'x', pitch: 52, pat: 1 + ((rng() * 3) | 0), lit: 0.6, sideWin: true, groundTimber: true, roofOpts: { ov: 0.5 } }, ...L(-4, -6), yaw0);
  houseAt(ctx, { w: 12, d: 7.5, floors: 1, fh: 4.3, mat: 'wood', color: pickR(rng, [[0.62, 0.3, 0.24], [0.5, 0.4, 0.32]]), gable: P(0.2, 0.1, 0.06), roof: SLATE_D, ridge: 'x', pitch: 45, pat: 1, lit: 0, backWin: false, t: 0.3, noProps: true, roofOpts: { gableFeat: 0 } }, ...L(5, 5), yaw0 + Math.PI / 2);
  houseAt(ctx, { w: 5, d: 4, floors: 1, fh: 2.6, mat: 'wood', color: [0.5, 0.42, 0.34], gable: P(0.16, 0.11, 0.08), roof: pickR(rng, THATCH), ridge: 'x', pitch: 45, pat: 0, lit: 0, backWin: false, t: 0.25, noProps: true }, ...L(-8, 5), yaw0 + Math.PI);
  fence([L(-11, 8.5), L(-11, 12.5), L(-1, 12.5), L(-1, 8.5)], y0, tag);
  for (let k = 0; k < 3; k++) { const [hx, hz] = L(-8.6 + k * 3.0, 10.5); hayBale(hx, y0, hz, rng, tag, true); }
  for (let i = 0; i < 4; i++) { const [px, pz] = L(-9 + i, -1.2); if (rng() < 0.5) barrel(px, y0, pz, rng, tag); else crate(px, y0, pz, rng, tag); }
  const [lx, lz] = L(10.5, -6); logPile(lx, y0, lz, yaw0, rng, tag);
}

export function buildShrine(W, id) {
  const s = siteOf(id);
  cross(W, s.x, s.z, s.h, id, { steps: [[2.2, 0.35], [1.5, 0.35]], drums: 2, dia: 0.7, color: S_(0.32, 0.3, 0.27), cap: SLATE_B });
}
