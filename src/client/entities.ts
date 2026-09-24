/**
 * Client entity state: spawns/removals from the server tracker, position interpolation (each
 * update is approached over 3 ticks), client-side item/orb physics between updates, animation
 * timers (limb swing, arm swing, hurt flash, death) and entity events.
 */
import type { Entity } from '../common/entity/ecs';
import type { ClientInterp } from '../common/entity/components';
import { makePhysics, makeTransform } from '../common/entity/components';
import { tickItemPhysics } from '../common/entity/physics';
import { ItemStack, SerializedStack } from '../common/item/stack';
import type { Packet } from '../common/net/protocol';
import type { ClientLevel } from './world';

/** Hitbox sizes of entity types known to the client renderer; other systems add theirs. */
export const ENTITY_SIZES: Record<string, [number, number]> = {
  player: [0.6, 1.8], item: [0.25, 0.25], xp_orb: [0.5, 0.5],
};

/** Client entity: synced metadata lives in `data` (the item stack of item entities in `stack`). */
export type ClientEntity = Entity & Required<Pick<Entity, 'transform' | 'physics' | 'interp'>> & { data: Record<string, unknown>; stack?: ItemStack };

export interface EntityEventListener {
  (e: ClientEntity | null, id: number, event: string, data: number): void;
}

function newInterp(x: number, y: number, z: number, yaw: number, pitch: number, headYaw: number): ClientInterp {
  return {
    tx: x, ty: y, tz: z, tyaw: yaw, tpitch: pitch, theadYaw: headYaw, steps: 0,
    limbSwing: 0, limbSwingAmount: 0, prevLimbSwingAmount: 0, swingTime: 0, swinging: false, swingOffhand: false,
    hurtTime: 0, deathTime: 0, age: 0, equipment: [], effects: [], pickup: null,
  };
}

function wrapDegrees(a: number): number {
  a %= 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

export class ClientEntities {
  readonly byId = new Map<number, ClientEntity>();
  private readonly listeners: EntityEventListener[] = [];
  /** Id of the local player (its own events are forwarded with e = null). */
  localId = 0;

  constructor(private readonly level: ClientLevel) {}

  onEvent(l: EntityEventListener): void {
    this.listeners.push(l);
  }

  private emit(e: ClientEntity | null, id: number, event: string, data: number): void {
    for (const l of this.listeners) l(e, id, event, data);
  }

  clear(): void {
    this.byId.clear();
  }

  get(id: number): ClientEntity | undefined {
    return this.byId.get(id);
  }

  /** Handle an entity packet; returns false if the packet is not an entity packet. */
  handle(p: Packet): boolean {
    switch (p.type) {
      case 'spawnEntity': this.spawn(p); return true;
      case 'entityMove': {
        const e = this.byId.get(p['id'] as number);
        if (!e) return true;
        const i = e.interp;
        i.tx = p['x'] as number; i.ty = p['y'] as number; i.tz = p['z'] as number;
        i.tyaw = p['yaw'] as number; i.tpitch = p['pitch'] as number; i.theadYaw = p['headYaw'] as number;
        i.steps = e.type === 'item' || e.type === 'xp_orb' ? 1 : 3;
        e.physics.onGround = p['onGround'] as boolean;
        return true;
      }
      case 'entityVelocity': {
        const e = this.byId.get(p['id'] as number);
        if (e) { e.physics.vx = p['vx'] as number; e.physics.vy = p['vy'] as number; e.physics.vz = p['vz'] as number; }
        return true;
      }
      case 'entityMeta': {
        const e = this.byId.get(p['id'] as number);
        if (e) this.applyMeta(e, p['meta'] as Record<string, unknown>);
        return true;
      }
      case 'entityEquipment': {
        const e = this.byId.get(p['id'] as number);
        if (e) e.interp.equipment = (p['slots'] as ItemStack[]).map((s) => s ?? ItemStack.empty());
        return true;
      }
      case 'entityEffects': {
        const id = p['id'] as number;
        const e = this.byId.get(id);
        const fx = p['effects'] as ClientInterp['effects'];
        if (e) e.interp.effects = fx;
        if (id === this.localId) this.emit(null, id, 'effects', 0);
        this.localEffects = id === this.localId ? fx : this.localEffects;
        return true;
      }
      case 'entityEvent': {
        const id = p['id'] as number;
        const e = this.byId.get(id) ?? null;
        const ev = p['event'] as string;
        if (e) {
          if (ev === 'hurt') e.interp.hurtTime = 10;
          if (ev === 'death') e.interp.deathTime = 1;
        }
        this.emit(e, id, ev, p['data'] as number);
        return true;
      }
      case 'entityAnimation': {
        const e = this.byId.get(p['id'] as number);
        const anim = p['anim'] as number;
        if (e && (anim === 0 || anim === 3)) this.startSwing(e, anim === 3);
        if (e && anim === 1) e.interp.hurtTime = 10;
        return true;
      }
      case 'removeEntities': {
        for (const id of p['ids'] as Int32Array) {
          const e = this.byId.get(id);
          if (!e) continue;
          // Items being picked up finish their fly-to-collector animation first
          if (e.interp.pickup) continue;
          this.byId.delete(id);
        }
        return true;
      }
      case 'takeItem': {
        const e = this.byId.get(p['item'] as number);
        if (e) {
          const t = e.transform;
          e.interp.pickup = { collector: p['collector'] as number, t: 0, x: t.x, y: t.y, z: t.z };
          this.emit(e, e.id, 'pickup', p['count'] as number);
        }
        return true;
      }
    }
    return false;
  }

  /** Active effects of the local player (HUD). */
  localEffects: ClientInterp['effects'] = [];

  startSwing(e: ClientEntity, offhand = false): void {
    const i = e.interp;
    if (!i.swinging || i.swingTime >= 3 || i.swingTime < 0) {
      i.swingTime = -1;
      i.swinging = true;
      i.swingOffhand = offhand;
    }
  }

  private spawn(p: Packet): void {
    const id = p['id'] as number;
    const type = p['etype'] as string;
    const x = p['x'] as number, y = p['y'] as number, z = p['z'] as number;
    const yaw = p['yaw'] as number, pitch = p['pitch'] as number, headYaw = p['headYaw'] as number;
    const [w, h] = ENTITY_SIZES[type] ?? [0.6, 0.6];
    const physics = makePhysics(w, h);
    physics.vx = p['vx'] as number; physics.vy = p['vy'] as number; physics.vz = p['vz'] as number;
    if (type === 'item') { physics.gravity = 0.04; physics.stepHeight = 0; }
    if (type === 'xp_orb') { physics.gravity = 0.03; physics.stepHeight = 0; }
    const e: ClientEntity = {
      id, type, removed: false,
      transform: makeTransform(x, y, z, yaw, pitch),
      physics,
      interp: newInterp(x, y, z, yaw, pitch, headYaw),
      data: {},
    };
    e.transform.headYaw = e.transform.pHeadYaw = headYaw;
    this.applyMeta(e, p['meta'] as Record<string, unknown>);
    this.byId.set(id, e);
  }

  private applyMeta(e: ClientEntity, m: Record<string, unknown>): void {
    Object.assign(e.data, m);
    if (m['item']) e.stack = ItemStack.fromJSON(m['item'] as SerializedStack);
  }

  /** Client tick (20 TPS). */
  tick(): void {
    for (const e of this.byId.values()) {
      const t = e.transform, i = e.interp;
      t.px = t.x; t.py = t.y; t.pz = t.z; t.pyaw = t.yaw; t.ppitch = t.pitch; t.pHeadYaw = t.headYaw; t.pBodyYaw = t.bodyYaw;
      i.age++;
      if (i.pickup) {
        i.pickup.t++;
        if (i.pickup.t >= 3) this.byId.delete(e.id);
        continue;
      }
      if (i.steps > 0) {
        const k = 1 / i.steps;
        t.x += (i.tx - t.x) * k;
        t.y += (i.ty - t.y) * k;
        t.z += (i.tz - t.z) * k;
        t.yaw += wrapDegrees(i.tyaw - t.yaw) * k;
        t.pitch += (i.tpitch - t.pitch) * k;
        t.headYaw += wrapDegrees(i.theadYaw - t.headYaw) * k;
        i.steps--;
      } else if (e.type === 'item' || e.type === 'xp_orb') {
        tickItemPhysics(this.level, e);
      }
      // Body yaw follows movement and lags behind the head (living entities)
      if (e.type !== 'item' && e.type !== 'xp_orb') this.updateBody(e);
      // Limb swing
      const dx = t.x - t.px, dz = t.z - t.pz;
      i.prevLimbSwingAmount = i.limbSwingAmount;
      const dist = Math.min(1, Math.sqrt(dx * dx + dz * dz) * 4);
      i.limbSwingAmount += (dist - i.limbSwingAmount) * 0.4;
      i.limbSwing += i.limbSwingAmount;
      // Arm swing (6 ticks)
      if (i.swinging) {
        i.swingTime++;
        if (i.swingTime >= 6) { i.swingTime = 0; i.swinging = false; }
      }
      if (i.hurtTime > 0) i.hurtTime--;
      if (i.deathTime > 0 && i.deathTime < 20) i.deathTime++;
    }
  }

  private updateBody(e: ClientEntity): void {
    const t = e.transform;
    const dx = t.x - t.px, dz = t.z - t.pz;
    let target = t.bodyYaw;
    if (dx * dx + dz * dz > 0.0025) target = (Math.atan2(-dx, dz) * 180) / Math.PI;
    let diff = wrapDegrees(target - t.bodyYaw);
    t.bodyYaw += diff * 0.3;
    // Keep the head within 75° of the body
    diff = wrapDegrees(t.headYaw - t.bodyYaw);
    if (diff > 75) t.bodyYaw = t.headYaw - 75;
    if (diff < -75) t.bodyYaw = t.headYaw + 75;
  }

  /** Interpolated render position. */
  static pos(e: ClientEntity, partial: number): [number, number, number] {
    const t = e.transform;
    return [t.px + (t.x - t.px) * partial, t.py + (t.y - t.py) * partial, t.pz + (t.z - t.pz) * partial];
  }
}
