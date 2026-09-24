/**
 * Client-side visual effects driven by packets and local state: level events (block break,
 * bone meal, wax, landing dust…), particle packets, entity events (crits, sweeps, totems,
 * item breaks, deaths), eating debris, mining debris and status-effect swirls.
 */
import type { Packet } from '../common/net/protocol';
import type { ClientLevel } from './world';
import type { ClientEntities, ClientEntity } from './entities';
import type { LocalPlayer } from './player';
import { ParticleEngine } from './render/particles/particles';
import type { EntityRenderer } from './render/entity/entityrenderer';
import type { AtlasData } from './render/textures/atlas';
import { effectsColor } from '../common/effect/effects';
import { getItem } from '../common/item/items';
import { ItemStack } from '../common/item/stack';
import { Random } from '../common/math/random';

export class ClientFx {
  readonly particles: ParticleEngine;
  private readonly rng = new Random(99);
  /** Totem overlay animation (local player). */
  totemTicks = 0;
  totemItem: ItemStack | null = null;

  constructor(private readonly level: ClientLevel, private readonly entities: ClientEntities, private readonly player: LocalPlayer, private readonly atlas: AtlasData, renderer: EntityRenderer) {
    this.particles = new ParticleEngine(level, atlas);
    renderer.particles = this.particles;
    entities.onEvent((e, id, ev, data) => this.entityEvent(e, id, ev, data));
  }

  private itemLayer(id: string): number {
    const sprite = this.atlas.index[`item/${id}`];
    if (sprite !== undefined) return sprite & 0xfff;
    const block = getItem(id)?.block ?? id;
    return (this.atlas.index[block] ?? this.atlas.index[`${block}_side`] ?? this.atlas.index[`${block}_top`] ?? 0) & 0xfff;
  }

  handle(p: Packet, breaking: Map<number, { x: number; y: number; z: number; stage: number }>): boolean {
    switch (p.type) {
      case 'particles':
        this.particles.spawn(p['particle'] as string, p['x'] as number, p['y'] as number, p['z'] as number, p['dx'] as number, p['dy'] as number, p['dz'] as number, p['speed'] as number, p['count'] as number, p['data'] as number);
        return true;
      case 'levelEvent':
        this.levelEvent(p['event'] as number, p['x'] as number, p['y'] as number, p['z'] as number, p['data'] as number);
        return true;
      case 'blockBreakProgress': {
        const stage = p['stage'] as number;
        const id = p['breaker'] as number;
        if (stage < 0 || stage > 9) breaking.delete(id);
        else breaking.set(id, { x: p['x'] as number, y: p['y'] as number, z: p['z'] as number, stage });
        return true;
      }
    }
    return false;
  }

  levelEvent(ev: number, x: number, y: number, z: number, data: number): void {
    const P = this.particles;
    switch (ev) {
      case 2001: P.blockBreak(x, y, z, data); break;
      case 2006: P.landing(x + 0.5, y, z + 0.5, data, 14); break;
      case 1505: case 2005:
        for (let i = 0; i < 15; i++) P.spawn('happy_villager', x + this.rng.nextFloat(), y + this.rng.nextFloat() * 1.2, z + this.rng.nextFloat(), 0, 0, 0, 0.02, 0);
        break;
      case 3003: case 3004: case 3005: {
        const type = ev === 3003 ? 'wax_on' : ev === 3004 ? 'wax_off' : 'scrape';
        for (let i = 0; i < 12; i++) {
          const f = this.rng.nextInt(6);
          const n = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][f]!;
          P.spawn(type, x + 0.5 + n[0]! * 0.55 + (n[0] ? 0 : this.rng.nextFloat() - 0.5), y + 0.5 + n[1]! * 0.55 + (n[1] ? 0 : this.rng.nextFloat() - 0.5), z + 0.5 + n[2]! * 0.55 + (n[2] ? 0 : this.rng.nextFloat() - 0.5), 0, 0, 0, 0.01, 0);
        }
        break;
      }
      case 1009: case 1501: case 2000:
        for (let i = 0; i < 8; i++) P.spawn(ev === 1501 ? 'large_smoke' : 'smoke', x + this.rng.nextFloat(), y + 0.5 + this.rng.nextFloat() * 0.5, z + this.rng.nextFloat(), 0, 0, 0, 0.01, 0);
        break;
    }
  }

  private entityEvent(e: ClientEntity | null, id: number, ev: string, data: number): void {
    const P = this.particles;
    const local = id === this.player.entity.id;
    const t = local ? this.player.entity.transform : e?.transform;
    if (!t) return;
    const h = local ? this.player.entity.physics.height : e!.physics.height;
    switch (ev) {
      case 'crit': case 'magic_crit':
        for (let i = 0; i < 16; i++) P.spawn(ev === 'crit' ? 'crit' : 'enchanted_hit', t.x, t.y + h * 0.5, t.z, 0.3, h * 0.25, 0.3, 0.3, 1);
        break;
      case 'sweep': {
        const yaw = (t.yaw * Math.PI) / 180;
        P.spawn('sweep_attack', t.x - Math.sin(yaw), t.y + h * 0.5, t.z + Math.cos(yaw), 0, 0, 0, 0, 0);
        break;
      }
      case 'totem':
        for (let i = 0; i < 60; i++) P.spawn('totem_of_undying', t.x, t.y + h * 0.5, t.z, 0.4, 0.6, 0.4, 0.4, 1);
        if (local) {
          this.totemTicks = 40;
          this.totemItem = new ItemStack('totem_of_undying', 1);
        }
        break;
      case 'item_break': {
        let stack: ItemStack | undefined;
        if (local) stack = this.player.inventory.get(data);
        else stack = e?.interp.equipment[data];
        if (stack && !stack.isEmpty()) P.itemDebris(t.x, t.y + h * 0.8, t.z, this.itemLayer(stack.id), 5, 0.15);
        break;
      }
      case 'death':
        if (e && !e.player) {
          // Poof when the corpse disappears (reference ~20 ticks)
          setTimeout(() => { for (let i = 0; i < 20; i++) P.spawn('poof', t.x, t.y + h * 0.5, t.z, 0.3, h * 0.3, 0.3, 0.02, 1); }, 1000);
        }
        break;
    }
  }

  /** Per client tick: particles, eating debris, mining debris, effect swirls. */
  tick(): void {
    this.particles.tick();
    if (this.totemTicks > 0) this.totemTicks--;
    const pl = this.player;
    const pt = pl.entity.transform;
    // Local eating / drinking
    const hs = pl.hand;
    if (hs.using && hs.useTicks > 6 && hs.useTicks % 4 === 0) {
      const st = pl.inventory.mainHand;
      if (getItem(st.id)?.food) {
        const yaw = (pt.yaw * Math.PI) / 180;
        eatDebris(this.particles, pt.x - Math.sin(yaw) * 0.4, pt.y + pl.entity.physics.eyeHeight - 0.15, pt.z + Math.cos(yaw) * 0.4, this.itemLayer(st.id));
      }
    }
    // Mining debris on the targeted face
    const d = pl.digging;
    if (d && this.level.gameTime % 2 === 0) this.particles.blockHit(d.x, d.y, d.z, d.face, this.level.getBlockState(d.x, d.y, d.z));
    // Other players eating, and status effect swirls
    for (const e of this.entities.byId.values()) {
      const t = e.transform;
      if (e.data['using'] === true && e.interp.equipment[0] && !e.interp.equipment[0].isEmpty() && this.level.gameTime % 4 === 0 && getItem(e.interp.equipment[0].id)?.food) {
        const yaw = (t.headYaw * Math.PI) / 180;
        eatDebris(this.particles, t.x - Math.sin(yaw) * 0.4, t.y + e.physics.height * 0.85, t.z + Math.cos(yaw) * 0.4, this.itemLayer(e.interp.equipment[0].id));
      }
      this.effectSwirl(e.interp.effects, t.x, t.y, t.z, e.physics.width, e.physics.height);
    }
    if (pl.thirdPerson !== 0) this.effectSwirl(this.entities.localEffects, pt.x, pt.y, pt.z, 0.6, 1.8);
  }

  private effectSwirl(effects: Array<{ id: string; amp: number; particles: boolean; ambient: boolean }>, x: number, y: number, z: number, w: number, h: number): void {
    const visible = effects.filter((f) => f.particles);
    if (!visible.length) return;
    const ambient = visible.every((f) => f.ambient);
    if (this.rng.nextInt(ambient ? 15 : 4) !== 0) return;
    const col = effectsColor(visible);
    this.particles.spawn('entity_effect', x + (this.rng.nextFloat() - 0.5) * w, y + this.rng.nextFloat() * h, z + (this.rng.nextFloat() - 0.5) * w, 0, 0, 0, 0, 0, col);
  }
}

function eatDebris(p: ParticleEngine, x: number, y: number, z: number, layer: number): void {
  p.itemDebris(x, y, z, layer, 3, 0.1);
}
