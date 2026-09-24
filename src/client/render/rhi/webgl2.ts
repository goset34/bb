/** WebGL2 implementation of the RHI. */
import {
  Device, DeviceInfo, GpuBuffer, BufferUsage, Texture, TextureDesc, Sampler, SamplerDesc, Pipeline, PipelineDesc, BindGroup,
  BindingResource, PassDesc, RenderPass, TextureFormat, newId, VertexFormat, BlendMode, bytesPerPixel,
} from './rhi';

interface GLTexture extends Texture {
  tex: WebGLTexture;
  target: number;
}

interface GLBuffer extends GpuBuffer {
  buf: WebGLBuffer;
  target: number;
  vaos: Map<string, WebGLVertexArrayObject>;
}

interface GLSampler extends Sampler {
  s: WebGLSampler;
}

interface GLPipeline extends Pipeline {
  program: WebGLProgram;
  /** texture binding index → texture unit */
  units: Map<number, number>;
}

interface GLBindGroup extends BindGroup {
  resources: BindingResource[];
}

function fmtInfo(gl: WebGL2RenderingContext, f: TextureFormat): { internal: number; format: number; type: number } {
  switch (f) {
    case 'rgba8': case 'bgra8': return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    case 'rgba8-srgb': return { internal: gl.SRGB8_ALPHA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    case 'rgba16f': return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    case 'rg16f': return { internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT };
    case 'r16f': return { internal: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT };
    case 'r32f': return { internal: gl.R32F, format: gl.RED, type: gl.FLOAT };
    case 'rgba32f': return { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT };
    case 'r8': return { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE };
    case 'rg8': return { internal: gl.RG8, format: gl.RG, type: gl.UNSIGNED_BYTE };
    case 'rgb10a2': return { internal: gl.RGB10_A2, format: gl.RGBA, type: gl.UNSIGNED_INT_2_10_10_10_REV };
    case 'depth24': return { internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT };
    case 'depth32f': return { internal: gl.DEPTH_COMPONENT32F, format: gl.DEPTH_COMPONENT, type: gl.FLOAT };
  }
}

function vertexFmt(gl: WebGL2RenderingContext, f: VertexFormat): { size: number; type: number; normalized: boolean; integer: boolean } {
  switch (f) {
    case 'float32': return { size: 1, type: gl.FLOAT, normalized: false, integer: false };
    case 'float32x2': return { size: 2, type: gl.FLOAT, normalized: false, integer: false };
    case 'float32x3': return { size: 3, type: gl.FLOAT, normalized: false, integer: false };
    case 'float32x4': return { size: 4, type: gl.FLOAT, normalized: false, integer: false };
    case 'uint16x2': return { size: 2, type: gl.UNSIGNED_SHORT, normalized: false, integer: true };
    case 'uint16x4': return { size: 4, type: gl.UNSIGNED_SHORT, normalized: false, integer: true };
    case 'unorm16x2': return { size: 2, type: gl.UNSIGNED_SHORT, normalized: true, integer: false };
    case 'unorm16x4': return { size: 4, type: gl.UNSIGNED_SHORT, normalized: true, integer: false };
    case 'uint8x4': return { size: 4, type: gl.UNSIGNED_BYTE, normalized: false, integer: true };
    case 'unorm8x4': return { size: 4, type: gl.UNSIGNED_BYTE, normalized: true, integer: false };
    case 'uint32': return { size: 1, type: gl.UNSIGNED_INT, normalized: false, integer: true };
  }
}

export class WebGL2Device implements Device {
  readonly info: DeviceInfo;
  readonly clipZeroToOne = false;
  readonly flipY = false;
  readonly screenFormat: TextureFormat = 'rgba8';
  readonly gl: WebGL2RenderingContext;
  readonly stats = { drawCalls: 0, triangles: 0, bufferBytes: 0, textureBytes: 0 };
  private readonly fbos = new Map<string, WebGLFramebuffer>();
  private anisoExt: EXT_texture_filter_anisotropic | null;
  private currentProgram: WebGLProgram | null = null;
  private textureBindings = new Map<number, number>();

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    const floatRT = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.info = {
      backend: 'webgl2',
      renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
      maxTextureLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      floatRenderable: floatRT,
      uniformAlignment: Math.max(256, gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number),
      anisotropy: this.anisoExt ? (gl.getParameter(this.anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 1,
    };
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  // ---- buffers ------------------------------------------------------------------------------
  createBuffer(usage: BufferUsage, size: number, data?: ArrayBufferView): GpuBuffer {
    const gl = this.gl;
    const target = usage === 'index' ? gl.ELEMENT_ARRAY_BUFFER : usage === 'uniform' ? gl.UNIFORM_BUFFER : gl.ARRAY_BUFFER;
    if (data) size = Math.max(size, data.byteLength);
    const buf = gl.createBuffer()!;
    if (target === gl.ELEMENT_ARRAY_BUFFER) gl.bindVertexArray(null);
    gl.bindBuffer(target, buf);
    const hint = usage === 'uniform' ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
    if (data) gl.bufferData(target, data, hint);
    else gl.bufferData(target, size, hint);
    this.stats.bufferBytes += size;
    const self = this;
    const b: GLBuffer = {
      size, usage, id: newId(), buf, target, vaos: new Map(),
      destroy() {
        for (const v of b.vaos.values()) gl.deleteVertexArray(v);
        b.vaos.clear();
        gl.deleteBuffer(buf);
        self.stats.bufferBytes -= size;
      },
    };
    return b;
  }

  writeBuffer(b: GpuBuffer, offset: number, data: ArrayBufferView, dataOffset = 0, size?: number): void {
    const gl = this.gl;
    const gb = b as GLBuffer;
    if (gb.target === gl.ELEMENT_ARRAY_BUFFER) gl.bindVertexArray(null);
    gl.bindBuffer(gb.target, gb.buf);
    const bpe = (data as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
    gl.bufferSubData(gb.target, offset, data, dataOffset, size !== undefined ? size / bpe : undefined);
  }

  // ---- textures -----------------------------------------------------------------------------
  createTexture(desc: TextureDesc): Texture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    const target = desc.kind === '2d' ? gl.TEXTURE_2D : desc.kind === '2d-array' ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_3D;
    gl.bindTexture(target, tex);
    const { internal } = fmtInfo(gl, desc.format);
    const mips = desc.mips ?? 1;
    if (target === gl.TEXTURE_2D) gl.texStorage2D(target, mips, internal, desc.width, desc.height);
    else gl.texStorage3D(target, mips, internal, desc.width, desc.height, desc.depth ?? 1);
    gl.texParameteri(target, gl.TEXTURE_MAX_LEVEL, mips - 1);
    const bytes = desc.width * desc.height * (desc.depth ?? 1) * bytesPerPixel(desc.format) * (mips > 1 ? 1.34 : 1);
    this.stats.textureBytes += bytes;
    const self = this;
    const t: GLTexture = {
      desc, id: newId(), tex, target,
      destroy() {
        gl.deleteTexture(tex);
        self.stats.textureBytes -= bytes;
        for (const [k, fb] of self.fbos) if (k.includes(`t${t.id}:`)) { gl.deleteFramebuffer(fb); self.fbos.delete(k); }
      },
    };
    return t;
  }

  writeTexture(t: Texture, data: ArrayBufferView, opts: { mip?: number; z?: number; depth?: number; x?: number; y?: number; width?: number; height?: number }): void {
    const gl = this.gl;
    const gt = t as GLTexture;
    const mip = opts.mip ?? 0;
    const w = opts.width ?? Math.max(1, t.desc.width >> mip);
    const h = opts.height ?? Math.max(1, t.desc.height >> mip);
    const { format, type } = fmtInfo(gl, t.desc.format);
    gl.bindTexture(gt.target, gt.tex);
    let src = data;
    if (type === gl.HALF_FLOAT && data instanceof Float32Array) {
      src = toHalf(data);
    }
    if (gt.target === gl.TEXTURE_2D) gl.texSubImage2D(gt.target, mip, opts.x ?? 0, opts.y ?? 0, w, h, format, type, src);
    else gl.texSubImage3D(gt.target, mip, opts.x ?? 0, opts.y ?? 0, opts.z ?? 0, w, h, opts.depth ?? 1, format, type, src);
  }

  createSampler(desc: SamplerDesc): Sampler {
    const gl = this.gl;
    const s = gl.createSampler()!;
    const minF = desc.mip === 'none' ? (desc.min === 'linear' ? gl.LINEAR : gl.NEAREST)
      : desc.min === 'linear' ? (desc.mip === 'linear' ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR_MIPMAP_NEAREST)
      : (desc.mip === 'linear' ? gl.NEAREST_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_NEAREST);
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, minF);
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, desc.mag === 'linear' ? gl.LINEAR : gl.NEAREST);
    const wrap = desc.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, wrap);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, wrap);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_R, wrap);
    if (desc.maxLod !== undefined) gl.samplerParameterf(s, gl.TEXTURE_MAX_LOD, desc.maxLod);
    if (desc.compare) {
      gl.samplerParameteri(s, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.samplerParameteri(s, gl.TEXTURE_COMPARE_FUNC, desc.compare === 'less' ? gl.LESS : desc.compare === 'lequal' ? gl.LEQUAL : desc.compare === 'greater' ? gl.GREATER : gl.GEQUAL);
    }
    if (desc.anisotropy && desc.anisotropy > 1 && this.anisoExt) {
      gl.samplerParameterf(s, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(desc.anisotropy, this.info.anisotropy));
    }
    return { desc, id: newId(), s } as GLSampler;
  }

  // ---- pipelines ---------------------------------------------------------------------------
  private compile(type: number, src: string, label: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
      throw new Error(`[${label}] shader compile error:\n${log}\n${numbered}`);
    }
    return sh;
  }

  createPipeline(desc: PipelineDesc): Pipeline {
    const gl = this.gl;
    const defs = Object.entries(desc.defines ?? {}).filter(([, v]) => v !== false).map(([k, v]) => `#define ${k} ${v === true ? 1 : v}`).join('\n');
    const header = `#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2DArray;\nprecision highp sampler3D;\nprecision highp sampler2DShadow;\n${defs}\n`;
    const vs = this.compile(gl.VERTEX_SHADER, header + desc.shader.glsl.vs, desc.label + ':vs');
    const fs = this.compile(gl.FRAGMENT_SHADER, header + desc.shader.glsl.fs, desc.label + ':fs');
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    for (const vb of desc.vertexBuffers) for (const a of vb.attributes) gl.bindAttribLocation(program, a.location, a.name);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`[${desc.label}] link error: ${gl.getProgramInfoLog(program)}`);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.useProgram(program);
    this.currentProgram = program;
    const units = new Map<number, number>();
    let unit = 0;
    desc.bindings.forEach((b, i) => {
      if (b.type === 'uniform') {
        const idx = gl.getUniformBlockIndex(program, b.name);
        if (idx !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, idx, i);
      } else if (b.type === 'texture') {
        const loc = gl.getUniformLocation(program, b.name);
        if (loc) gl.uniform1i(loc, unit);
        units.set(i, unit++);
      }
    });
    return { desc, id: newId(), program, units } as GLPipeline;
  }

  createBindGroup(p: Pipeline, resources: BindingResource[]): BindGroup {
    return { pipeline: p, resources, id: newId() } as GLBindGroup;
  }

  // ---- passes -------------------------------------------------------------------------------
  private framebuffer(desc: PassDesc): WebGLFramebuffer | null {
    const gl = this.gl;
    if (desc.color.length === 1 && desc.color[0]!.target === 'screen' && !desc.depth) return null;
    if (desc.color.every((c) => c.target === 'screen') && desc.depth === undefined) return null;
    if (desc.color.some((c) => c.target === 'screen')) return null; // screen uses default framebuffer (with its depth)
    const key = desc.color.map((c) => `t${(c.target as Texture).id}:${c.mip ?? 0}:${c.layer ?? -1}`).join('|') + '#' + (desc.depth ? `t${desc.depth.target.id}:${desc.depth.layer ?? -1}` : '');
    let fb = this.fbos.get(key);
    if (fb) return fb;
    fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    desc.color.forEach((c, i) => {
      const t = c.target as GLTexture;
      if (t.target === gl.TEXTURE_2D) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.tex, c.mip ?? 0);
      else gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, t.tex, c.mip ?? 0, c.layer ?? 0);
    });
    if (desc.depth) {
      const t = desc.depth.target as GLTexture;
      if (t.target === gl.TEXTURE_2D) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t.tex, 0);
      else gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, t.tex, 0, desc.depth.layer ?? 0);
    }
    gl.drawBuffers(desc.color.length ? desc.color.map((_, i) => gl.COLOR_ATTACHMENT0 + i) : [gl.NONE]);
    if (!desc.color.length) gl.readBuffer(gl.NONE);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
    this.fbos.set(key, fb);
    return fb;
  }

  beginPass(desc: PassDesc): RenderPass {
    const gl = this.gl;
    const fb = this.framebuffer(desc);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    let w: number, h: number;
    const first = desc.color[0];
    if (first && first.target !== 'screen') { w = Math.max(1, first.target.desc.width >> (first.mip ?? 0)); h = Math.max(1, first.target.desc.height >> (first.mip ?? 0)); }
    else if (!first && desc.depth) { w = desc.depth.target.desc.width; h = desc.depth.target.desc.height; }
    else { w = this.canvas.width; h = this.canvas.height; }
    const vp = desc.viewport ?? [0, 0, w, h];
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    gl.disable(gl.SCISSOR_TEST);
    // Clears
    desc.color.forEach((c, i) => {
      if (!c.clear) return;
      gl.colorMask(true, true, true, true);
      if (fb === null) {
        gl.clearColor(c.clear[0], c.clear[1], c.clear[2], c.clear[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
      } else {
        const fmt = (c.target as Texture).desc.format;
        if (fmt === 'rgba8' || fmt === 'rgba8-srgb' || fmt === 'r8' || fmt === 'rg8' || fmt === 'rgb10a2' || fmt === 'bgra8' || fmt.endsWith('f')) gl.clearBufferfv(gl.COLOR, i, c.clear);
      }
    });
    if (desc.depth?.clear !== undefined || (fb === null && desc.color[0]?.clear)) {
      gl.depthMask(true);
      gl.clearDepth(desc.depth?.clear ?? 1);
      gl.clear(gl.DEPTH_BUFFER_BIT);
    }
    return new GLRenderPass(this);
  }

  bindPipelineState(p: GLPipeline): void {
    const gl = this.gl;
    const d = p.desc;
    if (this.currentProgram !== p.program) {
      gl.useProgram(p.program);
      this.currentProgram = p.program;
    }
    if (d.cull === 'back' || d.cull === 'front') {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(d.cull === 'back' ? gl.BACK : gl.FRONT);
    } else gl.disable(gl.CULL_FACE);
    if (d.depth) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(d.depth.write);
      gl.depthFunc(depthFunc(gl, d.depth.compare));
      if (d.depth.bias || d.depth.slopeBias) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(d.depth.slopeBias ?? 0, d.depth.bias ?? 0);
      } else gl.disable(gl.POLYGON_OFFSET_FILL);
    } else {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
    }
    const blend: BlendMode = d.colorTargets[0]?.blend ?? 'none';
    applyBlend(gl, blend);
    const wm = d.colorTargets[0]?.writeMask ?? 15;
    gl.colorMask(!!(wm & 1), !!(wm & 2), !!(wm & 4), !!(wm & 8));
  }

  bindGroup(g: GLBindGroup, dyn: number[] | undefined): void {
    const gl = this.gl;
    const p = g.pipeline as GLPipeline;
    let dynIdx = 0;
    p.desc.bindings.forEach((b, i) => {
      const r = g.resources[i];
      if (!r) return;
      if (b.type === 'uniform' && 'buffer' in r) {
        const off = (r.offset ?? 0) + (b.dynamic ? dyn?.[dynIdx++] ?? 0 : 0);
        const size = b.size ?? r.size ?? r.buffer.size - off;
        gl.bindBufferRange(gl.UNIFORM_BUFFER, i, (r.buffer as GLBuffer).buf, off, size);
      } else if (b.type === 'texture' && 'texture' in r) {
        const unit = p.units.get(i)!;
        const t = r.texture as GLTexture;
        if (this.textureBindings.get(unit) !== t.id) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(t.target, t.tex);
          this.textureBindings.set(unit, t.id);
        }
        const sIdx = b.samplerBinding;
        if (sIdx !== undefined) {
          const sr = g.resources[sIdx];
          if (sr && 'sampler' in sr) gl.bindSampler(unit, (sr.sampler as GLSampler).s);
        }
      }
    });
  }

  vaoFor(p: GLPipeline, buffers: Array<GLBuffer | undefined>, index: GLBuffer | null): WebGLVertexArrayObject {
    const gl = this.gl;
    const owner = buffers[0] ?? index;
    const key = `${p.desc.vertexBuffers.map((v) => v.stride + ':' + v.attributes.map((a) => a.location + a.format + a.offset).join(',')).join('/')}|${buffers.map((b) => b?.id ?? 0).join(',')}|${index?.id ?? 0}`;
    const cache = owner ? owner.vaos : this.globalVaos;
    let vao = cache.get(key);
    if (vao) return vao;
    vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    p.desc.vertexBuffers.forEach((layout, slot) => {
      const b = buffers[slot];
      if (!b) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      for (const a of layout.attributes) {
        const f = vertexFmt(gl, a.format);
        gl.enableVertexAttribArray(a.location);
        if (f.integer) gl.vertexAttribIPointer(a.location, f.size, f.type, layout.stride, a.offset);
        else gl.vertexAttribPointer(a.location, f.size, f.type, f.normalized, layout.stride, a.offset);
        gl.vertexAttribDivisor(a.location, layout.step === 'instance' ? 1 : 0);
      }
    });
    if (index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index.buf);
    gl.bindVertexArray(null);
    cache.set(key, vao);
    return vao;
  }

  private readonly globalVaos = new Map<string, WebGLVertexArrayObject>();

  copyTexture(src: Texture | 'screen', dst: Texture): void {
    const gl = this.gl;
    const readFb = src === 'screen' ? null : this.framebuffer({ color: [{ target: src }] });
    const drawFb = this.framebuffer({ color: [{ target: dst }] });
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFb);
    const sw = src === 'screen' ? this.canvas.width : src.desc.width, sh = src === 'screen' ? this.canvas.height : src.desc.height;
    gl.blitFramebuffer(0, 0, sw, sh, 0, 0, dst.desc.width, dst.desc.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  beginFrame(): void {
    this.stats.drawCalls = 0;
    this.stats.triangles = 0;
    this.textureBindings.clear();
  }

  endFrame(): void {
    this.gl.bindVertexArray(null);
    this.gl.flush();
  }

  async readScreen(): Promise<Uint8Array> {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    const out = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  destroy(): void {
    for (const fb of this.fbos.values()) this.gl.deleteFramebuffer(fb);
    this.fbos.clear();
  }
}

class GLRenderPass implements RenderPass {
  private pipeline: GLPipeline | null = null;
  private vbufs: Array<GLBuffer | undefined> = [];
  private ibuf: GLBuffer | null = null;
  private ifmt = 0;
  private dirtyVao = true;

  constructor(private readonly dev: WebGL2Device) {}

  setPipeline(p: Pipeline): void {
    this.pipeline = p as GLPipeline;
    this.dev.bindPipelineState(this.pipeline);
    this.dirtyVao = true;
  }

  setBindGroup(g: BindGroup, dynamicOffsets?: number[]): void {
    this.dev.bindGroup(g as GLBindGroup, dynamicOffsets);
  }

  setVertexBuffer(slot: number, b: GpuBuffer): void {
    if (this.vbufs[slot] !== b) {
      this.vbufs[slot] = b as GLBuffer;
      this.dirtyVao = true;
    }
  }

  setIndexBuffer(b: GpuBuffer, format: 'uint16' | 'uint32'): void {
    const gl = this.dev.gl;
    if (this.ibuf !== b) {
      this.ibuf = b as GLBuffer;
      this.dirtyVao = true;
    }
    this.ifmt = format === 'uint16' ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
  }

  private prepare(): void {
    if (!this.dirtyVao || !this.pipeline) return;
    const vao = this.dev.vaoFor(this.pipeline, this.vbufs, this.ibuf);
    this.dev.gl.bindVertexArray(vao);
    this.dirtyVao = false;
  }

  private mode(): number {
    const gl = this.dev.gl;
    const t = this.pipeline?.desc.topology ?? 'triangle-list';
    return t === 'line-list' ? gl.LINES : t === 'triangle-strip' ? gl.TRIANGLE_STRIP : gl.TRIANGLES;
  }

  draw(vertexCount: number, instanceCount = 1, firstVertex = 0): void {
    this.prepare();
    const gl = this.dev.gl;
    if (instanceCount > 1) gl.drawArraysInstanced(this.mode(), firstVertex, vertexCount, instanceCount);
    else gl.drawArrays(this.mode(), firstVertex, vertexCount);
    this.dev.stats.drawCalls++;
    this.dev.stats.triangles += (vertexCount / 3) * instanceCount;
  }

  drawIndexed(indexCount: number, instanceCount = 1, firstIndex = 0): void {
    this.prepare();
    const gl = this.dev.gl;
    const bytes = this.ifmt === gl.UNSIGNED_SHORT ? 2 : 4;
    if (instanceCount > 1) gl.drawElementsInstanced(this.mode(), indexCount, this.ifmt, firstIndex * bytes, instanceCount);
    else gl.drawElements(this.mode(), indexCount, this.ifmt, firstIndex * bytes);
    this.dev.stats.drawCalls++;
    this.dev.stats.triangles += (indexCount / 3) * instanceCount;
  }

  setViewport(x: number, y: number, w: number, h: number): void {
    this.dev.gl.viewport(x, y, w, h);
  }

  setScissor(x: number, y: number, w: number, h: number): void {
    const gl = this.dev.gl;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, w, h);
  }

  end(): void {
    const gl = this.dev.gl;
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);
  }
}

function depthFunc(gl: WebGL2RenderingContext, c: string): number {
  switch (c) {
    case 'never': return gl.NEVER;
    case 'less': return gl.LESS;
    case 'lequal': return gl.LEQUAL;
    case 'equal': return gl.EQUAL;
    case 'greater': return gl.GREATER;
    case 'gequal': return gl.GEQUAL;
    default: return gl.ALWAYS;
  }
}

function applyBlend(gl: WebGL2RenderingContext, mode: BlendMode): void {
  if (mode === 'none') {
    gl.disable(gl.BLEND);
    return;
  }
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  switch (mode) {
    case 'alpha': gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break;
    case 'premultiplied': gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break;
    case 'additive': gl.blendFunc(gl.ONE, gl.ONE); break;
    case 'multiply': gl.blendFunc(gl.DST_COLOR, gl.ZERO); break;
  }
}

/** Float32 → float16 conversion for HALF_FLOAT uploads. */
function toHalf(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  for (let i = 0; i < src.length; i++) {
    f[0] = src[i]!;
    const x = u[0]!;
    const sign = (x >> 16) & 0x8000;
    const exp = ((x >> 23) & 0xff) - 127 + 15;
    let mant = x & 0x7fffff;
    if (exp <= 0) {
      out[i] = sign;
    } else if (exp >= 31) {
      out[i] = sign | 0x7c00;
    } else {
      mant >>= 13;
      out[i] = sign | (exp << 10) | mant;
    }
  }
  return out;
}
