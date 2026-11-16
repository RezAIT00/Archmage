// Minimal cinematic HUD drawn on a 2D canvas (so it is also captured into the gameplay video).
import { G } from '../core/globals.js';
import { SPELLS, EXTRA } from '../spells/spells.js';
import { clamp } from '../core/util.js';

const css = (c, a = 1, k = 1) => `rgba(${Math.min(255, c.r * 255 * k) | 0},${Math.min(255, c.g * 255 * k) | 0},${Math.min(255, c.b * 255 * k) | 0},${a})`;
const FONT = '"Cinzel","Trajan Pro","Palatino Linotype","Book Antiqua",Georgia,serif';
const MONO = 'ui-monospace,Consolas,"Courier New",monospace';

export class HUD {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.visible = true; this.w = 1; this.h = 1;
    this.razed = 0; this.intro = 0; this.alpha = 1; this.hit = 0; this.title = { t: 0, text: '', sub: '' };
  }
  resize(w, h) { this.canvas.width = w; this.canvas.height = h; this.w = w; this.h = h; }
  showTitle(text, sub = '', time = 4) { this.title = { t: time, d: time, text, sub }; }

  draw(dt) {
    const x = this.ctx, w = this.w, h = this.h, s = h / 1080, sp = G.spells;
    x.clearRect(0, 0, w, h);
    if (!sp || !this.visible || this.alpha <= 0.01) { this._title(x, w, h, s, dt); return; }
    x.save(); x.globalAlpha = this.alpha;
    const lb = G.post.letterbox;                       // slide the HUD away while cinematic bars are in
    const cur = sp.current.color;
    // ---- crosshair
    const cx = w / 2, cy = h / 2, ch = sp.firing ? sp.charge : 0;
    x.globalAlpha = this.alpha * (1 - lb);
    x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 1.5 * s; x.fillStyle = 'rgba(255,255,255,0.9)';
    x.beginPath(); x.arc(cx, cy, 1.8 * s, 0, 6.283); x.fill();
    x.strokeStyle = css(cur, 0.75, 1.3); x.lineWidth = 2 * s;
    const r = (13 - ch * 4) * s;
    for (let i = 0; i < 4; i++) { const a = i * 1.5708 + 0.7854 + G.time * 0.4; x.beginPath(); x.arc(cx, cy, r, a - 0.42, a + 0.42); x.stroke(); }
    if (ch > 0.01) { x.strokeStyle = css(cur, 0.95, 1.6); x.lineWidth = 3 * s; x.beginPath(); x.arc(cx, cy, 21 * s, -1.5708, -1.5708 + ch * 6.283); x.stroke(); }
    // ---- spell bar
    const slot = 54 * s, gap = 9 * s, pg = sp.page || 0;
    const items = [...SPELLS.map((q, i) => ({ ...q, i })).slice(pg * 10, pg * 10 + 10), { ...EXTRA.force, id: 'force' }, { ...EXTRA.tk, id: 'tk' }, { ...EXTRA.cataclysm, id: 'cataclysm' }, { ...EXTRA.blink, id: 'blink' }, { ...EXTRA.fly, id: 'fly' }];
    const total = items.length * slot + (items.length - 1) * gap + 2 * gap;
    let px = (w - total) / 2; const py = h - (104 + lb * 160) * s;
    x.globalAlpha = this.alpha;
    items.forEach((it, k) => {
      if (k === 10) px += gap * 2;
      const selected = it.i === sp.sel, cd = sp.cool[it.id] || 0, isUlt = it.id === 'cataclysm';
      const active = selected || (it.id === 'tk' && sp.tk.on) || (isUlt && sp.cata) || (it.id === 'fly' && G.player.fly);
      x.save(); x.translate(px + slot / 2, py + slot / 2 - (selected ? 6 * s : 0));
      x.rotate(Math.PI / 4);
      const hs = slot * 0.36;
      x.fillStyle = active ? css(it.color, 0.3) : 'rgba(8,8,14,0.55)';
      x.strokeStyle = active ? css(it.color, 1, 1.5) : 'rgba(255,255,255,0.28)'; x.lineWidth = (active ? 2.4 : 1.3) * s;
      if (active) { x.shadowColor = css(it.color, 1, 1.4); x.shadowBlur = 22 * s; }
      x.beginPath(); x.rect(-hs, -hs, hs * 2, hs * 2); x.fill(); x.stroke(); x.shadowBlur = 0;
      if (isUlt) { const u = clamp(G.ult, 0, 1); x.fillStyle = css(it.color, 0.55 + 0.3 * Math.sin(G.realTime * 6) * (u >= 1 ? 1 : 0), 1.2); x.beginPath(); x.rect(-hs, hs - hs * 2 * u, hs * 2, hs * 2 * u); x.fill(); }
      if (cd > 0.05) { x.fillStyle = 'rgba(0,0,0,0.6)'; x.beginPath(); x.rect(-hs, -hs, hs * 2, hs * 2 * Math.min(1, cd)); x.fill(); }
      x.rotate(-Math.PI / 4);
      this._glyph(x, it.id, hs * 0.72, active ? css(it.color, 1, 2.2) : 'rgba(255,255,255,0.75)', s);
      x.restore();
      x.fillStyle = active ? css(it.color, 1, 1.8) : 'rgba(255,255,255,0.5)'; x.font = `600 ${11.5 * s}px ${MONO}`; x.textAlign = 'center';
      x.fillText(it.key, px + slot / 2, py + slot + 16 * s);
      px += slot + gap;
    });
    x.fillStyle = 'rgba(255,255,255,0.42)'; x.font = `600 ${11 * s}px ${MONO}`; x.textAlign = 'left';
    x.fillText(pg === 0 ? 'I  DESTRUCTION   [TAB]' : 'II  DOMINION   [TAB]', (w - total) / 2, py - 14 * s);
    // ---- spell name banner
    if (sp.banner.t > 0) {
      const a = Math.min(1, sp.banner.t / 0.5) * Math.min(1, (2.2 - sp.banner.t) / 0.15);
      x.globalAlpha = this.alpha * a; x.textAlign = 'center'; x.font = `500 ${25 * s}px ${FONT}`;
      const tx = sp.banner.text.split('').join('  ');
      x.shadowColor = css(sp.banner.color, 1, 1.4); x.shadowBlur = 26 * s; x.fillStyle = '#fff';
      x.fillText(tx, w / 2, h - (158 + lb * 160) * s + (1 - a) * 8 * s); x.shadowBlur = 0;
      const lw = (150 + (1 - sp.banner.t / 2.2) * 60) * s; x.strokeStyle = css(sp.banner.color, 0.8, 1.5); x.lineWidth = 1.2 * s;
      x.beginPath(); x.moveTo(w / 2 - lw, h - (146 + lb * 160) * s); x.lineTo(w / 2 + lw, h - (146 + lb * 160) * s); x.stroke();
    }
    // ---- city razed meter
    const P = G.physics, target = P.structTotal ? P.structDown / P.structTotal : 0;
    if (target > this.razed + 0.0005) this.hit = 1;
    this.razed += (target - this.razed) * Math.min(1, dt * 4); this.hit = Math.max(0, this.hit - dt * 2.5);
    const bw = 380 * s, bx = w / 2 - bw / 2, by = (46 - lb * 140) * s;
    x.globalAlpha = this.alpha; x.textAlign = 'center';
    x.font = `500 ${13 * s}px ${FONT}`; x.fillStyle = 'rgba(255,255,255,0.72)';
    x.fillText('R E A L M   R A Z E D', w / 2, by - 10 * s);
    x.fillStyle = 'rgba(0,0,0,0.45)'; x.fillRect(bx, by, bw, 5 * s);
    const g = x.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#ffb14a'); g.addColorStop(1, '#ff3d1f');
    x.fillStyle = g; x.shadowColor = '#ff5a20'; x.shadowBlur = (10 + this.hit * 22) * s; x.fillRect(bx, by, bw * this.razed, 5 * s); x.shadowBlur = 0;
    x.font = `600 ${(30 + this.hit * 5) * s}px ${FONT}`; x.fillStyle = `rgba(255,${(235 - this.hit * 70) | 0},${(215 - this.hit * 130) | 0},0.96)`;
    x.fillText(`${(this.razed * 100).toFixed(1)}%`, w / 2, by + 42 * s);
    x.restore();
    this._title(x, w, h, s, dt);
  }

  _title(x, w, h, s, dt) {
    const T = this.title; if (T.t <= 0) return;
    T.t -= dt;
    const a = clamp(Math.min((T.d - T.t) / 0.9, T.t / 0.9), 0, 1);
    x.save(); x.globalAlpha = a; x.textAlign = 'center';
    x.shadowColor = 'rgba(255,130,40,0.9)'; x.shadowBlur = 40 * s;
    const g = x.createLinearGradient(0, h * 0.4, 0, h * 0.52); g.addColorStop(0, '#fff6e0'); g.addColorStop(0.5, '#ffcf8a'); g.addColorStop(1, '#d26a1e');
    x.fillStyle = g; x.font = `500 ${96 * s}px ${FONT}`;
    x.fillText(T.text.split('').join('  '), w / 2, h * 0.5);
    x.shadowBlur = 0; x.fillStyle = 'rgba(235,220,200,0.9)'; x.font = `400 ${22 * s}px ${FONT}`;
    x.fillText(T.sub.split('').join('  '), w / 2, h * 0.5 + 52 * s);
    x.restore();
  }

  // tiny vector glyph per spell
  _glyph(x, id, r, color, s) {
    x.strokeStyle = color; x.fillStyle = color; x.lineWidth = 2 * s; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath();
    if (id === 'inferno') { x.moveTo(0, -r); x.bezierCurveTo(r * 0.9, -r * 0.2, r * 0.8, r * 0.9, 0, r); x.bezierCurveTo(-r * 0.8, r * 0.9, -r * 0.7, 0, -r * 0.2, -r * 0.2); x.bezierCurveTo(-r * 0.1, -r * 0.5, 0, -r * 0.6, 0, -r); x.stroke(); }
    else if (id === 'lightning') { x.moveTo(r * 0.3, -r); x.lineTo(-r * 0.45, r * 0.1); x.lineTo(r * 0.1, r * 0.1); x.lineTo(-r * 0.3, r); x.lineTo(r * 0.5, -r * 0.15); x.lineTo(-r * 0.02, -r * 0.15); x.closePath(); x.stroke(); }
    else if (id === 'singularity') { x.arc(0, 0, r * 0.38, 0, 6.283); x.fill(); x.beginPath(); x.ellipse(0, 0, r, r * 0.36, -0.4, 0, 6.283); x.stroke(); }
    else if (id === 'starfall') { x.arc(r * 0.35, r * 0.35, r * 0.34, 0, 6.283); x.fill(); x.beginPath(); x.moveTo(-r, -r); x.lineTo(r * 0.1, r * 0.1); x.moveTo(-r * 0.5, -r); x.lineTo(r * 0.3, -r * 0.1); x.moveTo(-r, -r * 0.5); x.lineTo(-r * 0.1, r * 0.3); x.stroke(); }
    else if (id === 'ray') { x.moveTo(-r, r); x.lineTo(r, -r); x.stroke(); x.beginPath(); x.arc(r * 0.55, -r * 0.55, r * 0.42, 0, 6.283); x.stroke(); x.beginPath(); x.moveTo(-r * 0.2, r * 0.75); x.lineTo(-r * 0.75, r * 0.2); x.stroke(); }
    else if (id === 'force') { for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(-r * 0.9, 0, r * (0.6 + i * 0.55), -0.6, 0.6); x.stroke(); } }
    else if (id === 'tk') { x.rect(-r * 0.3, -r * 0.95, r * 0.6, r * 0.6); x.stroke(); x.beginPath(); x.moveTo(-r * 0.7, r * 0.9); x.quadraticCurveTo(-r * 0.8, 0, 0, -r * 0.1); x.quadraticCurveTo(r * 0.8, 0, r * 0.7, r * 0.9); x.stroke(); }
    else if (id === 'earthshatter') { x.moveTo(-r, -r * 0.2); x.lineTo(-r * 0.3, r * 0.1); x.lineTo(-r * 0.05, -r * 0.5); x.lineTo(r * 0.3, r * 0.3); x.lineTo(r, -r * 0.1); x.stroke(); x.beginPath(); x.moveTo(-r * 0.9, r * 0.8); x.lineTo(r * 0.9, r * 0.8); x.stroke(); }
    else if (id === 'dragon') { x.moveTo(-r, -r * 0.5); x.quadraticCurveTo(0, -r * 0.9, r, -r * 0.2); x.quadraticCurveTo(0, 0, r * 0.9, r * 0.6); x.quadraticCurveTo(-r * 0.2, r * 0.2, -r, r * 0.5); x.closePath(); x.stroke(); }
    else if (id === 'eruption') { x.moveTo(-r, r); x.lineTo(-r * 0.3, -r * 0.2); x.lineTo(r * 0.3, -r * 0.2); x.lineTo(r, r); x.stroke(); x.beginPath(); x.moveTo(0, -r * 0.3); x.lineTo(0, -r); x.moveTo(-r * 0.35, -r * 0.45); x.lineTo(-r * 0.6, -r * 0.9); x.moveTo(r * 0.35, -r * 0.45); x.lineTo(r * 0.6, -r * 0.9); x.stroke(); }
    else if (id === 'winter') { for (let i = 0; i < 3; i++) { const a = i * 1.0472; x.moveTo(Math.cos(a) * r, Math.sin(a) * r); x.lineTo(-Math.cos(a) * r, -Math.sin(a) * r); } x.stroke(); }
    else if (id === 'tempest') { for (let i = 0; i < 4; i++) { const w2 = r * (1 - i * 0.22); x.moveTo(-w2, -r + i * r * 0.55); x.lineTo(w2, -r + i * r * 0.55); } x.stroke(); }
    else if (id === 'rise') { x.moveTo(-r, r * 0.8); x.lineTo(-r * 0.2, -r * 0.7); x.lineTo(r * 0.2, -r * 0.1); x.lineTo(r * 0.5, -r * 0.5); x.lineTo(r, r * 0.8); x.closePath(); x.stroke(); }
    else if (id === 'abyss') { x.moveTo(-r, -r * 0.7); x.lineTo(-r * 0.3, -r * 0.7); x.lineTo(0, r * 0.9); x.lineTo(r * 0.3, -r * 0.7); x.lineTo(r, -r * 0.7); x.stroke(); }
    else if (id === 'deluge') { x.moveTo(0, -r); x.bezierCurveTo(r * 0.9, 0, r * 0.7, r, 0, r); x.bezierCurveTo(-r * 0.7, r, -r * 0.9, 0, 0, -r); x.stroke(); }
    else if (id === 'bloom') { x.moveTo(0, r); x.lineTo(0, -r * 0.2); x.stroke(); x.beginPath(); x.ellipse(-r * 0.4, -r * 0.3, r * 0.5, r * 0.25, -0.7, 0, 6.283); x.stroke(); x.beginPath(); x.ellipse(r * 0.4, -r * 0.45, r * 0.5, r * 0.25, 0.7, 0, 6.283); x.stroke(); }
    else if (id === 'monolith') { x.rect(-r * 0.85, -r * 0.5, r * 0.4, r * 1.4); x.rect(r * 0.45, -r * 0.5, r * 0.4, r * 1.4); x.rect(-r, -r * 0.9, r * 2, r * 0.35); x.stroke(); }
    else if (id === 'ascension') { x.moveTo(0, r); x.lineTo(0, -r * 0.7); x.moveTo(-r * 0.5, -r * 0.2); x.lineTo(0, -r * 0.9); x.lineTo(r * 0.5, -r * 0.2); x.stroke(); x.beginPath(); x.rect(-r * 0.85, r * 0.2, r * 0.35, r * 0.35); x.rect(r * 0.5, -r * 0.1, r * 0.35, r * 0.35); x.stroke(); }
    else if (id === 'chrono') { x.moveTo(-r * 0.7, -r); x.lineTo(r * 0.7, -r); x.lineTo(-r * 0.7, r); x.lineTo(r * 0.7, r); x.closePath(); x.stroke(); }
    else if (id === 'storm') { x.arc(-r * 0.2, -r * 0.3, r * 0.5, 3.14, 6.283); x.arc(r * 0.4, -r * 0.3, r * 0.4, 3.6, 6.9); x.lineTo(-r * 0.7, -r * 0.3); x.stroke(); x.beginPath(); x.moveTo(r * 0.1, 0); x.lineTo(-r * 0.2, r * 0.5); x.lineTo(r * 0.15, r * 0.5); x.lineTo(-r * 0.1, r); x.stroke(); }
    else if (id === 'eclipse') { x.arc(0, 0, r * 0.9, 0, 6.283); x.stroke(); x.beginPath(); x.arc(r * 0.2, -r * 0.1, r * 0.62, 0, 6.283); x.fill(); }
    else if (id === 'restoration') { x.arc(0, 0, r * 0.85, 0.9, 6.0); x.stroke(); x.beginPath(); x.moveTo(r * 0.95, -r * 0.55); x.lineTo(r * 0.8, -r * 0.05); x.lineTo(r * 0.35, -r * 0.3); x.stroke(); }
    else if (id === 'blink') { x.moveTo(-r, r * 0.6); x.lineTo(-r * 0.2, r * 0.6); x.moveTo(r * 0.2, -r * 0.6); x.lineTo(r, -r * 0.6); x.stroke(); x.setLineDash([3 * s, 3 * s]); x.beginPath(); x.moveTo(-r * 0.2, r * 0.6); x.lineTo(r * 0.2, -r * 0.6); x.stroke(); x.setLineDash([]); }
    else if (id === 'fly') { x.moveTo(-r, r * 0.2); x.quadraticCurveTo(-r * 0.4, -r, 0, 0); x.quadraticCurveTo(r * 0.4, -r, r, r * 0.2); x.stroke(); }
    else if (id === 'cataclysm') { x.arc(0, 0, r * 0.95, 0, 6.283); x.stroke(); x.beginPath(); for (let i = 0; i < 6; i++) { const a = i * 1.0472 - 1.5708; x[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95); const b = a + 2.0944; x.lineTo(Math.cos(b) * r * 0.95, Math.sin(b) * r * 0.95); x.moveTo(Math.cos(a + 1.0472) * r * 0.95, Math.sin(a + 1.0472) * r * 0.95); } x.stroke(); x.beginPath(); x.arc(0, 0, r * 0.2, 0, 6.283); x.fill(); }
  }
}
