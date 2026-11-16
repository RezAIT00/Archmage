// Shared math helpers, seeded RNG and CPU noise.
import * as THREE from 'three';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
export const easeOutCubic = (t) => 1 - Math.pow(1 - sat(t), 3);
export const easeInCubic = (t) => Math.pow(sat(t), 3);
export const easeInOut = (t) => {
  t = sat(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

// ---- seeded RNG (mulberry32) -------------------------------------------------
export function makeRng(seed) {
  let s = seed >>> 0;
  const f = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return f;
}
let _rng = makeRng(1337);
export function seedRandom(seed) {
  _rng = makeRng(seed);
  Math.random = _rng; // make every Math.random() call deterministic too
}
export const rand = () => _rng();
export const rr = (a, b) => a + (b - a) * _rng();
export const rsign = () => (_rng() < 0.5 ? -1 : 1);
export const pick = (arr) => arr[Math.floor(_rng() * arr.length)];
export function randUnit(out = new THREE.Vector3()) {
  const u = _rng() * 2 - 1;
  const a = _rng() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), u, s * Math.sin(a));
}
export function randInSphere(r = 1, out = new THREE.Vector3()) {
  return randUnit(out).multiplyScalar(r * Math.cbrt(_rng()));
}
export function randDisc(r = 1, out = new THREE.Vector3()) {
  const a = _rng() * Math.PI * 2;
  const d = Math.sqrt(_rng()) * r;
  return out.set(Math.cos(a) * d, 0, Math.sin(a) * d);
}

// ---- 2D gradient noise + fbm (CPU, used for terrain) -------------------------
const PERM = new Uint8Array(512);
const GX = new Float32Array(256);
const GY = new Float32Array(256);
(function initNoise() {
  const r = makeRng(90210);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) {
    const a = r() * Math.PI * 2;
    GX[i] = Math.cos(a);
    GY[i] = Math.sin(a);
  }
})();
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const g = (ix, iy, dx, dy) => {
    const h = PERM[PERM[ix] + iy];
    return GX[h] * dx + GY[h] * dy;
  };
  const a = g(X, Y, xf, yf), b = g(X + 1, Y, xf - 1, yf);
  const c = g(X, Y + 1, xf, yf - 1), d = g(X + 1, Y + 1, xf - 1, yf - 1);
  return (a + (b - a) * u + (c + (d - c) * u - (a + (b - a) * u)) * v) * 1.5; // ~[-1,1]
}
export function fbm2(x, y, oct = 4, lac = 2.03, gain = 0.5) {
  let amp = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += noise2(x, y) * amp;
    norm += amp;
    x = x * lac + 17.3;
    y = y * lac - 9.1;
    amp *= gain;
  }
  return sum / norm;
}
export function ridged2(x, y, oct = 4) {
  let amp = 0.5, sum = 0, norm = 0, prev = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(noise2(x, y));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    norm += amp;
    x = x * 2.07 + 31.7;
    y = y * 2.07 + 11.3;
    amp *= 0.5;
  }
  return sum / norm;
}

// ---- critically damped spring -------------------------------------------------
export class Spring {
  constructor(value = 0, freq = 8, zeta = 0.8) {
    this.x = value;
    this.v = 0;
    this.target = value;
    this.freq = freq;
    this.zeta = zeta;
  }
  update(dt) {
    const w = this.freq * Math.PI * 2 * 0.16;
    const a = -2 * this.zeta * w * this.v - w * w * (this.x - this.target);
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  kick(v) {
    this.v += v;
  }
}
export class Spring3 {
  constructor(x = 0, y = 0, z = 0, freq = 8, zeta = 0.8) {
    this.x = new THREE.Vector3(x, y, z);
    this.v = new THREE.Vector3();
    this.target = new THREE.Vector3(x, y, z);
    this.freq = freq;
    this.zeta = zeta;
  }
  update(dt) {
    const w = this.freq * Math.PI * 2 * 0.16;
    const k = w * w, c = 2 * this.zeta * w;
    this.v.x += (-c * this.v.x - k * (this.x.x - this.target.x)) * dt;
    this.v.y += (-c * this.v.y - k * (this.x.y - this.target.y)) * dt;
    this.v.z += (-c * this.v.z - k * (this.x.z - this.target.z)) * dt;
    this.x.addScaledVector(this.v, dt);
    return this.x;
  }
}

// ---- tileable noise texture for shaders ---------------------------------------
// RGBA: R = soft fbm, G = billowy fbm, B = fine detail, A = worley-ish cells
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const r = makeRng(4242);
  const layer = (period, seedOff) => {
    // tileable value noise lattice
    const lat = new Float32Array(period * period);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    return (x, y) => {
      const fx = (x * period) % period, fy = (y * period) % period;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
      const a = lat[x0 + y0 * period], b = lat[x1 + y0 * period];
      const c = lat[x0 + y1 * period], d = lat[x1 + y1 * period];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy + seedOff * 0;
    };
  };
  const mk = (base, octs) => {
    const ls = [];
    for (let o = 0; o < octs; o++) ls.push(layer(base << o, o));
    return (x, y) => {
      let s = 0, a = 0.5, n = 0;
      for (const l of ls) {
        s += l(x, y) * a;
        n += a;
        a *= 0.5;
      }
      return s / n;
    };
  };
  const fA = mk(4, 5), fB = mk(6, 5), fC = mk(32, 3);
  // worley points (tileable)
  const CELLS = 8;
  const pts = [];
  for (let i = 0; i < CELLS * CELLS; i++) pts.push([r(), r()]);
  const worley = (x, y) => {
    const cx = Math.floor(x * CELLS), cy = Math.floor(y * CELLS);
    let best = 9;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const ix = (cx + i + CELLS) % CELLS, iy = (cy + j + CELLS) % CELLS;
        const p = pts[ix + iy * CELLS];
        const px = (cx + i + p[0]) / CELLS, py = (cy + j + p[1]) / CELLS;
        const dx = px - x, dy = py - y;
        best = Math.min(best, dx * dx + dy * dy);
      }
    return Math.sqrt(best) * CELLS;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, i = (x + y * size) * 4;
      data[i] = sat(fA(u, v) * 1.25 - 0.12) * 255;
      data[i + 1] = sat(Math.abs(fB(u, v) - 0.5) * 3.2) * 255;
      data[i + 2] = sat(fC(u, v)) * 255;
      data[i + 3] = sat(worley(u, v)) * 255;
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const TMP = {
  v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), v4: new THREE.Vector3(),
  q1: new THREE.Quaternion(), q2: new THREE.Quaternion(), m1: new THREE.Matrix4(), m2: new THREE.Matrix4(),
  e1: new THREE.Euler(), c1: new THREE.Color(),
};
