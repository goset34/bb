/**
 * Entity movement physics, shared by the authoritative server and client-side prediction.
 * Constants and ordering follow the reference "travel/move/collide" algorithm per tick.
 */
import { AABB, DEG } from '../math/geom';
import {
  getCollisionShape, stateFlags, F, blockOf, hasTag, getValue, tryGetValue,
} from '../block/registry';
import { P } from '../block/properties';
import type { BlockGetter } from '../world/level';
import type { Entity } from './ecs';
import type { Physics, Transform, MoveInput } from './components';
import type { Shape } from '../block/model';

export interface PhysicsWorld extends BlockGetter {
  /** Extra collision boxes from entities (boats, shellurkers). */
  entityColliders?(e: Entity, box: AABB): AABB[];
  /** Block contact hook (damage, pressure plates…); server only. */
  onEntityInside?(e: Entity, state: number, x: number, y: number, z: number): void;
  onStepOn?(e: Entity, state: number, x: number, y: number, z: number): void;
  /** Landing hook; receives fall distance. */
  onFallOn?(e: Entity, state: number, x: number, y: number, z: number, fallDistance: number): void;
  /** Is the chunk at x/z loaded (unloaded → entity does not fall). */
  isLoaded?(x: number, z: number): boolean;
}

type PE = Entity & { transform: Transform; physics: Physics };

// ---------------------------------------------------------------------------------------------
// Bounding boxes
// ---------------------------------------------------------------------------------------------

export function entityBox(e: PE): AABB {
  const t = e.transform, p = e.physics;
  const hw = p.width / 2;
  return new AABB(t.x - hw, t.y, t.z - hw, t.x + hw, t.y + p.height, t.z + hw);
}

const tmpBoxes: AABB[] = [];

/** Contextual collision shape (scaffolding, powder snow) for an entity. */
function shapeFor(world: PhysicsWorld, e: PE | null, state: number, x: number, y: number, z: number): Shape {
  const b = blockOf(state);
  if (b.name === 'scaffolding' && e) {
    const above = e.transform.y > y + 1 - 1e-5;
    const descending = !!e.input?.sneaking;
    if (above && !descending) return getCollisionShape(state);
    const dist = tryGetValue(state, P.distance7) ?? 0;
    if (dist !== 0 && getValue(state, P.mossyBottom) && e.transform.y > y + 0.125 - 1e-5) return SCAFFOLD_BOTTOM;
    return EMPTY;
  }
  if (b.name === 'powder_snow' && e) {
    if (e.meta?.['leatherBoots'] && e.transform.y > y + 1 - 1e-5 && !e.input?.sneaking) return FULL;
    return EMPTY;
  }
  return getCollisionShape(state);
}

const EMPTY = new Float32Array(0);
const FULL = new Float32Array([0, 0, 0, 1, 1, 1]);
const SCAFFOLD_BOTTOM = new Float32Array([0, 0, 0, 1, 0.125, 1]);

/** Collect block collision boxes intersecting `box`. */
export function collectBlockBoxes(world: PhysicsWorld, box: AABB, e: PE | null, out: AABB[]): AABB[] {
  out.length = 0;
  const x0 = Math.floor(box.minX - 1e-7) - 1, x1 = Math.floor(box.maxX + 1e-7) + 1;
  const y0 = Math.floor(box.minY - 1e-7) - 1, y1 = Math.floor(box.maxY + 1e-7) + 1;
  const z0 = Math.floor(box.minZ - 1e-7) - 1, z1 = Math.floor(box.maxZ + 1e-7) + 1;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (world.isLoaded && !world.isLoaded(x, z)) {
        // Unloaded chunk: treat as solid wall to avoid falling out of the world
        out.push(new AABB(x, y0, z, x + 1, y1 + 1, z + 1));
        continue;
      }
      for (let y = y0; y <= y1; y++) {
        const st = world.getBlockState(x, y, z);
        if (st === 0) continue;
        const f = stateFlags[st]!;
        if (f & F.NO_COLLISION && blockOf(st).name !== 'scaffolding' && blockOf(st).name !== 'powder_snow') continue;
        const sh = shapeFor(world, e, st, x, y, z);
        for (let i = 0; i < sh.length; i += 6) {
          const bx0 = x + sh[i]!, by0 = y + sh[i + 1]!, bz0 = z + sh[i + 2]!;
          const bx1 = x + sh[i + 3]!, by1 = y + sh[i + 4]!, bz1 = z + sh[i + 5]!;
          if (bx1 > box.minX && bx0 < box.maxX && by1 > box.minY && by0 < box.maxY && bz1 > box.minZ && bz0 < box.maxZ) {
            out.push(new AABB(bx0, by0, bz0, bx1, by1, bz1));
          }
        }
      }
    }
  }
  return out;
}

function collideWithShapes(dx: number, dy: number, dz: number, box: AABB, shapes: AABB[]): [number, number, number] {
  let b = box;
  if (dy !== 0) {
    for (const s of shapes) dy = s.clipY(b, dy);
    if (dy !== 0) b = b.move(0, dy, 0);
  }
  const zFirst = Math.abs(dx) < Math.abs(dz);
  if (zFirst && dz !== 0) {
    for (const s of shapes) dz = s.clipZ(b, dz);
    if (dz !== 0) b = b.move(0, 0, dz);
  }
  if (dx !== 0) {
    for (const s of shapes) dx = s.clipX(b, dx);
    if (!zFirst && dx !== 0) b = b.move(dx, 0, 0);
  }
  if (!zFirst && dz !== 0) {
    for (const s of shapes) dz = s.clipZ(b, dz);
  }
  return [dx, dy, dz];
}

// Note: AABB.clipX(o, d) clips movement of `o` against `this`.
function collideBox(world: PhysicsWorld, e: PE | null, box: AABB, dx: number, dy: number, dz: number): [number, number, number] {
  const swept = box.expandTowards(dx, dy, dz);
  const shapes = collectBlockBoxes(world, swept, e, tmpBoxes);
  if (e && world.entityColliders) for (const b of world.entityColliders(e, swept)) shapes.push(b);
  return collideWithShapes(dx, dy, dz, box, shapes);
}

/** Collide movement with step-up support. */
export function collide(world: PhysicsWorld, e: PE, dx: number, dy: number, dz: number): [number, number, number] {
  const box = entityBox(e);
  const p = e.physics;
  const r = (dx === 0 && dy === 0 && dz === 0) ? [0, 0, 0] as [number, number, number] : collideBox(world, e, box, dx, dy, dz);
  const xc = dx !== r[0], yc = dy !== r[1], zc = dz !== r[2];
  const onGroundAfter = p.onGround || (yc && dy < 0);
  if (p.stepHeight > 0 && onGroundAfter && (xc || zc)) {
    let v1 = collideBox(world, e, box, dx, p.stepHeight, dz);
    const v2 = collideBox(world, e, box.expandTowards(dx, 0, dz), 0, p.stepHeight, 0);
    if (v2[1] < p.stepHeight) {
      const v3b = collideBox(world, e, box.move(0, v2[1], 0), dx, 0, dz);
      const v3: [number, number, number] = [v3b[0], v3b[1] + v2[1], v3b[2]];
      if (v3[0] * v3[0] + v3[2] * v3[2] > v1[0] * v1[0] + v1[2] * v1[2]) v1 = v3;
    }
    if (v1[0] * v1[0] + v1[2] * v1[2] > r[0] * r[0] + r[2] * r[2]) {
      const down = collideBox(world, e, box.move(v1[0], v1[1], v1[2]), 0, -v1[1] + dy, 0);
      return [v1[0], v1[1] + down[1], v1[2]];
    }
  }
  return r;
}

/** Is the box free of block collisions. */
export function isFree(world: PhysicsWorld, e: PE | null, box: AABB): boolean {
  const shapes = collectBlockBoxes(world, box, e, tmpBoxes);
  for (const s of shapes) if (s.intersects(box)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Fluids
// ---------------------------------------------------------------------------------------------

/** Fluid amount 0..8 for a state (8 = full). */
export function fluidAmount(state: number): number {
  const f = stateFlags[state]!;
  if (!(f & (F.WATER | F.LAVA))) return 0;
  if (f & F.FLUID_BLOCK) {
    const lv = tryGetValue(state, P.level15) ?? 0;
    if (lv === 0 || lv >= 8) return 8;
    return 8 - lv;
  }
  return 8; // waterlogged / bubble column / seagrass
}

export function isFallingFluid(state: number): boolean {
  const f = stateFlags[state]!;
  if (!(f & F.FLUID_BLOCK)) return false;
  return (tryGetValue(state, P.level15) ?? 0) >= 8;
}

/** Fluid surface height inside the block (0..1). */
export function fluidHeight(world: BlockGetter, x: number, y: number, z: number, state: number): number {
  const f = stateFlags[state]!;
  const kind = f & (F.WATER | F.LAVA);
  if (!kind) return 0;
  const above = world.getBlockState(x, y + 1, z);
  if (stateFlags[above]! & kind) return 1;
  return fluidAmount(state) / 9;
}

/** Flow direction of a fluid block (normalised xz). */
export function fluidFlow(world: BlockGetter, x: number, y: number, z: number, state: number): [number, number, number] {
  const kind = stateFlags[state]! & (F.WATER | F.LAVA);
  if (!kind) return [0, 0, 0];
  const own = fluidHeight(world, x, y, z, state);
  let fx = 0, fz = 0;
  const dirs: Array<[number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [dx, dz] of dirs) {
    const ns = world.getBlockState(x + dx, y, z + dz);
    const nf = stateFlags[ns]!;
    if (nf & kind) {
      const nh = fluidHeight(world, x + dx, y, z + dz, ns);
      const diff = own - nh;
      fx += dx * diff;
      fz += dz * diff;
    } else if (!(nf & F.OPAQUE_CUBE) && !(nf & F.FULL_COLLISION)) {
      const below = world.getBlockState(x + dx, y - 1, z + dz);
      if (stateFlags[below]! & kind) {
        const nh = fluidHeight(world, x + dx, y - 1, z + dz, below) - 0.8888889;
        const diff = own - nh;
        fx += dx * diff;
        fz += dz * diff;
      }
    }
  }
  let fy = 0;
  if (isFallingFluid(state)) fy = -6;
  const len = Math.hypot(fx, fy, fz);
  if (len < 1e-7) return [0, 0, 0];
  return [fx / len, fy / len, fz / len];
}

/**
 * Update water/lava contact state and apply fluid pushing (reference behaviour).
 * Returns true if touching water.
 */
export function updateFluidState(world: PhysicsWorld, e: PE, lavaPush: number): void {
  const p = e.physics;
  const box = entityBox(e).inflate(-0.001);
  p.waterHeight = updateFluidHeightAndPush(world, e, box, F.WATER, 0.014);
  p.lavaHeight = updateFluidHeightAndPush(world, e, box, F.LAVA, lavaPush);
  p.inWater = p.waterHeight > 0;
  p.inLava = p.lavaHeight > 0;
  if (p.inWater) {
    p.fallDistance = 0;
    p.fireTicks = 0;
  }
  const t = e.transform;
  const eyeY = t.y + p.eyeHeight - 0.11111111;
  const ex = Math.floor(t.x), ey = Math.floor(eyeY), ez = Math.floor(t.z);
  const es = world.getBlockState(ex, ey, ez);
  p.underWater = (stateFlags[es]! & F.WATER) !== 0 && eyeY < ey + fluidHeight(world, ex, ey, ez, es);
  p.eyeInLava = (stateFlags[es]! & F.LAVA) !== 0 && eyeY < ey + fluidHeight(world, ex, ey, ez, es);
}

function updateFluidHeightAndPush(world: PhysicsWorld, e: PE, box: AABB, kind: number, pushScale: number): number {
  const x0 = Math.floor(box.minX), x1 = Math.ceil(box.maxX);
  const y0 = Math.floor(box.minY), y1 = Math.ceil(box.maxY);
  const z0 = Math.floor(box.minZ), z1 = Math.ceil(box.maxZ);
  let maxH = 0;
  let px = 0, py = 0, pz = 0;
  let count = 0;
  let touching = false;
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      for (let z = z0; z < z1; z++) {
        const st = world.getBlockState(x, y, z);
        if (!(stateFlags[st]! & kind)) continue;
        const h = y + fluidHeight(world, x, y, z, st);
        if (h >= box.minY) {
          touching = true;
          maxH = Math.max(h - box.minY, maxH);
          const flow = fluidFlow(world, x, y, z, st);
          let fx = flow[0], fy = flow[1], fz = flow[2];
          if (maxH < 0.4) {
            fx *= maxH; fy *= maxH; fz *= maxH;
          }
          px += fx; py += fy; pz += fz;
          count++;
        }
      }
    }
  }
  const p = e.physics;
  if (count > 0 && pushScale > 0 && !(e.type === 'player' && e.input?.flying)) {
    px /= count; py /= count; pz /= count;
    const len = Math.hypot(px, py, pz);
    if (len > 0) {
      px = (px / len) * pushScale;
      py = (py / len) * pushScale;
      pz = (pz / len) * pushScale;
    }
    if (Math.abs(p.vx) < 0.003 && Math.abs(p.vz) < 0.003 && Math.hypot(px, py, pz) < 0.0045000000000000005) {
      const l2 = Math.hypot(px, py, pz) || 1;
      px = (px / l2) * 0.0045000000000000005;
      py = (py / l2) * 0.0045000000000000005;
      pz = (pz / l2) * 0.0045000000000000005;
    }
    p.vx += px;
    p.vy += py;
    p.vz += pz;
  }
  return touching ? maxH : 0;
}

// ---------------------------------------------------------------------------------------------
// Block properties affecting movement
// ---------------------------------------------------------------------------------------------

function blockBelowForMovement(world: BlockGetter, t: Transform): number {
  return world.getBlockState(Math.floor(t.x), Math.floor(t.y - 0.5000001), Math.floor(t.z));
}

export function frictionOf(state: number): number {
  return blockOf(state).settings.friction ?? 0.6;
}

export function speedFactorAt(world: BlockGetter, t: Transform): number {
  const at = world.getBlockState(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z));
  const b = blockOf(at);
  if (b.name === 'water' || b.name === 'bubble_column') return 1;
  const f = b.settings.speedFactor ?? 1;
  if (f !== 1) return f;
  return blockOf(blockBelowForMovement(world, t)).settings.speedFactor ?? 1;
}

export function jumpFactorAt(world: BlockGetter, t: Transform): number {
  const at = world.getBlockState(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z));
  const f = blockOf(at).settings.jumpFactor ?? 1;
  if (f !== 1) return f;
  return blockOf(blockBelowForMovement(world, t)).settings.jumpFactor ?? 1;
}

export function onClimbable(world: BlockGetter, e: PE): boolean {
  // Wall climbers (spiders) climb whatever they bump into
  if ((e as { climbing?: boolean }).climbing) return true;
  const t = e.transform;
  const x = Math.floor(t.x), y = Math.floor(t.y), z = Math.floor(t.z);
  const st = world.getBlockState(x, y, z);
  if (hasTag(st, 'climbable')) return true;
  // Open trapdoor above a ladder with matching facing
  if (hasTag(st, 'trapdoors') && tryGetValue(st, P.open)) {
    const below = world.getBlockState(x, y - 1, z);
    if (blockOf(below).name === 'ladder' && getValue(below, P.facing) === getValue(st, P.facing)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------------------------

export interface MoveResult {
  /** Actual movement applied. */
  dx: number;
  dy: number;
  dz: number;
}

/** Move with collision (reference `Entity.move(SELF, delta)`). */
export function move(world: PhysicsWorld, e: PE, dx: number, dy: number, dz: number): MoveResult {
  const p = e.physics;
  const t = e.transform;
  if (p.noPhysics) {
    t.x += dx; t.y += dy; t.z += dz;
    return { dx, dy, dz };
  }
  if (p.stuckX !== 0 || p.stuckY !== 0 || p.stuckZ !== 0) {
    dx *= p.stuckX; dy *= p.stuckY; dz *= p.stuckZ;
    p.stuckX = p.stuckY = p.stuckZ = 0;
    p.vx = p.vy = p.vz = 0;
  }
  // Sneaking edge protection
  if (e.input?.sneaking && e.type === 'player' && dy <= 0 && p.onGround && !e.input.flying) {
    [dx, dz] = backOffFromEdge(world, e, dx, dz);
  }
  const [rx, ry, rz] = collide(world, e, dx, dy, dz);
  if (rx * rx + ry * ry + rz * rz > 1e-14) {
    t.x += rx; t.y += ry; t.z += rz;
  }
  const xc = Math.abs(dx - rx) > 1e-5;
  const zc = Math.abs(dz - rz) > 1e-5;
  p.horizontalCollision = xc || zc;
  p.verticalCollision = dy !== ry;
  const below = p.verticalCollision && dy < 0;
  p.wasOnGround = p.onGround;
  p.onGround = below;
  if (p.horizontalCollision) {
    const want = Math.hypot(dx, dz);
    const got = Math.hypot(rx, rz);
    p.minorHorizontalCollision = want > 0 && (want - got) / want < 0.2;
  } else p.minorHorizontalCollision = false;
  // Block below the feet
  const fx = Math.floor(t.x), fy = Math.floor(t.y - 0.2), fz = Math.floor(t.z);
  let onState = world.getBlockState(fx, fy, fz);
  let onY = fy;
  if (onState === 0 || stateFlags[onState]! & F.AIR) {
    const below2 = world.getBlockState(fx, fy - 1, fz);
    if (hasTag(below2, 'fences') || hasTag(below2, 'walls') || hasTag(below2, 'fence_gates')) {
      onState = below2;
      onY = fy - 1;
    }
  }
  // Fall damage bookkeeping
  if (p.onGround) {
    if (p.fallDistance > 0) {
      world.onFallOn?.(e, onState, fx, onY, fz, p.fallDistance);
      p.fallDistance = 0;
    }
  } else if (ry < 0) {
    p.fallDistance -= ry;
  }
  if (xc) p.vx = 0;
  if (zc) p.vz = 0;
  if (dy !== ry) {
    // updateEntityAfterFallOn: slime & bed bounce, otherwise stop
    const bname = blockOf(onState).name;
    const sneaking = !!e.input?.sneaking;
    if (bname === 'slime_block' && !sneaking && p.vy < 0) p.vy = -p.vy;
    else if (hasTag(onState, 'beds') && !sneaking && p.vy < 0) p.vy = -p.vy * 0.66;
    else p.vy = 0;
  }
  if (p.onGround) {
    const bname = blockOf(onState).name;
    if (bname === 'slime_block' && !e.input?.sneaking) {
      const d = Math.abs(p.vy);
      if (d < 0.1) {
        const f = 0.4 + d * 0.2;
        p.vx *= f;
        p.vz *= f;
      }
    }
    world.onStepOn?.(e, onState, fx, onY, fz);
  }
  // Walk distance for animation & sounds
  const hd = Math.hypot(rx, rz);
  p.walkDist += hd * 0.6;
  p.moveDist += Math.hypot(rx, ry * 0.6, rz);
  // Blocks the entity is inside
  checkInsideBlocks(world, e);
  const sf = speedFactorAt(world, t);
  p.vx *= sf;
  p.vz *= sf;
  return { dx: rx, dy: ry, dz: rz };
}

function backOffFromEdge(world: PhysicsWorld, e: PE, dx: number, dz: number): [number, number] {
  const step = 0.05;
  const box = entityBox(e);
  const p = e.physics;
  const down = -p.stepHeight;
  const free = (x: number, z: number) => isFree(world, e, box.move(x, down, z));
  while (dx !== 0 && free(dx, 0)) {
    if (dx < step && dx >= -step) dx = 0;
    else if (dx > 0) dx -= step;
    else dx += step;
  }
  while (dz !== 0 && free(0, dz)) {
    if (dz < step && dz >= -step) dz = 0;
    else if (dz > 0) dz -= step;
    else dz += step;
  }
  while (dx !== 0 && dz !== 0 && free(dx, dz)) {
    if (dx < step && dx >= -step) dx = 0;
    else if (dx > 0) dx -= step;
    else dx += step;
    if (dz < step && dz >= -step) dz = 0;
    else if (dz > 0) dz -= step;
    else dz += step;
  }
  return [dx, dz];
}

/** entityInside for blocks overlapping the (slightly deflated) box. */
function checkInsideBlocks(world: PhysicsWorld, e: PE): void {
  const box = entityBox(e).inflate(-1e-5);
  const x0 = Math.floor(box.minX), x1 = Math.floor(box.maxX);
  const y0 = Math.floor(box.minY), y1 = Math.floor(box.maxY);
  const z0 = Math.floor(box.minZ), z1 = Math.floor(box.maxZ);
  const p = e.physics;
  p.wasInPowderSnow = p.inPowderSnow;
  p.inPowderSnow = false;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const st = world.getBlockState(x, y, z);
        if (st === 0 || stateFlags[st]! & F.AIR) continue;
        const name = blockOf(st).name;
        switch (name) {
          case 'cobweb':
            p.stuckX = 0.25; p.stuckY = 0.05; p.stuckZ = 0.25;
            p.fallDistance = 0;
            break;
          case 'sweet_berry_bush':
            if (e.type !== 'fox' && e.type !== 'bee') { p.stuckX = 0.8; p.stuckY = 0.75; p.stuckZ = 0.8; }
            break;
          case 'powder_snow':
            if (!(e.meta?.['leatherBoots'])) {
              p.stuckX = 0.9; p.stuckY = 1.5; p.stuckZ = 0.9;
            }
            p.inPowderSnow = true;
            break;
          case 'honey_block':
            break;
          case 'bubble_column': {
            const drag = getValue(st, P.drag);
            const above = world.getBlockState(x, y + 1, z);
            const surface = stateFlags[above]! & F.AIR;
            if (surface) p.vy = drag ? Math.max(-0.9, p.vy - 0.03) : Math.min(1.8, p.vy + 0.1);
            else p.vy = drag ? Math.max(-0.3, p.vy - 0.03) : Math.min(0.7, p.vy + 0.06);
            p.fallDistance = 0;
            break;
          }
        }
        world.onEntityInside?.(e, st, x, y, z);
      }
    }
  }
  // Honey block sliding
  const t = e.transform;
  if (!p.onGround && p.vy < -0.08) {
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const hx = Math.floor(t.x + dx * (p.width / 2 + 0.01));
      const hz = Math.floor(t.z + dz * (p.width / 2 + 0.01));
      if (blockOf(world.getBlockState(hx, Math.floor(t.y), hz)).name === 'honey_block') {
        const dist = dx !== 0 ? Math.abs(t.x - (hx + 0.5)) : Math.abs(t.z - (hz + 0.5));
        if (dist > 0.4375 + p.width / 2 - 0.02) {
          p.vy = -0.05;
          p.fallDistance = 0;
          break;
        }
      }
    }
  }
}

/** Apply movement input as acceleration relative to yaw. */
export function moveRelative(e: PE, speed: number, strafe: number, up: number, forward: number): void {
  let len = strafe * strafe + up * up + forward * forward;
  if (len < 1e-7) return;
  let sx = strafe, sy = up, sz = forward;
  if (len > 1) {
    len = Math.sqrt(len);
    sx /= len; sy /= len; sz /= len;
  }
  sx *= speed; sy *= speed; sz *= speed;
  const yaw = e.transform.yaw * DEG;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  e.physics.vx += sx * c - sz * s;
  e.physics.vy += sy;
  e.physics.vz += sz * c + sx * s;
}

export interface TravelOptions {
  /** Lava push strength (dimension dependent). */
  lavaPush: number;
  /** Depth strider level. */
  depthStrider: number;
  dolphinsGrace: boolean;
  slowFalling: boolean;
  levitation: number; // amplifier+1, 0 = none
  jumpBoost: number; // amplifier+1, 0 = none
  /** Horizontal speed modifier from status effects (speed/slowness). */
  speedMultiplier: number;
  /** Elytra firework boost ticks remaining. */
  fireworkBoost: number;
}

export const DEFAULT_TRAVEL: TravelOptions = {
  lavaPush: 0.0023333333333333335, depthStrider: 0, dolphinsGrace: false, slowFalling: false, levitation: 0, jumpBoost: 0, speedMultiplier: 1, fireworkBoost: 0,
};

/**
 * One tick of self-driven movement (reference LivingEntity.aiStep + travel).
 * Reads `e.input`, updates `e.physics` and `e.transform`.
 */
export function tickLivingMovement(world: PhysicsWorld, e: PE & { input: MoveInput }, opts: TravelOptions = DEFAULT_TRAVEL): void {
  const p = e.physics;
  const inp = e.input;
  if (p.noJumpDelay > 0) p.noJumpDelay--;
  // Kill tiny velocities
  if (Math.abs(p.vx) < 0.003) p.vx = 0;
  if (Math.abs(p.vy) < 0.003) p.vy = 0;
  if (Math.abs(p.vz) < 0.003) p.vz = 0;

  updateFluidState(world, e, opts.lavaPush);

  // Input scaling (0.98 factor, sneaking, item use)
  let forward = inp.forward * 0.98;
  let strafe = inp.strafe * 0.98;
  if (e.type === 'player') {
    if (inp.sneaking && !inp.flying && !inp.swimming) {
      forward *= 0.3;
      strafe *= 0.3;
    }
    if (inp.usingItem) {
      forward *= 0.2;
      strafe *= 0.2;
    }
  }

  // Jumping
  if (inp.jumping && !inp.flying) {
    const fluidH = p.inLava ? p.lavaHeight : p.waterHeight;
    const threshold = p.eyeHeight < 0.4 ? 0 : 0.4;
    const inFluid = (p.inWater || p.inLava) && fluidH > 0;
    if (inFluid && (!p.onGround || fluidH > threshold)) {
      p.vy += 0.04; // jumpInLiquid
    } else if ((p.onGround || (inFluid && fluidH <= threshold)) && p.noJumpDelay === 0) {
      jumpFromGround(world, e, opts);
      p.noJumpDelay = 10;
    }
  } else {
    p.noJumpDelay = 0;
  }

  // Creative flight vertical control
  if (inp.flying && e.type === 'player') {
    let vy = 0;
    if (inp.sneaking) vy -= inp.flySpeed * 3;
    if (inp.jumping) vy += inp.flySpeed * 3;
    if (vy !== 0) p.vy += vy;
  }

  travel(world, e, strafe, inp.up, forward, opts);
}

function jumpFromGround(world: PhysicsWorld, e: PE & { input: MoveInput }, opts: TravelOptions): void {
  const p = e.physics;
  const power = 0.42 * jumpFactorAt(world, e.transform) + (opts.jumpBoost > 0 ? 0.1 * opts.jumpBoost : 0);
  p.vy = Math.max(power, p.vy);
  if (e.input.sprinting) {
    const yaw = e.transform.yaw * DEG;
    p.vx += -Math.sin(yaw) * 0.2;
    p.vz += Math.cos(yaw) * 0.2;
  }
}

/** Reference `travel(input)`. */
export function travel(world: PhysicsWorld, e: PE & { input: MoveInput }, strafe: number, up: number, forward: number, opts: TravelOptions): void {
  const p = e.physics;
  const inp = e.input;
  const t = e.transform;
  if (inp.flying && e.type === 'player') {
    const vyBefore = p.vy;
    const fly = inp.flySpeed * (inp.sprinting ? 2 : 1);
    moveRelative(e, fly, strafe, up, forward);
    move(world, e, p.vx, p.vy, p.vz);
    p.vx *= 0.91;
    p.vz *= 0.91;
    p.vy = vyBefore * 0.6;
    p.fallDistance = 0;
    return;
  }
  const falling = p.vy <= 0;
  let gravity = p.noGravity ? 0 : p.gravity;
  if (falling && opts.slowFalling) gravity = Math.min(gravity, 0.01);

  if (p.inWater && !inp.flying) {
    const y0 = t.y;
    let slow = inp.sprinting ? 0.9 : (e.type === 'player' ? 0.8 : waterSlowDown(e));
    let accel = 0.02;
    let ds = Math.min(3, opts.depthStrider);
    if (!p.onGround) ds *= 0.5;
    if (ds > 0) {
      slow += (0.54600006 - slow) * ds / 3;
      accel += (inp.speed * opts.speedMultiplier - accel) * ds / 3;
    }
    if (opts.dolphinsGrace) slow = 0.96;
    moveRelative(e, accel, strafe, up, forward);
    move(world, e, p.vx, p.vy, p.vz);
    if (p.horizontalCollision && onClimbable(world, e)) p.vy = 0.2;
    p.vx *= slow;
    p.vy *= 0.8;
    p.vz *= slow;
    // getFluidFallingAdjustedMovement
    if (!p.noGravity && !inp.sprinting) {
      if (falling && Math.abs(p.vy - 0.005) >= 0.003 && Math.abs(p.vy - gravity / 16) < 0.003) p.vy = -0.003;
      else p.vy -= gravity / 16;
    }
    if (p.horizontalCollision && isFree(world, e, entityBox(e).move(p.vx, p.vy + 0.6 - t.y + y0, p.vz))) p.vy = 0.3;
    return;
  }
  if (p.inLava && !inp.flying && !(e.type === 'strider')) {
    const y0 = t.y;
    moveRelative(e, 0.02, strafe, up, forward);
    move(world, e, p.vx, p.vy, p.vz);
    if (p.lavaHeight <= (p.eyeHeight < 0.4 ? 0 : 0.4)) {
      p.vx *= 0.5; p.vy *= 0.8; p.vz *= 0.5;
      if (!p.noGravity) {
        if (falling && Math.abs(p.vy - 0.005) >= 0.003 && Math.abs(p.vy - gravity / 16) < 0.003) p.vy = -0.003;
        else p.vy -= gravity / 16;
      }
    } else {
      p.vx *= 0.5; p.vy *= 0.5; p.vz *= 0.5;
    }
    if (!p.noGravity) p.vy -= gravity / 4;
    if (p.horizontalCollision && isFree(world, e, entityBox(e).move(p.vx, p.vy + 0.6 - t.y + y0, p.vz))) p.vy = 0.3;
    return;
  }
  if (inp.fallFlying) {
    elytraTravel(world, e, gravity, opts);
    return;
  }
  // Ground / air
  const friction = p.onGround ? frictionOf(world.getBlockState(Math.floor(t.x), Math.floor(t.y - 0.5000001), Math.floor(t.z))) : 1;
  const f3 = p.onGround ? friction * 0.91 : 0.91;
  const speed = p.onGround
    ? inp.speed * inp.speedModifier * opts.speedMultiplier * (inp.sprinting ? 1.3 : 1) * (0.21600002 / (friction * friction * friction))
    : (e.type === 'player' ? (inp.sprinting ? 0.025999999 : 0.02) : inp.airSpeed ?? 0.02);
  moveRelative(e, speed, strafe, up, forward);
  // Climbing
  const climbing = onClimbable(world, e);
  if (climbing) {
    p.fallDistance = 0;
    p.vx = Math.max(-0.15, Math.min(0.15, p.vx));
    p.vz = Math.max(-0.15, Math.min(0.15, p.vz));
    p.vy = Math.max(p.vy, -0.15);
    if (p.vy < 0 && inp.sneaking && e.type === 'player' && !isScaffoldingAt(world, e)) p.vy = 0;
  }
  move(world, e, p.vx, p.vy, p.vz);
  if ((p.horizontalCollision || inp.jumping) && (climbing || (p.wasInPowderSnow && e.meta?.['leatherBoots']))) p.vy = 0.2;
  let vy = p.vy;
  if (opts.levitation > 0) vy += (0.05 * opts.levitation - vy) * 0.2;
  else if (world.isLoaded && !world.isLoaded(t.x, t.z)) vy = 0;
  else vy -= gravity;
  p.vx *= f3;
  p.vy = vy * 0.98;
  p.vz *= f3;
}

function isScaffoldingAt(world: BlockGetter, e: PE): boolean {
  return blockOf(world.getBlockState(Math.floor(e.transform.x), Math.floor(e.transform.y), Math.floor(e.transform.z))).name === 'scaffolding';
}

function waterSlowDown(e: Entity): number {
  if (e.type === 'skeleton_horse') return 0.96;
  if (e.type === 'polar_bear') return 0.98;
  return 0.8;
}

function elytraTravel(world: PhysicsWorld, e: PE & { input: MoveInput }, gravity: number, opts: TravelOptions): void {
  const p = e.physics;
  const t = e.transform;
  const pitch = t.pitch * DEG;
  const yaw = t.yaw * DEG;
  const lx = -Math.sin(yaw) * Math.cos(pitch);
  const ly = -Math.sin(pitch);
  const lz = Math.cos(yaw) * Math.cos(pitch);
  if (opts.fireworkBoost > 0) {
    p.vx += lx * 0.1 + (lx * 1.5 - p.vx) * 0.5;
    p.vy += ly * 0.1 + (ly * 1.5 - p.vy) * 0.5;
    p.vz += lz * 0.1 + (lz * 1.5 - p.vz) * 0.5;
  }
  const hlook = Math.sqrt(lx * lx + lz * lz);
  const hvel = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  const len = Math.sqrt(lx * lx + ly * ly + lz * lz);
  let cosP = Math.cos(pitch);
  cosP = cosP * cosP * Math.min(1, len / 0.4);
  p.vy += gravity * (-1 + cosP * 0.75);
  if (p.vy < 0 && hlook > 0) {
    const d = p.vy * -0.1 * cosP;
    p.vx += (lx * d) / hlook;
    p.vy += d;
    p.vz += (lz * d) / hlook;
  }
  if (pitch < 0 && hlook > 0) {
    const d = hvel * -Math.sin(pitch) * 0.04;
    p.vx += (-lx * d) / hlook;
    p.vy += d * 3.2;
    p.vz += (-lz * d) / hlook;
  }
  if (hlook > 0) {
    p.vx += ((lx / hlook) * hvel - p.vx) * 0.1;
    p.vz += ((lz / hlook) * hvel - p.vz) * 0.1;
  }
  p.vx *= 0.99;
  p.vy *= 0.98;
  p.vz *= 0.99;
  const before = Math.hypot(p.vx, p.vz);
  move(world, e, p.vx, p.vy, p.vz);
  if (p.horizontalCollision) {
    const after = Math.hypot(p.vx, p.vz);
    const dmg = (before - after) * 10 - 3;
    if (dmg > 0) (e as Entity & { pendingFlyIntoWall?: number }).pendingFlyIntoWall = dmg;
  }
  if (p.onGround) e.input.fallFlying = false;
}

/** Simple physics for non-living entities (items, projectiles handle their own). */
export function tickItemPhysics(world: PhysicsWorld, e: PE): void {
  const p = e.physics;
  updateFluidState(world, e, 0.0023333333333333335);
  if (p.inWater && p.waterHeight > 0.1111111) {
    // float up
    p.vx *= 0.99;
    p.vz *= 0.99;
    if (p.vy < 0.06) p.vy += 0.0005;
  } else if (p.inLava && p.lavaHeight > 0.1111111) {
    p.vx *= 0.95;
    p.vz *= 0.95;
    if (p.vy < 0.06) p.vy += 0.0005;
  } else if (!p.noGravity) {
    p.vy -= p.gravity;
  }
  move(world, e, p.vx, p.vy, p.vz);
  let f = 0.98;
  if (p.onGround) f = frictionOf(world.getBlockState(Math.floor(e.transform.x), Math.floor(e.transform.y - 0.99), Math.floor(e.transform.z))) * 0.98;
  p.vx *= f;
  p.vy *= 0.98;
  p.vz *= f;
  if (p.onGround && p.vy < 0) p.vy *= -0.5;
}
