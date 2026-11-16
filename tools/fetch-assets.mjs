// Downloads CC0 assets (Poly Haven) + the MIT WebXR generic hand model into public/assets
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('public/assets');
fs.mkdirSync(OUT, { recursive: true });
const TEX = {
  grass: 'aerial_grass_rock', soil: 'forrest_ground_01', gravel: 'rock_ground_02', cliff: 'rock_face_03',
  stone: 'rock_08', darkstone: 'rock_surface', wood: 'weathered_brown_planks', paving: 'cobblestone_05',
  plaster: 'white_plaster_02', roof: 'clay_roof_tiles_03', ashlar: 'medieval_blocks_05',
};
const SKIES = { sky_a: 'kloppenheim_06_puresky', sky_b: 'belfast_sunset_puresky' };
async function dl(url, file) {
  const dst = path.join(OUT, file);
  if (fs.existsSync(dst) && fs.statSync(dst).size > 1000) return console.log('have', file);
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status + ' ' + url);
  fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer()));
  console.log('got ', file, (fs.statSync(dst).size / 1e6).toFixed(2) + 'MB');
}
const jobs = [];
for (const [key, name] of Object.entries(TEX)) {
  const f = await (await fetch('https://api.polyhaven.com/files/' + name)).json();
  const pick = (k, res) => f[k]?.[res]?.jpg?.url;
  const maps = { diff: pick('Diffuse', '2k'), nor: pick('nor_gl', '2k'), arm: pick('arm', '1k') || pick('Rough', '1k') };
  for (const [m, url] of Object.entries(maps)) { if (url) jobs.push(dl(url, `${key}_${m}.jpg`)); else console.log('MISSING', key, m, Object.keys(f)); }
}
for (const [key, name] of Object.entries(SKIES)) {
  jobs.push(dl(`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/${name}_4k.hdr`, `${key}_4k.hdr`));
}
// trees: tileable bark, and photo-scanned leaf / twig sheets with alpha masks (from Poly Haven's CC0 tree models)
fs.mkdirSync(path.join(OUT, 'trees'), { recursive: true });
const TREES = {
  bark: ['jolcham_oak_bark_01', { diff: 'Diffuse', nor: 'nor_gl' }], pinebark: ['pine_bark', { diff: 'Diffuse', nor: 'nor_gl' }],
  leaf: ['island_tree_02', { diff: 'leaves_diff', alpha: 'leaves_alpha' }], frond: ['jacaranda_tree', { diff: 'leaves_diff', alpha: 'leaves_alpha' }],
  twig: ['fir_tree_01', { diff: 'twig_diff', alpha: 'twig_alpha' }],
};
for (const [key, [name, maps]] of Object.entries(TREES)) {
  const f = await (await fetch('https://api.polyhaven.com/files/' + name)).json();
  for (const [m, k] of Object.entries(maps)) { const url = f[k]?.['1k']?.jpg?.url; if (url) jobs.push(dl(url, `trees/${key}_${m}.jpg`)); else console.log('MISSING', key, m); }
}
for (const h of ['left', 'right']) jobs.push(dl(`https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/${h}.glb`, `hand_${h}.glb`));
await Promise.all(jobs);
console.log('done');
