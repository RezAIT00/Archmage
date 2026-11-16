// Every settlement outside the capital: towns, villages, castle, abbey, farms, landmarks...
// This module is imported for its side effects *before* the terrain is generated, so it registers
// its building sites and roads here at import time. The builders live in towns.js (layouts) and
// kit.js (building primitives).
import { G } from '../core/globals.js';
import { SITES, ROADS } from './layout.js';
import { BOROUGH_SITES, BOROUGH_ROADS } from './boroughs.js';
import {
  resetIds, buildWestmarch, buildCastle, buildAbbey, buildMirrormere, buildBarleyford, buildNorbury, buildGreystone,
  buildInn, buildStoneCircle, buildRuins, buildWatchtower, buildMillHill, buildFarm, buildShrine, buildTarnside, villageRoads,
} from './towns.js';
import {
  resetTownIds, growWestmarch, growMirrormere, growBarleyford, growNorbury, growTarnside, growGreystone, buildRavensford, buildAbbotsbury, buildHamlet,
} from './townsx.js';

// +X east, +Z south. Keep every disc >= 25 m from its neighbours, clear of the capital (0,-26 r93+22),
// the overlook (0,104) and the lakes; keep built things inside |x|,|z| < 390 (physics culls beyond 400).
export const SETTLEMENT_SITES = [
  { id: 'westmarch', name: 'Westmarch', x: -300, z: 15, r: 80, core: 55, blend: 22, pave: 1, paveR: 75 },
  { id: 'castle', name: 'Ravenscar Castle', x: -205, z: -200, r: 40, blend: 34, dh: 14, pave: 0.75, paveR: 30 },
  { id: 'abbey', name: "St Aldhelm's Abbey", x: 215, z: -195, r: 44, blend: 22, dirt: 0.3 },
  { id: 'mirrormere', name: 'Mirrormere', x: 310.3, z: 57.6, r: 40, blend: 18, pave: 0.9, paveR: 38 },
  { id: 'barleyford', name: 'Barleyford', x: -215, z: 200, r: 42, blend: 22, dirt: 0.5 },
  { id: 'norbury', name: 'Norbury', x: 20, z: -320, r: 42, core: 30, blend: 20, dirt: 0.55 },
  { id: 'tarnside', name: 'Tarnside', x: -242.8, z: -283, r: 22, blend: 16, dh: 2.6, dirt: 0.5 },
  { id: 'greystone', name: 'Greystone Quarry', x: 295, z: 295, r: 40, core: 30, blend: 18, dirt: 0.75 },
  { id: 'inn', name: "The Wyvern's Rest", x: 60, z: 215, r: 20, blend: 14, dirt: 0.55 },
  { id: 'ninestones', name: 'The Ninestones', x: -90, z: 330, r: 12, blend: 14, dirt: 0.25 },
  { id: 'ruins', name: 'Ruined chapel', x: 140, z: 255, r: 14, blend: 14, dirt: 0.35 },
  { id: 'millhill', name: 'Mill Hill', x: -130, z: 255, r: 10, blend: 16, dh: 2.5, dirt: 0.25 },
  { id: 'farm_hobb', name: "Hobb's Farm", x: -120, z: 150, r: 18, blend: 14, dirt: 0.45 },
  { id: 'farm_north', name: 'Northfield Farm', x: 72, z: -252, r: 18, blend: 14, dirt: 0.45 },
  { id: 'farm_lake', name: 'Meadow Farm', x: 190, z: 200, r: 18, blend: 14, dirt: 0.45 },
  { id: 'farm_west', name: 'Westfield Farm', x: -340, z: -110, r: 18, blend: 14, dirt: 0.45 },
  { id: 'shrine_n', name: 'Wayside shrine', x: -268, z: -104, r: 4, blend: 8, dirt: 0.25 },
  { id: 'shrine_e', name: 'Wayside shrine', x: 110, z: 130, r: 4, blend: 8, dirt: 0.25 },
  { id: 'shrine_w', name: 'Wayside shrine', x: -200, z: 80, r: 4, blend: 8, dirt: 0.25 },
  // villages at the feet of the castle and the abbey, and hamlets out in the empty country
  { id: 'ravensford', name: 'Ravensford', x: -240, z: -150, r: 22, blend: 18, rel: { to: 'castle', dh: -14 }, dirt: 0.5 },
  { id: 'abbotsbury', name: 'Abbotsbury', x: 232, z: -135, r: 22, blend: 18, rel: { to: 'abbey', dh: 0 }, dirt: 0.45 },
  { id: 'fenwick', name: 'Fenwick', x: -380, z: -170, r: 20, blend: 16, dirt: 0.5 },
  { id: 'southfold', name: 'Southfold', x: 0, z: 320, r: 22, blend: 16, dirt: 0.5 },
  { id: 'eastholme', name: 'Eastholme', x: 380, z: -80, r: 20, blend: 16, dirt: 0.5 },
  { id: 'brackenden', name: 'Brackenden', x: -200, z: 330, r: 20, blend: 16, dirt: 0.5 },
  { id: 'saltcote', name: 'Saltcote', x: 200, z: 330, r: 20, blend: 16, dirt: 0.5 },
  { id: 'hollins', name: 'Hollins', x: -360, z: 200, r: 24, blend: 16, dirt: 0.5 },
];
// more flat ground for the towns that grew past their old sites (same height as the town they belong to)
export const TOWN_EXT_SITES = [
  { id: 'mm_east', name: 'Mirrormere (east end)', x: 352, z: 42, r: 28, blend: 18, rel: { to: 'mirrormere', dh: 0 }, pave: 0.9 },
  { id: 'mm_north', name: 'Mirrormere (north end)', x: 346, z: 86, r: 24, blend: 18, rel: { to: 'mirrormere', dh: 0 }, pave: 0.9 },
  { id: 'bf_west', name: 'Barleyford (Westbrook)', x: -264, z: 220, r: 24, blend: 18, rel: { to: 'barleyford', dh: 0 }, dirt: 0.5 },
  { id: 'bf_south', name: 'Barleyford (Southend)', x: -212, z: 246, r: 20, blend: 18, rel: { to: 'barleyford', dh: 0 }, dirt: 0.5 },
  { id: 'tn_east', name: 'Tarnside (Fellgate)', x: -220, z: -306, r: 20, blend: 16, rel: { to: 'tarnside', dh: 0 }, dirt: 0.5 },
  { id: 'nb_west', name: 'Norbury (Westend)', x: -28, z: -352, r: 20, blend: 18, rel: { to: 'norbury', dh: 0 }, dirt: 0.55 },
  { id: 'gs_north', name: 'Greystone (Quarry Row)', x: 330, z: 258, r: 18, blend: 18, rel: { to: 'greystone', dh: 0 }, dirt: 0.7 },
];
// the capital's outer boroughs first (their height is tied to the capital), then everything else
SITES.push(...BOROUGH_SITES, ...SETTLEMENT_SITES, ...TOWN_EXT_SITES);

// dirt tracks joining everything into one realm
ROADS.push(
  { w: 2.4, pts: [[3, 66], [40, 76], [90, 112], [110, 126], [150, 150], [215, 150], [262, 128], [290, 96]] },  // south gate -> round Mirrormere -> lakeside town
  { w: 2.4, pts: [[-3, 66], [-40, 74], [-100, 62], [-160, 42], [-210, 26], [-236, 13], [-258, 10]] },                     // south gate -> Westmarch
  { w: 2.2, pts: [[-293, 70], [-270, 92], [-232, 98], [-206, 116], [-204, 156]] },                           // Westmarch -> Barleyford
  { w: 2.0, pts: [[-176, 208], [-140, 185], [-126, 166]] },                                                   // Barleyford -> Hobb's Farm
  { w: 2.0, pts: [[40, 76], [52, 130], [58, 196]] },                                                          // -> The Wyvern's Rest
  { w: 2.0, pts: [[78, 222], [120, 240], [200, 270], [267, 290]] },                                           // inn -> ruins -> Greystone
  { w: 2.0, pts: [[42, 222], [-20, 240], [-90, 250], [-120, 254]] },                                          // inn -> Mill Hill
  { w: 2.0, pts: [[-140, 252], [-178, 224]] },                                                                // Mill Hill -> Barleyford
  { w: 1.6, pts: [[-90, 250], [-95, 290], [-92, 317]] },                                                      // path to the Ninestones
  { w: 1.8, pts: [[200, 152], [194, 182]] },                                                                  // Meadow Farm
  ...BOROUGH_ROADS,                                                                                           // out of the capital's boroughs
  { w: 2.2, pts: [[240, -152], [266, -90], [290, -20], [300, 23]] },                                          // abbey -> Mirrormere
  { w: 2.0, pts: [[44, -306], [62, -266]] },                                                                  // Norbury -> Northfield
  { w: 2.0, pts: [[78, -236], [66, -222], [40, -216]] },                                                       // Northfield -> Northgate
  { w: 2.2, pts: [[-232, -166], [-270, -110], [-298, -62], [-306, -40]] },                                    // Ravenscar -> Westmarch
  { w: 1.8, pts: [[-272, -108], [-322, -110]] },                                                              // Westfield Farm
  { w: 2.0, pts: [[312, 93], [330, 160], [320, 230], [303, 266]] },                                           // Mirrormere -> Greystone
  { w: 2.0, pts: [[275, 278], [295, 295]] },                                                                  // Greystone's lane
  { w: 2.0, pts: [[-232.8, -257.6], [-205, -245], [-180, -225], [-172, -206]] },                                 // Tarnside -> Ravenscar
  { w: 1.8, pts: [[-350, -124], [-366, -150], [-376, -164]] },                                                // Westfield Farm -> Fenwick
  { w: 1.8, pts: [[-14, 241], [-6, 280], [-1, 300]] },                                                        // inn lane -> Southfold
  { w: 1.8, pts: [[272, -72], [320, -76], [362, -80]] },                                                      // abbey road -> Eastholme
  { w: 1.8, pts: [[-226, 262], [-210, 296], [-202, 312]] },                                                   // Barleyford -> Brackenden
  { w: 1.8, pts: [[200, 271], [201, 296], [200, 312]] },                                                      // Greystone road -> Saltcote
  { w: 1.8, pts: [[-306, 94], [-334, 150], [-352, 184]] },                                                    // Westmarch -> Hollins
  { w: 1.8, pts: [[231, -153], [226, -166]] },                                                                // Abbotsbury -> the abbey gate
  { w: 1.8, pts: [[-226, -290], [-212, -310]] },                                                              // Tarnside's Fellgate lane
  ...villageRoads(SETTLEMENT_SITES),                                                                          // village lanes
);

// called by World.build() after the capital has been built. `world` is the World instance
// (see src/world/city.js for its helpers: world.house(), world.roof(), world.add()...)
export function buildSettlements(world) {
  resetIds(); resetTownIds(); world.townHouses = []; world.townLandmarks = {};
  const P = G.physics, t0 = performance.now(), stats = {};
  const run = (id, fn) => { const b0 = P.blocks.length, s0 = P.structTotal, h0 = world.townHouses.length; fn(); stats[id] = { bodies: P.blocks.length - b0, struct: P.structTotal - s0, houses: world.townHouses.length - h0 }; };
  run('westmarch', () => { buildWestmarch(world); growWestmarch(world); });
  run('castle', () => buildCastle(world));
  run('abbey', () => buildAbbey(world));
  run('mirrormere', () => { buildMirrormere(world); growMirrormere(world); });
  run('barleyford', () => { buildBarleyford(world); growBarleyford(world); });
  run('norbury', () => { buildNorbury(world); growNorbury(world); });
  run('greystone', () => { buildGreystone(world); growGreystone(world); });
  run('tarnside', () => { buildTarnside(world); growTarnside(world); });
  run('ravensford', () => buildRavensford(world));
  run('abbotsbury', () => buildAbbotsbury(world));
  run('hamlets', () => {
    buildHamlet(world, 'fenwick', 9901, { yaw: -2.148, chapel: true }); buildHamlet(world, 'southfold', 9902, { yaw: 1.326, chapel: true });
    buildHamlet(world, 'eastholme', 9903, { yaw: -0.095 }); buildHamlet(world, 'brackenden', 9904, { yaw: 1.107 });
    buildHamlet(world, 'saltcote', 9905, { yaw: 1.633 }); buildHamlet(world, 'hollins', 9906, { yaw: 2.058, mill: true });
  });
  run('inn', () => buildInn(world));
  run('ninestones', () => buildStoneCircle(world));
  run('ruins', () => buildRuins(world));
  run('millhill', () => buildMillHill(world));
  run('farms', () => { buildFarm(world, 'farm_hobb', 8301); buildFarm(world, 'farm_north', 8302); buildFarm(world, 'farm_lake', 8303); buildFarm(world, 'farm_west', 8304); });
  run('shrines', () => { buildShrine(world, 'shrine_n'); buildShrine(world, 'shrine_e'); buildShrine(world, 'shrine_w'); });
  world.settlementStats = stats; world.sites = SETTLEMENT_SITES;
  console.log(`[game] settlements: ${Object.values(stats).reduce((n, s) => n + s.struct, 0)} structural bodies in ${(performance.now() - t0).toFixed(0)} ms`);
}
