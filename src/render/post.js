// HDR render pipeline:
//  scene (MSAA, depth) -> aerial fog composite -> FX layer (soft, depth tested in shader)
//  -> distortion buffer -> warp + lensing + camera motion blur -> god rays -> bloom -> filmic grade
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { G, LAYER_SCENE, LAYER_FX, LAYER_DISTORT } from '../core/globals.js';
import { damp } from '../core/util.js';

const VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// GLSL shared by every FX material: manual depth test against the opaque scene.
export const FX_DEPTH_GLSL = /* glsl */ `
uniform sampler2D uDepthTex; uniform vec2 uRes; uniform float uNear; uniform float uFar;
float linDepth(float d){ return uNear * uFar / (uFar - d * (uFar - uNear)); }
float sceneLinDepth(){ return linDepth(texture2D(uDepthTex, gl_FragCoord.xy / uRes).r); }
float softFade(float softness){ return clamp((sceneLinDepth() - linDepth(gl_FragCoord.z)) / softness, 0.0, 1.0); }
`;

const FOG_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor, tDepth, tSkyLow;
uniform mat4 uInvProj, uCamWorld;
uniform vec3 uCamPos, uSunDir, uSunColor, uFogTint;
uniform float uDensity, uFalloff, uBaseH, uSkyRot, uSkyGain, uNear, uFar, uAO, uTime;
uniform vec2 uTexel;
const float PI = 3.14159265;
vec2 equirect(vec3 d){ return vec2(atan(d.z, d.x) / (2.0*PI) + 0.5, asin(clamp(d.y,-1.0,1.0)) / PI + 0.5); }
float lin(float d){ return uNear * uFar / (uFar - d * (uFar - uNear)); }
vec3 viewPos(vec2 uv, float d){ vec4 p = uInvProj * vec4(uv*2.0-1.0, d*2.0-1.0, 1.0); return p.xyz / p.w; }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).r;
  if (d < 0.999999) {
    vec3 vp = viewPos(vUv, d);
    // ---- cheap depth-only ambient occlusion (crevices between stones, contact darkening)
    if (uAO > 0.0 && -vp.z < 90.0) {
      vec3 dx = viewPos(vUv + vec2(uTexel.x, 0.0), texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).r) - vp;
      vec3 dx2 = vp - viewPos(vUv - vec2(uTexel.x, 0.0), texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).r);
      vec3 dy = viewPos(vUv + vec2(0.0, uTexel.y), texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).r) - vp;
      vec3 dy2 = vp - viewPos(vUv - vec2(0.0, uTexel.y), texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).r);
      if (abs(dx2.z) < abs(dx.z)) dx = dx2;
      if (abs(dy2.z) < abs(dy.z)) dy = dy2;
      vec3 n = normalize(cross(dx, dy));
      float radius = clamp(0.55 / -vp.z, 0.004, 0.09); // ~0.55m world radius in uv
      float ang = hash(gl_FragCoord.xy) * 6.2831;
      float occ = 0.0;
      for (int i = 0; i < 10; i++) {
        float fi = float(i);
        float r = radius * (fi + 0.5) / 10.0;
        float a = ang + fi * 2.39996;
        vec2 suv = vUv + vec2(cos(a) * (uTexel.x / uTexel.y), sin(a)) * r;
        vec3 sp = viewPos(suv, texture2D(tDepth, suv).r);
        vec3 v = sp - vp;
        float l = length(v);
        occ += max(dot(n, v / max(l, 1e-4)) - 0.12, 0.0) * smoothstep(1.4, 0.2, l);
      }
      float ao = 1.0 - clamp(occ / 10.0 * 2.2, 0.0, 1.0) * uAO * smoothstep(90.0, 50.0, -vp.z);
      col *= mix(1.0, ao, smoothstep(0.35, 1.2, -vp.z)); // spare the first-person hand
    }
    // ---- aerial perspective: exponential height fog coloured by the sky near the horizon
    vec3 wp = (uCamWorld * vec4(vp, 1.0)).xyz;
    vec3 rd = wp - uCamPos; float dist = length(rd); rd /= dist;
    float ry = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
    float amt = uDensity * exp(-uFalloff * (uCamPos.y - uBaseH)) * (1.0 - exp(-uFalloff * ry * dist)) / (uFalloff * ry);
    float fog = 1.0 - exp(-max(amt, 0.0));
    vec3 hd = normalize(vec3(rd.x, abs(rd.y) * 0.3 + 0.035, rd.z));
    float cs = cos(uSkyRot), sn = sin(uSkyRot);
    hd = vec3(cs*hd.x + sn*hd.z, hd.y, -sn*hd.x + cs*hd.z);
    vec3 fogCol = texture2D(tSkyLow, equirect(hd)).rgb * uSkyGain * uFogTint;
    float sunAmt = max(dot(rd, uSunDir), 0.0);
    fogCol += uSunColor * (pow(sunAmt, 10.0) * 0.1 + pow(sunAmt, 64.0) * 0.22) * uSkyGain;
    col = mix(col, fogCol, fog);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const WARP_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor, tDistort, tDepth;
uniform vec4 uLens; uniform float uAspect, uNear, uFar, uShutter, uTime;
uniform mat4 uReproj;
float lin(float d){ return uNear * uFar / (uFar - d * (uFar - uNear)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
vec2 lens(vec2 uv){
  if (uLens.w <= 0.0) return uv;
  vec2 dv = (uv - uLens.xy) * vec2(uAspect, 1.0);
  float r = length(dv); float R = uLens.z;
  float fall = smoothstep(R * 9.0, R * 1.5, r);
  float rr = r - (R * R) / max(r, 1e-3) * uLens.w * fall;
  return uLens.xy + (dv / max(r, 1e-4)) * rr / vec2(uAspect, 1.0);
}
void main(){
  vec2 off = texture2D(tDistort, vUv).rg;
  vec2 uv = lens(vUv + off);
  float hole = 1.0;
  if (uLens.w > 0.0) { float hr = length((vUv - uLens.xy) * vec2(uAspect, 1.0)); hole = smoothstep(uLens.z * 0.36, uLens.z * 0.43, hr); }
  float d = texture2D(tDepth, vUv).r;
  float ld = lin(d);
  vec2 vel = vec2(0.0);
  if (uShutter > 0.0 && ld > 1.1) {
    vec4 prev = uReproj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vel = (vUv - (prev.xy / prev.w * 0.5 + 0.5)) * uShutter;
    float l = length(vel);
    if (l > 0.035) vel *= 0.035 / l;
  }
  float ca = length(off) * 0.6;
  vec3 col = vec3(0.0); float wsum = 0.0;
  float j = hash(gl_FragCoord.xy) - 0.5;
  if (dot(vel, vel) > 1e-7) {
    for (int i = 0; i < 9; i++) {
      float t = (float(i) + j) / 8.0 - 0.5;
      vec2 suv = uv + vel * t;
      float sd = lin(texture2D(tDepth, suv).r);
      float w = sd > 1.1 ? 1.0 : 0.0;
      col += texture2D(tColor, suv).rgb * w; wsum += w;
    }
    col = wsum > 0.0 ? col / wsum : texture2D(tColor, uv).rgb;
  } else {
    col = texture2D(tColor, uv).rgb;
  }
  if (ca > 0.0005) {
    vec2 dir = off * 0.7;
    col.r = mix(col.r, texture2D(tColor, uv + dir).r, 0.85);
    col.b = mix(col.b, texture2D(tColor, uv - dir).b, 0.85);
  }
  gl_FragColor = vec4(col * hole, 1.0);
}`;

const RAYMASK_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor, tDepth; uniform vec2 uSunUv; uniform float uAspect;
void main(){
  float d = texture2D(tDepth, vUv).r;
  vec3 c = texture2D(tColor, vUv).rgb;
  vec2 dv = (vUv - uSunUv) * vec2(uAspect, 1.0);
  float near = exp(-dot(dv, dv) * 5.0);
  float sky = step(0.999999, d);
  gl_FragColor = vec4(min(c, vec3(3.5)) * sky * near, 1.0);
}`;
const RAYBLUR_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor; uniform vec2 uSunUv; uniform float uStep;
void main(){
  vec2 dir = (uSunUv - vUv) * uStep;
  vec3 c = vec3(0.0); vec2 uv = vUv;
  for (int i = 0; i < 8; i++) { c += texture2D(tColor, uv).rgb; uv += dir; }
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;
const ADD_FS = /* glsl */ `
precision highp float; varying vec2 vUv; uniform sampler2D tColor; uniform vec3 uGain;
void main(){ gl_FragColor = vec4(texture2D(tColor, vUv).rgb * uGain, 1.0); }`;

const BLOOM_DOWN_FS = /* glsl */ `
precision highp float;
varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uTexel; uniform float uFirst, uThreshold;
vec3 pre(vec3 c){
  if (uFirst < 0.5) return c;
  c = min(c, vec3(60.0));
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.6;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee); soft = soft * soft / (4.0 * knee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}
float karis(vec3 c){ return uFirst > 0.5 ? 1.0 / (1.0 + max(c.r, max(c.g, c.b)) * 0.5) : 1.0; }
void main(){
  vec2 t = uTexel;
  vec3 a = pre(texture2D(tColor, vUv + t * vec2(-2.0, 2.0)).rgb), b = pre(texture2D(tColor, vUv + t * vec2(0.0, 2.0)).rgb), c = pre(texture2D(tColor, vUv + t * vec2(2.0, 2.0)).rgb);
  vec3 d = pre(texture2D(tColor, vUv + t * vec2(-2.0, 0.0)).rgb), e = pre(texture2D(tColor, vUv).rgb), f = pre(texture2D(tColor, vUv + t * vec2(2.0, 0.0)).rgb);
  vec3 g = pre(texture2D(tColor, vUv + t * vec2(-2.0, -2.0)).rgb), h = pre(texture2D(tColor, vUv + t * vec2(0.0, -2.0)).rgb), i = pre(texture2D(tColor, vUv + t * vec2(2.0, -2.0)).rgb);
  vec3 j = pre(texture2D(tColor, vUv + t * vec2(-1.0, 1.0)).rgb), k = pre(texture2D(tColor, vUv + t * vec2(1.0, 1.0)).rgb);
  vec3 l = pre(texture2D(tColor, vUv + t * vec2(-1.0, -1.0)).rgb), m = pre(texture2D(tColor, vUv + t * vec2(1.0, -1.0)).rgb);
  vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25, g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
  float w0 = karis(g0) * 0.5, w1 = karis(g1) * 0.125, w2 = karis(g2) * 0.125, w3 = karis(g3) * 0.125, w4 = karis(g4) * 0.125;
  gl_FragColor = vec4((g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4), 1.0);
}`;
const BLOOM_UP_FS = /* glsl */ `
precision highp float;
varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uTexel; uniform float uWeight;
void main(){
  vec2 t = uTexel;
  vec3 c = texture2D(tColor, vUv).rgb * 4.0;
  c += (texture2D(tColor, vUv + vec2(t.x, 0.0)).rgb + texture2D(tColor, vUv - vec2(t.x, 0.0)).rgb + texture2D(tColor, vUv + vec2(0.0, t.y)).rgb + texture2D(tColor, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture2D(tColor, vUv + t).rgb + texture2D(tColor, vUv - t).rgb + texture2D(tColor, vUv + vec2(t.x, -t.y)).rgb + texture2D(tColor, vUv + vec2(-t.x, t.y)).rgb;
  gl_FragColor = vec4(c / 16.0 * uWeight, 1.0);
}`;

const FINAL_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor, tBloom, tStreak;
uniform float uExposure, uBloom, uCA, uVignette, uGrain, uTime, uLetterbox, uFade, uSat, uContrast, uAspect, uRadialBlur, uStreak;
uniform vec4 uFlash; uniform vec3 uTint; uniform vec2 uBlurCenter;
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(outM * RRTAndODTFit(inM * (c / 0.6)), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 fetch(vec2 uv){
  vec2 dc = uv - 0.5; float r2 = dot(dc, dc);
  float ca = uCA * (0.35 + r2 * 3.5) * 0.006;
  vec3 c;
  c.r = texture2D(tColor, uv + dc * ca).r; c.g = texture2D(tColor, uv).g; c.b = texture2D(tColor, uv - dc * ca).b;
  return c;
}
void main(){
  vec2 uv = vUv;
  vec3 col;
  if (uRadialBlur > 0.001) {
    vec2 dir = (uBlurCenter - uv) * uRadialBlur * 0.06; col = vec3(0.0);
    float j = hash(gl_FragCoord.xy + uTime * 60.0);
    for (int i = 0; i < 8; i++) col += fetch(uv + dir * (float(i) + j));
    col /= 8.0;
  } else col = fetch(uv);
  vec3 bloom = texture2D(tBloom, uv).rgb;
  col += bloom * uBloom;
  col += texture2D(tStreak, uv).rgb * uStreak * vec3(0.55, 0.75, 1.0);
  col *= uExposure;
  col += uFlash.rgb * uFlash.a;
  col = aces(col);
  // grade: gentle contrast, saturation, teal shadows / warm highlights
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  col = (col - 0.5) * uContrast + 0.5;
  col += (vec3(-0.012, 0.004, 0.022) * (1.0 - l) + vec3(0.022, 0.008, -0.02) * l) * 1.0;
  col *= uTint;
  vec2 vc = (uv - 0.5) * vec2(1.0, 1.0);
  float vig = smoothstep(1.05, 0.25, length(vc) * 1.25);
  col *= mix(1.0, vig, uVignette);
  col = max(col, 0.0);
  float g = hash(gl_FragCoord.xy + fract(uTime) * 311.7) - 0.5;
  col += g * uGrain * (0.6 + 0.4 * (1.0 - l));
  col *= uFade;
  float bar = uLetterbox * 0.5 * (1.0 - (uAspect / 2.39));
  if (bar > 0.0 && (uv.y < bar || uv.y > 1.0 - bar)) col = vec3(0.0);
  col = toSRGB(clamp(col, 0.0, 1.0));
  col += (hash(gl_FragCoord.xy * 1.7) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;
const STREAK_FS = /* glsl */ `
precision highp float; varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uDir;
void main(){
  vec3 c = vec3(0.0); float ws = 0.0;
  for (int i = -7; i <= 7; i++) { float w = 1.0 - abs(float(i)) / 8.0; c += texture2D(tColor, vUv + uDir * float(i)).rgb * w; ws += w; }
  gl_FragColor = vec4(c / ws, 1.0);
}`;

function mkRT(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, ...opts,
  });
}
const mat = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });

export class Post {
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.msaa = opts.msaa ?? 4;
    this.bloomLevels = 6;
    this.fsq = new FullScreenQuad(null);
    G.fxU = { uDepthTex: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: camera.near }, uFar: { value: camera.far }, uTime: { value: 0 } };

    this.fogMat = mat(FOG_FS, {
      tColor: { value: null }, tDepth: { value: null }, tSkyLow: { value: null },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 0.8, 0.6) }, uFogTint: { value: new THREE.Color(1, 1, 1) },
      uDensity: { value: 0.00026 }, uFalloff: { value: 0.006 }, uBaseH: { value: 0 }, uSkyRot: { value: 0 }, uSkyGain: { value: 1 },
      uNear: { value: camera.near }, uFar: { value: camera.far }, uAO: { value: opts.ao ?? 1 }, uTime: { value: 0 }, uTexel: { value: new THREE.Vector2() },
    });
    this.warpMat = mat(WARP_FS, {
      tColor: { value: null }, tDistort: { value: null }, tDepth: { value: null }, uLens: { value: new THREE.Vector4(0.5, 0.5, 0.1, 0) },
      uAspect: { value: 1 }, uNear: { value: camera.near }, uFar: { value: camera.far }, uShutter: { value: 0 }, uTime: { value: 0 }, uReproj: { value: new THREE.Matrix4() },
    });
    this.rayMaskMat = mat(RAYMASK_FS, { tColor: { value: null }, tDepth: { value: null }, uSunUv: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
    this.rayBlurMat = mat(RAYBLUR_FS, { tColor: { value: null }, uSunUv: { value: new THREE.Vector2() }, uStep: { value: 0.05 } });
    this.addMat = mat(ADD_FS, { tColor: { value: null }, uGain: { value: new THREE.Vector3(1, 1, 1) } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.downMat = mat(BLOOM_DOWN_FS, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 1.15 } });
    this.upMat = mat(BLOOM_UP_FS, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.streakMat = mat(STREAK_FS, { tColor: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.finalMat = mat(FINAL_FS, {
      tColor: { value: null }, tBloom: { value: null }, tStreak: { value: null },
      uExposure: { value: 1.0 }, uBloom: { value: 0.024 }, uCA: { value: 0.35 }, uVignette: { value: 0.75 }, uGrain: { value: 0.022 }, uTime: { value: 0 },
      uLetterbox: { value: 0 }, uFade: { value: 1 }, uSat: { value: 1.17 }, uContrast: { value: 1.13 }, uAspect: { value: 1 }, uRadialBlur: { value: 0 }, uStreak: { value: 0.35 },
      uFlash: { value: new THREE.Vector4(1, 1, 1, 0) }, uTint: { value: new THREE.Color(1, 1, 1) }, uBlurCenter: { value: new THREE.Vector2(0.5, 0.5) },
    });

    // dynamic state driven by gameplay
    this.exposure = 0.66; this.exposureBase = 0.66; this.exposureKick = 0;
    this.flashA = 0; this.flashColor = new THREE.Color(1, 1, 1);
    this.caKick = 0; this.radialBlur = 0; this.letterbox = 0; this.letterboxTarget = 0; this.fade = 1;
    this.lens = { active: false, pos: new THREE.Vector3(), radius: 1, strength: 0 };
    this.shutter = 0.55; this.godrays = 1.0; this.sunWorldDir = new THREE.Vector3(0, 1, 0);
    this.prevViewProj = new THREE.Matrix4(); this.hasPrev = false; this.skipBlurFrames = 2;
    this._vp = new THREE.Matrix4(); this._ivp = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._v4 = new THREE.Vector4();
  }

  resize(w, h, scale = 1) {
    this.outW = w; this.outH = h;
    const W = Math.round(w * scale), H = Math.round(h * scale);
    this.W = W; this.H = H;
    for (const k of ['rtScene', 'rtComp', 'rtA', 'rtDistort', 'rtRayA', 'rtRayB', 'rtStreakA', 'rtStreakB']) this[k]?.dispose();
    this.bloomRT?.forEach((r) => r.dispose());
    const depthTexture = new THREE.DepthTexture(W, H);
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    this.rtScene = mkRT(W, H, { samples: this.msaa, depthBuffer: true, depthTexture });
    this.rtComp = mkRT(W, H);
    this.rtA = mkRT(W, H);
    this.rtDistort = mkRT(W / 2, H / 2);
    this.rtRayA = mkRT(W / 4, H / 4); this.rtRayB = mkRT(W / 4, H / 4);
    this.rtStreakA = mkRT(W / 8, H / 8); this.rtStreakB = mkRT(W / 8, H / 8);
    this.bloomRT = [];
    let bw = W, bh = H;
    for (let i = 0; i < this.bloomLevels; i++) { bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1); this.bloomRT.push(mkRT(bw, bh)); }
    this.hasPrev = false;
  }

  // ---- gameplay hooks ----
  flash(amount, color) { this.flashA = Math.min(1.6, this.flashA + amount); if (color) this.flashColor.copy(color); else this.flashColor.setRGB(1, 0.95, 0.88); }
  punch(amount) { this.caKick = Math.min(4, this.caKick + amount); this.exposureKick = Math.min(0.5, this.exposureKick + amount * 0.1); }
  cutBlur() { this.skipBlurFrames = 2; }

  _pass(material, target) {
    this.fsq.material = material;
    this.renderer.setRenderTarget(target);
    this.fsq.render(this.renderer);
  }

  render(dt) {
    const r = this.renderer, cam = this.camera, scene = this.scene;
    const W = this.W, H = this.H;
    cam.updateMatrixWorld();
    G.fxU.uTime.value = G.time;
    // decays
    this.flashA = Math.max(0, this.flashA - dt * (1.6 + this.flashA * 3.5));
    this.caKick = damp(this.caKick, 0, 5, dt);
    this.exposureKick = damp(this.exposureKick, 0, 1.4, dt);
    this.radialBlur = damp(this.radialBlur, 0, 4.5, dt);
    this.letterbox = damp(this.letterbox, this.letterboxTarget, 3, dt);

    r.autoClear = true;
    // A: opaque scene
    r.shadowMap.needsUpdate = true;
    cam.layers.set(LAYER_SCENE);
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 1);
    r.render(scene, cam);
    const depth = this.rtScene.depthTexture;

    // B: fog composite + FX layer
    const fu = this.fogMat.uniforms;
    fu.tColor.value = this.rtScene.texture; fu.tDepth.value = depth;
    fu.uInvProj.value.copy(cam.projectionMatrixInverse); fu.uCamWorld.value.copy(cam.matrixWorld); fu.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    fu.uTexel.value.set(1 / W, 1 / H); fu.uTime.value = G.time;
    this._pass(this.fogMat, this.rtComp);
    G.fxU.uDepthTex.value = depth; G.fxU.uRes.value.set(W, H);
    r.autoClear = false;
    cam.layers.set(LAYER_FX);
    r.setRenderTarget(this.rtComp);
    r.render(scene, cam);

    // C: distortion vectors
    G.fxU.uRes.value.set(this.rtDistort.width, this.rtDistort.height);
    cam.layers.set(LAYER_DISTORT);
    r.setRenderTarget(this.rtDistort);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.render(scene, cam);
    cam.layers.set(LAYER_SCENE);
    r.autoClear = true;

    // D: warp, lens, motion blur
    const wu = this.warpMat.uniforms;
    this._vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    wu.tColor.value = this.rtComp.texture; wu.tDistort.value = this.rtDistort.texture; wu.tDepth.value = depth;
    wu.uAspect.value = W / H; wu.uTime.value = G.time % 100;
    if (this.hasPrev && this.skipBlurFrames <= 0 && this.shutter > 0) {
      this._ivp.copy(this._vp).invert();
      wu.uReproj.value.multiplyMatrices(this.prevViewProj, this._ivp);
      // scale by frame time so blur stays consistent at any frame rate (reference 60 fps)
      wu.uShutter.value = this.shutter * G.cam.blur * Math.min(2, (1 / 60) / Math.max(G.realDt, 1e-3));
    } else wu.uShutter.value = 0;
    if (this.skipBlurFrames > 0) this.skipBlurFrames--;
    this.prevViewProj.copy(this._vp); this.hasPrev = true;
    if (this.lens.active && this.lens.strength > 0) {
      this._v4.set(this.lens.pos.x, this.lens.pos.y, this.lens.pos.z, 1).applyMatrix4(this._vp);
      if (this._v4.w > 0.1) {
        const ndcx = this._v4.x / this._v4.w, ndcy = this._v4.y / this._v4.w;
        const f = cam.projectionMatrix.elements[5];
        wu.uLens.value.set(ndcx * 0.5 + 0.5, ndcy * 0.5 + 0.5, (this.lens.radius * f) / this._v4.w * 0.5, this.lens.strength);
      } else wu.uLens.value.w = 0;
    } else wu.uLens.value.w = 0;
    this._pass(this.warpMat, this.rtA);

    // E: god rays
    this._v.copy(this.sunWorldDir).multiplyScalar(1000).add(fu.uCamPos.value);
    this._v4.set(this._v.x, this._v.y, this._v.z, 1).applyMatrix4(this._vp);
    const fwd = this._v.set(0, 0, -1).transformDirection(cam.matrixWorld).dot(this.sunWorldDir);
    if (this.godrays > 0.01 && this._v4.w > 0 && fwd > 0.15) {
      const su = this._v4.x / this._v4.w * 0.5 + 0.5, sv = this._v4.y / this._v4.w * 0.5 + 0.5;
      const mu = this.rayMaskMat.uniforms;
      mu.tColor.value = this.rtA.texture; mu.tDepth.value = depth; mu.uSunUv.value.set(su, sv); mu.uAspect.value = W / H;
      this._pass(this.rayMaskMat, this.rtRayA);
      const bu = this.rayBlurMat.uniforms; bu.uSunUv.value.set(su, sv);
      bu.tColor.value = this.rtRayA.texture; bu.uStep.value = 0.5 / 8; this._pass(this.rayBlurMat, this.rtRayB);
      bu.tColor.value = this.rtRayB.texture; bu.uStep.value = 0.25 / 8; this._pass(this.rayBlurMat, this.rtRayA);
      bu.tColor.value = this.rtRayA.texture; bu.uStep.value = 0.1 / 8; this._pass(this.rayBlurMat, this.rtRayB);
      const gain = this.godrays * 0.2 * Math.min(1, (fwd - 0.15) * 3.0);
      this.addMat.uniforms.tColor.value = this.rtRayB.texture; this.addMat.uniforms.uGain.value.set(gain, gain * 0.92, gain * 0.8);
      r.autoClear = false; this._pass(this.addMat, this.rtA); r.autoClear = true;
    }

    // F: bloom mip chain
    const du = this.downMat.uniforms, uu = this.upMat.uniforms;
    let src = this.rtA;
    for (let i = 0; i < this.bloomLevels; i++) {
      du.tColor.value = src.texture; du.uTexel.value.set(1 / src.width, 1 / src.height); du.uFirst.value = i === 0 ? 1 : 0;
      this._pass(this.downMat, this.bloomRT[i]);
      src = this.bloomRT[i];
    }
    // anamorphic streak from a mid mip (before upsampling pollutes it)
    const sm = this.streakMat.uniforms;
    sm.tColor.value = this.bloomRT[2].texture; sm.uDir.value.set(2.2 / this.rtStreakA.width, 0); this._pass(this.streakMat, this.rtStreakA);
    sm.tColor.value = this.rtStreakA.texture; sm.uDir.value.set(6.5 / this.rtStreakA.width, 0); this._pass(this.streakMat, this.rtStreakB);
    r.autoClear = false;
    const weights = [1.0, 1.0, 1.0, 1.0, 1.0];
    for (let i = this.bloomLevels - 1; i > 0; i--) {
      const lo = this.bloomRT[i], hi = this.bloomRT[i - 1];
      uu.tColor.value = lo.texture; uu.uTexel.value.set(1 / lo.width, 1 / lo.height); uu.uWeight.value = weights[i - 1];
      this._pass(this.upMat, hi);
    }
    r.autoClear = true;

    // G: final grade to screen
    const f = this.finalMat.uniforms;
    f.tColor.value = this.rtA.texture; f.tBloom.value = this.bloomRT[0].texture; f.tStreak.value = this.rtStreakB.texture;
    f.uExposure.value = this.exposure * (1 - this.exposureKick); f.uCA.value = (0.35 + this.caKick) * G.cam.ca; f.uGrain.value = 0.022 * G.cam.grain; f.uTime.value = G.realTime % 1000;
    f.uFlash.value.set(this.flashColor.r, this.flashColor.g, this.flashColor.b, this.flashA * G.cam.flash);
    f.uLetterbox.value = this.letterbox; f.uFade.value = this.fade; f.uAspect.value = this.outW / this.outH; f.uRadialBlur.value = this.radialBlur * G.cam.radial;
    this._pass(this.finalMat, null);
  }
}
