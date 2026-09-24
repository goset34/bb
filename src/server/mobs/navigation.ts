/**
 * Path navigation (reference PathNavigation and its ground, flying, water, amphibious and wall
 * climbing variants): builds paths with the pathfinder and feeds waypoints to the move control,
 * with corner cutting, stuck detection and timeouts.
 */
import type { Entity } from '../../common/entity/ecs';
import { stateFlags, F, getCollisionShape, blockHasTag, blockOf } from '../../common/block/registry';
import {
  Path, PathMob, PathMode, PathType, findPath, malusTable, staticPathType,
} from './pathfinding';
import type { Mob } from './mob';

type Vec3 = [number, number, number];

export class PathNavigation {
  path: Path | null = null;
  speedModifier = 0;
  protected tickCount = 0;
  private lastStuckCheck = 0;
  private lastStuckPos: Vec3 = [0, 0, 0];
  private timeoutNode = '';
  private timeoutTimer = 0;
  private lastTimeoutCheck = 0;
  private timeoutLimit = 0;
  protected maxDistanceToWaypoint = 0.5;
  private targetPos: Vec3 | null = null;
  private reachRange = 0;
  private hasDelayedRecomputation = false;
  private timeLastRecompute = 0;
  isStuck = false;
  canOpenDoors: boolean;
  canPassDoors: boolean;
  canFloat: boolean;
  /** Skeletons/zombies avoid open sky during the day (reference RestrictSunGoal). */
  avoidSun = false;
  maxVisitedMultiplier = 1;
  readonly malus: Float64Array;

  constructor(protected readonly mob: Mob, readonly mode: PathMode) {
    const d = mob.def;
    this.malus = malusTable(d.malus ?? {});
    this.canOpenDoors = !!d.canOpenDoors;
    this.canPassDoors = d.canPassDoors ?? true;
    this.canFloat = d.canFloat ?? mode === PathMode.WALK;
    if (d.fireImmune && d.malus?.[PathType.LAVA] === undefined) {
      this.malus[PathType.DANGER_FIRE] = 0;
      this.malus[PathType.DAMAGE_FIRE] = 0;
    }
  }

  setMalus(t: PathType, v: number): void {
    this.malus[t] = v;
  }

  protected pathMob(): PathMob {
    const m = this.mob, d = m.def;
    return {
      mode: this.mode, width: m.width, height: m.height, stepHeight: m.e.physics.stepHeight, maxFall: d.maxFall ?? 3,
      canOpenDoors: this.canOpenDoors, canPassDoors: this.canPassDoors, canFloat: this.canFloat, canBreach: this.mode === PathMode.SWIM && !!d.canBreach,
      malus: this.malus,
    };
  }

  /** The navigator may compute a new path now (on the ground or swimming). */
  canUpdatePath(): boolean {
    const p = this.mob.e.physics;
    return p.onGround || p.inWater || p.inLava || !!this.mob.e['vehicle'];
  }

  protected tempPos(): Vec3 {
    return [this.mob.x, this.surfaceY(), this.mob.z];
  }

  private surfaceY(): number {
    const m = this.mob;
    if (m.inWater && this.canFloat) {
      let y = Math.floor(m.y);
      for (let j = 0; blockOf(m.level.getBlockState(Math.floor(m.x), y, Math.floor(m.z))).name === 'water'; j++) {
        y++;
        if (j > 16) return Math.floor(m.y);
      }
      return y;
    }
    return Math.floor(m.y + 0.5);
  }

  /** Destination is a place the mob can stand (ground navigation: solid block below). */
  isStableDestination(x: number, y: number, z: number): boolean {
    return (stateFlags[this.mob.level.getBlockState(x, y - 1, z)]! & F.SOLID) !== 0;
  }

  isWalkableAt(x: number, y: number, z: number): boolean {
    return staticPathType(this.mob.level, x, y, z) === PathType.WALKABLE;
  }

  /** Adjust a target block position (ground: snap to the surface). */
  protected adjustTarget(x: number, y: number, z: number): Vec3 | null {
    const level = this.mob.level;
    if (!level.isLoaded(x, z)) return null;
    const s = level.getBlockState(x, y, z);
    if (stateFlags[s]! & F.AIR) {
      let by = y - 1;
      while (by > level.minY && (stateFlags[level.getBlockState(x, by, z)]! & F.AIR)) by--;
      if (by > level.minY) return [x, by + 1, z];
      let ay = y + 1;
      while (ay < level.maxY && (stateFlags[level.getBlockState(x, ay, z)]! & F.AIR)) ay++;
      return [x, ay, z];
    }
    if (!(stateFlags[s]! & F.SOLID)) return [x, y, z];
    let ay = y + 1;
    while (ay < level.maxY && (stateFlags[level.getBlockState(x, ay, z)]! & F.SOLID)) ay++;
    return [x, ay, z];
  }

  createPath(targets: Vec3[], reach: number): Path | null {
    const m = this.mob;
    if (!targets.length || m.y < m.level.minY || !this.canUpdatePath()) return null;
    if (this.path && !this.path.done && this.targetPos && targets.some((t) => t[0] === this.targetPos![0] && t[1] === this.targetPos![1] && t[2] === this.targetPos![2])) return this.path;
    const range = m.attr('follow_range');
    const p = m.e.physics;
    const path = findPath(m.level, this.pathMob(), { x: m.x, y: m.y, z: m.z, onGround: p.onGround, inWater: p.inWater }, {
      targets, reach, maxVisited: Math.floor(range * 16 * this.maxVisitedMultiplier), maxRange: range,
    });
    if (path) {
      this.targetPos = path.target;
      this.reachRange = reach;
      this.resetStuckTimeout();
    }
    return path;
  }

  createPathTo(x: number, y: number, z: number, reach: number): Path | null {
    const t = this.adjustTarget(Math.floor(x), Math.floor(y), Math.floor(z));
    return t ? this.createPath([t], reach) : null;
  }

  createPathToEntity(e: Entity, reach: number): Path | null {
    const t = e.transform!;
    return this.createPathTo(t.x, t.y, t.z, reach);
  }

  moveTo(x: number, y: number, z: number, speed: number, reach = 1): boolean {
    return this.moveAlong(this.createPathTo(x, y, z, reach), speed);
  }

  moveToEntity(e: Entity, speed: number): boolean {
    return this.moveAlong(this.createPathToEntity(e, 1), speed);
  }

  moveAlong(path: Path | null, speed: number): boolean {
    if (!path) {
      this.path = null;
      return false;
    }
    if (!path.sameAs(this.path)) this.path = path;
    if (this.isDone()) return false;
    this.trimPath();
    if (this.path!.nodes.length <= 0) return false;
    this.speedModifier = speed;
    this.lastStuckCheck = this.tickCount;
    this.lastStuckPos = this.tempPos();
    return true;
  }

  isDone(): boolean {
    return !this.path || this.path.done;
  }

  isInProgress(): boolean {
    return !this.isDone();
  }

  stop(): void {
    this.path = null;
  }

  setSpeedModifier(v: number): void {
    this.speedModifier = v;
  }

  /** Position of the mob's centre when standing on a path node. */
  protected nodePos(i: number): Vec3 {
    const n = this.path!.nodes[i]!;
    const off = Math.floor(this.mob.width + 1) * 0.5;
    return [n.x + off, n.y, n.z + off];
  }

  protected groundY(x: number, y: number, z: number): number {
    const level = this.mob.level;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const below = level.getBlockState(bx, by - 1, bz);
    if (stateFlags[below]! & F.AIR) return y;
    const shape = getCollisionShape(below);
    let top = 0;
    for (let i = 0; i < shape.length; i += 6) top = Math.max(top, shape[i + 4]!);
    return by - 1 + (shape.length ? top : 0);
  }

  protected trimPath(): void {
    const path = this.path;
    if (!path) return;
    const level = this.mob.level;
    // Step over cauldrons instead of into them
    for (let i = 0; i < path.nodes.length; i++) {
      const n = path.nodes[i]!;
      const name = blockOf(level.getBlockState(n.x, n.y, n.z)).name;
      if (name.endsWith('cauldron')) {
        const next = path.nodes[i + 1];
        path.nodes[i] = { ...n, y: n.y + 1 };
        if (next && n.y >= next.y) path.nodes[i + 1] = { ...next, y: n.y + 1 };
      }
    }
    if (this.avoidSun) {
      const m = this.mob;
      if (level.canSeeSky(Math.floor(m.x), Math.floor(m.y + 0.5), Math.floor(m.z))) return;
      for (let i = 0; i < path.nodes.length; i++) {
        const n = path.nodes[i]!;
        if (level.canSeeSky(n.x, n.y, n.z)) {
          path.nodes.length = i;
          return;
        }
      }
    }
  }

  /** Blocks changed near the path: recompute (at most once per second). */
  recomputePath(): void {
    if (this.mob.gameTime - this.timeLastRecompute > 20) {
      if (this.targetPos) {
        this.path = null;
        this.path = this.createPath([this.targetPos], this.reachRange);
        this.timeLastRecompute = this.mob.gameTime;
        this.hasDelayedRecomputation = false;
      }
    } else this.hasDelayedRecomputation = true;
  }

  /** A block changed: recompute when it lies on the remaining path. */
  blockChanged(x: number, y: number, z: number): void {
    const path = this.path;
    if (!path || path.done || path.nodes.length === 0) return;
    const end = path.end!;
    const cx = (this.mob.x + end.x) / 2, cy = (this.mob.y + end.y) / 2, cz = (this.mob.z + end.z) / 2;
    const r = path.nodes.length - path.index;
    if ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 < r * r) this.recomputePath();
  }

  tick(): void {
    this.tickCount++;
    if (this.hasDelayedRecomputation) this.recomputePath();
    if (this.isDone()) return;
    if (this.canUpdatePath()) this.followThePath();
    else if (this.path && !this.path.done) {
      const v = this.tempPos();
      const next = this.nodePos(this.path.index);
      if (v[1] > next[1] && !this.mob.onGround && Math.floor(v[0]) === Math.floor(next[0]) && Math.floor(v[2]) === Math.floor(next[2])) this.path.advance();
    }
    if (this.isDone()) return;
    const [x, y, z] = this.nodePos(this.path!.index);
    this.mob.move.setWantedPosition(x, this.groundY(x, y, z), z, this.speedModifier);
  }

  protected canCutCorner(t: PathType): boolean {
    return t !== PathType.DANGER_FIRE && t !== PathType.DANGER_OTHER && t !== PathType.WALKABLE_DOOR;
  }

  /** Straight-line movement is possible without obstacles (flying / swimming navigators). */
  protected canMoveDirectly(_from: Vec3, _to: Vec3): boolean {
    return false;
  }

  protected followThePath(): void {
    const m = this.mob, path = this.path!;
    const v = this.tempPos();
    this.maxDistanceToWaypoint = m.width > 0.75 ? m.width / 2 : 0.75 - m.width / 2;
    const next = path.next!;
    const dx = Math.abs(m.x - (next.x + 0.5)), dy = Math.abs(m.y - next.y), dz = Math.abs(m.z - (next.z + 0.5));
    const close = dx < this.maxDistanceToWaypoint && dz < this.maxDistanceToWaypoint && dy < 1;
    if (close || (this.canCutCorner(next.type) && this.shouldTargetNextNode(v))) path.advance();
    this.doStuckDetection(v);
  }

  private shouldTargetNextNode(v: Vec3): boolean {
    const path = this.path!;
    if (path.index + 1 >= path.nodes.length) return false;
    const n = path.nodes[path.index]!;
    const c: Vec3 = [n.x + 0.5, n.y, n.z + 0.5];
    const dsq = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    if (dsq(v, c) >= 4) return false;
    if (this.canMoveDirectly(v, this.nodePos(path.index))) return true;
    const n2 = path.nodes[path.index + 1]!;
    const c2: Vec3 = [n2.x + 0.5, n2.y, n2.z + 0.5];
    const a: Vec3 = [c[0] - v[0], c[1] - v[1], c[2] - v[2]];
    const b: Vec3 = [c2[0] - v[0], c2[1] - v[1], c2[2] - v[2]];
    const la = a[0] * a[0] + a[1] * a[1] + a[2] * a[2], lb = b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
    if (!(lb < la) && !(la < 0.5)) return false;
    const na = Math.sqrt(la) || 1, nb = Math.sqrt(lb) || 1;
    return (a[0] / na) * (b[0] / nb) + (a[1] / na) * (b[1] / nb) + (a[2] / na) * (b[2] / nb) < 0;
  }

  protected doStuckDetection(v: Vec3): void {
    const m = this.mob;
    if (this.tickCount - this.lastStuckCheck > 100) {
      const s = m.e.input.speed;
      const f = s >= 1 ? s : s * s;
      const f1 = f * 100 * 0.25;
      const d = (v[0] - this.lastStuckPos[0]) ** 2 + (v[1] - this.lastStuckPos[1]) ** 2 + (v[2] - this.lastStuckPos[2]) ** 2;
      if (d < f1 * f1) {
        this.isStuck = true;
        this.stop();
      } else this.isStuck = false;
      this.lastStuckCheck = this.tickCount;
      this.lastStuckPos = v;
    }
    const path = this.path;
    if (path && !path.done) {
      const n = path.next!;
      const key = `${n.x},${n.y},${n.z}`;
      const now = m.gameTime;
      if (key === this.timeoutNode) this.timeoutTimer += now - this.lastTimeoutCheck;
      else {
        this.timeoutNode = key;
        const d = Math.sqrt((v[0] - (n.x + 0.5)) ** 2 + (v[1] - n.y) ** 2 + (v[2] - (n.z + 0.5)) ** 2);
        const sp = m.e.input.speed;
        this.timeoutLimit = sp > 0 ? (d / sp) * 20 : 0;
      }
      if (this.timeoutLimit > 0 && this.timeoutTimer > this.timeoutLimit * 3) {
        this.resetStuckTimeout();
        this.stop();
      }
      this.lastTimeoutCheck = now;
    }
  }

  private resetStuckTimeout(): void {
    this.timeoutNode = '';
    this.timeoutTimer = 0;
    this.timeoutLimit = 0;
    this.isStuck = false;
  }

  /** Straight line free of collisions (used by flyers and swimmers to cut corners). */
  protected clearBetween(from: Vec3, to: Vec3): boolean {
    const level = this.mob.level;
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.ceil(len * 2);
    const hw = this.mob.width / 2;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const x = from[0] + dx * f, y = from[1] + dy * f, z = from[2] + dz * f;
      for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]] as const) {
        for (const oy of [0, this.mob.height * 0.9]) {
          const s = level.getBlockState(Math.floor(x + ox), Math.floor(y + oy), Math.floor(z + oz));
          if (getCollisionShape(s).length > 0 && !(stateFlags[s]! & F.NO_COLLISION)) return false;
        }
      }
    }
    return true;
  }
}

/** Flying mobs: always update, target nodes exactly, move in straight lines when possible. */
export class FlyingNavigation extends PathNavigation {
  constructor(mob: Mob) {
    super(mob, PathMode.FLY);
    this.canFloat = true;
  }
  override canUpdatePath(): boolean {
    return !this.mob.e['vehicle'];
  }
  protected override tempPos(): Vec3 {
    return [this.mob.x, this.mob.y, this.mob.z];
  }
  protected override adjustTarget(x: number, y: number, z: number): Vec3 | null {
    return this.mob.level.isLoaded(x, z) ? [x, y, z] : null;
  }
  override isStableDestination(x: number, y: number, z: number): boolean {
    return (stateFlags[this.mob.level.getBlockState(x, y - 1, z)]! & F.SOLID) !== 0;
  }
  override isWalkableAt(): boolean {
    return true;
  }
  protected override canMoveDirectly(from: Vec3, to: Vec3): boolean {
    return this.clearBetween(from, to);
  }
  override tick(): void {
    this.tickCount++;
    if (this.isDone()) return;
    this.followThePath();
    if (this.isDone()) return;
    const [x, y, z] = this.nodePos(this.path!.index);
    this.mob.move.setWantedPosition(x, y, z, this.speedModifier);
  }
}

/** Fully aquatic mobs. */
export class WaterNavigation extends PathNavigation {
  constructor(mob: Mob) {
    super(mob, PathMode.SWIM);
  }
  override canUpdatePath(): boolean {
    return !!this.mob.def.canBreach || this.mob.inWater;
  }
  protected override tempPos(): Vec3 {
    return [this.mob.x, this.mob.y + this.mob.height * 0.5, this.mob.z];
  }
  protected override adjustTarget(x: number, y: number, z: number): Vec3 | null {
    return this.mob.level.isLoaded(x, z) ? [x, y, z] : null;
  }
  override isStableDestination(x: number, y: number, z: number): boolean {
    return !(stateFlags[this.mob.level.getBlockState(x, y, z)]! & F.OPAQUE_CUBE);
  }
  override isWalkableAt(): boolean {
    return true;
  }
  protected override canMoveDirectly(from: Vec3, to: Vec3): boolean {
    return this.clearBetween(from, to);
  }
  override tick(): void {
    this.tickCount++;
    if (this.isDone()) return;
    if (this.canUpdatePath()) this.followThePath();
    if (this.isDone()) return;
    const [x, y, z] = this.nodePos(this.path!.index);
    this.mob.move.setWantedPosition(x, y, z, this.speedModifier);
  }
}

/** Turtles, frogs, axolotls, drowned: walk and swim. */
export class AmphibiousNavigation extends PathNavigation {
  constructor(mob: Mob) {
    super(mob, PathMode.AMPHIBIOUS);
  }
  override canUpdatePath(): boolean {
    return true;
  }
  protected override tempPos(): Vec3 {
    return [this.mob.x, this.mob.y + this.mob.height * 0.5, this.mob.z];
  }
  override isStableDestination(x: number, y: number, z: number): boolean {
    return !(stateFlags[this.mob.level.getBlockState(x, y - 1, z)]! & F.AIR);
  }
  protected override canMoveDirectly(from: Vec3, to: Vec3): boolean {
    return this.mob.inWater && this.clearBetween(from, to);
  }
}

/** Spiders: fall back to walking straight at the target (they climb walls). */
export class ClimberNavigation extends PathNavigation {
  private direct: Vec3 | null = null;

  constructor(mob: Mob) {
    super(mob, PathMode.WALK);
  }

  override moveToEntity(e: Entity, speed: number): boolean {
    const p = this.createPathToEntity(e, 0);
    if (p) return this.moveAlong(p, speed);
    const t = e.transform!;
    this.direct = [Math.floor(t.x), Math.floor(t.y), Math.floor(t.z)];
    this.speedModifier = speed;
    return true;
  }

  override stop(): void {
    super.stop();
    this.direct = null;
  }

  override tick(): void {
    if (!this.isDone()) {
      super.tick();
      return;
    }
    const d = this.direct;
    if (!d) return;
    const m = this.mob;
    const r = Math.max(m.width, 1);
    const near = (x: number, y: number, z: number) => (x + 0.5 - m.x) ** 2 + (y + 0.5 - m.y) ** 2 + (z + 0.5 - m.z) ** 2 < r * r;
    if (!near(d[0], d[1], d[2]) && !(m.y > d[1] && near(d[0], Math.floor(m.y), d[2]))) {
      m.move.setWantedPosition(d[0] + 0.5, d[1], d[2] + 0.5, this.speedModifier);
    } else this.direct = null;
  }
}

/** Whether a mob can climb the block it is pushing against (spider wall climbing). */
export function isClimbableWall(state: number): boolean {
  return (stateFlags[state]! & F.SOLID) !== 0 && !blockHasTag(blockOf(state), 'leaves');
}
