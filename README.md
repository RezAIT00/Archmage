# ARCHMAGE — Tenth Circle

A first-person, physics-driven wizard sandbox for the browser (Three.js + Rapier). You are a tenth-circle archmage looking out over a living realm: a walled capital with its boroughs, towns and villages, a castle, forests, a river, lakes and mountains. Only your hand is ever on screen. Everything you see is a real rigid body, a deformable heightfield, a tree that can fall and burn, or simulated water, and every skill changes it.

## Run it

```bash
npm install
npm run dev            # http://127.0.0.1:5199
```

The textures, sky, tree scans, hand model and sounds are already in `public/assets`. To download them again from their sources, run `npm run fetch-assets` and `npm run fetch-sounds`.

`npm run build` produces a static site in `dist/` that any web server can host.

URL options: `?q=low|medium|high` quality, `?free` (Cataclysm always charged), `?mute`, `?demo` (watch the scripted showcase), `?cinematic` (start with the cinematic camera), `?scale=0.75` (fixed internal resolution).

## Comfort and performance

- **Camera.** Playing live, the camera is *steady* by default: no motion blur, and much lighter shake, zoom kicks, radial blur and lens fringing. Press **B** to switch to the *cinematic* camera the showcase video uses (the choice is remembered).
- **Nothing is simulated until it has to be.** Every block of the realm is a fixed body until something disturbs it; then its house (or that stretch of wall) turns dynamic, and goes back to fixed once it has come to rest. Debris does the same. Big structures wake a piece at a time.
- **The amount of debris in motion adapts to the machine**: when the physics step runs over its time budget, new fractures stop and the furthest flying pieces are retired first.
- **Water** is solved at 30 Hz and only where it is changing; a river in steady flow costs nothing.
- **Trees and ground** outside the view are not drawn, and distant trees use a lighter mesh.
- **Resolution** drops automatically, in steps, if the graphics card cannot hold the frame rate, and comes back up when it can.
- Recording (`npm run capture`) turns all of these shortcuts off and simulates everything in full.

## The realm

About one square kilometre of rolling country ringed by mountains, with roughly 14,000 destructible rigid bodies, 840 houses and 5,200 trees:

- **The capital**: the walled old town (cathedral with bell tower, town hall and clock tower, market square, gates and wall towers) and, outside the walls, its west, north and riverside boroughs with their own churches, halls, warehouses and gatehouses. About 450 houses.
- **Westmarch** market town, **Mirrormere** lakeside town (piers, causeway, lighthouse), **Ravenscar Castle** on its hill, **St Aldhelm's Abbey**, **Barleyford** farming village (thatch, windmill, barns), **Norbury**, **Tarnside** fishing hamlet, **Greystone Quarry**, and a ring of smaller hamlets.
- Scattered between them: watchtowers, an inn, farmsteads, a windmill, a ruined chapel, standing stones and wayside shrines, all joined by roads.
- **Water**: the Greywater reservoir sits on a hill in the north-east behind a masonry dam. The river Aldwater spills over the dam, runs past the capital's riverside quarter under its bridges and empties into Mirrormere.

## Controls

| Input | Action |
|---|---|
| WASD / Shift / mouse | move, sprint, look |
| LMB | cast the selected skill (hold to charge or channel) |
| 1 – 0 | choose a skill on the current page, **Tab** switches page, wheel cycles |
| F | Force Blast |
| RMB or E | Telekinesis: hold to grab, release to hurl |
| Q | Cataclysm (charges as you destroy) |
| G | Blink to where you are looking |
| V | Skywalk: fly (Space / C to rise and sink, Shift to go fast) |
| R | rebuild the realm, H hides the HUD |
| B | camera feel: steady (default) or cinematic |

## The grimoire (25 skills)

**I · Destruction** — Inferno Orb, Chain Lightning, Singularity, Starfall, Annihilation Ray, Earthshatter, Dragon's Breath, Eruption, Winter's Grasp, Tempest.

**II · Dominion** — Stoneshape: Rise, Stoneshape: Abyss, Deluge, Verdant Bloom, Monolith, Ascension, Chronostasis, Thunderstorm, Eclipse, Restoration.

**Always at hand** — Force Blast, Telekinesis, Cataclysm, Blink, Skywalk.

What they do to the world: buildings break into wall panels, floors, roof slabs and rubble; the ground craters, splits, rises into mountains or sinks into basins (mesh, grass and collision all follow); grass and forests catch fire and the fire spreads; trees topple, get uprooted into logs, freeze or grow back; the sky storms, rains, or goes dark under an eclipse; Restoration rewinds all of it.

## Water

All the water in the realm is one real-time shallow-water simulation (`src/world/water.js`): a 512 × 512 grid of 2 m cells solved with the inertial flood-wave scheme used in flood modelling. It runs downhill, pools, overtops banks and pours through gaps, and it reads the live terrain, so anything that reshapes the land redirects it.

- **Break the dam.** Every stone of the dam is a rigid body that holds the reservoir back only while it stays in place. Cut it with the Annihilation Ray (or anything else) and the reservoir empties down the valley and through the capital's riverside quarter, floating timber, felling trees and carrying houses off.
- **Deluge** conjures 56,000 m³ of water where you point. On land it is a flash flood that follows the streets; in a lake it raises a wave that rolls over the shore.
- **Winter's Grasp** freezes water where it stands, mid-flood if you like; Verdant Bloom thaws it.
- **Stoneshape** digs basins that fill and raises ground that dams the river. Craters and fissures fill with water too.
- **Singularity** drinks water in, explosions and Force Blast throw waves, **Tempest** becomes a waterspout over a lake and rains the water back down, and Chronostasis stops a wave in mid-air.
- You wade, are carried by currents and float in deep water. Timber floats, masonry sinks.

## Trees

The forests are built from photographs of real leaves, fronds and fir twigs (CC0 scans from Poly Haven), assembled into boughs and hung on trunk-and-limb skeletons with real bark: three broadleaf species and two conifers. They sway in the wind (harder in a storm), let sunlight through their crowns, burn leaf by leaf down to a charred skeleton, rime over when frozen, and grow back.

## Record the showcase video

```bash
npm run capture        # writes out/archmage_gameplay.mp4 (1080p60, H.264 + AAC)
```

The scripted showcase (`src/director.js`) plays the real game through the same input layer a player uses. Frames are rendered one at a time at a fixed 1/60 s step, and the soundtrack is mixed offline from the exact sound events of that run, so the result is smooth on any machine. The video is about 138 s, inside Twitter's 140 s / 512 MB limits. `?demo=<section>` starts the show at a named section (`dam`, `tsunami`, `flood`, ...).

In live play (not while recording), once the debris count passes the freshly built realm plus 6,000 bodies, settled fragments far from you are quietly retired so long sessions stay playable.

## How it is built

- `src/render/post.js` — HDR pipeline: MSAA scene, depth AO, aerial-perspective fog, soft-particle FX layer, screen-space distortion and gravitational lensing, camera motion blur, god rays, bloom, filmic grade.
- `src/physics/physics.js` — Rapier world, instanced rigid bodies, fracture, pressure-wave explosions, procedural building facades.
- `src/world/` — terrain (deformable, with a burn / heat / frost / bloom state map), grass, forests and wildfire (`forest.js`, `treekit.js`), the water simulation and the dam (`water.js`, `dam.js`), sky and weather, the capital and the other settlements.
- `src/fx/` — stateless GPU particles, volumetric fireballs, shockwaves, lightning, beams, rune circles.
- `src/spells/` — the skills. `src/player/` — controller and the rigged hand. `src/audio/audio.js` — sample mixer.

## Credits and licences

- Textures, sky HDRI, bark, and the leaf, frond and twig scans: [Poly Haven](https://polyhaven.com) (CC0).
- Hand model: WebXR Input Profiles generic hand (`@webxr-input-profiles/assets`).
- Every sound is a real recording from [freesound.org](https://freesound.org), all Creative Commons 0. The full list with authors and links is in `public/assets/sfx/CREDITS.md`.
- Engine: [three.js](https://threejs.org) (MIT), [Rapier](https://rapier.rs) (Apache-2.0).
