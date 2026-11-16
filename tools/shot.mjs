// Headless GPU screenshot harness.
// usage: node tools/shot.mjs "<cmd> | <cmd> | ..." [--w 1280 --h 720 --scale 1 --q high --url extra=params]
//   step N            advance N frames (1/60 s each)
//   shot name         save out/shots/name.jpg
//   eval <js>         run JS in page (G, THREE available)
//   log <js>          evaluate and print
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './serve.mjs';

const args = process.argv.slice(2);
const NL = String.fromCharCode(10);
const plan = (args[0] || 'step 30 | shot test').startsWith('@') ? fs.readFileSync(args[0].slice(1), 'utf8').split(NL).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).join(' | ') : (args[0] || 'step 30 | shot test');
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const W = +opt('w', 1280), H = +opt('h', 720), scale = opt('scale', '1'), q = opt('q', 'high'), extra = opt('url', '');
const outDir = path.resolve('out/shots'); fs.mkdirSync(outDir, { recursive: true });

export async function launch(w, h) {
  return puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    userDataDir: path.resolve('out/.chrome-profile-' + (process.env.SHOT_PROFILE || 'main')),
    defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--enable-webgl', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--window-size=${w},${h}`, '--hide-scrollbars',
      '--force-device-scale-factor=1'],
    protocolTimeout: 600000,
  });
}

if (process.argv[1].endsWith('shot.mjs')) {
  const srv = await startServer();
  const browser = await launch(W, H);
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warn' || t.startsWith('[game]') || opt('verbose', '')) { errors.push(`[${m.type()}] ${t}`); } });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${srv.port}/?capture=1&w=${W}&h=${H}&scale=${scale}&q=${q}${extra ? '&' + extra : ''}`, { waitUntil: 'load' });
  try { await page.waitForFunction('window.__game !== undefined', { timeout: +opt('boot', 60000) }); } catch (e) { console.log('BOOT TIMEOUT; status=', await page.evaluate(() => document.getElementById('status')?.textContent)); console.log(errors.join('\n')); await browser.close(); await srv.close(); process.exit(1); }
  // another process may be editing the source: if the world failed to build, wait and reload a few times
  for (let attempt = 0; attempt < 14; attempt++) {
    const ok = await page.evaluate(() => !!(window.__game && __game.ready && __game.G.world && __game.G.physics.blocks.length > 0 && __game.G.dbgCam));
    if (ok) break;
    console.log('world not ready (source being edited?), retrying in 25 s...'); errors.length = 0;
    await new Promise((r) => setTimeout(r, 25000));
    await page.reload({ waitUntil: 'load' });
    try { await page.waitForFunction('window.__game !== undefined', { timeout: 60000 }); } catch (e) {}
  }
  const st = await page.evaluate(() => ({ ready: __game.ready, error: __game.error, gpu: __game.G?.gpu }));
  console.log('boot', ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(st));
  if (st.ready) {
    for (const raw of plan.split(' | ')) {
      const cmd = raw.trim(); if (!cmd) continue;
      const sp = cmd.indexOf(' '); const op = sp < 0 ? cmd : cmd.slice(0, sp); const rest = sp < 0 ? '' : cmd.slice(sp + 1).trim();
      try {
        if (op === 'step') {
          const n = parseInt(rest || '1', 10); const t = Date.now();
          for (let done = 0; done < n;) { const k = Math.min(30, n - done); await page.evaluate((k) => { __game.step(k); }, k); done += k; }
          const ms = (Date.now() - t) / n; if (n >= 30) console.log(`step ${n}: ${ms.toFixed(1)} ms/frame`);
        } else if (op === 'shot') {
          const data = await page.evaluate(() => { const g = document.getElementById('game'), h = document.getElementById('hud'); const c = document.createElement('canvas'); c.width = g.width; c.height = g.height; const x = c.getContext('2d'); x.drawImage(g, 0, 0); if (h.width > 1) x.drawImage(h, 0, 0, g.width, g.height); return c.toDataURL('image/jpeg', 0.9); });
          fs.writeFileSync(path.join(outDir, rest + '.jpg'), Buffer.from(data.split(',')[1], 'base64'));
        } else if (op === 'eval') {
          await page.evaluate(new Function('const G = __game.G, THREE = __game.THREE;' + rest));
        } else if (op === 'log') {
          console.log(rest, '=>', JSON.stringify(await page.evaluate(new Function('const G = __game.G, THREE = __game.THREE; return (' + rest + ');'))));
        }
      } catch (e) { console.log('CMD FAILED:', cmd, '\n', e.message.split('\n').slice(0, 6).join('\n')); }
    }
  }
  if (errors.length) console.log('--- console ---\n' + [...new Set(errors)].slice(0, 30).join('\n'));
  await browser.close();
  await srv.close();
  process.exit(0);
}
