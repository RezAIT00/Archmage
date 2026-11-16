// Street planning for dense built-up areas (the capital's outer boroughs, the bigger towns): a spatial index of
// building footprints with the site rules (flat ground, river banks, masks), and a filler that lines a street with
// terraced rows. Everything is decided with seeded RNGs and the pristine terrain, so every rebuild is identical.
import { riverAt, RIVER } from './layout.js';
import { obbHit, obbCorners, segBox, faceYaw, groundH, terrace } from './kit.js';

const TAU = Math.PI * 2;

// distance to the river's centre line, from a 2 m grid built once (riverAt walks the whole centre line per call)
let _rg = null;
export function riverDist(x, z) {
  if (!_rg) {
    const b = RIVER.box, m = 34, c = 2, x0 = b[0] - m, z0 = b[1] - m, nx = Math.ceil((b[2] - b[0] + 2 * m) / c) + 1, nz = Math.ceil((b[3] - b[1] + 2 * m) / c) + 1;
    const d = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const r = riverAt(x0 + i * c, z0 + j * c, 60); d[i + j * nx] = r ? r.d : 60; }
    _rg = { x0, z0, nx, nz, c, d };
  }
  const g = _rg, fx = (x - g.x0) / g.c, fz = (z - g.z0) / g.c;
  if (fx < 0 || fz < 0 || fx >= g.nx - 1 || fz >= g.nz - 1) return 99;
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, D = g.d, k = i + j * g.nx;
  return (D[k] * (1 - tx) + D[k + 1] * tx) * (1 - tz) + (D[k + g.nx] * (1 - tx) + D[k + g.nx + 1] * tx) * tz;
}

// Footprints are oriented boxes {x, z, hw, hd, yaw} or circles {circle, x, z, r} (see kit.js obbHit).
export class Lot {
  //   o: { y0: ground height the footprints must stand on, tol, mask(x, z) -> bool, riverMin: min distance to the river centre line }
  constructor(o = {}) {
    this.cell = 12; this.map = new Map(); this.stamp = 1;
    this.y0 = o.y0; this.tol = o.tol ?? 0.06; this.mask = o.mask || null; this.riverMin = o.riverMin ?? 0;
  }
  _box(o, m = 0) {
    if (o.circle) return [o.x - o.r - m, o.z - o.r - m, o.x + o.r + m, o.z + o.r + m];
    const cs = Math.abs(Math.cos(o.yaw)), sn = Math.abs(Math.sin(o.yaw)), ex = o.hw * cs + o.hd * sn + m, ez = o.hw * sn + o.hd * cs + m;
    return [o.x - ex, o.z - ez, o.x + ex, o.z + ez];
  }
  _each(b, fn) {
    const c = this.cell, i0 = Math.floor(b[0] / c), i1 = Math.floor(b[2] / c), j0 = Math.floor(b[1] / c), j1 = Math.floor(b[3] / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (fn((i + 4096) * 8192 + (j + 4096)) === false) return false;
    return true;
  }
  take(o) {
    o._s = 0;
    this._each(this._box(o), (k) => { let a = this.map.get(k); if (!a) this.map.set(k, (a = [])); a.push(o); });
    return o;
  }
  street(ax, az, bx, bz, w) { const o = segBox(ax, az, bx, bz, w, 0.5); o.street = true; return this.take(o); }
  poly(pts, w) { for (let i = 0; i < pts.length - 1; i++) this.street(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w); }
  // (noStreets: ignore the street strips, for things that stand in the street: kerbs, boats drawn up on a wharf)
  free(o, m = 0.1, noStreets = false) {
    const s = ++this.stamp;
    return this._each(this._box(o, m), (k) => {
      const a = this.map.get(k); if (!a) return true;
      for (const p of a) { if (p._s === s) continue; p._s = s; if (noStreets && p.street) continue; if (obbHit(o, p, m)) return false; }
      return true;
    });
  }
  pts(o) {
    if (o.circle) return [[o.x, o.z], [o.x + o.r, o.z], [o.x - o.r, o.z], [o.x, o.z + o.r], [o.x, o.z - o.r]];
    const c = obbCorners(o);
    return [...c, [o.x, o.z], [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2], [(c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2], [(c[2][0] + c[3][0]) / 2, (c[2][1] + c[3][1]) / 2], [(c[3][0] + c[0][0]) / 2, (c[3][1] + c[0][1]) / 2]];
  }
  ok(o) {
    for (const [x, z] of this.pts(o)) {
      if (this.mask && !this.mask(x, z)) return false;
      if (this.y0 !== undefined && Math.abs(groundH(x, z) - this.y0) > this.tol) return false;
      if (this.riverMin && riverDist(x, z) < this.riverMin) return false;
    }
    return true;
  }
  fits(o, m = 0.1) { return this.ok(o) && this.free(o, m); }
}

// points along an arc round (cx, cz), angles in radians, roughly every `step` metres
export function arc(cx, cz, r, a0, a1, step = 14) {
  const n = Math.max(1, Math.round((Math.abs(a1 - a0) * r) / step)), pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return pts;
}

// Line one side of the street A->B with terraced rows (side +1: left of the direction of travel, -1: right).
// The rows stop where something is in the way (another street, a landmark, a house, the edge of the flat ground,
// the river bank) and break into separate terraces every few houses, leaving alleys.
//   gen(rng, o) -> unit spec for terrace() (w, floors, colours ...)
//   o: { y0, depth(rng), setback, maxRun, minRun, breakP, gap(rng), start, endTrim, fh(rng) -> storey heights, tag, nextId,
//        out: array that receives the house records, ctx: passed to gen }
export function frontage(W, lot, rng, A, B, sw, side, gen, o) {
  const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz);
  if (L < 4) return 0;
  const ux = dx / L, uz = dz / L, nx = -uz * side, nz = ux * side, yaw = faceYaw(-nx, -nz), setback = o.setback ?? 0.25;
  const end = L - (o.endTrim ?? 0.4);
  let t = o.start ?? 0.4, run = [], d = o.depth(rng), placed = 0, fh = o.fh ? o.fh(rng) : 2.8;
  // the footprint includes the roof eaves (0.42 m), which stay clear of the street
  const flush = () => {
    if (run.length && run.length >= (o.minRun || 1)) {
      const t0 = run[0].t, t1 = run[run.length - 1].t + run[run.length - 1].u.w, tm = (t0 + t1) / 2, off = sw / 2 + setback + 0.42 + d / 2;
      const units = run.map((r) => r.u);
      // terrace() lays its units out along its local +x, which runs against the street direction on the left side
      if (side > 0) units.reverse();
      const recs = terrace(W, { x: A[0] + ux * tm + nx * off, z: A[1] + uz * tm + nz * off, yaw, y0: o.y0, d, fh, units, tag: o.tag, nextId: o.nextId });
      for (const r of recs) o.out.push(r);
      placed += recs.length;
    } else if (run.length) for (const r of run) r.fp.dead = true;
    run = []; d = o.depth(rng); fh = o.fh ? o.fh(rng) : fh;
  };
  while (t < end) {
    const u = gen(rng, o.ctx || {});
    if (t + u.w > end) { if (run.length) break; t += 1; continue; }
    const off = sw / 2 + setback + 0.42 + d / 2, along = t + u.w / 2;
    const fp = { x: A[0] + ux * along + nx * off, z: A[1] + uz * along + nz * off, hw: u.w / 2 - 0.02, hd: d / 2 + 0.42, yaw };
    if (!lot.fits(fp, 0.03)) { flush(); t += 1.1; continue; }
    lot.take(fp); run.push({ u, t, fp });
    t += u.w;
    if (run.length >= (o.maxRun || 7) || rng() < (o.breakP ?? 0.1)) { flush(); t += o.gap ? o.gap(rng) : 1.4 + rng() * 2.2; }
  }
  flush();
  return placed;
}
// both sides of a street
export const frontages = (W, lot, rng, A, B, sw, gen, o) => frontage(W, lot, rng, A, B, sw, 1, gen, o) + frontage(W, lot, rng, A, B, sw, -1, gen, o);
// one side of a polyline street (each straight piece filled separately)
export function polyFrontage(W, lot, rng, pts, sw, side, gen, o) {
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) n += frontage(W, lot, rng, pts[i], pts[i + 1], sw, side, gen, o);
  return n;
}

// Back lanes through what is left of a district. Each path is walked in 1 m steps and cut into the pieces where a
// lane of width w fits (flat ground, inside the mask, clear of buildings; it may cross or join streets). Pieces at
// least minLen long are all reserved first (so one lane's rows cannot take the next lane's line), then lined on both
// sides in chords of about `chord` metres.
//   paths: [[[x, z], ...], ...]; o: frontage() options plus { minLen, chord, sides, seq }
export function backLanes(W, lot, rng, paths, w, gen, o) {
  const minLen = o.minLen ?? 12, chord = o.chord ?? 18;
  const pieces = (pts) => {
    const sm = resample(pts, 1), out = [];
    let cur = [];
    const close = () => {
      if (cur.length - 1 >= minLen) {
        const n = Math.max(1, Math.round((cur.length - 1) / chord)), l = [];
        for (let i = 0; i <= n; i++) l.push(cur[Math.round(((cur.length - 1) * i) / n)]);
        out.push(l);
      }
      cur = [];
    };
    for (let i = 0; i < sm.length - 1; i++) {
      const box = segBox(sm[i][0], sm[i][1], sm[i + 1][0], sm[i + 1][1], w, 0.1);
      if (lot.ok(box) && lot.free(box, 0.1, true)) { if (!cur.length) cur.push(sm[i]); cur.push(sm[i + 1]); } else close();
    }
    close();
    return out;
  };
  let n = 0;
  const fill = (lanes) => {
    for (const l of lanes) lot.poly(l, w);
    for (const l of lanes) for (const s of o.sides || [1, -1]) n += polyFrontage(W, lot, rng, l, w, s, gen, o);
  };
  // seq: each path is cut and lined before the next is looked at (candidate paths closer together than two rows)
  if (o.seq) for (const p of paths) fill(pieces(p));
  else fill(paths.flatMap(pieces));
  return n;
}
// a polyline resampled every `step` metres (the corners are kept)
function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}
// parallel straight lines `sp` apart across a disc, running at angle `ang` (phase shifts them sideways)
export function gridPaths(cx, cz, r, ang, sp, phase = 0) {
  const ux = Math.cos(ang), uz = Math.sin(ang), nx = -uz, nz = ux, out = [];
  for (let off = -r + ((((phase + r) % sp) + sp) % sp); off <= r; off += sp) {
    const h = Math.sqrt(Math.max(0, r * r - off * off));
    if (h > 4) out.push([[cx + nx * off - ux * h, cz + nz * off - uz * h], [cx + nx * off + ux * h, cz + nz * off + uz * h]]);
  }
  return out;
}

// scatter single lean houses (or sheds) into what is left of the blocks
//   o: { tries, cx, cz, r, gen(rng) -> house spec, place(spec, x, z, yaw), yaw(x, z, rng), m }
export function scatter(lot, rng, o) {
  let n = 0;
  for (let i = 0; i < o.tries; i++) {
    const a = rng() * TAU, rad = Math.sqrt(rng()) * o.r, x = o.cx + Math.cos(a) * rad, z = o.cz + Math.sin(a) * rad;
    const s = o.gen(rng), yaw = o.yaw ? o.yaw(x, z, rng) : rng() * TAU;
    const fp = { x, z, hw: s.w / 2 + 0.4, hd: s.d / 2 + 0.4, yaw };
    if (!lot.fits(fp, o.m ?? 0.4)) continue;
    lot.take(fp); o.place(s, x, z, yaw); n++;
    if (o.max && n >= o.max) break;
  }
  return n;
}
