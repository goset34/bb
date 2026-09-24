/** WebGPU implementation of the RHI. */
import {
  Device, DeviceInfo, GpuBuffer, BufferUsage, Texture, TextureDesc, Sampler, SamplerDesc, Pipeline, PipelineDesc, BindGroup,
  BindingResource, PassDesc, RenderPass, TextureFormat, newId, BlendMode, bytesPerPixel,
} from './rhi';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface WGTexture extends Texture {
  tex: GPUTexture;
  views: Map<string, GPUTextureView>;
}

interface WGBuffer extends GpuBuffer {
  buf: GPUBuffer;
}

interface WGSampler extends Sampler {
  s: GPUSampler;
}

interface WGPipeline extends Pipeline {
  pipe: GPURenderPipeline;
  layout: GPUBindGroupLayout;
}

interface WGBindGroup extends BindGroup {
  group: GPUBindGroup;
}

function gpuFormat(f: TextureFormat, screen: GPUTextureFormat): GPUTextureFormat {
  switch (f) {
    case 'rgba8': return 'rgba8unorm';
    case 'rgba8-srgb': return 'rgba8unorm-srgb';
    case 'bgra8': return 'bgra8unorm';
    case 'rgba16f': return 'rgba16float';
    case 'rg16f': return 'rg16float';
    case 'r16f': return 'r16float';
    case 'r32f': return 'r32float';
    case 'rgba32f': return 'rgba32float';
    case 'r8': return 'r8unorm';
    case 'rg8': return 'rg8unorm';
    case 'rgb10a2': return 'rgb10a2unorm';
    case 'depth24': return 'depth24plus';
    case 'depth32f': return 'depth32float';
  }
  return screen;
}

export class WebGPUDevice implements Device {
  info!: DeviceInfo;
  readonly clipZeroToOne = true;
  readonly flipY = true;
  readonly screenFormat: TextureFormat = 'bgra8';
  readonly stats = { drawCalls: 0, triangles: 0, bufferBytes: 0, textureBytes: 0 };
  device!: GPUDevice;
  context!: GPUCanvasContext;
  presentFormat!: GPUTextureFormat;
  encoder: GPUCommandEncoder | null = null;
  private screenTex: GPUTexture | null = null;
  private screenDepth: GPUTexture | null = null;
  lost = false;

  private constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {}

  static async create(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<WebGPUDevice> {
    const nav = navigator as Navigator & { gpu?: GPU };
    if (!nav.gpu) throw new Error('WebGPU not available');
    const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter');
    const wanted: GPUFeatureName[] = ['float32-filterable', 'depth-clip-control', 'rg11b10ufloat-renderable'];
    const features = wanted.filter((f) => adapter.features.has(f));
    const device = await adapter.requestDevice({
      requiredFeatures: features,
      requiredLimits: {
        maxTextureArrayLayers: Math.min(adapter.limits.maxTextureArrayLayers, 4096),
        maxBindGroups: Math.min(adapter.limits.maxBindGroups, 4),
        maxSampledTexturesPerShaderStage: Math.min(adapter.limits.maxSampledTexturesPerShaderStage, 16),
        maxUniformBufferBindingSize: Math.min(adapter.limits.maxUniformBufferBindingSize, 65536),
        maxTextureDimension3D: Math.min(adapter.limits.maxTextureDimension3D, 2048),
      },
    });
    const d = new WebGPUDevice(canvas);
    d.device = device;
    device.lost.then((info) => {
      d.lost = true;
      console.error('[webgpu] device lost', info.message);
    });
    device.addEventListener('uncapturederror', (ev) => console.error('[webgpu]', (ev as GPUUncapturedErrorEvent).error.message));
    d.context = (canvas as HTMLCanvasElement).getContext('webgpu') as GPUCanvasContext;
    d.presentFormat = nav.gpu.getPreferredCanvasFormat();
    d.context.configure({ device, format: d.presentFormat, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
    const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
    d.info = {
      backend: 'webgpu',
      renderer: info ? `${info.vendor} ${info.architecture} ${info.description}`.trim() : 'WebGPU',
      maxTextureLayers: device.limits.maxTextureArrayLayers,
      maxTextureSize: device.limits.maxTextureDimension2D,
      floatRenderable: true,
      uniformAlignment: Math.max(256, device.limits.minUniformBufferOffsetAlignment),
      anisotropy: 16,
    };
    (d as { screenFormat: TextureFormat }).screenFormat = d.presentFormat === 'bgra8unorm' ? 'bgra8' : 'rgba8';
    return d;
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.screenDepth?.destroy();
    this.screenDepth = null;
  }

  // ---- buffers ------------------------------------------------------------------------------
  createBuffer(usage: BufferUsage, size: number, data?: ArrayBufferView, label?: string): GpuBuffer {
    const u = usage === 'vertex' ? GPUBufferUsage.VERTEX : usage === 'index' ? GPUBufferUsage.INDEX : GPUBufferUsage.UNIFORM;
    size = data ? Math.max(size, data.byteLength) : size;
    const aligned = Math.max(16, Math.ceil(size / 4) * 4);
    const buf = this.device.createBuffer({ size: aligned, usage: u | GPUBufferUsage.COPY_DST, label, mappedAtCreation: !!data });
    if (data) {
      new Uint8Array(buf.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, Math.min(data.byteLength, aligned)));
      buf.unmap();
    }
    this.stats.bufferBytes += aligned;
    const self = this;
    return {
      size, usage, id: newId(), buf,
      destroy() { buf.destroy(); self.stats.bufferBytes -= aligned; },
    } as WGBuffer;
  }

  writeBuffer(b: GpuBuffer, offset: number, data: ArrayBufferView, dataOffset = 0, size?: number): void {
    const bpe = (data as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
    const byteOff = data.byteOffset + dataOffset * bpe;
    const len = size ?? data.byteLength - dataOffset * bpe;
    const padded = Math.ceil(len / 4) * 4;
    if (padded !== len) {
      const tmp = new Uint8Array(padded);
      tmp.set(new Uint8Array(data.buffer, byteOff, len));
      this.device.queue.writeBuffer((b as WGBuffer).buf, offset, tmp);
      return;
    }
    this.device.queue.writeBuffer((b as WGBuffer).buf, offset, data.buffer as ArrayBuffer, byteOff, len);
  }

  // ---- textures -----------------------------------------------------------------------------
  createTexture(desc: TextureDesc): Texture {
    const format = gpuFormat(desc.format, this.presentFormat);
    let usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
    if (desc.renderTarget) usage |= GPUTextureUsage.RENDER_ATTACHMENT;
    if (desc.storage) usage |= GPUTextureUsage.STORAGE_BINDING;
    const tex = this.device.createTexture({
      size: { width: desc.width, height: desc.height, depthOrArrayLayers: desc.depth ?? 1 },
      dimension: desc.kind === '3d' ? '3d' : '2d',
      format,
      mipLevelCount: desc.mips ?? 1,
      usage,
      label: desc.label,
    });
    const bytes = desc.width * desc.height * (desc.depth ?? 1) * bytesPerPixel(desc.format) * ((desc.mips ?? 1) > 1 ? 1.34 : 1);
    this.stats.textureBytes += bytes;
    const self = this;
    return {
      desc, id: newId(), tex, views: new Map(),
      destroy() { tex.destroy(); self.stats.textureBytes -= bytes; },
    } as WGTexture;
  }

  private view(t: WGTexture, kind: 'sample' | 'target', mip = 0, layer = -1): GPUTextureView {
    const key = `${kind}:${mip}:${layer}`;
    let v = t.views.get(key);
    if (v) return v;
    if (kind === 'sample') {
      v = t.tex.createView({ dimension: t.desc.kind === '2d-array' ? '2d-array' : t.desc.kind === '3d' ? '3d' : '2d' });
    } else {
      v = t.tex.createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: Math.max(0, layer), arrayLayerCount: 1 });
    }
    t.views.set(key, v);
    return v;
  }

  writeTexture(t: Texture, data: ArrayBufferView, opts: { mip?: number; z?: number; depth?: number; x?: number; y?: number; width?: number; height?: number }): void {
    const mip = opts.mip ?? 0;
    const w = opts.width ?? Math.max(1, t.desc.width >> mip);
    const h = opts.height ?? Math.max(1, t.desc.height >> mip);
    let bpp = bytesPerPixel(t.desc.format);
    let src = data;
    if ((t.desc.format === 'rgba16f' || t.desc.format === 'rg16f' || t.desc.format === 'r16f') && data instanceof Float32Array) {
      src = f32ToF16(data);
    }
    if (t.desc.format === 'bgra8') bpp = 4;
    this.device.queue.writeTexture(
      { texture: (t as WGTexture).tex, mipLevel: mip, origin: { x: opts.x ?? 0, y: opts.y ?? 0, z: opts.z ?? 0 } },
      src.buffer as ArrayBuffer,
      { offset: src.byteOffset, bytesPerRow: w * bpp, rowsPerImage: h },
      { width: w, height: h, depthOrArrayLayers: opts.depth ?? 1 },
    );
  }

  createSampler(desc: SamplerDesc): Sampler {
    const wrap: GPUAddressMode = desc.wrap === 'repeat' ? 'repeat' : 'clamp-to-edge';
    const s = this.device.createSampler({
      magFilter: desc.mag, minFilter: desc.min, mipmapFilter: desc.mip === 'none' ? 'nearest' : desc.mip,
      addressModeU: wrap, addressModeV: wrap, addressModeW: wrap,
      compare: desc.compare === 'lequal' ? 'less-equal' : desc.compare === 'gequal' ? 'greater-equal' : desc.compare,
      maxAnisotropy: desc.anisotropy && desc.mag === 'linear' && desc.min === 'linear' && desc.mip === 'linear' ? Math.min(16, desc.anisotropy) : 1,
      lodMaxClamp: desc.mip === 'none' ? 0 : desc.maxLod ?? 32,
    });
    return { desc, id: newId(), s } as WGSampler;
  }

  // ---- pipelines ---------------------------------------------------------------------------
  createPipeline(desc: PipelineDesc): Pipeline {
    const dev = this.device;
    const defs = Object.entries(desc.defines ?? {}).map(([k, v]) => `const ${k}: ${typeof v === 'number' && !Number.isInteger(v) ? 'f32' : typeof v === 'boolean' ? 'bool' : 'i32'} = ${v === true ? 'true' : v === false ? 'false' : v};`).join('\n');
    const code = defs + '\n' + desc.shader.wgsl;
    const module = dev.createShaderModule({ code, label: desc.label });
    module.getCompilationInfo().then((info) => {
      for (const m of info.messages) if (m.type === 'error') console.error(`[${desc.label}] WGSL ${m.lineNum}:${m.linePos} ${m.message}`);
    });
    const entries: GPUBindGroupLayoutEntry[] = desc.bindings.map((b, i) => {
      const visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
      if (b.type === 'uniform') return { binding: i, visibility, buffer: { type: 'uniform', hasDynamicOffset: !!b.dynamic } };
      if (b.type === 'sampler') return { binding: i, visibility, sampler: { type: b.samplerType ?? 'filtering' } };
      return {
        binding: i, visibility,
        texture: {
          sampleType: b.sampleType ?? 'float',
          viewDimension: b.textureKind === '2d-array' ? '2d-array' : b.textureKind === '3d' ? '3d' : '2d',
        },
      };
    });
    const layout = dev.createBindGroupLayout({ entries, label: desc.label });
    const topology: GPUPrimitiveTopology = desc.topology ?? 'triangle-list';
    const pipe = dev.createRenderPipeline({
      label: desc.label,
      layout: dev.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: {
        module, entryPoint: 'vs_main',
        buffers: desc.vertexBuffers.map((vb) => ({
          arrayStride: vb.stride, stepMode: vb.step ?? 'vertex',
          attributes: vb.attributes.map((a) => ({ shaderLocation: a.location, offset: a.offset, format: a.format as GPUVertexFormat })),
        })),
      },
      fragment: {
        module, entryPoint: 'fs_main',
        targets: desc.colorTargets.map((c) => ({
          format: c.format === 'screen' ? this.presentFormat : gpuFormat(c.format, this.presentFormat),
          blend: blendState(c.blend ?? 'none'),
          writeMask: c.writeMask ?? GPUColorWrite.ALL,
        })),
      },
      primitive: { topology, cullMode: desc.cull ?? 'none', frontFace: 'ccw' },
      depthStencil: desc.depth ? {
        format: gpuFormat(desc.depth.format, this.presentFormat),
        depthWriteEnabled: desc.depth.write,
        depthCompare: desc.depth.compare === 'lequal' ? 'less-equal' : desc.depth.compare === 'gequal' ? 'greater-equal' : desc.depth.compare,
        depthBias: desc.depth.bias ?? 0,
        depthBiasSlopeScale: desc.depth.slopeBias ?? 0,
      } : undefined,
    });
    return { desc, id: newId(), pipe, layout } as WGPipeline;
  }

  createBindGroup(p: Pipeline, resources: BindingResource[]): BindGroup {
    const wp = p as WGPipeline;
    const entries: GPUBindGroupEntry[] = resources.map((r, i) => {
      const b = p.desc.bindings[i]!;
      if ('buffer' in r) return { binding: i, resource: { buffer: (r.buffer as WGBuffer).buf, offset: r.offset ?? 0, size: b.size ?? r.size ?? r.buffer.size } };
      if ('sampler' in r) return { binding: i, resource: (r.sampler as WGSampler).s };
      return { binding: i, resource: this.view(r.texture as WGTexture, 'sample') };
    });
    const group = this.device.createBindGroup({ layout: wp.layout, entries });
    return { pipeline: p, resources, id: newId(), group } as WGBindGroup;
  }

  // ---- passes -------------------------------------------------------------------------------
  private currentScreen(): GPUTexture {
    if (!this.screenTex) this.screenTex = this.context.getCurrentTexture();
    return this.screenTex;
  }

  screenDepthTexture(): GPUTexture {
    const w = this.canvas.width, h = this.canvas.height;
    if (!this.screenDepth || this.screenDepth.width !== w || this.screenDepth.height !== h) {
      this.screenDepth?.destroy();
      this.screenDepth = this.device.createTexture({ size: { width: w, height: h }, format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    return this.screenDepth;
  }

  beginPass(desc: PassDesc): RenderPass {
    if (!this.encoder) this.encoder = this.device.createCommandEncoder();
    const colorAttachments: GPURenderPassColorAttachment[] = desc.color.map((c) => ({
      view: c.target === 'screen' ? this.currentScreen().createView() : this.view(c.target as WGTexture, 'target', c.mip ?? 0, c.layer ?? -1),
      clearValue: c.clear ? { r: c.clear[0], g: c.clear[1], b: c.clear[2], a: c.clear[3] } : undefined,
      loadOp: c.clear ? 'clear' : 'load',
      storeOp: 'store',
    }));
    let depthStencilAttachment: GPURenderPassDepthStencilAttachment | undefined;
    if (desc.depth) {
      depthStencilAttachment = {
        view: this.view(desc.depth.target as WGTexture, 'target', 0, desc.depth.layer ?? -1),
        depthClearValue: desc.depth.clear ?? 1,
        depthLoadOp: desc.depth.clear !== undefined ? 'clear' : 'load',
        depthStoreOp: 'store',
      };
    } else if (desc.color.some((c) => c.target === 'screen')) {
      const clearing = desc.color[0]?.clear !== undefined;
      depthStencilAttachment = { view: this.screenDepthTexture().createView(), depthClearValue: 1, depthLoadOp: clearing ? 'clear' : 'load', depthStoreOp: 'store' };
    }
    const pass = this.encoder.beginRenderPass({ colorAttachments, depthStencilAttachment, label: desc.label });
    if (desc.viewport) pass.setViewport(desc.viewport[0], desc.viewport[1], desc.viewport[2], desc.viewport[3], 0, 1);
    return new WGRenderPass(this, pass);
  }

  copyTexture(src: Texture | 'screen', dst: Texture): void {
    if (!this.encoder) this.encoder = this.device.createCommandEncoder();
    const s = src === 'screen' ? this.currentScreen() : (src as WGTexture).tex;
    this.encoder.copyTextureToTexture({ texture: s }, { texture: (dst as WGTexture).tex }, { width: Math.min(s.width, dst.desc.width), height: Math.min(s.height, dst.desc.height) });
  }

  beginFrame(): void {
    this.stats.drawCalls = 0;
    this.stats.triangles = 0;
    this.screenTex = null;
    this.encoder = this.device.createCommandEncoder();
  }

  endFrame(): void {
    if (this.encoder) {
      this.device.queue.submit([this.encoder.finish()]);
      this.encoder = null;
    }
    this.screenTex = null;
  }

  async readScreen(): Promise<Uint8Array> {
    const w = this.canvas.width, h = this.canvas.height;
    const bpr = Math.ceil((w * 4) / 256) * 256;
    const buf = this.device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.context.getCurrentTexture() }, { buffer: buf, bytesPerRow: bpr }, { width: w, height: h });
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const out = new Uint8Array(w * h * 4);
    const bgra = this.presentFormat === 'bgra8unorm';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = y * bpr + x * 4, d = ((h - 1 - y) * w + x) * 4;
        out[d] = src[s + (bgra ? 2 : 0)]!; out[d + 1] = src[s + 1]!; out[d + 2] = src[s + (bgra ? 0 : 2)]!; out[d + 3] = 255;
      }
    }
    buf.unmap();
    buf.destroy();
    return out;
  }

  destroy(): void {
    this.device.destroy();
  }
}

class WGRenderPass implements RenderPass {
  private indexCount = 0;
  constructor(private readonly dev: WebGPUDevice, private readonly pass: GPURenderPassEncoder) {}
  setPipeline(p: Pipeline): void { this.pass.setPipeline((p as WGPipeline).pipe); }
  setBindGroup(g: BindGroup, dynamicOffsets?: number[]): void { this.pass.setBindGroup(0, (g as WGBindGroup).group, dynamicOffsets ?? []); }
  setVertexBuffer(slot: number, b: GpuBuffer, offset = 0): void { this.pass.setVertexBuffer(slot, (b as WGBuffer).buf, offset); }
  setIndexBuffer(b: GpuBuffer, format: 'uint16' | 'uint32'): void { this.pass.setIndexBuffer((b as WGBuffer).buf, format); }
  draw(vertexCount: number, instanceCount = 1, firstVertex = 0): void {
    this.pass.draw(vertexCount, instanceCount, firstVertex, 0);
    this.dev.stats.drawCalls++;
    this.dev.stats.triangles += (vertexCount / 3) * instanceCount;
  }
  drawIndexed(indexCount: number, instanceCount = 1, firstIndex = 0): void {
    this.pass.drawIndexed(indexCount, instanceCount, firstIndex, 0, 0);
    this.dev.stats.drawCalls++;
    this.dev.stats.triangles += (indexCount / 3) * instanceCount;
    this.indexCount += indexCount;
  }
  setViewport(x: number, y: number, w: number, h: number): void { this.pass.setViewport(x, y, w, h, 0, 1); }
  setScissor(x: number, y: number, w: number, h: number): void { this.pass.setScissorRect(x, y, w, h); }
  end(): void { this.pass.end(); }
}

function blendState(mode: BlendMode): GPUBlendState | undefined {
  switch (mode) {
    case 'none': return undefined;
    case 'alpha': return { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    case 'premultiplied': return { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    case 'additive': return { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
    case 'multiply': return { color: { srcFactor: 'dst', dstFactor: 'zero', operation: 'add' }, alpha: { srcFactor: 'dst-alpha', dstFactor: 'zero', operation: 'add' } };
  }
}

function f32ToF16(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  for (let i = 0; i < src.length; i++) {
    f[0] = src[i]!;
    const x = u[0]!;
    const sign = (x >> 16) & 0x8000;
    const exp = ((x >> 23) & 0xff) - 112;
    if (exp <= 0) out[i] = sign;
    else if (exp >= 31) out[i] = sign | 0x7c00;
    else out[i] = sign | (exp << 10) | ((x & 0x7fffff) >> 13);
  }
  return out;
}
