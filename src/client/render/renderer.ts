/**
 * World renderer (classic forward path). Culls sections (frustum + cave visibility BFS),
 * draws sky, solid, cutout and translucent geometry, selection outline and overlays.
 */
import {
  Device, Pipeline, GpuBuffer, Texture, Sampler, BindGroup, PipelineDesc, VertexBufferLayout,
} from './rhi/rhi';
import { CHUNK_SHADER, SKY_SHADER, LINE_SHADER } from './shaders/chunk';
import { FRAME_UBO_SIZE } from './shaders/common';
import { AtlasData, packAtlas } from './textures/atlas';
import { quadIndices, VERTEX_SIZE } from './mesh/vertex';
import { MeshManager, SectionMesh, sectionKey } from './meshmanager';
import { Frustum } from '../../common/math/geom';
import * as M from '../../common/math/mat4';
import { pairIndex } from './mesh/mesher';
import type { ClientLevel } from '../world';
import { BIOMES } from '../../common/worldgen/biomes';
import { stateFlags, F } from '../../common/block/registry';

export const CHUNK_VERTEX_LAYOUT: VertexBufferLayout = {
  stride: VERTEX_SIZE,
  attributes: [
    { location: 0, name: 'aPos', format: 'uint16x4', offset: 0 },
    { location: 1, name: 'aUV', format: 'uint16x2', offset: 8 },
    { location: 2, name: 'aColor', format: 'unorm8x4', offset: 12 },
    { location: 3, name: 'aInfo', format: 'uint8x4', offset: 16 },
  ],
};

const LINE_LAYOUT: VertexBufferLayout = {
  stride: 16,
  attributes: [
    { location: 0, name: 'aPos', format: 'float32x3', offset: 0 },
    { location: 1, name: 'aColor', format: 'unorm8x4', offset: 12 },
  ],
};

export interface Camera {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fov: number;
  roll?: number;
  /** Third person distance (0 = first person). */
  bob?: { x: number; y: number };
}

export interface RenderSettings {
  renderDistance: number;
  fov: number;
  caveCulling: boolean;
  clouds: boolean;
  gamma: number;
}

const MAX_DRAWS = 16384;
const DRAW_STRIDE = 256;

export class WorldRenderer {
  private solidPipe!: Pipeline;
  private cutoutPipe!: Pipeline;
  private translucentPipe!: Pipeline;
  private skyPipe!: Pipeline;
  private linePipe!: Pipeline;
  private frameUbo!: GpuBuffer;
  private drawUbo!: GpuBuffer;
  private indexBuf!: GpuBuffer;
  private albedo!: Texture;
  private atlasGrid = 1;
  private material!: Texture;
  private sampler!: Sampler;
  private chunkGroups: { solid: BindGroup; cutout: BindGroup; translucent: BindGroup } | null = null;
  private skyGroup!: BindGroup;
  private lineGroup!: BindGroup;
  private lineBuf: GpuBuffer | null = null;
  private lineCount = 0;
  private readonly frameData = new Float32Array(FRAME_UBO_SIZE / 4);
  private readonly drawData = new Float32Array((MAX_DRAWS * DRAW_STRIDE) / 4);
  readonly frustum = new Frustum();
  private readonly viewProj = M.mat4();
  private readonly proj = M.mat4();
  private readonly view = M.mat4();
  private readonly invViewProj = M.mat4();
  stats = { visibleSections: 0, drawCalls: 0, triangles: 0, cullMs: 0 };
  settings: RenderSettings = { renderDistance: 8, fov: 70, caveCulling: true, clouds: true, gamma: 0.5 };
  time = 0;
  /** Selection box (block outline) in world coords, or null. */
  selection: Float32Array | null = null;
  selectionOrigin: [number, number, number] = [0, 0, 0];

  constructor(readonly device: Device, atlas: AtlasData) {
    this.createResources(atlas);
  }

  private createResources(atlas: AtlasData): void {
    const d = this.device;
    this.frameUbo = d.createBuffer('uniform', FRAME_UBO_SIZE);
    this.drawUbo = d.createBuffer('uniform', MAX_DRAWS * DRAW_STRIDE);
    this.indexBuf = d.createBuffer('index', 0, quadIndices(65536 * 2));
    this.uploadAtlas(atlas);
    this.sampler = d.createSampler({ mag: 'nearest', min: 'nearest', mip: 'linear', wrap: 'repeat', anisotropy: 1, maxLod: 4 });
    const chunkBindings: PipelineDesc['bindings'] = [
      { name: 'Frame', type: 'uniform' },
      { name: 'Draw', type: 'uniform', dynamic: true, size: 32 },
      { name: 'uAlbedo', type: 'texture', textureKind: '2d-array', samplerBinding: 3 },
      { name: 'sAlbedo', type: 'sampler' },
      { name: 'uMaterial', type: 'texture', textureKind: '2d-array', samplerBinding: 3 },
    ];
    const base = (label: string, defines: Record<string, boolean>, blend: 'none' | 'alpha', write: boolean): PipelineDesc => ({
      label, shader: CHUNK_SHADER, vertexBuffers: [CHUNK_VERTEX_LAYOUT], bindings: chunkBindings,
      cull: 'back', depth: { format: 'depth32f', write, compare: 'lequal' },
      colorTargets: [{ format: 'screen', blend }], defines,
    });
    this.solidPipe = d.createPipeline(base('chunk-solid', { CUTOUT: false, TRANSLUCENT: false }, 'none', true));
    this.cutoutPipe = d.createPipeline({ ...base('chunk-cutout', { CUTOUT: true, TRANSLUCENT: false }, 'none', true), cull: 'none' });
    this.translucentPipe = d.createPipeline({ ...base('chunk-translucent', { CUTOUT: false, TRANSLUCENT: true }, 'alpha', false), cull: 'none' });
    this.skyPipe = d.createPipeline({
      label: 'sky', shader: SKY_SHADER, vertexBuffers: [], bindings: [{ name: 'Frame', type: 'uniform' }],
      depth: { format: 'depth32f', write: false, compare: 'lequal' }, colorTargets: [{ format: 'screen' }],
    });
    this.linePipe = d.createPipeline({
      label: 'lines', shader: LINE_SHADER, vertexBuffers: [LINE_LAYOUT], bindings: [{ name: 'Frame', type: 'uniform' }],
      topology: 'line-list', depth: { format: 'depth32f', write: false, compare: 'lequal' }, colorTargets: [{ format: 'screen', blend: 'alpha' }],
    });
    this.makeGroups();
  }

  private makeGroups(): void {
    const d = this.device;
    const res = [
      { buffer: this.frameUbo }, { buffer: this.drawUbo, size: 32 }, { texture: this.albedo }, { sampler: this.sampler }, { texture: this.material },
    ];
    this.chunkGroups = {
      solid: d.createBindGroup(this.solidPipe, res),
      cutout: d.createBindGroup(this.cutoutPipe, res),
      translucent: d.createBindGroup(this.translucentPipe, res),
    };
    this.skyGroup = d.createBindGroup(this.skyPipe, [{ buffer: this.frameUbo }]);
    this.lineGroup = d.createBindGroup(this.linePipe, [{ buffer: this.frameUbo }]);
  }

  uploadAtlas(atlas: AtlasData): void {
    const d = this.device;
    this.albedo?.destroy();
    this.material?.destroy();
    const packed = packAtlas(atlas, d.info.maxTextureLayers, d.info.maxTextureSize);
    this.atlasGrid = packed.grid;
    const desc = { kind: '2d-array' as const, format: 'rgba8' as const, width: packed.pageSize, height: packed.pageSize, depth: packed.pages, mips: packed.mips };
    this.albedo = d.createTexture({ ...desc, label: 'albedo' });
    this.material = d.createTexture({ ...desc, label: 'material' });
    for (let m = 0; m < packed.mips; m++) {
      d.writeTexture(this.albedo, packed.albedo[m]!, { mip: m, z: 0, depth: packed.pages });
      d.writeTexture(this.material, packed.material[m]!, { mip: m, z: 0, depth: packed.pages });
    }
    if (this.chunkGroups) this.makeGroups();
  }

  // ------------------------------------------------------------------------------------------
  // Frame setup
  // ------------------------------------------------------------------------------------------

  private setupCamera(cam: Camera, width: number, height: number): void {
    const far = Math.max(256, (this.settings.renderDistance + 2) * 16 * 1.5);
    M.perspective(this.proj, (cam.fov * Math.PI) / 180, width / height, 0.05, far, this.device.clipZeroToOne);
    M.identity(this.view);
    if (cam.roll) M.rotateZ(this.view, this.view, cam.roll);
    M.rotateX(this.view, this.view, (cam.pitch * Math.PI) / 180);
    M.rotateY(this.view, this.view, ((cam.yaw + 180) * Math.PI) / 180);
    M.multiply(this.viewProj, this.proj, this.view);
    M.invert(this.invViewProj, this.viewProj);
    this.frustum.setFromMatrix(this.viewProj, this.device.clipZeroToOne);
  }

  private writeFrameUniforms(cam: Camera, level: ClientLevel, partial: number): void {
    const f = this.frameData;
    f.set(this.viewProj, 0);
    f.set(this.invViewProj, 16);
    f.set(this.view, 32);
    f[48] = cam.x; f[49] = cam.y; f[50] = cam.z; f[51] = this.time;
    const daylight = level.daylight(partial);
    const biome = BIOMES[level.getBiome(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z))] ?? BIOMES[1]!;
    const sky = hexToRgb(biome.sky);
    const underwater = (stateFlags[level.getBlockState(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z))]! & F.WATER) !== 0;
    let zen: [number, number, number], hor: [number, number, number];
    const rain = level.rain;
    if (level.dim.id === 'overworld') {
      zen = [sky[0] * daylight, sky[1] * daylight, sky[2] * daylight];
      const angle = level.celestialAngle(partial);
      const sunset = Math.max(0, 1 - Math.abs(Math.cos(angle * Math.PI * 2)) * 3);
      hor = [
        (0.75 * daylight + 0.02) * (1 - sunset) + sunset * 0.85 * Math.max(daylight, 0.3),
        (0.85 * daylight + 0.03) * (1 - sunset) + sunset * 0.45 * Math.max(daylight, 0.3),
        (1.0 * daylight + 0.06) * (1 - sunset) + sunset * 0.35 * Math.max(daylight, 0.3),
      ];
      const gray = (c: [number, number, number]) => {
        const l = (c[0] + c[1] + c[2]) / 3 * 0.6;
        return [c[0] + (l - c[0]) * rain * 0.8, c[1] + (l - c[1]) * rain * 0.8, c[2] + (l - c[2]) * rain * 0.8] as [number, number, number];
      };
      zen = gray(zen);
      hor = gray(hor);
    } else {
      const fc = hexToRgb(biome.fog);
      zen = fc;
      hor = fc;
    }
    let fogCol = hor;
    const rd = this.settings.renderDistance * 16;
    let fogStart = rd * 0.75, fogEnd = rd;
    if (level.dim.id === 'inferno') { fogStart = 10; fogEnd = Math.min(96, rd); }
    if (underwater) {
      const w = hexToRgb(biome.water);
      fogCol = [w[0] * 0.2 * (0.3 + daylight), w[1] * 0.3 * (0.3 + daylight), w[2] * 0.5 * (0.3 + daylight)];
    }
    f[52] = fogCol[0]; f[53] = fogCol[1]; f[54] = fogCol[2]; f[55] = fogStart;
    f[56] = fogEnd; f[57] = underwater ? 1 : 0; f[58] = daylight; f[59] = level.dim.id === 'overworld' ? 0 : level.dim.id === 'inferno' ? 0.1 : 0.05;
    const a = level.celestialAngle(partial) * Math.PI * 2;
    // Sun rises in the east (+X) and sets in the west
    f[60] = -Math.sin(a); f[61] = Math.cos(a); f[62] = 0.15; f[63] = level.moonPhase();
    const starB = Math.max(0, 1 - daylight * 2.5) * (1 - rain);
    f[64] = zen[0]; f[65] = zen[1]; f[66] = zen[2]; f[67] = starB;
    f[68] = hor[0]; f[69] = hor[1]; f[70] = hor[2]; f[71] = rain;
    f[72] = 1.0; f[73] = 0.86; f[74] = 0.62; f[75] = this.settings.gamma;
    f[76] = Math.floor(this.time * 10); f[77] = level.dim.id === 'overworld' ? 0 : level.dim.id === 'inferno' ? 1 : 2; f[78] = level.lightningFlash; f[79] = 0;
    f[80] = this.atlasGrid; f[81] = this.atlasGrid * this.atlasGrid; f[82] = 0; f[83] = 0;
    this.device.writeBuffer(this.frameUbo, 0, f);
  }

  // ------------------------------------------------------------------------------------------
  // Culling
  // ------------------------------------------------------------------------------------------

  private visible: SectionMesh[] = [];

  private cull(cam: Camera, level: ClientLevel, meshes: MeshManager): void {
    const t0 = performance.now();
    this.visible.length = 0;
    const rd = this.settings.renderDistance;
    const pcx = Math.floor(cam.x) >> 4, pcy = Math.floor(cam.y) >> 4, pcz = Math.floor(cam.z) >> 4;
    const minS = level.dim.minY >> 4, maxS = (level.dim.minY + level.dim.height) >> 4;
    const camInOpaque = (stateFlags[level.getBlockState(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z))]! & F.OPAQUE_CUBE) !== 0;
    const useCave = this.settings.caveCulling && !camInOpaque;
    const inFrustum = (cx: number, sy: number, cz: number) => {
      const x0 = cx * 16 - cam.x, y0 = sy * 16 - cam.y, z0 = cz * 16 - cam.z;
      return this.frustum.testBox(x0, y0, z0, x0 + 16, y0 + 16, z0 + 16);
    };
    const visited = new Set<number>();
    const DX = [0, 0, 0, 0, -1, 1], DY = [-1, 1, 0, 0, 0, 0], DZ = [0, 0, -1, 1, 0, 0];
    const qcx: number[] = [], qsy: number[] = [], qcz: number[] = [], qfrom: number[] = [], qdirs: number[] = [];
    const startSy = Math.max(minS, Math.min(maxS - 1, pcy));
    qcx.push(pcx); qsy.push(startSy); qcz.push(pcz); qfrom.push(-1); qdirs.push(0);
    visited.add(sectionKey(pcx, startSy, pcz));
    let head = 0;
    while (head < qcx.length) {
      const cx = qcx[head]!, sy = qsy[head]!, cz = qcz[head]!, from = qfrom[head]!, dirs = qdirs[head]!;
      head++;
      const mesh = meshes.get(cx, sy, cz);
      if (mesh && !mesh.empty) this.visible.push(mesh);
      const vis = mesh ? mesh.visibility : 0x7fff;
      for (let f = 0; f < 6; f++) {
        if (useCave && (dirs & (1 << (f ^ 1)))) continue;
        const nx = cx + DX[f]!, ny = sy + DY[f]!, nz = cz + DZ[f]!;
        if (ny < minS || ny >= maxS) continue;
        if (Math.abs(nx - pcx) > rd || Math.abs(nz - pcz) > rd) continue;
        const k = sectionKey(nx, ny, nz);
        if (visited.has(k)) continue;
        if (useCave && from >= 0 && !(vis & (1 << pairIndex(from, f)))) continue;
        if (!level.hasChunk(nx, nz)) continue;
        if (!inFrustum(nx, ny, nz)) continue;
        visited.add(k);
        qcx.push(nx); qsy.push(ny); qcz.push(nz); qfrom.push(f ^ 1); qdirs.push(dirs | (1 << f));
      }
    }
    this.stats.visibleSections = this.visible.length;
    this.stats.cullMs = performance.now() - t0;
  }

  // ------------------------------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------------------------------

  render(cam: Camera, level: ClientLevel, meshes: MeshManager, partial: number, now: number): void {
    const d = this.device;
    const w = d.canvas.width, h = d.canvas.height;
    this.setupCamera(cam, w, h);
    this.writeFrameUniforms(cam, level, partial);
    this.cull(cam, level, meshes);
    // Draw data: section origins relative to camera
    const vis = this.visible;
    const n = Math.min(vis.length, MAX_DRAWS);
    const stride = DRAW_STRIDE / 4;
    for (let i = 0; i < n; i++) {
      const m = vis[i]!;
      const o = i * stride;
      this.drawData[o] = m.cx * 16 - cam.x;
      this.drawData[o + 1] = m.sy * 16 - cam.y;
      this.drawData[o + 2] = m.cz * 16 - cam.z;
      this.drawData[o + 3] = 1;
      this.drawData[o + 4] = Math.min(1, (now - m.shownAt) / 400);
    }
    if (n > 0) d.writeBuffer(this.drawUbo, 0, this.drawData, 0, n * DRAW_STRIDE);
    this.updateSelection(cam);

    const fog = this.frameData;
    const clear: [number, number, number, number] = [fog[52]!, fog[53]!, fog[54]!, 1];
    const pass = d.beginPass({ label: 'world', color: [{ target: 'screen', clear }] });
    // Sky
    pass.setPipeline(this.skyPipe);
    pass.setBindGroup(this.skyGroup);
    pass.draw(3);
    const groups = this.chunkGroups!;
    // Solid (front to back: visible list is already BFS-ordered by distance)
    pass.setPipeline(this.solidPipe);
    pass.setIndexBuffer(this.indexBuf, 'uint32');
    for (let i = 0; i < n; i++) {
      const m = vis[i]!;
      if (!m.solid) continue;
      pass.setBindGroup(groups.solid, [i * DRAW_STRIDE]);
      pass.setVertexBuffer(0, m.solid);
      pass.drawIndexed((m.solidCount / 4) * 6);
    }
    pass.setPipeline(this.cutoutPipe);
    pass.setIndexBuffer(this.indexBuf, 'uint32');
    for (let i = 0; i < n; i++) {
      const m = vis[i]!;
      if (!m.cutout) continue;
      pass.setBindGroup(groups.cutout, [i * DRAW_STRIDE]);
      pass.setVertexBuffer(0, m.cutout);
      pass.drawIndexed((m.cutoutCount / 4) * 6);
    }
    // Selection outline
    if (this.lineBuf && this.lineCount > 0) {
      pass.setPipeline(this.linePipe);
      pass.setBindGroup(this.lineGroup);
      pass.setVertexBuffer(0, this.lineBuf);
      pass.draw(this.lineCount);
    }
    // Translucent back to front
    pass.setPipeline(this.translucentPipe);
    pass.setIndexBuffer(this.indexBuf, 'uint32');
    for (let i = n - 1; i >= 0; i--) {
      const m = vis[i]!;
      if (!m.translucent) continue;
      pass.setBindGroup(groups.translucent, [i * DRAW_STRIDE]);
      pass.setVertexBuffer(0, m.translucent);
      pass.drawIndexed((m.translucentCount / 4) * 6);
    }
    pass.end();
    this.stats.drawCalls = d.stats.drawCalls;
    this.stats.triangles = d.stats.triangles;
  }

  /** Build line geometry for the selection outline (camera-relative). */
  private updateSelection(cam: Camera): void {
    const sel = this.selection;
    if (!sel || sel.length === 0) {
      this.lineCount = 0;
      return;
    }
    const [ox, oy, oz] = this.selectionOrigin;
    const lines: number[] = [];
    const e = 0.002;
    for (let i = 0; i < sel.length; i += 6) {
      const x0 = ox + sel[i]! - e - cam.x, y0 = oy + sel[i + 1]! - e - cam.y, z0 = oz + sel[i + 2]! - e - cam.z;
      const x1 = ox + sel[i + 3]! + e - cam.x, y1 = oy + sel[i + 4]! + e - cam.y, z1 = oz + sel[i + 5]! + e - cam.z;
      const c: Array<[number, number, number]> = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      for (const [a, b] of edges) lines.push(...c[a!]!, ...c[b!]!);
    }
    const count = lines.length / 3;
    const data = new ArrayBuffer(count * 16);
    const fv = new Float32Array(data);
    const bv = new Uint8Array(data);
    for (let i = 0; i < count; i++) {
      fv[i * 4] = lines[i * 3]!; fv[i * 4 + 1] = lines[i * 3 + 1]!; fv[i * 4 + 2] = lines[i * 3 + 2]!;
      bv[i * 16 + 12] = 0; bv[i * 16 + 13] = 0; bv[i * 16 + 14] = 0; bv[i * 16 + 15] = 160;
    }
    if (!this.lineBuf || this.lineBuf.size < data.byteLength) {
      this.lineBuf?.destroy();
      this.lineBuf = this.device.createBuffer('vertex', Math.max(data.byteLength, 4096));
    }
    this.device.writeBuffer(this.lineBuf, 0, new Uint8Array(data));
    this.lineCount = count;
  }

  get matrices(): { viewProj: Float32Array; proj: Float32Array; view: Float32Array } {
    return { viewProj: this.viewProj, proj: this.proj, view: this.view };
  }
}

function hexToRgb(h: number): [number, number, number] {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}
