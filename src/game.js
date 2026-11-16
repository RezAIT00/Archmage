// Gameplay layer: the city, FX, the hand, spells, HUD, audio and the optional scripted showcase.
import * as THREE from 'three';
import { G } from './core/globals.js';
import { World } from './world/city.js';
import { FX } from './fx/effects.js';
import { Hand } from './player/hand.js';
import { Spells, SPELLS } from './spells/spells.js';
import { HUD } from './ui/hud.js';
import { AudioEngine } from './audio/audio.js';
import { Director } from './director.js';
import { buildDam } from './world/dam.js';

export async function initGame(setStatus) {
  const params = new URLSearchParams(location.search);
  setStatus('raising the old town', 0.72);
  G.world = new World();
  // the dam is raised right after the towns, every time the realm is (re)built
  const buildTowns = G.world.build.bind(G.world);
  G.world.build = () => { G.physics.beginStatic(); buildTowns(); buildDam(G.world); G.physics.endStatic(); };
  const resetWorld = G.world.reset.bind(G.world);
  G.world.reset = () => { G.physics.bulk = true; try { resetWorld(); } finally { G.physics.bulk = false; } };
  G.world.build();
  G.fx = new FX();
  G.addScore = (n) => { G.score += n; G.ult = Math.min(1, G.ult + n / 2600); };
  G.V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  G.lookAt = (x, y, z) => { const e = G.player.eye, dx = x - e.x, dy = y - e.y, dz = z - e.z; G.player.yaw = Math.atan2(-dx, -dz); G.player.pitch = Math.atan2(dy, Math.hypot(dx, dz)); };
  // debug: free camera for screenshots (freezes the player controller)
  G.dbgCam = (x, y, z, tx, ty, tz) => { G.player.update = () => {}; G.camera.position.set(x, y, z); G.camera.lookAt(tx, ty, tz); G.camera.updateMatrixWorld(); if (G.hand) G.hand.root.visible = false; G.player.pos.set(x, y, z); if (G.hud) G.hud.visible = false; };
  setStatus('binding the hand', 0.8);
  G.hand = await new Hand().load('./assets/hand_right.glb');
  G.spells = new Spells();
  G.hand.setGlow(SPELLS[0].color, 0.2);
  G.hud = new HUD(document.getElementById('hud'));
  if (!params.has('mute')) {
    setStatus('tuning the echoes', 0.86);
    G.audio = await new AudioEngine().load((p) => setStatus('tuning the echoes', 0.86 + p * 0.12));
  }
  if (params.has('free')) { G.spells.freeUlt = true; G.ult = 1; }
  if (params.has('demo')) G.director = new Director(params.get('demo'));
}
