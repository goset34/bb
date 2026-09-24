/**
 * Mob construction: entity components from the shared mob table (hitbox) and the server
 * definition (attributes, controls, navigation, goals), initial spawn state and size updates.
 */
import { makePhysics, makeTransform, makeInput } from '../../common/entity/components';
import { MOBS } from '../../common/entity/mobs';
import { ItemStack } from '../../common/item/stack';
import { makeLiving } from '../survival/living';
import type { ServerLevel } from '../level';
import { Mob, MOB_DEFS, MobEntity, SpawnReason } from './mob';
import {
  MoveControl, FlyingMoveControl, FishMoveControl, SmoothSwimmingMoveControl, SlimeMoveControl, LookControl,
  SmoothSwimmingLookControl, JumpControl, BodyRotation,
} from './controls';
import { PathNavigation, FlyingNavigation, WaterNavigation, AmphibiousNavigation, ClimberNavigation } from './navigation';
import { PathMode } from './pathfinding';

/** Reference local difficulty (0..6.75) from world difficulty, inhabited time and moon phase. */
export function localDifficulty(level: ServerLevel, x: number, z: number): number {
  const diff = level.getDifficulty();
  if (diff === 0) return 0;
  const hard = diff === 3;
  let f = 0.75;
  const day = level.getDayTime();
  const f1 = Math.max(0, Math.min(1, (day - 72000) / 1440000)) * 0.25;
  f += f1;
  const c = level.getChunkAt(Math.floor(x), Math.floor(z));
  const inhabited = c ? c.inhabitedTime : 0;
  let f2 = 0;
  f2 += Math.max(0, Math.min(1, inhabited / 3600000)) * (hard ? 1 : 0.75);
  const moon = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75][Math.floor(day / 24000) % 8]!;
  f2 += Math.max(0, Math.min(f1, moon * 0.25));
  if (diff === 1) f2 *= 0.5;
  f += f2;
  return diff * f;
}

function installControls(m: Mob): void {
  const d = m.def;
  switch (d.nav ?? 'ground') {
    case 'fly': m.nav = new FlyingNavigation(m); break;
    case 'swim': m.nav = new WaterNavigation(m); break;
    case 'amphibious': m.nav = new AmphibiousNavigation(m); break;
    case 'climber': m.nav = new ClimberNavigation(m); break;
    default: m.nav = new PathNavigation(m, PathMode.WALK);
  }
  switch (d.move ?? 'ground') {
    case 'fly': m.move = new FlyingMoveControl(m, 20, true); break;
    case 'hover': m.move = new FlyingMoveControl(m, 10, false); break;
    case 'swim':
      m.move = d.swimStyle === 'smooth' ? new SmoothSwimmingMoveControl(m, 85, 10, 0.02, 0.1, true) : new FishMoveControl(m);
      break;
    case 'slime': m.move = new SlimeMoveControl(m); break;
    default: m.move = new MoveControl(m);
  }
  m.look = d.move === 'swim' && d.swimStyle === 'smooth' ? new SmoothSwimmingLookControl(m, 10) : new LookControl(m);
  m.jump = new JumpControl(m);
  m.body = new BodyRotation(m);
}

/** Hitbox for the current age/size. */
export function updateSize(m: Mob): void {
  const info = MOBS.get(m.def.id)!;
  let w = info.width, h = info.height, eye = info.eyeHeight ?? info.height * 0.85;
  const custom = m.def.size?.(m);
  if (custom) [w, h, eye] = custom;
  else if (m.isBaby && info.baby) {
    w *= info.baby;
    h *= info.baby;
    eye *= info.baby;
  }
  const p = m.e.physics;
  p.width = w;
  p.height = h;
  p.eyeHeight = eye;
  m.setMeta('baby', m.isBaby);
}

export interface CreateOptions {
  reason: SpawnReason;
  opts?: Record<string, unknown>;
  /** Skip spawn initialisation (loading from disk). */
  fromSave?: boolean;
  yaw?: number;
}

/** Build a mob entity (not yet added to the level). */
export function createMob(level: ServerLevel, type: string, x: number, y: number, z: number, o: CreateOptions): MobEntity | null {
  const def = MOB_DEFS.get(type);
  const info = MOBS.get(type);
  if (!def || !info) return null;
  const physics = makePhysics(info.width, info.height, info.eyeHeight ?? info.height * 0.85);
  physics.stepHeight = def.stepHeight ?? 0.6;
  physics.fireImmune = !!def.fireImmune;
  physics.noGravity = !!def.noGravity;
  if (def.aquatic) physics.maxAir = physics.air = 300;
  const living = makeLiving(def.attrs['max_health'] ?? 20);
  for (const [k, v] of Object.entries(def.attrs)) living.attrs.get(k).setBase(v);
  living.health = living.attrs.value('max_health');
  living.undead = !!def.undead;
  const input = makeInput(living.attrs.value('movement_speed'));
  const yaw = o.yaw ?? level.random.nextFloat() * 360;
  const e: MobEntity = {
    id: 0, type, removed: false,
    transform: makeTransform(x, y, z, yaw, 0),
    physics, input, living, meta: {},
    equipment: [0, 1, 2, 3, 4, 5].map(() => ItemStack.empty()),
  };
  e.transform.headYaw = e.transform.bodyYaw = yaw;
  const m = new Mob(e, def, level);
  e['mob'] = m;
  installControls(m);
  def.setup(m);
  if (!o.fromSave) {
    const opts = o.opts ?? {};
    if (opts['baby'] === true && def.ageable) m.data['age'] = -24000;
    def.init?.(m, { reason: o.reason, opts, difficulty: localDifficulty(level, x, z) });
    if (o.reason === 'spawn_egg' || o.reason === 'command' || o.reason === 'bucket') {
      if (opts['name']) e['customName'] = opts['name'];
    }
  }
  updateSize(m);
  if (def.hostile) e['hostile'] = true;
  return e;
}

/** Create and add a mob to the level. */
export function spawnMob(level: ServerLevel, type: string, x: number, y: number, z: number, reason: SpawnReason, opts: Record<string, unknown> = {}): Mob | null {
  const e = createMob(level, type, x, y, z, { reason, opts });
  if (!e) return null;
  level.addFreshEntity(e);
  return e['mob'] as Mob;
}
