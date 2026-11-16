// The capital outside its walls. The old town (city.js) stays exactly as it was; around it grow the boroughs:
//   Westgate (west), Ravensgate (north-west), Northgate (north, with the Haymarket), Wharfside (the river bank under
//   the east wall), Eastbank (across the Aldwater) and Lakeside (south-east, where the river meets Mirrormere).
// Ring streets follow the wall, radial streets run out from it, and every street is lined with terraced rows
// (urban.js). Landmarks: parish churches, a guild hall, market halls, granaries, warehouses, outer gatehouses, a
// bridge tower, water mills, three stone bridges over the river, quays and moored boats.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { makeRng } from '../core/util.js';
import { CITY, RIVER, riverAt } from './layout.js';
import { GAP, yawQ, C, col, pickR, frame, faceYaw, tower, gatehouse, waterWheel, boat, groundH, footing, rectPts, barrel, crate, banner } from './kit.js';
import { Lot, arc, frontage, frontages, polyFrontage, scatter, riverDist, backLanes } from './urban.js';
import { church, cross, well, stall } from './towns.js';

const TAU = Math.PI * 2, D2R = Math.PI / 180;
const CX = CITY.x, CZ = CITY.z;
const P = (r, deg) => [CX + Math.cos(deg * D2R) * r, CZ + Math.sin(deg * D2R) * r];

// ---------------------------------------------------------------------------------------------- sites and roads
// Flat ground for the boroughs: discs at the capital's own height (overlapping discs make one plane; the terrain
// cuts the river through them afterwards). Registered with the terrain by settlements.js at import time.
const disc = (id, x, z, r, o = {}) => ({ id, name: o.name, x, z, r, blend: o.blend ?? 20, pave: o.pave ?? 0.9, rel: { to: 'capital', dh: o.dh ?? 0 }, borough: o.borough || o.name });
export const BOROUGH_SITES = [
  disc('cap_w1', -135, 8, 47, { name: 'Westgate' }),
  disc('cap_w2', -135, -60, 47, { name: 'Westgate' }),
  disc('cap_wg', -178, -26, 17, { name: 'Westgate' }),
  disc('cap_nw', -99, -125, 47, { name: 'Ravensgate' }),
  disc('cap_n1', -36, -161, 48, { name: 'Northgate' }),
  disc('cap_n2', 36, -161, 48, { name: 'Northgate' }),
  disc('cap_n3', 0, -205, 32, { name: 'Northgate' }),
  disc('cap_ne', 84, -126, 30, { name: 'Northgate' }),
  disc('cap_e0', 99, -75, 24, { name: 'Wharfside' }),
  disc('cap_e0b', 98, -30, 22, { name: 'Wharfside' }),
  disc('cap_e1', 152, -108, 33, { name: 'Eastbank' }),
  disc('cap_e1b', 140, -131, 16, { name: 'Eastbank' }),
  disc('cap_e2', 165, -55, 42, { name: 'Eastbank' }),
  disc('cap_e3', 152, -12, 28, { name: 'Eastbank' }),
  disc('cap_se1', 100, 20, 34, { name: 'Lakeside' }),
  disc('cap_se2', 100, 55, 28, { name: 'Lakeside' }),
  disc('cap_w3', -168, -105, 24, { name: 'Ravensgate' }),
  disc('cap_n4', -72, -192, 22, { name: 'Ravensgate' }),
  disc('cap_n5', 70, -182, 22, { name: 'Northgate' }),
  // outside Norgate, west of the Norbury road (Northfield Farm keeps the east side), and Ravensgate's last streets
  // towards Westmarch
  disc('cap_n6', -40, -228, 20, { name: 'Northgate' }),
  disc('cap_w4', -196, -78, 20, { name: 'Ravensgate' }),
  // the river runs higher up by the north bridge: its approaches are raised a little (the deck clears the water by 2.3 m)
  disc('cap_nbw', 96.5, -151.5, 5, { blend: 14, dh: 1.3, pave: 0.5, borough: 'Northgate' }),
  disc('cap_nbe', 126.5, -148.5, 5, { blend: 14, dh: 1.3, pave: 0.5, borough: 'Eastbank' }),
];

// main roads out of the boroughs (painted dirt tracks)
export const BOROUGH_ROADS = [
  { w: 2.6, pts: [[0, -232], [-6, -250], [-2, -272], [10, -291]] },                        // Norgate -> Norbury
  { w: 2.4, pts: [[-128, -190], [-150, -188], [-172, -198]] },                             // Ravens Way -> the castle gate
  { w: 2.4, pts: [[127, -149], [150, -164], [168, -174], [183, -176]] },                    // north bridge -> the abbey's west gate
  { w: 2.4, pts: [[-192, -26], [-206, -14], [-222, -1], [-232, 5]] },                      // Westgate -> Westmarch
  { w: 2.4, pts: [[199, -49], [222, -48], [250, -38], [275, -28], [290, -20]] },           // Eastgate -> the abbey / Mirrormere road
  { w: 2.2, pts: [[176, -2], [215, -16], [252, -22], [276, -26]] },                        // Eastbank -> along the lake's north shore
  { w: 2.2, pts: [[86, 76], [74, 82], [52, 80], [40, 76]] },                               // Lakeside -> the south gate road
];

// ---------------------------------------------------------------------------------------------- palettes (capital)
const WALLS = [[0.95, 0.9, 0.78], [0.93, 0.8, 0.56], [0.88, 0.64, 0.5], [0.74, 0.82, 0.84], [0.8, 0.84, 0.7], [0.97, 0.95, 0.92], [0.9, 0.72, 0.62], [0.84, 0.77, 0.64], [0.92, 0.86, 0.66], [0.78, 0.7, 0.62]];
const ROOFS = [[0.82, 0.76, 0.74], [0.7, 0.62, 0.6], [0.9, 0.74, 0.66], [0.6, 0.52, 0.5], [0.78, 0.68, 0.58], [0.48, 0.47, 0.5], [0.66, 0.56, 0.5]];
const STONE = [0.86, 0.82, 0.76], STONE_D = [0.7, 0.67, 0.62], SLATE = [0.42, 0.42, 0.47], COPPER = [0.45, 0.62, 0.55], GROUND = [0.78, 0.75, 0.7];

// a terrace unit for a street of the given class: 'main' (tall, deep, shops), 'street', 'lane' (low, short rows)
function unit(r, o) {
  const f = r(), cls = o.cls || 'street';
  const floors = cls === 'main' ? (f < 0.12 ? 4 : f < 0.62 ? 3 : 2) : cls === 'lane' ? (f < 0.22 ? 1 : f < 0.86 ? 2 : 3) : f < 0.08 ? 1 : f < 0.66 ? 2 : 3;
  return {
    w: cls === 'main' ? 5 + r() * 2.6 : 4.5 + r() * 2.4, floors, color: pickR(r, WALLS), roof: pickR(r, ROOFS),
    ridge: r() < (cls === 'lane' ? 0.8 : 0.66) ? 'x' : 'z', pitch: 44 + r() * 10, pat: r() < 0.25 ? 0 : 1 + ((r() * 3) | 0), lit: 0.3 + r() * 0.5,
    groundTimber: r() < 0.35, ground: r() < 0.35 ? GROUND : null, sideWin: r() < 0.55, tallWin: r() < 0.1, gableFeat: r() < 0.45 ? 4 : 0, shop: cls === 'main' && r() < 0.35,
  };
}
const CLS = {
  main: { cls: 'main', depth: (r) => 8.5 + r() * 2, fh: (r) => [3.2 + r() * 0.2, 2.9], maxRun: 8, breakP: 0.06, gap: (r) => 1.2 + r() * 1.6 },
  street: { cls: 'street', depth: (r) => 7.5 + r() * 2, fh: (r) => [3.0 + r() * 0.2, 2.8], maxRun: 7, breakP: 0.1, gap: (r) => 1.3 + r() * 2.2 },
  lane: { cls: 'lane', depth: (r) => 6.6 + r() * 1.8, fh: (r) => [2.85, 2.7], maxRun: 5, breakP: 0.16, gap: (r) => 1.6 + r() * 3 },
};

// ---------------------------------------------------------------------------------------------- the river
// centre-line point `u` metres upstream of the mouth: { x, z, tx, tz } (tx, tz: direction of flow)
function riverPoint(u) {
  const us = RIVER.us; let i = 0;
  while (i < us.length - 2 && us[i + 1] > u) i++;
  const t = Math.max(0, Math.min(1, (us[i] - u) / (us[i] - us[i + 1] || 1)));
  const x = RIVER.xs[i] + (RIVER.xs[i + 1] - RIVER.xs[i]) * t, z = RIVER.zs[i] + (RIVER.zs[i + 1] - RIVER.zs[i]) * t;
  const dx = RIVER.xs[i + 1] - RIVER.xs[i], dz = RIVER.zs[i + 1] - RIVER.zs[i], l = Math.hypot(dx, dz) || 1;
  return { x, z, tx: dx / l, tz: dz / l };
}
// a line along one bank, `d` metres from the centre line (sgn +1: left bank looking downstream, i.e. east / north-east)
function bankLine(u0, u1, d, sgn, step = 7) {
  const pts = [], n = Math.max(1, Math.round(Math.abs(u1 - u0) / step));
  for (let i = 0; i <= n; i++) { const c = riverPoint(u0 + ((u1 - u0) * i) / n); pts.push([c.x + sgn * c.tz * d, c.z - sgn * c.tx * d]); }
  return pts;
}

// Stone bridge across the river at `u`: piers with corbelled heads on the river bed, deck slabs from bank to bank
// (the deck clears the normal water by at least 2.3 m), parapets and a step at each end. Returns the two road ends.
function riverBridge(ctx, u, o = {}) {
  const { W, tag } = ctx, c = riverPoint(u), ax = c.tz, az = -c.tx, F = frame(c.x, c.z, faceYaw(ax, az));
  const surf = RIVER.surfAt(u), yB = o.yBank, yU = Math.max(yB, surf + 2.3), dw = o.width || 6.4, SC = col(o.color || STONE);
  const g = (s) => groundH(c.x + ax * s, c.z + az * s);
  // the banks: where the ground is back up at the level of the approaches (sampled across the whole deck width)
  const bankAt = (s) => { let m = 1e9; for (const lx of [-dw / 2, 0, dw / 2]) { const [x, z] = F.at(lx, s); m = Math.min(m, groundH(x, z)); } return m; };
  let s1 = 5; while (s1 < 24 && bankAt(s1) < yB - 0.04) s1 += 0.2;
  let s0 = -5; while (s0 > -24 && bankAt(s0) < yB - 0.04) s0 -= 0.2;
  const pS = 3.5, add = (lz, y, sxl, sy, szl, o2 = {}) => { const [x, z] = F.at(0, lz); return W.add({ shape: 'box', mat: 'ashlar', x, y, z, sx: sxl, sy, sz: szl, q: F.q, color: SC, tag, ...o2 }); };
  // The masonry that carries the deck (pier shafts and corbel heads, the bank seats, the steps) is fixed: bedded in
  // the river bed and the banks, it cannot rest loose on the uneven, current-swept ground. The deck slabs and the
  // parapets are loose and rest exactly on it, so they can be blasted off or washed away.
  const fixedBox = (lz, y0b, y1b, sxl, szl, o2 = {}) => add(lz, (y0b + y1b) / 2, sxl, y1b - y0b, szl, { fixed: true, struct: false, ...o2 });
  const lowest = (pts) => { let m = 1e9; for (const [x, z] of pts) m = Math.min(m, groundH(x, z)); return m; };
  for (const s of [-pS, pS]) {
    // piers: local z runs across the river, local x along the flow
    const yb = lowest(rectPts(F, dw / 2 + 0.4, 0.8, 5, 3, 0, s)) - 0.6, shaftTop = yU - 1.2;
    fixedBox(s, yb, shaftTop, dw + 0.8, 1.6);
    fixedBox(s, shaftTop, shaftTop + 0.6, dw + 0.6, 2.6, { style: [0, 0, 0, 0] });
    fixedBox(s, shaftTop + 0.6, yU, dw + 0.4, 3.6);
  }
  // deck: two slabs side by side per span, on the corbel heads and the bank seats
  const yD = yU + 0.35 + GAP, spans = [[s0 - 1.6, -pS - 0.006], [-pS + 0.006, pS - 0.006], [pS + 0.006, s1 + 1.6]];
  for (const [a, b] of spans) for (const sx of [-1, 1]) {
    const [x, z] = F.at(sx * dw / 4, (a + b) / 2);
    W.add({ shape: 'box', mat: 'ashlar', x, y: yD, z, sx: dw / 2 - 0.012, sy: 0.7, sz: b - a, q: F.q, color: SC, tag });
    const [px, pz] = F.at(sx * (dw / 2 - 0.23), (a + b) / 2);
    W.add({ shape: 'box', mat: 'ashlar', x: px, y: yD + 0.35 + 0.45 + GAP, z: pz, sx: 0.44, sy: 0.9, sz: b - a - 0.1, q: F.q, color: SC, tag });
  }
  // the bank seats under the deck ends (standing up as abutments where the water keeps the deck above the banks),
  // then steps down from the deck to the road at each end
  const hA = yU - yB, drop = hA + 0.7 + GAP, nSt = Math.max(2, Math.ceil(drop / 0.34)) - 1;
  for (const sg of [-1, 1]) {
    const sb = sg < 0 ? s0 : s1;
    fixedBox(sb + sg * 0.8, lowest(rectPts(F, dw / 2 + 0.2, 0.79, 4, 3, 0, sb + sg * 0.8)) - 0.5, yU, dw + 0.4, 1.58);
    for (let k = 0; k < nSt; k++) {
      const top = yU + 0.7 + GAP - ((k + 1) * drop) / (nSt + 1), a = sb + sg * (1.62 + k), b = a + sg * 0.98, mid = (a + b) / 2;
      const pts = rectPts(F, dw / 2 - 0.4, 0.49, 4, 3, 0, mid);
      if (top - footing(pts) < 0.08) continue;
      fixedBox(mid, lowest(pts) - 0.4, top, dw - 0.8, 0.98, { mat: 'stone', color: col(STONE_D) });
    }
  }
  const ext = 1.62 + nSt + 0.4, e0 = F.at(0, s0 - ext), e1 = F.at(0, s1 + ext);
  return { c, F, s0, s1, yU, top: yU + 0.7, e0, e1, ax, az, fp: { x: c.x + ax * (s0 + s1) / 2, z: c.z + az * (s0 + s1) / 2, hw: dw / 2 + 0.5, hd: (s1 - s0) / 2 + ext, yaw: F.yaw } };
}

// stone kerb along the top of a bank (only where the ground is flat at y0), with a bollard now and then
function quayD(c, sgn, y0) {
  let d = 10.4; while (d < 14 && Math.abs(groundH(c.x + sgn * c.tz * d, c.z - sgn * c.tx * d) - y0) > 0.05) d += 0.3;
  return d < 14 ? d : 0;
}
function quay(ctx, lot, u0, u1, sgn, y0) {
  const { W, tag } = ctx;
  let n = 0;
  for (let u = u0; u > u1; u -= 3.25) {
    const c0 = riverPoint(u), c1 = riverPoint(u - 3.1), d = quayD(c0, sgn, y0);
    if (!d) continue;
    const x0 = c0.x + sgn * c0.tz * (d + 0.35), z0 = c0.z - sgn * c0.tx * (d + 0.35), x1 = c1.x + sgn * c1.tz * (d + 0.35), z1 = c1.z - sgn * c1.tx * (d + 0.35);
    if (Math.abs(groundH(x1, z1) - y0) > 0.05 || Math.abs(groundH((x0 + x1) / 2, (z0 + z1) / 2) - y0) > 0.05) continue;
    const L = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(-(z1 - z0), x1 - x0), Fq = frame((x0 + x1) / 2, (z0 + z1) / 2, yaw);
    if (footing(rectPts(Fq, L / 2, 0.31, 3, 2)) > y0 + 0.04) continue;
    const fp = { x: Fq.x, z: Fq.z, hw: L / 2, hd: 0.32, yaw };
    if (!lot.free(fp, 0.05, true)) continue;
    lot.take(fp);
    W.add({ shape: 'box', mat: 'stone', x: (x0 + x1) / 2, y: y0 + 0.3 + GAP, z: (z0 + z1) / 2, sx: L - 0.06, sy: 0.6, sz: 0.62, q: yawQ(yaw), color: col(STONE_D), tag });
    const bx = x0 + sgn * c0.tz * 0.9, bz = z0 - sgn * c0.tx * 0.9, bf = { circle: true, x: bx, z: bz, r: 0.25 };
    if (n++ % 4 === 1 && lot.free(bf, 0.05, true)) { lot.take(bf); W.add({ shape: 'cyl', mat: 'stone', x: bx, y: y0 + 0.4 + GAP, z: bz, sx: 0.42, sy: 0.8, sz: 0.42, color: col([0.5, 0.48, 0.46]), tag, struct: false }); }
  }
  return n;
}

// a boat drawn up on the wharf behind the quay kerb (the river runs too fast for boats to lie at their moorings:
// the current would wake them and carry them off into the bridges)
function wharfBoat(ctx, lot, u, sgn, y0, rng, barge) {
  const c = riverPoint(u), d = quayD(c, sgn, y0); if (!d) return false;
  const L = 5 + rng() * 2.5, Wd = 1.9 + rng() * 0.4, dd = d + 1.6 + Wd / 2, x = c.x + sgn * c.tz * dd, z = c.z - sgn * c.tx * dd, yaw = faceYaw(c.tx, c.tz) + (rng() - 0.5) * 0.12;
  const F = frame(x, z, yaw), pts = rectPts(F, Wd / 2, L / 2, 3, 4);
  if (pts.some(([px, pz]) => Math.abs(groundH(px, pz) - y0) > 0.03)) return false;
  const fp = { x, z, hw: Wd / 2 + 0.2, hd: L / 2 + 0.2, yaw };
  if (!lot.free(fp, 0.1, true)) return false;
  lot.take(fp);
  const g = footing(pts);
  boat(x, g + 0.35 + 0.28 + GAP, z, yaw, makeRng((u * 1000) | 0), ctx.tag, { barge, len: L, w: Wd });
  return true;
}

// water mill on a bank: a two-storey mill house facing the river and a turning wheel on a stone pier at the bank top
function waterMill(ctx, lot, u, sgn, o = {}) {
  const { W, y0, tag } = ctx, c = riverPoint(u), nx = sgn * c.tz, nz = -sgn * c.tx, yaw = faceYaw(-nx, -nz);
  // the mill house stands behind the quay street, the wheel pier on the quay at the top of the bank
  const w = o.w || 10, d = o.d || 7.6, dh = 17.4 + d / 2, x = c.x + nx * dh, z = c.z + nz * dh;
  const fp = { x, z, hw: w / 2 + 0.5, hd: d / 2 + 0.5, yaw };
  if (!lot.fits(fp, 0.3)) return null;
  lot.take(fp);
  const h = { id: ctx.nextId(), x, z, w, d, yaw, y0, floors: 2, fh: 3.1, lean: true, t: 0.5, color: o.color || [0.9, 0.86, 0.76], ground: STONE, roof: o.roof || [0.6, 0.52, 0.5], ridge: 'x', pitch: 48, pat: 2, lit: 0.6, sideWin: true, groundTimber: false, tag, roofOpts: { gableFeat: 4, ov: 0.4, ovL: 0.5 } };
  W.house(h); ctx.out.push(h);
  // the wheel pier stands at the top of the bank, the wheel turns over the water
  const dp = 12.8, px = c.x + nx * dp, pz = c.z + nz * dp, Fp = frame(px, pz, yaw);
  const yb = footing(rectPts(Fp, 0.75, 0.75)) + 0.01;
  const ph = 2.6, pierB = W.add({ shape: 'box', mat: 'ashlar', x: px, y: yb + ph / 2 + GAP, z: pz, sx: 1.5, sy: ph, sz: 1.5, q: Fp.q, color: col(STONE), tag });
  lot.take({ x: px, z: pz, hw: 1.2, hd: 1.2, yaw });
  const wheelY = Math.max(RIVER.surfAt(u) + 1.6, y0 - 1.0), dw = 9.5;
  const off = new THREE.Matrix4().makeTranslation(0, wheelY - (yb + ph / 2), dp - dw);
  waterWheel(W, pierB, off, sgn * 0.55);
  return h;
}

// open market hall: two rows of stone columns carrying a timber floor and a one-storey hall
function marketHall(ctx, x, z, yaw, o = {}) {
  const { W, y0, tag } = ctx, F = frame(x, z, yaw), w = o.w || 11, d = o.d || 6, nx = o.nx || 4;
  for (let i = 0; i < nx; i++) for (const s of [-1, 1]) {
    const [px, pz] = F.at((i / (nx - 1) - 0.5) * (w - 0.9), s * (d / 2 - 0.45));
    for (let k = 0; k < 2; k++) W.add({ shape: 'cyl', mat: 'stone', x: px, y: y0 + 0.675 + k * (1.35 + GAP) + GAP, z: pz, sx: 0.75, sy: 1.35, sz: 0.75, color: col([0.8, 0.76, 0.7]), tag });
  }
  const sy = y0 + 2.7 + 3 * GAP;
  W.add({ shape: 'box', mat: 'wood', x, y: sy + 0.15 + GAP, z, sx: w + 0.2, sy: 0.3, sz: d + 0.3, q: F.q, tint: 0.7, tag });
  const h = { id: ctx.nextId(), x, z, yaw, w, d, floors: 1, fh: 3, y0: sy + 0.3 + 2 * GAP, lean: true, color: o.color || [0.93, 0.8, 0.56], roof: o.roof || [0.7, 0.62, 0.6], ridge: 'x', pitch: 52, pat: 3, lit: 0.6, sideWin: true, tag, roofOpts: { ov: 0.55, ovL: 0.5, gableFeat: 4 } };
  W.house(h); ctx.out.push(h);
  return h;
}

// footprint of a church built by towns.js church()
function churchFp(x, z, yaw, o) {
  const ts = o.tower ? o.tower.side : 0, x0 = -o.w / 2 - (o.tower ? 0.25 + ts : 0) - 0.4, x1 = o.w / 2 + 0.45, F = frame(x, z, yaw), [fx, fz] = F.at((x0 + x1) / 2, 0);
  return { x: fx, z: fz, hw: (x1 - x0) / 2 + 0.6, hd: o.d / 2 + 1.2, yaw };
}

// =============================================================================================== the boroughs
export function buildBoroughs(W) {
  const Ph = G.physics, t0 = performance.now(), y0 = W.y0, rng = makeRng(4401), tag = 'capital';
  let hid = 1000;
  const out = W.houses, stats = {};
  const ctx = { W, y0, rng, tag, houses: [], out, nextId: () => hid++ };
  const mask = (x, z) => {
    const r = Math.hypot(x - CX, z - CZ);
    if (r < 100.6) return false;                                  // the ring road round the walls stays open
    if (Math.abs(x) < 63 && z > 48) return false;                 // the approach from the overlook stays open
    if (Math.hypot(x + 105, z - 96) < 52 || Math.hypot(x + 167, z - 112) < 50) return false;   // the showcase meadow
    return true;
  };
  const lot = new Lot({ y0, tol: 0.05, mask, riverMin: 12.6 });
  const fo = (cls, extra = {}) => ({ ...CLS[cls], y0, tag, nextId: ctx.nextId, out, ctx: CLS[cls], ...extra });
  const run = (id, fn) => { const b0 = Ph.blocks.length, h0 = out.length; fn(); stats[id] = { bodies: Ph.blocks.length - b0, houses: out.length - h0 }; };
  // landmark placement: the preferred spot, else the nearest free spot on a little spiral round it
  const spot = (fpAt, x, z, yaw, reach = 14) => {
    for (let k = 0; k < 90; k++) {
      const a = k * 2.4, r = k === 0 ? 0 : Math.sqrt(k) * (reach / Math.sqrt(90)), px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      for (const yy of [yaw, yaw + Math.PI / 2]) { const fp = fpAt(px, pz, yy); if (lot.fits(fp, 0.4)) { lot.take(fp); return [px, pz, yy]; } }
    }
    return null;
  };
  const bigHouse = (s) => { const h = { id: ctx.nextId(), y0, tag, lean: true, t: 0.45, ...s, roofOpts: { gableFeat: 4, ov: 0.45, ovL: 0.5, ...(s.roofOpts || {}) } }; W.house(h); out.push(h); return h; };
  const houseFp = (w, d) => (x, z, yaw) => ({ x, z, hw: w / 2 + 0.55, hd: d / 2 + 0.55, yaw });

  // ------------------------------------------------------------------ streets (reserved first)
  // (long chords: each straight piece of a ring is lined separately, so short ones waste frontage)
  const ring1 = arc(CX, CZ, 97.6, 0, TAU, 20);
  const ring2 = arc(CX, CZ, 136, 128 * D2R, 312 * D2R, 20);
  const ring3 = arc(CX, CZ, 176, 146 * D2R, 300 * D2R, 20);
  const westMain = [P(99, 180), P(196, 180)];
  const northMain = [[0, -111], [0, -238]];
  const nwRoad = [[-5, -113], [-45, -148], [-95, -176], [-130, -190]];
  const neRoad = [[5, -113], [52, -140], [93, -151]];
  const radials = [155, 205, 250, 290].map((a) => [P(99, a), P(a === 155 ? 196 : 207, a)]);
  const outerW = arc(CX, CZ, 200, 190 * D2R, 222 * D2R, 18), outerN = arc(CX, CZ, 199, 236 * D2R, 258 * D2R, 18);
  const swLane = [P(99, 132), P(160, 138)];
  lot.poly(ring1, 7); lot.poly(ring2, 5); lot.poly(ring3, 4.6);
  lot.poly(westMain, 6.5); lot.poly(northMain, 7); lot.poly(nwRoad, 5.5); lot.poly(neRoad, 5.5);
  for (const r of radials) lot.poly(r, 4.4);
  lot.poly(outerW, 4); lot.poly(outerN, 4);
  lot.poly(swLane, 4);
  // squares: the Haymarket (north) and Westgate market, where the main streets cross the second ring
  const hay = { x: 0, z: -162, hw: 20, hd: 15, yaw: 0 }, wmk = { x: -136, z: -26, hw: 14, hd: 18, yaw: 0 };
  lot.take(hay); lot.take(wmk);
  // ---- the river: bridges, quay streets
  const uE = RIVER.us[0], bridgeU = { north: 0, east: 0, lake: 0 };
  { const r = riverAt(111.5, -150), e = riverAt(116.9, -25.7), l = riverAt(140.5, 11.5); bridgeU.north = r.u; bridgeU.east = e.u; bridgeU.lake = l.u; }
  const eastQuay = bankLine(208, 60, 13.6, 1, 6), westQuay = bankLine(205, 92, 13.6, -1, 6), lowQuay = bankLine(78, 18, 13.6, -1, 6);
  lot.poly(eastQuay, 3.6); lot.poly(westQuay, 3.6); lot.poly(lowQuay, 3.6);
  // east bank streets
  const eb = riverPoint(bridgeU.east), ebA = [eb.x + eb.tz * 15, eb.z - eb.tx * 15], ebDir = [eb.tz, -eb.tx];
  const eastMain = [ebA, [ebA[0] + ebDir[0] * 72, ebA[1] + ebDir[1] * 72]];
  const millSt = [[160, -142], [160, 4]], woolSt = [[190, -96], [190, -22]], abbeyLane = [[124, -121], [188, -121]], fishSt = [[123, -84], [208, -84]];
  const lb = riverPoint(bridgeU.lake), lbA = [lb.x + lb.tz * 15, lb.z - lb.tx * 15], lbB = [lb.x - lb.tz * 15, lb.z + lb.tx * 15];
  const lakeN = [lbA, [lbA[0] + 4, lbA[1] - 18], [158, -36]], northShore = [[lbA[0] + 3, lbA[1] - 3], [182, -4]];
  lot.poly(eastMain, 6); lot.poly(millSt, 4.4); lot.poly(woolSt, 4.2); lot.poly(abbeyLane, 4.2); lot.poly(fishSt, 4.4); lot.poly(lakeN, 4.6); lot.poly(northShore, 4.2);
  const emk = { x: 176, z: -62, hw: 13, hd: 11, yaw: 0 }; lot.take(emk);
  // Lakeside streets
  const lakeMain = [P(99, 18), [lbB[0] - 2, lbB[1] + 2]], lakeSt2 = [P(99, 38), [126, 50]], lakeLane = [[74, 68], [124, 72]], southLane = [[88, 34], [92, 82]];
  lot.poly(lakeMain, 5.6); lot.poly(lakeSt2, 4.4); lot.poly(lakeLane, 4); lot.poly(southLane, 4);
  const fmk = { x: 108, z: 42, hw: 9, hd: 7, yaw: 0.4 }; lot.take(fmk);

  // ------------------------------------------------------------------ bridges
  run('bridges', () => {
    const nb = riverBridge(ctx, bridgeU.north, { yBank: y0 + 1.3, width: 6.4 });
    const ebr = riverBridge(ctx, bridgeU.east, { yBank: y0, width: 7.2 });
    const lbr = riverBridge(ctx, bridgeU.lake, { yBank: y0, width: 6.0 });
    for (const b of [nb, ebr, lbr]) lot.take(b.fp);
    W.bridges = [nb, ebr, lbr].map((b, i) => ({ name: ['North Bridge', 'East Bridge', 'Lake Bridge'][i], x: +b.c.x.toFixed(1), z: +b.c.z.toFixed(1), deck: +b.top.toFixed(2), surf: +RIVER.surfAt([bridgeU.north, bridgeU.east, bridgeU.lake][i]).toFixed(2), len: +(b.s1 - b.s0 + 3.2).toFixed(1) }));
    // the bridge tower over the east end of the East Bridge
    const yawE = faceYaw(ebDir[0], ebDir[1]), tx = ebA[0] + ebDir[0] * 6.5, tz = ebA[1] + ebDir[1] * 6.5;
    const g = gatehouse(W, tx, tz, y0, yawE, { side: 4.6, layers: 9, gapW: 6.0, color: STONE, tag, spire: 7.5, spireColor: SLATE, banner: [0.75, 0.1, 0.08] });
    lot.take(g.fp); W.bridgeTower = { x: +tx.toFixed(1), z: +tz.toFixed(1), top: +(y0 + 9 * 1.504 + 0.5 + 1.4 + 2.8 + 7.5).toFixed(1) };
  });

  const lm = {};
  // ------------------------------------------------------------------ water mills, quays, boats
  run('river', () => {
    // each mill takes the first spot along its stretch of bank where it fits
    const mill = (u0, u1, sgn, o) => { for (let u = u0; u >= u1; u -= 2) { const h = waterMill({ ...ctx }, lot, u, sgn, o); if (h) return h; } return null; };
    lm.millN = mill(214, 176, -1, { w: 10, d: 7.6 });
    lm.millE = mill(160, 140, 1, { w: 10, d: 8, color: [0.84, 0.77, 0.64] });
    lm.millL = mill(72, 24, -1, { w: 9.5, d: 7.4, color: [0.97, 0.95, 0.92] }) || mill(60, 24, 1, { w: 9.5, d: 7.4, color: [0.97, 0.95, 0.92] });
    for (const k of ['millN', 'millE', 'millL']) if (lm[k]) lm[k] = [+lm[k].x.toFixed(1), +lm[k].z.toFixed(1)];
    let q = 0;
    q += quay(ctx, lot, 212, 96, 1, y0); q += quay(ctx, lot, 205, 95, -1, y0); q += quay(ctx, lot, 80, 20, -1, y0); q += quay(ctx, lot, 72, 22, 1, y0);
    // boats drawn up on the wharves, barges by the warehouses
    const rb = makeRng(4477); let nb = 0;
    for (const [u, sgn, barge] of [[198, 1, false], [176, 1, true], [150, 1, false], [128, 1, true], [116, 1, false], [182, -1, false], [140, -1, true], [104, -1, false], [70, -1, false], [56, -1, true], [46, 1, false], [30, -1, false]]) {
      if (Math.abs(u - bridgeU.north) < 9 || Math.abs(u - bridgeU.east) < 9 || Math.abs(u - bridgeU.lake) < 9) continue;
      for (let k = 0; k < 4; k++) if (wharfBoat(ctx, lot, u + k * 2.5, sgn, y0, rb, barge)) { nb++; break; }
    }
    lm.boats = nb;
    lm.quayBlocks = q;
  });

  // ------------------------------------------------------------------ landmarks
  run('landmarks', () => {
    // outer gatehouses: Norgate on the Norbury road, Westgate on the Westmarch road, Eastgate beyond the river
    const gN = gatehouse(W, 0, -229, y0, 0, { side: 5.2, layers: 9, gapW: 6.4, color: STONE, tag, banner: [0.75, 0.1, 0.08] }); lot.take(gN.fp); lm.norgate = [0, -229];
    const [wgx, wgz] = P(188, 180), gW = gatehouse(W, wgx, wgz, y0, Math.PI / 2, { side: 5.2, layers: 9, gapW: 6.4, color: STONE, tag, spire: 6.5, spireColor: SLATE, banner: [0.75, 0.1, 0.08] }); lot.take(gW.fp); lm.westgate = [wgx, wgz];
    const eg = [ebA[0] + ebDir[0] * 63, ebA[1] + ebDir[1] * 63], gE = gatehouse(W, eg[0], eg[1], y0, faceYaw(ebDir[0], ebDir[1]), { side: 4.8, layers: 8, gapW: 6.0, color: STONE, tag }); lot.take(gE.fp); lm.eastgate = eg;
    // Haymarket: market hall, market cross, well, stalls; the guild hall on its north-east corner
    marketHall(ctx, -11, -153, Math.PI / 2, { w: 12, d: 6.5 }); lot.take({ x: -11, z: -153, hw: 3.8, hd: 6.6, yaw: 0 });
    cross(W, 9, -170, y0, tag, { color: STONE_D }); well(W, -9, -172, y0, tag);
    const cloth = [[1.6, 0.3, 0.25], [1.5, 1.4, 1.2], [0.35, 0.6, 1.5], [1.6, 1.1, 0.3], [0.4, 1.1, 0.5]];
    [[10, -154, 0.2], [14, -164, 1.4], [-13, -167, 0.1], [7, -174, -0.2], [-6, -175, 0.3]].forEach(([x, z, a], i) => stall(ctx, x, z, a, cloth[i % cloth.length]));
    const gh = spot(houseFp(17, 10.5), 31, -183, 0, 10);
    if (gh) {
      const h = bigHouse({ x: gh[0], z: gh[1], yaw: gh[2], w: 17, d: 10, floors: 3, fh: 3.4, lean: false, color: [0.96, 0.88, 0.7], ground: STONE, roof: [0.5, 0.48, 0.52], ridge: 'x', pitch: 52, pat: 3, lit: 0.85, tallWin: true, sideWin: true, t: 0.5 });
      const F = frame(gh[0], gh[1], gh[2]), [tx, tz] = F.at(-17 / 2 + 2.2, -10 / 2 - 2.0);
      tower(W, tx, tz, y0, 4.0, 13, 1.5, { rot: gh[2], color: STONE, tag, spire: 6, spireColor: COPPER, styleAt: (k) => (k === 11 ? [6, 0, 1, 0] : k % 4 === 2 ? [1, 0, 0.6, 0] : [0, 0, 0, 0]) });
      lot.take({ x: tx, z: tz, hw: 2.6, hd: 2.6, yaw: gh[2] }); lm.guildhall = [gh[0], gh[1], h.id];
    }
    // parish churches: St Botolph (Northgate), St Giles (Westgate), St Mary (Ravensgate), St Clement (Eastbank), St Peter (Lakeside)
    const churches = [
      ['stbotolph', -32, -184, 0, { w: 15, d: 9, tiers: 2, th: 4.4, t: 0.75, stone: STONE, gable: STONE, roof: SLATE, glass: true, rose: true, tower: { side: 5.6, layers: 14, spire: 12, spireColor: SLATE, tall: { 11: 3.0 }, styleAt: (k) => (k === 11 ? [3, 0, 0.9, 0] : k === 9 ? [6, 0, 1, 0] : k === 1 ? [2, 0, 0.4, 0] : k % 3 === 2 ? [1, 0, 0.5, 0] : [0, 0, 0, 0]) } }],
      ['stgiles', -160, -60, 0.15, { w: 13, d: 8.4, tiers: 1, th: 6, t: 0.7, stone: [0.82, 0.78, 0.72], gable: STONE, roof: [0.6, 0.52, 0.5], glass: true, tower: { side: 5, layers: 12, spire: 10, spireColor: [0.6, 0.52, 0.5] } }],
      ['stmary', -112, -150, -0.4, { w: 12, d: 8, tiers: 1, th: 5.5, t: 0.7, stone: STONE, gable: STONE, roof: SLATE, tower: { side: 4.6, layers: 11, merlons: true } }],
      ['stclement', 176, -108, 0, { w: 14, d: 8.6, tiers: 2, th: 4.2, t: 0.7, stone: [0.84, 0.8, 0.74], gable: STONE, roof: SLATE, glass: true, tower: { side: 5.2, layers: 13, spire: 11, spireColor: COPPER } }],
      ['stpeter', 82, 52, 0.2, { w: 11, d: 7, tiers: 1, th: 5, t: 0.65, stone: STONE, gable: STONE, roof: [0.7, 0.62, 0.6], tower: { side: 3.8, layers: 10, lh: 1.4, spire: 7, spireColor: SLATE } }],
    ];
    for (const [id, x, z, yaw, o] of churches) {
      const s = spot((px, pz, yy) => churchFp(px, pz, yy, o), x, z, yaw, 16);
      if (!s) continue;
      const res = church({ ...ctx, tag }, s[0], s[1], s[2], o);
      lm[id] = [+s[0].toFixed(1), +s[1].toFixed(1), res.tower ? +res.tower.y.toFixed(1) : null];
    }
    // granaries and warehouses: tall plain stores (timber-framed granaries, stone warehouses on the quays)
    const stores = [
      ['granaryN', 48, -204, 0.1, 18, 9, 3, 'wood'], ['granaryW', -178, -70, Math.PI / 2, 16, 8.5, 3, 'wood'],
      ['wareE3', 138, -110, -Math.PI / 2, 14, 9, 3, 'ashlar'], ['wareE1', 138, -72, -Math.PI / 2, 15, 9, 4, 'ashlar'], ['wareE2', 138, -54, -Math.PI / 2, 14, 9.5, 4, 'ashlar'],
      ['wareL1', 116, 8, 2.4, 16, 9, 3, 'ashlar'], ['granaryL', 70, 40, 0.3, 15, 8, 3, 'wood'],
    ];
    for (const [id, x, z, yaw, w, d, floors, mat] of stores) {
      const s = spot(houseFp(w, d), x, z, yaw, 12);
      if (!s) continue;
      const wood = mat === 'wood';
      bigHouse({ x: s[0], z: s[1], yaw: s[2], w, d, floors, fh: wood ? 3.0 : 3.2, mat: wood ? 'plaster' : 'ashlar', color: wood ? [0.62, 0.46, 0.34] : [0.84, 0.8, 0.74], ground: STONE_D, gable: wood ? [0.5, 0.38, 0.28] : STONE, roof: wood ? [0.66, 0.56, 0.5] : SLATE, ridge: 'x', pitch: wood ? 50 : 42, pat: wood ? 1 : 0, lit: 0.25, sideWin: !wood, tallWin: false, backWin: !wood, t: 0.5, roofOpts: { gableFeat: wood ? 0 : 4 } });
      lm[id] = [+s[0].toFixed(1), +s[1].toFixed(1)];
    }
    // towers: the Westgate tower by the market, the Watergate tower at the north end of the quay (it replaces East Watch)
    for (const [id, x, z, side, layers, sp] of [['westtower', -118, -44, 5.4, 15, 9], ['watergate', 147, -140, 5.4, 13, 0]]) {
      const s = spot((px, pz) => ({ x: px, z: pz, hw: side / 2 + 0.6, hd: side / 2 + 0.6, yaw: 0.3 }), x, z, 0.3, 10);
      if (!s) continue;
      const t = tower(W, s[0], s[1], y0, side, layers, 1.5, { rot: 0.3, color: STONE, tag, spire: sp || 0, spireColor: SLATE, merlons: sp ? false : 3, styleAt: (k) => (k === 0 ? [2, 0, 0.3, 0] : k % 4 === 2 ? [1, 0, 0.6, 0] : [0, 0, 0, 0]) });
      if (!sp) banner(W, t.cap, 0.25 + 0.9, [0.75, 0.1, 0.08], 0.3);
      lm[id] = [+s[0].toFixed(1), +s[1].toFixed(1), +t.y.toFixed(1)];
    }
    // Westgate market: a cloth hall on columns
    marketHall(ctx, -136, -37, 0, { w: 13, d: 6.5, nx: 5, color: [0.9, 0.72, 0.62], roof: [0.6, 0.52, 0.5] }); lot.take({ x: -136, z: -37, hw: 7.2, hd: 3.9, yaw: 0 });
    cross(W, -128, -18, y0, tag, { color: STONE_D }); well(W, -144, -16, y0, tag);
    stall(ctx, -142, -30, 0.2, [1.5, 1.4, 1.2]); stall(ctx, -129, -29, -0.3, [0.35, 0.6, 1.5]);
    // Eastbank market: a well and stalls; Lakeside fish market (an open hall)
    well(W, 176, -62, y0, tag); stall(ctx, 170, -56, 0.1, [1.6, 1.1, 0.3]); stall(ctx, 183, -67, 1.5, [0.4, 1.1, 0.5]); stall(ctx, 168, -68, -0.2, [1.6, 0.3, 0.25]);
    marketHall(ctx, fmk.x, fmk.z, fmk.yaw, { w: 10, d: 6, nx: 4, color: [0.74, 0.82, 0.84], roof: SLATE });
  });

  // ------------------------------------------------------------------ street frontages (most important streets first)
  run('Northgate', () => {
    frontages(W, lot, rng, northMain[0], northMain[1], 7, gen, fo('main'));
    polyFrontage(W, lot, rng, neRoad, 5.5, 1, gen, fo('main')); polyFrontage(W, lot, rng, neRoad, 5.5, -1, gen, fo('main'));
  });
  run('Ravensgate', () => { polyFrontage(W, lot, rng, nwRoad, 5.5, 1, gen, fo('main')); polyFrontage(W, lot, rng, nwRoad, 5.5, -1, gen, fo('main')); });
  run('Westgate', () => frontages(W, lot, rng, westMain[0], westMain[1], 6.5, gen, fo('main')));
  run('Eastbank', () => {
    frontages(W, lot, rng, eastMain[0], eastMain[1], 6, gen, fo('main'));
    polyFrontage(W, lot, rng, eastQuay, 3.6, -1, gen, fo('street', { setback: 0.2 }));     // houses face the river across the quay
    frontages(W, lot, rng, millSt[0], millSt[1], 4.4, gen, fo('street'));
    frontages(W, lot, rng, fishSt[0], fishSt[1], 4.4, gen, fo('street'));
    frontages(W, lot, rng, abbeyLane[0], abbeyLane[1], 4.2, gen, fo('street'));
    frontages(W, lot, rng, woolSt[0], woolSt[1], 4.2, gen, fo('lane'));
    polyFrontage(W, lot, rng, lakeN, 4.6, 1, gen, fo('street')); polyFrontage(W, lot, rng, lakeN, 4.6, -1, gen, fo('street'));
    frontages(W, lot, rng, northShore[0], northShore[1], 4.2, gen, fo('lane'));
    for (const sq of [emk]) squareRows(sq, 'main');
  });
  run('Lakeside', () => {
    frontages(W, lot, rng, lakeMain[0], lakeMain[1], 5.6, gen, fo('main'));
    polyFrontage(W, lot, rng, lowQuay, 3.6, 1, gen, fo('street', { setback: 0.2 }));
    frontages(W, lot, rng, lakeSt2[0], lakeSt2[1], 4.4, gen, fo('street'));
    frontages(W, lot, rng, lakeLane[0], lakeLane[1], 4, gen, fo('lane'));
    frontages(W, lot, rng, southLane[0], southLane[1], 4, gen, fo('lane'));
  });
  run('squares', () => { squareRows(hay, 'main'); squareRows(wmk, 'main'); });
  run('ring1', () => polyFrontage(W, lot, rng, ring1, 7, -1, gen, fo('street')));
  run('ring2', () => { polyFrontage(W, lot, rng, ring2, 5, 1, gen, fo('street')); polyFrontage(W, lot, rng, ring2, 5, -1, gen, fo('street')); });
  run('radials', () => { for (const r of radials) frontages(W, lot, rng, r[0], r[1], 4.4, gen, fo('street')); frontages(W, lot, rng, swLane[0], swLane[1], 4, gen, fo('lane')); });
  run('ring3', () => { polyFrontage(W, lot, rng, ring3, 4.6, 1, gen, fo('lane')); polyFrontage(W, lot, rng, ring3, 4.6, -1, gen, fo('lane')); });
  run('outer', () => { for (const pl of [outerW, outerN]) { polyFrontage(W, lot, rng, pl, 4, 1, gen, fo('lane')); polyFrontage(W, lot, rng, pl, 4, -1, gen, fo('lane')); } });
  // back lanes: rings round the city every few metres, each lined wherever it finds room left between the rows
  run('lanes', () => { const paths = []; for (let r = 104; r <= 240; r += 6) paths.push(arc(CX, CZ, r, 0, TAU, 1)); backLanes(W, lot, rng, paths, 3.4, gen, fo('lane', { seq: true, minLen: 12 })); });
  // back houses: detached cottages, workshops and inns in what is left of the blocks behind the street rows
  run('infill', () => {
    const ri = makeRng(4409);
    scatter(lot, ri, {
      tries: 5000, max: 90, cx: 15, cz: -40, r: 215, m: 0.5,
      gen: (r) => { const u = unit(r, CLS.lane); return { ...u, w: 5.5 + r() * 3.5, d: 5.8 + r() * 2.4, floors: r() < 0.45 ? 1 : 2 }; },
      yaw: (x, z, r) => faceYaw(CX - x, CZ - z) + (r() < 0.5 ? 0 : Math.PI / 2) + (r() - 0.5) * 0.08,
      place: (u, x, z, yaw) => bigHouse({ x, z, yaw, w: u.w, d: u.d, floors: u.floors, fh: 2.75, color: u.color, roof: u.roof, ground: u.ground, ridge: u.ridge, pitch: u.pitch, pat: u.pat, lit: u.lit, sideWin: true, groundTimber: u.groundTimber, roofOpts: { gableFeat: u.gableFeat, ov: 0.4, ovL: 0.45 } }),
    });
  });

  // rows facing a square from all four sides
  function squareRows(sq, cls) {
    const F = frame(sq.x, sq.z, sq.yaw), c = [F.at(-sq.hw, -sq.hd), F.at(sq.hw, -sq.hd), F.at(sq.hw, sq.hd), F.at(-sq.hw, sq.hd)];
    for (let i = 0; i < 4; i++) frontage(W, lot, rng, c[i], c[(i + 1) % 4], 0, -1, gen, fo(cls, { start: 0.2, endTrim: 0.2 }));
  }
  function gen(r, o) { return unit(r, o); }

  W.boroughStats = stats; W.landmarks = lm;
  const nb = Object.values(stats).reduce((n, s) => n + s.bodies, 0), nh = Object.values(stats).reduce((n, s) => n + s.houses, 0);
  console.log(`[game] boroughs: ${nh} houses, ${nb} bodies in ${(performance.now() - t0).toFixed(0)} ms`);
}
