/**
 * Entity tracker: decides which players see which entities and sends spawn / move / meta /
 * equipment / remove packets. Positions are sent as absolute values with the server tick so
 * clients can interpolate.
 */
import type { Entity } from '../../common/entity/ecs';
import type { NetSync } from '../../common/entity/components';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';
import { ItemStack } from '../../common/item/stack';

/** Tracking range (blocks) and update interval (ticks) per entity type. */
const RANGES: Record<string, [number, number]> = {
  player: [512, 2], item: [96, 20], xp_orb: [96, 20], falling_block: [160, 20], tnt: [160, 10],
  arrow: [64, 20], spectral_arrow: [64, 20], trident: [64, 20], snowball: [64, 10], egg: [64, 10], void_pearl: [64, 10],
  experience_bottle: [64, 10], small_fireball: [64, 10], fireball: [64, 10], wind_charge: [64, 10], gust_charge: [64, 10], llama_spit: [64, 10],
  lightning_bolt: [256, 20], boat: [160, 3], minecart: [128, 3], verge_dragon: [320, 3], blight: [320, 3],
};

/** Builds the type-specific spawn metadata. Other systems add fields via `metaProviders`. */
export const metaProviders: Array<(e: Entity, meta: Record<string, unknown>) => void> = [
  (e, m) => {
    if (e.item) m['item'] = e.item.stack.toJSON();
    if (e.xpOrb) m['value'] = e.xpOrb.value;
    if (e.player) m['name'] = e.player.name;
    if (e.living) { m['health'] = e.living.health; m['maxHealth'] = e.living.attrs.value('max_health'); }
    if (e.meta) Object.assign(m, e.meta);
  },
];

/** Yaw sent to clients: body rotation for mobs (movement heading stays server-side). */
function netYaw(e: Entity): number {
  const t = e.transform!;
  return e['mob'] ? t.bodyYaw : t.yaw;
}

function spawnMeta(e: Entity): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  for (const p of metaProviders) p(e, m);
  return m;
}

export function net(e: Entity): NetSync {
  if (!e.net) {
    const [range, interval] = RANGES[e.type] ?? [80, 3];
    const t = e.transform!;
    e.net = {
      lastX: t.x, lastY: t.y, lastZ: t.z, lastYaw: t.yaw, lastPitch: t.pitch, lastHeadYaw: t.headYaw,
      lastVx: 0, lastVy: 0, lastVz: 0, range, trackers: new Set(), updateInterval: interval, forceSync: false, metaDirty: false,
    };
  }
  return e.net;
}

/** Equipment visible to others: main hand, off hand, feet, legs, chest, head. */
export function visibleEquipment(e: Entity): ItemStack[] | null {
  const inv = e.player?.inventory;
  if (inv) return [inv.mainHand, inv.get(40), inv.get(36), inv.get(37), inv.get(38), inv.get(39)];
  const eq = e['equipment'] as ItemStack[] | undefined;
  return eq ?? null;
}

export class EntityTracker {
  private readonly equipKeys = new Map<number, string>();

  constructor(private readonly level: ServerLevel) {
    level.entities.onChange((e, added) => {
      if (!added) this.untrackAll(e);
    });
  }

  private playerById(id: number): ServerPlayer | undefined {
    return this.level.players.find((p) => p.entity.id === id);
  }

  private untrackAll(e: Entity): void {
    const n = e.net;
    if (!n) return;
    for (const id of n.trackers) this.playerById(id)?.send({ type: 'removeEntities', ids: new Int32Array([e.id]) });
    n.trackers.clear();
    this.equipKeys.delete(e.id);
  }

  /** Forget everything a player tracks (dimension change / disconnect). */
  forgetPlayer(p: ServerPlayer): void {
    for (const e of this.level.entities.all()) e.net?.trackers.delete(p.entity.id);
  }

  sendSpawn(p: ServerPlayer, e: Entity): void {
    const t = e.transform!, ph = e.physics;
    p.send({
      type: 'spawnEntity', id: e.id, etype: e.type, x: t.x, y: t.y, z: t.z, yaw: netYaw(e), pitch: t.pitch, headYaw: t.headYaw,
      vx: ph?.vx ?? 0, vy: ph?.vy ?? 0, vz: ph?.vz ?? 0, meta: spawnMeta(e),
    });
    const eq = visibleEquipment(e);
    if (eq) p.send({ type: 'entityEquipment', id: e.id, slots: eq });
    if (e.living && e.living.effects.size) {
      p.send({ type: 'entityEffects', id: e.id, effects: [...e.living.effects.values()].map((x) => ({ id: x.id, amp: x.amp, dur: x.dur, particles: x.particles, ambient: x.ambient })) });
    }
  }

  tick(): void {
    const level = this.level;
    const now = level.getGameTime();
    const players = level.players;
    for (const e of level.entities.all()) {
      if (e.removed || !e.transform) continue;
      const n = net(e);
      const t = e.transform;
      // Visibility
      for (const p of players) {
        if (p.entity === e) continue;
        const pt = p.entity.transform;
        const dx = pt.x - t.x, dz = pt.z - t.z;
        const r = Math.min(n.range, p.viewDistance * 16 + 16);
        const visible = dx * dx + dz * dz <= r * r && p.hasChunk(Math.floor(t.x) >> 4, Math.floor(t.z) >> 4) && !p.disconnected;
        const tracked = n.trackers.has(p.entity.id);
        if (visible && !tracked) {
          n.trackers.add(p.entity.id);
          this.sendSpawn(p, e);
        } else if (!visible && tracked) {
          n.trackers.delete(p.entity.id);
          p.send({ type: 'removeEntities', ids: new Int32Array([e.id]) });
        }
      }
      if (n.trackers.size === 0) continue;
      // Movement
      const moved = Math.abs(t.x - n.lastX) > 1e-3 || Math.abs(t.y - n.lastY) > 1e-3 || Math.abs(t.z - n.lastZ) > 1e-3;
      const yaw = netYaw(e);
      const rotated = Math.abs(yaw - n.lastYaw) > 0.5 || Math.abs(t.pitch - n.lastPitch) > 0.5 || Math.abs(t.headYaw - n.lastHeadYaw) > 0.5;
      const due = (now + e.id) % n.updateInterval === 0;
      if (n.forceSync || ((moved || rotated) && (due || e.type === 'player' || n.updateInterval <= 3)) || (due && now % 60 === 0)) {
        const packet = { type: 'entityMove', id: e.id, x: t.x, y: t.y, z: t.z, yaw, pitch: t.pitch, headYaw: t.headYaw, onGround: !!e.physics?.onGround, tick: now };
        for (const id of n.trackers) this.playerById(id)?.send(packet);
        n.lastX = t.x; n.lastY = t.y; n.lastZ = t.z; n.lastYaw = yaw; n.lastPitch = t.pitch; n.lastHeadYaw = t.headYaw;
        n.forceSync = false;
        if (e.physics && e.type !== 'player') {
          const vp = { type: 'entityVelocity', id: e.id, vx: e.physics.vx, vy: e.physics.vy, vz: e.physics.vz };
          for (const id of n.trackers) this.playerById(id)?.send(vp);
        }
      }
      if (n.metaDirty) {
        n.metaDirty = false;
        const mp = { type: 'entityMeta', id: e.id, meta: spawnMeta(e) };
        for (const id of n.trackers) this.playerById(id)?.send(mp);
      }
      const eq = visibleEquipment(e);
      if (eq) {
        const key = eq.map((s) => `${s.id}:${s.count}`).join(',');
        if (this.equipKeys.get(e.id) !== key) {
          this.equipKeys.set(e.id, key);
          const ep = { type: 'entityEquipment', id: e.id, slots: eq };
          for (const id of n.trackers) this.playerById(id)?.send(ep);
        }
      }
    }
  }

  /** Send a packet to every player tracking `e` (and to `e` itself if it is a player). */
  broadcast(e: Entity, packet: { type: string } & Record<string, unknown>, includeSelf = true): void {
    const n = e.net;
    if (n) for (const id of n.trackers) this.playerById(id)?.send(packet);
    if (includeSelf && e.player) this.playerById(e.id)?.send(packet);
  }
}
