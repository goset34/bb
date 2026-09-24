/**
 * Entity render layer: builds camera-relative geometry for every visible client entity each
 * frame (plus the local player in third person and the first-person hand / held item) and draws
 * it inside the world pass.
 */
import type { Device, Pipeline, GpuBuffer, BindGroup, RenderPass, VertexBufferLayout } from '../rhi/rhi';
import { ENTITY_SHADER, ENTITY_VERTEX_SIZE } from '../shaders/entity';
import { EntityMesh, TEX_SKIN } from './mesh';
import { EntityTextures, ENTITY_TEX } from './textures';
import { ItemModels, emitItem } from './itemmodel';
import { ENTITY_RENDERERS, RenderContext, renderHumanoid } from './renderers';
import { createPlayerModel } from './player';
import type { WorldRenderer, Camera, WorldLayer } from '../renderer';
import type { ClientLevel } from '../../world';
import { ClientEntities, ClientEntity } from '../../entities';
import type { LocalPlayer } from '../../player';
import type { AtlasData } from '../textures/atlas';
import type { ParticleEngine } from '../particles/particles';
import { getOutlineShape } from '../../../common/block/registry';
import * as M from '../../../common/math/mat4';
import { lookVector } from '../../../common/math/geom';
import { getItem } from '../../../common/item/items';

const LAYOUT: VertexBufferLayout = {
  stride: ENTITY_VERTEX_SIZE,
  attributes: [
    { location: 0, name: 'aPos', format: 'float32x3', offset: 0 },
    { location: 1, name: 'aUV', format: 'float32x2', offset: 12 },
    { location: 2, name: 'aTex', format: 'uint16x2', offset: 20 },
    { location: 3, name: 'aColor', format: 'unorm8x4', offset: 24 },
    { location: 4, name: 'aLight', format: 'unorm8x4', offset: 28 },
  ],
};

const DRAW_SLOT = 256;

export class EntityRenderer implements WorldLayer {
  private readonly pipe: Pipeline;
  private readonly drawUbo: GpuBuffer;
  private group: BindGroup | null = null;
  private groupKey = '';
  private vbuf: GpuBuffer | null = null;
  private hbuf: GpuBuffer | null = null;
  private readonly mesh = new EntityMesh();
  private readonly hand = new EntityMesh(256);
  readonly textures: EntityTextures;
  readonly items: ItemModels;
  private worldQuads = 0;
  private handQuads = 0;
  private readonly handProj = M.mat4();
  private readonly drawData = new Float32Array((DRAW_SLOT * 2) / 4);
  readonly labels: RenderContext['labels'] = [];
  private readonly handModel = createPlayerModel();
  showHand = true;
  localSkin = 'player/';
  particles: ParticleEngine | null = null;
  /** Block break progress by breaker id: position and stage 0..9. */
  readonly breaking = new Map<number, { x: number; y: number; z: number; stage: number }>();
  private readonly destroyLayers: number[];

  constructor(private readonly device: Device, private readonly world: WorldRenderer, atlas: AtlasData, private readonly level: ClientLevel, private readonly entities: ClientEntities, private readonly player: LocalPlayer) {
    this.textures = new EntityTextures(device);
    this.items = new ItemModels(atlas);
    this.destroyLayers = Array.from({ length: 10 }, (_, i) => (atlas.index[`destroy_stage_${i}`] ?? 0) & 0xfff);
    this.drawUbo = device.createBuffer('uniform', DRAW_SLOT * 2);
    this.pipe = device.createPipeline({
      label: 'entities', shader: ENTITY_SHADER, vertexBuffers: [LAYOUT],
      bindings: [
        { name: 'Frame', type: 'uniform' },
        { name: 'EntityDraw', type: 'uniform', dynamic: true, size: 80 },
        { name: 'uAlbedo', type: 'texture', textureKind: '2d-array', samplerBinding: 3 },
        { name: 'sAlbedo', type: 'sampler' },
        { name: 'uMaterial', type: 'texture', textureKind: '2d-array', samplerBinding: 3 },
        { name: 'uSkins', type: 'texture', textureKind: '2d-array', samplerBinding: 3 },
      ],
      cull: 'back', depth: { format: 'depth32f', write: true, compare: 'lequal' }, colorTargets: [{ format: 'screen', blend: 'none' }],
    });
  }

  private bindGroup(): BindGroup {
    const r = this.world.resources;
    const key = `${r.generation}:${this.textures.generation}`;
    if (!this.group || key !== this.groupKey) {
      this.group = this.device.createBindGroup(this.pipe, [
        { buffer: r.frameUbo }, { buffer: this.drawUbo, size: 80 }, { texture: r.albedo }, { sampler: r.sampler }, { texture: r.material }, { texture: this.textures.texture },
      ]);
      this.groupKey = key;
    }
    return this.group;
  }

  /** Interpolated world position of an entity id (including the local player). */
  private positionOf(id: number, partial: number): [number, number, number] | null {
    if (id === this.player.entity.id) {
      const t = this.player.entity.transform;
      return [t.px + (t.x - t.px) * partial, t.py + (t.y - t.py) * partial, t.pz + (t.z - t.pz) * partial];
    }
    const e = this.entities.get(id);
    return e ? ClientEntities.pos(e, partial) : null;
  }

  prepare(cam: Camera, partial: number): void {
    const mesh = this.mesh;
    mesh.reset();
    this.labels.length = 0;
    const [fx, fy, fz] = lookVector(cam.yaw, cam.pitch);
    let rx = -fz, rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    const ctx: RenderContext = {
      mesh, textures: this.textures, items: this.items, level: this.level, entities: this.entities, partial,
      cam: [cam.x, cam.y, cam.z], right: [rx, 0, rz], up: [ux, uy, uz],
      positionOf: (id) => this.positionOf(id, partial), labels: this.labels,
    };
    const maxDist = (this.world.settings.renderDistance * 16) ** 2;
    const frustum = this.world.frustum;
    for (const e of this.entities.byId.values()) {
      const fn = ENTITY_RENDERERS.get(e.type);
      if (!fn) continue;
      const [x, y, z] = ClientEntities.pos(e, partial);
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
      if (dx * dx + dz * dz > maxDist) continue;
      const hw = e.physics.width / 2 + 0.5, h = e.physics.height + 0.5;
      if (!frustum.testBox(dx - hw, dy - 0.5, dz - hw, dx + hw, dy + h, dz + hw)) continue;
      mesh.hurt = 0;
      fn(e, ctx, dx, dy, dz);
    }
    // Local player in third person
    if (this.player.thirdPerson !== 0) {
      const lp = this.localEntity();
      const [x, y, z] = [lp.transform.px + (lp.transform.x - lp.transform.px) * partial, lp.transform.py + (lp.transform.y - lp.transform.py) * partial, lp.transform.pz + (lp.transform.z - lp.transform.pz) * partial];
      renderHumanoid(ctx, lp, x - cam.x, y - cam.y, z - cam.z, this.localSkin);
    }
    this.particles?.render(mesh, this.textures, ctx.cam, ctx.right, ctx.up, partial);
    this.renderCracks(cam);
    this.worldQuads = mesh.quads;
    if (mesh.count > 0) this.vbuf = this.upload(this.vbuf, mesh.bytes);
    // First-person hand
    this.hand.reset();
    this.handQuads = 0;
    if (this.player.thirdPerson === 0 && this.showHand && this.player.gameMode !== 'spectator') {
      this.buildHand(partial);
      this.handQuads = this.hand.quads;
      if (this.hand.count > 0) this.hbuf = this.upload(this.hbuf, this.hand.bytes);
    }
    // Draw uniforms: slot 0 world, slot 1 hand
    const d = this.drawData;
    d.set(this.world.matrices.viewProj, 0);
    d[16] = 0;
    const aspect = this.device.canvas.width / Math.max(1, this.device.canvas.height);
    M.perspective(this.handProj, (70 * Math.PI) / 180, aspect, 0.05, 10, this.device.clipZeroToOne);
    d.set(this.handProj, DRAW_SLOT / 4);
    d[DRAW_SLOT / 4 + 16] = 1;
    this.device.writeBuffer(this.drawUbo, 0, d);
  }

  /** Destroy-stage overlays on blocks being mined (local player and others). */
  private renderCracks(cam: Camera): void {
    const mesh = this.mesh;
    const all = [...this.breaking.values()];
    const d = this.player.digging;
    if (d) all.push({ x: d.x, y: d.y, z: d.z, stage: Math.min(9, Math.floor(d.progress * 10)) });
    for (const b of all) {
      if (b.stage < 0) continue;
      const shape = getOutlineShape(this.level.getBlockState(b.x, b.y, b.z));
      if (!shape.length) continue;
      const l = this.level.getLight(b.x, b.y, b.z);
      mesh.sky = (l >> 4) / 15;
      mesh.block = (l & 15) / 15;
      mesh.hurt = 0;
      mesh.layer = this.destroyLayers[b.stage]!;
      mesh.flags = 0;
      mesh.setColor(0xffffff);
      const e = 0.003;
      for (let i = 0; i < shape.length; i += 6) {
        const x0 = shape[i]! - e, y0 = shape[i + 1]! - e, z0 = shape[i + 2]! - e, x1 = shape[i + 3]! + e, y1 = shape[i + 4]! + e, z1 = shape[i + 5]! + e;
        mesh.push();
        mesh.translate(b.x - cam.x, b.y - cam.y, b.z - cam.z);
        const faces: Array<[number[], number[], number, number, number]> = [
          [[x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0], [x0, z0, x0, z1, x1, z1, x1, z0], 0, 1, 0],
          [[x0, y0, z1, x0, y0, z0, x1, y0, z0, x1, y0, z1], [x0, 1 - z1, x0, 1 - z0, x1, 1 - z0, x1, 1 - z1], 0, -1, 0],
          [[x0, y1, z1, x0, y0, z1, x1, y0, z1, x1, y1, z1], [x0, 1 - y1, x0, 1 - y0, x1, 1 - y0, x1, 1 - y1], 0, 0, 1],
          [[x1, y1, z0, x1, y0, z0, x0, y0, z0, x0, y1, z0], [1 - x1, 1 - y1, 1 - x1, 1 - y0, 1 - x0, 1 - y0, 1 - x0, 1 - y1], 0, 0, -1],
          [[x0, y1, z0, x0, y0, z0, x0, y0, z1, x0, y1, z1], [z0, 1 - y1, z0, 1 - y0, z1, 1 - y0, z1, 1 - y1], -1, 0, 0],
          [[x1, y1, z1, x1, y0, z1, x1, y0, z0, x1, y1, z0], [1 - z1, 1 - y1, 1 - z1, 1 - y0, 1 - z0, 1 - y0, 1 - z0, 1 - y1], 1, 0, 0],
        ];
        for (const [p, uv, nx, ny, nz] of faces) mesh.quad(p, uv, nx, ny, nz, 1);
        mesh.pop();
      }
    }
  }

  /** A client entity view of the local player (for third-person rendering). */
  private readonly localView: ClientEntity = {
    id: -1, type: 'player', removed: false,
    transform: undefined as never, physics: undefined as never,
    interp: {
      tx: 0, ty: 0, tz: 0, tyaw: 0, tpitch: 0, theadYaw: 0, steps: 0, limbSwing: 0, limbSwingAmount: 0, prevLimbSwingAmount: 0,
      swingTime: 0, swinging: false, swingOffhand: false, hurtTime: 0, deathTime: 0, age: 0, equipment: [], effects: [], pickup: null,
    },
    data: {},
  };

  private localEntity(): ClientEntity {
    const v = this.localView;
    const pe = this.player.entity;
    v.transform = pe.transform;
    v.physics = pe.physics;
    const a = this.player.anim;
    Object.assign(v.interp, a);
    const inv = this.player.inventory;
    v.interp.equipment = [inv.mainHand, inv.offHand, inv.get(36), inv.get(37), inv.get(38), inv.get(39)];
    v.data['sneaking'] = pe.input.sneaking && !pe.input.flying;
    v.data['using'] = this.player.hand.using;
    v.data['swimming'] = pe.input.swimming;
    v.data['sleeping'] = this.player.sleeping !== null;
    v.data['bedFacing'] = this.player.sleeping ?? 3;
    return v;
  }

  /** First-person arm or held item in view space (x right, y up, -z forward). */
  private buildHand(partial: number): void {
    const mesh = this.hand;
    const hs = this.player.hand;
    const eye = this.player.eyePos(partial);
    const l = this.level.getLight(Math.floor(eye[0]), Math.floor(eye[1]), Math.floor(eye[2]));
    mesh.sky = (l >> 4) / 15;
    mesh.block = (l & 15) / 15;
    mesh.hurt = 0;
    const equip = hs.prevEquip + (hs.equip - hs.prevEquip) * partial;
    const swing = hs.prevSwing + (hs.swing - hs.prevSwing) * partial;
    const stack = hs.shown;
    const sq = Math.sqrt(swing);
    // Sway with view bobbing
    const b = this.player.prevBob + (this.player.bob - this.player.prevBob) * partial;
    const bobX = Math.sin(b * Math.PI) * 0.03, bobY = -Math.abs(Math.cos(b * Math.PI)) * 0.04;
    const D = Math.PI / 180;
    const swingArc = Math.sin(sq * Math.PI);
    mesh.push();
    mesh.translate(bobX, bobY - (1 - equip) * 0.6, 0);
    if (stack.isEmpty()) {
      // Bare arm reaching forward from the lower right; the swing punches it forward
      mesh.translate(0.5 - swingArc * 0.25, -0.32 + Math.sin(sq * Math.PI * 2) * 0.12, -0.42 - Math.sin(swing * Math.PI) * 0.3);
      mesh.rotate(1, (4 + swingArc * 40) * D);
      mesh.rotate(0, (84 - swingArc * 20) * D);
      mesh.rotate(2, (-8 - Math.sin(swing * swing * Math.PI) * 15) * D);
      mesh.scale(0.85);
      mesh.layer = this.textures.layer(this.localSkin);
      mesh.flags = TEX_SKIN;
      mesh.setColor(0xffffff);
      const arm = this.handModel.rightArm;
      arm.reset();
      arm.x = 1; arm.y = 0; arm.z = 0;
      arm.render(mesh, ENTITY_TEX);
    } else {
      const model = this.items.get(stack.id);
      if (model) {
        const def = getItem(stack.id);
        const eating = hs.using && (def?.food || def?.useAnim === 'drink');
        // Swing arc
        mesh.translate(-0.35 * swingArc, 0.18 * Math.sin(sq * Math.PI * 2), -0.2 * Math.sin(swing * Math.PI));
        if (model.kind === 'block' && model.cube) {
          mesh.translate(0.5, -0.42, -0.86);
          if (eating) mesh.translate(-0.3, 0.12, 0.1);
          mesh.rotate(0, -swingArc * 60 * D);
          mesh.rotate(1, 45 * D);
          mesh.rotate(0, 12 * D);
          mesh.scale(0.24);
        } else {
          mesh.translate(0.44, -0.31, -0.66);
          if (eating) {
            const k = Math.min(1, hs.useTicks / 6);
            mesh.translate(-0.36 * k, 0.1 * k + Math.abs(Math.cos(((hs.useTicks + partial) / 4) * Math.PI)) * 0.04 * k, 0.12 * k);
            mesh.rotate(1, -50 * k * D);
          }
          mesh.rotate(0, -swingArc * 70 * D);
          mesh.rotate(2, -Math.sin(swing * swing * Math.PI) * 20 * D);
          // Mirror the sprite so tools point up-left from the hand, turned slightly sideways
          mesh.rotate(1, (180 - 28) * D);
          mesh.rotate(2, (def?.tool ? 8 : 0) * D);
          mesh.scale(def?.tool ? 0.38 : 0.32);
        }
        emitItem(mesh, model, stack);
      }
    }
    mesh.pop();
  }

  private upload(buf: GpuBuffer | null, data: Uint8Array): GpuBuffer {
    if (!buf || buf.size < data.byteLength) {
      buf?.destroy();
      buf = this.device.createBuffer('vertex', Math.max(65536, data.byteLength * 2), undefined, 'entity-vertices');
    }
    this.device.writeBuffer(buf, 0, data);
    return buf;
  }

  opaque(pass: RenderPass): void {
    if (this.worldQuads === 0 || !this.vbuf) return;
    pass.setPipeline(this.pipe);
    pass.setBindGroup(this.bindGroup(), [0]);
    pass.setIndexBuffer(this.world.resources.indexBuffer, 'uint32');
    pass.setVertexBuffer(0, this.vbuf);
    pass.drawIndexed(this.worldQuads * 6);
  }

  overlay(pass: RenderPass): void {
    if (this.handQuads === 0 || !this.hbuf) return;
    pass.setPipeline(this.pipe);
    pass.setBindGroup(this.bindGroup(), [DRAW_SLOT]);
    pass.setIndexBuffer(this.world.resources.indexBuffer, 'uint32');
    pass.setVertexBuffer(0, this.hbuf);
    pass.drawIndexed(this.handQuads * 6);
  }

  destroy(): void {
    this.vbuf?.destroy();
    this.hbuf?.destroy();
    this.drawUbo.destroy();
    this.textures.destroy();
  }
}

