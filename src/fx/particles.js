// Stateless GPU particles: all motion is evaluated in the vertex shader from spawn data,
// so the CPU only writes new particles into a ring buffer. One draw call, premultiplied blending
// (a particle can be additive fire, lit smoke, or anything in between).
import * as THREE from 'three';
import { G, LAYER_FX, LAYER_DISTORT } from '../core/globals.js';
import { FX_DEPTH_GLSL } from '../render/post.js';

const STRIDE = 28;
export const K_PUFF = 0, K_STREAK = 1, K_DOT = 2, K_RING = 3;

const VS = /* glsl */ `
attribute vec4 aPosBirth, aVelLife, aCol0, aCol1, aSize, aKind, aExtra;
uniform float uTime; uniform vec3 uGravity;
varying vec2 vUv; varying vec4 vColor; varying vec4 vInfo; // kind, emissive, seed, t
varying vec3 vView; varying float vSize;
void main(){
  float age = uTime - aPosBirth.w, life = aVelLife.w, t = age / life;
  if (age < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float drag = max(aSize.z, 0.002), e = 1.0 - exp(-drag * age);
  vec3 g = uGravity * aSize.w;
  vec3 v0 = aVelLife.xyz;
  vec3 p; vec3 vel;
  float seed = aExtra.x;
  if (aExtra.y > 0.5) {
    // spiral into a centre stored in aVelLife.xyz
    vec3 rel = aPosBirth.xyz - v0; float k = 1.0 - t; k = k * k;
    float a = (1.0 - k) * aKind.w * 7.0; float cs = cos(a), sn = sin(a);
    vec3 r2 = vec3(cs * rel.x + sn * rel.z, rel.y, -sn * rel.x + cs * rel.z);
    p = v0 + r2 * k;
    vel = (vec3(-r2.z, 0.0, r2.x) * aKind.w * 2.0 - r2 * 2.0) * (0.5 + t * 3.0);
  } else {
    p = aPosBirth.xyz + (v0 - g / drag) * (e / drag) + (g / drag) * age;
    vel = (v0 - g / drag) * exp(-drag * age) + g / drag;
    float turb = aKind.y;
    if (turb > 0.0) {
      vec3 q = aPosBirth.xyz * 0.31 + vec3(seed * 13.0, age * 0.5, seed * 7.0);
      p += vec3(sin(q.y * 3.1 + q.x * 2.0), sin(q.x * 2.7 + q.z * 1.3 + 1.7) * 0.6, sin(q.z * 3.3 + q.y * 2.1 + 4.0)) * turb * (age + age * age * 0.3);
    }
  }
  float sc = 1.0 - (1.0 - t) * (1.0 - t);
  float size = mix(aSize.x, aSize.y, mix(t, sc, 0.7));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec2 c = position.xy;
  float kind = aKind.x;
  if (kind > 0.5 && kind < 1.5) {
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    float sp = length(vv.xy);
    vec2 dir = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0);
    float len = clamp(sp * aExtra.z, size, size * 26.0);
    mv.xy += dir * c.y * len + vec2(-dir.y, dir.x) * c.x * size;
  } else {
    float a = seed * 6.2831 + aKind.w * age * step(aExtra.y, 0.5);
    float cs = cos(a), sn = sin(a);
    mv.xy += vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) * size;
  }
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  float fadeIn = smoothstep(0.0, aExtra.w, t);
  float alpha = mix(aCol0.a, aCol1.a, t) * fadeIn * (1.0 - smoothstep(0.55, 1.0, t));
  alpha *= smoothstep(0.25, 1.1, -mv.z);
  vColor = vec4(mix(aCol0.rgb, aCol1.rgb, smoothstep(0.0, 1.0, t * 1.15)), alpha);
  vInfo = vec4(kind, aKind.z, seed, t);
  vView = mv.xyz; vSize = size;
}`;

const FS = /* glsl */ `
precision highp float;
${FX_DEPTH_GLSL}
uniform sampler2D tNoise; uniform float uTime;
uniform vec3 uSunDirV, uSunCol, uAmbient;
uniform vec4 uLPos[4]; uniform vec3 uLCol[4];
varying vec2 vUv; varying vec4 vColor; varying vec4 vInfo; varying vec3 vView; varying float vSize;
void main(){
  float kind = vInfo.x, emis = vInfo.y, seed = vInfo.z, t = vInfo.w;
  vec2 d = vUv - 0.5; float r = length(d) * 2.0;
  float alpha; vec3 rgb = vColor.rgb;
  #ifdef DISTORT
    float soft0 = softFade(max(vSize * 0.5, 0.2));
    vec2 nuv = vUv * 0.6 + vec2(seed * 7.3, seed * 3.1 + uTime * 0.25);
    vec2 n = texture2D(tNoise, nuv).rg - 0.5;
    float fall = smoothstep(1.0, 0.1, r);
    vec2 off = kind > 2.5 ? normalize(d + 1e-5) * smoothstep(0.25, 0.0, abs(r - 0.7)) : n * 2.0;
    gl_FragColor = vec4(off * fall * vColor.a * soft0 * 0.03 * vColor.r, 0.0, 1.0);
    return;
  #endif
  if (kind < 0.5) {
    // noise-eroded puff (fire / smoke / dust)
    vec2 nuv = (vUv - 0.5) * 0.42 + vec2(seed * 11.0, seed * 5.0);
    float n = texture2D(tNoise, nuv + vec2(0.0, -t * 0.12)).r;
    float n2 = texture2D(tNoise, nuv * 2.7 + 0.5).g;
    float shape = smoothstep(0.92, 0.25, r + (n - 0.5) * 1.25 + (n2 - 0.35) * 0.55);
    float er = t * 1.0 - 0.1;
    float erode = smoothstep(er, er + 0.22, n * 0.8 + n2 * 0.25 + shape * 0.2);
    alpha = shape * erode;
    // fake volumetric shading for smoke; emissive particles ignore it
    vec3 N = normalize(vec3(d * 2.0, 0.55) + vec3(n - 0.5, n2 - 0.5, 0.0) * 0.8);
    vec3 lit = uAmbient + uSunCol * (0.25 + 0.75 * max(dot(N, uSunDirV), 0.0));
    for (int i = 0; i < 4; i++) {
      vec3 L = uLPos[i].xyz - vView; float dl = length(L);
      float att = 1.0 / (1.0 + dl * dl / (uLPos[i].w * uLPos[i].w + 0.01));
      lit += uLCol[i] * att * (0.45 + 0.55 * max(dot(N, L / max(dl, 1e-3)), 0.0));
    }
    vec3 hot = rgb * (0.28 + n2 * 0.65 + shape * shape * 0.85) * mix(1.0, 0.5, t);
    rgb = mix(rgb * lit, hot, emis);
    alpha *= softFade(max(vSize * 0.45, 0.15));
  } else if (kind < 1.5) {
    float across = max(0.0, 1.0 - abs(d.x) * 2.0);
    float along = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
    alpha = across * across * along;
    rgb *= 1.0 + across * 1.5;
    alpha *= softFade(0.12);
  } else if (kind < 2.5) {
    alpha = exp(-r * r * 4.5) + exp(-r * r * 40.0) * 0.6;
    alpha *= smoothstep(1.0, 0.7, r);
    alpha *= softFade(max(vSize * 0.3, 0.1));
  } else {
    // expanding ring
    float w = 0.12;
    alpha = smoothstep(w, 0.0, abs(r - 0.82)) * (0.6 + 0.4 * texture2D(tNoise, vUv * 1.5 + seed).r);
    alpha *= softFade(max(vSize * 0.2, 0.1));
  }
  alpha *= vColor.a;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(rgb * alpha, alpha * (1.0 - emis));
}`;

export class ParticleSystem {
  constructor(capacity = 40000, distort = false) {
    this.cap = capacity; this.cursor = 0; this.dirtyFrom = -1; this.dirtyCount = 0;
    this.data = new Float32Array(capacity * STRIDE);
    for (let i = 0; i < capacity; i++) this.data[i * STRIDE + 3] = -1e6; // birth far in the past -> culled
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const ib = this.ib = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    const names = ['aPosBirth', 'aVelLife', 'aCol0', 'aCol1', 'aSize', 'aKind', 'aExtra'];
    names.forEach((n, i) => geo.setAttribute(n, new THREE.InterleavedBufferAttribute(ib, 4, i * 4)));
    geo.instanceCount = capacity;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = {
      ...G.fxU, tNoise: { value: G.noiseTex }, uGravity: { value: new THREE.Vector3(0, -9.8, 0) },
      uSunDirV: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uAmbient: { value: new THREE.Color(0.22, 0.25, 0.32) },
      uLPos: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uLCol: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: distort ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, defines: distort ? { DISTORT: 1 } : {},
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.layers.set(distort ? LAYER_DISTORT : LAYER_FX); this.mesh.renderOrder = distort ? 0 : 10;
    G.scene.add(this.mesh);
    this.distort = distort;
  }

  // kind: K_PUFF | K_STREAK | K_DOT | K_RING.  emis: 1 = additive glow, 0 = lit alpha-blended smoke.
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r0, g0, b0, a0, r1, g1, b1, a1, drag = 1, grav = 0, kind = 0, turb = 0, emis = 1, spin = 0, stretch = 0.03, fadeIn = 0.06, implode = 0, delay = 0) {
    if (G.timeScale < 0.9 && Math.random() > G.timeScale) return;
    const i = this.cursor, o = i * STRIDE, d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = G.time + delay;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = r0; d[o + 9] = g0; d[o + 10] = b0; d[o + 11] = a0;
    d[o + 12] = r1; d[o + 13] = g1; d[o + 14] = b1; d[o + 15] = a1;
    d[o + 16] = s0; d[o + 17] = s1; d[o + 18] = drag; d[o + 19] = grav;
    d[o + 20] = kind; d[o + 21] = turb; d[o + 22] = emis; d[o + 23] = spin;
    d[o + 24] = Math.random(); d[o + 25] = implode; d[o + 26] = stretch; d[o + 27] = fadeIn;
    if (this.dirtyFrom < 0) { this.dirtyFrom = i; this.dirtyCount = 1; } else this.dirtyCount++;
    this.cursor = (i + 1) % this.cap;
  }

  update() {
    if (this.dirtyFrom >= 0) {
      const ib = this.ib; ib.clearUpdateRanges();
      const from = this.dirtyFrom, n = Math.min(this.dirtyCount, this.cap);
      if (n >= this.cap) ib.addUpdateRange(0, this.cap * STRIDE);
      else if (from + n <= this.cap) ib.addUpdateRange(from * STRIDE, n * STRIDE);
      else { ib.addUpdateRange(from * STRIDE, (this.cap - from) * STRIDE); ib.addUpdateRange(0, (from + n - this.cap) * STRIDE); }
      ib.needsUpdate = true;
      this.dirtyFrom = -1; this.dirtyCount = 0;
    }
    if (this.distort) return;
    const U = this.uniforms, cam = G.camera;
    U.uSunDirV.value.copy(G.sunDir).transformDirection(cam.matrixWorldInverse);
    const k = G.sky ? G.sky.sun.intensity / G.sky.baseSun : 1;
    U.uSunCol.value.copy(G.sunColor).multiplyScalar(1.5 * k);
    U.uAmbient.value.setRGB(0.2 * (0.3 + 0.7 * k), 0.23 * (0.3 + 0.7 * k), 0.3 * (0.35 + 0.65 * k));
    const lights = G.fx ? G.fx.topLights(4) : [];
    for (let i = 0; i < 4; i++) {
      const L = lights[i];
      if (L) {
        U.uLPos.value[i].set(L.position.x, L.position.y, L.position.z, 1).applyMatrix4(cam.matrixWorldInverse); U.uLPos.value[i].w = L.userData.radius * 0.5;
        U.uLCol.value[i].set(L.color.r, L.color.g, L.color.b).multiplyScalar(L.intensity * 0.012);
      } else U.uLCol.value[i].set(0, 0, 0);
    }
  }
}
