// ARCHMAGE — Tenth Circle. Boot, main loop and capture hooks.
import * as THREE from 'three';
import { G } from './core/globals.js';
import { seedRandom, makeNoiseTexture, damp } from './core/util.js';
import { Post } from './render/post.js';
import { Sky } from './world/sky.js';
import { Terrain } from './world/terrain.js';
import { Grass } from './world/grass.js';
import { Physics } from './physics/physics.js';
import { Player } from './player/player.js';
import { Input } from './player/input.js';
import './world/settlements.js';
import { Forest } from './world/forest.js';
import { Water } from './world/water.js'; // registers every town's building site before the terrain is generated

const params = new URLSearchParams(location.search);
G.capture = params.has('capture');
G.liveSim = !G.capture || params.has('live');
{ // camera feel: steady unless recording, running the showcase, or asked for with ?cinematic / the B key
  let saved = null; try { saved = localStorage.getItem('archmage.cam'); } catch (e) { /* no storage */ }
  G.setCam(G.capture || params.has('demo') || params.has('cinematic') ? 'cinematic' : params.has('steady') ? 'steady' : saved || 'steady');
}      // live-play simulation shortcuts (off while recording; ?live forces them on for testing)
G.quality = params.get('q') || 'high';
const renderScale = parseFloat(params.get('scale') || (G.capture ? '1.5' : '1'));
// Live play: if the graphics card cannot hold the frame rate, the internal resolution steps down (and back up when
// there is room). Off while recording and when ?scale= is given.
const dyn = { on: !G.capture && !params.has('scale'), k: 1, ema: 16.7, cpu: 4, n: 0, upAt: 0, lastUp: -1e9, lock: 0 };
const $ = (id) => document.getElementById(id);
const setStatus = (t, p) => { $('status').textContent = t; if (p !== undefined) $('bar').firstElementChild.style.width = `${p * 100}%`; };

async function loadTextures() {
  const loader = new THREE.TextureLoader();
  const names = ['grass', 'gravel', 'cliff', 'paving', 'stone', 'darkstone', 'wood', 'plaster', 'roof', 'ashlar'];
  const jobs = [];
  const aniso = Math.min(8, G.renderer.capabilities.getMaxAnisotropy());
  for (const n of names) for (const m of ['diff', 'nor', 'arm']) {
    if (m === 'arm' && ['grass', 'gravel', 'cliff', 'paving'].includes(n)) continue;
    jobs.push(loader.loadAsync(`./assets/${n}_${m}.jpg`).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
      t.colorSpace = m === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      G.tex[`${n}_${m}`] = t;
    }));
  }
  await Promise.all(jobs);
}

async function boot() {
  seedRandom(parseInt(params.get('seed') || '20261115', 10));
  const canvas = $('game');
  const renderer = G.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: false, alpha: false, preserveDrawingBuffer: G.capture });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the final pass encodes sRGB itself
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  G.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';

  G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.07, 9000);
  G.camera.layers.enableAll();
  G.noiseTex = makeNoiseTexture(256);
  G.post = new Post(renderer, G.scene, G.camera, { msaa: G.quality === 'low' ? 2 : 4, ao: G.quality === 'low' ? 0 : 1 });

  setStatus('loading textures', 0.1);
  await loadTextures();
  setStatus('lighting the sky', 0.3);
  G.sky = await new Sky().load(`./assets/${params.get('sky') || 'sky_b'}_4k.hdr`, parseFloat(params.get('sun') || '42'));
  setStatus('raising the land', 0.5);
  G.physics = await new Physics().init();
  G.terrain = new Terrain(G.sunDir).build();
  G.terrain.rebuildCollider();
  setStatus('growing grass', 0.65);
  G.grass = new Grass(G.quality).build(G.terrain);
  setStatus('planting forests', 0.7);
  G.water = new Water().build();
  G.forest = (await new Forest().load()).build();

  G.input = new Input(canvas);
  G.player = new Player();
  G.player.init();

  const mods = await import('./game.js').catch((e) => { console.warn('game layer not loaded:', e.message); return null; });
  if (mods) await mods.initGame(setStatus);

  resize();
  window.addEventListener('resize', resize);
  setStatus('ready', 1);
  // warm up: compile shaders + settle
  for (let i = 0; i < 3; i++) frame(1 / 60);

  if (G.capture) { $('overlay').classList.add('hidden'); }
  else {
    const btn = $('start'); btn.disabled = false;
    G.input.attach((locked) => { if (!locked) { G.paused = true; $('overlay').classList.remove('hidden'); btn.textContent = 'RESUME'; } });
    btn.addEventListener('click', () => { G.audio?.resume(); G.input.lock(); $('overlay').classList.add('hidden'); G.paused = false; if (!G.started) G.hud?.showTitle('ARCHMAGE', 'RAZE THE CITY', 3.5); G.started = true; });
    let last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
      const c0 = performance.now();
      frame(dt);
      if (dyn.on && !G.paused) {
        const real = (now - dyn.prev) || 16.7; dyn.prev = now;
        if (real < 250) { dyn.ema += (real - dyn.ema) * 0.05; dyn.cpu += (performance.now() - c0 - dyn.cpu) * 0.05; }
        if (++dyn.n >= 75) {
          dyn.n = 0;
          const gpuBound = dyn.cpu < dyn.ema * 0.6;                     // the frame is long, but not because of our own work
          if (dyn.ema > 21 && gpuBound && dyn.k > 0.56) {
            if (now - dyn.lastUp < 5000) dyn.lock = now + 60000;         // the step up was too much: stay down for a while
            dyn.k = Math.max(0.55, dyn.k * 0.85); dyn.ema = 16.7; resize();
          } else if (dyn.ema < 17.6 && dyn.k < 1 && now > dyn.lock && now - dyn.lastUp > 8000) {
            dyn.k = Math.min(1, dyn.k / 0.85); dyn.lastUp = now; resize();
          }
        }
      }
    };
    requestAnimationFrame(loop);
  }
  window.__game = {
    ready: true, G, THREE,
    step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(dt); return G.frame; },
    // capture helpers: one composited frame (game + HUD) as JPEG, and the offline-rendered soundtrack
    grab: (q = 0.95) => {
      const g = G.renderer.domElement, h = document.getElementById('hud');
      const c = (window.__cc ||= document.createElement('canvas')); if (c.width !== g.width) { c.width = g.width; c.height = g.height; }
      const x = c.getContext('2d'); x.drawImage(g, 0, 0); if (h.width > 1) x.drawImage(h, 0, 0, g.width, g.height);
      return c.toDataURL('image/jpeg', q).slice(23);
    },
    audio: (duration) => G.audio ? G.audio.renderOffline(duration) : 0,
    wav: (a, n) => G.audio.wavChunk(a, n),
  };
}

function resize() {
  const w = G.capture ? parseInt(params.get('w') || '1920', 10) : window.innerWidth;
  const h = G.capture ? parseInt(params.get('h') || '1080', 10) : window.innerHeight;
  G.renderer.setSize(w, h, !G.capture);
  if (G.capture) { const c = G.renderer.domElement; c.style.width = w + 'px'; c.style.height = h + 'px'; }
  G.camera.aspect = w / h; G.camera.updateProjectionMatrix();
  G.post.resize(w, h, renderScale * dyn.k);
  G.hud?.resize(w, h);
}

function frame(realDt) {
  G.realDt = realDt; G.realTime += realDt; G.frame++;
  G.timeScale = damp(G.timeScale, G.timeScaleTarget, 7, realDt);
  const paused = G.paused && !G.capture && G.started;
  const dt = paused ? 0 : realDt * G.timeScale;
  G.dt = dt; G.time += dt;
  G.renderer.info.reset();
  G.director?.update(realDt);
  for (const e of G.input.drain()) {
    if (e.type === 'jump') G.player.wantJump = true;
    else G.spells?.onEvent(e);
  }
  // while time is stopped the archmage alone keeps moving at full speed
  const own = G.timeStop > 0 ? realDt : dt;
  G.castDt = own;
  G.player.update(own, realDt);
  G.spells?.update(dt);
  G.physics.step(dt);
  G.fx?.update(dt);
  G.hand?.update(dt, realDt);
  G.particles?.update(dt);
  G.forest?.update(dt);
  G.water?.update(dt);
  G.terrain.update(dt);
  G.grass.update(dt, G.camera);
  G.sky.update(realDt);
  G.audio?.update(realDt);
  G.post.render(realDt);
  G.hud?.draw(realDt);
}

boot().catch((e) => { console.error(e); setStatus('error: ' + e.message); window.__game = { ready: false, error: String(e.stack || e) }; });
