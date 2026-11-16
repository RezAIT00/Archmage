// Sample-based audio: every sound is a real recording (CC0, freesound.org - see public/assets/sfx/CREDITS.md).
// This module only mixes them: layering, pitch, distance attenuation / muffling, speed-of-sound delay, loops.
// Every trigger is also logged so the capture tool can render the exact same mix offline for the MP4.
import { G } from '../core/globals.js';
import { rand, rr, clamp } from '../core/util.js';

// peak level of each file in dBFS (measured) -> used to normalise so mix volumes mean the same thing for every sample
const PEAK = {
  ambience: -14.7, bass_drop: -0.4, bayhit: -0.4, beam_charge: -6.2, beam_loop: -8, bell: -15.2, bell2: -4.7, bomb_fall: -0.2, bomb_fall2: -5, boom1: -0.3, boom2: -3, boom3: -6.3,
  buildup: 0, choir: -4.3, choir_long: -17.9, collapse1: -8.3, collapse2: -5.7, collapse3: 0, crumble: -9.2, drone: -0.4, drone2: -11.6, earthquake: -0.3, electric_loop: -17.1,
  explosion1: 0, explosion2: -0.1, explosion3: 0, explosion_huge: 0, explosion_huge2: -0.5, fire_explosion: 0, fire_loop: -4.8, fire_magic: -1, fire_roar: -3.6, fire_whoosh: -2.8,
  fireball_whoosh: 0, glass1: 0, glass2: -0.5, hum_loop: -11.5, magic_cliche: -3.2, magic_smite: -8.3, magic_spell: 0, meteor: -0.1, music_dark: -0.2, reverse_cymbal: -13.6,
  reverse_short: -2.5, riser: -0.3, riser_boom: 0, rock1: 0, rock2: 0, rock3: -19.7, rock4: -0.3, rock5: -10.1, rubble: 0, rumble_in: -4.4, rumble_loop: -3.5, spellcast: -3.1,
  sub_drop: -1.9, swoosh_explosion: -2.6, thunder1: 0, thunder2: -0.3, thunder3: -0.1, thunder4: -1.1, town: -28.2, whoosh_big: 0, whoosh_low: -9.7, whoosh_trailer: -0.4,
  rain: -14, ice1: -3.2, ice2: 0, freeze: -3.7, ice_break: 0, waterfall: -0.3, splash: 0, tempest_wind: -5.4, lava: -4.3, avalanche: 0, clock: -5.7, tick: -0.8,
  tree_fall: -0.8, tree_fall2: 0, warp: -6.4, teleport: -0.7, timewarp: -5.2,
  wind: -0.3, wood1: -1.3, wood2: -1.2, wood3: -0.3, wood_collapse: -14, zap1: -1.3, zap2: -6.4, zap3: -7.1,
};
const FILES = Object.keys(PEAK);
const norm = (name) => Math.pow(10, -(PEAK[name] ?? 0) / 20);
const pickS = (s) => (Array.isArray(s) ? s[(rand() * s.length) | 0] : s);

// Plays logged events on any BaseAudioContext (live or offline).
class Mixer {
  constructor(ctx, buffers) {
    this.ctx = ctx; this.buffers = buffers; this.loops = new Map();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 5; this.comp.attack.value = 0.004; this.comp.release.value = 0.22;
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    this.sfx = ctx.createGain(); this.music = ctx.createGain(); this.music.gain.value = 1;
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5;
    this.sfx.connect(this.muffle); this.muffle.connect(this.comp); this.music.connect(this.comp); this.comp.connect(this.master); this.master.connect(ctx.destination);
  }
  shot(e, t) {
    const buf = this.buffers[e.s]; if (!buf) return;
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = e.rate || 1;
    const g = ctx.createGain(); g.gain.value = e.gain;
    let node = src;
    if (e.lp && e.lp < 16000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = e.lp; f.Q.value = 0.4; node.connect(f); node = f; }
    node.connect(g);
    if (e.pan) { const p = ctx.createStereoPanner(); p.pan.value = e.pan; g.connect(p); p.connect(e.bus === 'music' ? this.music : this.sfx); } else g.connect(e.bus === 'music' ? this.music : this.sfx);
    const off = Math.min(e.off || 0, Math.max(0, buf.duration - 0.05));
    if (e.dur) { const end = t + e.dur; g.gain.setValueAtTime(e.gain, Math.max(t, end - 0.15)); g.gain.linearRampToValueAtTime(0.0001, end); src.start(t, off, e.dur * (e.rate || 1) + 0.1); }
    else src.start(t, off);
  }
  loopStart(e, t) {
    const buf = this.buffers[e.s]; if (!buf) return;
    this.loopStop({ id: e.id, fade: 0.05 }, t);
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.playbackRate.value = e.rate || 1;
    if (buf.duration > 3) { src.loopStart = Math.min(0.5, buf.duration * 0.1); src.loopEnd = buf.duration - Math.min(0.5, buf.duration * 0.1); }
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(e.gain, t + (e.fade ?? 0.3));
    src.connect(g); g.connect(e.bus === 'music' ? this.music : this.sfx);
    src.start(t, e.off || 0);
    this.loops.set(e.id, { src, g });
  }
  loopSet(e, t) {
    const L = this.loops.get(e.id); if (!L) return;
    const tau = e.tau ?? 0.1;
    if (e.gain !== undefined) L.g.gain.setTargetAtTime(Math.max(0.0001, e.gain), t, tau);
    if (e.rate !== undefined) L.src.playbackRate.setTargetAtTime(e.rate, t, tau);
  }
  loopStop(e, t) {
    const L = this.loops.get(e.id); if (!L) return;
    const fade = e.fade ?? 0.3;
    L.g.gain.cancelScheduledValues(t); L.g.gain.setTargetAtTime(0.0001, t, fade / 3);
    try { L.src.stop(t + fade + 0.05); } catch (_) { /* already stopped */ }
    this.loops.delete(e.id);
  }
  muffleTo(e, t) { this.muffle.frequency.cancelScheduledValues(t); this.muffle.frequency.setTargetAtTime(e.freq, t, e.tau ?? 0.2); }
  handle(e, t) {
    if (e.k === 'shot') this.shot(e, t); else if (e.k === 'ls') this.loopStart(e, t); else if (e.k === 'lv') this.loopSet(e, t); else if (e.k === 'lx') this.loopStop(e, t); else if (e.k === 'mf') this.muffleTo(e, t);
  }
}

export class AudioEngine {
  constructor() {
    this.buffers = {}; this.events = []; this.live = null; this.ctx = null; this.loopState = new Map();
    this.budget = {}; this.started = false; this.fires = 0; this.rumble = 0; this.bellT = 6;
  }
  async load(onProgress) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ sampleRate: 48000, latencyHint: 'interactive' });
    let done = 0;
    await Promise.all(FILES.map(async (n) => {
      try {
        const ab = await (await fetch(`./assets/sfx/${n}.mp3`)).arrayBuffer();
        this.buffers[n] = await this.ctx.decodeAudioData(ab);
      } catch (e) { console.warn('sound failed', n, e.message); }
      onProgress?.(++done / FILES.length);
    }));
    if (!G.capture) this.live = new Mixer(this.ctx, this.buffers);
    return this;
  }
  resume() { this.ctx?.resume(); if (!this.started) { this.started = true; this.startAmbience(); } }

  _emit(e) {
    e.t = G.realTime + (e.delay || 0);
    if (G.capture) this.events.push(e);
    if (this.live && this.ctx.state === 'running') this.live.handle(e, this.ctx.currentTime + (e.delay || 0) + 0.005);
  }
  // one-shot. o: {vol, rate, pos (THREE.Vector3), size (carries further), delay, off, dur, bus, lp}
  sample(s, o = {}) {
    s = pickS(s);
    let gain = (o.vol ?? 1) * norm(s), pan = 0, lp = o.lp || 0, delay = o.delay || 0;
    if (o.pos) {
      const cam = G.camera, dx = o.pos.x - cam.position.x, dy = o.pos.y - cam.position.y, dz = o.pos.z - cam.position.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz), ref = 22 * (o.size || 1);
      gain *= 1 / (1 + Math.pow(d / ref, 1.35));
      const r = G.player.right; pan = clamp(((dx * r.x + dz * r.z) / (d + 1)) * 0.85, -0.85, 0.85);
      lp = Math.max(700, 19000 / (1 + d / (55 * (o.size || 1))));
      delay += Math.min(0.5, d / 343) / Math.max(0.3, G.timeScale); // speed of sound
    }
    if (gain < 0.004) return;
    this._emit({ k: 'shot', s, gain, pan, rate: (o.rate || 1) * (0.35 + 0.65 * Math.min(1, G.timeScale * 1.2)), lp, delay, off: o.off, dur: o.dur, bus: o.bus });
  }
  loop(id, s, o = {}) {
    if (this.loopState.has(id)) return this.setLoop(id, o);
    this.loopState.set(id, { s, vol: o.vol ?? 1, rate: o.rate ?? 1 });
    this._emit({ k: 'ls', id, s, gain: (o.vol ?? 1) * norm(s), rate: o.rate ?? 1, fade: o.fade, off: o.off, bus: o.bus });
  }
  setLoop(id, o) {
    const L = this.loopState.get(id); if (!L) return;
    const vol = o.vol ?? L.vol, rate = o.rate ?? L.rate;
    if (Math.abs(vol - L.vol) < 0.02 && Math.abs(rate - L.rate) < 0.01) return;
    L.vol = vol; L.rate = rate;
    this._emit({ k: 'lv', id, gain: vol * norm(L.s), rate, tau: o.tau });
  }
  stopLoop(id, fade = 0.3) { if (!this.loopState.has(id)) return; this.loopState.delete(id); this._emit({ k: 'lx', id, fade }); }
  muffle(freq, tau = 0.2) { this._emit({ k: 'mf', freq, tau }); }
  limit(key, minGap) { const t = G.realTime; if (t - (this.budget[key] ?? -9) < minGap) return false; this.budget[key] = t; return true; }

  startAmbience() {
    this.loop('wind', 'wind', { vol: 0.16, fade: 2 });
    this.loop('birds', 'ambience', { vol: 0.5, fade: 3 });
    this.loop('town', 'town', { vol: 0.5, fade: 3 });
    this.loop('music', 'music_dark', { vol: 0.42, fade: 2.5, bus: 'music' });
  }

  // ---- game events -> layered recordings -------------------------------------------------------
  play(name, o = {}) {
    const pos = o.pos, s = o.size ?? 1;
    switch (name) {
      case 'explosion': {
        if (s >= 4) {
          this.sample('bayhit', { vol: 1.0 }); this.sample('explosion_huge', { vol: 1.0, pos, size: 8 }); this.sample('explosion_huge2', { vol: 0.9, pos, size: 8, delay: 0.15 });
          this.sample('bass_drop', { vol: 0.8 }); this.sample('thunder1', { vol: 0.7, delay: 0.3 }); this.sample('earthquake', { vol: 0.75, delay: 0.5 });
          this.sample('collapse3', { vol: 0.8, pos, size: 6, delay: 0.9 }); this.sample('collapse2', { vol: 0.8, pos, size: 6, delay: 1.8 }); this.sample('rubble', { vol: 0.7, pos, size: 5, delay: 2.4 });
        } else if (s >= 1.7) {
          this.sample(['explosion_huge', 'explosion3'], { vol: 1.0, pos, size: 4.5, rate: rr(0.9, 1.05) }); this.sample('explosion1', { vol: 0.7, pos, size: 4, rate: rr(0.7, 0.85) });
          this.sample(['boom1', 'boom3'], { vol: 0.7, pos, size: 5 }); this.sample('sub_drop', { vol: 0.45, pos, size: 4 });
          this.sample(['collapse1', 'collapse2'], { vol: 0.6, pos, size: 3, delay: 0.5 }); this.sample('rubble', { vol: 0.55, pos, size: 3, delay: 0.9 });
        } else {
          this.sample(['explosion1', 'explosion2', 'fire_explosion'], { vol: 0.5 + 0.35 * s, pos, size: 2 + s, rate: rr(0.92, 1.12) / Math.sqrt(Math.max(0.6, s)) });
          if (s > 0.9) this.sample('boom2', { vol: 0.3, pos, size: 3 });
          if (this.limit('rub', 0.5)) this.sample(['rubble', 'crumble'], { vol: 0.35, pos, size: 2, delay: 0.35 });
        }
        break;
      }
      case 'rockhit': if (this.limit('rock', 0.07)) this.sample(['rock1', 'rock2', 'rock4', 'rock5', 'rock3'], { vol: clamp((o.vel || 8) / 22, 0.15, 0.8) * (0.5 + 0.5 * s), pos, size: 0.8 + s, rate: rr(0.85, 1.2) / (0.7 + 0.5 * s) }); break;
      case 'rockbreak':
        if (this.limit('rbreak', 0.09)) this.sample(['rock1', 'crumble', 'collapse1', 'rock4'], { vol: 0.45 + 0.2 * s, pos, size: 1.2 + s, rate: rr(0.8, 1.15) / (0.75 + 0.35 * s) });
        if (o.glass && this.limit('glass', 0.3)) this.sample(['glass1', 'glass2'], { vol: 0.4, pos, size: 1.2, rate: rr(0.9, 1.15) });
        break;
      case 'woodhit': if (this.limit('wood', 0.1)) this.sample('wood2', { vol: 0.35, pos, rate: rr(0.7, 1.1) }); break;
      case 'woodbreak': if (this.limit('wbreak', 0.12)) this.sample(['wood1', 'wood3'], { vol: 0.5, pos, size: 1.3, rate: rr(0.8, 1.15) }); break;
      case 'collapse': if (this.limit('collapse', 1.6)) this.sample(['collapse2', 'collapse3', 'wood_collapse', 'collapse1'], { vol: 0.75, pos, size: 4, rate: rr(0.85, 1.05) }); break;
      case 'fire_cast': this.sample('fireball_whoosh', { vol: 0.75, rate: rr(0.85, 1.0) }); this.sample('fire_whoosh', { vol: 0.5 }); this.sample('whoosh_low', { vol: 0.5 }); break;
      case 'thunder': this.sample(['thunder3', 'thunder4'], { vol: o.vol ?? 0.7, pos, size: 6, rate: rr(0.85, 1.15) }); break;
      case 'thunder_big': this.sample(['thunder1', 'thunder2'], { vol: o.vol ?? 0.9, pos, size: 10, rate: rr(0.9, 1.05) }); break;
      case 'zap': if (this.limit('zap', 0.05)) this.sample(['zap1', 'zap2', 'zap3'], { vol: o.vol ?? 0.45, pos, size: 2, rate: rr(0.75, 1.35) }); break;
      case 'void_cast': this.sample('magic_smite', { vol: 0.7, rate: 0.7 }); this.sample('whoosh_low', { vol: 0.6, rate: 0.7 }); this.sample('reverse_short', { vol: 0.35 }); break;
      case 'void_open': this.sample('boom3', { vol: 0.8, pos, size: 5, rate: 0.8 }); this.sample('sub_drop', { vol: 0.6, pos, size: 5 }); break;
      case 'void_collapse': this.sample('reverse_short', { vol: 0.8, pos, size: 6, rate: 1.35 }); this.sample('riser', { vol: 0.5, pos, size: 6, off: 1.8 }); break;
      case 'void_boom': this.sample('explosion_huge', { vol: 1, pos, size: 7, rate: 0.85 }); this.sample('boom2', { vol: 0.9, pos, size: 7 }); this.sample('bass_drop', { vol: 0.6 }); this.sample('rubble', { vol: 0.6, pos, size: 4, delay: 0.8 }); this.sample('collapse3', { vol: 0.7, pos, size: 5, delay: 0.5 }); break;
      case 'star_cast': this.sample('spellcast', { vol: 0.6 }); this.sample('choir', { vol: 0.4 }); break;
      case 'meteor_in': this.sample('bomb_fall', { vol: 0.5, pos, size: 8, off: Math.max(0, 5.2 - (o.time || 1.7)), dur: (o.time || 1.7) + 0.15 }); this.sample('fire_roar', { vol: 0.35, pos, size: 8, dur: o.time || 1.7, rate: 0.8 }); break;
      case 'ray_start': this.sample('beam_charge', { vol: 0.6, off: 5.0, rate: 1.2 }); this.sample('magic_spell', { vol: 0.5, rate: 0.6 }); break;
      case 'ray_end': this.sample('whoosh_big', { vol: 0.35, rate: 0.8 }); break;
      case 'force': this.sample('whoosh_big', { vol: 0.8, rate: 1.1 }); this.sample('boom2', { vol: 0.6, rate: 1.2 }); this.sample('sub_drop', { vol: 0.5, rate: 1.2 }); break;
      case 'tk_grab': this.sample('magic_spell', { vol: 0.45, rate: 1.2 }); this.sample('whoosh_low', { vol: 0.4, rate: 1.3 }); break;
      case 'tk_throw': this.sample('whoosh_trailer', { vol: 0.8, rate: 1.1 }); this.sample('whoosh_low', { vol: 0.6, rate: 0.9 }); break;
      case 'cata_start': this.sample('buildup', { vol: 0.75, off: Math.max(0, 21.6 - (o.time || 5)), dur: (o.time || 5) + 0.4 }); this.sample('rumble_in', { vol: 0.8, off: Math.max(0, 10 - (o.time || 5)) }); this.sample('choir', { vol: 0.5, rate: 0.75 }); this.sample('magic_smite', { vol: 0.6, rate: 0.6 }); break;
      case 'cata_riser': this.sample('riser', { vol: 0.75 }); this.sample('reverse_cymbal', { vol: 0.8, off: 3.0 }); break;
      case 'quake': this.sample('earthquake', { vol: 1.0 }); this.sample('avalanche', { vol: 0.8, delay: 0.3 }); this.sample('boom2', { vol: 0.8 }); this.sample('sub_drop', { vol: 0.6 }); break;
      case 'erupt_start': this.sample('earthquake', { vol: 0.9 }); this.sample('rumble_in', { vol: 0.9, off: 6 }); this.sample('avalanche', { vol: 0.6, delay: 1.2 }); this.sample('magic_smite', { vol: 0.5, rate: 0.6 }); break;
      case 'frost': this.sample('freeze', { vol: 0.9 }); this.sample('ice2', { vol: 0.9, pos, size: 6 }); this.sample('reverse_short', { vol: 0.4 }); this.sample('sub_drop', { vol: 0.5 }); break;
      case 'ice': if (this.limit('ice', 0.07)) this.sample(['ice_break', 'ice1', 'glass2'], { vol: 0.55 * s, pos, size: 3 * s, rate: rr(0.7, 1.15) / s, dur: 2.5 }); break;
      case 'deluge': this.sample('splash', { vol: 1.0, pos, size: 8, rate: 0.6 }); this.sample('boom3', { vol: 0.7, pos, size: 6 }); this.sample('whoosh_big', { vol: 0.6, rate: 0.6 }); this.sample('spellcast', { vol: 0.5 }); break;
      case 'bloom': this.sample('magic_cliche', { vol: 0.7, rate: 0.8 }); this.sample('choir', { vol: 0.5, rate: 1.2 }); this.sample('spellcast', { vol: 0.5, rate: 1.1 }); break;
      case 'conjure': this.sample('avalanche', { vol: 0.8, pos, size: 5 }); this.sample('earthquake', { vol: 0.5, dur: 3 }); this.sample('magic_smite', { vol: 0.6 }); break;
      case 'ascend': this.sample('reverse_cymbal', { vol: 0.9, off: 2.4 }); this.sample('magic_smite', { vol: 0.6, rate: 0.7 }); this.sample('choir', { vol: 0.4, rate: 0.9 }); break;
      case 'slam': this.sample('whoosh_big', { vol: 0.9, rate: 0.7 }); this.sample('bass_drop', { vol: 0.7 }); break;
      case 'timestop': this.sample('timewarp', { vol: 0.9, rate: 0.6 }); this.sample('reverse_short', { vol: 0.6 }); this.sample('sub_drop', { vol: 0.7 }); this.sample('clock', { vol: 0.9, dur: 7.6, delay: 0.4, bus: 'music' }); this.muffle(900, 0.3); this.setLoop('music', { vol: 0.08, tau: 0.3 }); break;
      case 'timeresume': this.sample('timewarp', { vol: 0.9, rate: 1.4 }); this.sample('whoosh_big', { vol: 0.7 }); this.muffle(20000, 0.4); this.setLoop('music', { vol: 0.42, tau: 1 }); break;
      case 'eclipse': this.sample('choir_long', { vol: 1.0, dur: 9 }); this.sample('bass_drop', { vol: 0.6 }); this.sample('reverse_cymbal', { vol: 0.6, off: 3 }); break;
      case 'restore': this.sample('choir_long', { vol: 1.0, dur: 8, rate: 1.2 }); this.sample('magic_cliche', { vol: 0.8, rate: 0.7 }); this.sample('reverse_cymbal', { vol: 0.8, off: 2 }); this.sample('boom1', { vol: 0.6, delay: 0.6 }); break;
      case 'blink': this.sample('teleport', { vol: 0.7, rate: 1.2 }); this.sample('warp', { vol: 0.8 }); this.sample('whoosh_low', { vol: 0.6 }); break;
      case 'fly': this.sample('whoosh_trailer', { vol: 0.6, rate: 0.8 }); this.sample('magic_spell', { vol: 0.4, rate: 1.3 }); break;
      case 'select': this.sample('fire_magic', { vol: 0.16, rate: 1.5 + (o.i || 0) * 0.12 }); break;
      case 'bell': this.sample('bell', { vol: 0.9, pos, size: 7 }); break;
      default: break;
    }
  }

  update(dt) {
    if (!this.started && G.capture) { this.started = true; this.startAmbience(); }
    if (!this.started) return;
    // ambience driven by the simulation: collapsing masonry rumbles, burning ruins crackle, the bell tolls while it stands
    const awake = G.physics.stats.awake;
    const target = clamp((awake - 25) / 500, 0, 1);
    this.rumble += (target - this.rumble) * Math.min(1, dt * (target > this.rumble ? 6 : 1.2));
    if (this.rumble > 0.03) this.loop('rumble', 'rumble_loop', { vol: this.rumble * 0.7, fade: 0.3 }); else this.stopLoop('rumble', 1.5);
    const fires = G.fx ? G.fx.emitters.length : 0;
    this.fires += (clamp(fires / 14, 0, 1) - this.fires) * Math.min(1, dt * 1.5);
    if (this.fires > 0.03) this.loop('fires', 'fire_loop', { vol: this.fires * 1.6, fade: 1 }); else this.stopLoop('fires', 2);
    const razed = G.physics.structTotal ? G.physics.structDown / G.physics.structTotal : 0;
    this.setLoop('town', { vol: 0.5 * Math.max(0, 1 - razed * 8), tau: 1 });
    this.setLoop('birds', { vol: 0.5 * Math.max(0, 1 - razed * 5), tau: 1 });
    this.bellT -= dt;
    if (this.bellT <= 0) { this.bellT = 9; if (G.world?.bell && G.world.bell.alive && !G.world.bell.counted) this.play('bell', { pos: { x: G.world.bell.x, y: G.world.bell.y, z: G.world.bell.z } }); }
  }

  // ---- offline render of the logged mix (used for the MP4) ----
  async renderOffline(duration, sampleRate = 48000) {
    const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
    const mix = new Mixer(ctx, this.buffers);
    const evs = [...this.events].sort((a, b) => a.t - b.t);
    for (const e of evs) if (e.t < duration) mix.handle(e, Math.max(0, e.t));
    mix.master.gain.setValueAtTime(0.8, Math.max(0, duration - 2.2)); mix.master.gain.linearRampToValueAtTime(0.0001, duration);
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
    const wav = new DataView(new ArrayBuffer(44 + n * 4));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); wav.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 2, true);
    wav.setUint32(24, sampleRate, true); wav.setUint32(28, sampleRate * 4, true); wav.setUint16(32, 4, true); wav.setUint16(34, 16, true); w(36, 'data'); wav.setUint32(40, n * 4, true);
    const soft = (v) => Math.tanh(v * 1.05) * 0.97; // gentle limiter so big moments never hard-clip
    for (let i = 0; i < n; i++) { wav.setInt16(44 + i * 4, soft(L[i]) * 32767, true); wav.setInt16(46 + i * 4, soft(R[i]) * 32767, true); }
    this._wav = new Uint8Array(wav.buffer);
    return this._wav.length;
  }
  wavChunk(start, len) {
    const part = this._wav.subarray(start, start + len); let s = '';
    for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
    return btoa(s);
  }
}
