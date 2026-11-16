// Scripted showcase: drives the real game through the same input layer a player uses
// (look, move, select, hold/release cast), so the captured video is genuine gameplay.
// It is written as named sections; `?demo=<section>` starts the show at that section (for tuning).
import * as THREE from 'three';
import { G } from './core/globals.js';
import { CITY, SPAWN, WORLD_R, DAM, RESERVOIR } from './world/layout.js';
import { SPELL_INDEX } from './spells/spells.js';
import { clamp, lerp, easeInOut } from './core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Director {
  constructor(start) {
    this.t = 0; this.i = 0; this.acts = []; this.target = null; this.rate = 3; this.sweep = null; this.done = false; this.followFn = null;
    this.fovTarget = null; this.duration = 0; this.fadeT = null; this.T = 0; this.marks = {};
    this.start = start && start !== '1' && start !== 'true' ? start : null; this.started = !this.start;
    G.input.v.active = true;
    this.build();
    this.acts.sort((a, b) => a.t - b.t);
  }
  // ---- timeline helpers: at(dt, fn) schedules relative to the cursor, go(d) advances the cursor
  at(dt, fn) { this.acts.push({ t: this.T + dt, fn }); }
  go(d) { this.T += d; this.duration = this.T; }
  sec(name, fn) { if (!this.started && name === this.start) this.started = true; if (this.started) { this.marks[name] = this.T; fn(); } }
  // ---- script verbs
  look(p, rate = 3) { this.sweep = null; this.followFn = null; this.target = p.clone(); this.rate = rate; }
  pan(a, b, dur, rate = 6) { this.followFn = null; this.sweep = { a: a.clone(), b: b.clone(), t: 0, dur }; this.target = a.clone(); this.rate = rate; }
  follow(fn, rate = 3) { this.sweep = null; this.followFn = fn; this.rate = rate; }
  fire(on) { G.input.v.fire = on; }
  alt(on) { G.input.v.alt = on; }
  move(x, z, sprint = false) { G.input.v.moveX = x; G.input.v.moveZ = z; G.input.v.sprint = sprint; }
  rise(v) { G.input.v.up = v; }
  select(id) { G.spells.select(SPELL_INDEX[id]); }
  fov(v, rate = 2) { this.fovTarget = v; this.fovRate = rate; }
  snapLook(p) {
    const e = G.player.pos.clone(); e.y += 1.66; const d = p.clone().sub(e);
    G.player.yaw = Math.atan2(-d.x, -d.z); G.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.look(p, 3); G.post.cutBlur();
  }
  // hard cut to a spot on the ground
  cut(x, z, lookAt) { const pl = G.player; if (pl.fly) G.spells.fly(); this.move(0, 0); pl.teleport(x, z); this.snapLook(lookAt); }
  // arrive somewhere hovering in the air (Skywalk), with a blink flash
  warp(x, z, h, lookAt, flash = true) {
    const pl = G.player, r = Math.hypot(x, z); if (r > WORLD_R - 8) { x *= (WORLD_R - 8) / r; z *= (WORLD_R - 8) / r; }
    if (!pl.fly) G.spells.fly();
    this.move(0, 0); G.input.v.up = 0;
    pl.teleport(x, z); pl.pos.y = G.terrain.heightAt(x, z) + h; pl.vel.set(0, 0, 0);
    pl.body.setTranslation({ x, y: pl.pos.y + 0.84, z }, true);
    this.snapLook(lookAt);
    if (flash) { G.post.flash(0.5, new THREE.Color(0.7, 0.85, 1)); G.post.radialBlur = 1.3; G.post.punch(1.2); pl.fovKick.kick(22); G.audio?.play('blink'); }
  }
  // tap-cast a skill at a point
  tap(id, hold = 0.12) { this.at(0, () => { this.select(id); }); this.at(0.3, () => this.fire(true)); this.at(0.3 + hold, () => this.fire(false)); }

  build() {
    const y0 = G.world.y0, cz = CITY.z, T = G.terrain;
    const gh = (x, z) => T.heightAt(x, z);
    const P = {
      cityL: V(-70, y0 + 6, cz + 6), cityR: V(52, y0 + 8, cz - 8), centre: V(0, y0 + 9, cz),
      gateL: V(-6.6, y0 + 6, cz + 87.6), gateR: V(6.6, y0 + 5, cz + 87.6),
      rowA: V(-44, y0 + 6.5, cz + 62), rowB: V(46, y0 + 6.5, cz + 58),
      cathedral: V(33, y0 + 7, cz - 19),
    };
    const hud = G.hud;
    // hovering at an absolute height y (never lower than 4 m above the ground)
    const air = (x, y, z, look, fov = 68) => this.at(0, () => { this.warp(x, z, Math.max(4, y - gh(x, z)), look); this.fov(fov, 3); });
    // set dressing: a clear meadow for the creation skills
    const mx = -105, mz = 96, camX = mx + 34, camZ = mz + 38;
    G.forest?.each(mx, mz, 34, (t) => G.forest.vaporize(t, false));
    for (let k = 0.4; k <= 1.001; k += 0.2) G.forest?.each(mx + (camX - mx) * k, mz + (camZ - mz) * k, 20, (t) => G.forest.vaporize(t, false));
    G.forest?.each(mx - 62, mz + 16, 38, (t) => { if (Math.random() < 0.8) G.forest.vaporize(t, false); });

    // ============================================================ ACT 1: the capital, from the cliff
    this.sec('intro', () => {
      this.at(0, () => { G.post.fade = 0; this.fadeT = { from: 0, to: 1, t: 0, dur: 2.2 }; G.post.letterboxTarget = 1; this.cut(SPAWN.x, SPAWN.z, P.cityL); this.pan(P.cityL, P.cityR, 5.4, 2.2); this.fov(58, 0.6); hud.alpha = 0; });
      this.at(0.9, () => hud.showTitle('ARCHMAGE', 'TENTH CIRCLE', 4.0));
      this.go(5.2);
    });
    this.sec('capital', () => {
      this.at(0, () => { this.cut(SPAWN.x, SPAWN.z, P.gateL); G.post.letterboxTarget = 0; this.fadeHud = 1; this.fov(70, 1.5); this.look(P.gateL, 3.2); this.select('inferno'); });
      this.at(0.6, () => this.fire(true)); this.at(1.9, () => this.fire(false));           // charged Inferno Orb
      this.at(2.3, () => this.look(P.gateR, 5)); this.at(2.8, () => this.fire(true)); this.at(3.5, () => this.fire(false));
      this.go(4.6);
      this.at(0, () => { this.select('lightning'); this.look(P.rowA, 5); });               // Chain Lightning raked over the roofs
      this.at(0.7, () => { this.fire(true); this.pan(P.rowA, P.rowB, 3.2, 7); }); this.at(4.0, () => this.fire(false));
      this.go(4.5);
      this.at(0, () => { this.select('starfall'); this.look(P.cathedral, 3); this.fov(62, 1.2); });   // Starfall on the cathedral
      this.at(0.6, () => this.fire(true)); this.at(3.0, () => this.fire(false));
      this.at(3.5, () => this.look(V(P.cathedral.x - 8, P.cathedral.y + 30, P.cathedral.z), 1.6)); this.at(4.8, () => this.look(P.cathedral, 3.5));
      this.go(6.6);
      this.at(0, () => { this.select('earthshatter'); this.look(V(0, y0 + 1, cz + 60), 5); this.fov(70, 3); });   // Earthshatter splits the road to the gate
      this.at(0.7, () => this.fire(true)); this.at(0.85, () => this.fire(false));
      this.at(1.6, () => this.look(V(0, y0 + 4, cz + 30), 2.5));
      this.go(4.2);
    });

    // ============================================================ ACT 2: a tour of the realm
    // --- Westmarch market town: down in the square first (Force Blast, Telekinesis)...
    this.sec('westmarch', () => {
      this.at(0, () => { this.cut(-310, 24, V(-296, 5, -2)); G.post.flash(0.5, new THREE.Color(0.7, 0.85, 1)); G.post.radialBlur = 1.3; G.audio?.play('blink'); this.fov(72, 3); this.move(0, 0.7); });
      this.at(0.9, () => { this.look(V(-300, 3, 8), 6); });
      this.at(1.5, () => G.spells.force());
      this.at(2.4, () => { this.move(0, 0); this.look(V(-296, 6, -2), 6); });
      this.at(3.0, () => this.alt(true)); this.at(3.7, () => this.look(V(-296.5, 15, -3), 4)); this.at(4.6, () => this.alt(false));
      this.go(5.2);
      // ...then from the air: Singularity swallows the town
      air(-236, 40, 78, V(-300, 6, 15));
      this.at(0.3, () => { this.select('singularity'); this.look(V(-300, 7, 15), 5); });
      this.at(0.7, () => this.fire(true)); this.at(1.7, () => this.fire(false));
      this.go(9.4);
    });
    // --- Barleyford farming village: Dragon's Breath over the thatch, then Verdant Bloom on the ashes
    this.sec('barleyford', () => {
      air(-214, 6, 204, V(-236, 0, 213), 72);
      this.at(0.4, () => { this.select('dragon'); this.look(V(-236, 0, 213), 6); });
      this.at(0.9, () => { this.fire(true); this.pan(V(-236, 0, 213), V(-222, 0, 178), 3.2, 7); }); this.at(4.3, () => this.fire(false));
      this.at(4.4, () => { this.rise(1); this.select('bloom'); this.look(V(-226, -4, 196), 4); });
      this.at(5.4, () => this.fire(true)); this.at(5.55, () => this.fire(false));
      this.at(5.8, () => this.rise(0));
      this.at(6.4, () => this.look(V(-243, -2, 184), 1.6));                                  // tilt out over the regrown village
      this.go(9.6);
    });
    // --- The Greywater dam: Annihilation Ray cuts it open and the reservoir comes down the valley
    this.sec('dam', () => {
      const ax = -DAM.tz, az = DAM.tx, top = DAM.crest, L = (k, y) => V(DAM.x + ax * k, y, DAM.z + az * k);
      air(DAM.x + DAM.tx * 60, top + 8, DAM.z + DAM.tz * 60, L(0, top - 6));
      this.at(0.4, () => { this.select('ray'); this.look(L(-8.5, top - 4.5), 6); });
      this.at(0.9, () => this.fire(true));
      this.at(1.3, () => this.pan(L(-8.5, top - 4.5), L(8.5, top - 4.5), 1.5, 8));
      this.at(2.9, () => this.pan(L(8.5, top - 10), L(-8.5, top - 10), 1.5, 8));
      this.at(4.5, () => { this.fire(false); this.look(L(0, top - 8), 3); });
      this.at(6.0, () => { this.rise(0.5); this.look(V(DAM.x + DAM.tx * 30, DAM.toe + 2, DAM.z + DAM.tz * 30), 1.2); });   // back off as the torrent comes down the gorge
      this.at(8.2, () => this.rise(0));
      this.go(8.4);
    });
    // --- Ravenscar Castle: Ascension
    this.sec('castle', () => {
      air(-135, 48, -150, V(-205, 20, -200));
      this.at(0.2, () => this.look(V(-205, 18, -200), 5)); this.tap('ascension');
      this.at(2.2, () => this.look(V(-205, 40, -200), 1.5)); this.at(4.8, () => this.look(V(-205, 20, -200), 4));
      this.go(7.0);
    });
    // --- Mirrormere: Deluge drops a lake's worth of water into the lake; the wave takes the lakeside town
    this.sec('tsunami', () => {
      air(232, 35, 136, V(262, 0, 66));
      this.at(0.2, () => this.look(V(262, -0.4, 66), 5)); this.tap('deluge');
      this.at(2.6, () => this.look(V(292, 2, 60), 1.4));
      this.go(7.0);
    });
    // --- Norbury crossroads: Eruption
    this.sec('norbury', () => {
      air(84, 36, -252, V(20, 4, -320));
      this.at(0.2, () => this.look(V(20, 0, -320), 5)); this.tap('eruption');
      this.at(4.2, () => this.look(V(20, 26, -320), 1.5));
      this.go(7.6);
    });
    // --- a quiet meadow: Monolith raises a stone ring, Stoneshape lifts a mountain beside it
    this.sec('creation', () => {
      const mg = () => gh(mx, mz);
      this.at(0, () => { this.warp(camX, camZ, 19, V(mx, mg() + 4, mz)); });                  // Monolith + Stoneshape in a meadow
      this.tap('monolith');
      this.at(2.8, () => { this.select('rise'); this.look(V(mx - 62, gh(mx - 62, mz + 16), mz + 16), 4); });   // a mountain beside the ring
      this.at(3.4, () => this.fire(true)); this.at(6.8, () => this.fire(false));
      this.go(7.6);
    });
    // --- ...meanwhile the flood from the dam reaches the capital's riverside quarter
    this.sec('flood', () => {
      air(60, 45, -60, V(112, 0, -120), 70);                          // from above: the flood spreads through the quarter
      this.at(0.3, () => this.look(V(112, y0 - 2, -130), 1.5));
      this.at(2.0, () => this.look(V(108, y0 - 2, -95), 0.9));
      this.go(3.8);
      air(99, y0 + 5.5, -82, V(110, y0, -140), 76);                   // down among the houses as the water arrives
      this.at(0.2, () => { this.look(V(110, y0 + 1, -130), 3); this.move(0, 0.25); });
      this.at(2.6, () => this.look(V(120, y0 + 1, -100), 1.2));
      this.at(4.0, () => this.move(0, 0));
      this.go(4.2);
    });
    // --- Winter's Grasp: the flood freezes in the streets
    this.sec('winter', () => {
      this.at(0, () => { this.rise(0.7); this.look(V(112, y0, -110), 3); }); this.tap('winter');
      this.at(1.4, () => this.rise(0.3));
      this.at(2.6, () => { this.rise(0); this.look(V(112, y0 + 2, -135), 1.5); });
      this.go(4.8);
    });

    // ============================================================ ACT 3: night, and stopped time
    this.sec('night', () => {
      this.at(0, () => { this.warp(SPAWN.x + 2, SPAWN.z + 4, 16, P.centre); this.look(V(-70, y0 + 60, cz - 140), 1.4); });   // Eclipse over the capital
      this.tap('eclipse');
      this.at(3.4, () => this.look(P.centre, 2.2));
      this.go(5.2);
      this.tap('chrono');                                                                      // time stops...
      this.at(1.2, () => { this.select('inferno'); this.look(V(-28, y0 + 8, cz + 30), 6); });
      this.at(1.5, () => this.fire(true)); this.at(2.2, () => this.fire(false));
      this.at(2.5, () => this.look(V(6, y0 + 10, cz + 6), 6)); this.at(2.8, () => this.fire(true)); this.at(3.5, () => this.fire(false));
      this.at(3.8, () => this.look(V(34, y0 + 8, cz + 34), 6)); this.at(4.1, () => this.fire(true)); this.at(4.8, () => this.fire(false));
      this.at(5.1, () => { this.select('starfall'); this.look(V(-20, y0 + 6, cz - 30), 6); });
      this.at(5.4, () => this.fire(true)); this.at(7.3, () => this.fire(false));
      this.at(7.6, () => this.look(P.centre, 2));                                              // ...and resumes: everything lands at once
      this.go(11.2);
    });

    // ============================================================ ACT 4: cataclysm, and the rewind
    this.sec('finale', () => {
      this.at(0, () => { this.look(V(0, y0 + 4, cz - 2), 3); G.spells.cataclysm(true); this.fov(66, 2); });
      this.at(1.4, () => this.look(V(0, y0 + 60, cz), 0.9));
      this.at(3.4, () => this.look(V(0, y0 + 12, cz), 2.2));
      this.at(5.8, () => this.fov(76, 1.2));
      this.at(9.4, () => { this.pan(V(-60, y0 + 10, cz), V(50, y0 + 12, cz - 4), 4.2, 1.6); this.fov(62, 0.5); });
      this.go(13.8);
      this.at(0, () => { this.look(P.centre, 2.5); });                                         // Restoration: the realm rebuilds itself
      this.tap('restoration');
      this.at(2.2, () => { if (G.sky.nightTarget > 0.5) G.sky.nightTarget = 0; this.pan(V(-60, y0 + 8, cz + 4), V(50, y0 + 10, cz - 6), 5, 1.6); });
      this.at(3.2, () => { G.post.letterboxTarget = 1; this.fadeHud = 0; });
      this.at(4.0, () => hud.showTitle('ARCHMAGE', 'TENTH CIRCLE', 4.0));
      this.at(6.8, () => { this.fadeT = { from: 1, to: 0, t: 0, dur: 1.7 }; });
      this.go(8.6);
    });
    this.at(0, () => { this.done = true; });
  }

  update(dt) {
    this.t += dt;
    while (this.i < this.acts.length && this.acts[this.i].t <= this.t) this.acts[this.i++].fn();
    const pl = G.player;
    if (this.sweep) { const s = this.sweep; s.t += dt; this.target.lerpVectors(s.a, s.b, easeInOut(Math.min(1, s.t / s.dur))); }
    if (this.followFn) { const p = this.followFn(); if (p) (this.target ||= p.clone()).copy(p); }
    if (this.target) {
      const d = this.target.clone().sub(pl.eye);
      const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      const k = 1 - Math.exp(-this.rate * dt);
      // a touch of hand-held drift so it never feels robotic
      const n = Math.sin(this.t * 0.9) * 0.004 + Math.sin(this.t * 2.3 + 1) * 0.002;
      pl.yaw += wrap(yaw + n - pl.yaw) * k;
      pl.pitch += (clamp(pitch + n * 0.6, -1.3, 1.3) - pl.pitch) * k;
    }
    if (this.fovTarget !== null) pl.fov += (this.fovTarget - pl.fov) * (1 - Math.exp(-(this.fovRate || 2) * dt));
    if (this.fadeT) { const f = this.fadeT; f.t += dt; G.post.fade = lerp(f.from, f.to, easeInOut(Math.min(1, f.t / f.dur))); if (f.t >= f.dur) this.fadeT = null; }
    if (this.fadeHud !== undefined && G.hud) G.hud.alpha += (this.fadeHud - G.hud.alpha) * Math.min(1, dt * 3);
  }
}
