// Deformable 1 km heightfield terrain: 4-layer PBR splatting, building sites, lakes, and a "world state"
// map (burn / heat / frost / bloom) that spells paint into. Spells can also really reshape it
// (craters, fissures, raised mountains, sunken basins): mesh, grass and physics collider all follow.
import * as THREE from 'three';
import { G, LAYER_SCENE } from '../core/globals.js';
import { fbm2, ridged2, smoothstep, sat, lerp, clamp } from '../core/util.js';
import { SITES, LAKES, TERRAIN_SIZE, groundCover, RESERVOIR, RIVER, DAM, riverAt } from './layout.js';
import { GLSL_MAGIC_CIRCLE } from '../render/glsl.js';

const N = 1024, SIZE = TERRAIN_SIZE, CELL = SIZE / N, VN = N + 1, HALF = SIZE / 2;
const MAPN = 1024;      // control + state map resolution
const PHYS = 2;         // physics heightfield stride

export class Terrain {
  constructor(sunDir) {
    const l = Math.hypot(sunDir.x, sunDir.z) || 1;
    this.sunXZ = { x: sunDir.x / l, z: sunDir.z / l };
    // water first (the reservoir's hill changes the ground the sites stand on), then the building sites
    for (const k of LAKES) k.level = this.rawHeight(k.x, k.z) - 0.8 + (k.up || 0);
    RIVER.bed0 = LAKES.find((k) => k.id === 'mirrormere').level - 0.9;         // river bed where it meets the lake
    RIVER.damBed = RIVER.bed0 + RIVER.slope * RIVER.uDam;                      // ... and at the toe of the dam
    RESERVOIR.level = RIVER.damBed + RESERVOIR.rise; RESERVOIR.floor = RESERVOIR.level - RESERVOIR.depth; RESERVOIR.rim = RESERVOIR.level + RESERVOIR.rimUp;
    DAM.toe = RIVER.damBed; DAM.crest = RESERVOIR.level + 1.3; DAM.spill = RESERVOIR.level - 0.7;
    for (const s of SITES) if (!s.rel) s.h = this.rawHeight(s.x, s.z) + (s.dh || 0);
    for (const s of SITES) if (s.rel) s.h = SITES.find((o) => o.id === s.rel.to).h + s.rel.dh;
    this.heights = new Float32Array(VN * VN);
    this.runes = [new THREE.Vector4(0, 0, 1, 1), new THREE.Vector4(0, 0, 1, -1)];
    this.runeCols = [new THREE.Vector4(1, 0.5, 0.2, 0), new THREE.Vector4(1, 0.5, 0.2, 0)];
    this.colliderDirty = false; this.colliderTimer = 0; this.stateDirty = false; this.heatActive = false; this.heatTimer = 0;
    this.geomDirty = null;
  }

  // broad landscape (also used by the low-res outer mesh, so it must stay low-frequency)
  natural(x, z) {
    const r = Math.hypot(x, z);
    let h = fbm2(x * 0.0042 + 3.1, z * 0.0042 - 7.7, 3) * 15;
    const d = (x * this.sunXZ.x + z * this.sunXZ.z) / (r + 1e-3);
    const open = 1 - smoothstep(0.5, 0.9, d) * 0.92; // keep a valley open towards the sunset
    const hill = smoothstep(540, 950, r);
    h += hill * (10 + (fbm2(x * 0.0038 + 5, z * 0.0038 + 9, 4) * 0.5 + 0.5) * 80) * open;
    const mtn = smoothstep(950, 2700, r);
    h += mtn * (ridged2(x * 0.0009 + 1.7, z * 0.0009 - 4.2, 5) * 820 + 60) * open;
    return h;
  }
  rawHeight(x, z) {
    const edge = smoothstep(HALF - 4, HALF - 80, Math.max(Math.abs(x), Math.abs(z)));
    const detail = (fbm2(x * 0.011 + 3.1, z * 0.011 - 7.7, 4) * 2.4 + fbm2(x * 0.05, z * 0.05, 3) * 0.45) * edge;
    let h = this.natural(x, z) + detail;
    // the hill that carries the Greywater reservoir
    const R = RESERVOIR, dx = x - R.x, dz = z - R.z, dd = dx * dx + dz * dz;
    if (R.rim !== undefined && dd < R.moundR * R.moundR) h = lerp(h, R.rim + detail * 0.6 + fbm2(x * 0.02 + 5, z * 0.02 - 8, 2) * 0.9, smoothstep(R.moundR, R.r + 26, Math.sqrt(dd)));
    return h;
  }
  heightFn(x, z) {
    let h = this.rawHeight(x, z);
    for (const s of SITES) {
      const dx = x - s.x, dz = z - s.z, R = s.r + (s.blend || 12);
      if (dx > R || dx < -R || dz > R || dz < -R) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 < R * R) h = lerp(h, s.h, smoothstep(R, s.r, Math.sqrt(d2)));
    }
    for (const k of LAKES) {
      const dx = x - k.x, dz = z - k.z, R = k.r + 18, RB = R * 1.5;
      if (dx > RB || dx < -RB || dz > RB || dz < -RB) continue;
      const d = Math.hypot(dx, dz) * (1 + fbm2(x * 0.021 + k.x, z * 0.021 - k.z, 3) * 0.34); if (d >= R) continue;
      const rim = Math.max(h, k.level + 0.7 * smoothstep(k.r + 18, k.r + 3, d));
      const bowl = k.level - k.depth * Math.max(0, 1 - (d / k.r) * (d / k.r));
      h = lerp(rim, bowl, smoothstep(k.r + 2, k.r - 7, d));
    }
    // the reservoir's bowl
    {
      const R = RESERVOIR, dx = x - R.x, dz = z - R.z;
      if (dx < R.r + 12 && dx > -R.r - 12 && dz < R.r + 12 && dz > -R.r - 12) {
        const d = Math.hypot(dx, dz) * (1 + fbm2(x * 0.03 + 7, z * 0.03 - 3, 3) * 0.2);
        if (d < R.r + 6) { const q = Math.min(1, d / R.r), bowl = R.floor + (R.depth + 1.6) * q * q * q; h = Math.min(h, lerp(h, bowl, smoothstep(R.r + 6, R.r - 3, d))); }
      }
    }
    // the river: a channel cut down to its bed (a rocky narrows where the dam stands), low banks built up
    const rv = riverAt(x, z, 76);
    if (rv) {
      const bed = RIVER.bedAt(rv.u), surf = RIVER.surfAt(rv.u), off = rv.d - RIVER.half - fbm2(x * 0.06, z * 0.06, 2) * 1.2;
      const k = lerp(3.2, 0.85, smoothstep(9, 24, Math.abs(rv.u - RIVER.uDam)));
      if (rv.u > 30 && rv.u < RIVER.uDam && off > 1.5) {
        // Low ground beside the channel is built up into a bank. Between the dam and the city the valley is
        // also given shoulders, so a flood from the dam is funnelled down the valley and bursts out over the city.
        const conf = smoothstep(205, 250, rv.u);                                              // 0 by the city, 1 up-valley
        const plain = surf + 0.9 - Math.max(0, off - 9) * 0.07;                               // a low bank that fades into the land
        const gorge = surf + 0.9 + 5.6 * smoothstep(3, 15, off) - Math.max(0, off - 34) * 0.2;  // valley shoulders
        h = Math.max(h, lerp(plain, gorge, conf));
      }
      h = Math.min(h, bed + Math.max(0, off) * k);
    }
    return h;
  }
  // bilinear lookup of the live (deformed) heightfield
  heightAt(x, z) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    if (fx < 0 || fz < 0 || fx >= N || fz >= N) return this.natural(x, z);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, H = this.heights;
    const a = H[i + j * VN], b = H[i + 1 + j * VN], c = H[i + (j + 1) * VN], d = H[i + 1 + (j + 1) * VN];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.1;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }

  build() {
    const H = this.heights;
    for (let j = 0; j < VN; j++) for (let i = 0; i < VN; i++) H[i + j * VN] = this.heightFn(-HALF + i * CELL, -HALF + j * CELL);
    this.original = new Float32Array(H);

    // ---- inner mesh (world-space vertices)
    const pos = new Float32Array(VN * VN * 3), nor = new Float32Array(VN * VN * 3);
    for (let j = 0; j < VN; j++) for (let i = 0; i < VN; i++) {
      const k = (i + j * VN) * 3;
      pos[k] = -HALF + i * CELL; pos[k + 2] = -HALF + j * CELL;
      const edge = i === 0 || j === 0 || i === N || j === N;
      pos[k + 1] = H[i + j * VN] - (edge ? 2.5 : 0);
    }
    const idx = new Uint32Array(N * N * 6);
    let q = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = i + j * VN, b = a + 1, c = a + VN, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = geo;
    this._updateNormals(0, 0, N, N);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    // ---- textures driven from CPU
    this.heightData = new Uint16Array(VN * VN);
    this.heightTex = new THREE.DataTexture(this.heightData, VN, VN, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.minFilter = this.heightTex.magFilter = THREE.LinearFilter;
    this._uploadHeights();
    this._buildControl();
    // state map: R burn, G heat, B frost, A bloom (lush regrowth)
    this.burn = new Float32Array(MAPN * MAPN); this.heat = new Float32Array(MAPN * MAPN);
    this.stateData = new Uint8Array(MAPN * MAPN * 4);
    this.stateTex = new THREE.DataTexture(this.stateData, MAPN, MAPN, THREE.RGBAFormat);
    this.stateTex.minFilter = this.stateTex.magFilter = THREE.LinearFilter; this.stateTex.needsUpdate = true;
    this.scorchTex = this.stateTex; // (name used by the grass)
    this.heatBox = null;

    this.material = this._makeMaterial();
    // drawn as 8 x 8 tiles that share one set of vertices, so ground outside the view is skipped
    this.mesh = new THREE.Group();
    const TT = 8, tn = N / TT, span = SIZE / TT;
    for (let tz = 0; tz < TT; tz++) for (let tx = 0; tx < TT; tx++) {
      const ti = new Uint32Array(tn * tn * 6); let w = 0;
      for (let j = tz * tn; j < (tz + 1) * tn; j++) for (let i = tx * tn; i < (tx + 1) * tn; i++) { const a = i + j * VN, b = a + 1, c = a + VN, d = c + 1; ti[w++] = a; ti[w++] = c; ti[w++] = b; ti[w++] = b; ti[w++] = c; ti[w++] = d; }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', geo.attributes.position); tg.setAttribute('normal', geo.attributes.normal); tg.setIndex(new THREE.BufferAttribute(ti, 1));
      tg.boundingSphere = new THREE.Sphere(new THREE.Vector3(-HALF + (tx + 0.5) * span, 15, -HALF + (tz + 0.5) * span), span * 0.71 + 75);
      const m = new THREE.Mesh(tg, this.material); m.receiveShadow = true; m.castShadow = false; m.layers.set(LAYER_SCENE);
      this.mesh.add(m);
    }
    G.scene.add(this.mesh);

    // ---- outer landscape (hills, mountains): warped grid, dense near the playable square
    const M = 300, EXT = 4300;
    const og = new THREE.BufferGeometry();
    const op = new Float32Array((M + 1) * (M + 1) * 3);
    const warp = (t) => Math.sign(t) * Math.pow(Math.abs(t), 1.75) * EXT;
    for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) {
      const x = warp((i / M) * 2 - 1), z = warp((j / M) * 2 - 1), k = (i + j * (M + 1)) * 3;
      const inner = Math.max(Math.abs(x), Math.abs(z));
      op[k] = x; op[k + 2] = z;
      op[k + 1] = this.natural(x, z) - 1.0 * smoothstep(HALF + 40, HALF - 2, inner) - 6 * smoothstep(HALF - 10, HALF - 60, inner);
    }
    const oi = new Uint32Array(M * M * 6);
    q = 0;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const a = i + j * (M + 1), b = a + 1, c = a + M + 1, d = c + 1;
      oi[q++] = a; oi[q++] = c; oi[q++] = b; oi[q++] = b; oi[q++] = c; oi[q++] = d;
    }
    og.setAttribute('position', new THREE.BufferAttribute(op, 3));
    og.setIndex(new THREE.BufferAttribute(oi, 1));
    og.computeVertexNormals();
    this.outer = new THREE.Mesh(og, this.material);
    this.outer.receiveShadow = false; this.outer.frustumCulled = false; this.outer.layers.set(LAYER_SCENE);
    G.scene.add(this.outer);
    return this;
  }

  _updateNormals(i0, j0, i1, j1) {
    const H = this.heights, nor = this.geo.attributes.normal.array;
    i0 = clamp(i0, 0, N); i1 = clamp(i1, 0, N); j0 = clamp(j0, 0, N); j1 = clamp(j1, 0, N);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const hl = H[Math.max(i - 1, 0) + j * VN], hr = H[Math.min(i + 1, N) + j * VN];
      const hd = H[i + Math.max(j - 1, 0) * VN], hu = H[i + Math.min(j + 1, N) * VN];
      const nx = hl - hr, ny = 2 * CELL, nz = hd - hu;
      const l = 1 / Math.hypot(nx, ny, nz), k = (i + j * VN) * 3;
      nor[k] = nx * l; nor[k + 1] = ny * l; nor[k + 2] = nz * l;
    }
  }
  _uploadHeights() {
    const H = this.heights, D = this.heightData, f = THREE.DataUtils.toHalfFloat;
    for (let i = 0; i < H.length; i++) D[i] = f(H[i]);
    this.heightTex.needsUpdate = true;
  }

  _buildControl() {
    const data = new Uint8Array(MAPN * MAPN * 4);
    for (let j = 0; j < MAPN; j++) for (let i = 0; i < MAPN; i++) {
      const x = ((i + 0.5) / MAPN - 0.5) * SIZE, z = ((j + 0.5) / MAPN - 0.5) * SIZE;
      const [pave, dirt] = groundCover(x, z);
      const k = (i + j * MAPN) * 4;
      data[k] = pave * 255; data[k + 1] = dirt * 255; data[k + 2] = sat(1 - pave * 1.6 - dirt * 0.85) * 255; data[k + 3] = 255;
    }
    // no grass under water
    for (const L of LAKES) {
      const LR = L.r * 1.7;
      const i0 = Math.max(0, Math.floor(((L.x - LR) / SIZE + 0.5) * MAPN)), i1 = Math.min(MAPN - 1, Math.ceil(((L.x + LR) / SIZE + 0.5) * MAPN));
      const j0 = Math.max(0, Math.floor(((L.z - LR) / SIZE + 0.5) * MAPN)), j1 = Math.min(MAPN - 1, Math.ceil(((L.z + LR) / SIZE + 0.5) * MAPN));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = ((i + 0.5) / MAPN - 0.5) * SIZE, z = ((j + 0.5) / MAPN - 0.5) * SIZE;
        const ds = Math.hypot(x - L.x, z - L.z) * (1 + fbm2(x * 0.021 + L.x, z * 0.021 - L.z, 3) * 0.34);
        if (ds < L.r + 6) data[(i + j * MAPN) * 4 + 3] = 0;
        if (ds < L.r - 2) { data[(i + j * MAPN) * 4 + 2] = 0; data[(i + j * MAPN) * 4 + 1] = 200; }
      }
    }
    // gravel beds, and no grass, under the river and the reservoir
    {
      const b = RIVER.box, m = 14, R = RESERVOIR;
      const ix = (x) => Math.max(0, Math.min(MAPN - 1, Math.floor((x / SIZE + 0.5) * MAPN)));
      for (let j = ix(Math.min(b[1], R.z - R.r) - m); j <= ix(Math.max(b[3], R.z + R.r) + m); j++) for (let i = ix(Math.min(b[0], R.x - R.r) - m); i <= ix(Math.max(b[2], R.x + R.r) + m); i++) {
        const x = ((i + 0.5) / MAPN - 0.5) * SIZE, z = ((j + 0.5) / MAPN - 0.5) * SIZE, k = (i + j * MAPN) * 4;
        const rv = riverAt(x, z, RIVER.half + 4), inRes = Math.hypot(x - R.x, z - R.z) < R.r + 2 && this.heightFn(x, z) < R.level + 0.4;
        if (!rv && !inRes) continue;
        const wet = inRes || rv.d < RIVER.half + 1.5;
        data[k + 2] = wet ? 0 : Math.min(data[k + 2], 90); data[k + 1] = Math.max(data[k + 1], wet ? 210 : 150); data[k] = Math.min(data[k], wet ? 0 : 60);
      }
    }
    this.controlData = data;
    this.controlTex = new THREE.DataTexture(data, MAPN, MAPN, THREE.RGBAFormat);
    this.controlTex.minFilter = THREE.LinearMipmapLinearFilter; this.controlTex.magFilter = THREE.LinearFilter; this.controlTex.generateMipmaps = true;
    this.controlTex.needsUpdate = true;
  }

  _makeMaterial() {
    const T = G.tex;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 0.9 });
    const U = this.uniforms = {
      tGrassD: { value: T.grass_diff }, tGrassN: { value: T.grass_nor }, tDirtD: { value: T.gravel_diff }, tDirtN: { value: T.gravel_nor },
      tCliffD: { value: T.cliff_diff }, tCliffN: { value: T.cliff_nor }, tPaveD: { value: T.paving_diff }, tPaveN: { value: T.paving_nor },
      tControl: { value: this.controlTex }, tScorch: { value: this.stateTex }, tNoise: { value: G.noiseTex },
      uRune: { value: this.runes }, uRuneCol: { value: this.runeCols }, uTimeT: { value: 0 },
      uGrassTint: { value: new THREE.Color(0.62, 0.78, 0.42) },
    };
    const layer = (n, D, Nm, sc) => `
      vec2 uv_${n} = wuv * ${sc};
      vec3 c_${n} = mix(texture2D(${D}, uv_${n}).rgb, texture2D(${D}, uv_${n} * 0.21 + 0.37).rgb, 0.25 + 0.65 * farK);
      vec3 n_${n} = mix(texture2D(${Nm}, uv_${n}).xyz, texture2D(${Nm}, uv_${n} * 0.21 + 0.37).xyz, 0.25 + 0.65 * farK) * 2.0 - 1.0;`;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position; vWNrm = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying vec3 vWNrm;
          uniform sampler2D tGrassD, tGrassN, tDirtD, tDirtN, tCliffD, tCliffN, tPaveD, tPaveN, tControl, tScorch, tNoise;
          uniform vec4 uRune[2]; uniform vec4 uRuneCol[2]; uniform float uTimeT; uniform vec3 uGrassTint;
          ${GLSL_MAGIC_CIRCLE}`)
        .replace('#include <map_fragment>', `
          vec3 Nw = normalize(vWNrm);
          vec2 wuv = vWPos.xz;
          float camDist = length(vViewPosition);
          float farK = smoothstep(14.0, 120.0, camDist);
          vec2 cuv = wuv / ${SIZE.toFixed(1)} + 0.5;
          float inside = step(abs(wuv.x), ${HALF.toFixed(1)}) * step(abs(wuv.y), ${HALF.toFixed(1)});
          vec4 ctl = texture2D(tControl, cuv) * inside;
          float nzL = texture2D(tNoise, wuv * 0.0031).r;
          float nzM = texture2D(tNoise, wuv * 0.019).r;
          float nzH = texture2D(tNoise, wuv * 0.11).g;
          float slope = 1.0 - Nw.y;
          ${layer('grass', 'tGrassD', 'tGrassN', '0.22')}
          ${layer('dirt', 'tDirtD', 'tDirtN', '0.2')}
          ${layer('pave', 'tPaveD', 'tPaveN', '0.42')}
          // cliffs: triplanar so steep faces don't stretch
          vec3 bw = pow(abs(Nw), vec3(5.0)); bw /= (bw.x + bw.y + bw.z);
          float csc = mix(0.14, 0.011, smoothstep(150.0, 700.0, camDist));
          vec3 c_cliff = texture2D(tCliffD, vWPos.zy * csc).rgb * bw.x + texture2D(tCliffD, vWPos.xz * csc).rgb * bw.y + texture2D(tCliffD, vWPos.xy * csc).rgb * bw.z;
          vec3 n_cliff = texture2D(tCliffN, vWPos.xz * csc).xyz * 2.0 - 1.0;
          vec4 scr = texture2D(tScorch, cuv) * inside;
          c_grass *= mix(uGrassTint, vec3(0.42, 0.95, 0.3), scr.a * 0.8);
          float wCliff = smoothstep(0.22, 0.44, slope + (nzM - 0.5) * 0.18);
          float wDirt = clamp(ctl.g * 1.25 + smoothstep(0.56, 0.78, nzM * 0.65 + nzH * 0.35) * 0.5 * (1.0 - scr.a), 0.0, 1.0);
          wDirt = smoothstep(0.32, 0.66, wDirt + (nzH - 0.5) * 0.45 + (c_dirt.g - c_grass.g) * 0.4);
          float wPave = smoothstep(0.4, 0.6, ctl.r + (dot(c_pave, vec3(0.333)) - 0.3) * 0.5 + (nzH - 0.5) * 0.2);
          vec3 alb = c_grass; vec3 tNormalTS = n_grass; float tRough = 0.93;
          alb = mix(alb, c_dirt * 0.9, wDirt); tNormalTS = mix(tNormalTS, n_dirt, wDirt); tRough = mix(tRough, 0.88, wDirt);
          alb = mix(alb, c_pave * 0.95, wPave); tNormalTS = mix(tNormalTS, n_pave, wPave); tRough = mix(tRough, 0.78, wPave);
          alb = mix(alb, c_cliff * 0.85, wCliff); tNormalTS = mix(tNormalTS, n_cliff, wCliff); tRough = mix(tRough, 0.9, wCliff);
          float rr = length(wuv);
          float forest = smoothstep(0.42, 0.6, nzL) * smoothstep(560.0, 760.0, rr) * (1.0 - wCliff);
          alb = mix(alb, vec3(0.016, 0.028, 0.013), forest * 0.9);
          float snow = smoothstep(430.0, 600.0, vWPos.y + nzL * 190.0) * smoothstep(0.85, 0.4, slope);
          alb = mix(alb, vec3(0.86, 0.89, 0.96), snow); tRough = mix(tRough, 0.55, snow);
          alb *= 0.8 + 0.4 * nzL;
          float burn = smoothstep(0.04, 0.7, scr.r + (nzH - 0.5) * 0.3 * step(0.02, scr.r));
          alb = mix(alb, alb * 0.07 + vec3(0.011, 0.009, 0.008), burn);
          tRough = mix(tRough, 0.97, burn);
          // frost: rime creeping over everything, glassy where thick
          float frost = smoothstep(0.08, 0.75, scr.b + (nzH - 0.5) * 0.35 * step(0.02, scr.b));
          alb = mix(alb, vec3(0.78, 0.88, 0.97) * (0.85 + 0.3 * nzM), frost * 0.92);
          tRough = mix(tRough, 0.22 + 0.3 * nzH, frost);
          float tHeat = scr.g;
          diffuseColor.rgb = alb;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_maps>', `
          tNormalTS.xy *= mix(1.0, 0.45, farK) * (1.0 - frost * 0.6);
          vec3 tT = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
          vec3 tB = cross(tT, Nw);
          vec3 nW = normalize(tT * tNormalTS.x + tB * tNormalTS.y + Nw * max(tNormalTS.z, 0.2));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (tHeat > 0.003) {
            float cr = abs(texture2D(tNoise, wuv * 0.21).r - 0.5) + abs(texture2D(tNoise, wuv * 0.63 + 0.37).g - 0.4) * 0.5;
            float flick = texture2D(tNoise, wuv * 0.17 + vec2(uTimeT * 0.03, -uTimeT * 0.021)).r;
            float ember = pow(tHeat, 1.5) * (smoothstep(0.16, 0.02, cr) * 1.6 + 0.12) * (0.4 + 1.2 * flick);
            totalEmissiveRadiance += vec3(1.0, 0.2, 0.02) * ember * 5.0 + vec3(1.0, 0.55, 0.18) * pow(tHeat, 4.0) * 5.0;
          }
          for (int i = 0; i < 2; i++) {
            if (uRuneCol[i].a > 0.001) {
              vec2 rp = (wuv - uRune[i].xy) / uRune[i].z;
              if (dot(rp, rp) < 1.2) {
                float mc = magicCircle(rp, uTimeT * uRune[i].w);
                float glow = exp(-dot(rp, rp) * 2.5) * 0.06;
                totalEmissiveRadiance += uRuneCol[i].rgb * (mc + glow) * uRuneCol[i].a;
              }
            }
          }`);
    };
    return m;
  }

  // ---- gameplay API ------------------------------------------------------------
  setRune(i, x, z, radius, color, intensity, spin = 1) {
    this.runes[i].set(x, z, radius, spin);
    if (color) this.runeCols[i].set(color.r, color.g, color.b, intensity); else this.runeCols[i].w = intensity;
  }

  // paint the state map. ch: 'burn' | 'frost' | 'bloom'. amount may be negative (e.g. healing burns)
  paint(ch, x, z, radius, amount = 1, heat = 0) {
    const cx = (x / SIZE + 0.5) * MAPN, cz = (z / SIZE + 0.5) * MAPN, rp = Math.max(1.2, (radius / SIZE) * MAPN);
    const i0 = Math.max(0, Math.floor(cx - rp)), i1 = Math.min(MAPN - 1, Math.ceil(cx + rp));
    const j0 = Math.max(0, Math.floor(cz - rp)), j1 = Math.min(MAPN - 1, Math.ceil(cz + rp));
    if (i0 > i1 || j0 > j1) return;
    const D = this.stateData, off = ch === 'frost' ? 2 : ch === 'bloom' ? 3 : 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz) / rp;
      if (d >= 1) continue;
      const f = 1 - d * d, k = i + j * MAPN;
      if (ch === 'burn') {
        this.burn[k] = clamp(this.burn[k] + f * f * amount * 1.3, 0, 1); D[k * 4] = this.burn[k] * 255;
        if (amount > 0) { D[k * 4 + 3] = Math.max(0, D[k * 4 + 3] - f * 255); D[k * 4 + 2] = Math.max(0, D[k * 4 + 2] - f * 200); }
        if (heat > 0) { this.heat[k] = Math.min(1, Math.max(this.heat[k], Math.pow(f, 1.5) * heat)); D[k * 4 + 1] = this.heat[k] * 255; }
      } else D[k * 4 + off] = clamp(D[k * 4 + off] + f * f * amount * 330, 0, 255);
    }
    this.stateDirty = true;
    if (heat > 0) {
      this.heatActive = true;
      const b = this.heatBox;
      this.heatBox = b ? [Math.min(b[0], i0), Math.min(b[1], j0), Math.max(b[2], i1), Math.max(b[3], j1)] : [i0, j0, i1, j1];
    }
  }
  scorch(x, z, radius, amount = 1, heat = 1) { this.paint('burn', x, z, radius, amount, heat); }
  frost(x, z, radius, amount = 1) { this.paint('frost', x, z, radius, amount); this.paint('burn', x, z, radius, 0, 0); }
  bloom(x, z, radius, amount = 1) { this.paint('bloom', x, z, radius, amount); this.paint('burn', x, z, radius, -amount, 0); this.paint('frost', x, z, radius, -amount); }
  stateAt(x, z) { const i = clamp(((x / SIZE + 0.5) * MAPN) | 0, 0, MAPN - 1), j = clamp(((z / SIZE + 0.5) * MAPN) | 0, 0, MAPN - 1), k = (i + j * MAPN) * 4, D = this.stateData; return { burn: D[k] / 255, heat: D[k + 1] / 255, frost: D[k + 2] / 255, bloom: D[k + 3] / 255 }; }

  // General sculpting: fn(d01, wx, wz, h) -> new height for every vertex within `reach` of (x, z).
  // Really deforms the mesh, the grass height map and the physics collider.
  deform(x, z, reach, fn) {
    const H = this.heights;
    const i0 = Math.max(1, Math.floor((x - reach + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((x + reach + HALF) / CELL));
    const j0 = Math.max(1, Math.floor((z - reach + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((z + reach + HALF) / CELL));
    if (i0 > i1 || j0 > j1) return;
    const pos = this.geo.attributes.position.array;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const wx = -HALF + i * CELL, wz = -HALF + j * CELL, d = Math.hypot(wx - x, wz - z) / reach;
      if (d >= 1) continue;
      const k = i + j * VN;
      H[k] = fn(d, wx, wz, H[k]);
      pos[k * 3 + 1] = H[k];
    }
    this._updateNormals(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
    const g = this.geomDirty;
    this.geomDirty = g ? [Math.min(g[0], j0 - 1), Math.max(g[1], j1 + 1)] : [j0 - 1, j1 + 1];
    this.colliderDirty = true; this._markTiles(x - reach, z - reach, x + reach, z + reach);
    G.physics?.wakeArea(x, z, reach + 3);
    G.water?.terrainChanged(x - reach, z - reach, x + reach, z + reach);
  }
  // crater: bowl + raised rim
  crater(x, z, radius, depth) {
    this.deform(x, z, radius * 1.7, (d, wx, wz, h) => {
      const n = 1 + fbm2(wx * 0.35, wz * 0.35, 2) * 0.35, q = (d * 1.7) / n;
      return h - depth * Math.pow(1 - smoothstep(0, 1, q), 1.3) + depth * 0.28 * Math.exp(-Math.pow((q - 1.02) / 0.24, 2));
    });
  }
  // raise (amount > 0) or sink (amount < 0) a rugged mound with radius r
  mound(x, z, r, amount, rough = 0.25) {
    this.deform(x, z, r, (d, wx, wz, h) => {
      const prof = Math.pow(1 - smoothstep(0, 1, d), 1.4);
      const n = 1 + fbm2(wx * 0.09 + 3, wz * 0.09 - 2, 3) * rough * 2.2;
      return h + amount * prof * n;
    });
  }

  // undo every deformation and wipe the state map (Restoration)
  restore() {
    this.heights.set(this.original);
    const pos = this.geo.attributes.position.array, H = this.heights;
    for (let j = 1; j < N; j++) for (let i = 1; i < N; i++) pos[(i + j * VN) * 3 + 1] = H[i + j * VN];
    this._updateNormals(0, 0, N, N);
    this.geomDirty = [0, N]; this.colliderDirty = true; this.colliderTimer = 0; this.tileDirty?.fill(1);
    this.burn.fill(0); this.heat.fill(0); this.stateData.fill(0); this.stateDirty = true; this.heatActive = false; this.heatBox = null;
    G.water?.terrainChanged(-HALF, -HALF, HALF, HALF);
  }

  // Physics heightfield, split into TILES x TILES colliders so that reshaping the ground only updates
  // (and therefore only wakes the bodies resting on) the tiles that actually changed.
  rebuildCollider(all = false) {
    const P = G.physics; if (!P) return;
    const R = P.RAPIER, TILES = 8, n = N / PHYS / TILES, vn = n + 1, size = SIZE / TILES;
    if (!this.tiles) { this.tiles = new Array(TILES * TILES).fill(null); this.tileDirty = new Uint8Array(TILES * TILES).fill(1); }
    for (let tz = 0; tz < TILES; tz++) for (let tx = 0; tx < TILES; tx++) {
      const k = tx + tz * TILES;
      if (!all && !this.tileDirty[k]) continue;
      const h = new Float32Array(vn * vn);
      for (let jx = 0; jx < vn; jx++) for (let iz = 0; iz < vn; iz++) h[iz + jx * vn] = this.heights[(tx * n + jx) * PHYS + (tz * n + iz) * PHYS * VN];
      if (this.tiles[k]) this.tiles[k].setShape(new R.Heightfield(n, n, h, { x: size, y: 1, z: size }));
      else this.tiles[k] = P.world.createCollider(R.ColliderDesc.heightfield(n, n, h, { x: size, y: 1, z: size }).setTranslation(-HALF + (tx + 0.5) * size, 0, -HALF + (tz + 0.5) * size).setFriction(0.95).setRestitution(0.05).setCollisionGroups(P.GROUP_TERRAIN));
      this.tileDirty[k] = 0;
    }
    this.collider = this.tiles[0];
    this.colliderDirty = false;
  }
  _markTiles(x0, z0, x1, z1) {
    if (!this.tileDirty) return;
    const TILES = 8, size = SIZE / TILES;
    const a0 = clamp(Math.floor((x0 + HALF - 2) / size), 0, TILES - 1), a1 = clamp(Math.floor((x1 + HALF + 2) / size), 0, TILES - 1);
    const b0 = clamp(Math.floor((z0 + HALF - 2) / size), 0, TILES - 1), b1 = clamp(Math.floor((z1 + HALF + 2) / size), 0, TILES - 1);
    for (let tz = b0; tz <= b1; tz++) for (let tx = a0; tx <= a1; tx++) this.tileDirty[tx + tz * TILES] = 1;
  }

  update(dt) {
    this.uniforms.uTimeT.value = G.time;
    if (this.geomDirty) {
      const [j0, j1] = this.geomDirty;
      const a = clamp(j0, 0, N), b = clamp(j1, 0, N);
      for (const name of ['position', 'normal']) {
        const at = this.geo.attributes[name];
        at.clearUpdateRanges(); at.addUpdateRange(a * VN * 3, (b - a + 1) * VN * 3); at.needsUpdate = true;
      }
      this._uploadHeights();
      this.geomDirty = null;
    }
    if (this.colliderDirty) { this.colliderTimer -= G.realDt; if (this.colliderTimer <= 0) { this.rebuildCollider(); this.colliderTimer = 0.2; } }
    if (this.heatActive && dt > 0) {
      this.heatTimer -= dt;
      if (this.heatTimer <= 0) {
        this.heatTimer = 0.1;
        const [i0, j0, i1, j1] = this.heatBox; let any = false;
        const k = Math.exp(-0.1 * 0.42), D = this.stateData;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const q = i + j * MAPN; let v = this.heat[q];
          if (v > 0) { v = v * k - 0.0018; if (v < 0) v = 0; else any = true; this.heat[q] = v; D[q * 4 + 1] = v * 255; }
        }
        this.stateDirty = true;
        if (!any) { this.heatActive = false; this.heatBox = null; }
      }
    }
    if (this.stateDirty) { this.stateTex.needsUpdate = true; this.stateDirty = false; }
  }
}
export const TERRAIN_CONST = { N, SIZE, CELL, VN, HALF, MAPN };
