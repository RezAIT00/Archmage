// Renders the scripted showcase to an MP4: the game is stepped frame by frame at a fixed 1/60 s
// (so the video is perfectly smooth regardless of machine speed), each frame is piped to ffmpeg,
// and the soundtrack is mixed offline from the exact sound events the run produced.
//   node tools/capture.mjs [--w 1920 --h 1080 --scale 1.5 --out out/archmage.mp4 --seconds N --crf 17]
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const W = +opt('w', 1920), H = +opt('h', 1080), scale = opt('scale', '1.5'), crf = opt('crf', '22'), fps = 60;
const out = path.resolve(opt('out', 'out/archmage_gameplay.mp4'));
const srv = await startServer();
const port = srv.port;
fs.mkdirSync(path.dirname(out), { recursive: true });
const tmpVideo = out.replace(/\.mp4$/, '.video.mp4'), tmpWav = out.replace(/\.mp4$/, '.wav');

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  userDataDir: path.resolve('out/.chrome-profile-capture'), defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--window-size=${W},${H}`, '--hide-scrollbars', '--force-device-scale-factor=1'],
  protocolTimeout: 1200000,
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[game]')) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(`http://127.0.0.1:${port}/?capture=1&demo=1&w=${W}&h=${H}&scale=${scale}${opt('url', '') ? '&' + opt('url', '') : ''}`, { waitUntil: 'load' });
await page.waitForFunction('window.__game !== undefined', { timeout: 240000 });
const st = await page.evaluate(() => ({ ready: __game.ready, error: __game.error, gpu: __game.G?.gpu, dur: __game.G?.director?.duration }));
if (!st.ready) { console.log('boot failed', st.error); await browser.close(); process.exit(1); }
const seconds = +opt('seconds', st.dur || 60), frames = Math.ceil(seconds * fps);
console.log(`gpu: ${st.gpu}\nrendering ${frames} frames (${seconds.toFixed(1)} s) at ${W}x${H}, internal scale ${scale}`);

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-maxrate', '26M', '-bufsize', '52M', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(fps), tmpVideo], { stdio: ['pipe', 'inherit', 'inherit'] });
const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  const b64 = await page.evaluate(() => { __game.step(1); return __game.grab(0.96); });
  const buf = Buffer.from(b64, 'base64');
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % 300 === 299) console.log(`  frame ${f + 1}/${frames}  ${((Date.now() - t0) / (f + 1)).toFixed(0)} ms/frame`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
console.log(`video done in ${((Date.now() - t0) / 1000).toFixed(0)} s; mixing audio…`);

const n = await page.evaluate((d) => __game.audio(d), seconds);
let muxed = false;
if (n > 0) {
  const fd = fs.openSync(tmpWav, 'w');
  for (let a = 0; a < n; a += 3 << 20) fs.writeSync(fd, Buffer.from(await page.evaluate((s, l) => __game.wav(s, l), a, 3 << 20), 'base64'));
  fs.closeSync(fd);
  await new Promise((r) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmpVideo, '-i', tmpWav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' }).on('close', r));
  muxed = fs.existsSync(out);
}
if (!muxed) fs.copyFileSync(tmpVideo, out);
const info = await page.evaluate(() => { const G = __game.G; return { razed: G.physics.structTotal ? (G.physics.structDown / G.physics.structTotal * 100).toFixed(1) + '%' : 'n/a', bodies: G.physics.blocks.length }; });
await browser.close();
if (muxed) { fs.rmSync(tmpVideo, { force: true }); fs.rmSync(tmpWav, { force: true }); }
console.log(`wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, audio: ${muxed ? 'yes' : 'NO'})`, info);
if (errors.length) console.log('--- console ---\n' + [...new Set(errors)].slice(0, 20).join('\n'));
await srv.close();
process.exit(0);
