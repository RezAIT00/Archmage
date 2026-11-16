// Global game state shared across modules (single-instance game, kept deliberately simple).
export const G = {
  renderer: null, scene: null, camera: null,
  time: 0, realTime: 0, dt: 0, realDt: 0, frame: 0,
  timeScale: 1, timeScaleTarget: 1,
  capture: false, quality: 'high',
  // camera feel: every factor scales one effect. 'steady' is the default when playing; 'cinematic' is used for the
  // showcase and can be switched on with B (or ?cinematic).
  cam: { mode: 'cinematic', blur: 1, radial: 1, ca: 1, shake: 1, fov: 1, roll: 1, bob: 1, grain: 1, flash: 1 },
  setCam(mode) {
    Object.assign(this.cam, mode === 'steady'
      ? { mode, blur: 0, radial: 0.15, ca: 0.3, shake: 0.35, fov: 0.35, roll: 0.4, bob: 0.5, grain: 0.6, flash: 0.7 }
      : { mode: 'cinematic', blur: 1, radial: 1, ca: 1, shake: 1, fov: 1, roll: 1, bob: 1, grain: 1, flash: 1 });
  },
  physics: null, terrain: null, grass: null, sky: null, post: null,
  particles: null, fx: null, audio: null, player: null, hand: null, hud: null, spells: null,
  noiseTex: null, tex: {},
  sunDir: null, sunColor: null,
  score: 0, ult: 0,
  // shared uniforms used by every FX shader (depth-soft particles etc.)
  fxU: null,
};
export const LAYER_SCENE = 0, LAYER_FX = 1, LAYER_DISTORT = 2;
