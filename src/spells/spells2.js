// The second half of the grimoire: world-shaping magic. Each entry is {press, hold, release, update}
// called by Spells (src/spells/spells.js). Half of these destroy the land, half of them create.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { rand, rr, randUnit, clamp, sat, lerp, damp, easeOutCubic, fbm2 } from '../core/util.js';
import { K_PUFF, K_STREAK, K_DOT, K_RING } from '../fx/particles.js';
import { WORLD_R } from '../world/layout.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = V(), _b = V(), _c = V(), _col = new THREE.Color();
const UP = V(0, 1, 0);
const gy = (x, z) => G.terrain.heightAt(x, z);
const ground = (p) => { p.y = gy(p.x, p.z); return p; };
const tapPose = (pose, col, kick = true) => { const H = G.hand; H.setPose(pose); H.setSpeed(12, 0.6); H.setGlow(col, 1.3); if (kick) H.kick(0, 0.2, -1.2, 1.8, 0, 0); G.player.recoil.kick(0.4); };
// put out every fire inside a radius
function quench(x, z, r) {
  const fx = G.fx; let n = 0;
  for (const e of fx.emitters) { if (!e.pos) continue; const dx = e.pos.x - x, dz = e.pos.z - z; if (dx * dx + dz * dz < r * r && e.life !== Infinity) { e.life = Math.min(e.life, e.age + 0.4); n++; } }
  G.forest?.extinguish(x, z, r);
  return n;
}
const steam = (p, n, size) => { for (let i = 0; i < n; i++) G.fx.P.spawn(p.x + rr(-2, 2) * size, p.y + rr(0, 1), p.z + rr(-2, 2) * size, rr(-1, 1), rr(2, 5), rr(-1, 1), rr(1.5, 3), size, size * 3.5, 0.8, 0.84, 0.88, 0.4, 0.8, 0.84, 0.88, 0, 0.8, -0.3, K_PUFF, 0.4, 0, rr(-0.5, 0.5), 0.03, 0.2); };

export const X = {
  // ================================================================ 6. EARTHSHATTER: a fissure tears across the land
  earthshatter: {
    press(s) {
      const pl = G.player, d = V(pl.forward.x, 0, pl.forward.z).normalize(), hit = s.aim(220);
      s.x.fis = { o: V(pl.pos.x, 0, pl.pos.z).addScaledVector(d, 5), d, perp: V(-d.z, 0, d.x), len: clamp(hit.dist + 25, 70, 210), dist: 0, t: 0, seed: rand() * 9 };
      tapPose('slam', s.current.color, false); G.hand.kick(0, -1.6, -0.3, -3.5, 0, 0);
      pl.addTrauma(0.6); s.say(s.current); s.cool.earthshatter = 3;
      G.audio?.play('quake'); G.post.punch(1.2);
    },
    update(s, dt) {
      const f = s.x.fis; if (!f || dt <= 0) return;
      f.t += dt;
      const fx = G.fx, T = G.terrain, ph = G.physics, upto = Math.min(f.len, f.t * 105);
      while (f.dist < upto) {
        f.dist += 4.4;
        const wob = Math.sin(f.dist * 0.09 + f.seed) * 6 + Math.sin(f.dist * 0.31 + f.seed * 2) * 1.6;
        const p = f.o.clone().addScaledVector(f.d, f.dist).addScaledVector(f.perp, wob); ground(p);
        const k = 0.55 + 0.45 * Math.sin((f.dist / f.len) * Math.PI), px = f.perp.x, pz = f.perp.z;
        T.deform(p.x, p.z, 9, (d, wx, wz, h) => {
          const lat = Math.abs((wx - p.x) * px + (wz - p.z) * pz), fade = Math.pow(1 - d, 0.7);
          return h - 7.5 * k * Math.exp(-Math.pow(lat / 1.7, 2)) * fade + 2.1 * k * Math.exp(-Math.pow((lat - 4.2) / 1.6, 2)) * fade * (0.6 + fbm2(wx * 0.4, wz * 0.4, 2));
        });
        T.scorch(p.x, p.z, 2.6, 1, 1);
        _a.copy(p); _a.y -= 1;
        ph.explode(_a, 10, 15, { up: 1.3, heat: 0.25, fracture: 1.25, speed: 300 });
        G.forest?.blast(p, 9, 1.1, 0.3); G.grass.shock(p.x, p.z, 1.2, 30, 3, 0.9);
        fx.dust(p, 7, 9, 2.2, 2.6, [0.4, 0.34, 0.27], 0.5, 0.9);
        fx.fire(p, 4, 9, 1.8, 0.7); fx.sparks(p, 12, 22, [14, 6, 1.2], 1.0, 1.4, 0.9, 0.05);
        if (rand() < 0.5) ph.spawnRubble(p, 3, 17, 0.45, 'stone', 0.8, 1.1);
        if (rand() < 0.35) fx.light(_a.copy(p).setY(p.y + 2), _col.setRGB(1, 0.45, 0.12), 2400, 40, 0.8);
        G.player.shakeFrom(p, 0.35, 120);
      }
      if (f.dist >= f.len) {
        // the whole district shudders
        const mid = f.o.clone().addScaledVector(f.d, f.len * 0.5);
        for (const b of ph.blocks) { if (!b.alive || b.fixed) continue; const dx = b.x - mid.x, dz = b.z - mid.z; if (dx * dx + dz * dz > 75 * 75) continue; const m = b.mass; b.body.applyImpulse({ x: rr(-3.2, 3.2) * m, y: rr(0.5, 2.5) * m, z: rr(-3.2, 3.2) * m }, true); ph.lightsOut(b); }
        s.x.fis = null;
      }
    },
  },

  // ================================================================ 7. DRAGON'S BREATH: a river of fire that starts wildfires
  dragon: {
    press(s) { const H = G.hand; H.setPose('palm'); H.setSpeed(9); H.setGlow(s.current.color, 1.4); H.trembleTarget = 0.6; s.say(s.current); s.x.dr = { t: 0, tick: 0, light: G.fx.light(H.palm, _col.setRGB(1, 0.5, 0.15), 1800, 45, 1, { hold: true, flicker: 0.35 }) }; G.audio?.loop('dragon', 'fire_roar', { vol: 0.85, rate: 0.9, fade: 0.12 }); G.audio?.loop('dragon2', 'fire_loop', { vol: 1.2, rate: 1.3, fade: 0.2 }); G.audio?.sample('fire_whoosh', { vol: 0.8 }); },
    hold(s, dt) {
      const D = s.x.dr, fx = G.fx, P = fx.P, H = G.hand, pl = G.player, d = pl.forward, o = _a.copy(H.palm).addScaledVector(d, 0.25).clone();
      D.t += dt; D.tick -= dt;
      const n = Math.ceil(8 * fx.density);
      for (let i = 0; i < n; i++) {
        randUnit(_b).multiplyScalar(0.16).add(d).normalize();
        const sp = rr(24, 40), s0 = rr(0.25, 0.5);
        P.spawn(o.x, o.y, o.z, _b.x * sp, _b.y * sp + 1.5, _b.z * sp, rr(0.7, 1.15), s0, s0 * rr(9, 14), 2.5, 0.78, 0.12, 0.6, 0.8, 0.08, 0.01, 0, 1.05, -0.35, K_PUFF, 0.55, 1, rr(-2, 2), 0.03, 0.04);
      }
      if (rand() < 0.5) { randUnit(_b).multiplyScalar(0.2).add(d).normalize(); P.spawn(o.x, o.y, o.z, _b.x * 26, _b.y * 26 + 2, _b.z * 26, rr(2.2, 3.6), 0.6, 7, 0.05, 0.047, 0.045, 0.5, 0.13, 0.125, 0.12, 0, 0.8, -0.3, K_PUFF, 0.5, 0, 0.3, 0.03, 0.3, 0, 0.3); }
      fx.sparks(o, 2, 30, [14, 6, 1.2], 0.9, 0.6, 0.1, 0.03);
      D.light.position.copy(o).addScaledVector(d, 12);
      pl.addTrauma(dt * 0.3); pl.recoil.kick(dt * 0.6);
      if (D.tick > 0) return;
      D.tick = 0.09;
      const ph = G.physics;
      for (let i = 0; i < 3; i++) {
        randUnit(_b).multiplyScalar(0.13).add(d).normalize();
        const hit = ph.raycast(pl.eye, _b, rr(18, 48));
        const p = hit ? hit.point : _c.copy(pl.eye).addScaledVector(_b, rr(14, 40)).clone();
        if (!hit) { const g = gy(p.x, p.z); if (p.y - g > 6) continue; p.y = g; }
        G.terrain.scorch(p.x, p.z, 3.4, 0.55, 1);
        G.forest?.igniteArea(p.x, p.z, 7, 0.8); G.forest?.igniteGround(p.x + rr(-2, 2), p.z + rr(-2, 2), 30);
        if (G.water?.at(p.x, p.z) && gy(p.x, p.z) < G.water.at(p.x, p.z).level) steam(p, 3, 1.6);
        for (const b of ph.blocksInRadius(p, 5.5, [])) {
          ph.heatBlock(b, 0.9, 0.22); ph.lightsOut(b);
          const m = b.mass; b.body.applyImpulse({ x: d.x * 2.2 * m, y: 1.2 * m, z: d.z * 2.2 * m }, true);
          if ((b.mat === 'wood' || b.mat === 'roof' || b.shape === 'prism') && rand() < 0.1) { if (rand() < 0.5) ph.fracture(b, d, 4, 1); else if (fx.emitters.length < 34) fx.groundFire(V(b.x, b.y + b.sy * 0.4, b.z), rr(1, 1.8), rr(8, 14)); }
          if (b.struct && b.house !== -1 && !fx.plumed.has(b.house) && fx.plumed.size < 26 && rand() < 0.06) { fx.plumed.add(b.house); fx.plume(V(b.x, gy(b.x, b.z) + 1, b.z), rr(16, 26)); }
        }
      }
    },
    release(s) { const D = s.x.dr; if (D) G.fx.releaseLight(D.light, 0.4); s.x.dr = null; G.hand.trembleTarget = 0; G.audio?.stopLoop('dragon', 0.3); G.audio?.stopLoop('dragon2', 0.6); s.cool.dragon = 0.4; },
  },

  // ================================================================ 8. ERUPTION: raise a volcano
  eruption: {
    press(s) {
      const hit = s.aim(300), p = ground(hit.point.clone());
      s.x.vol = { p, t: 0, tick: 0, bombT: 0, flowT: 0, bombs: [], walkers: [], rise: 3.6, life: 15, light: null };
      tapPose('raise', s.current.color, false); G.hand.setSpeed(3.5, 0.8); s.say(s.current); s.cool.eruption = 8;
      G.terrain.setRune(0, p.x, p.z, 30, _col.setRGB(4, 1.2, 0.2), 1.3, 0.6);
      G.audio?.play('erupt_start'); G.audio?.loop('lava', 'lava', { vol: 0.1, rate: 0.8, fade: 2 }); G.audio?.loop('volc', 'rumble_loop', { vol: 0.9, rate: 0.8, fade: 0.5 });
      G.sky.setStorm(0.45, 0);
    },
    update(s, dt) {
      const v = s.x.vol; if (!v || dt <= 0) return;
      const fx = G.fx, P = fx.P, T = G.terrain, ph = G.physics, p = v.p;
      v.t += dt; v.tick -= dt;
      const top = _a.set(p.x, gy(p.x, p.z), p.z).clone();
      if (v.t < v.rise) {
        // the ground heaves up into a cone
        if (v.tick <= 0) {
          v.tick = 0.1;
          T.mound(p.x, p.z, 38, 0.86, 0.22);
          T.scorch(p.x, p.z, 6 + v.t * 2, 0.5, 1);
          G.forest?.blast(p, 14 + v.t * 6, 0.5, 0.2); G.forest?.settle(p.x, p.z, 44);
          for (let i = 0; i < 4; i++) { const a = rand() * 6.28, r = rr(4, 30), q = V(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r); ground(q); fx.dust(q, 3, 6, 2.4, 2.4, [0.34, 0.3, 0.26], 0.5, 0.6); }
          if (rand() < 0.6) ph.spawnRubble(top, 3, 16, 0.5, 'stone', 0.6, 1);
          G.player.shakeFrom(p, 0.5, 260);
        }
        if (v.t > v.rise - 0.6) { G.hand.setPose('crush'); G.hand.setSpeed(11, 0.6); }
        return;
      }
      if (!v.blown) {
        v.blown = true; G.terrain.setRune(0, 0, 0, 1, null, 0);
        T.crater(p.x, p.z, 7, 5);
        fx.explosion(top.clone().add(V(0, 2, 0)), 3.4, { strength: 30, radius: 9, crater: false });
        fx.shockwave(top, 80, 1.5, 1.4, null, true);
        for (let i = 0; i < 7; i++) v.walkers.push({ x: p.x + rr(-3, 3), z: p.z + rr(-3, 3), a: rand() * 6.28, n: 0 });
        v.light = fx.light(top, _col.setRGB(1, 0.42, 0.1), 30000, 230, 1, { hold: true, flicker: 0.25 });
        G.audio?.play('explosion', { size: 4.2, pos: top }); G.audio?.setLoop('lava', { vol: 1.0, tau: 0.5 });
        G.post.flash(0.6); G.player.addTrauma(0.9);
      }
      const k = sat((v.life - v.t) / 3);
      const cone = top.clone(); cone.y += 1;
      v.light.position.set(cone.x, cone.y + 8, cone.z); v.light.userData.base = 30000 * k;
      // lava fountain + ash column
      const n = Math.ceil(12 * fx.density * k);
      for (let i = 0; i < n; i++) { const a = rand() * 6.28, sp = rr(2, 11); P.spawn(cone.x, cone.y, cone.z, Math.cos(a) * sp, rr(26, 52), Math.sin(a) * sp, rr(1.6, 3.2), rr(0.7, 1.5), 0.25, 9, 3.2, 0.5, 1, 2.5, 0.3, 0.02, 0.6, 0.25, 1.5, K_DOT, 0.2, 1); }
      for (let i = 0; i < Math.ceil(3 * k); i++) { const s0 = rr(4, 7), a = rand() * 6.28; P.spawn(cone.x + Math.cos(a) * 2, cone.y + 2, cone.z + Math.sin(a) * 2, rr(1, 4), rr(14, 24), rr(0.5, 3), rr(7, 12), s0, s0 * 5, 0.05, 0.044, 0.04, 0.82, 0.14, 0.13, 0.125, 0, 0.22, -0.1, K_PUFF, 0.5, 0, rr(-0.3, 0.3), 0.03, 0.08); }
      for (let i = 0; i < 2; i++) { const a = rand() * 6.28, s0 = rr(2, 4); P.spawn(cone.x + Math.cos(a) * 3, cone.y + 1, cone.z + Math.sin(a) * 3, Math.cos(a) * 3, rr(8, 16), Math.sin(a) * 3, rr(0.8, 1.5), s0, s0 * 2.5, 4.8, 1.5, 0.24, 0.9, 1, 0.1, 0.01, 0, 0.8, -0.4, K_PUFF, 0.5, 1, rr(-2, 2), 0.03, 0.1); }
      // lava bombs: real rocks, white hot, that blow up where they land
      v.bombT -= dt;
      if (v.bombT <= 0 && k > 0.2) {
        v.bombT = rr(0.14, 0.34);
        const a = rand() * 6.28, sp = rr(9, 34), sz = rr(0.7, 1.5);
        const b = ph.add({ shape: 'rock', x: cone.x, y: cone.y + 1.5, z: cone.z, sx: sz, sy: sz * 0.8, sz, sleeping: false, vel: { x: Math.cos(a) * sp, y: rr(30, 48), z: Math.sin(a) * sp }, angvel: { x: rr(-6, 6), y: rr(-6, 6), z: rr(-6, 6) }, rubble: true, life: 9, gen: 3, tint: 0.5, struct: false });
        if (b) { ph.heatBlock(b, 1, 0.3); v.bombs.push({ b, t: 0, prev: V(b.x, b.y, b.z) }); }
      }
      for (const m of v.bombs) {
        m.t += dt; const b = m.b;
        if (!b.alive) { m.dead = true; continue; }
        _b.set(b.x, b.y, b.z); fx.trailFire(m.prev, _b, 1.3, 1, true); m.prev.copy(_b);
        if (m.t > 0.6 && b.y - gy(b.x, b.z) < 1.4) { m.dead = true; fx.explosion(V(b.x, gy(b.x, b.z) + 0.8, b.z), rr(0.9, 1.4), { strength: 20 }); ph.remove(b); }
      }
      if (v.bombs.some((m) => m.dead)) v.bombs = v.bombs.filter((m) => !m.dead);
      // lava streams crawl downhill, burning what they touch
      v.flowT -= dt;
      if (v.flowT <= 0) {
        v.flowT = 0.07;
        for (const w of v.walkers) {
          const e = 2.2, gx = gy(w.x - e, w.z) - gy(w.x + e, w.z), gz = gy(w.x, w.z - e) - gy(w.x, w.z + e), gl = Math.hypot(gx, gz);
          if (gl > 0.02) { w.x += (gx / gl) * 1.5 + Math.cos(w.a) * 0.5; w.z += (gz / gl) * 1.5 + Math.sin(w.a) * 0.5; } else { w.x += Math.cos(w.a) * 1.2; w.z += Math.sin(w.a) * 1.2; }
          w.n++; T.scorch(w.x, w.z, 3.2, 1, 1);
          if (w.n % 3 === 0) { G.forest?.igniteArea(w.x, w.z, 6, 0.9); G.forest?.igniteGround(w.x + rr(-3, 3), w.z + rr(-3, 3), 12); for (const b of ph.blocksInRadius(_c.set(w.x, gy(w.x, w.z) + 1, w.z), 4, [])) ph.heatBlock(b, 1, 0.4); }
          if (rand() < 0.25) fx.fire(_c.set(w.x, gy(w.x, w.z) + 0.3, w.z), 2, 2.5, 1.6, 0.7);
          if (w.n > 150) { w.x = p.x + rr(-3, 3); w.z = p.z + rr(-3, 3); w.n = 0; w.a = rand() * 6.28; }
        }
      }
      G.player.shakeFrom(p, 0.1 * k, 260);
      if (v.t >= v.life) { fx.releaseLight(v.light, 3); G.audio?.stopLoop('lava', 3); G.audio?.stopLoop('volc', 3); G.sky.setStorm(0, 0); s.x.vol = null; }
    },
  },

  // ================================================================ 9. WINTER'S GRASP: flash-freeze the land, ice erupts from the ground
  winter: {
    press(s) {
      const hit = s.aim(260), p = ground(hit.point.clone()), R = 50, spikes = [];
      spikes.push({ r: 0, a: 0, h: 19, w: 6.5 });
      for (let ring = 1; ring <= 5; ring++) { const n = 5 + ring * 3; for (let i = 0; i < n; i++) spikes.push({ r: ring * 8.2 + rr(-2.5, 2.5), a: (i / n) * 6.28 + rr(-0.25, 0.25) + ring, h: rr(4.5, 12) * (1.15 - ring * 0.1), w: rr(1.8, 3.6) }); }
      s.x.fr = { p, t: 0, r: 0, R, spikes, tick: 0 };
      tapPose('crush', s.current.color, false); s.say(s.current); s.cool.winter = 5;
      G.fx.shockwave(p.clone().add(V(0, 2, 0)), R * 1.2, 1.3, 1.1, _col.setRGB(0.6, 0.85, 1), true);
      G.fx.light(p.clone().add(V(0, 10, 0)), _col.setRGB(0.5, 0.75, 1), 9000, 110, 2.2);
      G.audio?.play('frost', { pos: p }); G.post.flash(0.35, _col.setRGB(0.7, 0.88, 1));
    },
    update(s, dt) {
      const f = s.x.fr; if (!f || dt <= 0) return;
      const fx = G.fx, P = fx.P, ph = G.physics, p = f.p;
      f.t += dt; f.r = Math.min(f.R, f.t * 30); f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = 0.1;
        G.terrain.frost(p.x, p.z, f.r + 4, 0.4);
        G.forest?.frostArea(p.x, p.z, f.r); G.water?.freeze(p.x, p.z, f.r * 0.9); quench(p.x, p.z, f.r);
        for (const b of ph.blocksInRadius(_a.set(p.x, p.y + 4, p.z), f.r, [])) { if (b.heat > 0) { b.heat = 0; } ph.lightsOut(b); }
      }
      for (const k of f.spikes) {
        if (k.done || k.r > f.r) continue;
        k.done = true;
        const x = p.x + Math.cos(k.a) * k.r, z = p.z + Math.sin(k.a) * k.r, g = gy(x, z);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(k.a) * rr(0.05, 0.3), rand() * 6.28, -Math.cos(k.a) * rr(0.05, 0.3), 'YXZ'));
        _a.set(x, g + 0.5, z);
        ph.explode(_a, k.w * 2.4 + 2, 13, { up: 1.5, heat: 0, fracture: 1.15, speed: 400 });
        const b = ph.add({ shape: 'pyr', mat: 'ice', x, y: g + k.h / 2 - 0.5, z, sx: k.w, sy: k.h, sz: k.w, q, struct: false });
        ph.growIn(b, 0, 0.16);
        fx.dust(_a, 5, 8, 1.6 + k.w * 0.4, 2, [0.78, 0.88, 0.97], 0.45, 0.9);
        fx.sparks(_a, 10, 16, [5, 9, 16], 0.8, 1.2, 0.8, 0.04);
        G.audio?.play('ice', { pos: _a, size: k.h > 12 ? 2 : 1 });
        G.player.shakeFrom(_a, 0.15 + k.h * 0.02, 110);
      }
      // drifting frost mist
      for (let i = 0; i < 3; i++) { const a = rand() * 6.28, r = Math.sqrt(rand()) * f.r, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, s0 = rr(2, 4); P.spawn(x, gy(x, z) + 0.5, z, rr(-0.6, 0.6), rr(0.1, 0.7), rr(-0.6, 0.6), rr(2.5, 5), s0, s0 * 2.2, 0.75, 0.86, 0.97, 0.22, 0.75, 0.86, 0.97, 0, 0.6, -0.02, K_PUFF, 0.3, 0, rr(-0.2, 0.2), 0.03, 0.3); }
      if (f.t > f.R / 30 + 2.5) s.x.fr = null;
    },
  },

  // ================================================================ 10. TEMPEST: a tornado that walks the land
  tempest: {
    press(s) {
      const pl = G.player, hit = s.aim(200), p = ground(hit.point.clone()), d = V(pl.forward.x, 0, pl.forward.z).normalize();
      s.x.tor = { p, d, t: 0, life: 14, wob: rand() * 9, blob: G.grass.blob(p.x, p.z, 16, -1.2), up: 0 };
      tapPose('raise', s.current.color, false); s.say(s.current); s.cool.tempest = 6;
      G.audio?.loop('tor', 'tempest_wind', { vol: 1.3, rate: 1.1, fade: 1.2 }); G.audio?.loop('tor2', 'rumble_loop', { vol: 0.7, rate: 1.2, fade: 1 }); G.audio?.sample('whoosh_big', { vol: 0.8, rate: 0.6 });
      G.sky.setStorm(0.6, 0);
    },
    update(s, dt) {
      const t = s.x.tor; if (!t || dt <= 0) return;
      const fx = G.fx, P = fx.P, ph = G.physics, p = t.p;
      t.t += dt;
      const k = Math.min(1, t.t / 1.5) * sat((t.life - t.t) / 2);
      p.x += (t.d.x * 7.5 + Math.sin(t.t * 0.7 + t.wob) * 4) * dt; p.z += (t.d.z * 7.5 + Math.cos(t.t * 0.55 + t.wob) * 4) * dt;
      if (Math.hypot(p.x, p.z) > WORLD_R + 20) t.t = Math.max(t.t, t.life - 1.5);
      ground(p);
      // over water the funnel becomes a waterspout: it drinks the lake, then rains it back down over the land
      const wat = G.water?.at(p.x, p.z);
      if (wat && wat.depth > 0.3) t.held = (t.held || 0) - G.water.addWater(p.x, p.z, 9, -520 * dt * k, 1);
      else if (t.held > 0) { const give = Math.min(t.held, 380 * dt); t.held -= give; G.water.addWater(p.x + rr(-12, 12), p.z + rr(-12, 12), 12, give, 1); }
      const spout = !!wat || t.held > 30;
      const R = 34 * k + 1;
      // funnel: debris and dust whipped around a rising column
      const n = Math.ceil(38 * fx.density * k);
      for (let i = 0; i < n; i++) {
        const h = Math.pow(rand(), 1.25) * 70, rad = 2.0 + h * 0.26 + rr(-0.8, 0.8), a = rand() * 6.28, cs = Math.cos(a), sn = Math.sin(a), tv = 20 + h * 0.2, s0 = 2.4 + h * 0.09;
        const lean = Math.sin(h * 0.06 + t.t * 1.3) * h * 0.08;
        const c = (0.2 + rand() * 0.14) * (spout ? 2.4 : 1), cb = spout ? 1.2 : 0.88;
        P.spawn(p.x + cs * rad + lean, p.y + h, p.z + sn * rad, -sn * tv - cs * 3, rr(5, 10), cs * tv - sn * 3, rr(0.45, 0.8), s0, s0 * 1.9, c * 1.1, c, c * cb, 0.6, c * 1.1, c, c * cb, 0, 0.35, 0, K_PUFF, 0.2, 0, rr(-2, 2), 0.03, 0.2);
      }
      for (let i = 0; i < 4; i++) { const a = rand() * 6.28, rad = rr(3, 22); P.spawn(p.x + Math.cos(a) * rad, p.y + 0.4, p.z + Math.sin(a) * rad, -Math.sin(a) * 26, rr(3, 12), Math.cos(a) * 26, rr(0.5, 1.1), 0.08, 0.04, 0.9, 0.8, 0.65, 0.9, 0.9, 0.8, 0.65, 0.4, 0.4, 0.3, K_STREAK, 0, 1, 0, 0.03, 0.1); }
      // physics: swirl, drag inward, lift
      const list = ph.blocks; let cracked = 0;
      for (let i = 0, m = list.length; i < m; i++) {
        const b = list[i]; if (!b.alive || b.fixed) continue;
        const dx = p.x - b.x, dz = p.z - b.z, d2 = dx * dx + dz * dz;
        if (d2 > R * R || b.y - p.y > 75) continue;
        const d = Math.sqrt(d2) + 0.01, q = 1 - d / R;
        if ((b.frozen || b.body.isSleeping()) && (d > 17 || rand() > dt * 6 * q)) continue;
        const mk = clamp(Math.pow(1 / Math.max(b.mass, 0.05), 0.3), 0.22, 1.7), inv = 1 / d;
        const ax = (dx * inv * 16 + -dz * inv * 34) * q * mk * dt, az = (dz * inv * 16 + dx * inv * 34) * q * mk * dt, ay = (28 * q * q + 5 * q) * mk * dt;
        b.body.applyImpulse({ x: ax * b.mass, y: ay * b.mass, z: az * b.mass }, true);
        b.pvx += ax; b.pvy += ay; b.pvz += az; ph.lightsOut(b);
        if (cracked < 3 && d < 11 && !b.rubble && b.gen < 2 && rand() < dt * 1.6) { ph.fracture(b, null, 3, 0); cracked++; }
      }
      let up = 0;
      G.forest?.each(p.x, p.z, R * 0.8, (tr, d, dx, dz) => { if (d < 11 && up < 2 && rand() < dt * 5) { G.forest.uproot(tr); up++; } else if (tr.state === 0 && rand() < dt * 1.5) G.forest.topple(tr, -dz, dx, 1.4); });
      t.blob.x = p.x; t.blob.z = p.z; t.blob.s = -1.5 * k;
      if (rand() < 0.3) G.terrain.paint('burn', p.x + rr(-3, 3), p.z + rr(-3, 3), 4, 0.1, 0);
      G.player.addTrauma(dt * 0.6 * k * clamp(1 - p.distanceTo(G.player.eye) / 170, 0.1, 1));
      G.audio?.setLoop('tor', { vol: (0.3 + k) * clamp(1.4 - p.distanceTo(G.player.eye) / 220, 0.25, 1.3), tau: 0.3 });
      if (t.t >= t.life) { t.blob.life = 0; G.audio?.stopLoop('tor', 2.5); G.audio?.stopLoop('tor2', 2); G.sky.setStorm(0, 0); s.x.tor = null; }
    },
  },

  // ================================================================ 11 / 12. STONESHAPE: raise mountains, open the abyss
  rise: {
    press(s) { tapPose('raise', s.current.color, false); G.hand.setSpeed(5); G.hand.trembleTarget = 0.5; s.say(s.current); s.x.tf = { tick: 0 }; G.audio?.loop('terra', 'earthquake', { vol: 0.8, rate: 0.8, fade: 0.2 }); G.audio?.loop('terra2', 'rumble_loop', { vol: 0.8, fade: 0.2 }); },
    hold(s, dt) { terraform(s, dt, +1); },
    release(s) { G.hand.trembleTarget = 0; G.audio?.stopLoop('terra', 0.6); G.audio?.stopLoop('terra2', 0.8); s.cool.rise = 0.3; G.terrain.setRune(0, 0, 0, 1, null, 0); },
  },
  abyss: {
    press(s) { tapPose('slam', s.current.color, false); G.hand.setSpeed(5); G.hand.trembleTarget = 0.5; s.say(s.current); s.x.tf = { tick: 0 }; G.audio?.loop('terra', 'earthquake', { vol: 0.8, rate: 0.65, fade: 0.2 }); G.audio?.loop('terra2', 'rumble_loop', { vol: 0.9, rate: 0.8, fade: 0.2 }); },
    hold(s, dt) { terraform(s, dt, -1); },
    release(s) { G.hand.trembleTarget = 0; G.audio?.stopLoop('terra', 0.6); G.audio?.stopLoop('terra2', 0.8); s.cool.abyss = 0.3; G.terrain.setRune(0, 0, 0, 1, null, 0); },
  },

  // ================================================================ 13. DELUGE: summon a lake, drown the streets
  deluge: {
    press(s) {
      const hit = s.aim(260), p = ground(hit.point.clone()), fx = G.fx;
      tapPose('palm', s.current.color); s.say(s.current); s.cool.deluge = 5;
      // A real mass of water is conjured over two seconds. It collapses outward as a wave and then goes
      // wherever the land sends it; cast on a lake it raises a tsunami.
      s.x.del = { p, t: 0, vol: 56000, dur: 2.2, r: 26 };
      G.physics.explode(_a.set(p.x, p.y + 0.5, p.z), 26, 9, { speed: 34, up: 0.25, heat: 0, fracture: 0.35 });
      fx.shockwave(p.clone().add(V(0, 1, 0)), 60, 1.6, 0.9, _col.setRGB(0.5, 0.8, 1), true);
      G.grass.shock(p.x, p.z, 1.8, 36, 6, 2);
      quench(p.x, p.z, 64); G.forest?.thawArea(p.x, p.z, 64);
      G.audio?.play('deluge', { pos: p });
      G.sky.rainTarget = 1; fx.after(7, () => { G.sky.rainTarget = 0; });
    },
    update(s, dt) {
      const d = s.x.del; if (!d || dt <= 0) return;
      d.t += dt; const P = G.fx.P, p = d.p;
      if (d.t < d.dur) {
        G.water.addWater(p.x, p.z, d.r, (d.vol * dt) / d.dur, 1.2);
        // the column of falling water
        for (let i = 0; i < 16; i++) { const a = rand() * 6.28, r = Math.sqrt(rand()) * d.r * 0.8, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, s0 = rr(2, 4); P.spawn(x, p.y + rr(18, 46), z, rr(-1, 1), rr(-42, -26), rr(-1, 1), rr(0.7, 1.1), s0, s0 * 1.6, 0.62, 0.74, 0.82, 0.5, 0.7, 0.8, 0.86, 0, 0.2, 0.6, K_PUFF, 0.2, 0, rr(-1, 1), 0.2, 0.05); }
        for (let i = 0; i < 10; i++) { const a = rand() * 6.28, r = Math.sqrt(rand()) * d.r, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; P.spawn(x, p.y + rr(20, 50), z, rr(-2, 2), rr(-50, -34), rr(-2, 2), rr(0.6, 1.0), 0.14, 0.07, 1.6, 1.9, 2.2, 1, 1, 1.2, 1.4, 0.4, 0.1, 1.0, K_DOT, 0, 1); }
        G.player.shakeFrom(p, 0.25, 220);
      }
      G.terrain.paint('burn', p.x + rr(-1, 1) * 40, p.z + rr(-1, 1) * 40, 9, -0.6, 0);
      if (d.t > 5) s.x.del = null;
    },
  },

  // ================================================================ 14. VERDANT BLOOM: life floods back
  bloom: {
    press(s) {
      const hit = s.aim(260), p = ground(hit.point.clone());
      s.x.bl = { p, t: 0, r: 0, R: 60, tick: 0 };
      tapPose('cup', s.current.color, false); G.hand.setSpeed(5); s.say(s.current); s.cool.bloom = 3;
      G.forest?.grow(p.x, p.z, 56, 90);
      G.fx.light(p.clone().add(V(0, 8, 0)), _col.setRGB(0.5, 1, 0.45), 5000, 120, 3.5);
      G.fx.shockwave(p.clone().add(V(0, 1, 0)), 60, 2.2, 0.6, _col.setRGB(0.5, 1, 0.5), true);
      G.audio?.play('bloom', { pos: p });
    },
    update(s, dt) {
      const b = s.x.bl; if (!b || dt <= 0) return;
      const T = G.terrain, P = G.fx.P, p = b.p;
      b.t += dt; b.r = Math.min(b.R, b.t * 20); b.tick -= dt;
      if (b.tick <= 0) {
        b.tick = 0.12;
        T.bloom(p.x, p.z, b.r + 3, 0.45);
        quench(p.x, p.z, b.r); G.forest?.thawArea(p.x, p.z, b.r); G.water?.thaw(p.x, p.z, b.r * 0.4);
      }
      // petals and pollen lifting off the new growth
      for (let i = 0; i < 9; i++) {
        const a = rand() * 6.28, r = Math.sqrt(rand()) * b.r, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, pink = rand() < 0.35;
        P.spawn(x, gy(x, z) + 0.3, z, rr(-0.6, 0.6), rr(0.6, 2.6), rr(-0.6, 0.6), rr(1.6, 3.2), rr(0.05, 0.11), 0.02, pink ? 6 : 2.2, pink ? 2 : 7, pink ? 4 : 1.6, 1, pink ? 3 : 1, pink ? 1 : 4, 1, 0.2, 0.9, -0.06, K_DOT, 0.9, 1);
      }
      if (b.t > b.R / 20 + 1.5) s.x.bl = null;
    },
  },

  // ================================================================ 15. MONOLITH: raise a ring of standing stones
  monolith: {
    press(s) {
      const hit = s.aim(220), p = ground(hit.point.clone()), fx = G.fx, ph = G.physics, T = G.terrain, R = 12.5, n = 10;
      tapPose('raise', s.current.color, false); s.say(s.current); s.cool.monolith = 2.5;
      // level a plinth, then pull the stones out of the earth
      const h0 = p.y + 0.4;
      T.deform(p.x, p.z, 21, (d, wx, wz, h) => lerp(h, h0, 1 - Math.pow(Math.max(0, (d - 0.72) / 0.28), 2) * (d > 0.72 ? 1 : 0)));
      T.rebuildCollider();                                    // the stones must stand on the plinth, not on the old slope
      T.paint('burn', p.x, p.z, 17, 0.25, 0);
      G.forest?.blast(p, 17, 0.8, 0);
      ph.explode(_a.set(p.x, h0, p.z), 16, 10, { up: 0.9, heat: 0, fracture: 0.7 });
      const tint = () => 0.62 + rand() * 0.2;
      const stones = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28, x = p.x + Math.cos(a) * R, z = p.z + Math.sin(a) * R, hh = 8.6;
        const q = new THREE.Quaternion().setFromAxisAngle(UP, -(a + Math.PI / 2));
        const b = ph.add({ shape: 'box', mat: 'stone', x, y: h0 + hh / 2 + 0.01, z, sx: 2.5, sy: hh, sz: 1.7, q, tint: tint(), struct: false });
        ph.growIn(b, i * 0.07, 0.42); stones.push([x, z]);
        fx.after(i * 0.07, () => { _a.set(x, h0 + 0.5, z); fx.dust(_a, 6, 7, 2, 2.2, [0.42, 0.38, 0.32], 0.5, 0.8); fx.sparks(_a, 8, 14, [9, 6, 3], 0.6, 1.4, 0.8, 0.03); G.audio?.play('rockhit', { pos: _a, size: 1.5, vel: 20 }); G.player.shakeFrom(_a, 0.2, 90); });
      }
      const chord = 2 * R * Math.sin(Math.PI / n), mid = R * Math.cos(Math.PI / n);
      for (let i = 0; i < n; i += 2) {
        const a = ((i + 0.5) / n) * 6.28, x = p.x + Math.cos(a) * mid, z = p.z + Math.sin(a) * mid;
        const b = ph.add({ shape: 'box', mat: 'stone', x, y: h0 + 8.6 + 0.55 + 0.02, z, sx: chord + 2.2, sy: 1.1, sz: 1.9, q: new THREE.Quaternion().setFromAxisAngle(UP, -(a + Math.PI / 2)), tint: tint(), struct: false });
        ph.growIn(b, 0.75 + i * 0.05, 0.3);
      }
      const altar = ph.add({ shape: 'box', mat: 'stone', x: p.x, y: h0 + 0.6, z: p.z, sx: 3.6, sy: 1.2, sz: 2.2, tint: 0.55, struct: false }); ph.growIn(altar, 0.4, 0.4);
      T.setRune(0, p.x, p.z, 15, _col.setRGB(1.2, 3, 3.5), 1.4, 0.7); fx.after(4, () => T.setRune(0, 0, 0, 1, null, 0));
      fx.light(p.clone().add(V(0, 6, 0)), _col.setRGB(0.4, 0.9, 1), 4000, 70, 2.5);
      G.audio?.play('conjure', { pos: p });
    },
  },

  // ================================================================ 16. ASCENSION: gravity lets go... then remembers
  ascension: {
    press(s) {
      const hit = s.aim(240), p = ground(hit.point.clone());
      s.x.asc = { p, t: 0, R: 46, set: new Set(), slam: false, float: 4.6 };
      tapPose('raise', s.current.color, false); G.hand.setSpeed(3, 0.85); s.say(s.current); s.cool.ascension = 7;
      G.terrain.setRune(0, p.x, p.z, 46, _col.setRGB(2.2, 1.2, 4), 1.2, -0.5);
      G.audio?.play('ascend', { pos: p }); G.audio?.loop('asc', 'drone2', { vol: 0.9, rate: 1.4, fade: 0.6 });
    },
    update(s, dt) {
      const a = s.x.asc; if (!a || dt <= 0) return;
      const ph = G.physics, P = G.fx.P, p = a.p;
      a.t += dt;
      if (!a.slam) {
        for (const b of ph.blocks) {
          if (!b.alive || b.fixed || a.set.has(b)) continue;
          const dx = b.x - p.x, dz = b.z - p.z; if (dx * dx + dz * dz > a.R * a.R || b.y - p.y > 60) continue;
          if (rand() > dt * 3.2) continue;
          a.set.add(b); b.body.setGravityScale(-0.42 - rand() * 0.3, true); ph.lightsOut(b); b.held = true;
          const m = b.mass; b.body.applyImpulse({ x: rr(-0.6, 0.6) * m, y: rr(1, 2.6) * m, z: rr(-0.6, 0.6) * m }, true);
          b.body.applyTorqueImpulse({ x: rr(-0.5, 0.5) * m, y: rr(-0.5, 0.5) * m, z: rr(-0.5, 0.5) * m }, true);
        }
        let up = 0; G.forest?.each(p.x, p.z, a.R, (tr) => { if (up < 2 && rand() < dt * 1.5) { const b = G.forest.uproot(tr); if (b) { a.set.add(b); b.body.setGravityScale(-0.5, true); b.held = true; } up++; } });
        for (let i = 0; i < 8; i++) { const an = rand() * 6.28, r = Math.sqrt(rand()) * a.R, x = p.x + Math.cos(an) * r, z = p.z + Math.sin(an) * r; P.spawn(x, gy(x, z) + 0.2, z, 0, rr(3, 9), 0, rr(1.5, 3), rr(0.06, 0.14), 0.02, 5, 2.6, 11, 1, 2, 1, 5, 0.3, 0.2, -0.3, K_DOT, 0.3, 1); }
        // keep them hovering instead of flying off to the stars
        for (const b of a.set) if (b.alive && b.y - p.y > 26 + (b.idx % 9)) { const v = b.body.linvel(); b.body.setLinvel({ x: v.x * 0.98, y: v.y * 0.9 - 0.3, z: v.z * 0.98 }, true); }
        G.player.addTrauma(dt * 0.12);
        if (a.t > a.float - 0.5) { G.hand.setPose('crush'); G.hand.setSpeed(12, 0.6); }
        if (a.t >= a.float) {
          a.slam = true; G.terrain.setRune(0, 0, 0, 1, null, 0);
          for (const b of a.set) if (b.alive) { b.body.setGravityScale(4.2, true); b.held = false; const m = b.mass; b.body.applyImpulse({ x: 0, y: -14 * m, z: 0 }, true); b.pvy -= 14; }
          G.hand.setPose('slam'); G.hand.kick(0, -1.8, 0, -4, 0, 0); G.player.addTrauma(0.5); G.post.punch(1.4);
          G.audio?.stopLoop('asc', 0.2); G.audio?.play('slam', { pos: p });
          G.fx.after(0.7, () => { G.fx.shockwave(p.clone().add(V(0, 1, 0)), 70, 1.2, 1.3, null, true); G.grass.shock(p.x, p.z, 2, 50, 6, 2); G.player.shakeFrom(p, 1, 260); G.fx.dust(p, 60, 30, 4, 4, [0.42, 0.37, 0.3], 0.5, 0.4); G.audio?.play('explosion', { size: 2, pos: p }); });
        }
      } else if (a.t > a.float + 1.6) { for (const b of a.set) if (b.alive) b.body.setGravityScale(1, true); s.x.asc = null; }
    },
  },

  // ================================================================ 17. CHRONOSTASIS: stop time for everything but yourself
  chrono: {
    press(s) {
      if (G.timeStop > 0) return;
      G.timeStop = 7.5; G.timeScaleTarget = 0.015;
      tapPose('fist', s.current.color, false); s.say(s.current); s.cool.chrono = 12;
      G.post.punch(2); G.post.radialBlur = 1.4; G.post.flash(0.3, _col.setRGB(0.7, 0.9, 1));
      G.audio?.play('timestop');
    },
    update(s) {
      if (!(G.timeStop > 0)) { if (s.x.chronoOn) { s.x.chronoOn = false; const f = G.post.finalMat.uniforms; f.uSat.value = 1.17; f.uTint.value.setRGB(1, 1, 1); } return; }
      s.x.chronoOn = true;
      G.timeStop -= G.realDt;
      const f = G.post.finalMat.uniforms, k = sat(G.timeStop / 0.6) * sat((7.5 - G.timeStop) / 0.4);
      f.uSat.value = lerp(1.17, 0.18, k); f.uTint.value.setRGB(lerp(1, 0.78, k), lerp(1, 0.92, k), lerp(1, 1.12, k));
      if (G.timeStop <= 0) { G.timeStop = 0; G.timeScaleTarget = 1; G.audio?.play('timeresume'); G.post.punch(1.6); G.fx.shockwave(G.player.eye.clone(), 50, 0.7, 1.2, _col.setRGB(0.6, 0.85, 1), false); }
    },
  },

  // ================================================================ 18. THUNDERSTORM: call the weather
  storm: {
    press(s) {
      const hit = s.aim(300), p = ground(hit.point.clone());
      s.x.st = { p, t: 0, life: 17, next: 1.2 };
      tapPose('raise', s.current.color, false); s.say(s.current); s.cool.storm = 8;
      G.sky.setStorm(0.82, 0); G.sky.rainTarget = 1;
      G.audio?.loop('rain', 'rain', { vol: 1.6, fade: 3 }); G.audio?.loop('stormwind', 'wind', { vol: 0.5, rate: 1.2, fade: 2 }); G.audio?.play('thunder_big', { vol: 0.8 });
    },
    update(s, dt) {
      const st = s.x.st; if (!st || dt <= 0) return;
      const fx = G.fx, ph = G.physics, p = st.p;
      st.t += dt; st.next -= dt;
      // rain puts fires out and cools the ground
      if (rand() < dt * 3) { const c = G.camera.position; quench(c.x + rr(-90, 90), c.z + rr(-90, 90), 26); }
      if (st.next <= 0 && st.t < st.life - 1.5) {
        st.next = rr(0.3, 0.95);
        // lightning prefers tall things: pick a random body near the storm's eye, else open ground
        let tg = null;
        const near = ph.blocksInRadius(_a.set(p.x + rr(-70, 70), p.y + 10, p.z + rr(-70, 70)), 26, []);
        if (near.length && rand() < 0.8) { let best = near[0]; for (const b of near) if (b.y > best.y) best = b; tg = V(best.x, best.y + best.sy * 0.5, best.z); }
        else { tg = V(p.x + rr(-95, 95), 0, p.z + rr(-95, 95)); ground(tg); G.forest?.each(tg.x, tg.z, 12, (tr) => { if (tr.state === 0) tg.set(tr.x, tr.y + tr.h, tr.z); }); }
        const from = V(tg.x + rr(-30, 30), tg.y + 150, tg.z + rr(-30, 30));
        fx.bolt(from, tg, { life: 0.26, width: 0.34, jitter: 0.085, color: _col.setRGB(0.7, 0.8, 1), branches: 4, flick: 0.045 });
        fx.light(tg, _col.setRGB(0.75, 0.85, 1), 9000, 90, 0.3, { curve: 1 });
        fx.explosion(tg, rr(0.8, 1.3), { strength: 19, heat: 0.4, crater: rand() < 0.5 });
        G.forest?.igniteArea(tg.x, tg.z, 5, 0.5);
        G.post.flash(0.16 * clamp(1.3 - tg.distanceTo(G.player.eye) / 260, 0.2, 1), _col.setRGB(0.8, 0.88, 1));
        G.audio?.play(rand() < 0.4 ? 'thunder_big' : 'thunder', { pos: tg, vol: 0.9 });
      }
      if (st.t >= st.life) { G.sky.setStorm(0, 0); G.sky.rainTarget = 0; G.audio?.stopLoop('rain', 4); G.audio?.stopLoop('stormwind', 4); s.x.st = null; }
    },
  },

  // ================================================================ 19. ECLIPSE: blot out the sun
  eclipse: {
    press(s) {
      const on = G.sky.nightTarget < 0.5; G.sky.nightTarget = on ? 1 : 0;
      tapPose('raise', s.current.color, false); G.hand.setSpeed(3, 0.85); s.say({ name: on ? 'ECLIPSE' : 'DAWN', color: s.current.color }); s.cool.eclipse = 3;
      G.audio?.play('eclipse'); G.post.punch(0.8);
      G.fx.shockwave(G.player.eye.clone(), 90, 1.6, 0.8, on ? _col.setRGB(0.4, 0.3, 0.9) : _col.setRGB(1, 0.8, 0.5), false);
    },
  },

  // ================================================================ 20. RESTORATION: rewind the realm
  restoration: {
    press(s) {
      const pl = G.player, fx = G.fx, ph = G.physics;
      tapPose('cup', s.current.color, false); G.hand.setSpeed(3, 0.85); s.say(s.current); s.cool.restoration = 6;
      fx.emitters.length = 0; fx.plumed.clear(); s.holes.length = 0; s.meteors.length = 0; s.x = { chronoOn: s.x.chronoOn };
      G.terrain.restore(); G.forest?.restoreAll(); G.sky.setStorm(0, 0); G.sky.rainTarget = 0;
      G.world.reset(); G.water?.reset(); G.score = 0;
      // every stone flies back: the realm rebuilds itself outward from the caster, ground floor first
      const y0 = pl.pos.y;
      for (const b of ph.blocks) if (b.alive) ph.growIn(b, Math.hypot(b.x - pl.pos.x, b.z - pl.pos.z) / 190 + Math.max(0, b.y - y0 + 20) * 0.02, 0.55);
      fx.shockwave(pl.eye.clone(), 420, 3.2, 1.0, _col.setRGB(1, 0.9, 0.6), true);
      fx.light(pl.eye.clone().add(V(0, 6, 0)), _col.setRGB(1, 0.85, 0.5), 9000, 200, 3);
      G.post.flash(0.5, _col.setRGB(1, 0.93, 0.75)); G.post.punch(1);
      G.audio?.play('restore');
    },
  },
};

// shared by Rise / Abyss
function terraform(s, dt, sign) {
  const hit = s.aim(260), fx = G.fx, T = G.terrain, tf = s.x.tf;
  if (hit.miss) return;
  const p = ground(hit.point.clone()), R = 28;
  T.mound(p.x, p.z, R, sign * 14 * dt * (0.6 + s.charge), 0.2);
  T.setRune(0, p.x, p.z, R, sign > 0 ? _col.setRGB(3, 2, 0.8) : _col.setRGB(2, 0.6, 3), 0.9, sign);
  tf.tick -= dt;
  if (tf.tick <= 0) {
    tf.tick = 0.12;
    G.forest?.settle(p.x, p.z, R + 4);
    for (let i = 0; i < 4; i++) { const a = rand() * 6.28, r = Math.sqrt(rand()) * R, q = V(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r); ground(q); fx.dust(q, 2, 5, 2, 2, [0.4, 0.35, 0.28], 0.45, 0.7); }
    if (rand() < 0.5) G.physics.spawnRubble(p, 2, 12, 0.4, 'stone', 0, 1);
    if (sign < 0) { const w = G.water?.at(p.x, p.z); if (w) steam(p, 0, 1); }
    G.grass.shock(p.x, p.z, 0.8, 20, R * 0.5, 0.6);
  }
  G.player.shakeFrom(p, 0.12, 200);
}
