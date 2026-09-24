/**
 * Classic forward chunk shader (solid / cutout / translucent via defines).
 * Vertex layout: see mesh/vertex.ts.
 */
import { ShaderSource } from '../rhi/rhi';
import { GLSL_FRAME, WGSL_FRAME, GLSL_LIGHT, WGSL_LIGHT, GLSL_WAVE, WGSL_WAVE, GLSL_ATLAS, WGSL_ATLAS } from './common';

const SHADE = '0.5, 1.0, 0.8, 0.8, 0.6, 0.6, 1.0, 1.0';

export const CHUNK_SHADER: ShaderSource = {
  glsl: {
    vs: /* glsl */ `
${GLSL_FRAME}
layout(std140) uniform Draw { vec4 uOrigin; vec4 uDrawMisc; };
layout(location = 0) in uvec4 aPos;
layout(location = 1) in uvec2 aUV;
layout(location = 2) in vec4 aColor;
layout(location = 3) in uvec4 aInfo;
${GLSL_WAVE}
out vec2 vUV;
flat out float vLayer;
out vec4 vColor;
out vec2 vLight;
out float vShade;
out float vDist;
out vec3 vWorld;
flat out uint vMat;
const float SHADES[8] = float[8](${SHADE});
void main() {
  vec3 local = vec3(aPos.xyz) / 1024.0 - 16.0;
  vec3 rel = uOrigin.xyz + local;
  vec3 wp = rel + uCam.xyz;
  uint mat = aInfo.z;
  rel += waveOffset(wp, (mat >> 1u) & 7u, uCam.w, uSkyHorizon.w);
  gl_Position = uViewProj * vec4(rel, 1.0);
  uint layer = aPos.w & 4095u;
  uint frames = (aPos.w >> 12u) + 1u;
  float frame = mod(uMisc.x, float(frames));
  vUV = vec2(aUV) / 256.0;
  vLayer = float(layer) + frame;
  vColor = aColor;
  vLight = vec2(float(aInfo.y), float(aInfo.w)) / 255.0;
  uint n = aInfo.x & 7u;
  vShade = (aInfo.x & 8u) != 0u ? 1.0 : SHADES[n];
  vDist = length(rel);
  vWorld = wp;
  vMat = mat;
}
`,
    fs: /* glsl */ `
${GLSL_FRAME}
${GLSL_LIGHT}
${GLSL_ATLAS}
uniform highp sampler2DArray uAlbedo;
uniform highp sampler2DArray uMaterial;
in vec2 vUV;
flat in float vLayer;
in vec4 vColor;
in vec2 vLight;
in float vShade;
in float vDist;
in vec3 vWorld;
flat in uint vMat;
layout(location = 0) out vec4 outColor;
void main() {
  vec2 dx = dFdx(vUV), dy = dFdy(vUV);
  vec4 albedo = atlasSample(uAlbedo, vUV, vLayer, dx, dy);
#ifdef CUTOUT
  if (albedo.a < 0.5) discard;
  albedo.a = 1.0;
#endif
#ifndef CUTOUT
#ifndef TRANSLUCENT
  albedo.a = 1.0;
#endif
#endif
  vec4 mat = atlasSample(uMaterial, vUV, vLayer, dx, dy);
  vec3 tint = mix(vec3(1.0), vColor.rgb, mat.a);
  vec3 base = albedo.rgb * tint;
  float ao = vColor.a;
  vec3 light = lightmap(vLight.x, vLight.y, uFogParams.z, uBlockLight.w, uBlockLight.rgb, uFogParams.w, uMisc.w);
  float emissive = max(mat.b, (vMat & 1u) != 0u ? 1.0 : 0.0);
  vec3 lit = base * mix(light * ao * vShade, vec3(1.0), emissive);
  lit += vec3(uMisc.z) * 0.3;
  float fogStart = uFogColor.w, fogEnd = uFogParams.x;
  float fog = clamp((vDist - fogStart) / max(1.0, fogEnd - fogStart), 0.0, 1.0);
  if (uFogParams.y > 0.5) fog = clamp(vDist / 24.0, 0.0, 1.0);
  outColor = vec4(mix(lit, uFogColor.rgb, fog * fog), albedo.a);
}
`,
  },
  wgsl: /* wgsl */ `
${WGSL_FRAME}
${WGSL_LIGHT}
${WGSL_WAVE}
${WGSL_ATLAS}
struct Draw { origin: vec4<f32>, misc: vec4<f32> };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> draw: Draw;
@group(0) @binding(2) var tAlbedo: texture_2d_array<f32>;
@group(0) @binding(3) var sAlbedo: sampler;
@group(0) @binding(4) var tMaterial: texture_2d_array<f32>;

struct VIn {
  @location(0) pos: vec4<u32>,
  @location(1) uv: vec2<u32>,
  @location(2) color: vec4<f32>,
  @location(3) info: vec4<u32>,
};
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) layer: i32,
  @location(2) color: vec4<f32>,
  @location(3) light: vec2<f32>,
  @location(4) shade: f32,
  @location(5) dist: f32,
  @location(6) @interpolate(flat) mat: u32,
};

@vertex fn vs_main(v: VIn) -> VOut {
  var o: VOut;
  let local = vec3<f32>(v.pos.xyz) / 1024.0 - vec3<f32>(16.0);
  var rel = draw.origin.xyz + local;
  let wp = rel + frame.cam.xyz;
  rel += waveOffset(wp, (v.info.z >> 1u) & 7u, frame.cam.w, frame.skyHorizon.w);
  o.clip = frame.viewProj * vec4<f32>(rel, 1.0);
  let layer = v.pos.w & 4095u;
  let frames = (v.pos.w >> 12u) + 1u;
  let fr = u32(frame.misc.x) % frames;
  o.uv = vec2<f32>(v.uv) / 256.0;
  o.layer = i32(layer + fr);
  o.color = v.color;
  o.light = vec2<f32>(f32(v.info.y), f32(v.info.w)) / 255.0;
  var shades = array<f32, 8>(${SHADE});
  o.shade = select(shades[v.info.x & 7u], 1.0, (v.info.x & 8u) != 0u);
  o.dist = length(rel);
  o.mat = v.info.z;
  return o;
}

@fragment fn fs_main(i: VOut) -> @location(0) vec4<f32> {
  let dx = dpdx(i.uv);
  let dy = dpdy(i.uv);
  var albedo = atlasSample(tAlbedo, sAlbedo, i.uv, i.layer, dx, dy);
  let mat = atlasSample(tMaterial, sAlbedo, i.uv, i.layer, dx, dy);
  if (CUTOUT) {
    if (albedo.a < 0.5) { discard; }
    albedo.a = 1.0;
  } else if (!TRANSLUCENT) {
    albedo.a = 1.0;
  }
  let tint = mix(vec3<f32>(1.0), i.color.rgb, mat.a);
  let base = albedo.rgb * tint;
  let light = lightmap(i.light.x, i.light.y, frame.fogParams.z, frame.blockLight.w, frame.blockLight.rgb, frame.fogParams.w, frame.misc.w);
  let emissive = max(mat.b, select(0.0, 1.0, (i.mat & 1u) != 0u));
  var lit = base * mix(light * i.color.a * i.shade, vec3<f32>(1.0), emissive);
  lit += vec3<f32>(frame.misc.z) * 0.3;
  let fogStart = frame.fogColor.w;
  let fogEnd = frame.fogParams.x;
  var fog = clamp((i.dist - fogStart) / max(1.0, fogEnd - fogStart), 0.0, 1.0);
  if (frame.fogParams.y > 0.5) { fog = clamp(i.dist / 24.0, 0.0, 1.0); }
  return vec4<f32>(mix(lit, frame.fogColor.rgb, fog * fog), albedo.a);
}
`,
};

export const SKY_SHADER: ShaderSource = {
  glsl: {
    vs: /* glsl */ `
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}
`,
    fs: /* glsl */ `
${GLSL_FRAME}
in vec2 vNdc;
layout(location = 0) out vec4 outColor;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec4 wp = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(wp.xyz / wp.w);
  float h = dir.y;
  vec3 col = mix(uSkyHorizon.rgb, uSkyZenith.rgb, smoothstep(-0.05, 0.45, h));
  if (uMisc.y < 0.5) {
    // sunrise glow
    vec3 sd = normalize(uSunDir.xyz);
    float sunAmt = max(dot(dir, sd), 0.0);
    float horizonSun = smoothstep(0.35, -0.1, abs(sd.y));
    col += vec3(1.0, 0.45, 0.15) * pow(sunAmt, 6.0) * horizonSun * 0.6 * (1.0 - smoothstep(0.0, 0.6, h));
    // sun disc
    float sun = smoothstep(0.9993, 0.9996, dot(dir, sd));
    col += vec3(1.0, 0.95, 0.8) * sun * 2.0 * (1.0 - uSkyHorizon.w);
    col += vec3(1.0, 0.8, 0.5) * pow(sunAmt, 256.0) * 0.8;
    // moon (square, phase)
    vec3 md = -sd;
    float moon = smoothstep(0.9990, 0.9993, dot(dir, md));
    col += vec3(0.85, 0.88, 1.0) * moon * (1.0 - uSkyHorizon.w) * (0.3 + 0.7 * abs(cos(uSunDir.w * 0.785398)));
    // stars
    float stars = step(0.9985, hash(floor(dir * 300.0))) * uSkyZenith.w * smoothstep(0.0, 0.2, h);
    col += vec3(stars);
  } else if (uMisc.y > 1.5) {
    // verge sky: dark with streaks
    float n = hash(floor(dir * 80.0));
    col = vec3(0.05, 0.03, 0.07) + vec3(0.15, 0.1, 0.2) * step(0.97, n);
  }
  if (h < 0.0) col = mix(col, uFogColor.rgb, smoothstep(0.0, -0.3, h));
  outColor = vec4(col, 1.0);
}
`,
  },
  wgsl: /* wgsl */ `
${WGSL_FRAME}
@group(0) @binding(0) var<uniform> frame: Frame;
struct VOut { @builtin(position) clip: vec4<f32>, @location(0) ndc: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> VOut {
  var o: VOut;
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  o.ndc = p;
  o.clip = vec4<f32>(p, 0.9999, 1.0);
  return o;
}
fn hash(q: vec3<f32>) -> f32 { var p = fract(q * 0.3183099 + vec3<f32>(0.1)); p = p * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
@fragment fn fs_main(i: VOut) -> @location(0) vec4<f32> {
  let wp = frame.invViewProj * vec4<f32>(i.ndc, 1.0, 1.0);
  let dir = normalize(wp.xyz / wp.w);
  let h = dir.y;
  var col = mix(frame.skyHorizon.rgb, frame.skyZenith.rgb, smoothstep(-0.05, 0.45, h));
  if (frame.misc.y < 0.5) {
    let sd = normalize(frame.sunDir.xyz);
    let sunAmt = max(dot(dir, sd), 0.0);
    let horizonSun = smoothstep(0.35, -0.1, abs(sd.y));
    col += vec3<f32>(1.0, 0.45, 0.15) * pow(sunAmt, 6.0) * horizonSun * 0.6 * (1.0 - smoothstep(0.0, 0.6, h));
    let sun = smoothstep(0.9993, 0.9996, dot(dir, sd));
    col += vec3<f32>(1.0, 0.95, 0.8) * sun * 2.0 * (1.0 - frame.skyHorizon.w);
    col += vec3<f32>(1.0, 0.8, 0.5) * pow(sunAmt, 256.0) * 0.8;
    let moon = smoothstep(0.9990, 0.9993, dot(dir, -sd));
    col += vec3<f32>(0.85, 0.88, 1.0) * moon * (1.0 - frame.skyHorizon.w) * (0.3 + 0.7 * abs(cos(frame.sunDir.w * 0.785398)));
    let stars = step(0.9985, hash(floor(dir * 300.0))) * frame.skyZenith.w * smoothstep(0.0, 0.2, h);
    col += vec3<f32>(stars);
  } else if (frame.misc.y > 1.5) {
    let n = hash(floor(dir * 80.0));
    col = vec3<f32>(0.05, 0.03, 0.07) + vec3<f32>(0.15, 0.1, 0.2) * step(0.97, n);
  }
  if (h < 0.0) { col = mix(col, frame.fogColor.rgb, smoothstep(0.0, -0.3, h)); }
  return vec4<f32>(col, 1.0);
}
`,
};

/** Simple colored line/triangle shader (block outlines, debug). Vertex: float32x3 pos (camera-relative) + unorm8x4 color. */
export const LINE_SHADER: ShaderSource = {
  glsl: {
    vs: /* glsl */ `
${GLSL_FRAME}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
  gl_Position.z -= 0.0002 * gl_Position.w;
}
`,
    fs: /* glsl */ `
in vec4 vColor;
layout(location = 0) out vec4 outColor;
void main() { outColor = vColor; }
`,
  },
  wgsl: /* wgsl */ `
${WGSL_FRAME}
@group(0) @binding(0) var<uniform> frame: Frame;
struct VOut { @builtin(position) clip: vec4<f32>, @location(0) color: vec4<f32> };
@vertex fn vs_main(@location(0) pos: vec3<f32>, @location(1) color: vec4<f32>) -> VOut {
  var o: VOut;
  o.clip = frame.viewProj * vec4<f32>(pos, 1.0);
  o.clip.z = o.clip.z - 0.0002 * o.clip.w;
  o.color = color;
  return o;
}
@fragment fn fs_main(i: VOut) -> @location(0) vec4<f32> { return i.color; }
`,
};
