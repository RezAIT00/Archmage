// The Greywater dam: coursed masonry across the gorge, holding the reservoir above the valley.
// Every block is a rigid body and is registered with the water as an obstacle, so the dam really does hold
// the water back and really does fail, block by block, once it is breached.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { DAM, RIVER } from './layout.js';
import { makeRng } from '../core/util.js';

const UP = new THREE.Vector3(0, 1, 0);

export function buildDam(world) {
  const P = G.physics, W = G.water, rng = makeRng(771);
  const ax = -DAM.tz, az = DAM.tx;                           // unit vector across the valley
  const q = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-az, ax));
  const y0 = DAM.toe - 0.6, COURSES = 10, ch = (DAM.crest - y0) / COURSES, ROW = 2.5, NOTCH = 3.5;
  const made = [], n0 = P.blocks.length;
  W.clearObstacles();
  const put = (a, f, y, len, o = {}) => {
    const x = DAM.x + ax * a + DAM.tx * f, z = DAM.z + az * a + DAM.tz * f, sy = o.sy ?? ch - 0.006;
    // stones bedded in the rock (the footing and the ends of every course) are part of the gorge and never move
    let bedded = !!o.fixed;
    if (!bedded && !o.loose) for (const e of [-0.5, 0, 0.5]) if (G.terrain.heightAt(x + ax * len * e, z + az * len * e) > y - sy / 2 + 0.12) bedded = true;
    const b = P.add({ shape: 'box', mat: 'ashlar', x, y, z, sx: len, sy, sz: o.sz ?? ROW - 0.006, q, struct: !bedded, tint: 0.7 + rng() * 0.22, tag: 'dam', fixed: bedded });
    if (b && !o.loose) { made.push(b); b.frac = 3.4; }          // old mortar: a real blast cracks these stones apart
    return b;
  };
  for (let k = 0; k < COURSES; k++) {
    const yTop = y0 + (k + 1) * ch, yc = yTop - ch / 2;
    const w = RIVER.half + Math.max(0, yTop - DAM.toe) / 3.2 + 2.8;          // half-span: into the rock on both sides
    const rows = k < 3 ? 3 : 2;
    // the spillway: the top two courses stop short of the middle, so the reservoir overflows there
    const spans = k >= COURSES - 2 ? [[-w, -NOTCH], [NOTCH, w]] : [[-w, w]];
    for (let r = 0; r < rows; r++) {
      const f = -ROW / 2 + r * ROW;
      for (const [s0, s1] of spans) {
        const n = Math.max(1, Math.round((s1 - s0) / 3.3)), len = (s1 - s0) / n, half = (k + r) % 2 === 1 && n > 1;
        // staggered joints: every other course starts with a half block
        const edges = [s0]; for (let i = 1; i < n; i++) edges.push(s0 + (i + (half ? -0.5 : 0)) * len); edges.push(s1);
        for (let i = 0; i < edges.length - 1; i++) {
          const a0 = edges[i], a1 = edges[i + 1];
          put((a0 + a1) / 2, f, yc, a1 - a0 - 0.006, { fixed: Math.abs(a0 + w) < 0.01 || Math.abs(a1 - w) < 0.01 });
        }
      }
    }
  }
  // parapets along the crest
  const wTop = RIVER.half + (DAM.crest - DAM.toe) / 3.2 + 2.8;
  for (const [s0, s1] of [[-wTop + 0.5, -NOTCH], [NOTCH, wTop - 0.5]]) {
    const n = Math.max(1, Math.round((s1 - s0) / 2.6)), len = (s1 - s0) / n;
    for (let i = 0; i < n; i++) for (const f of [-ROW + 0.3, ROW - 0.3]) put(s0 + (i + 0.5) * len, f, DAM.crest + 0.45, len - 0.05, { sy: 0.9, sz: 0.5, loose: true });
  }
  for (const b of made) W.addObstacle(b, DAM);
  // let the new stones touch down once, then put them to sleep (Rapier wakes bodies on their first contact)
  P.world.step();
  for (let i = n0; i < P.blocks.length; i++) { const b = P.blocks[i]; if (b.alive && !b.fixed) { b.body.setLinvel({ x: 0, y: 0, z: 0 }, false); b.body.setAngvel({ x: 0, y: 0, z: 0 }, false); b.body.sleep(); b.pvx = b.pvy = b.pvz = 0; } }
  world.dam = { blocks: made, x: DAM.x, z: DAM.z, crest: DAM.crest, toe: DAM.toe };
  if (!W.filled) { W.filled = true; W.fillAll(true); }
  console.log(`[game] dam: ${P.blocks.length - n0} blocks, water volume ${(W.volume / 1000).toFixed(1)}k m3`);
}
