/**
 * Render Hardware Interface: a thin, explicit abstraction over WebGPU and WebGL2.
 * Passes and renderers are written once against this interface.
 */

export type TextureFormat =
  | 'rgba8' | 'rgba8-srgb' | 'bgra8' | 'rgba16f' | 'rg16f' | 'r16f' | 'r32f' | 'rgba32f' | 'r8' | 'rg8'
  | 'rgb10a2' | 'depth24' | 'depth32f';

export type TextureKind = '2d' | '2d-array' | '3d';

export interface TextureDesc {
  kind: TextureKind;
  format: TextureFormat;
  width: number;
  height: number;
  /** Layers for 2d-array, depth for 3d. */
  depth?: number;
  mips?: number;
  renderTarget?: boolean;
  /** Allow writes from compute/storage (WebGPU only). */
  storage?: boolean;
  label?: string;
}

export interface SamplerDesc {
  mag: 'nearest' | 'linear';
  min: 'nearest' | 'linear';
  mip: 'none' | 'nearest' | 'linear';
  wrap: 'repeat' | 'clamp';
  compare?: 'less' | 'lequal' | 'greater' | 'gequal';
  anisotropy?: number;
  maxLod?: number;
}

export interface Texture {
  readonly desc: TextureDesc;
  readonly id: number;
  destroy(): void;
}

export interface GpuBuffer {
  readonly size: number;
  readonly usage: BufferUsage;
  readonly id: number;
  destroy(): void;
}

export type BufferUsage = 'vertex' | 'index' | 'uniform';

export interface Sampler {
  readonly desc: SamplerDesc;
  readonly id: number;
}

export type VertexFormat =
  | 'float32' | 'float32x2' | 'float32x3' | 'float32x4'
  | 'uint16x2' | 'uint16x4' | 'unorm16x2' | 'unorm16x4'
  | 'uint8x4' | 'unorm8x4' | 'uint32';

export interface VertexAttribute {
  location: number;
  /** Name in GLSL (`in` variable). */
  name: string;
  format: VertexFormat;
  offset: number;
}

export interface VertexBufferLayout {
  stride: number;
  step?: 'vertex' | 'instance';
  attributes: VertexAttribute[];
}

export type BindingType = 'uniform' | 'texture' | 'sampler';

export interface BindingLayout {
  /** GLSL name: uniform block name, sampler uniform name, or ignored for samplers. */
  name: string;
  type: BindingType;
  /** Uniform: dynamic offset support. */
  dynamic?: boolean;
  /** Uniform: bytes bound per draw (for dynamic) — defaults to buffer size. */
  size?: number;
  textureKind?: TextureKind;
  sampleType?: 'float' | 'unfilterable-float' | 'depth';
  /** For textures: index (in the layout list) of the sampler used with it (GLSL combined samplers). */
  samplerBinding?: number;
  samplerType?: 'filtering' | 'non-filtering' | 'comparison';
}

export interface ShaderSource {
  glsl: { vs: string; fs: string };
  /** WGSL module with entry points vs_main / fs_main. */
  wgsl: string;
}

export type BlendMode = 'none' | 'alpha' | 'additive' | 'premultiplied' | 'multiply';

export interface ColorTarget {
  format: TextureFormat | 'screen';
  blend?: BlendMode;
  writeMask?: number;
}

export interface DepthState {
  format: TextureFormat;
  write: boolean;
  compare: 'never' | 'less' | 'lequal' | 'equal' | 'greater' | 'gequal' | 'always';
  bias?: number;
  slopeBias?: number;
}

export interface PipelineDesc {
  label: string;
  shader: ShaderSource;
  vertexBuffers: VertexBufferLayout[];
  bindings: BindingLayout[];
  topology?: 'triangle-list' | 'line-list' | 'triangle-strip';
  cull?: 'none' | 'back' | 'front';
  depth?: DepthState;
  colorTargets: ColorTarget[];
  /** GLSL #define block injected at the top of both stages. */
  defines?: Record<string, string | number | boolean>;
}

export interface Pipeline {
  readonly desc: PipelineDesc;
  readonly id: number;
}

export type BindingResource =
  | { buffer: GpuBuffer; offset?: number; size?: number }
  | { texture: Texture; layer?: number }
  | { sampler: Sampler };

export interface BindGroup {
  readonly pipeline: Pipeline;
  readonly resources: BindingResource[];
  readonly id: number;
}

export interface ColorAttachment {
  target: Texture | 'screen';
  mip?: number;
  layer?: number;
  clear?: [number, number, number, number];
}

export interface DepthAttachment {
  target: Texture;
  layer?: number;
  clear?: number;
}

export interface PassDesc {
  label?: string;
  color: ColorAttachment[];
  depth?: DepthAttachment;
  viewport?: [number, number, number, number];
}

export interface RenderPass {
  setPipeline(p: Pipeline): void;
  setBindGroup(g: BindGroup, dynamicOffsets?: number[]): void;
  setVertexBuffer(slot: number, b: GpuBuffer, offset?: number): void;
  setIndexBuffer(b: GpuBuffer, format: 'uint16' | 'uint32'): void;
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number): void;
  drawIndexed(indexCount: number, instanceCount?: number, firstIndex?: number): void;
  setViewport(x: number, y: number, w: number, h: number): void;
  setScissor(x: number, y: number, w: number, h: number): void;
  end(): void;
}

export interface DeviceInfo {
  backend: 'webgpu' | 'webgl2';
  renderer: string;
  maxTextureLayers: number;
  maxTextureSize: number;
  floatRenderable: boolean;
  uniformAlignment: number;
  anisotropy: number;
}

export interface Device {
  readonly info: DeviceInfo;
  /** Clip-space depth range [0,1] (WebGPU) or [-1,1] (WebGL). */
  readonly clipZeroToOne: boolean;
  /** Framebuffer origin at top-left (WebGPU) vs bottom-left (GL). Affects render-target sampling. */
  readonly flipY: boolean;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly screenFormat: TextureFormat;

  resize(width: number, height: number): void;
  createBuffer(usage: BufferUsage, size: number, data?: ArrayBufferView, label?: string): GpuBuffer;
  writeBuffer(b: GpuBuffer, offset: number, data: ArrayBufferView, dataOffset?: number, size?: number): void;
  createTexture(desc: TextureDesc): Texture;
  /** Upload pixels to (mip, z-range). `data` is tightly packed RGBA8 / float as per format. */
  writeTexture(t: Texture, data: ArrayBufferView, opts: { mip?: number; z?: number; depth?: number; x?: number; y?: number; width?: number; height?: number }): void;
  createSampler(desc: SamplerDesc): Sampler;
  createPipeline(desc: PipelineDesc): Pipeline;
  createBindGroup(p: Pipeline, resources: BindingResource[]): BindGroup;
  beginPass(desc: PassDesc): RenderPass;
  /** Copy a texture region (render target → texture), used for refraction/SSR scene copies. */
  copyTexture(src: Texture | 'screen', dst: Texture): void;
  /** Called once per frame before rendering. */
  beginFrame(): void;
  /** Submit all work for the frame. */
  endFrame(): void;
  /** Read back pixels from the screen (tests/screenshots). */
  readScreen?(): Promise<Uint8Array>;
  destroy(): void;
  /** Stats. */
  readonly stats: { drawCalls: number; triangles: number; bufferBytes: number; textureBytes: number };
}

export function bytesPerPixel(f: TextureFormat): number {
  switch (f) {
    case 'r8': return 1;
    case 'rg8': case 'r16f': return 2;
    case 'rgba8': case 'rgba8-srgb': case 'bgra8': case 'rg16f': case 'r32f': case 'rgb10a2': case 'depth24': case 'depth32f': return 4;
    case 'rgba16f': return 8;
    case 'rgba32f': return 16;
  }
}

let nextId = 1;
export function newId(): number {
  return nextId++;
}
