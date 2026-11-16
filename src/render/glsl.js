// Shared GLSL snippets.
export const GLSL_HASH = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
`;

export const GLSL_NOISE3 = /* glsl */ `
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n = dot(i, vec3(1.0, 57.0, 113.0));
  vec4 a = fract(sin(vec4(n, n + 1.0, n + 57.0, n + 58.0)) * 43758.5453);
  vec4 b = fract(sin(vec4(n + 113.0, n + 114.0, n + 170.0, n + 171.0)) * 43758.5453);
  vec4 m = mix(a, b, f.z);
  vec2 m2 = mix(m.xy, m.zw, f.y);
  return mix(m2.x, m2.y, f.x);
}
float fbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += vnoise3(p) * a; p = p * 2.02 + 11.7; a *= 0.5; } return s / 0.9375; }
`;

// Procedural arcane sigil: p in unit-radius coordinates, t = time. Returns line intensity.
export const GLSL_MAGIC_CIRCLE = /* glsl */ `
float mcHash(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float mcRing(float r, float r0, float w){ return smoothstep(w, 0.0, abs(r - r0)); }
float mcNgon(vec2 p, float n, float rad, float rot){
  float a = atan(p.y, p.x) + rot; float seg = 6.2831853 / n;
  a = mod(a, seg) - seg * 0.5;
  return length(p) * cos(a) - rad * cos(seg * 0.5);
}
float mcGlyphs(float r, float a, float r0, float r1, float count, float seed){
  float y = (r - r0) / (r1 - r0);
  if (y < 0.0 || y > 1.0) return 0.0;
  float fa = a / 6.2831853 * count; float id = floor(fa); float x = fract(fa);
  float h = mcHash(id + seed * 17.0);
  float v = 0.0;
  // each glyph: a few strokes picked from hashed bits
  float b1 = step(0.5, fract(h * 2.0)), b2 = step(0.5, fract(h * 4.0)), b3 = step(0.5, fract(h * 8.0)), b4 = step(0.5, fract(h * 16.0)), b5 = step(0.5, fract(h * 32.0));
  float w = 0.09;
  v += b1 * smoothstep(w, 0.0, abs(x - 0.3)) * step(0.15, y) * step(y, 0.85);
  v += b2 * smoothstep(w, 0.0, abs(x - 0.7)) * step(0.15, y) * step(y, 0.85);
  v += b3 * smoothstep(w * 1.3, 0.0, abs(y - 0.5)) * step(0.3, x) * step(x, 0.7);
  v += b4 * smoothstep(w * 1.3, 0.0, abs(y - 0.82)) * step(0.3, x) * step(x, 0.7);
  v += b5 * smoothstep(w * 1.3, 0.0, abs(y - 0.18)) * step(0.3, x) * step(x, 0.7);
  v += (1.0 - b1) * (1.0 - b2) * smoothstep(w * 1.4, 0.0, abs((x - 0.5) * 0.9 - (y - 0.5) * 0.5));
  return min(v, 1.0);
}
float magicCircle(vec2 p, float t){
  float r = length(p);
  if (r > 1.06) return 0.0;
  float a = atan(p.y, p.x);
  float v = 0.0;
  v += mcRing(r, 1.0, 0.012) + mcRing(r, 0.965, 0.005) + mcRing(r, 0.83, 0.006);
  v += mcGlyphs(r, a + t * 0.25, 0.85, 0.95, 44.0, 1.0) * 0.9;
  v += mcRing(r, 0.66, 0.008) + mcRing(r, 0.63, 0.004);
  v += smoothstep(0.008, 0.0, abs(mcNgon(p, 3.0, 0.83, t * 0.4))) * step(r, 0.84);
  v += smoothstep(0.008, 0.0, abs(mcNgon(p, 3.0, 0.83, t * 0.4 + 3.14159))) * step(r, 0.84);
  v += mcGlyphs(r, a - t * 0.35, 0.52, 0.61, 24.0, 2.0) * 0.8;
  v += mcRing(r, 0.5, 0.006) + mcRing(r, 0.3, 0.007) + mcRing(r, 0.12, 0.006);
  v += smoothstep(0.007, 0.0, abs(mcNgon(p, 4.0, 0.5, -t * 0.6))) * step(r, 0.51);
  v += smoothstep(0.007, 0.0, abs(mcNgon(p, 4.0, 0.5, -t * 0.6 + 0.7853))) * step(r, 0.51);
  // small satellite circles on the outer ring
  float sa = mod(a + t * 0.25, 6.2831853 / 6.0) - 3.14159 / 6.0;
  vec2 sp = vec2(cos(sa), sin(sa)) * r - vec2(0.745, 0.0);
  v += mcRing(length(sp), 0.07, 0.006) + mcRing(length(sp), 0.03, 0.005);
  // radial spokes in the core
  float spoke = abs(mod(a - t * 0.6, 6.2831853 / 8.0) - 3.14159 / 8.0);
  v += smoothstep(0.035, 0.0, spoke * r) * step(0.12, r) * step(r, 0.3) * 0.7;
  return min(v, 1.6);
}
`;
