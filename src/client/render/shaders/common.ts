/** Shared uniform block declarations and helper functions for GLSL and WGSL shaders. */

/** Frame uniforms (336 bytes, std140-compatible, vec4/mat4 only). */
export const FRAME_UBO_SIZE = 336;

export const GLSL_FRAME = /* glsl */ `
layout(std140) uniform Frame {
  mat4 uViewProj;
  mat4 uInvViewProj;
  mat4 uView;
  vec4 uCam;        // world position (xyz), time seconds (w)
  vec4 uFogColor;   // rgb, fog start
  vec4 uFogParams;  // fog end, underwater, daylight, ambient
  vec4 uSunDir;     // xyz, moon phase
  vec4 uSkyZenith;  // rgb, star brightness
  vec4 uSkyHorizon; // rgb, rain
  vec4 uBlockLight; // rgb, gamma
  vec4 uMisc;       // anim frame (x), dimension (y), flash (z), night vision (w)
  vec4 uAtlas;      // tiles per page edge (x), tiles per page (y)
};
`;

export const WGSL_FRAME = /* wgsl */ `
struct Frame {
  viewProj: mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  view: mat4x4<f32>,
  cam: vec4<f32>,
  fogColor: vec4<f32>,
  fogParams: vec4<f32>,
  sunDir: vec4<f32>,
  skyZenith: vec4<f32>,
  skyHorizon: vec4<f32>,
  blockLight: vec4<f32>,
  misc: vec4<f32>,
  atlas: vec4<f32>,
};
`;

/** Lightmap curve (reference-like brightness ramp) and lighting helpers. */
export const GLSL_LIGHT = /* glsl */ `
float lightCurve(float l) {
  float f = clamp(l, 0.0, 1.0);
  return f / (4.0 - 3.0 * f);
}
vec3 lightmap(float sky, float block, float daylight, float gamma, vec3 blockColor, float ambient, float nightVision) {
  float s = lightCurve(sky) * mix(0.18, 1.0, daylight);
  float b = lightCurve(block);
  vec3 skyCol = mix(vec3(0.34, 0.38, 0.55), vec3(1.0), daylight) * s;
  vec3 blkCol = blockColor * b * (1.0 + 0.3 * b);
  vec3 c = max(skyCol, blkCol) + vec3(ambient);
  c = mix(c, vec3(1.0), nightVision);
  c = mix(c, vec3(1.0) - (vec3(1.0) - c) * (vec3(1.0) - c) * (vec3(1.0) - c) * (vec3(1.0) - c), gamma);
  return clamp(c * 0.96 + 0.04, 0.0, 1.0);
}
`;

export const WGSL_LIGHT = /* wgsl */ `
fn lightCurve(l: f32) -> f32 {
  let f = clamp(l, 0.0, 1.0);
  return f / (4.0 - 3.0 * f);
}
fn lightmap(sky: f32, blk: f32, daylight: f32, gamma: f32, blockColor: vec3<f32>, ambient: f32, nightVision: f32) -> vec3<f32> {
  let s = lightCurve(sky) * mix(0.18, 1.0, daylight);
  let b = lightCurve(blk);
  let skyCol = mix(vec3<f32>(0.34, 0.38, 0.55), vec3<f32>(1.0), daylight) * s;
  let blkCol = blockColor * b * (1.0 + 0.3 * b);
  var c = max(skyCol, blkCol) + vec3<f32>(ambient);
  c = mix(c, vec3<f32>(1.0), nightVision);
  let inv = vec3<f32>(1.0) - c;
  c = mix(c, vec3<f32>(1.0) - inv * inv * inv * inv, gamma);
  return clamp(c * 0.96 + 0.04, vec3<f32>(0.0), vec3<f32>(1.0));
}
`;

/** Wave displacement for foliage & water (vertex shader). */
export const GLSL_WAVE = /* glsl */ `
vec3 waveOffset(vec3 wp, uint kind, float t, float rain) {
  if (kind == 0u) return vec3(0.0);
  float str = 1.0 + rain * 1.5;
  float ph = wp.x * 0.7 + wp.z * 0.9 + wp.y * 0.3;
  if (kind == 1u) return vec3(sin(t * 1.6 + ph) * 0.02, sin(t * 2.1 + ph * 1.3) * 0.015, cos(t * 1.4 + ph) * 0.02) * str;
  if (kind == 2u) return vec3(0.0);
  if (kind == 3u || kind == 4u) return vec3(sin(t * 1.8 + ph) * 0.06, 0.0, cos(t * 1.5 + ph * 1.1) * 0.05) * str;
  if (kind == 5u) return vec3(0.0, sin(t * 1.3 + wp.x * 0.8 + wp.z * 0.6) * 0.035 - 0.035, 0.0);
  return vec3(0.0);
}
`;

export const WGSL_WAVE = /* wgsl */ `
fn waveOffset(wp: vec3<f32>, kind: u32, t: f32, rain: f32) -> vec3<f32> {
  if (kind == 0u) { return vec3<f32>(0.0); }
  let str = 1.0 + rain * 1.5;
  let ph = wp.x * 0.7 + wp.z * 0.9 + wp.y * 0.3;
  if (kind == 1u) { return vec3<f32>(sin(t * 1.6 + ph) * 0.02, sin(t * 2.1 + ph * 1.3) * 0.015, cos(t * 1.4 + ph) * 0.02) * str; }
  if (kind == 3u || kind == 4u) { return vec3<f32>(sin(t * 1.8 + ph) * 0.06, 0.0, cos(t * 1.5 + ph * 1.1) * 0.05) * str; }
  if (kind == 5u) { return vec3<f32>(0.0, sin(t * 1.3 + wp.x * 0.8 + wp.z * 0.6) * 0.035 - 0.035, 0.0); }
  return vec3<f32>(0.0);
}
`;

/**
 * Block texture sampling. Tiles live one per array layer, or grid×grid per layer when the device
 * limits array layers; repeating UVs are wrapped in the shader with explicit gradients.
 */
export const GLSL_ATLAS = /* glsl */ `
vec4 atlasSample(highp sampler2DArray t, vec2 uv, float layer, vec2 dx, vec2 dy) {
  float g = uAtlas.x;
  if (g < 1.5) return textureGrad(t, vec3(uv, layer), dx, dy);
  float page = floor((layer + 0.5) / uAtlas.y);
  float tile = layer - page * uAtlas.y;
  vec2 org = vec2(mod(tile, g), floor((tile + 0.5) / g));
  vec2 local = min(fract(uv), vec2(0.99999));
  return textureGrad(t, vec3((org + local) / g, page), dx / g, dy / g);
}
`;

export const WGSL_ATLAS = /* wgsl */ `
fn atlasSample(t: texture_2d_array<f32>, s: sampler, uv: vec2<f32>, layer: i32, dx: vec2<f32>, dy: vec2<f32>) -> vec4<f32> {
  let g = i32(frame.atlas.x);
  if (g <= 1) { return textureSampleGrad(t, s, uv, layer, dx, dy); }
  let tpp = g * g;
  let page = layer / tpp;
  let tile = layer - page * tpp;
  let org = vec2<f32>(f32(tile % g), f32(tile / g));
  let local = min(fract(uv), vec2<f32>(0.99999));
  let gf = f32(g);
  return textureSampleGrad(t, s, (org + local) / gf, page, dx / gf, dy / gf);
}
`;
