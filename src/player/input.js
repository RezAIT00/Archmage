// Keyboard / mouse input with a "virtual" layer so the scripted director can drive the same controls.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.dx = 0; this.dy = 0;
    this.fire = false; this.alt = false;
    this.events = []; // {type:'select'|'cast'|'jump', ...}
    this.locked = false;
    this.v = { moveX: 0, moveZ: 0, up: 0, sprint: false, fire: false, alt: false, active: false }; // virtual (director)
    this.sens = 0.0022;
  }
  attach(onLockChange) {
    const c = this.canvas;
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === c; if (!this.locked) { this.fire = false; this.alt = false; this.keys.clear(); } onLockChange?.(this.locked); });
    document.addEventListener('mousemove', (e) => { if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; } });
    c.addEventListener('mousedown', (e) => { if (!this.locked) return; if (e.button === 0) this.fire = true; if (e.button === 2) this.alt = true; });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.fire = false; if (e.button === 2) this.alt = false; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => { if (this.locked) this.events.push({ type: 'cycle', dir: Math.sign(e.deltaY) }); }, { passive: true });
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (!this.locked) return;
      if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); this.events.push({ type: 'select', i: n === 0 ? 9 : n - 1 }); }
      if (e.code === 'Tab') this.events.push({ type: 'page' });
      if (e.code === 'KeyG') this.events.push({ type: 'cast', name: 'blink' });
      if (e.code === 'KeyV') this.events.push({ type: 'cast', name: 'fly' });
      if (e.code === 'KeyF') this.events.push({ type: 'cast', name: 'force' });
      if (e.code === 'KeyQ') this.events.push({ type: 'cast', name: 'cataclysm' });
      if (e.code === 'KeyE') this.alt = true;
      if (e.code === 'Space') this.events.push({ type: 'jump' });
      if (e.code === 'KeyR') this.events.push({ type: 'reset' });
      if (e.code === 'KeyH') this.events.push({ type: 'hud' });
      if (e.code === 'KeyB') this.events.push({ type: 'cam' });
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code === 'KeyE') this.alt = false; });
  }
  lock() { this.canvas.requestPointerLock?.(); }
  get moveX() { return this.v.active ? this.v.moveX : (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0); }
  get moveZ() { return this.v.active ? this.v.moveZ : (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0); }
  get moveY() { return this.v.active ? this.v.up : (this.keys.has('Space') ? 1 : 0) - (this.keys.has('ControlLeft') || this.keys.has('KeyC') ? 1 : 0); }
  get sprint() { return this.v.active ? this.v.sprint : this.keys.has('ShiftLeft'); }
  get fireHeld() { return this.v.active ? this.v.fire : this.fire; }
  get altHeld() { return this.v.active ? this.v.alt : this.alt; }
  consumeLook() { const r = [this.dx * this.sens, this.dy * this.sens]; this.dx = 0; this.dy = 0; return r; }
  drain() { const e = this.events; this.events = []; return e; }
}
