// Downloads the game's sound bank: real recordings from freesound.org, all Creative Commons 0.
// (HQ mp3 previews.) Writes public/assets/sfx/<name>.mp3 and CREDITS.md
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('public/assets/sfx');
fs.mkdirSync(OUT, { recursive: true });
// name: [freesound id, user id, author, original title]
export const BANK = {
  explosion1: [235968, 4265427, 'tommccann', 'Explosion_01'],
  explosion2: [741173, 71257, 'qubodup', 'Big Explosion'],
  explosion3: [132929, 1887925, 'deleted_user_1887925', 'Explosion and Rubble/Debris'],
  explosion_huge: [259300, 1038806, 'unfa', 'Huge Explosion'],
  explosion_huge2: [366088, 4557960, 'bevibeldesign', 'Huge Explosion Part 2 - Impact'],
  boom1: [255111, 2472317, 'rhapsodize', 'Cinematic_Boom_Rhapsodize'],
  boom2: [177242, 3277771, 'deleted_user_3277771', 'Cinematic Impact'],
  boom3: [441593, 7383104, 'Poligonstudio', 'Deep Impact'],
  bayhit: [347561, 2247456, 'Kinoton', 'Micheal Bay Hit'],
  fire_whoosh: [260554, 3968707, 'LookIMadeAThing', 'Basic Fire whoosh'],
  fireball_whoosh: [267887, 5025429, 'wjl', 'Short-Fireball-Woosh'],
  fire_magic: [442872, 71257, 'qubodup', 'Fire Magic'],
  fire_explosion: [186932, 545448, 'ReadeOnly', 'fire_explosion'],
  fire_loop: [181563, 1857065, 'kingsrow', 'Fire Crackling 01'],
  fire_roar: [494827, 6142932, 'NickTimesAudio', 'Seamless Rocket Booster Roar & Crackle'],
  thunder1: [840628, 16682330, 'loganzsound', 'Closeup Thunder Strike 01'],
  thunder2: [534023, 9395330, 'Fission9', 'Thunderclap'],
  thunder3: [475094, 9608356, 'Josh74000MC', 'thunder3'],
  thunder4: [188767, 3381483, 'vonz', 'Thunder (Krakow, Poland, 20.05.2013)'],
  electric_loop: [740198, 9129912, 'el_boss', 'Zapping - High Voltage Electricity Buzz Isolated'],
  zap1: [136542, 1206321, 'JoelAudio', 'ELECTRIC_ZAP_001'],
  zap2: [536741, 1415754, 'egomassive', 'Zap'],
  zap3: [367960, 5966858, 'TRNGLE', 'Zap'],
  drone: [367480, 5595738, 'PRIM_ORDial', 'Deep Bass Drone'],
  drone2: [268577, 5086704, '7h3_lark', 'Alien Drone - Deep oscillating bass'],
  rumble_loop: [638914, 3661618, 'lennartgreen', 'Low Rumble - loopable ambiance'],
  rumble_in: [258341, 1038806, 'unfa', 'Rumble - fade in 10s'],
  earthquake: [222521, 255863, 'uagadugu', 'Cracking Earthquake (cracking soil, cracking stone)'],
  riser: [545798, 11961848, 'eldiariosonoro_', 'Metallic Horror Riser FX'],
  riser_boom: [770200, 6523125, 'deep_', 'Riser Slam Boom | Trailer Effect'],
  buildup: [250518, 4459494, 'divdbyone', 'Inception (kinda) build up'],
  reverse_cymbal: [148930, 2259717, 'HUMANOISEMAKER', 'Cymbal Hits Reversed'],
  reverse_short: [9523, 24197, 'burnttoys', 'cymbal-reversed-glassy-resonance'],
  bomb_fall: [398255, 5937039, 'morganpurkis', 'Bomb Dropping'],
  bomb_fall2: [506313, 150886, 'Daleonfire', 'Falling Bomb'],
  meteor: [562298, 11785387, 'colorsCrimsonTears', 'Meteor - Rpg'],
  beam_loop: [584191, 1038806, 'unfa', 'Weapons Beam Loop'],
  beam_charge: [514081, 4838691, 'Tim_Verberne', 'Sci-Fi Weapon Charging 02'],
  whoosh_low: [475135, 2927958, 'bolkmar', 'FX - Swoosh - Low Pitch'],
  whoosh_big: [234547, 4238641, 'Electroviolence', 'Big Swoosh'],
  whoosh_trailer: [171255, 71257, 'qubodup', 'Sliding Trailer Woosh'],
  swoosh_explosion: [234555, 4238641, 'Electroviolence', 'Swoosh Explosion'],
  sub_drop: [428073, 4067257, 'newagesoup', 'Sub Drop Smooth'],
  bass_drop: [212768, 71257, 'qubodup', 'Bass Drop'],
  magic_smite: [249819, 3756348, 'spookymodem', 'Magic Smite'],
  magic_spell: [442774, 71257, 'qubodup', 'Magic Spell'],
  magic_cliche: [817466, 71257, 'qubodup', 'Cliche Magic Spell Sound'],
  spellcast: [455341, 7442087, 'russscott1', 'Spellcast'],
  hum_loop: [861430, 71257, 'qubodup', 'evil space ship warp core hum loop'],
  choir: [207809, 3863330, 'Exsomniel', 'Dark Choir 01'],
  choir_long: [278903, 3546642, 'syntheway', 'Guardians Of Limbo: Magnus Choir'],
  rock1: [522099, 11537497, 'magnuswaker', 'Concrete SMASH 2'],
  rock2: [385938, 7097737, 'Pol', 'S020_Rock_Impact_Mono'],
  rock3: [319229, 3443504, 'worthahep88', 'Single Rock hit dirt 2'],
  rock4: [332058, 71257, 'qubodup', 'Collision'],
  rock5: [105287, 537412, 'mbezzola', 'Stein Aufschlag mit langem Decay 10'],
  rubble: [336023, 4054883, 'adamgryu', 'Rocks'],
  crumble: [521956, 311243, 'Kastenfrosch', 'Stone Crumble 2'],
  collapse1: [712918, 15139380, 'greyfeather', 'building collapse / demolition'],
  collapse2: [845932, 2524442, 'craigsmith', 'Building Collapse'],
  collapse3: [721600, 2617407, 'DasWaff', 'Bakers house collapse'],
  wood_collapse: [487142, 2524442, 'craigsmith', 'R29-04-Crashing Collapse of Wood Building'],
  wood1: [536777, 1415754, 'egomassive', 'Smash'],
  wood2: [164472, 2104797, 'deleted_user_2104797', 'Crack of branch 3'],
  wood3: [422623, 8455865, 'Aurelon', 'Crack and Crunch'],
  glass1: [221528, 1038806, 'unfa', 'Glass Break'],
  glass2: [244238, 3156517, 'chewiesmissus', 'Glass Smash'],
  wind: [459981, 6253486, 'florianreichelt', 'Strong Wind'],
  ambience: [351609, 3907739, 'dsebeste', 'PrairieSummer_ambience'],
  town: [119934, 1990698, 'ftpalad', 'Town Square Ambience'],
  bell: [120833, 1708550, 'odilonmarcenaro', 'enkhuizen catholic church'],
  bell2: [378799, 7025952, 'kgeshev', 'BELL'],
  rain: [624645, 12956617, 'Rubaoliva', 'Heavy_Rain_Loop'],
  ice1: [342546, 3562222, 'timbreknight', 'Ice cracking'],
  ice2: [452645, 612689, 'kyles', 'ice grinding cracking freezing designed'],
  freeze: [685253, 5175373, 'antonsoederberg', 'Freeze sound effect FX'],
  ice_break: [422633, 8455865, 'Aurelon', 'Break something (ice/glass/...)'],
  waterfall: [530169, 4574070, 'Osiruswaltz', 'Large Waterfall 2 (Loopable)'],
  splash: [442773, 71257, 'qubodup', 'Big Water Splash'],
  tempest_wind: [770264, 13973196, 'Vrymaa', 'Wind - Binaural tempest near a window'],
  lava: [474850, 9395330, 'Fission9', 'Lava Loop 2'],
  avalanche: [162674, 623488, 'blaukreuz', 'avl05'],
  clock: [337163, 4067257, 'newagesoup', 'grandfather-clockdown'],
  tick: [339069, 5450487, 'cabled_mess', 'Wall clock [loop]'],
  tree_fall: [494071, 2247456, 'Kinoton', 'Big Tree Fall in Forest'],
  tree_fall2: [139952, 2337290, 'ecfike', 'A Tree Falling Down'],
  warp: [453391, 9159316, 'Breviceps', 'Warp SFX'],
  teleport: [453390, 9159316, 'Breviceps', 'Teleport Sound'],
  timewarp: [324644, 5152429, 'chinomaker', 'Time warp effect'],
  music_dark: [701688, 1339626, 'Daniel Prellball', 'Epic Dark Fantasy'],
  music_hybrid: [507747, 6900479, 'Magmi.Soundtracks', 'Hybrid Action Music 01'],
  music_suspense: [387223, 4724550, 'awrmacd', 'Orchestral Suspense Loop 1'],
  music_epic: [545459, 6714882, 'Bertsz', 'Epic Synth/Orchestral Music'],
  music_war: [608811, 3968818, 'MusicByMisterbates', 'Uplifting Dramatic Soundtrack - War Around Us'],
};
if (process.argv[1].endsWith('fetch-sounds.mjs')) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const entries = Object.entries(BANK);
  let failed = 0;
  const work = async ([name, [id, uid]]) => {
    const dst = path.join(OUT, name + '.mp3');
    if (fs.existsSync(dst) && fs.statSync(dst).size > 2000) return;
    const url = `https://cdn.freesound.org/previews/${Math.floor(id / 1000)}/${id}_${uid}-hq.mp3`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.ok) { fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer())); console.log('got', name, (fs.statSync(dst).size / 1024).toFixed(0) + 'KB'); return; }
      await new Promise((res) => setTimeout(res, 3000 * (attempt + 1)));
    }
    failed++; console.log('FAILED', name, url);
  };
  for (let i = 0; i < entries.length; i += 4) await Promise.all(entries.slice(i, i + 4).map(work));
  const lines = ['# Sound credits', '', 'All sounds are real recordings from [freesound.org](https://freesound.org), licensed **Creative Commons 0** (public domain). Thank you to the authors:', '',
    '| Game sound | Original | Author | Link |', '|---|---|---|---|',
    ...entries.map(([n, [id, , user, title]]) => `| ${n} | ${title.replace(/\|/g, '/')} | ${user} | https://freesound.org/s/${id}/ |`)];
  fs.writeFileSync(path.join(OUT, 'CREDITS.md'), lines.join('\n') + '\n');
  console.log('done, failed:', failed);
}
