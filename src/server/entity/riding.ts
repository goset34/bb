/**
 * Riding: vehicles carry passengers at seat offsets; a player controlling a vehicle sends its
 * input to the vehicle instead of moving itself. Dismounting looks for a free spot around the
 * vehicle. Passenger lists are synchronised to every tracking client.
 */
import type { Entity } from '../../common/entity/ecs';
import { AABB } from '../../common/math/geom';
import { stateFlags, F, getCollisionShape } from '../../common/block/registry';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';

/** Seat offsets per vehicle type: [forward, up] for each seat (blocks, rotated by body yaw). */
export const SEATS: Record<string, Array<[number, number]>> = {
  pig: [[0, 0.62]], horse: [[0, 0.9]], donkey: [[0, 0.82]], mule: [[0, 0.9]], skeleton_horse: [[0, 0.9]], zombie_horse: [[0, 0.9]],
  llama: [[-0.3, 1.12]], camel: [[0.5, 1.7], [-0.7, 1.7]], strider: [[0, 1.05]], chicken: [[0, 0.42]], spider: [[0, 0.52]],
  boat: [[0.2, -0.1], [-0.6, -0.1]], minecart: [[0, 0]], ravager: [[0, 1.6]], polar_bear: [[0, 1.1]],
};

export function vehicleOf(e: Entity): Entity | null {
  const v = e['vehicle'] as Entity | undefined;
  return v && !v.removed ? v : null;
}

export function passengersOf(e: Entity): Entity[] {
  return (e['passengers'] as Entity[] | undefined) ?? [];
}

export function isPassenger(e: Entity): boolean {
  return !!vehicleOf(e);
}

/** Hooks: which passenger controls a vehicle, and custom seat placement. */
export const ridingHooks = {
  /** First passenger controls when it is a player and the vehicle accepts control. */
  canBeControlledBy: (_vehicle: Entity, _rider: Entity): boolean => false,
  /** Vehicle-specific reaction when mounted / dismounted (saddle sounds, AI). */
  mounted: (_level: ServerLevel, _vehicle: Entity, _rider: Entity, _on: boolean): void => {},
};

export function controllingPassenger(vehicle: Entity): Entity | null {
  const first = passengersOf(vehicle)[0];
  if (!first || first.removed) return null;
  return ridingHooks.canBeControlledBy(vehicle, first) ? first : null;
}

function playerOf(level: ServerLevel, e: Entity): ServerPlayer | undefined {
  return e.player ? level.players.find((p) => p.entity === e) : undefined;
}

export function syncPassengers(level: ServerLevel, vehicle: Entity): void {
  const packet = { type: 'setPassengers', id: vehicle.id, passengers: new Int32Array(passengersOf(vehicle).map((p) => p.id)) };
  level.tracker.broadcast(vehicle, packet);
  // Riding players always learn about their own vehicle
  for (const p of passengersOf(vehicle)) playerOf(level, p)?.send(packet);
}

export function startRiding(level: ServerLevel, rider: Entity, vehicle: Entity): boolean {
  if (rider === vehicle || rider.removed || vehicle.removed) return false;
  const seats = SEATS[vehicle.type] ?? [[0, (vehicle.physics?.height ?? 1) * 0.75]];
  if (passengersOf(vehicle).length >= seats.length) return false;
  if (vehicleOf(rider)) stopRiding(level, rider);
  rider['vehicle'] = vehicle;
  vehicle['passengers'] = [...passengersOf(vehicle), rider];
  if (rider.physics) {
    rider.physics.vx = rider.physics.vy = rider.physics.vz = 0;
    rider.physics.fallDistance = 0;
  }
  positionPassengers(vehicle);
  syncPassengers(level, vehicle);
  ridingHooks.mounted(level, vehicle, rider, true);
  return true;
}

/** Free standing spot for a dismounting rider (sides, then the vehicle top). */
function dismountSpot(level: ServerLevel, rider: Entity, vehicle: Entity): [number, number, number] {
  const vt = vehicle.transform!;
  const w = (rider.physics?.width ?? 0.6), h = (rider.physics?.height ?? 1.8);
  const yaw = (vt.bodyYaw * Math.PI) / 180;
  const off = (vehicle.physics?.width ?? 1) / 2 + w / 2 + 0.1;
  const sides: Array<[number, number]> = [
    [Math.cos(yaw), Math.sin(yaw)], [-Math.cos(yaw), -Math.sin(yaw)], [-Math.sin(yaw), Math.cos(yaw)], [Math.sin(yaw), -Math.cos(yaw)],
  ];
  for (const [dx, dz] of sides) {
    const x = vt.x + dx * off, z = vt.z + dz * off;
    for (const dy of [0, 1, -1]) {
      const y = Math.floor(vt.y) + dy;
      const below = level.getBlockState(Math.floor(x), y - 1, Math.floor(z));
      if (!(stateFlags[below]! & F.SOLID) && !(stateFlags[below]! & F.WATER)) continue;
      if (free(level, new AABB(x - w / 2, y, z - w / 2, x + w / 2, y + h, z + w / 2))) return [x, y, z];
    }
  }
  return [vt.x, vt.y + (vehicle.physics?.height ?? 1), vt.z];
}

function free(level: ServerLevel, box: AABB): boolean {
  for (let x = Math.floor(box.minX); x <= Math.floor(box.maxX); x++) {
    for (let y = Math.floor(box.minY); y <= Math.floor(box.maxY); y++) {
      for (let z = Math.floor(box.minZ); z <= Math.floor(box.maxZ); z++) {
        const s = getCollisionShape(level.getBlockState(x, y, z));
        for (let i = 0; i < s.length; i += 6) if (box.intersectsRaw(x + s[i]!, y + s[i + 1]!, z + s[i + 2]!, x + s[i + 3]!, y + s[i + 4]!, z + s[i + 5]!)) return false;
      }
    }
  }
  return true;
}

export function stopRiding(level: ServerLevel, rider: Entity): void {
  const vehicle = rider['vehicle'] as Entity | undefined;
  if (!vehicle) return;
  delete rider['vehicle'];
  vehicle['passengers'] = passengersOf(vehicle).filter((p) => p !== rider);
  syncPassengers(level, vehicle);
  const p = playerOf(level, rider);
  if (p) p.send({ type: 'setPassengers', id: vehicle.id, passengers: new Int32Array(passengersOf(vehicle).map((e) => e.id)) });
  if (!rider.removed && rider.transform) {
    const [x, y, z] = dismountSpot(level, rider, vehicle);
    if (p) p.teleport(x, y, z);
    else {
      const t = rider.transform;
      t.x = x; t.y = y; t.z = z;
      if (rider.net) rider.net.forceSync = true;
    }
  }
  ridingHooks.mounted(level, vehicle, rider, false);
}

export function ejectPassengers(level: ServerLevel, vehicle: Entity): void {
  for (const p of [...passengersOf(vehicle)]) stopRiding(level, p);
}

/** Move passengers to their seats (after the vehicle moved). */
export function positionPassengers(vehicle: Entity): void {
  const vt = vehicle.transform!;
  const seats = SEATS[vehicle.type] ?? [[0, (vehicle.physics?.height ?? 1) * 0.75]];
  const yaw = (vt.bodyYaw * Math.PI) / 180;
  const fx = -Math.sin(yaw), fz = Math.cos(yaw);
  const baby = vehicle['mob'] && vehicle.meta?.['baby'] === true ? 0.5 : 1;
  passengersOf(vehicle).forEach((p, i) => {
    const t = p.transform;
    if (!t || p.removed) return;
    const [f, up] = seats[i] ?? seats[0]!;
    t.px = t.x; t.py = t.y; t.pz = t.z;
    t.x = vt.x + fx * f;
    t.y = vt.y + up * baby;
    t.z = vt.z + fz * f;
    if (p.physics) {
      p.physics.vx = p.physics.vy = p.physics.vz = 0;
      p.physics.fallDistance = 0;
      p.physics.onGround = false;
    }
    if (!p.player && p.net) p.net.forceSync = true;
  });
}
