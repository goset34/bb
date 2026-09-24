/**
 * Entity shader: camera-relative float geometry textured from the block/item atlas or the entity
 * texture array (skins), lit by the entity's sampled light, with hurt tint, emissive parts,
 * enchantment glint and a first-person mode that squeezes depth in front of the world.
 *
 * Vertex (32 bytes): pos f32x3 | uv f32x2 | tex u16x2 (layer, flags) | color unorm8x4 | light unorm8x4
 * (sky, block, shade, hurt). Flags: 1 = entity texture array, 2 = emissive, 4 = glint, 8 = translucent.
 */
import { ShaderSource } from '../rhi/rhi';
import { GLSL_FRAME, WGSL_FRAME, GLSL_LIGHT, WGSL_LIGHT, GLSL_ATLAS, WGSL_ATLAS } from './common';

export const ENTITY_VERTEX_SIZE = 32;

export const ENTITY_SHADER: ShaderSource = {
  glsl: {
    vs: /* glsl */ `
${GLSL_FRAME}
layout(std140) uniform EntityDraw { mat4 uMVP; vec4 uParams; };
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in uvec2 aTex;
layout(location = 3) in vec4 aColor;
layout(location = 4) in vec4 aLight;
out vec2 vUV;
flat out float vLayer;
flat out uint vFlags;
out vec4 vColor;
out vec4 vLight;
out float vDist;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  if (uParams.x > 0.5) gl_Position.z = mix(-gl_Position.w, gl_Position.z, 0.01);
  vUV = aUV;
  vLayer = float(aTex.x);
  vFlags = aTex.y;
  vColor = aColor;
  vLight = aLight;
  vDist = uParams.x > 0.5 ? 0.0 : length(aPos);
}
`,
    fs: /* glsl */ `
${GLSL_FRAME}
${GLSL_LIGHT}
${GLSL_ATLAS}
uniform highp sampler2DArray uAlbedo;
uniform highp sampler2DArray uMaterial;
uniform highp sampler2DArray uSkins;
in vec2 vUV;
flat in float vLayer;
flat in uint vFlags;
in vec4 vColor;
in vec4 vLight;
in float vDist;
layout(location = 0) out vec4 outColor;
void main() {
  vec2 dx = dFdx(vUV), dy = dFdy(vUV);
  vec4 atl = atlasSample(uAlbedo, vUV, vLayer, dx, dy);
  vec4 mat = atlasSample(uMaterial, vUV, vLayer, dx, dy);
  vec4 skin = textureGrad(uSkins, vec3(vUV, vLayer), dx, dy);
  bool useSkin = (vFlags & 1u) != 0u;
  vec4 albedo = useSkin ? skin : atl;
  float tintMask = useSkin ? 1.0 : mat.a;
  bool translucent = (vFlags & 8u) != 0u;
  if (albedo.a < (translucent ? 0.02 : 0.1)) discard;
  vec3 base = albedo.rgb * mix(vec3(1.0), vColor.rgb, tintMask);
  vec3 light = lightmap(vLight.x, vLight.y, uFogParams.z, uBlockLight.w, uBlockLight.rgb, uFogParams.w, uMisc.w);
  float emissive = (vFlags & 2u) != 0u ? 1.0 : (useSkin ? 0.0 : mat.b);
  vec3 lit = base * mix(light * vLight.z, vec3(1.0), emissive);
  lit = mix(lit, vec3(1.0, 0.1, 0.1), vLight.w * 0.6);
  if ((vFlags & 4u) != 0u) {
    float g = fract((vUV.x + vUV.y) * 1.5 + uCam.w * 0.35);
    float g2 = fract((vUV.x - vUV.y * 0.7) * 2.3 - uCam.w * 0.21);
    lit += vec3(0.55, 0.3, 0.95) * (smoothstep(0.35, 0.5, g) * smoothstep(0.65, 0.5, g) + 0.6 * smoothstep(0.4, 0.5, g2) * smoothstep(0.6, 0.5, g2));
  }
  lit += vec3(uMisc.z) * 0.3;
  float fogStart = uFogColor.w, fogEnd = uFogParams.x;
  float fog = clamp((vDist - fogStart) / max(1.0, fogEnd - fogStart), 0.0, 1.0);
  if (uFogParams.y > 0.5) fog = clamp(vDist / 24.0, 0.0, 1.0);
  outColor = vec4(mix(lit, uFogColor.rgb, fog * fog), translucent ? albedo.a * vColor.a : 1.0);
}
`,
  },
  wgsl: /* wgsl */ `
${WGSL_FRAME}
${WGSL_LIGHT}
${WGSL_ATLAS}
struct EntityDraw { mvp: mat4x4<f32>, params: vec4<f32> };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> draw: EntityDraw;
@group(0) @binding(2) var tAlbedo: texture_2d_array<f32>;
@group(0) @binding(3) var sAlbedo: sampler;
@group(0) @binding(4) var tMaterial: texture_2d_array<f32>;
@group(0) @binding(5) var tSkins: texture_2d_array<f32>;

struct VIn {
  @location(0) pos: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) tex: vec2<u32>,
  @location(3) color: vec4<f32>,
  @location(4) light: vec4<f32>,
};
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) layer: i32,
  @location(2) @interpolate(flat) flags: u32,
  @location(3) color: vec4<f32>,
  @location(4) light: vec4<f32>,
  @location(5) dist: f32,
};

@vertex fn vs_main(v: VIn) -> VOut {
  var o: VOut;
  o.clip = draw.mvp * vec4<f32>(v.pos, 1.0);
  if (draw.params.x > 0.5) { o.clip.z = o.clip.z * 0.01; }
  o.uv = v.uv;
  o.layer = i32(v.tex.x);
  o.flags = v.tex.y;
  o.color = v.color;
  o.light = v.light;
  o.dist = select(length(v.pos), 0.0, draw.params.x > 0.5);
  return o;
}

@fragment fn fs_main(i: VOut) -> @location(0) vec4<f32> {
  let dx = dpdx(i.uv);
  let dy = dpdy(i.uv);
  let atl = atlasSample(tAlbedo, sAlbedo, i.uv, i.layer, dx, dy);
  let mat = atlasSample(tMaterial, sAlbedo, i.uv, i.layer, dx, dy);
  let skin = textureSampleGrad(tSkins, sAlbedo, i.uv, i.layer, dx, dy);
  let useSkin = (i.flags & 1u) != 0u;
  let albedo = select(atl, skin, useSkin);
  let tintMask = select(mat.a, 1.0, useSkin);
  let translucent = (i.flags & 8u) != 0u;
  if (albedo.a < select(0.1, 0.02, translucent)) { discard; }
  let base = albedo.rgb * mix(vec3<f32>(1.0), i.color.rgb, tintMask);
  let light = lightmap(i.light.x, i.light.y, frame.fogParams.z, frame.blockLight.w, frame.blockLight.rgb, frame.fogParams.w, frame.misc.w);
  let emissive = select(select(mat.b, 0.0, useSkin), 1.0, (i.flags & 2u) != 0u);
  var lit = base * mix(light * i.light.z, vec3<f32>(1.0), emissive);
  lit = mix(lit, vec3<f32>(1.0, 0.1, 0.1), i.light.w * 0.6);
  if ((i.flags & 4u) != 0u) {
    let g = fract((i.uv.x + i.uv.y) * 1.5 + frame.cam.w * 0.35);
    let g2 = fract((i.uv.x - i.uv.y * 0.7) * 2.3 - frame.cam.w * 0.21);
    lit += vec3<f32>(0.55, 0.3, 0.95) * (smoothstep(0.35, 0.5, g) * smoothstep(0.65, 0.5, g) + 0.6 * smoothstep(0.4, 0.5, g2) * smoothstep(0.6, 0.5, g2));
  }
  lit += vec3<f32>(frame.misc.z) * 0.3;
  let fogStart = frame.fogColor.w;
  let fogEnd = frame.fogParams.x;
  var fog = clamp((i.dist - fogStart) / max(1.0, fogEnd - fogStart), 0.0, 1.0);
  if (frame.fogParams.y > 0.5) { fog = clamp(i.dist / 24.0, 0.0, 1.0); }
  return vec4<f32>(mix(lit, frame.fogColor.rgb, fog * fog), select(1.0, albedo.a * i.color.a, translucent));
}
`,
};
