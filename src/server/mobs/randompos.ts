/**
 * Random target positions for wandering, fleeing and flying (reference RandomPos,
 * DefaultRandomPos, LandRandomPos, HoverRandomPos, AirAndWaterRandomPos). Candidates are
 * scored with the mob's walk target value; the best of ten tries wins.
 */
import { stateFlags, F } from '../../common/block/registry';
import { staticPathType } from './pathfinding';
import type { Mob } from './mob';

export type Vec3 = [number, number, number];
type BlockPos = [number, number, number];

function randomDirection(m: Mob, h: number, v: number): BlockPos {
  const r = m.random;
  return [r.nextInt(2 * h + 1) - h, r.nextInt(2 * v + 1) - v, r.nextInt(2 * h + 1) - h];
}

function randomDirectionWithin(m: Mob, h: number, v: number, yOffset: number, dirX: number, dirZ: number, maxAngle: number): BlockPos | null {
  const r = m.random;
  const base = Math.atan2(dirZ, dirX) - Math.PI / 2;
  const a = base + (2 * r.nextFloat() - 1) * maxAngle;
  const d = Math.sqrt(r.nextDouble()) * Math.SQRT2 * h;
  const x = -d * Math.sin(a), z = d * Math.cos(a);
  if (Math.abs(x) > h || Math.abs(z) > h) return null;
  const y = r.nextInt(2 * v + 1) - v + yOffset;
  return [Math.floor(x), y, Math.floor(z)];
}

/** Offset relative to the mob, biased back towards its home when restricted. */
function towardDirection(m: Mob, radius: number, dir: BlockPos): BlockPos {
  let i = dir[0], j = dir[2];
  const r = m.random;
  if (m.hasRestriction() && radius > 1) {
    const c = m.restrictCenter!;
    const half = Math.max(1, Math.floor(radius / 2));
    if (m.x > c[0]) i -= r.nextInt(half); else i += r.nextInt(half);
    if (m.z > c[2]) j -= r.nextInt(half); else j += r.nextInt(half);
  }
  return [Math.floor(i + m.x), Math.floor(dir[1] + m.y), Math.floor(j + m.z)];
}

function restricted(m: Mob, radius: number): boolean {
  if (!m.hasRestriction()) return false;
  const c = m.restrictCenter!;
  const d = Math.sqrt((c[0] + 0.5 - m.x) ** 2 + (c[1] + 0.5 - m.y) ** 2 + (c[2] + 0.5 - m.z) ** 2);
  return d < m.restrictRadius + radius + 1;
}

const outsideLimits = (m: Mob, p: BlockPos) => p[1] < m.level.minY || p[1] > m.level.maxY;
const isRestricted = (flag: boolean, m: Mob, p: BlockPos) => flag && !m.isWithinRestriction(p[0], p[1], p[2]);
const notStable = (m: Mob, p: BlockPos) => !m.nav.isStableDestination(p[0], p[1], p[2]);
const hasMalus = (m: Mob, p: BlockPos) => m.nav.malus[staticPathType(m.level, p[0], p[1], p[2])] !== 0;
const isWater = (m: Mob, p: BlockPos) => (stateFlags[m.level.getBlockState(p[0], p[1], p[2])]! & F.WATER) !== 0;
const isSolid = (m: Mob, p: BlockPos) => (stateFlags[m.level.getBlockState(p[0], p[1], p[2])]! & F.SOLID) !== 0;

function moveUpOutOfSolid(m: Mob, p: BlockPos): BlockPos {
  const out: BlockPos = [p[0], p[1], p[2]];
  while (out[1] < m.level.maxY && isSolid(m, out)) out[1]++;
  return out;
}

function moveUpToAboveSolid(m: Mob, p: BlockPos, amount: number): BlockPos {
  if (amount < 0) throw new Error('amount must be positive');
  if (!isSolid(m, p)) return p;
  const q: BlockPos = [p[0], p[1] + 1, p[2]];
  while (q[1] < m.level.maxY && isSolid(m, q)) q[1]++;
  const top = q[1];
  while (q[1] < m.level.maxY && q[1] - top < amount) {
    const above: BlockPos = [q[0], q[1] + 1, q[2]];
    if (isSolid(m, above)) break;
    q[1]++;
  }
  return q;
}

/** Best-scored of ten candidates (reference RandomPos.generateRandomPos). */
function best(m: Mob, supplier: () => BlockPos | null): Vec3 | null {
  let bestScore = -Infinity;
  let bestPos: BlockPos | null = null;
  for (let i = 0; i < 10; i++) {
    const p = supplier();
    if (!p) continue;
    const s = m.def.walkTargetValue ? m.def.walkTargetValue(m, p[0], p[1], p[2]) : m.walkTargetValue(p[0], p[1], p[2]);
    if (s > bestScore) {
      bestScore = s;
      bestPos = p;
    }
  }
  return bestPos ? [bestPos[0] + 0.5, bestPos[1], bestPos[2] + 0.5] : null;
}

function defaultToward(m: Mob, radius: number, flag: boolean, dir: BlockPos): BlockPos | null {
  const p = towardDirection(m, radius, dir);
  return !outsideLimits(m, p) && !isRestricted(flag, m, p) && !notStable(m, p) && !hasMalus(m, p) ? p : null;
}

function landToward(m: Mob, radius: number, flag: boolean, dir: BlockPos): BlockPos | null {
  const p = towardDirection(m, radius, dir);
  return !outsideLimits(m, p) && !isRestricted(flag, m, p) && !notStable(m, p) ? p : null;
}

function landUp(m: Mob, p: BlockPos): BlockPos | null {
  const q = moveUpOutOfSolid(m, p);
  return !isWater(m, q) && !hasMalus(m, q) ? q : null;
}

/** Anywhere nearby (walkable, no malus). */
export function defaultRandomPos(m: Mob, h: number, v: number): Vec3 | null {
  const flag = restricted(m, h);
  return best(m, () => defaultToward(m, h, flag, randomDirection(m, h, v)));
}

export function defaultPosAway(m: Mob, h: number, v: number, from: Vec3): Vec3 | null {
  const dx = m.x - from[0], dz = m.z - from[2];
  const flag = restricted(m, h);
  return best(m, () => {
    const d = randomDirectionWithin(m, h, v, 0, dx, dz, Math.PI / 2);
    return d ? defaultToward(m, h, flag, d) : null;
  });
}

export function defaultPosTowards(m: Mob, h: number, v: number, to: Vec3, maxAngle: number): Vec3 | null {
  const dx = to[0] - m.x, dz = to[2] - m.z;
  const flag = restricted(m, h);
  return best(m, () => {
    const d = randomDirectionWithin(m, h, v, 0, dx, dz, maxAngle);
    return d ? defaultToward(m, h, flag, d) : null;
  });
}

/** On land (not water), moved up out of solid blocks. */
export function landRandomPos(m: Mob, h: number, v: number): Vec3 | null {
  const flag = restricted(m, h);
  return best(m, () => {
    const p = landToward(m, h, flag, randomDirection(m, h, v));
    return p ? landUp(m, p) : null;
  });
}

function landInDirection(m: Mob, h: number, v: number, dx: number, dz: number): Vec3 | null {
  const flag = restricted(m, h);
  return best(m, () => {
    const d = randomDirectionWithin(m, h, v, 0, dx, dz, Math.PI / 2);
    if (!d) return null;
    const p = landToward(m, h, flag, d);
    return p ? landUp(m, p) : null;
  });
}

export function landPosTowards(m: Mob, h: number, v: number, to: Vec3): Vec3 | null {
  return landInDirection(m, h, v, to[0] - m.x, to[2] - m.z);
}

export function landPosAway(m: Mob, h: number, v: number, from: Vec3): Vec3 | null {
  return landInDirection(m, h, v, m.x - from[0], m.z - from[2]);
}

/** Flyers: hover some blocks above the ground in a cone around a direction. */
export function hoverRandomPos(m: Mob, h: number, v: number, dirX: number, dirZ: number, maxAngle: number, aboveSolid: number, belowSolid: number): Vec3 | null {
  const flag = restricted(m, h);
  return best(m, () => {
    const d = randomDirectionWithin(m, h, v, 0, dirX, dirZ, maxAngle);
    if (!d) return null;
    const p = landToward(m, h, flag, d);
    if (!p) return null;
    const q = moveUpToAboveSolid(m, p, m.random.nextInt(aboveSolid - belowSolid + 1) + belowSolid);
    return !isWater(m, q) && !hasMalus(m, q) ? q : null;
  });
}

/** Flyers and swimmers: anywhere open in a cone (reference AirAndWaterRandomPos). */
export function airAndWaterRandomPos(m: Mob, h: number, v: number, yOffset: number, dirX: number, dirZ: number, maxAngle: number): Vec3 | null {
  const flag = restricted(m, h);
  return best(m, () => {
    const d = randomDirectionWithin(m, h, v, yOffset, dirX, dirZ, maxAngle);
    if (!d) return null;
    const p = towardDirection(m, h, d);
    if (outsideLimits(m, p) || isRestricted(flag, m, p)) return null;
    const q = moveUpOutOfSolid(m, p);
    return hasMalus(m, q) ? null : q;
  });
}

/** Random position whose block is water (fish, squid). */
export function swimmablePos(m: Mob, h: number, v: number): Vec3 | null {
  let p = defaultRandomPos(m, h, v);
  for (let i = 0; p && !isWater(m, [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])]) && i < 10; i++) p = defaultRandomPos(m, h, v);
  return p;
}

/** Nearest water block within a horizontal radius (panicking burning mobs, fish on land). */
export function nearestWater(m: Mob, h: number, v: number): Vec3 | null {
  const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
  let bestD = Infinity;
  let found: Vec3 | null = null;
  for (let dy = -v; dy <= v; dy++) {
    for (let dx = -h; dx <= h; dx++) {
      for (let dz = -h; dz <= h; dz++) {
        const d = dx * dx + dy * dy + dz * dz;
        if (d >= bestD) continue;
        if (isWater(m, [bx + dx, by + dy, bz + dz])) {
          bestD = d;
          found = [bx + dx + 0.5, by + dy, bz + dz + 0.5];
        }
      }
    }
  }
  return found;
}
