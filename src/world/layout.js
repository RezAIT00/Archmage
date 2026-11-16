// World layout: shared by the terrain (flattening, lakes, ground cover), the settlement builders,
// the forests and the director. The playable world is a ~1 km square of rolling country.
//
//   +X east, +Z south, y up. The capital sits near the origin; the player starts on a cliff-top
//   overlook just south of it. Everything else (towns, villages, castle, farms...) is listed in
//   SITES so the terrain flattens the ground under it, paves it and keeps trees/grass off it.
import { fbm2, smoothstep, sat } from '../core/util.js';

export const TERRAIN_SIZE = 1024;
export const WORLD_R = 470;                      // the player is kept inside this radius
export const ARENA = { x: 0, z: 0, r: WORLD_R };
export const CITY = { id: 'capital', x: 0, z: -26, wallR: 84, flatR: 93 };
export const OVERLOOK = { x: 0, z: 104, r: 10, dh: 18 };
export const SPAWN = { x: 0, z: 95.4, yaw: 0, pitch: -12 };

// Building sites. The terrain is flattened to one height inside `r` and blends back to the natural
// ground over `blend` metres. `h` (ground height) is filled in by the terrain at start-up, so
// builders must read it at build time (site.h), never at import time.
//   pave: 0..1 cobblestones inside paveR (default r)   dirt: 0..1 bare earth inside r (villages/farms)
//   rel:  {to: siteId, dh}  -> height is defined relative to another site
//   dh:   metres above (+) or below (-) the natural ground at the centre
export const SITES = [
  { id: 'capital', x: CITY.x, z: CITY.z, r: CITY.flatR, blend: 22, pave: 1, paveR: CITY.wallR },
  { id: 'overlook', x: OVERLOOK.x, z: OVERLOOK.z, r: OVERLOOK.r, blend: 30, rel: { to: 'capital', dh: OVERLOOK.dh }, dirt: 0.6 },
  // --- more settlements are appended by src/world/settlements.js ---
];

// Lakes: a bowl is carved into the terrain and filled with water up to `level` (filled in by the terrain).
export const LAKES = [
  { id: 'mirrormere', x: 205, z: 70, r: 62, depth: 7, up: 1.0 },
  { id: 'tarn', x: -300, z: -250, r: 40, depth: 5 },
];

// ---- Flowing water ---------------------------------------------------------------------------------
// Greywater is a reservoir on a hill in the north-east, held back by a masonry dam. The river Aldwater
// spills over the dam, runs south past the capital's east wall and empties into Mirrormere. All of it is
// real simulated water (src/world/water.js): blow the dam and the valley floods.
// Elevations (level, floor, rim, bed0, damBed) are filled in by the terrain at start-up, so read them
// at build time, never at import time.
export const RESERVOIR = { id: 'greywater', x: 165, z: -340, r: 64, depth: 12, rise: 13.5, rimUp: 3.0, moundR: 151 };
export const RIVER = {
  id: 'aldwater', half: 6.5, slope: 0.008, depth: 1.0,
  // control points [x, z], from inside the reservoir, through the dam gorge, past the city, into Mirrormere
  ctrl: [[149, -306], [133, -281], [124, -250], [118, -205], [112, -155], [108, -105], [111, -55], [122, -12], [146, 18], [172, 42]],
  damCtrl: 1,                                          // the dam stands on this control point
  // elevation of the river bed / the design water surface, `u` metres upstream of the mouth
  bedAt(u) { return u > this.uDam ? RESERVOIR.floor : this.bed0 + this.slope * u; },
  surfAt(u) { return u > this.uDam ? RESERVOIR.level : this.bed0 + this.slope * u + this.depth; },
};
{ // resample the centre line (Catmull-Rom) every ~3 m; u = distance upstream of the mouth
  const c = RIVER.ctrl, P = (i) => c[Math.max(0, Math.min(c.length - 1, i))], xs = [], zs = [], seg = [];
  for (let i = 0; i < c.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2), n = Math.max(2, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      xs.push(0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3));
      zs.push(0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3));
      seg.push(i);
    }
  }
  xs.push(c[c.length - 1][0]); zs.push(c[c.length - 1][1]); seg.push(c.length - 1);
  const n = xs.length, cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  RIVER.xs = xs; RIVER.zs = zs; RIVER.len = cum[n - 1];
  RIVER.us = Array.from(cum, (v) => cum[n - 1] - v);
  RIVER.uDam = RIVER.us[seg.indexOf(RIVER.damCtrl)];
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]); z0 = Math.min(z0, zs[i]); z1 = Math.max(z1, zs[i]); }
  RIVER.box = [x0, z0, x1, z1];
}
// Nearest point of the river to (x, z): { d: metres from the centre line, u: metres upstream of the mouth,
// tx, tz: unit direction of flow }. Returns null when further than `reach` from the river.
export function riverAt(x, z, reach = 60) {
  const b = RIVER.box; if (x < b[0] - reach || x > b[2] + reach || z < b[1] - reach || z > b[3] + reach) return null;
  const xs = RIVER.xs, zs = RIVER.zs, us = RIVER.us; let best = 1e18, bi = 0, bt = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const ax = xs[i], az = zs[i], abx = xs[i + 1] - ax, abz = zs[i + 1] - az;
    const t = sat(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz + 1e-9)), ex = x - ax - abx * t, ez = z - az - abz * t, d2 = ex * ex + ez * ez;
    if (d2 < best) { best = d2; bi = i; bt = t; }
  }
  if (best > reach * reach) return null;
  const tx = xs[bi + 1] - xs[bi], tz = zs[bi + 1] - zs[bi], l = Math.hypot(tx, tz) || 1;
  return { d: Math.sqrt(best), u: us[bi] + (us[bi + 1] - us[bi]) * bt, tx: tx / l, tz: tz / l, x: xs[bi] + tx * bt, z: zs[bi] + tz * bt };
}
// the dam: centre, the direction the river flows through it, and its elevations (toe / crest filled in by the terrain)
export const DAM = (() => {
  const i = RIVER.us.indexOf(RIVER.uDam), tx = RIVER.xs[i + 1] - RIVER.xs[i - 1], tz = RIVER.zs[i + 1] - RIVER.zs[i - 1], l = Math.hypot(tx, tz);
  return { x: RIVER.xs[i], z: RIVER.zs[i], tx: tx / l, tz: tz / l, thick: 5.0, u: RIVER.uDam };
})();

// Roads: dirt tracks painted on the ground (and kept clear of trees). pts are [x, z].
export const ROADS = [
  { pts: [[0, 58], [3, 74], [0, 92]], w: 2.6 },           // south gate up to the overlook
];

export const site = (id) => SITES.find((s) => s.id === id);

// distance from point to polyline
function roadDist(x, z, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const abx = bx - ax, abz = bz - az, t = sat(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz + 1e-6));
    const d = Math.hypot(x - ax - abx * t, z - az - abz * t);
    if (d < best) best = d;
  }
  return best;
}
let _rb = null;
const roadBoxes = () => (_rb ||= ROADS.map((r) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of r.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0 - 8, z0 - 8, x1 + 8, z1 + 8]; }));

// ground cover: returns [paving, dirt] in 0..1 for a world position
export function groundCover(x, z) {
  let pave = 0, dirt = 0, n = null;
  for (const s of SITES) {
    const pr = s.paveR || s.r, R = pr + 14;
    const dx = x - s.x, dz = z - s.z;
    if (dx > R || dx < -R || dz > R || dz < -R) continue;
    const d = Math.hypot(dx, dz);
    if (n === null) n = fbm2(x * 0.14 + 9, z * 0.14 - 4, 3) * 2.4;
    if (s.pave) { pave = Math.max(pave, s.pave * smoothstep(pr + 2.5 + n, pr - 1.5 + n, d)); dirt = Math.max(dirt, smoothstep(pr + 9 + n * 1.6, pr + 1, d) * 0.9); }
    if (s.dirt) dirt = Math.max(dirt, s.dirt * smoothstep(s.r + 3 + n, s.r - 4, d));
  }
  const rb = roadBoxes();
  for (let i = 0; i < ROADS.length; i++) {
    const b = rb[i]; if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
    const wob = fbm2(x * 0.05, z * 0.05, 2) * 1.6;
    dirt = Math.max(dirt, smoothstep(ROADS[i].w + 1.2, ROADS[i].w * 0.35, roadDist(x, z, ROADS[i].pts) + wob) * 0.9);
  }
  return [pave, dirt];
}

// true if a point is inside (or within `margin` of) any site, road or lake: used to keep trees and rocks out
export function occupied(x, z, margin = 0) {
  for (const s of SITES) { const dx = x - s.x, dz = z - s.z, R = s.r + margin; if (dx * dx + dz * dz < R * R) return true; }
  for (const l of LAKES) { const dx = x - l.x, dz = z - l.z, R = l.r + 4 + margin; if (dx * dx + dz * dz < R * R) return true; }
  { const dx = x - RESERVOIR.x, dz = z - RESERVOIR.z, R = RESERVOIR.r + 6 + margin; if (dx * dx + dz * dz < R * R) return true; }
  { const rv = riverAt(x, z, RIVER.half + 6 + margin); if (rv) return true; }
  const rb = roadBoxes();
  for (let i = 0; i < ROADS.length; i++) { const b = rb[i]; if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue; if (roadDist(x, z, ROADS[i].pts) < ROADS[i].w + 2 + margin) return true; }
  return false;
}
