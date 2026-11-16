// Trees: textures, geometry and materials.
//
// Foliage is built the way film/game vegetation is: photographs of real leaves and twigs (CC0 scans from
// Poly Haven) are arranged into leafy boughs on a texture atlas, and each tree carries a few dozen of those
// boughs as alpha-tested cards on a real trunk-and-limb skeleton. Card normals are bent towards the outside
// of the crown so it shades as one soft volume, light shines through the leaves from behind, and the mip
// chain keeps the same leaf coverage at every distance so far forests stay full instead of thinning out.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { makeRng } from '../core/util.js';

const AT = 2048, TL = 512;                    // atlas size, tile size
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- pixels and sprites
async function pixels(url) {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
}
// Cut the separate leaves / twigs out of a scan: every connected region of the alpha mask becomes an RGBA sprite.
// keep({x, y, w, h, fill, area}) (all 0..1) decides which regions are wanted.
function cutSprites(diff, alpha, keep) {
  const { w, h } = alpha, S = 2, gw = (w / S) | 0, gh = (h / S) | 0, lab = new Int32Array(gw * gh).fill(-1), boxes = [];
  const on = (gx, gy) => alpha.data[((gy * S) * w + gx * S) * 4] > 100;
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (lab[gx + gy * gw] !== -1 || !on(gx, gy)) continue;
    const id = boxes.length, st = [gx + gy * gw], b = { x0: gx, y0: gy, x1: gx, y1: gy, n: 0 }; lab[gx + gy * gw] = id;
    while (st.length) {
      const k = st.pop(), x = k % gw, y = (k / gw) | 0; b.n++;
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {       // (a 2-cell reach keeps thin needles attached)
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const nk = nx + ny * gw; if (lab[nk] === -1 && on(nx, ny)) { lab[nk] = id; st.push(nk); }
      }
    }
    boxes.push(b);
  }
  const out = [];
  for (let id = 0; id < boxes.length; id++) {
    const b = boxes[id], bw = (b.x1 - b.x0 + 1) * S, bh = (b.y1 - b.y0 + 1) * S;
    if (!keep({ x: (b.x0 * S) / w, y: (b.y0 * S) / h, w: bw / w, h: bh / h, fill: (b.n * S * S) / (bw * bh), area: (b.n * S * S) / (w * h) })) continue;
    const c = document.createElement('canvas'); c.width = bw; c.height = bh;
    const x = c.getContext('2d'), im = x.createImageData(bw, bh);
    let left = 0, right = 0;
    for (let y = 0; y < bh; y++) for (let xx = 0; xx < bw; xx++) {
      const sx = b.x0 * S + xx, sy = b.y0 * S + y, si = (sy * w + sx) * 4, di = (y * bw + xx) * 4;
      const gx = Math.min(gw - 1, (sx / S) | 0), gy = Math.min(gh - 1, (sy / S) | 0);
      let mine = false;
      for (let dy = -1; dy <= 1 && !mine; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = gx + dx, ny = gy + dy; if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && lab[nx + ny * gw] === id) { mine = true; break; } }
      const a = mine ? alpha.data[si] : 0;
      im.data[di] = diff.data[si]; im.data[di + 1] = diff.data[si + 1]; im.data[di + 2] = diff.data[si + 2]; im.data[di + 3] = a;
      if (a > 100) { if (xx < bw * 0.14) left++; else if (xx > bw * 0.86) right++; }
    }
    x.putImageData(im, 0, 0);
    c.baseRight = right < left;               // (for sideways sprites: the bare stalk is at the emptier end)
    out.push(c);
  }
  return out;
}
// draw a sprite so that its stalk sits at (bx, by) and it grows `len` pixels in direction `ang` (0 = up, clockwise)
function stamp(ctx, sp, bx, by, ang, len, sideways = false) {
  ctx.save(); ctx.translate(bx, by);
  if (!sideways) { ctx.rotate(ang); const sw = (len * sp.width) / sp.height; ctx.drawImage(sp, -sw / 2, -len, sw, len); }
  else { ctx.rotate(ang - Math.PI / 2); const sh = (len * sp.height) / sp.width; if (sp.baseRight) { ctx.scale(-1, 1); ctx.drawImage(sp, -len, -sh / 2, len, sh); } else ctx.drawImage(sp, 0, -sh / 2, len, sh); }
  ctx.restore();
}

// ---------------------------------------------------------------- the bough atlas
const grade = (ctx, rng, b0, b1, s0, hue0, hue1) => { ctx.filter = `brightness(${(b0 + rng() * (b1 - b0)).toFixed(2)}) saturate(${(s0 + rng() * 0.3).toFixed(2)}) hue-rotate(${(hue0 + rng() * (hue1 - hue0)).toFixed(0)}deg)`; };
// a branching twig skeleton inside a tile: returns shoots [{ax, ay, ang, len}] (drawn as bark-coloured lines)
function shoots(ctx, x0, y0, T, rng, levels, colour) {
  const out = [], main = { ax: x0 + T / 2, ay: y0 + T - 10, ang: (rng() - 0.5) * 0.24, len: T * (0.5 + rng() * 0.12), lvl: 0 };
  out.push(main);
  const sprout = (p, n, spread, k) => {
    for (let i = 0; i < n; i++) {
      const t = 0.16 + (i / n) * 0.78 + rng() * 0.05, side = i % 2 ? 1 : -1;
      const s = { ax: p.ax + Math.sin(p.ang) * p.len * t, ay: p.ay - Math.cos(p.ang) * p.len * t, ang: p.ang + side * (spread + rng() * 0.4), len: p.len * k * (1 - t * 0.45) * (0.8 + rng() * 0.4), lvl: p.lvl + 1 };
      out.push(s);
      if (s.lvl < levels) sprout(s, 3, 0.6, 0.55);
    }
  };
  sprout(main, 8, 0.6, 0.62);
  ctx.strokeStyle = colour; ctx.lineCap = 'round';
  for (const s of out) { ctx.lineWidth = [7, 4, 2.5][s.lvl] || 2; ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.ax + Math.sin(s.ang) * s.len, s.ay - Math.cos(s.ang) * s.len); ctx.stroke(); }
  return out;
}
// a leafy bough: two layers (a shaded one behind, a brighter one on top) of small leaves along a branching twig
function leafBough(ctx, x0, y0, leaves, rng) {
  const T = TL;
  ctx.save(); ctx.beginPath(); ctx.rect(x0 + 3, y0 + 3, T - 6, T - 6); ctx.clip();
  const sh = shoots(ctx, x0, y0, T, rng, 2, '#31261a');
  for (let layer = 0; layer < 2; layer++) for (const s of sh) {
    const n = s.lvl === 0 ? 10 : s.lvl === 1 ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const u = 0.15 + (i / n) * 0.9, side = (i + layer) % 2 ? 1 : -1, px = s.ax + Math.sin(s.ang) * s.len * u, py = s.ay - Math.cos(s.ang) * s.len * u;
      if (layer) grade(ctx, rng, 0.7, 1.08, 0.85, 12, 34); else grade(ctx, rng, 0.42, 0.62, 0.8, 14, 30);
      stamp(ctx, leaves[(rng() * leaves.length) | 0], px, py, s.ang + side * (0.4 + rng() * 0.8) * (i === n - 1 ? 0.2 : 1), T * (0.085 + rng() * 0.04) * (layer ? 1 : 1.15));
    }
  }
  ctx.filter = 'none'; ctx.restore();
}
// a spray of small compound fronds
function frondBough(ctx, x0, y0, fronds, rng) {
  const T = TL;
  ctx.save(); ctx.beginPath(); ctx.rect(x0 + 3, y0 + 3, T - 6, T - 6); ctx.clip();
  const sh = shoots(ctx, x0, y0, T, rng, 1, '#4a3b24');
  for (let layer = 0; layer < 2; layer++) for (const s of sh) {
    const n = s.lvl === 0 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const u = 0.25 + (i / n) * 0.8, side = (i + layer) % 2 ? 1 : -1, px = s.ax + Math.sin(s.ang) * s.len * u, py = s.ay - Math.cos(s.ang) * s.len * u;
      if (layer) grade(ctx, rng, 0.72, 1.05, 0.9, 2, 16); else grade(ctx, rng, 0.45, 0.62, 0.85, 4, 14);
      stamp(ctx, fronds[(rng() * fronds.length) | 0], px, py, s.ang + side * (0.5 + rng() * 0.7) * (i === n - 1 ? 0.2 : 1), T * (0.2 + rng() * 0.09), true);
    }
  }
  ctx.filter = 'none'; ctx.restore();
}
// a fir bough: a long stem thick with needle sprigs on both sides, in two layers
function firBough(ctx, x0, y0, twigs, rng) {
  const W = TL, H = TL * 2;
  ctx.save(); ctx.beginPath(); ctx.rect(x0 + 3, y0 + 3, W - 6, H - 6); ctx.clip();
  const bx = x0 + W / 2, by = y0 + H - 10, L = H - 40, bend = (rng() - 0.5) * 0.1;
  const at = (u) => [bx + Math.sin(bend * u) * L * u * 0.5, by - L * u];
  ctx.strokeStyle = '#33251a'; ctx.lineCap = 'round'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(bx, by);
  for (let u = 0.1; u <= 1.001; u += 0.1) { const p = at(u); ctx.lineTo(p[0], p[1]); } ctx.stroke();
  for (let layer = 0; layer < 2; layer++) {
    const n = 44;
    for (let i = 0; i < n; i++) {
      const u = 0.04 + (i / n) * 0.94, side = (i + layer) % 2 ? 1 : -1, p = at(u);
      const len = W * (0.16 + 0.24 * Math.sin(Math.PI * (0.1 + 0.82 * u))) * (0.8 + rng() * 0.35) * (layer ? 1 : 1.1);
      if (layer) grade(ctx, rng, 0.78, 1.15, 1.25, 8, 24); else grade(ctx, rng, 0.42, 0.62, 1.15, 10, 22);
      stamp(ctx, twigs[(rng() * twigs.length) | 0], p[0], p[1], side * (0.55 + rng() * 0.55), len);
    }
  }
  grade(ctx, rng, 0.95, 1.1, 1.25, 10, 20);
  const tip = at(1); stamp(ctx, twigs[(rng() * twigs.length) | 0], tip[0], tip[1] + 34, 0, W * 0.34);
  ctx.filter = 'none'; ctx.restore();
}
// tile i -> uv rectangle (v runs down the canvas; the textures are not flipped). Tiles 0-3 leaves, 4-7 fronds, 8-11 fir.
export function tileUV(i) {
  if (i < 8) { const q = i >> 2, k = i & 3, x = q * 1024 + (k & 1) * TL, y = (k >> 1) * TL; return { u0: x / AT, u1: (x + TL) / AT, vTip: y / AT, vBase: (y + TL) / AT }; }
  const k = i - 8, x = k * TL, y = 1024; return { u0: x / AT, u1: (x + TL) / AT, vTip: y / AT, vBase: (y + 1024) / AT };
}
// mip chain that keeps the fraction of opaque texels constant, so distant foliage does not dissolve
function mipChain(base, size) {
  const cover = (d, k) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] * k >= 128) n++; return n / (d.length / 4); };
  const c0 = cover(base, 1), levels = [{ data: base, width: size, height: size }];
  let raw = base, s = size;
  while (s > 1) {
    const ns = s >> 1, nd = new Uint8Array(ns * ns * 4);
    for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 4; k++) { const i = ((y * 2 + (k >> 1)) * s + x * 2 + (k & 1)) * 4; r += raw[i]; g += raw[i + 1]; b += raw[i + 2]; a += raw[i + 3]; }
      const o = (y * ns + x) * 4; nd[o] = r >> 2; nd[o + 1] = g >> 2; nd[o + 2] = b >> 2; nd[o + 3] = a >> 2;
    }
    let lo = 0.5, hi = 8;
    for (let it = 0; it < 10; it++) { const mid = (lo + hi) / 2; if (cover(nd, mid) < c0) lo = mid; else hi = mid; }
    const k = (lo + hi) / 2, out = new Uint8Array(nd);
    for (let i = 3; i < out.length; i += 4) out[i] = Math.min(255, out[i] * k);
    levels.push({ data: out, width: ns, height: ns });
    raw = nd; s = ns;
  }
  return levels;
}

export async function loadTreeAssets() {
  const base = './assets/trees/';
  const [leafD, leafA, frondD, frondA, twigD, twigA] = await Promise.all(['leaf_diff', 'leaf_alpha', 'frond_diff', 'frond_alpha', 'twig_diff', 'twig_alpha'].map((n) => pixels(`${base}${n}.jpg`)));
  const leaves = cutSprites(leafD, leafA, (r) => r.area > 0.004 && r.h > 0.15);
  const fronds = cutSprites(frondD, frondA, (r) => r.area > 0.02);
  const twigs = cutSprites(twigD, twigA, (r) => r.w > 0.05 && r.h > 0.07 && r.w < 0.5 && r.h < 0.5 && r.fill < 0.55 && r.y + r.h < 0.83 && r.area > 0.002);
  if (!leaves.length || !fronds.length || !twigs.length) console.warn('[game] tree sprites missing', leaves.length, fronds.length, twigs.length);
  const cv = document.createElement('canvas'); cv.width = cv.height = AT;
  const ctx = cv.getContext('2d', { willReadFrequently: true }), rng = makeRng(90210);
  for (let i = 0; i < 4; i++) leafBough(ctx, (i & 1) * TL, (i >> 1) * TL, leaves, rng);
  for (let i = 0; i < 4; i++) frondBough(ctx, 1024 + (i & 1) * TL, (i >> 1) * TL, fronds, rng);
  for (let i = 0; i < 4; i++) firBough(ctx, i * TL, 1024, twigs, rng);
  const src = ctx.getImageData(0, 0, AT, AT).data, data = new Uint8Array(src.length);
  // fully transparent texels take the average foliage colour of their half of the atlas (no dark fringes when filtered)
  const mean = [[0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < src.length; i += 4) if (src[i + 3] > 200) { const m = mean[i < src.length / 2 ? 0 : 1]; m[0] += src[i]; m[1] += src[i + 1]; m[2] += src[i + 2]; m[3]++; }
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    if (a < 12) { const m = mean[i < src.length / 2 ? 0 : 1], n = m[3] || 1; data[i] = m[0] / n; data[i + 1] = m[1] / n; data[i + 2] = m[2] / n; data[i + 3] = 0; }
    else { data[i] = src[i]; data[i + 1] = src[i + 1]; data[i + 2] = src[i + 2]; data[i + 3] = a; }
  }
  const atlas = new THREE.DataTexture(data, AT, AT, THREE.RGBAFormat);
  atlas.mipmaps = mipChain(data, AT); atlas.generateMipmaps = false;
  atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter; atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = Math.min(4, G.renderer.capabilities.getMaxAnisotropy()); atlas.needsUpdate = true;
  const loader = new THREE.TextureLoader(), tex = {};
  await Promise.all(['bark_diff', 'bark_nor', 'pinebark_diff', 'pinebark_nor'].map((n) => loader.loadAsync(`${base}${n}.jpg`).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = n.endsWith('diff') ? THREE.SRGBColorSpace : THREE.NoColorSpace; tex[n] = t;
  })));
  return { atlas, canvas: cv, tex, counts: [leaves.length, fronds.length, twigs.length] };
}

// ---------------------------------------------------------------- geometry (unit trees: height 1, base at the origin)
class Mesher {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.w = []; this.i = []; }
  // a tapered tube along a path
  tube(pts, r0, r1, seg, vScale) {
    const base = this.p.length / 3, n = pts.length; let len = 0;
    const T = V(), N = V(), B = V(), ref = V(1, 0, 0.2).normalize();
    for (let k = 0; k < n; k++) {
      T.copy(pts[Math.min(n - 1, k + 1)]).sub(pts[Math.max(0, k - 1)]).normalize();
      N.crossVectors(T, ref); if (N.lengthSq() < 0.02) N.crossVectors(T, V(0, 0, 1)); N.normalize(); B.crossVectors(T, N).normalize();
      if (k > 0) len += pts[k].distanceTo(pts[k - 1]);
      const t = k / (n - 1), r = r0 + (r1 - r0) * t + (k === 0 ? r0 * 0.3 : 0);
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2, cx = Math.cos(a), sx = Math.sin(a);
        const nx = N.x * cx + B.x * sx, ny = N.y * cx + B.y * sx, nz = N.z * cx + B.z * sx;
        this.p.push(pts[k].x + nx * r, pts[k].y + ny * r, pts[k].z + nz * r); this.n.push(nx, ny, nz);
        this.uv.push((s / seg) * 2, len * vScale); this.c.push(1, 1, 1); this.w.push(0, 0);
      }
    }
    for (let k = 0; k < n - 1; k++) for (let s = 0; s < seg; s++) { const a = base + k * (seg + 1) + s, b = a + 1, c = a + seg + 1, d = c + 1; this.i.push(a, c, b, b, c, d); }
  }
  // a bough card: from `base` growing along `dir` for `len`, `wid` across along `side`; normals bent towards `nrmAt(point)`.
  // curve = [direction, amount]: the card bows that way towards its tip (two segments instead of one).
  card(base, dir, side, len, wid, tile, nrmAt, bendK, aoAt, phase, curve = null) {
    const o = this.p.length / 3, t = tileUV(tile), cn = V().crossVectors(side, dir).normalize(), q = V(), nn = V();
    // the card's own normal is turned to the outside of the crown (and the winding with it)
    const flip = cn.dot(nrmAt(q.copy(base).addScaledVector(dir, len * 0.5))) < 0; if (flip) cn.negate();
    const rows = curve ? [0, 0.5, 1] : [0, 1];
    for (const l of rows) for (const sd of [-0.5, 0.5]) {
      q.copy(base).addScaledVector(side, sd * wid).addScaledVector(dir, l * len);
      if (curve) q.addScaledVector(curve[0], l * l * curve[1] * len);
      nn.copy(cn).lerp(nrmAt(q), bendK).normalize();
      this.p.push(q.x, q.y, q.z); this.n.push(nn.x, nn.y, nn.z);
      this.uv.push(sd < 0 ? t.u0 : t.u1, t.vBase + (t.vTip - t.vBase) * l);
      const ao = aoAt(q, l); this.c.push(ao, ao, ao); this.w.push(0.25 + 0.75 * l, phase);
    }
    for (let r = 0; r < rows.length - 1; r++) { const a = o + r * 2, b = a + 1, c = a + 2, d = a + 3; if (flip) this.i.push(a, c, b, b, c, d); else this.i.push(a, b, c, b, d, c); }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.w, 2)); g.setIndex(this.i);
    g.boundingSphere = new THREE.Sphere(V(0, 0.5, 0), 1.2);
    return g;
  }
}

// broadleaf: a short bole, spreading limbs and a rounded crown. `tiles` = which atlas tiles to use
function broadleaf(seed, o) {
  const rng = makeRng(seed), F = new Mesher(), K = new Mesher();
  const cy = o.cy, rx = o.rx, ry = o.ry, centre = V(0, cy, 0);
  const nrmAt = (q) => V(q.x / rx, (q.y - cy) / ry + 0.2, q.z / rx).normalize();
  const aoAt = (q) => { const r = Math.min(1, Math.hypot(q.x / rx, (q.y - cy) / ry, q.z / rx)), up = (q.y - cy) / ry * 0.5 + 0.5; return (0.36 + 0.64 * Math.min(1, Math.max(0, (r - 0.3) / 0.6))) * (0.7 + 0.3 * Math.min(1, Math.max(0, up))); };
  // crown: clusters of three boughs spread over a shell (golden-angle spiral, bottom left open)
  const N = o.clusters, cl = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + 0.5) / N * 1.62, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996 + rng() * 0.5, k = 0.66 + rng() * 0.34;
    const dir = V(Math.cos(a) * r, y, Math.sin(a) * r).normalize();
    cl.push({ dir, pos: V(dir.x * rx * k, cy + dir.y * ry * k, dir.z * rx * k) });
  }
  for (const c of cl) {
    const out = c.dir, len = o.len * (0.85 + rng() * 0.35), wid = len * o.aspect, ph = rng();
    const rnd = V(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), s1 = V().crossVectors(out, rnd).normalize(), s2 = V().crossVectors(out, s1).normalize();
    const grow = out.clone().addScaledVector(V(0, 1, 0), o.droop).normalize(), down = V(0, -1, 0);
    F.card(c.pos.clone().addScaledVector(grow, -len * 0.45), grow, s1, len, wid, o.tiles[(rng() * o.tiles.length) | 0], nrmAt, 0.72, aoAt, ph, [down, 0.22]);
    F.card(c.pos.clone().addScaledVector(grow, -len * 0.45), grow, s2, len, wid, o.tiles[(rng() * o.tiles.length) | 0], nrmAt, 0.72, aoAt, ph, [down, 0.22]);
    // one bough lying on the crown's surface, seen face-on from outside, bowed to follow the crown
    const tan = s1.clone().addScaledVector(V(0, 1, 0), 0.45).addScaledVector(out, 0.12).normalize(), sd = V().crossVectors(out, tan).normalize();
    F.card(c.pos.clone().addScaledVector(out, len * 0.16).addScaledVector(tan, -len * 0.5), tan, sd, len * 1.05, wid * 1.05, o.tiles[(rng() * o.tiles.length) | 0], nrmAt, 0.8, aoAt, ph, [out.clone().negate(), 0.3]);
  }
  // skeleton: bole, limbs reaching into the crown, twigs to the nearest clusters
  const top = V((rng() - 0.5) * 0.03, o.fork, (rng() - 0.5) * 0.03);
  K.tube([V(0, -0.03, 0), V((rng() - 0.5) * 0.02, o.fork * 0.35, (rng() - 0.5) * 0.02), V((rng() - 0.5) * 0.03, o.fork * 0.7, (rng() - 0.5) * 0.03), top], o.bole, o.bole * 0.62, o.lod ? 4 : 7, 5);
  const limbs = o.limbs;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * 6.283 + rng() * 0.7, el = 0.25 + rng() * 0.75;
    const end = V(Math.cos(a) * rx * 0.62 * Math.cos(el * 0.9), cy + ry * (el - 0.35) * 0.9, Math.sin(a) * rx * 0.62 * Math.cos(el * 0.9));
    const from = top.clone().setY(o.fork * (0.78 + rng() * 0.22)), mid = from.clone().lerp(end, 0.5).add(V(0, ry * 0.18, 0)), pts = [];
    for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push(V().copy(from).multiplyScalar((1 - t) * (1 - t)).addScaledVector(mid, 2 * t * (1 - t)).addScaledVector(end, t * t)); }
    K.tube(pts, o.bole * 0.42, o.bole * 0.1, o.lod ? 3 : 5, 6);
    if (o.lod) continue;
    const near = cl.map((c) => [c.pos.distanceTo(end), c]).sort((x, y) => x[0] - y[0]);
    for (let k = 0; k < 2; k++) { const tgt = near[k][1].pos, f2 = pts[2 + k]; K.tube([f2, f2.clone().lerp(tgt, 0.5).add(V(0, 0.015, 0)), tgt], o.bole * 0.14, o.bole * 0.04, 4, 6); }
  }
  return { foliage: F.build(), trunk: K.build(), crownY: cy, crownR: rx, centre };
}

// conifer: a straight stem with whorls of drooping boughs, each a flat frond with a cross card for depth
function conifer(seed, o) {
  const rng = makeRng(seed), F = new Mesher(), K = new Mesher();
  const UP = V(0, 1, 0), whorls = o.whorls;
  K.tube([V(0, -0.03, 0), V(0, 0.25, 0), V(0, 0.5, 0), V(0, 0.75, 0), V(0, 0.99, 0)], o.bole, o.bole * 0.08, o.lod ? 4 : 7, 5);
  for (let w = 0; w < whorls; w++) {
    const t = o.from + (w / (whorls - 1)) * (0.965 - o.from), L = o.reach * Math.pow(1 - t, 0.8) + 0.028;
    const n = Math.round((o.lod ? 5 : 8) - t * (o.lod ? 2 : 3)), yaw0 = rng() * 6.283, pitch = (20 - 58 * Math.pow(t, 1.6)) * Math.PI / 180;     // low boughs hang, the top ones point up
    for (let k = 0; k < n; k++) {
      const yaw = yaw0 + (k / n) * 6.283 + (rng() - 0.5) * 0.35, p = pitch + (rng() - 0.5) * 0.2, len = L * (0.82 + rng() * 0.36);
      const dir = V(Math.cos(yaw) * Math.cos(p), -Math.sin(p), Math.sin(yaw) * Math.cos(p)), side = V().crossVectors(dir, UP).normalize(), up2 = V().crossVectors(side, dir).normalize();
      const base = V(0, t + (rng() - 0.5) * 0.012, 0), rad = V(Math.cos(yaw), 0, Math.sin(yaw));
      const nrmAt = () => V().copy(UP).multiplyScalar(0.75).addScaledVector(rad, 0.55).normalize();
      const aoAt = (q, l) => (0.42 + 0.58 * l) * (0.72 + 0.28 * t);
      const tile = 8 + ((rng() * 4) | 0), ph = rng();
      if (!o.lod && k % 3 === 0) K.tube([base.clone(), base.clone().addScaledVector(dir, len * 0.34).add(V(0, len * 0.03, 0)), base.clone().addScaledVector(dir, len * 0.7)], o.bole * 0.2 * (1 - t * 0.55), o.bole * 0.03, 3, 6);
      F.card(base, dir, side, len, len * (o.lod ? 1.1 : 0.8), tile, nrmAt, 0.75, aoAt, ph);
      if (!o.lod) F.card(base, dir, up2, len, len * 0.44, tile, () => V().copy(rad).multiplyScalar(0.8).addScaledVector(UP, 0.4).normalize(), 0.7, aoAt, ph);
    }
  }
  for (let k = 0; k < 3; k++) { const a = (k / 3) * 3.1416 + rng(), side = V(Math.cos(a), 0, Math.sin(a)); F.card(V(0, 0.9, 0), UP, side, 0.11, 0.07, 8 + k, () => side.clone().cross(UP).normalize(), 0.3, (q, l) => 0.8 + 0.2 * l, rng()); }
  return { foliage: F.build(), trunk: K.build(), crownY: 0.55, crownR: o.reach * 0.6, centre: V(0, 0.55, 0) };
}

// The species. kind: which family a forest slot asks for ('oak' = broadleaf, 'pine' = conifer).
export function makeTreeVariants() {
  // (each species is built twice: in full, and with about a quarter of the triangles for trees far away)
  const withLod = (hi, lo) => ({ ...hi, foliageLo: lo.foliage, trunkLo: lo.trunk });
  const B = (seed, o) => withLod(broadleaf(seed, o), broadleaf(seed, { ...o, lod: true, clusters: Math.round(o.clusters * 0.3), len: o.len * 1.8 }));
  const Cn = (seed, o) => withLod(conifer(seed, o), conifer(seed, { ...o, lod: true, whorls: Math.round(o.whorls * 0.55) }));
  return [
    { kind: 'oak', bark: 'bark', height: 10.5, ...B(11, { cy: 0.68, rx: 0.36, ry: 0.28, clusters: 52, len: 0.235, aspect: 0.95, droop: 0.1, fork: 0.4, bole: 0.05, limbs: 5, tiles: [0, 1, 2, 3] }) },
    { kind: 'oak', bark: 'bark', height: 12, ...B(23, { cy: 0.66, rx: 0.3, ry: 0.31, clusters: 46, len: 0.225, aspect: 0.95, droop: 0.2, fork: 0.34, bole: 0.042, limbs: 5, tiles: [0, 1, 2, 3] }) },
    { kind: 'oak', bark: 'bark', height: 11.5, ...B(37, { cy: 0.67, rx: 0.31, ry: 0.3, clusters: 44, len: 0.24, aspect: 1.0, droop: -0.18, fork: 0.42, bole: 0.036, limbs: 4, tiles: [4, 5, 6, 7] }) },
    { kind: 'pine', bark: 'pinebark', height: 16, ...Cn(51, { whorls: 17, from: 0.1, reach: 0.235, bole: 0.024 }) },
    { kind: 'pine', bark: 'pinebark', height: 18.5, ...Cn(67, { whorls: 19, from: 0.16, reach: 0.19, bole: 0.021 }) },
  ];
}

// ---------------------------------------------------------------- materials
const WIND = `
  uniform float uTimeF, uWindF;
  vec3 treeSway(vec3 p, vec4 wp, vec2 wind) {
    float bend = p.y * p.y * 0.03 * uWindF, t = uTimeF;
    p.x += sin(t * 1.1 + wp.x * 0.07 + wp.z * 0.05) * bend + sin(t * 2.3 + wp.z * 0.11) * bend * 0.35;
    p.z += cos(t * 0.9 + wp.z * 0.06 + wp.x * 0.04) * bend;
    float fl = wind.x * 0.007 * (0.5 + 0.5 * uWindF), ph = wind.y * 6.283 + wp.x * 0.3 + wp.z * 0.2;
    p += vec3(sin(t * 2.9 + ph), sin(t * 3.7 + ph * 1.3) * 0.7, cos(t * 3.3 + ph)) * fl;
    return p;
  }`;
export const treeUniforms = { uTimeF: { value: 0 }, uWindF: { value: 1 }, uSunDirF: { value: new THREE.Vector3(0, 1, 0) }, uSunColF: { value: new THREE.Color(1, 1, 1) } };

export function foliageMaterial(atlas) {
  const m = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.16, alphaToCoverage: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, treeUniforms, { tNoiseF: { value: G.noiseTex } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec2 aWind; attribute vec2 aFx; varying vec3 vWorldF; varying vec3 vWNrmF; varying vec2 vFx;${WIND}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wpF = modelMatrix * instanceMatrix * vec4(position, 1.0);
        transformed = treeSway(transformed, wpF, aWind);
        vWorldF = wpF.xyz; vFx = aFx;
        vWNrmF = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tNoiseF; uniform vec3 uSunDirF, uSunColF; varying vec3 vWorldF; varying vec3 vWNrmF; varying vec2 vFx;')
      .replace('#include <alphatest_fragment>', `
        // fire strips the leaves away in patches
        if (vFx.x > 0.01 && texture2D(tNoiseF, vMapUv * 5.0).r < vFx.x * 1.15 - 0.05) discard;
        #include <alphatest_fragment>
        float lfF = texture2D(tNoiseF, vWorldF.xz * 0.045 + vWorldF.y * 0.02).g;
        diffuseColor.rgb *= 0.82 + 0.4 * lfF;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.89, 1.0) * (0.7 + 0.35 * lfF), vFx.y * 0.86);     // rime`)
      // both faces of a leaf card shade with the same crown-facing normal (no flip for back faces)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(vNormal);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // light coming through the crown from behind
        float backF = clamp(-dot(normalize(vWNrmF), uSunDirF), 0.0, 1.0);
        reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 1.08, 0.55) * uSunColF * backF * 0.22;`);
  };
  m.customProgramCacheKey = () => 'treefoliage1';
  return m;
}
export function foliageDepthMaterial(atlas) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, treeUniforms, { tNoiseF: { value: G.noiseTex } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec2 aWind; attribute vec2 aFx; varying vec2 vFx;${WIND}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wpF = modelMatrix * instanceMatrix * vec4(position, 1.0);
        transformed = treeSway(transformed, wpF, aWind); vFx = aFx;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tNoiseF; varying vec2 vFx;')
      .replace('#include <alphatest_fragment>', `if (vFx.x > 0.01 && texture2D(tNoiseF, vMapUv * 5.0).r < vFx.x * 1.15 - 0.05) discard;
        #include <alphatest_fragment>`);
  };
  m.customProgramCacheKey = () => 'treefoliagedepth1';
  return m;
}
export function barkMaterial(diff, nor) {
  const m = new THREE.MeshStandardMaterial({ map: diff, normalMap: nor, color: new THREE.Color(0.72, 0.64, 0.56), roughness: 0.95, metalness: 0, envMapIntensity: 0.3 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, treeUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wpF = modelMatrix * instanceMatrix * vec4(position, 1.0);
        transformed = treeSway(transformed, wpF, vec2(0.0));`);
  };
  m.customProgramCacheKey = () => 'treebark1';
  return m;
}
