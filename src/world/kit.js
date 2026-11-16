// Building kit for the settlements outside the capital. Everything works in world coordinates and
// builds real rigid bodies through World.add() (struct) or G.physics.add() (loose props).
//
// Stability rules followed by every builder here (see the notes in city.js):
//   * walls are panels standing on flat ground or on a slab, never on a slope
//   * roofs are a single solid prism sitting on a slab / wall tops (World.roof)
//   * towers are stacked solid courses, never hollow rings
//   * nothing overlaps: every stacked piece leaves the 4 mm GAP
//   * things that cannot stand on their own (windmill sails, banners) are visuals attached to a body
//     and turn into loose debris once that body is disturbed
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, LAYER_SCENE } from '../core/globals.js';
import { TERRAIN_SIZE } from './layout.js';

export const GAP = 0.004;

// Ground height of the terrain as it was generated (before any spell deformed it). Builders plan with this so that
// rebuilding the realm always puts everything in the same place, whatever happened to the live heightfield.
export function groundH(x, z) {
  const T = G.terrain, H = T.original || T.heights, VN = Math.round(Math.sqrt(H.length)), N = VN - 1, cell = TERRAIN_SIZE / N, half = TERRAIN_SIZE / 2;
  const fx = (x + half) / cell, fz = (z + half) / cell;
  if (fx < 0 || fz < 0 || fx >= N || fz >= N) return T.natural(x, z);
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
  const a = H[i + j * VN], b = H[i + 1 + j * VN], c = H[i + (j + 1) * VN], d = H[i + 1 + (j + 1) * VN];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
// The physics collider samples the terrain every 2 m (the mesh every 1 m), so on uneven ground (river beds and
// banks) it can be higher than the mesh. Footings off the flat building sites stand on the highest collider node
// under them: the highest of groundH and the corners of the 2 m collider cells round every sample point.
export function footing(pts) {
  const T = G.terrain, H = T.original || T.heights, VN = Math.round(Math.sqrt(H.length)), N = VN - 1, cell = TERRAIN_SIZE / N, half = TERRAIN_SIZE / 2;
  let m = -1e9;
  for (const [x, z] of pts) {
    m = Math.max(m, groundH(x, z));
    const i = Math.floor((x + half) / cell / 2) * 2, j = Math.floor((z + half) / cell / 2) * 2;
    for (const [a, b] of [[i, j], [i + 2, j], [i, j + 2], [i + 2, j + 2]]) if (a >= 0 && b >= 0 && a < VN && b < VN) m = Math.max(m, H[a + b * VN]);
  }
  return m;
}
// sample points over an oriented rectangle (local half sizes hw, hd), for footing()
export function rectPts(F, hw, hd, nx = 3, nz = 3, cx = 0, cz = 0) {
  const out = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) out.push(F.at(cx + (nx === 1 ? 0 : (i / (nx - 1) - 0.5) * 2 * hw), cz + (nz === 1 ? 0 : (j / (nz - 1) - 0.5) * 2 * hd)));
  return out;
}
const UP = new THREE.Vector3(0, 1, 0);
export const yawQ = (a) => new THREE.Quaternion().setFromAxisAngle(UP, a);
export const C = (r, g, b) => new THREE.Color(r, g, b);
export const col = (a) => (a instanceof THREE.Color ? a : new THREE.Color(a[0], a[1], a[2]));
export const pickR = (rng, arr) => arr[(rng() * arr.length) | 0];

// Instance colours multiply each material's (textured) base colour. These turn a wanted average linear
// colour into the multiplier for that material (averages measured from the textures x material colour).
const BASE = { roof: [0.311, 0.102, 0.041], ashlar: [0.478, 0.29, 0.148], plaster: [0.363, 0.316, 0.24], stone: [0.374, 0.254, 0.138] };
export const tint = (mat, r, g, b) => [r / BASE[mat][0], g / BASE[mat][1], b / BASE[mat][2]];
export const between = (rng, a, b) => a + (b - a) * rng();

// local frame: (lx, lz) -> world (x, z). Local +z is the "front" (world direction (sin yaw, cos yaw)).
export function frame(x, z, yaw = 0) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return { x, z, yaw, q: yawQ(yaw), at: (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs] };
}
// yaw that makes local +z face the world direction (dx, dz)
export const faceYaw = (dx, dz) => Math.atan2(dx, dz);

// ------------------------------------------------------------------ 2D oriented boxes (footprints)
// {x, z, hw, hd, yaw}: hw = half size along local x, hd along local z
function proj(o, ux, uz) {
  const cs = Math.cos(o.yaw), sn = Math.sin(o.yaw);
  const c = o.x * ux + o.z * uz, r = Math.abs(o.hw * (cs * ux - sn * uz)) + Math.abs(o.hd * (sn * ux + cs * uz));
  return [c - r, c + r];
}
export function obbHit(a, b, m = 0) {
  if (a.circle || b.circle) {
    const c = a.circle ? a : b, o = a.circle ? b : a;
    if (o.circle) return Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r + m;
    // circle vs box: clamp centre into the box frame
    const cs = Math.cos(o.yaw), sn = Math.sin(o.yaw), dx = c.x - o.x, dz = c.z - o.z;
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    const qx = Math.max(-o.hw, Math.min(o.hw, lx)), qz = Math.max(-o.hd, Math.min(o.hd, lz));
    return Math.hypot(lx - qx, lz - qz) < c.r + m;
  }
  for (const o of [a, b]) {
    const cs = Math.cos(o.yaw), sn = Math.sin(o.yaw);
    for (const [ux, uz] of [[cs, -sn], [sn, cs]]) {
      const pa = proj(a, ux, uz), pb = proj(b, ux, uz);
      if (pa[1] + m <= pb[0] || pb[1] + m <= pa[0]) return false;
    }
  }
  return true;
}
export function obbCorners(o) {
  const F = frame(o.x, o.z, o.yaw);
  return [F.at(-o.hw, -o.hd), F.at(o.hw, -o.hd), F.at(o.hw, o.hd), F.at(-o.hw, o.hd)];
}
// street segment -> footprint
export function segBox(ax, az, bx, bz, w, ext = 0) {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
  return { x: (ax + bx) / 2, z: (az + bz) / 2, hw: L / 2 + ext, hd: w / 2, yaw: Math.atan2(-dz, dx) };
}

// A building plot: the flat disc of a site plus everything already placed on it.
export class Plot {
  constructor(site, margin = 2.6) { this.site = site; this.R = site.r - margin; this.items = []; this.keep = []; }
  inside(o) {
    if (o.circle) return Math.hypot(o.x - this.site.x, o.z - this.site.z) + o.r <= this.R;
    for (const [x, z] of obbCorners(o)) if (Math.hypot(x - this.site.x, z - this.site.z) > this.R) return false;
    return true;
  }
  free(o, m = 0.12) {
    for (const p of this.items) if (obbHit(o, p, m)) return false;
    for (const p of this.keep) if (obbHit(o, p, 0)) return false;
    return true;
  }
  fits(o, m) { return this.inside(o) && this.free(o, m); }
  take(o) { this.items.push(o); return o; }
  reserve(o) { this.keep.push(o); return o; }
  street(ax, az, bx, bz, w) { return this.reserve(segBox(ax, az, bx, bz, w, 0.5)); }
}

// ------------------------------------------------------------------ primitives
// box in world space; o may carry mat/color/style/tag/struct...
export function box(W, x, y, z, sx, sy, sz, yaw, o = {}) {
  return W.add({ shape: 'box', x, y, z, sx, sy, sz, q: yawQ(yaw), ...o });
}

// square tower of solid courses standing at (x, z) on y0. Returns { y, top, cap }.
//   o: mat, color, tag, rot, taper, tall{k:h}, styleAt(k), cap, spire, spireColor, merlons, twist (45° courses)
export function tower(W, x, z, y0, side, layers, lh, o = {}) {
  let y = y0;
  const rot = o.rot || 0, mat = o.mat || 'ashlar', color = col(o.color || [0.86, 0.82, 0.76]);
  let last = null;
  for (let k = 0; k < layers; k++) {
    const H = (o.tall && o.tall[k]) || lh, taper = 1 - (o.taper || 0) * (k / layers);
    const a = rot + (o.twist ? (k % 2 ? Math.PI / 4 : 0) : k % 2 ? 0 : Math.PI / 2);
    last = W.add({ shape: 'box', mat, x, y: y + H / 2 + GAP, z, sx: side * taper, sy: H, sz: side * taper, q: yawQ(a), color, style: o.styleAt ? o.styleAt(k) : [0, 0, 0, 0], tag: o.tag });
    y += H + GAP;
  }
  const top = side * (1 - (o.taper || 0) * ((layers - 1) / layers));
  let cap = last;
  if (o.cap !== false) {
    const cw = top + (o.capOver ?? 0.5);
    cap = W.add({ shape: 'box', mat: o.capMat || mat, x, y: y + 0.25 + GAP, z, sx: cw, sy: 0.5, sz: cw, q: yawQ(rot), color, tag: o.tag });
    y += 0.5 + GAP;
  }
  const res = { y, top, cap, spire: null };
  if (o.spire) {
    const sw = top + (o.spireOver ?? 0.2);
    res.spire = W.add({ shape: 'pyr', mat: 'roof', x, y: y + o.spire / 2 + GAP, z, sx: sw, sy: o.spire, sz: sw, q: yawQ(rot), color: col(o.spireColor || [0.9, 0.78, 0.7]), friction: 1.2, tag: o.tag });
    res.y = y + o.spire;
  }
  if (o.merlons) {
    const F = frame(x, z, rot), cw = top + (o.capOver ?? 0.5), n = o.merlons === true ? 2 : o.merlons;
    const ms = Math.min(1.3, cw / (n * 2));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (n > 2 && i > 0 && i < n - 1 && j > 0 && j < n - 1) continue;
      const lx = (n === 1 ? 0 : (i / (n - 1) - 0.5)) * (cw - ms), lz = (n === 1 ? 0 : (j / (n - 1) - 0.5)) * (cw - ms);
      const [mx, mz] = F.at(lx, lz);
      W.add({ shape: 'box', mat: o.capMat || mat, x: mx, y: y + 0.45 + GAP, z: mz, sx: ms, sy: 0.9, sz: ms, q: F.q, color, tag: o.tag });
    }
    res.y = y + 0.9;
  }
  return res;
}

// round tower of stacked stone drums (lighthouses, mill towers)
export function drumTower(W, x, z, y0, dia, layers, lh, o = {}) {
  let y = y0, last = null;
  for (let k = 0; k < layers; k++) {
    const d = dia * (1 - (o.taper || 0) * (k / layers));
    const c = o.colorAt ? col(o.colorAt(k)) : col(o.color || [0.9, 0.88, 0.84]);
    last = W.add({ shape: 'cyl', mat: 'stone', x, y: y + lh / 2 + GAP, z, sx: d, sy: lh, sz: d, color: c, tag: o.tag });
    y += lh + GAP;
  }
  return { y, top: dia * (1 - (o.taper || 0) * ((layers - 1) / layers)), last };
}

// straight wall from A to B, running bond, optional openings {t0, t1, layers} (t along the wall, metres)
// each opening is bridged by a lintel in layer `layers`. Returns top y.
export function wallRun(W, ax, az, bx, bz, y0, o = {}) {
  const layers = o.layers || 4, bh = o.bh || 1.5, bt = o.bt || 1.4, bl = o.bl || 3.2;
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
  const yaw = Math.atan2(-dz, dx), mat = o.mat || 'ashlar', color = col(o.color || [0.86, 0.82, 0.76]);
  const ops = o.openings || [];
  const put = (t0, t1, k) => {
    t0 = Math.max(0, t0); t1 = Math.min(L, t1);
    const len = t1 - t0; if (len < 0.3) return;
    const tm = (t0 + t1) / 2;
    W.add({ shape: 'box', mat, x: ax + ux * tm, y: y0 + bh * (k + 0.5) + GAP * (k + 1), z: az + uz * tm, sx: len - 0.012, sy: bh, sz: bt, q: yawQ(yaw), color, style: o.style ? o.style(k) : [0, 0, 0, 0], tag: o.tag });
  };
  for (let k = 0; k < layers; k++) {
    // free intervals in this layer
    let iv = [[0, L]];
    for (const op of ops) {
      let c0 = null, c1 = null;
      if (k < op.layers) { c0 = op.t0; c1 = op.t1; } else if (k === op.layers) { c0 = op.t0 - (op.bear || 1.2); c1 = op.t1 + (op.bear || 1.2); }
      if (c0 === null) continue;
      const nx = [];
      for (const [a, b] of iv) { if (b <= c0 || a >= c1) nx.push([a, b]); else { if (a < c0) nx.push([a, c0]); if (b > c1) nx.push([c1, b]); } }
      iv = nx;
    }
    for (const [a, b] of iv) {
      // running bond: block joints at multiples of bl offset by half a block on odd layers
      const ph = (k % 2) * bl * 0.5;
      let t = a;
      while (t < b - 0.01) {
        let e = Math.min(b, Math.floor((t - ph) / bl + 1 + 1e-6) * bl + ph);
        if (b - e < 0.7) e = b;                     // no slivers at the end
        if (e - t < 0.7 && e < b) e = Math.min(b, e + bl);
        put(t, e, k); t = e;
      }
    }
    for (const op of ops) if (k === op.layers) put(op.t0 - (op.bear || 1.2), op.t1 + (op.bear || 1.2), k);
  }
  const yt = y0 + bh * layers + GAP * layers;
  if (o.merlons) {
    const ms = o.merlonW || 1.1, step = ms * 2.1, n = Math.floor((L - 0.4) / step), off = (L - (n - 1) * step) / 2;
    for (let i = 0; i < n; i++) {
      const t = off + i * step;
      const ox = -uz * (bt / 2 - 0.3), oz = ux * (bt / 2 - 0.3), s = o.merlonSide ?? 1;
      W.add({ shape: 'box', mat, x: ax + ux * t + ox * s, y: yt + 0.5 + GAP, z: az + uz * t + oz * s, sx: ms, sy: 1.0, sz: 0.6, q: yawQ(yaw), color, tag: o.tag });
    }
  }
  return yt;
}

// rectangular shell of wall panels (churches, keeps, halls). Local +z = front.
//   o: x, z, y0, yaw, w, d, t, tiers, th (number or array), mat, color, panel, style(side, tier, i, n), tag, house,
//      slab (wood floor between tiers + on top), skip(side, tier, i) -> true to leave a panel out
export function shell(W, o) {
  const F = frame(o.x, o.z, o.yaw || 0), t = o.t || 0.8, w = o.w, d = o.d, mat = o.mat || 'ashlar';
  const color = col(o.color || [0.86, 0.82, 0.76]), pw = o.panel || 3.6, tiers = o.tiers || 1;
  const nW = Math.max(1, Math.round(w / pw)), nD = Math.max(1, Math.round((d - 2 * t) / pw));
  const qS = yawQ((o.yaw || 0) + Math.PI / 2);
  let y = o.y0;
  for (let k = 0; k < tiers; k++) {
    const H = Array.isArray(o.th) ? o.th[k] : o.th || 4, cy = y + H / 2 + GAP;
    for (let i = 0; i < nW; i++) {
      const lx = (i - (nW - 1) / 2) * (w / nW);
      for (const s of [1, -1]) {
        const side = s > 0 ? 'front' : 'back';
        if (o.skip && o.skip(side, k, i)) continue;
        const [wx, wz] = F.at(lx, s * (d / 2 - t / 2));
        W.add({ shape: 'box', mat, x: wx, y: cy, z: wz, sx: w / nW - 0.012, sy: H, sz: t, q: F.q, color, style: o.style ? o.style(side, k, i, nW) : [0, 0, 0, 0], tag: o.tag, house: o.house });
      }
    }
    for (let i = 0; i < nD; i++) {
      const lz = (i - (nD - 1) / 2) * ((d - 2 * t) / nD);
      for (const s of [1, -1]) {
        const side = s > 0 ? 'right' : 'left';
        if (o.skip && o.skip(side, k, i)) continue;
        const [wx, wz] = F.at(s * (w / 2 - t / 2), lz);
        W.add({ shape: 'box', mat, x: wx, y: cy, z: wz, sx: (d - 2 * t) / nD - 0.012, sy: H, sz: t, q: qS, color, style: o.style ? o.style(side, k, i, nD) : [0, 0, 0, 0], tag: o.tag, house: o.house });
      }
    }
    y += H + GAP;
    if (o.slab && (k < tiers - 1 || o.slab === 'top')) {
      const st = o.slabT || 0.24;
      W.add({ shape: 'box', mat: o.slabMat || 'wood', x: o.x, y: y + st / 2 + GAP, z: o.z, sx: w - 0.03, sy: st, sz: d - 0.03, q: F.q, tint: 0.8, color: o.slabColor ? col(o.slabColor) : undefined, tag: o.tag, house: o.house });
      y += st + GAP;
    }
  }
  return y;
}

// buttress / pier block standing on the ground
export function pier(W, x, z, y0, sx, sy, sz, yaw, o = {}) {
  return box(W, x, y0 + sy / 2 + GAP, z, sx, sy, sz, yaw, { mat: o.mat || 'ashlar', color: col(o.color || [0.86, 0.82, 0.76]), tag: o.tag });
}

// ------------------------------------------------------------------ props (loose, not counted as structure)
export function barrel(x, y0, z, rng, tag) {
  return G.physics.add({ shape: 'cyl', mat: 'wood', x, y: y0 + 0.55 + GAP, z, sx: 0.78, sy: 1.1, sz: 0.78, q: yawQ(rng() * 6), tint: 0.7 + rng() * 0.3, tag });
}
export function crate(x, y0, z, rng, tag, s = 0.7 + rng() * 0.4) {
  return G.physics.add({ shape: 'box', mat: 'wood', x, y: y0 + s / 2 + GAP, z, sx: s, sy: s, sz: s, q: yawQ(rng() * 6), tint: 0.75 + rng() * 0.35, tag });
}
export function hayBale(x, y0, z, rng, tag, big = true) {
  const d = big ? 2.0 + rng() * 0.5 : 1.3, h = big ? 1.6 + rng() * 0.4 : 1.0;
  return G.physics.add({ shape: 'cyl', mat: 'wood', x, y: y0 + h / 2 + GAP, z, sx: d, sy: h, sz: d, q: yawQ(rng() * 6), color: C(1.35 + rng() * 0.2, 1.08 + rng() * 0.15, 0.48), tag });
}
export function logPile(x, y0, z, yaw, rng, tag) {
  const F = frame(x, z, yaw);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 3 - r; i++) {
    const [px, pz] = F.at(0, (i - (2 - r) / 2) * 0.46);
    G.physics.add({ shape: 'box', mat: 'wood', x: px, y: y0 + 0.21 + r * (0.42 + GAP) + GAP, z: pz, sx: 3.2, sy: 0.42, sz: 0.42, q: F.q, tint: 0.6 + rng() * 0.3, tag });
  }
}
// cut-stone blocks stacked in a little pyramid
export function stoneStack(W, x, y0, z, yaw, rng, tag, levels = 3) {
  const F = frame(x, z, yaw);
  let y = y0;
  for (let l = 0; l < levels; l++) {
    const n = levels - l, h = 0.9;
    for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) {
      const [px, pz] = F.at((i - (n - 1) / 2) * 1.62, (j - 0.5) * 1.02);
      W.add({ shape: 'box', mat: 'stone', x: px, y: y + h / 2 + GAP, z: pz, sx: 1.6, sy: h, sz: 1.0, q: F.q, tint: 0.85 + rng() * 0.2, tag, struct: false });
    }
    y += h + GAP;
  }
}
// post-and-rail fence along a polyline (posts every ~2.4 m, rails resting on the post tops)
export function fence(pts, y0, tag, closed = false) {
  const P = G.physics;
  const loop = closed ? [...pts, pts[0]] : pts;
  for (let s = 0; s < loop.length - 1; s++) {
    const [ax, az] = loop[s], [bx, bz] = loop[s + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 2.4)), yaw = Math.atan2(-(bz - az), bx - ax);
    for (let i = 0; i <= n; i++) {
      if (i === 0 && s > 0) continue;
      if (i === n && closed && s === loop.length - 2) continue;
      const t = i / n;
      P.add({ shape: 'box', mat: 'wood', x: ax + (bx - ax) * t, y: y0 + 0.55 + GAP, z: az + (bz - az) * t, sx: 0.2, sy: 1.1, sz: 0.2, q: yawQ(yaw), tint: 0.55, tag });
    }
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      P.add({ shape: 'box', mat: 'wood', x: ax + (bx - ax) * t, y: y0 + 1.1 + 0.06 + 2 * GAP, z: az + (bz - az) * t, sx: L / n - 0.02, sy: 0.12, sz: 0.14, q: yawQ(yaw), tint: 0.6, tag });
    }
  }
}
// dry-stone wall (field boundary)
export function dryWall(W, pts, y0, tag, closed = false, o = {}) {
  const loop = closed ? [...pts, pts[0]] : pts;
  for (let s = 0; s < loop.length - 1; s++) wallRun(W, loop[s][0], loop[s][1], loop[s + 1][0], loop[s + 1][1], y0, { layers: o.layers || 1, bh: o.bh || 0.9, bt: 0.7, bl: 1.7, mat: 'stone', color: o.color || [0.82, 0.8, 0.76], tag, openings: o.openings?.[s] });
}

// ------------------------------------------------------------------ attached visuals
// A visual mesh that rides on a body (matrix updated just before it is drawn). When the body is
// destroyed or knocked off its spot, onBreak() is called once (spawn debris) and the visual hides.
export function attachVisual(W, block, mesh, offset, o = {}) {
  if (!block) return null;
  mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.layers.set(LAYER_SCENE);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), m = new THREE.Matrix4(), spin = new THREE.Matrix4();
  let broken = false;
  const place = () => {
    const t = block.body.translation(), r = block.body.rotation();
    p.set(t.x, t.y, t.z); q.set(r.x, r.y, r.z, r.w);
    m.compose(p, q, one).multiply(offset);
    if (o.spin) m.multiply(o.spinY ? spin.makeRotationY(o.spin()) : spin.makeRotationZ(o.spin()));
    mesh.matrix.copy(m); mesh.matrixWorld.copy(m);
  };
  mesh.onBeforeRender = () => {
    if (broken) return;
    const moved = !block.alive || Math.hypot(block.x - block.ox, block.y - block.oy, block.z - block.oz) > (o.tolerance ?? 0.5);
    if (moved) {
      broken = true; mesh.visible = false;
      if (o.onBreak) o.onBreak(mesh.matrixWorld.clone(), block);
      return;
    }
    place();
  };
  if (block.alive) place();
  G.scene.add(mesh);
  W.statics.push({ mesh, collider: null });
  return mesh;
}

let _sailGeo = null, _sailMat = null, _flagGeo = null;
function sailAssets() {
  if (_sailGeo) return;
  const frameParts = [], clothParts = [];
  const add = (list, g, c) => { g = g.toNonIndexed(); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); list.push(g); };
  for (let k = 0; k < 4; k++) {
    const rot = new THREE.Matrix4().makeRotationZ((k * Math.PI) / 2);
    add(frameParts, new THREE.BoxGeometry(0.24, 7.8, 0.24).translate(0, 4.0, 0).applyMatrix4(rot), [0.75, 0.62, 0.5]);
    for (let j = 0; j < 7; j++) add(frameParts, new THREE.BoxGeometry(1.75, 0.08, 0.1).translate(0.8, 1.5 + j * 1.0, 0.03).applyMatrix4(rot), [0.7, 0.58, 0.46]);
    add(frameParts, new THREE.BoxGeometry(0.07, 6.2, 0.1).translate(1.66, 4.4, 0.03).applyMatrix4(rot), [0.7, 0.58, 0.46]);
    add(clothParts, new THREE.BoxGeometry(1.5, 6.1, 0.03).translate(0.86, 4.35, -0.05).applyMatrix4(rot), [0.86, 0.8, 0.7]);
  }
  add(frameParts, new THREE.CylinderGeometry(0.4, 0.4, 0.7, 12).rotateX(Math.PI / 2).translate(0, 0, -0.2), [0.5, 0.42, 0.36]);
  _sailGeo = mergeGeometries([mergeGeometries(frameParts), mergeGeometries(clothParts)], true);
  _sailMat = [
    new THREE.MeshStandardMaterial({ map: G.tex.wood_diff, vertexColors: true, roughness: 0.9, metalness: 0 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
  ];
  const fg = new THREE.PlaneGeometry(2.2, 1.3, 8, 2).translate(1.1, 0, 0);
  const pole = new THREE.CylinderGeometry(0.06, 0.06, 4.2, 6).translate(0, -0.85, 0).toNonIndexed();
  const fgn = fg.toNonIndexed();
  for (const [g, c] of [[fgn, [1, 1, 1]], [pole, [0.25, 0.2, 0.16]]]) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); }
  // ripple the cloth once (static wave)
  const pa = fgn.attributes.position;
  for (let i = 0; i < pa.count; i++) { const x = pa.getX(i); pa.setZ(i, Math.sin(x * 2.6) * 0.12 * (x / 2.2)); }
  fgn.computeVertexNormals();
  _flagGeo = mergeGeometries([fgn, pole]);
}

// windmill sails on the front of a cap body; they turn slowly and fly off when the cap is hit
export function sails(W, block, offset, speed = 0.5) {
  sailAssets();
  const mesh = new THREE.Mesh(_sailGeo, _sailMat);
  const phase = (block ? block.x * 0.53 + block.z * 0.29 : 0) % 6;
  return attachVisual(W, block, mesh, offset, {
    spin: () => phase + G.time * speed,
    tolerance: 0.35,
    onBreak: (mw) => {
      const P = G.physics, c = new THREE.Vector3().setFromMatrixPosition(mw), qq = new THREE.Quaternion().setFromRotationMatrix(mw), dir = new THREE.Vector3();
      for (let k = 0; k < 4; k++) {
        const a = phase + G.time * speed + (k * Math.PI) / 2;
        dir.set(-Math.sin(a), Math.cos(a), 0).applyQuaternion(qq);
        P.add({ shape: 'box', mat: 'wood', x: c.x + dir.x * 4, y: c.y + dir.y * 4, z: c.z + dir.z * 4, sx: 1.6, sy: 6.8, sz: 0.2, q: qq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a)), sleeping: false, vel: { x: dir.x * 4, y: dir.y * 4 + 2, z: dir.z * 4 }, angvel: { x: Math.random() * 4 - 2, y: Math.random() * 4 - 2, z: Math.random() * 4 - 2 }, color: C(0.9, 0.85, 0.75), life: 30 });
      }
    },
  });
}

// pennant on a pole planted on top of a body
export function banner(W, block, dy, color, yaw = 0) {
  sailAssets();
  const key = col(color).getHexString();
  const mats = banner.mats || (banner.mats = new Map());
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ vertexColors: true, color: col(color), roughness: 0.85, metalness: 0, side: THREE.DoubleSide }));
  const mesh = new THREE.Mesh(_flagGeo, mats.get(key));
  const off = new THREE.Matrix4().compose(new THREE.Vector3(0, dy + 3.0, 0), yawQ(yaw), new THREE.Vector3(1, 1, 1));
  const ph = (block ? block.x * 0.71 + block.z * 0.37 : 0) % 6;
  return attachVisual(W, block, mesh, off, { tolerance: 0.4, spinY: true, spin: () => 0.12 * Math.sin(G.time * 1.3 + ph) });
}

// ------------------------------------------------------------------ terraced rows
// A row of houses built side by side that share their party walls (the cheap way to build a dense street: about
// 4 bodies per storey per house plus the roof). Local frame at the centre of the row's footprint, local +z = the
// street front, units run along local +x. Every unit has its own front / back panel and floor slab per storey, so a
// terrace still comes apart wall by wall, floor by floor. All units share the storey heights, so a party wall
// always straddles both neighbours' slabs; where a neighbour is lower, the taller house gets its own end wall set
// inside its slab. Roofs never overhang along the row, so neighbouring roofs never touch.
//   o: { x, z, yaw, y0, d, t, fh (number | per-storey array), units: [{ w, floors, color, ground, roof, gable, pat, lit,
//        ridge 'x' (along the street) | 'z' (gable to the street), pitch, groundTimber, tallWin, sideWin, shop, mat,
//        gableFeat }], tag, nextId() }
// Returns one record per unit { id, x, z, w, d, floors, yaw, top }.
export function terrace(W, o) {
  const F = frame(o.x, o.z, o.yaw), T = o.t ?? 0.4, d = o.d, U = o.units, n = U.length, ST = 0.22, tag = o.tag;
  const qS = yawQ(o.yaw + Math.PI / 2);
  const a = [-U.reduce((s, u) => s + u.w, 0) / 2];
  for (const u of U) a.push(a[a.length - 1] + u.w);
  const maxF = Math.max(...U.map((u) => u.floors));
  const fhAt = (k) => (Array.isArray(o.fh) ? o.fh[Math.min(k, o.fh.length - 1)] : o.fh || 2.8);
  const recs = U.map((u, i) => {
    const [x, z] = F.at((a[i] + a[i + 1]) / 2, 0), c = col(u.color);
    return { id: o.nextId(), x, z, w: u.w, d, floors: u.floors, yaw: o.yaw, tag, top: 0, c, cg: u.ground ? col(u.ground) : c.clone().multiplyScalar(0.92) };
  });
  const tp = (u, k) => (k === 0 ? (u.groundTimber ? u.pat : 0) : u.pat);
  let y = o.y0;
  for (let k = 0; k < maxF; k++) {
    const H = fhAt(k), cy = y + H / 2 + GAP;
    // party walls (on the boundary between two units) and end walls (set into the unit at the end of a run)
    for (let i = 0; i <= n; i++) {
      const L = i > 0 && U[i - 1].floors > k, R = i < n && U[i].floors > k;
      if (!L && !R) continue;
      const lx = L && R ? a[i] : R ? a[i] + T / 2 : a[i] - T / 2, own = R ? i : i - 1, u = U[own], r = recs[own], end = !(L && R);
      const [wx, wz] = F.at(lx, 0);
      W.add({ shape: 'box', mat: u.mat || 'plaster', x: wx, y: cy, z: wz, sx: d - 2 * T - 0.012, sy: H, sz: T, q: qS, color: k === 0 ? r.cg : r.c, style: [end && u.sideWin ? 1 : 0, tp(u, k), u.lit * 0.5, 0], house: r.id, tag });
    }
    for (let i = 0; i < n; i++) {
      const u = U[i]; if (u.floors <= k) continue;
      const r = recs[i], cx = (a[i] + a[i + 1]) / 2, c = k === 0 ? r.cg : r.c, pat = tp(u, k);
      let [wx, wz] = F.at(cx, d / 2 - T / 2);
      W.add({ shape: 'box', mat: u.mat || 'plaster', x: wx, y: cy, z: wz, sx: u.w - 0.012, sy: H, sz: T, q: F.q, color: c, style: [k === 0 ? (u.shop ? 3 : 2) : u.tallWin ? 3 : 1, pat, k === 0 ? u.lit * 0.7 : u.lit, 0], house: r.id, tag });
      [wx, wz] = F.at(cx, -d / 2 + T / 2);
      W.add({ shape: 'box', mat: u.mat || 'plaster', x: wx, y: cy, z: wz, sx: u.w - 0.012, sy: H, sz: T, q: F.q, color: c, style: [u.backWin === false ? 0 : 1, pat, u.lit * 0.6, 0], house: r.id, tag });
    }
    y += H + GAP;
    for (let i = 0; i < n; i++) {
      const u = U[i]; if (u.floors <= k) continue;
      const r = recs[i];
      W.add({ shape: 'box', mat: 'wood', x: r.x, y: y + ST / 2 + GAP, z: r.z, sx: u.w - 0.03, sy: ST, sz: d - 0.03, q: F.q, tint: 0.8, house: r.id, tag });
      if (u.floors === k + 1) r.top = y + ST + GAP;
    }
    y += ST + GAP;
  }
  for (let i = 0; i < n; i++) {
    const u = U[i], r = recs[i], along = u.ridge !== 'z';
    if (!u.flat) {
      W.roof(r.x, r.top, r.z, u.w, d, o.yaw, along ? 'x' : 'z', u.pitch || 48, u.gable ? col(u.gable) : r.c, col(u.roof), u.pat, u.lit, T,
        { house: r.id, tag, gableFeat: u.gableFeat ?? 0, ov: along ? (u.ov ?? 0.35) : -0.015, ovL: along ? -0.03 : 0.5 });
    }
    delete r.c; delete r.cg;
  }
  return recs;
}

// two-tower gatehouse over a road: the road runs along local z through the gap between the towers
//   o: { side, layers, lh, gapW, color, mat, tag, spire, spireColor, banner }
export function gatehouse(W, x, z, y0, yaw, o = {}) {
  const F = frame(x, z, yaw), side = o.side || 5, gw = o.gapW || 5.2, GS = o.color || [0.86, 0.82, 0.76], layers = o.layers || 8, lh = o.lh || 1.5;
  const tops = [];
  // the towers stop one course short when they carry spires, so the lintel can rest on their top courses
  for (const s of [-1, 1]) {
    const [tx, tz] = F.at(s * (gw / 2 + side / 2), 0);
    tops.push(tower(W, tx, tz, y0, side, layers, lh, { rot: yaw, color: GS, mat: o.mat || 'ashlar', tag: o.tag, styleAt: (k) => (k === layers - 3 ? [1, 0, 0.6, 0] : k === 1 ? [1, 0, 0.3, 0] : [0, 0, 0, 0]) }));
  }
  const yL = Math.min(tops[0].y, tops[1].y), span = gw + side * 2 - 0.3;
  const lin = W.add({ shape: 'box', mat: o.mat || 'ashlar', x, y: yL + 0.7 + GAP, z, sx: span, sy: 1.4, sz: side - 0.2, q: F.q, color: col(GS), style: [1, 0, 0.5, 0], tag: o.tag });
  let yT = yL + 1.4 + GAP;
  if (o.spire) {
    // a little belfry storey and a pyramid spire over the gate passage
    const bw = Math.min(gw + 1.6, side + 1.5);
    W.add({ shape: 'box', mat: o.mat || 'ashlar', x, y: yT + 1.4 + GAP, z, sx: bw, sy: 2.8, sz: side - 0.6, q: F.q, color: col(GS), style: [3, 0, 0.8, 0], tag: o.tag });
    yT += 2.8 + GAP;
    W.add({ shape: 'pyr', mat: 'roof', x, y: yT + o.spire / 2 + GAP, z, sx: bw + 0.3, sy: o.spire, sz: side - 0.3, q: F.q, color: col(o.spireColor || [0.42, 0.42, 0.47]), friction: 1.2, tag: o.tag });
  } else {
    const n = Math.max(2, Math.floor(span / 2.4));
    for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
      const [mx, mz] = F.at(-span / 2 + 0.45 + (i * (span - 0.9)) / (n - 1), s * (side / 2 - 0.45));
      W.add({ shape: 'box', mat: o.mat || 'ashlar', x: mx, y: yT + 0.45 + GAP, z: mz, sx: 0.8, sy: 0.9, sz: 0.5, q: F.q, color: col(GS), tag: o.tag });
    }
  }
  if (o.banner) banner(W, lin, 0.7 + (o.spire ? 0 : 0.9), o.banner, yaw);
  return { lin, tops, fp: { x, z, hw: gw / 2 + side + 0.5, hd: side / 2 + 0.8, yaw } };
}

// a slow-turning water wheel on the outside of a wall panel (visual; flies apart in planks when the wall moves)
let _wheelGeo = null, _wheelMat = null;
export function waterWheel(W, block, offset, speed = -0.6) {
  if (!_wheelGeo) {
    const parts = [], R = 2.7, Wd = 1.1;
    for (const s of [-1, 1]) for (let k = 0; k < 16; k++) {
      const a0 = (k / 16) * Math.PI * 2, a1 = ((k + 1) / 16) * Math.PI * 2, am = (a0 + a1) / 2, L = 2 * R * Math.sin(Math.PI / 16) + 0.06;
      parts.push(new THREE.BoxGeometry(L, 0.18, 0.12).rotateZ(am + Math.PI / 2).translate(Math.cos(am) * R, Math.sin(am) * R, (s * Wd) / 2));
    }
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI; for (const s of [-1, 1]) parts.push(new THREE.BoxGeometry(2 * R, 0.14, 0.1).rotateZ(a).translate(0, 0, (s * Wd) / 2)); }
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; parts.push(new THREE.BoxGeometry(0.62, 0.08, Wd + 0.1).rotateZ(a).translate(Math.cos(a) * (R + 0.1), Math.sin(a) * (R + 0.1), 0)); }
    // the axle runs back (local -z) to the pier or wall the wheel hangs from
    parts.push(new THREE.CylinderGeometry(0.22, 0.22, 3.5, 10).rotateX(Math.PI / 2).translate(0, 0, -1.05));
    _wheelGeo = mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g.toNonIndexed(); }));
    _wheelMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, color: new THREE.Color(0.3, 0.21, 0.14) });
  }
  const mesh = new THREE.Mesh(_wheelGeo, _wheelMat), phase = (block.x * 0.37 + block.z * 0.11) % 6;
  return attachVisual(W, block, mesh, offset, {
    spin: () => phase + G.time * speed, tolerance: 0.3,
    onBreak: (mw) => {
      const P = G.physics, c = new THREE.Vector3().setFromMatrixPosition(mw), qq = new THREE.Quaternion().setFromRotationMatrix(mw), dir = new THREE.Vector3(), zA = new THREE.Vector3(0, 0, 1);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2; dir.set(Math.cos(a), Math.sin(a), 0).applyQuaternion(qq);
        P.add({ shape: 'box', mat: 'wood', x: c.x + dir.x * 2.2, y: c.y + dir.y * 2.2, z: c.z + dir.z * 2.2, sx: 0.5, sy: 2.6, sz: 1.1, q: qq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(zA, a + Math.PI / 2)), sleeping: false, vel: { x: dir.x * 3, y: dir.y * 3 + 2, z: dir.z * 3 }, angvel: { x: (k % 3) - 1, y: 2 - (k % 4), z: (k % 2) * 2 - 1 }, tint: 0.65, life: 40 });
      }
    },
  });
}

// a small wooden boat (hull + thwart, or a barge with cargo), floating at `ySurf` (loose: timber floats)
export function boat(x, ySurf, z, yaw, rng, tag, o = {}) {
  const P = G.physics, F = frame(x, z, yaw), L = o.len || 5 + rng() * 2.5, Wd = o.w || 1.9 + rng() * 0.4, hh = 0.7;
  const hy = ySurf - 0.28;
  const hull = P.add({ shape: 'box', mat: 'wood', x, y: hy, z, sx: Wd, sy: hh, sz: L, q: F.q, tint: 0.45 + rng() * 0.25, tag });
  if (o.barge) {
    for (let i = 0; i < 3; i++) { const [px, pz] = F.at((rng() - 0.5) * 0.5, (i - 1) * 1.3); P.add({ shape: 'box', mat: 'wood', x: px, y: hy + hh / 2 + 0.35 + GAP, z: pz, sx: 0.7, sy: 0.7, sz: 0.7, q: F.q, tint: 0.8 + rng() * 0.2, tag }); }
  } else {
    const [px, pz] = F.at(0, -L * 0.22);
    P.add({ shape: 'box', mat: 'wood', x: px, y: hy + hh / 2 + 0.06 + GAP, z: pz, sx: Wd - 0.1, sy: 0.12, sz: 0.5, q: F.q, tint: 0.7, tag });
  }
  return hull;
}
