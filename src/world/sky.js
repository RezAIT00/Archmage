// HDRI sky dome, image based lighting, sun light + shadows, and the "storm" state used by big spells.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { G, LAYER_SCENE } from '../core/globals.js';
import { damp } from '../core/util.js';

const DOME_VS = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww; // pin to far plane
}`;
const DOME_FS = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform sampler2D tSky, tNoise;
uniform float uRot, uGain, uStorm, uTime, uVortex, uNight, uEclipse;
uniform vec3 uSunVis;
float shash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
uniform vec3 uStormTint, uVortexDir, uVortexColor;
const float PI = 3.14159265;
vec2 equirect(vec3 d){ return vec2(atan(d.z, d.x) / (2.0*PI) + 0.5, asin(clamp(d.y,-1.0,1.0)) / PI + 0.5); }
void main(){
  vec3 d = normalize(vDir);
  float cs = cos(uRot), sn = sin(uRot);
  vec3 ld = vec3(cs*d.x + sn*d.z, d.y, -sn*d.x + cs*d.z);
  vec2 uv = equirect(ld);
  vec3 col = min(texture2D(tSky, uv).rgb, vec3(70.0)) * uGain;
  // storm: darken + desaturate towards a bruised tint, keep the horizon glowing
  float lum = dot(col, vec3(0.3, 0.6, 0.1));
  vec3 storm = mix(vec3(lum), col, 0.35) * uStormTint;
  col = mix(col, storm, uStorm);
  // swirling vortex of cloud opening above a point in the sky
  if (uVortex > 0.001) {
    vec3 vd = normalize(uVortexDir);
    float ang = acos(clamp(dot(d, vd), -1.0, 1.0));
    vec3 ref = abs(vd.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 t1 = normalize(cross(vd, ref)), t2 = cross(vd, t1);
    float az = atan(dot(d, t2), dot(d, t1));
    float swirl = az + 2.2 / (ang + 0.12) * 0.5 + uTime * 0.35;
    vec2 suv = vec2(swirl / (2.0*PI) * 2.0, ang * 1.6 - uTime * 0.05);
    float n = texture2D(tNoise, suv).r * 0.6 + texture2D(tNoise, suv * 2.3 + 0.37).g * 0.4;
    float band = smoothstep(1.25, 0.1, ang);
    float eye = smoothstep(0.02, 0.2, ang);
    float clouds = smoothstep(0.25, 0.8, n) * band;
    col = mix(col, col * 0.18, clouds * uVortex * eye);
    float rim = pow(n, 3.0) * band * 1.8;
    col += uVortexColor * (rim * eye + (1.0 - eye) * 6.0 + exp(-ang * 7.0) * 2.5) * uVortex;
  }
  // night: deep blue dusk with stars
  if (uNight > 0.001) {
    vec3 nightCol = col * vec3(0.035, 0.05, 0.1) + vec3(0.004, 0.007, 0.016) * (0.4 + d.y);
    vec2 suv = vec2(atan(d.z, d.x) * 210.0, asin(clamp(d.y, -1.0, 1.0)) * 330.0);
    vec2 sid = floor(suv); float sh = shash(sid);
    float star = step(0.972, sh) * smoothstep(0.34, 0.0, length(fract(suv) - 0.5)) * (0.5 + 0.5 * sin(uTime * (1.5 + sh * 4.0) + sh * 50.0));
    nightCol += vec3(0.9, 0.95, 1.0) * star * 2.4 * smoothstep(-0.02, 0.25, d.y) * (0.4 + sh);
    col = mix(col, nightCol, uNight);
  }
  // eclipse: a black disc swallowing the sun, ringed by a burning corona
  if (uEclipse > 0.001) {
    float ea = acos(clamp(dot(d, normalize(uSunVis)), -1.0, 1.0));
    float r0 = 0.05;
    float rays = 0.6 + 0.4 * sin(atan(d.y - uSunVis.y, dot(d - uSunVis, normalize(cross(uSunVis, vec3(0.0, 1.0, 0.0))))) * 14.0 + uTime * 0.3);
    float corona = exp(-max(ea - r0, 0.0) * 26.0) * 5.0 + exp(-max(ea - r0, 0.0) * 6.0) * 0.6 * rays;
    col = mix(col, col * smoothstep(r0 - 0.004, r0 + 0.004, ea), uEclipse);
    col += vec3(1.0, 0.55, 0.25) * corona * uEclipse * step(r0 - 0.002, ea);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor() {
    this.rot = 0; this.gain = 1; this.storm = 0; this.stormTarget = 0; this.vortex = 0; this.vortexTarget = 0;
    this.night = 0; this.nightTarget = 0; this.rain = 0; this.rainTarget = 0;
    this.baseSun = 0; this.baseEnv = 1.55;
  }

  async load(url, sunAzimuthDeg = 40) {
    const hdr = await new HDRLoader().loadAsync(url);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    hdr.minFilter = THREE.LinearFilter; hdr.magFilter = THREE.LinearFilter; hdr.generateMipmaps = false;
    hdr.wrapS = THREE.RepeatWrapping;
    const { width: w, height: h, data } = hdr.image;
    const half = data instanceof Uint16Array;
    const rd = half ? (v) => THREE.DataUtils.fromHalfFloat(v) : (v) => v;

    // ---- find the sun (brightest region) and build a small blurred copy used for fog colour
    let best = 0, bx = 0, by = 0;
    const lw = 64, lh = 32, bw = w / lw, bh = h / lh;
    const low = new Float32Array(lw * lh * 4), cnt = new Float32Array(lw * lh);
    const step = 4;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (x + y * w) * 4;
        const r = rd(data[i]), g = rd(data[i + 1]), b = rd(data[i + 2]);
        const lum = r * 0.3 + g * 0.6 + b * 0.1;
        if (lum > best) { best = lum; bx = x; by = y; }
        const li = (Math.min(lw - 1, (x / bw) | 0) + (lh - 1 - Math.min(lh - 1, (y / bh) | 0)) * lw); // row 0 of the low map = bottom (v=0)
        const c = 2.2; // clamp so the sun glow does not bleed into the fog colour
        low[li * 4] += Math.min(r, c); low[li * 4 + 1] += Math.min(g, c); low[li * 4 + 2] += Math.min(b, c); cnt[li]++;
      }
    }
    for (let i = 0; i < lw * lh; i++) { const n = Math.max(1, cnt[i]); low[i * 4] /= n; low[i * 4 + 1] /= n; low[i * 4 + 2] /= n; low[i * 4 + 3] = 1; }
    // horizontal+vertical blur passes for a smooth fog colour
    const tmp = new Float32Array(low.length);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) for (let c = 0; c < 3; c++) {
        let s = 0, n = 0;
        for (let k = -2; k <= 2; k++) { const xx = (x + k + lw) % lw; s += low[(xx + y * lw) * 4 + c]; n++; }
        tmp[(x + y * lw) * 4 + c] = s / n;
      }
      for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) for (let c = 0; c < 3; c++) {
        let s = 0, n = 0;
        for (let k = -1; k <= 1; k++) { const yy = Math.min(lh - 1, Math.max(0, y + k)); s += tmp[(x + yy * lw) * 4 + c]; n++; }
        low[(x + y * lw) * 4 + c] = s / n;
      }
    }
    this.skyLow = new THREE.DataTexture(low, lw, lh, THREE.RGBAFormat, THREE.FloatType);
    this.skyLow.minFilter = this.skyLow.magFilter = THREE.LinearFilter; this.skyLow.wrapS = THREE.RepeatWrapping; this.skyLow.needsUpdate = true;

    // sun direction in texture space (three's equirect convention), image row 0 = top? HDRLoader flips so v=1 is top.
    const u = (bx + 0.5) / w, v = hdr.flipY ? 1 - (by + 0.5) / h : (by + 0.5) / h;
    const phi = (u - 0.5) * Math.PI * 2, theta = (v - 0.5) * Math.PI;
    const texSun = new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi));
    // rotate the sky so that the sun sits at the requested azimuth (0 = -Z, positive = towards -X / left)
    const wantAz = Math.atan2(-Math.cos(THREE.MathUtils.degToRad(sunAzimuthDeg)), -Math.sin(THREE.MathUtils.degToRad(sunAzimuthDeg))); // atan2(z,x)
    const haveAz = Math.atan2(texSun.z, texSun.x);
    this.rot = wantAz - haveAz; // world dir = Ry(rot) applied in equirect azimuth space
    const el = Math.max(texSun.y, 0.27); // keep shadows from going infinitely long
    const cosEl = Math.sqrt(1 - el * el);
    this.sunDir = new THREE.Vector3(Math.cos(wantAz) * cosEl, el, Math.sin(wantAz) * cosEl).normalize();
    this.sunTexEl = texSun.y;
    { const e2 = Math.max(texSun.y, 0.07), c2 = Math.sqrt(1 - e2 * e2); this.sunVis = new THREE.Vector3(Math.cos(wantAz) * c2, e2, Math.sin(wantAz) * c2).normalize(); }
    G.sunDir = this.sunDir;

    // ---- clamped copy for IBL (the directional light provides the sun's direct energy)
    const envData = new Uint16Array(data.length);
    const CL = 6.0;
    for (let i = 0; i < data.length; i += 4) {
      envData[i] = THREE.DataUtils.toHalfFloat(Math.min(rd(data[i]), CL));
      envData[i + 1] = THREE.DataUtils.toHalfFloat(Math.min(rd(data[i + 1]), CL));
      envData[i + 2] = THREE.DataUtils.toHalfFloat(Math.min(rd(data[i + 2]), CL));
      envData[i + 3] = THREE.DataUtils.toHalfFloat(1);
    }
    const env = new THREE.DataTexture(envData, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
    env.mapping = THREE.EquirectangularReflectionMapping; env.flipY = hdr.flipY;
    env.minFilter = env.magFilter = THREE.LinearFilter; env.colorSpace = THREE.LinearSRGBColorSpace; env.needsUpdate = true;
    const pm = new THREE.PMREMGenerator(G.renderer);
    this.envRT = pm.fromEquirectangular(env);
    pm.dispose(); env.dispose();
    G.scene.environment = this.envRT.texture;
    // our dome rotates the *lookup*; three rotates the environment itself by the euler
    G.scene.environmentRotation.set(0, -this.rot, 0);

    // ---- dome
    this.mat = new THREE.ShaderMaterial({
      vertexShader: DOME_VS, fragmentShader: DOME_FS, side: THREE.BackSide, depthWrite: false, depthTest: true,
      uniforms: {
        tSky: { value: hdr }, tNoise: { value: G.noiseTex }, uRot: { value: this.rot }, uGain: { value: 0.46 }, uStorm: { value: 0 }, uTime: { value: 0 },
        uStormTint: { value: new THREE.Color(0.36, 0.3, 0.5) }, uVortex: { value: 0 }, uVortexDir: { value: new THREE.Vector3(0, 1, 0) }, uVortexColor: { value: new THREE.Color(1.0, 0.45, 0.2) }, uNight: { value: 0 }, uEclipse: { value: 0 }, uSunVis: { value: this.sunVis.clone() },
      },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.mat);
    this.dome.frustumCulled = false; this.dome.renderOrder = 1000; this.dome.layers.set(LAYER_SCENE);
    G.scene.add(this.dome);

    // ---- sun + shadow
    this.sunColor = new THREE.Color(1.0, 0.74, 0.5);
    G.sunColor = this.sunColor;
    const sun = new THREE.DirectionalLight(this.sunColor, 5.2);
    this.baseSun = sun.intensity;
    sun.target.position.set(0, 0, -6);
    sun.position.copy(this.sunDir).multiplyScalar(240).add(sun.target.position);
    sun.castShadow = true;
    const S = G.quality === 'low' ? 2048 : 4096;
    sun.shadow.mapSize.set(S, S);
    const sc = sun.shadow.camera;
    sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 20; sc.far = 620;
    sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.06; sun.shadow.radius = 2.2;
    sun.layers.enableAll();
    G.scene.add(sun, sun.target);
    this.sun = sun;
    // cool fill from the sky opposite the sun
    const hemi = new THREE.HemisphereLight(0x9db4ff, 0x5a4632, 0.7);
    hemi.layers.enableAll();
    G.scene.add(hemi);
    this.hemi = hemi; this.baseHemi = hemi.intensity;
    return this;
  }

  setStorm(amount, vortex = 0, dir = null, color = null) {
    this.stormTarget = amount; this.vortexTarget = vortex;
    if (dir) this.mat.uniforms.uVortexDir.value.copy(dir);
    if (color) this.mat.uniforms.uVortexColor.value.copy(color);
  }

  update(dt) {
    this.storm = damp(this.storm, this.stormTarget, this.stormTarget > this.storm ? 1.6 : 0.7, dt);
    this.vortex = damp(this.vortex, this.vortexTarget, 1.4, dt);
    // the shadow frustum follows the player, snapped to shadow texels so it never shimmers
    const pl = G.player;
    if (pl) {
      const R = this._sr || (this._sr = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize());
      const U = this._su || (this._su = new THREE.Vector3().crossVectors(this.sunDir, R).normalize());
      const tex = 300 / this.sun.shadow.mapSize.x, p = pl.pos;
      const r = Math.round(p.dot(R) / tex) * tex, uu = Math.round(p.dot(U) / tex) * tex;
      this.sun.target.position.copy(R).multiplyScalar(r).addScaledVector(U, uu);
      this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 300);
      this.sun.target.updateMatrixWorld();
    }
    const u = this.mat.uniforms;
    u.uStorm.value = this.storm; u.uVortex.value = this.vortex; u.uTime.value = G.time;
    this.night = damp(this.night, this.nightTarget, 0.9, dt); this.rain = damp(this.rain, this.rainTarget, 0.8, dt);
    u.uNight.value = this.night; u.uEclipse.value = this.night;
    const nk = 1 - this.night;
    const k = (1 - this.storm) * (0.22 + 0.78 * nk);
    this.sun.intensity = this.baseSun * (0.12 + 0.88 * k) * (0.5 + 0.5 * nk);
    this.sun.color.copy(this.sunColor).lerp(this._moon || (this._moon = new THREE.Color(0.45, 0.6, 1.0)), this.night);
    this.hemi.intensity = this.baseHemi * (0.3 + 0.7 * k) * (1 + 0.8 * this.night);
    G.scene.environmentIntensity = this.baseEnv * (0.22 + 0.78 * k) * (0.55 + 0.45 * nk);
    if (G.post) G.post.exposure = G.post.exposureBase * (1 + 1.25 * this.night);
    // rain: streaks around the camera, driven by the storm spell
    if (this.rain > 0.03 && G.particles && G.dt > 0) {
      const P = G.particles, c = G.camera.position, n = Math.round(240 * this.rain * (G.fx ? G.fx.density : 1));
      for (let i = 0; i < n; i++) P.spawn(c.x + (Math.random() - 0.5) * 70, c.y + 6 + Math.random() * 22, c.z + (Math.random() - 0.5) * 70, 7, -44, 3, 0.5, 0.03, 0.03, 0.5, 0.58, 0.68, 0.5, 0.5, 0.58, 0.68, 0.35, 0.01, 0, 1, 0, 1, 0, 0.021, 0.05);
    }
    const post = G.post;
    if (post) {
      const f = post.fogMat.uniforms;
      f.tSkyLow.value = this.skyLow; f.uSkyRot.value = this.rot; f.uSunDir.value.copy(this.sunDir);
      f.uSunColor.value.copy(this.sunColor).multiplyScalar(2.2 * (0.1 + 0.9 * k));
      f.uFogTint.value.setRGB((1 - 0.68 * this.storm) * (0.06 + 0.94 * nk), (1 - 0.74 * this.storm) * (0.08 + 0.92 * nk), (1 - 0.55 * this.storm) * (0.16 + 0.84 * nk));
      post.sunWorldDir.copy(this.sunDir);
      post.godrays = 1.0 * (0.15 + 0.85 * k);
    }
  }
}
