// Camera-following instanced grass (dense near layer + sparse far layer):
// wind, shockwave push fields, burning, distance LOD.
import * as THREE from 'three';
import { G, LAYER_SCENE } from '../core/globals.js';
import { makeRng } from '../core/util.js';
import { TERRAIN_CONST } from './terrain.js';

const MAX_PUSH = 5;

export class Grass {
  constructor(quality = 'high') {
    const live = G.liveSim ? 0.64 : 1, wide = G.liveSim ? 1.24 : 1;       // (fewer, slightly wider blades when playing live)
    const k = (quality === 'low' ? 0.3 : quality === 'medium' ? 0.6 : 1) * live;
    this.layerDefs = [
      { count: Math.round(210000 * k), patch: 40, bladeW: 0.026 * wide, bladeH: 0.5, lod: [1e3, 2e3], widen: 0.0, seed: 555 },
      { count: Math.round(190000 * k), patch: 130, bladeW: 0.034 * wide, bladeH: 0.56, lod: [10, 56], widen: 3.4, seed: 777 },
    ];
    this.push = []; for (let i = 0; i < MAX_PUSH; i++) this.push.push({ x: 0, z: 0, r: 0, w: 1, s: 0, speed: 0, age: 0, life: 0, hold: false });
    this.pushV = []; this.pushS = [];
    for (let i = 0; i < MAX_PUSH; i++) { this.pushV.push(new THREE.Vector4()); this.pushS.push(0); }
    this.layers = [];
  }

  build(terrain) {
    const SEG = 4;
    const pos = [], idx = [];
    for (let s = 0; s < SEG; s++) {
      const t = s / SEG, w = 1 - Math.pow(t, 1.5) * 0.85;
      pos.push(-0.5 * w, t, 0, 0.5 * w, t, 0);
    }
    pos.push(0, 1, 0);
    for (let s = 0; s < SEG - 1; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const a = (SEG - 1) * 2; idx.push(a, a + 1, a + 2);
    const { SIZE, CELL, VN, HALF } = TERRAIN_CONST;
    // uniforms shared by every layer
    const S = this.shared = {
      uCam: { value: new THREE.Vector3() }, tHeight: { value: terrain.heightTex }, tControl: { value: terrain.controlTex },
      tScorch: { value: terrain.scorchTex }, tNoise: { value: G.noiseTex }, uTimeG: { value: 0 },
      uTerrainUv: { value: new THREE.Vector2(1 / (CELL * VN), (HALF / CELL + 0.5) / VN) },
      uPush: { value: this.pushV }, uPushS: { value: this.pushS }, uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() }, uWind: { value: 1 },
      uSunDirView: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.8, 0.5) },
      uColBase: { value: new THREE.Color(0.07, 0.11, 0.03) }, uColTip: { value: new THREE.Color(0.2, 0.3, 0.06) }, uColDry: { value: new THREE.Color(0.42, 0.36, 0.11) },
    };
    for (const def of this.layerDefs) {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      geo.setIndex(idx);
      const rng = makeRng(def.seed);
      const off = new Float32Array(def.count * 2), rnd = new Float32Array(def.count * 4);
      for (let i = 0; i < def.count; i++) {
        off[i * 2] = rng() * def.patch; off[i * 2 + 1] = rng() * def.patch;
        rnd[i * 4] = rng(); rnd[i * 4 + 1] = rng(); rnd[i * 4 + 2] = rng(); rnd[i * 4 + 3] = rng();
      }
      geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 2));
      geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 4));
      geo.instanceCount = def.count;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      const U = { ...S, uPatch: { value: def.patch }, uBladeH: { value: def.bladeH }, uBladeW: { value: def.bladeW }, uLod: { value: new THREE.Vector3(def.lod[0], def.lod[1], def.widen) } };
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.74, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.8 });
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
            attribute vec2 aOffset; attribute vec4 aRand;
            uniform vec3 uCam, uLod; uniform float uPatch, uTimeG, uWind, uBladeH, uBladeW; uniform vec2 uTerrainUv, uWindDir;
            uniform sampler2D tHeight, tControl, tScorch, tNoise;
            uniform vec4 uPush[${MAX_PUSH}]; uniform float uPushS[${MAX_PUSH}];
            varying float vT; varying vec3 vBlade; varying vec2 vFrostG;`)
          .replace('#include <beginnormal_vertex>', `
            vec2 base = mod(aOffset - uCam.xz, uPatch) - uPatch * 0.5 + uCam.xz;
            float distCam = length(base - uCam.xz);
            float fade = 1.0 - smoothstep(uPatch * 0.34, uPatch * 0.495, distCam);
            float gh = texture2D(tHeight, base * uTerrainUv.x + uTerrainUv.y).r;
            vec2 cuv = base / ${SIZE.toFixed(1)} + 0.5;
            float density = texture2D(tControl, cuv).b;
            float inside = step(max(abs(base.x), abs(base.y)), ${(HALF - 1.5).toFixed(1)});
            vec4 stG = texture2D(tScorch, cuv);
            float burn = stG.r;
            density = max(density, stG.a * 1.2);
            float alive = step(0.5 + aRand.w * 0.45, density) * inside;
            float lod = smoothstep(uLod.x, uLod.y, distCam);
            alive *= step(lod * 0.86, aRand.z);
            float patchN = texture2D(tNoise, base * 0.008 + 0.3).r;
            float clump = texture2D(tNoise, base * 0.09).b;
            float hScale = (0.45 + aRand.y * 0.8) * (0.6 + patchN * 0.75 + clump * 0.35) * alive * fade * (1.0 - smoothstep(0.1, 0.5, burn) * 0.94);
            float bladeH = uBladeH * hScale;
            float ang = aRand.x * 6.2831853;
            vec2 bdir = vec2(cos(ang), sin(ang));
            vec2 perp = vec2(-bdir.y, bdir.x);
            float gust = texture2D(tNoise, base * 0.011 + uWindDir * uTimeG * 0.04).r;
            float gust2 = texture2D(tNoise, base * 0.06 + uWindDir * uTimeG * 0.13).g;
            float flutter = sin(uTimeG * 5.0 + aRand.x * 40.0 + base.x * 0.7) * 0.05;
            vec2 bend = uWindDir * ((gust * 1.1 + gust2 * 0.3) * uWind * 0.62 + flutter) + perp * (aRand.y - 0.5) * 0.6;
            for (int i = 0; i < ${MAX_PUSH}; i++) {
              if (abs(uPushS[i]) > 0.001) {
                vec2 d = base - uPush[i].xy; float dl = length(d) + 1e-3;
                float ring = exp(-pow((dl - uPush[i].z) / uPush[i].w, 2.0));
                bend += (d / dl) * ring * uPushS[i];
              }
            }
            float bl = length(bend); if (bl > 1.7) bend *= 1.7 / bl;
            float t = position.y;
            vec3 objectNormal = normalize(vec3(perp.x * 0.25 + bend.x * 0.4, 1.0, perp.y * 0.25 + bend.y * 0.4));
            vT = t; vBlade = vec3(smoothstep(0.3, 0.78, patchN * 0.75 + aRand.z * 0.4) * (1.0 - stG.a), burn, aRand.y); vFrostG = vec2(stG.b, stG.a);`)
          .replace('#include <begin_vertex>', `
            float curve = t * t;
            float wide = uBladeW * (1.0 + lod * uLod.z) * (0.7 + aRand.z * 0.6);
            vec3 transformed;
            transformed.xz = base + bdir * position.x * wide + bend * curve * bladeH;
            transformed.y = gh + t * bladeH * (1.0 - min(dot(bend, bend), 1.0) * 0.4 * curve) - 0.015;`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
            varying float vT; varying vec3 vBlade; varying vec2 vFrostG;
            uniform vec3 uColBase, uColTip, uColDry, uSunDirView, uSunCol;`)
          .replace('#include <map_fragment>', `
            vec3 tip = mix(uColTip, uColDry, vBlade.x) * (0.78 + vBlade.z * 0.5);
            vec3 gc = mix(uColBase, tip, smoothstep(0.0, 0.8, vT));
            gc = mix(gc, gc * vec3(0.75, 1.5, 0.7), vFrostG.y * 0.7);
            gc = mix(gc, vec3(0.012, 0.01, 0.008), smoothstep(0.05, 0.4, vBlade.y));
            gc = mix(gc, vec3(0.72, 0.85, 0.97), smoothstep(0.1, 0.6, vFrostG.x) * 0.9);
            diffuseColor.rgb = gc * mix(0.78, 1.0, vT);`)
          .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            float backlit = pow(max(dot(normalize(vViewPosition), -uSunDirView), 0.0), 3.0);
            totalEmissiveRadiance += uSunCol * diffuseColor.rgb * backlit * vT * 2.0 * (1.0 - smoothstep(0.05, 0.4, vBlade.y));`);
      };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.layers.set(LAYER_SCENE);
      G.scene.add(mesh);
      this.layers.push({ mesh, uniforms: U });
    }
    return this;
  }

  // expanding ring that flattens grass outward (strength < 0 pulls inward)
  shock(x, z, strength = 1.2, speed = 38, width = 3.5, life = 1.6) {
    let slot = this.push[0];
    for (const p of this.push) { if (p.life <= 0) { slot = p; break; } if (!p.hold && (slot.hold || p.life - p.age < slot.life - slot.age)) slot = p; }
    Object.assign(slot, { x, z, r: 0, w: width, s: strength, speed, age: 0, life, hold: false });
    return slot;
  }
  // persistent blob (black hole / hovering spell): caller updates fields and sets life = 0 to release
  blob(x, z, radius, strength) {
    const slot = this.shock(x, z, strength, 0, radius, 1e9);
    slot.hold = true; slot.r = 0;
    return slot;
  }

  update(dt, cam) {
    const U = this.shared;
    U.uCam.value.copy(cam.position); U.uTimeG.value = G.time;
    U.uSunDirView.value.copy(G.sunDir).transformDirection(cam.matrixWorldInverse);
    U.uSunCol.value.copy(G.sunColor).multiplyScalar(G.sky ? G.sky.sun.intensity / G.sky.baseSun : 1);
    for (let i = 0; i < MAX_PUSH; i++) {
      const p = this.push[i];
      if (p.life > 0) {
        if (!p.hold) { p.age += dt; p.r += p.speed * dt; if (p.age >= p.life) p.life = 0; }
        const k = p.hold ? 1 : Math.pow(Math.max(0, 1 - p.age / p.life), 1.5);
        this.pushV[i].set(p.x, p.z, p.r, p.w + (p.hold ? 0 : p.r * 0.12));
        this.pushS[i] = p.life > 0 ? p.s * k : 0;
      } else this.pushS[i] = 0;
    }
  }
}
