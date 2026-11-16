// Lists CC0 candidates from freesound.org for each sound the game needs (used once to pick the bank).
// usage: node tools/sounds-search.mjs [filterKey]
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const Q = process.env.SQ ? Object.fromEntries(process.env.SQ.split(';').map((e) => { const [k, q, d0, d1] = e.split(','); return [k, [q, +d0, +d1]]; })) : {

  explosion: ['explosion', 2, 12], explosion_huge: ['huge explosion blast', 3, 15], boom_sub: ['cinematic impact boom', 2, 12],
  fire_whoosh: ['fire whoosh', 0.5, 4], fireball: ['fireball', 0.5, 5], fire_loop: ['fire crackling', 8, 60], flame_burst: ['flamethrower burst', 0.5, 6],
  thunder: ['thunder crack', 2, 14], thunder_close: ['lightning strike close', 1, 12], electric_loop: ['electric arc buzz', 3, 40], zap: ['electric zap', 0.2, 2.5],
  drone_dark: ['dark drone low', 8, 60], suction: ['suction whoosh reverse', 1, 8], riser: ['cinematic riser', 3, 12],
  missile: ['incoming missile whistle', 1, 8], flyby: ['fireball flyby whoosh', 0.5, 5], beam_loop: ['energy beam loop', 2, 30], laser_big: ['laser cannon charge', 1, 8],
  whoosh: ['whoosh heavy', 0.3, 3], shockwave: ['shockwave bass', 1, 8], magic_hum: ['magic hum loop', 3, 40], magic_cast: ['magic spell cast', 0.5, 5], chime: ['magic chime', 0.5, 5],
  choir: ['choir dark', 4, 40], impact_cine: ['trailer hit impact', 2, 12],
  rock_hit: ['rock impact', 0.2, 3], stone_fall: ['rocks falling debris', 1, 10], collapse: ['building collapse', 3, 20], rubble: ['rubble', 1, 10],
  wood_break: ['wood break crack', 0.3, 4], glass: ['glass shatter', 0.5, 5],
  wind: ['wind field ambience', 20, 180], bell: ['church bell single', 2, 20], town: ['medieval town ambience', 20, 180], music: ['epic orchestral dark', 40, 240],
};
const only = process.argv[2];
for (const [key, [q, d0, d1]] of Object.entries(Q)) {
  if (only && !key.includes(only)) continue;
  const url = `https://freesound.org/search/?q=${encodeURIComponent(q)}&f=${encodeURIComponent(`license:"Creative Commons 0" duration:[${d0} TO ${d1}]`)}&s=${encodeURIComponent('Downloads (most first)')}`;
  let html = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.status === 200) { html = await r.text(); break; }
    await new Promise((res) => setTimeout(res, 20000));
  }
  const out = [];
  for (const m of html.matchAll(/<div\s+class="bw-player"([^>]*)>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/data-([a-z-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    if (!a['sound-id']) continue;
    out.push(`${a['sound-id']}|${(+a.duration).toFixed(1)}s|dl${a['num-downloads']}|${a.username}/${a['user-id']}|${a.title}`);
    if (out.length >= 7) break;
  }
  console.log(`## ${key} (${q})\n` + out.join('\n'));
  await new Promise((r) => setTimeout(r, 4000));
}
