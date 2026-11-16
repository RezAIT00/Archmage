// The towns grow: new streets, terraces, chapels and barns round the old cores of the towns (built by towns.js),
// villages at the feet of Ravenscar and the abbey, and hamlets out in the empty country.
// Everything is planned on the pristine terrain with seeded RNGs (urban.js), so every rebuild is identical.
import { makeRng } from '../core/util.js';
import { SITES, ROADS } from './layout.js';
import { pickR, between, frame, faceYaw, tint, barrel, crate } from './kit.js';
import { Lot, arc, polyFrontage, scatter, backLanes, gridPaths } from './urban.js';
import { church, cross, well, windmill } from './towns.js';

const TAU = Math.PI * 2, D2R = Math.PI / 180;
const site = (id) => SITES.find((s) => s.id === id);
let XID = 20000;
export function resetTownIds() { XID = 20000; }

// ------------------------------------------------------------------ palettes (wanted average linear colours)
const R = (r, g, b) => tint('roof', r, g, b), P = (r, g, b) => tint('plaster', r, g, b), A = (r, g, b) => tint('ashlar', r, g, b);
const SLATE = R(0.105, 0.106, 0.11), SLATE_D = R(0.066, 0.067, 0.07), SLATE_B = R(0.09, 0.095, 0.106);
const THATCH = [R(0.27, 0.19, 0.08), R(0.22, 0.155, 0.065), R(0.3, 0.215, 0.095)];
const TILE_BROWN = R(0.2, 0.09, 0.05), TILE_DARK = R(0.13, 0.065, 0.04), COPPER = R(0.1, 0.19, 0.155);
const STONE_W = [A(0.3, 0.27, 0.22), A(0.34, 0.31, 0.26), A(0.27, 0.25, 0.22)];

//   floors: cumulative chances of 1, 2, 3, 4 storeys for [main streets, lanes]
const PAL = {
  westmarch: {
    walls: [P(0.3, 0.11, 0.07), P(0.4, 0.26, 0.1), P(0.42, 0.38, 0.28), P(0.27, 0.3, 0.22), P(0.42, 0.26, 0.22), P(0.25, 0.29, 0.33), P(0.38, 0.28, 0.08), P(0.33, 0.28, 0.34), P(0.4, 0.36, 0.3), P(0.36, 0.16, 0.1)],
    roofs: [R(0.24, 0.08, 0.035), R(0.2, 0.09, 0.05), R(0.28, 0.12, 0.05), R(0.16, 0.1, 0.08), R(0.3, 0.1, 0.04), TILE_DARK],
    floors: [[0, 0.3, 0.85, 1], [0.05, 0.55, 0.95, 1]], pitch: [50, 60], ridgeX: 0.3, ground: P(0.34, 0.31, 0.27), groundP: 0.4, timber: 0.3, w: [4.5, 6.4],
  },
  mirrormere: {
    walls: [P(0.42, 0.41, 0.38), P(0.3, 0.35, 0.42), P(0.2, 0.3, 0.3), P(0.42, 0.33, 0.15), P(0.4, 0.24, 0.17), P(0.3, 0.34, 0.27), P(0.36, 0.38, 0.42), P(0.22, 0.08, 0.06), P(0.18, 0.22, 0.3)],
    roofs: [SLATE, SLATE_D, SLATE_B, SLATE, TILE_DARK, R(0.17, 0.075, 0.045)],
    floors: [[0, 0.45, 1, 1], [0.1, 0.8, 1, 1]], pitch: [40, 48], ridgeX: 0.75, ground: P(0.3, 0.3, 0.3), groundP: 0.3, timber: 0.05, w: [4.8, 6.8],
  },
  barleyford: {
    walls: [P(0.44, 0.42, 0.37), P(0.42, 0.38, 0.28), P(0.42, 0.33, 0.28), P(0.4, 0.4, 0.34), P(0.44, 0.38, 0.24)],
    roofs: THATCH, floors: [[0.55, 1, 1, 1], [0.72, 1, 1, 1]], pitch: [52, 58], ridgeX: 1, timber: 1, w: [5.4, 7.6], ov: 0.5,
  },
  norbury: {
    walls: [P(0.38, 0.35, 0.3), P(0.42, 0.39, 0.32), P(0.34, 0.31, 0.27), P(0.44, 0.42, 0.37)],
    roofs: [TILE_BROWN, TILE_DARK, SLATE_D], floors: [[0.3, 1, 1, 1], [0.5, 1, 1, 1]], pitch: [45, 54], ridgeX: 0.6, stoneP: 0.45, w: [5, 7],
  },
  tarnside: {
    walls: [P(0.4, 0.39, 0.36), P(0.36, 0.33, 0.28), P(0.3, 0.32, 0.33), P(0.42, 0.4, 0.34), P(0.24, 0.27, 0.3)],
    roofs: [...THATCH, SLATE_D, SLATE], floors: [[0.7, 1, 1, 1], [0.7, 1, 1, 1]], pitch: [46, 56], ridgeX: 1, w: [5, 6.6], ov: 0.45,
  },
  greystone: {
    walls: [P(0.36, 0.35, 0.33), P(0.3, 0.3, 0.29)], roofs: [SLATE_D, SLATE, SLATE_B], floors: [[0.45, 1, 1, 1], [0.6, 1, 1, 1]], pitch: [40, 48], ridgeX: 0.85, stoneP: 0.8, w: [5, 6.6],
  },
  ravensford: {
    walls: [P(0.4, 0.36, 0.3), P(0.36, 0.3, 0.24), P(0.42, 0.4, 0.35), P(0.3, 0.26, 0.22)],
    roofs: [TILE_BROWN, TILE_DARK, SLATE_D, ...THATCH], floors: [[0.25, 0.85, 1, 1], [0.5, 1, 1, 1]], pitch: [48, 56], ridgeX: 0.7, stoneP: 0.3, timber: 0.5, w: [5, 7],
  },
  abbotsbury: {
    walls: [P(0.44, 0.42, 0.37), P(0.42, 0.38, 0.3), P(0.4, 0.4, 0.36), P(0.43, 0.36, 0.26)],
    roofs: [TILE_BROWN, R(0.24, 0.1, 0.05), ...THATCH], floors: [[0.35, 0.95, 1, 1], [0.6, 1, 1, 1]], pitch: [48, 56], ridgeX: 0.8, stoneP: 0.25, timber: 0.4, w: [5, 7],
  },
  hamlet: {
    walls: [P(0.44, 0.42, 0.37), P(0.42, 0.38, 0.28), P(0.4, 0.4, 0.34), P(0.38, 0.35, 0.3)],
    roofs: [...THATCH, ...THATCH, TILE_BROWN, SLATE_D], floors: [[0.7, 1, 1, 1], [0.7, 1, 1, 1]], pitch: [50, 58], ridgeX: 0.9, stoneP: 0.2, timber: 0.6, w: [5.2, 7.4], ov: 0.45,
  },
};
const storeys = (f, cum) => { for (let i = 0; i < cum.length; i++) if (f < cum[i]) return i + 1; return cum.length; };
function unit(r, pal, main) {
  const stone = pal.stoneP && r() < pal.stoneP;
  return {
    w: between(r, pal.w[0], pal.w[1]), floors: storeys(r(), pal.floors[main ? 0 : 1]),
    mat: stone ? 'ashlar' : 'plaster', color: stone ? pickR(r, STONE_W) : pickR(r, pal.walls), gable: stone ? P(0.32, 0.29, 0.24) : null,
    roof: pickR(r, pal.roofs), ridge: r() < pal.ridgeX ? 'x' : 'z', pitch: between(r, pal.pitch[0], pal.pitch[1]),
    pat: stone ? 0 : r() < 0.3 ? 0 : 1 + ((r() * 3) | 0), lit: 0.3 + r() * 0.5, groundTimber: !stone && r() < (pal.timber || 0),
    ground: !stone && pal.ground && r() < pal.groundP ? pal.ground : null, sideWin: r() < 0.5, tallWin: r() < 0.08, gableFeat: r() < 0.4 ? 4 : 0, ov: pal.ov,
  };
}
// street classes: house depth, storey heights, how many houses run together before an alley
const CLS = {
  main: { main: true, depth: (r) => 7.4 + r() * 1.6, fh: (r) => [3.0 + r() * 0.2, 2.8], maxRun: 6, breakP: 0.1, gap: (r) => 1.3 + r() * 1.8 },
  lane: { main: false, depth: (r) => 6.2 + r() * 1.4, fh: (r) => [2.8, 2.7], maxRun: 4, breakP: 0.2, gap: (r) => 1.5 + r() * 2.4 },
  row: { main: false, depth: (r) => 5.4 + r() * 1.2, fh: (r) => [2.75, 2.65], maxRun: 3, breakP: 0.25, gap: (r) => 1.6 + r() * 1.8 },
  pair: { main: false, depth: (r) => 5.4 + r() * 1.2, fh: (r) => [2.75, 2.65], maxRun: 2, breakP: 0.45, gap: (r) => 2.2 + r() * 3.2 },
  cottage: { main: false, depth: (r) => 5.0 + r() * 1.2, fh: (r) => [2.7, 2.6], maxRun: 1, breakP: 1, gap: (r) => 2.6 + r() * 4.5 },
};

// ------------------------------------------------------------------ the planner
// discs: the flat ground the new streets may use; coreR: keep out of the old town; avoid: [{x, z, r}]
function planner(W, id, o) {
  const core = W.townCtx?.[id], rng = makeRng(o.seed), tag = id, y0 = o.y0, out = (W.townHouses ||= []);
  const inDiscs = (x, z) => o.discs.some((d) => Math.hypot(x - d.x, z - d.z) < d.r - 0.8);
  const mask = (x, z) => inDiscs(x, z) && !(o.coreR && Math.hypot(x - o.cx, z - o.cz) < o.coreR) && !(o.avoid || []).some((a) => Math.hypot(x - a.x, z - a.z) < a.r);
  const lot = new Lot({ y0, tol: 0.06, mask });
  // the old town's buildings (its street reservations run on far past its edge, so they are left out: the mask keeps
  // the new streets out of the old town anyway)
  if (core) for (const p of core.plot.items) lot.take(p);
  // the realm's tracks through the new streets stay open: they become streets themselves (roadRows)
  const near = (a, b) => o.discs.some((d) => segDist(d.x, d.z, a, b) < d.r + 2);
  const roads = [];
  for (const rd of ROADS) for (let i = 0; i < rd.pts.length - 1; i++) {
    const a = rd.pts[i], b = rd.pts[i + 1];
    if (!near(a, b)) continue;
    const w = rd.w * 2 + 0.8; lot.street(a[0], a[1], b[0], b[1], w); roads.push([a, b, w]);
  }
  const ctx = { W, y0, rng, tag, houses: [], site: { x: o.cx, z: o.cz, r: 0 } };
  const gen = (r, c) => unit(r, o.pal, c.main);
  const fo = (cls, extra = {}) => ({ ...cls, y0, tag, nextId: () => XID++, out, ctx: cls, ...extra });
  const T = {
    lot, rng, ctx, y0, tag, n0: out.length, lm: {}, stats: [],
    street(pts, w) { lot.poly(pts, w); return pts; },
    rows(pts, w, cls, sides = [1, -1], extra) { let n = 0; for (const s of sides) n += polyFrontage(W, lot, rng, pts, w, s, gen, fo(cls, extra)); T.stats.push(n); return n; },
    // back lanes wherever there is room left (candidate paths a few metres apart, each lined before the next)
    lanes(paths, w, cls, extra = {}) { const n = backLanes(W, lot, rng, paths, w, gen, fo(cls, { seq: true, minLen: 10, ...extra })); T.stats.push('lanes', n); return n; },
    roadRows(cls) { let n = 0; for (const [a, b, w] of roads) for (const s of [1, -1]) n += polyFrontage(W, lot, rng, [a, b], w, s, gen, fo(cls)); T.stats.push('roads', n); return n; },
    // the preferred spot, else the nearest free one on a little spiral round it
    spot(fpAt, x, z, yaw, reach = 14) {
      for (let k = 0; k < 160; k++) {
        const a = k * 2.4, r = k === 0 ? 0 : Math.sqrt(k) * (reach / Math.sqrt(160)), px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        for (const yy of [yaw, yaw + Math.PI / 2]) { const fp = fpAt(px, pz, yy); if (lot.fits(fp, 0.3)) { lot.take(fp); return [px, pz, yy]; } }
      }
      return null;
    },
    // a single (lean) building: inn, barn, hall...
    big(s, x, z, yaw, reach = 16) {
      const p = T.spot((px, pz, yy) => ({ x: px, z: pz, hw: s.w / 2 + 0.6, hd: s.d / 2 + 0.6, yaw: yy }), x, z, yaw, reach);
      if (!p) return null;
      const h = { id: XID++, y0, tag, lean: true, t: 0.45, fh: 2.9, pat: 1, lit: 0.6, sideWin: true, ...s, x: p[0], z: p[1], yaw: p[2], roofOpts: { gableFeat: 4, ov: 0.42, ovL: 0.45, ...(s.roofOpts || {}) } };
      W.house(h); out.push(h);
      return [+h.x.toFixed(1), +h.z.toFixed(1)];
    },
    chapel(x, z, yaw, co, reach = 14) {
      const fpAt = (px, pz, yy) => churchFp(px, pz, yy, co);
      const p = T.spot(fpAt, x, z, yaw, reach); if (!p) return null;
      church({ ...ctx }, p[0], p[1], p[2], co);
      return [+p[0].toFixed(1), +p[1].toFixed(1)];
    },
    mill(x, z, reach = 10) {
      const p = T.spot((px, pz) => ({ circle: true, x: px, z: pz, r: 8.5 }), x, z, 0, reach); if (!p) return null;
      windmill({ ...ctx }, p[0], p[1], y0, faceYaw(o.cx - p[0], o.cz - p[1]) + 0.4, {});
      return [+p[0].toFixed(1), +p[1].toFixed(1)];
    },
    well(x, z) { const fp = { circle: true, x, z, r: 1.6 }; if (!lot.fits(fp, 0.2)) return false; lot.take(fp); well(W, x, z, y0, tag); return true; },
    cross(x, z) { const fp = { circle: true, x, z, r: 1.4 }; if (!lot.fits(fp, 0.2)) return false; lot.take(fp); cross(W, x, z, y0, tag, {}); return true; },
    infill(n, tries, cx = o.cx, cz = o.cz, r = 60, yawF) {
      const k = scatter(lot, rng, {
        tries, max: n, cx, cz, r, m: 0.5,
        gen: (rr) => { const u = unit(rr, o.pal, false); return { ...u, w: between(rr, 5, 7), d: between(rr, 4.8, 6.2), floors: rr() < 0.6 ? 1 : 2 }; },
        yaw: yawF || ((x, z, rr) => faceYaw(o.cx - x, o.cz - z) + (rr() < 0.5 ? 0 : Math.PI / 2)),
        place: (u, x, z, yaw) => { const h = { id: XID++, x, z, yaw, y0, tag, lean: true, t: 0.4, w: u.w, d: u.d, floors: u.floors, fh: 2.7, mat: u.mat, color: u.color, gable: u.gable, roof: u.roof, ground: u.ground, ridge: u.ridge, pitch: u.pitch, pat: u.pat, lit: u.lit, sideWin: true, groundTimber: u.groundTimber, roofOpts: { gableFeat: u.gableFeat, ov: 0.4, ovL: 0.4 } }; W.house(h); out.push(h); },
      });
      T.stats.push('infill', k); return k;
    },
    // barrels and crates by some of the new front doors
    props(frac = 0.25) {
      for (let i = T.n0; i < out.length; i++) {
        const h = out[i]; if (rng() > frac || !h.d) continue;
        const F = frame(h.x, h.z, h.yaw), side = rng() < 0.5 ? -1 : 1, [px, pz] = F.at(side * (h.w / 2 - 0.55), h.d / 2 + 0.95);
        const fp = { circle: true, x: px, z: pz, r: 0.5 }; if (!lot.free(fp, 0.05, true)) continue;
        if (rng() < 0.55) barrel(px, y0, pz, rng, tag); else crate(px, y0, pz, rng, tag);
      }
    },
    done() {
      (W.townRowStats ||= {})[id] = T.stats; return out.length - T.n0;
    },
  };
  return T;
}
function segDist(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2));
  return Math.hypot(a[0] + dx * t - px, a[1] + dz * t - pz);
}
// footprint of a church built by towns.js church()
function churchFp(x, z, yaw, o) {
  const ts = o.tower ? o.tower.side : 0, x0 = -o.w / 2 - (o.tower ? 0.25 + ts : 0) - 0.4, x1 = o.w / 2 + 0.45, F = frame(x, z, yaw), [fx, fz] = F.at((x0 + x1) / 2, 0);
  return { x: fx, z: fz, hw: (x1 - x0) / 2 + 0.6, hd: o.d / 2 + 1.0, yaw };
}
const polar = (cx, cz, r, a) => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];

// ================================================================== WESTMARCH: a belt of new streets round the old town
export function growWestmarch(W) {
  const S = site('westmarch'), cx = S.x, cz = S.z, yaw0 = 0.12, F = frame(cx, cz, yaw0), L = (u, v) => F.at(u, v);
  const T = planner(W, 'westmarch', { y0: S.h, cx, cz, coreR: S.core - 1.5, discs: [S], seed: 9101, pal: PAL.westmarch });
  // the town's cross and diagonal lanes run on out through the belt; a ring street round the old town, a lane at the edge
  const radial = (a, r0, r1) => [L(Math.cos(a) * r0, Math.sin(a) * r0), L(Math.cos(a) * r1, Math.sin(a) * r1)];
  // (east, the road from the capital is the main street, so no new radial there)
  const rads = [[Math.PI, 5.0, 'main'], [Math.PI / 2, 4.4, 'lane'], [-Math.PI / 2, 4.4, 'lane']];
  for (const a of [45, 135, 225, 315]) rads.push([a * D2R, 3.6, 'lane']);
  for (const [a, w] of rads) T.street(radial(a, 55, 79.5), w);
  const ring1 = T.street(arc(cx, cz, 57.6, 0, TAU, 22), 4.4), ring2 = T.street(arc(cx, cz, 78.2, 0, TAU, 24), 3.2);
  // landmarks: St Martin's, the coaching inn on the road to the capital, a tithe barn, the windmill, the horse fair
  const at = (deg, r) => L(Math.cos(deg * D2R) * r, Math.sin(deg * D2R) * r), tang = (deg) => yaw0 + Math.PI / 2 - deg * D2R;
  T.lm.stmartin = T.chapel(...at(202, 67.5), tang(202) + Math.PI / 2, { w: 13, d: 8.4, tiers: 2, th: 4.2, t: 0.7, stone: A(0.38, 0.32, 0.24), roof: SLATE_D, glass: true, tower: { side: 4.8, layers: 12, lh: 1.5, spire: 10, spireColor: SLATE_D } });
  T.lm.inn = T.big({ w: 14, d: 9, floors: 3, fh: 3.0, color: P(0.42, 0.36, 0.24), ground: P(0.32, 0.29, 0.25), roof: TILE_DARK, ridge: 'x', pitch: 52, pat: 3, lit: 0.9, tallWin: true }, ...at(15, 67), tang(15) + Math.PI);
  T.lm.barn = T.big({ w: 17, d: 8.5, floors: 1, fh: 4.6, mat: 'wood', color: [0.46, 0.36, 0.28], gable: P(0.16, 0.11, 0.08), roof: THATCH[1], ridge: 'x', pitch: 50, pat: 1, lit: 0, backWin: false, sideWin: false }, ...at(247, 67), tang(247));
  { const [fx, fz] = at(67, 66.5); T.lot.take({ x: fx, z: fz, hw: 9, hd: 6.5, yaw: tang(67) }); T.cross(fx, fz); T.well(...F.at(Math.cos(67 * D2R) * 66.5 + 4, Math.sin(67 * D2R) * 66.5 + 2)); T.lm.horsefair = [+fx.toFixed(1), +fz.toFixed(1)]; }
  // terraces: the main street east and west first, the ring, the other radials, the edge lane, then the tracks
  for (const [a, w, c] of rads) T.rows(radial(a, 55, 79.5), w, c === 'main' ? CLS.main : CLS.lane);
  T.rows(ring1, 4.4, CLS.lane, [-1, 1]);
  T.rows(ring2, 3.2, CLS.pair, [1, -1]);
  T.roadRows(CLS.lane);
  // back lanes in the gaps the rows left
  T.lanes(Array.from({ length: 7 }, (_, i) => arc(cx, cz, 60 + i * 3, 0, TAU, 1)), 3.0, CLS.pair);
  T.infill(30, 2500, cx, cz, 80);
  T.props(0.25);
  W.townLandmarks.westmarch = T.lm;
  return T.done();
}

// ================================================================== MIRRORMERE: the town climbs back from the lake shore
export function growMirrormere(W) {
  const S = site('mirrormere'), E = site('mm_east'), N = site('mm_north'), cx = S.x, cz = S.z;
  const T = planner(W, 'mirrormere', { y0: S.h, cx, cz, coreR: S.r + 0.5, discs: [S, E, N], seed: 9202, pal: PAL.mirrormere });
  const eastSt = T.street([[349, 52], [366, 47], [379, 43]], 4.6);
  const chapelRow = T.street([[351, 17], [350, 60], [347, 106]], 4.2);
  const northLane = T.street([[322, 92], [368, 84]], 3.6);
  T.lm.stnicholas = T.chapel(366, 26, -0.25, { w: 11, d: 7, tiers: 1, th: 5.4, stone: A(0.36, 0.36, 0.34), roof: SLATE, tower: { side: 3.8, layers: 10, lh: 1.45, spire: 8, spireColor: COPPER } });
  T.lm.netloft = T.big({ w: 11, d: 6.5, floors: 2, fh: 3.0, mat: 'wood', color: [0.44, 0.36, 0.3], gable: P(0.16, 0.11, 0.08), roof: SLATE_D, ridge: 'x', pitch: 40, pat: 1, lit: 0.3, sideWin: false }, 358, 94, -0.17);
  T.lm.market = (T.cross(352, 66), [352, 66]);
  T.rows(eastSt, 4.6, CLS.main);
  T.rows(chapelRow, 4.2, CLS.lane);
  T.rows(northLane, 3.6, CLS.lane);
  T.roadRows(CLS.lane);
  T.lanes(gridPaths(354, 62, 52, Math.atan2(43, -1), 5, 2), 3.2, CLS.lane);
  T.lanes(gridPaths(354, 62, 52, Math.atan2(-8, 46), 5, 1), 3.0, CLS.pair);
  T.infill(14, 1200, 350, 62, 50);
  T.props(0.3);
  W.townLandmarks.mirrormere = T.lm;
  return T.done();
}

// ================================================================== BARLEYFORD: Westbrook and Southend
export function growBarleyford(W) {
  const S = site('barleyford'), Bw = site('bf_west'), Bs = site('bf_south');
  const T = planner(W, 'barleyford', { y0: S.h, cx: S.x, cz: S.z, coreR: S.r - 1.5, discs: [S, Bw, Bs], seed: 9303, pal: PAL.barleyford, avoid: [{ x: -167, z: 112, r: 45 }] });
  const millLane = T.street([[-262, 194], [-267, 240]], 3.6), westBack = T.street([[-240, 223], [-284, 210]], 3.4);
  const southSt = T.street([[-229, 243], [-197, 256]], 3.6), southBack = T.street([[-213, 231], [-215, 264]], 3.2);
  T.lm.barn = T.big({ w: 12, d: 7, floors: 1, fh: 4.2, mat: 'wood', color: [0.46, 0.36, 0.28], gable: P(0.16, 0.11, 0.08), roof: THATCH[2], ridge: 'x', pitch: 52, pat: 1, lit: 0, backWin: false, sideWin: false }, -275, 226, 0.3);
  T.lm.smithy = T.big({ w: 8, d: 6.5, floors: 1, fh: 3.2, mat: 'ashlar', color: A(0.3, 0.27, 0.23), gable: P(0.3, 0.27, 0.22), roof: SLATE_D, ridge: 'x', pitch: 46, pat: 0, lit: 0.8 }, -201, 241, -0.4);
  T.well(-255, 205);
  T.rows(millLane, 3.6, CLS.pair); T.rows(westBack, 3.4, CLS.pair);
  T.rows(southSt, 3.6, CLS.row); T.rows(southBack, 3.2, CLS.pair);
  T.roadRows(CLS.pair);
  T.lanes(gridPaths(-240, 226, 56, Math.atan2(13, 32), 5), 3.0, CLS.pair);
  T.infill(8, 900, -236, 230, 40);
  T.props(0.35);
  W.townLandmarks.barleyford = T.lm;
  return T.done();
}

// ================================================================== NORBURY: a back lane round the village
export function growNorbury(W) {
  const S = site('norbury'), NB = site('nb_west');
  const T = planner(W, 'norbury', { y0: S.h, cx: S.x, cz: S.z, coreR: S.core - 1.2, discs: [S, NB], seed: 9404, pal: PAL.norbury });
  const ring = T.street(arc(S.x, S.z, 31.6, 0, TAU, 19), 3.2);
  // Westend: a street out from the ring
  const wx = NB.x - S.x, wz = NB.z - S.z, wl = Math.hypot(wx, wz), westSt = T.street([[S.x + (wx / wl) * 31.6, S.z + (wz / wl) * 31.6], [NB.x + (wx / wl) * 14, NB.z + (wz / wl) * 14]], 3.8);
  T.lm.barn = T.big({ w: 13, d: 6.4, floors: 1, fh: 4.0, mat: 'wood', color: [0.45, 0.35, 0.27], gable: P(0.16, 0.11, 0.08), roof: TILE_BROWN, ridge: 'x', pitch: 50, pat: 1, lit: 0, backWin: false, sideWin: false }, NB.x + (wz / wl) * 9, NB.z - (wx / wl) * 9, Math.atan2(-wz, wx));
  T.rows(ring, 3.2, CLS.row, [1, -1]);
  T.rows(westSt, 3.8, CLS.lane);
  T.roadRows(CLS.cottage);
  T.lanes(gridPaths((S.x + NB.x) / 2, (S.z + NB.z) / 2, 64, Math.atan2(wz, wx), 5), 3.0, CLS.pair);
  T.infill(6, 600, S.x, S.z, 42);
  T.props(0.35);
  W.townLandmarks.norbury = T.lm;
  return T.done();
}

// ================================================================== TARNSIDE: Fellgate, up the lane from the shore
export function growTarnside(W) {
  const S = site('tarnside'), E = site('tn_east');
  const T = planner(W, 'tarnside', { y0: S.h, cx: S.x, cz: S.z, coreR: S.r - 1.0, discs: [S, E], seed: 9505, pal: PAL.tarnside });
  // (the Fellgate lane itself is one of the realm's tracks: roadRows lines it)
  const cross_ = T.street([[-234, -312], [-204, -300]], 3.0);
  T.roadRows(CLS.row); T.rows(cross_, 3.0, CLS.pair);
  T.well(-219, -303);
  T.lanes(gridPaths(-230, -296, 30, Math.atan2(12, 30), 5), 3.0, CLS.pair);
  T.infill(6, 600, E.x, E.z, 20);
  T.props(0.35);
  return T.done();
}

// ================================================================== GREYSTONE: quarrymen's cottages round the works
export function growGreystone(W) {
  const S = site('greystone'), GN = site('gs_north'), toRoad = Math.atan2(-S.z + 270, -S.x + 266), back = toRoad + Math.PI;
  const T = planner(W, 'greystone', { y0: S.h, cx: S.x, cz: S.z, coreR: S.core - 1.0, discs: [S, GN], seed: 9606, pal: PAL.greystone });
  // Quarry Row: a street of quarrymen's cottages out to the north-east
  const gx = GN.x - S.x, gz = GN.z - S.z, gl = Math.hypot(gx, gz), rowSt = T.street([[S.x + (gx / gl) * 31.2, S.z + (gz / gl) * 31.2], [GN.x + (gx / gl) * 12, GN.z + (gz / gl) * 12]], 3.4);
  const ring = T.street(arc(S.x, S.z, 31.2, back + 1.25, back + TAU - 1.25, 18), 3.0);
  T.rows(ring, 3.0, CLS.row, [-1, 1], { depth: (r) => 4.6 + r() * 0.7 });
  T.rows(rowSt, 3.4, CLS.lane, [1, -1], { depth: (r) => 5.0 + r() * 0.8 });
  T.roadRows(CLS.cottage);
  T.lanes(gridPaths((S.x + GN.x) / 2, (S.z + GN.z) / 2, 62, Math.atan2(gz, gx), 5), 3.0, CLS.pair, { depth: (r) => 4.6 + r() * 0.7 });
  T.infill(5, 600, S.x, S.z, 40);
  T.props(0.4);
  return T.done();
}

// ================================================================== RAVENSFORD: the road village under the castle
export function buildRavensford(W) {
  const S = site('ravensford'), d = [-0.561, 0.827], n = [0.827, 0.561], c = [S.x, S.z];
  const T = planner(W, 'ravensford', { y0: S.h, cx: S.x, cz: S.z, discs: [S], seed: 9707, pal: PAL.ravensford });
  const crossLane = T.street([[c[0] - n[0] * 19, c[1] - n[1] * 19], [c[0] + n[0] * 19, c[1] + n[1] * 19]], 3.4);
  T.lm.chapel = T.chapel(c[0] + n[0] * 9 + d[0] * 9, c[1] + n[1] * 9 + d[1] * 9, faceYaw(n[0], n[1]), { w: 9, d: 6, tiers: 1, th: 4.8, stone: A(0.32, 0.29, 0.25), roof: SLATE_D, tower: { side: 3.2, layers: 8, lh: 1.4, spire: 5.5, spireColor: SLATE_D } });
  T.lm.inn = T.big({ w: 12, d: 8, floors: 2, fh: 3.0, color: P(0.4, 0.34, 0.24), ground: P(0.32, 0.29, 0.25), roof: TILE_DARK, ridge: 'x', pitch: 50, pat: 3, lit: 0.9 }, c[0] - n[0] * 9 - d[0] * 8, c[1] - n[1] * 9 - d[1] * 8, faceYaw(n[0], n[1]));
  T.well(c[0] + n[0] * 3.6 - d[0] * 3.6, c[1] + n[1] * 3.6 - d[1] * 3.6);
  T.roadRows(CLS.pair);
  T.rows(crossLane, 3.4, CLS.cottage);
  T.lanes(gridPaths(S.x, S.z, 22, Math.atan2(d[1], d[0]), 5), 3.0, CLS.pair);
  T.infill(4, 400, S.x, S.z, 22);
  T.props(0.35);
  W.townLandmarks.ravensford = T.lm;
  return T.done();
}

// ================================================================== ABBOTSBURY: the abbey's village, with its grange barn
export function buildAbbotsbury(W) {
  const S = site('abbotsbury');
  const T = planner(W, 'abbotsbury', { y0: S.h, cx: S.x, cz: S.z, discs: [S], seed: 9808, pal: PAL.abbotsbury });
  const main = T.street([[211, -131], [251, -139]], 3.8), lane = T.street([[229, -154], [235, -114]], 3.2);
  T.lm.grange = T.big({ w: 12, d: 6.5, floors: 1, fh: 4.6, mat: 'ashlar', color: A(0.36, 0.33, 0.28), gable: P(0.34, 0.31, 0.26), roof: TILE_BROWN, ridge: 'x', pitch: 50, pat: 0, lit: 0, backWin: false, sideWin: false }, 243, -129, 0.2);
  T.lm.almshouses = T.big({ w: 12, d: 5.5, floors: 1, fh: 3.0, mat: 'ashlar', color: A(0.38, 0.35, 0.3), gable: P(0.36, 0.33, 0.27), roof: SLATE_D, ridge: 'x', pitch: 50, pat: 0, lit: 0.6, gableFeat: 4 }, 220.5, -124, Math.PI + 0.2);
  T.well(232, -132);
  T.rows(main, 3.8, CLS.lane); T.rows(lane, 3.2, CLS.pair);
  T.roadRows(CLS.pair);
  T.lanes(gridPaths(S.x, S.z, 22, Math.atan2(-8, 40), 5), 3.0, CLS.pair);
  T.infill(4, 400, S.x, S.z, 22);
  T.props(0.35);
  W.townLandmarks.abbotsbury = T.lm;
  return T.done();
}

// ================================================================== hamlets: a lane, a handful of cottages, a well
//   o: { yaw (direction of the lane), chapel, mill }
export function buildHamlet(W, id, seed, o = {}) {
  const S = site(id), dx = Math.cos(o.yaw || 0), dz = Math.sin(o.yaw || 0), Lr = S.r - 1.5;
  const T = planner(W, id, { y0: S.h, cx: S.x, cz: S.z, discs: [S], seed, pal: PAL.hamlet });
  const lane = T.street([[S.x - dx * Lr, S.z - dz * Lr], [S.x + dx * Lr, S.z + dz * Lr]], 3.4);
  if (o.chapel) T.lm.chapel = T.chapel(S.x - dz * 9, S.z + dx * 9, faceYaw(dz, -dx), { w: 8, d: 5.6, tiers: 1, th: 4.6, stone: A(0.33, 0.3, 0.26), roof: SLATE_D, tower: { side: 3.0, layers: 7, lh: 1.4, spire: 5, spireColor: SLATE_D } });
  if (o.mill) T.lm.windmill = T.mill(S.x + dz * 11.2, S.z - dx * 11.2);
  T.well(S.x + dz * 4.6 + dx * (o.mill ? 9 : 0), S.z - dx * 4.6 + dz * (o.mill ? 9 : 0));
  T.rows(lane, 3.4, CLS.cottage);
  T.roadRows(CLS.cottage);
  T.infill(3, 300, S.x, S.z, S.r);
  T.props(0.4);
  if (Object.keys(T.lm).length) W.townLandmarks[id] = T.lm;
  return T.done();
}
