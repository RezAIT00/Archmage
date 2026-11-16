// Measures real frames per second: the game runs exactly as it does when you play (not the frame-stepped
// recording mode), uncapped, and frames are counted against the wall clock.
//   node tools/fps.mjs [width height]
import { launch } from './shot.mjs';
import { startServer } from './serve.mjs';

const W = +process.argv[2] || 1920, H = +process.argv[3] || 1080;
const srv = await startServer(), browser = await launch(W, H), page = await browser.newPage(), errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${srv.port}/?mute&free${process.argv[4] ? '&' + process.argv[4] : ''}`, { waitUntil: 'load' });
await page.waitForFunction('window.__game && window.__game.ready', { timeout: 180000 });
await page.click('#start');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500);
await page.evaluate(() => {
  const G = __game.G; G.paused = false; G.input.v.active = true;
  window.ts = []; (function f() { window.ts.push(performance.now()); requestAnimationFrame(f); })();
  window.L = (tx, ty, tz) => { const p = G.player.pos, ex = p.x, ey = p.y + 1.66, ez = p.z; G.player.yaw = Math.atan2(-(tx - ex), -(tz - ez)); G.player.pitch = Math.atan2(ty - ey, Math.hypot(tx - ex, tz - ez)); };
  window.Wp = (x, z, h, tx, ty, tz) => { const pl = G.player; if (!pl.fly) G.spells.fly(); pl.teleport(x, z); pl.pos.y = G.terrain.heightAt(x, z) + h; pl.vel.set(0, 0, 0); pl.body.setTranslation({ x, y: pl.pos.y + 0.84, z }, true); window.L(tx, ty, tz); };
  window.ground = (x, z, tx, ty, tz) => { const pl = G.player; if (pl.fly) G.spells.fly(); pl.teleport(x, z); window.L(tx, ty, tz); };
  window.rebuild = () => { G.terrain.restore(); G.forest.restoreAll(); G.world.reset(); G.water.reset(); };
  window.stat = (label) => {
    const t = window.ts; window.ts = [];
    const d = []; for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
    if (d.length < 3) return { label, fps: 0 };
    const avg = d.reduce((a, b) => a + b, 0) / d.length; d.sort((a, b) => a - b);
    return { label, fps: Math.round(1000 / avg), low: Math.round(1000 / d[Math.floor(d.length * 0.99)]), worstMs: Math.round(d[d.length - 1]), moving: G.physics.stats.awake, res: G.post.W + 'x' + G.post.H };
  };
});
const out = [];
const measure = async (label, settle, ms) => { await sleep(settle); await page.evaluate(() => { window.ts = []; }); await sleep(ms); out.push(await page.evaluate((l) => window.stat(l), label)); };

await measure('Standing at the start', 800, 4000);
await page.evaluate(() => Wp(-150, 250, 40, 0, 0, -60)); await measure('Flying over the realm', 1200, 4000);
await page.evaluate(() => Wp(-60, 170, 3, -80, 4, 150)); await measure('Inside a forest', 1200, 4000);
await page.evaluate(() => ground(-300, 20, -296, 5, -2)); await measure('In a town street (Westmarch)', 1200, 4000);

await page.evaluate(() => { const G = __game.G; ground(0, 95.4, -6.6, 8, 61.6); G.spells.select(0); G.input.v.fire = true; });
await sleep(1300); await page.evaluate(() => { __game.G.input.v.fire = false; });
await measure('Inferno Orb on the city gate, first 4 s', 500, 4000);

await page.evaluate(() => rebuild()); await sleep(2500);
await page.evaluate(() => { const G = __game.G; Wp(0, 70, 30, -20, 6, -10); G.spells.select(2); G.input.v.fire = true; });
await sleep(1200); await page.evaluate(() => { __game.G.input.v.fire = false; });
await measure('Singularity in the old town, while it pulls (7 s)', 1500, 7000);
await measure('Singularity, the 8 s after it collapses', 0, 8000);

await page.evaluate(() => rebuild()); await sleep(2500);
await page.evaluate(() => { const G = __game.G; Wp(0, 60, 40, 0, 4, -26); G.ult = 1; G.spells.cataclysm(true); });
await measure('Cataclysm, charging (0-5 s)', 300, 4700);
await measure('Cataclysm, the blast (5-10 s)', 0, 5000);
await measure('Cataclysm, 10-15 s', 0, 5000);
await measure('Cataclysm, 15-25 s', 0, 10000);
await page.evaluate(() => rebuild());
await measure('After rebuilding the realm', 3000, 4000);

console.log(`resolution ${W}x${H}`);
for (const o of out) console.log(`${String(o.fps).padStart(4)} fps  (1% low ${String(o.low).padStart(3)}, worst frame ${String(o.worstMs).padStart(4)} ms, ${String(o.moving).padStart(4)} bodies moving, drawn at ${o.res})  ${o.label}`);
if (errs.length) console.log('page errors:', errs.slice(0, 3).join(' | '));
await browser.close(); await srv.close(); process.exit(0);
