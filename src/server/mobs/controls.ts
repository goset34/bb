/**
 * Mob controls (reference MoveControl / LookControl / JumpControl / BodyRotationControl and the
 * flying, swimming and slime variants). Goals and navigation set wishes; controls turn them
 * into movement input and rotations once per tick.
 */
import { blockOf, getCollisionShape, blockHasTag } from '../../common/block/registry';
import { rotlerp, rotateTowards, rotateIfNecessary, wrapDegrees, yawTo, pitchTo } from './mob';
import type { Mob } from './mob';
import type { Entity } from '../../common/entity/ecs';

export const enum MoveOp { WAIT, MOVE_TO, STRAFE, JUMPING }

export class MoveControl {
  op = MoveOp.WAIT;
  wantedX = 0;
  wantedY = 0;
  wantedZ = 0;
  speedModifier = 0;
  strafeForward = 0;
  strafeRight = 0;

  constructor(protected readonly mob: Mob) {}

  hasWanted(): boolean {
    return this.op === MoveOp.MOVE_TO;
  }

  setWantedPosition(x: number, y: number, z: number, speed: number): void {
    this.wantedX = x;
    this.wantedY = y;
    this.wantedZ = z;
    this.speedModifier = speed;
    if (this.op !== MoveOp.JUMPING) this.op = MoveOp.MOVE_TO;
  }

  strafe(forward: number, right: number): void {
    this.op = MoveOp.STRAFE;
    this.strafeForward = forward;
    this.strafeRight = right;
    this.speedModifier = 0.25;
  }

  protected setSpeed(v: number): void {
    const inp = this.mob.e.input;
    inp.speed = v;
    inp.speedModifier = 1;
    inp.forward = v;
  }

  protected stopInput(): void {
    const inp = this.mob.e.input;
    inp.forward = 0;
    inp.strafe = 0;
    inp.up = 0;
  }

  tick(): void {
    const m = this.mob, e = m.e, t = e.transform, inp = e.input;
    if (this.op === MoveOp.STRAFE) {
      const f1 = this.speedModifier * m.speed;
      let f2 = this.strafeForward, f3 = this.strafeRight;
      let f4 = Math.sqrt(f2 * f2 + f3 * f3);
      if (f4 < 1) f4 = 1;
      f4 = f1 / f4;
      f2 *= f4;
      f3 *= f4;
      const s = Math.sin((t.yaw * Math.PI) / 180), c = Math.cos((t.yaw * Math.PI) / 180);
      const f5 = f2 * c - f3 * s, f6 = f3 * c + f2 * s;
      // Do not strafe off ledges or into unwalkable blocks
      if (!m.nav.isWalkableAt(Math.floor(m.x + f5), Math.floor(m.y), Math.floor(m.z + f6))) {
        this.strafeForward = 1;
        this.strafeRight = 0;
      }
      inp.speed = f1;
      inp.speedModifier = 1;
      inp.forward = this.strafeForward;
      inp.strafe = this.strafeRight;
      this.op = MoveOp.WAIT;
      return;
    }
    if (this.op === MoveOp.MOVE_TO) {
      this.op = MoveOp.WAIT;
      const dx = this.wantedX - m.x, dz = this.wantedZ - m.z, dy = this.wantedY - m.y;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 2.5e-7) {
        inp.forward = 0;
        return;
      }
      t.yaw = rotlerp(t.yaw, yawTo(dx, dz), 90);
      this.setSpeed(this.speedModifier * m.speed);
      inp.strafe = 0;
      // Jump when the next waypoint is higher or when standing inside a partial block
      const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
      const state = m.level.getBlockState(bx, by, bz);
      const shape = getCollisionShape(state);
      let top = 0;
      for (let i = 0; i < shape.length; i += 6) top = Math.max(top, shape[i + 4]!);
      const b = blockOf(state);
      if ((dy > e.physics.stepHeight && dx * dx + dz * dz < Math.max(1, m.width))
        || (shape.length > 0 && m.y < top + by && !blockHasTag(b, 'doors') && !blockHasTag(b, 'fences'))) {
        m.jump.jump();
        this.op = MoveOp.JUMPING;
      }
      return;
    }
    if (this.op === MoveOp.JUMPING) {
      this.setSpeed(this.speedModifier * m.speed);
      if (m.onGround) this.op = MoveOp.WAIT;
      return;
    }
    inp.forward = 0;
    inp.strafe = 0;
  }
}

/** Flying mobs (bees, parrots, allays, bats): no gravity while moving, pitch towards target. */
export class FlyingMoveControl extends MoveControl {
  constructor(mob: Mob, private readonly maxTurn: number, private readonly hoversInPlace: boolean) {
    super(mob);
  }

  override tick(): void {
    const m = this.mob, e = m.e, t = e.transform, inp = e.input;
    if (this.op === MoveOp.MOVE_TO) {
      this.op = MoveOp.WAIT;
      e.physics.noGravity = true;
      const dx = this.wantedX - m.x, dy = this.wantedY - m.y, dz = this.wantedZ - m.z;
      if (dx * dx + dy * dy + dz * dz < 2.5e-7) {
        inp.up = 0;
        inp.forward = 0;
        return;
      }
      t.yaw = rotlerp(t.yaw, yawTo(dx, dz), 90);
      const speed = m.onGround ? this.speedModifier * m.speed : this.speedModifier * m.attr('flying_speed');
      inp.speed = speed;
      inp.speedModifier = 1;
      inp.forward = speed;
      inp.airSpeed = speed;
      const h = Math.sqrt(dx * dx + dz * dz);
      if (Math.abs(dy) > 1e-5 || h > 1e-5) {
        t.pitch = rotlerp(t.pitch, pitchTo(dx, dy, dz), this.maxTurn);
        inp.up = dy > 0 ? speed : -speed;
      }
    } else {
      if (!this.hoversInPlace) e.physics.noGravity = false;
      inp.up = 0;
      inp.forward = 0;
    }
  }
}

/** Fish: gentle buoyancy, speed eases towards the target speed. */
export class FishMoveControl extends MoveControl {
  override tick(): void {
    const m = this.mob, e = m.e, t = e.transform, inp = e.input, p = e.physics;
    if (p.underWater) p.vy += 0.005;
    if (this.op === MoveOp.MOVE_TO && !m.nav.isDone()) {
      const f = this.speedModifier * m.speed;
      inp.speed = inp.speed + (f - inp.speed) * 0.125;
      inp.forward = inp.speed;
      const dx = this.wantedX - m.x, dy = this.wantedY - m.y, dz = this.wantedZ - m.z;
      if (dy !== 0) {
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        p.vy += inp.speed * (dy / d) * 0.1;
      }
      if (dx !== 0 || dz !== 0) {
        t.yaw = rotlerp(t.yaw, yawTo(dx, dz), 90);
        t.bodyYaw = t.yaw;
      }
    } else {
      inp.speed = 0;
      inp.forward = 0;
    }
  }
}

/** Dolphins, axolotls, tadpoles, guardians: pitch into the swim direction. */
export class SmoothSwimmingMoveControl extends MoveControl {
  constructor(mob: Mob, private readonly maxTurnX: number, private readonly maxTurnY: number, private readonly inWater: number, private readonly outside: number, private readonly applyGravity: boolean) {
    super(mob);
  }

  override tick(): void {
    const m = this.mob, e = m.e, t = e.transform, inp = e.input, p = e.physics;
    if (this.applyGravity && p.inWater) p.vy += 0.005;
    if (this.op === MoveOp.MOVE_TO && !m.nav.isDone()) {
      const dx = this.wantedX - m.x, dy = this.wantedY - m.y, dz = this.wantedZ - m.z;
      if (dx * dx + dy * dy + dz * dz < 2.5e-7) {
        inp.forward = 0;
        return;
      }
      const target = yawTo(dx, dz);
      t.yaw = rotlerp(t.yaw, target, this.maxTurnY);
      t.bodyYaw = t.yaw;
      t.headYaw = t.yaw;
      const f1 = this.speedModifier * m.speed;
      if (p.inWater) {
        inp.speed = f1 * this.inWater;
        const h = Math.sqrt(dx * dx + dz * dz);
        if (Math.abs(dy) > 1e-5 || h > 1e-5) {
          let pitch = pitchTo(dx, dy, dz);
          pitch = Math.max(-this.maxTurnX, Math.min(this.maxTurnX, wrapDegrees(pitch)));
          t.pitch = rotlerp(t.pitch, pitch, 5);
        }
        const c = Math.cos((t.pitch * Math.PI) / 180), s = Math.sin((t.pitch * Math.PI) / 180);
        inp.forward = c * f1;
        inp.up = -s * f1;
      } else {
        const diff = Math.abs(wrapDegrees(t.yaw - target));
        const dm = diff < 5 ? 1 : diff < 90 ? 1 - (diff - 5) / 85 * 0.9 : 0;
        inp.speed = f1 * this.outside * dm;
        inp.forward = inp.speed;
        inp.up = 0;
      }
    } else {
      inp.speed = 0;
      inp.forward = 0;
      inp.strafe = 0;
      inp.up = 0;
    }
  }
}

/** Slimes hop towards a direction instead of walking. */
export class SlimeMoveControl extends MoveControl {
  yRot = 0;
  jumpDelay = 0;
  private aggressiveJumps = false;

  setDirection(yRot: number, aggressive: boolean): void {
    this.yRot = yRot;
    this.aggressiveJumps = aggressive;
  }

  setWantedMovement(speed: number): void {
    this.speedModifier = speed;
    this.op = MoveOp.MOVE_TO;
  }

  override tick(): void {
    const m = this.mob, e = m.e, t = e.transform, inp = e.input;
    t.yaw = rotlerp(t.yaw, this.yRot, 90);
    t.headYaw = t.yaw;
    t.bodyYaw = t.yaw;
    if (this.op !== MoveOp.MOVE_TO) {
      inp.forward = 0;
      return;
    }
    this.op = MoveOp.WAIT;
    if (m.onGround) {
      this.setSpeed(this.speedModifier * m.speed);
      if (this.jumpDelay-- <= 0) {
        this.jumpDelay = m.random.nextInt(20) + 10;
        if (this.aggressiveJumps) this.jumpDelay = Math.floor(this.jumpDelay / 3);
        m.jump.jump();
        const size = (m.data['size'] as number | undefined) ?? 1;
        m.playSound(size > 1 ? 'entity.slime.jump' : 'entity.slime.jump_small', 0.4 * size);
      } else {
        inp.strafe = 0;
        inp.forward = 0;
        inp.speed = 0;
      }
    } else {
      this.setSpeed(this.speedModifier * m.speed);
    }
  }
}

export class LookControl {
  lookAtCooldown = 0;
  wantedX = 0;
  wantedY = 0;
  wantedZ = 0;
  yMaxRotSpeed = 10;
  xMaxRotAngle = 40;

  constructor(protected readonly mob: Mob) {}

  setLookAt(x: number, y: number, z: number, yMax = this.mob.def.headSpeed ?? 10, xMax = 40): void {
    this.wantedX = x;
    this.wantedY = y;
    this.wantedZ = z;
    this.yMaxRotSpeed = yMax;
    this.xMaxRotAngle = xMax;
    this.lookAtCooldown = 2;
  }

  setLookAtEntity(e: Entity, yMax?: number, xMax?: number): void {
    const t = e.transform!;
    const y = e.living ? t.y + (e.physics?.eyeHeight ?? 0) : t.y + (e.physics?.height ?? 0) / 2;
    this.setLookAt(t.x, y, t.z, yMax, xMax);
  }

  isLooking(): boolean {
    return this.lookAtCooldown > 0;
  }

  protected resetXRot(): boolean {
    return true;
  }

  tick(): void {
    const m = this.mob, t = m.e.transform;
    if (this.resetXRot()) t.pitch = 0;
    if (this.lookAtCooldown > 0) {
      this.lookAtCooldown--;
      const dx = this.wantedX - m.x, dy = this.wantedY - m.eyeY, dz = this.wantedZ - m.z;
      if (Math.abs(dz) > 1e-5 || Math.abs(dx) > 1e-5) t.headYaw = rotateTowards(t.headYaw, yawTo(dx, dz), this.yMaxRotSpeed);
      t.pitch = rotateTowards(t.pitch, pitchTo(dx, dy, dz), this.xMaxRotAngle);
    } else {
      t.headYaw = rotateTowards(t.headYaw, t.bodyYaw, 10);
    }
    if (!m.nav.isDone()) t.headYaw = rotateIfNecessary(t.headYaw, t.bodyYaw, 75);
  }
}

/** Swimmers keep their pitch (it is driven by the move control). */
export class SmoothSwimmingLookControl extends LookControl {
  constructor(mob: Mob, private readonly maxYRotFromCenter: number) {
    super(mob);
  }
  protected override resetXRot(): boolean {
    return false;
  }
  override tick(): void {
    const m = this.mob, t = m.e.transform;
    if (this.lookAtCooldown > 0) {
      this.lookAtCooldown--;
      const dx = this.wantedX - m.x, dy = this.wantedY - m.eyeY, dz = this.wantedZ - m.z;
      t.headYaw = rotateTowards(t.headYaw, yawTo(dx, dz) + 20, this.yMaxRotSpeed);
      t.pitch = rotateTowards(t.pitch, pitchTo(dx, dy, dz) + 10, this.xMaxRotAngle);
    } else {
      if (m.nav.isDone()) t.pitch = rotateTowards(t.pitch, 0, 5);
      t.headYaw = rotateTowards(t.headYaw, t.bodyYaw, this.yMaxRotSpeed);
    }
    const d = wrapDegrees(t.headYaw - t.bodyYaw);
    if (d < -this.maxYRotFromCenter) t.bodyYaw -= 4;
    else if (d > this.maxYRotFromCenter) t.bodyYaw += 4;
  }
}

export class JumpControl {
  private wants = false;
  constructor(private readonly mob: Mob) {}
  jump(): void {
    this.wants = true;
  }
  tick(): void {
    this.mob.e.input.jumping = this.wants;
    this.wants = false;
  }
}

/** Body follows movement; when idle it slowly aligns with the head. */
export class BodyRotation {
  private headStableTime = 0;
  private lastStableHead = 0;
  private lastX = NaN;
  private lastZ = NaN;

  constructor(private readonly mob: Mob, private readonly maxHead = 75) {}

  tick(): void {
    const m = this.mob, t = m.e.transform;
    const dx = t.x - (Number.isNaN(this.lastX) ? t.x : this.lastX), dz = t.z - (Number.isNaN(this.lastZ) ? t.z : this.lastZ);
    this.lastX = t.x;
    this.lastZ = t.z;
    if (dx * dx + dz * dz > 2.5e-7) {
      t.bodyYaw = t.yaw;
      t.headYaw = rotateIfNecessary(t.headYaw, t.bodyYaw, this.maxHead);
      this.lastStableHead = t.headYaw;
      this.headStableTime = 0;
      return;
    }
    if (Math.abs(t.headYaw - this.lastStableHead) > 15) {
      this.lastStableHead = t.headYaw;
      this.headStableTime = 0;
      t.bodyYaw = rotateIfNecessary(t.bodyYaw, t.headYaw, this.maxHead);
    } else {
      this.headStableTime++;
      if (this.headStableTime > 10) {
        const f = Math.max(0, Math.min(1, (this.headStableTime - 10) / 10));
        t.bodyYaw = rotateIfNecessary(t.bodyYaw, t.headYaw, this.maxHead * (1 - f));
      }
    }
  }
}
