/**
 * Zombies and their variants: husks (hunger bite, no sunburn) and zombie behaviour shared with
 * drowned (reinforcements, babies, equipment, conversion under water).
 */
import { ItemStack } from '../../../common/item/stack';
import { registerMob, Mob, MobDef, SpawnContext } from '../mob';
import { spawnMob, updateSize } from '../factory';
import { defaultHurtTarget } from '../actions';
import {
  MeleeAttackGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, HurtByTargetGoal, NearestAttackableTargetGoal, MoveToBlockGoal,
} from '../goallib';
import { blockOf, getBlock, getCollisionShape } from '../../../common/block/registry';
import { populateArmor, equip, sounds } from './common';
import { mobOf } from '../mob';

/** Zombies raise their arms while attacking (reference ZombieAttackGoal). */
class ZombieAttackGoal extends MeleeAttackGoal {
  private raiseArmTicks = 0;
  override start(): void {
    super.start();
    this.raiseArmTicks = 0;
  }
  override stop(): void {
    super.stop();
    this.m.setMeta('aggressive', false);
  }
  override tick(): void {
    super.tick();
    this.raiseArmTicks++;
    this.m.setMeta('aggressive', this.raiseArmTicks >= 5 && this.ticksUntilAttack < this.adjustedTickDelay(20) / 2);
  }
}

/** Zombies seek out turtle eggs and stomp them (reference ZombieAttackTurtleEggGoal / RemoveBlockGoal). */
export class RemoveTurtleEggGoal extends MoveToBlockGoal {
  private ticksSinceReached = 0;
  constructor(private readonly z: Mob, speed: number, vertical: number) {
    super(z, speed, 24, vertical);
  }
  override canUse(): boolean {
    if (this.z.level.getGameRule('mobGriefing') === false) return false;
    if (this.nextStartTick > 0) {
      this.nextStartTick--;
      return false;
    }
    this.nextStartTick = this.nextStart();
    return this.findNearestBlock();
  }
  protected isValidTarget(x: number, y: number, z: number): boolean {
    const level = this.z.level;
    return blockOf(level.getBlockState(x, y, z)).name === 'turtle_egg' && !getCollisionShape(level.getBlockState(x, y + 1, z)).length && !getCollisionShape(level.getBlockState(x, y + 2, z)).length;
  }
  protected override moveTarget(): [number, number, number] {
    return [this.blockPos[0], this.blockPos[1], this.blockPos[2]];
  }
  override start(): void {
    super.start();
    this.ticksSinceReached = 0;
  }
  override tick(): void {
    super.tick();
    const [x, y, z] = this.blockPos;
    const level = this.z.level;
    if (!this.reachedTarget) return;
    const r = this.z.random;
    if (this.ticksSinceReached > 0) {
      const p = this.z.e.physics;
      p.vy = 0.3;
      if (this.ticksSinceReached % 2 === 0) level.playSound(x + 0.5, y, z + 0.5, 'entity.zombie.destroy_egg', 0.5, 0.9 + r.nextFloat() * 0.2);
    }
    if (this.ticksSinceReached > 60) {
      level.removeBlock(x, y, z);
      level.levelEvent(2001, x, y, z, getBlock('turtle_egg').defaultState);
      level.playSound(x + 0.5, y, z + 0.5, 'block.turtle_egg.break', 0.7, 0.9 + r.nextFloat() * 0.2);
    }
    this.ticksSinceReached++;
  }
}

export function zombieGoals(m: Mob): void {
  m.goals.add(4, new RemoveTurtleEggGoal(m, 1, 3));
  m.goals.add(2, new ZombieAttackGoal(m, 1, false));
  m.goals.add(7, new RandomStrollGoal(m, 1, 120, true, true));
  m.goals.add(8, new LookAtPlayerGoal(m, 8));
  m.goals.add(8, new RandomLookAroundGoal(m));
  m.targets.add(1, new HurtByTargetGoal(m).setAlertOthers());
  m.targets.add(2, new NearestAttackableTargetGoal(m, 'player', 10, true));
  m.targets.add(3, new NearestAttackableTargetGoal(m, (e) => e.type === 'villager' || e.type === 'wandering_trader', 10, false));
  m.targets.add(3, new NearestAttackableTargetGoal(m, (e) => e.type === 'iron_golem', 10, true));
  m.targets.add(5, new NearestAttackableTargetGoal(m, (e) => e.type === 'turtle' && (mobOf(e)?.isBaby ?? false) && !e.physics?.inWater, 10, true));
}

export function zombieInit(m: Mob, ctx: SpawnContext): void {
  const r = m.random;
  const mult = Math.max(0, Math.min(1, (ctx.difficulty - 2) / 2));
  m.canPickUpLoot = r.nextFloat() < 0.55 * mult;
  const baby = ctx.opts['baby'] === true || (ctx.opts['baby'] === undefined && ctx.reason !== 'conversion' && r.nextFloat() < 0.05);
  if (baby) setZombieBaby(m, true);
  if (ctx.reason !== 'conversion') {
    populateArmor(m, ctx.difficulty);
    if (r.nextFloat() < (m.level.getDifficulty() === 3 ? 0.05 : 0.01)) equip(m, 0, r.nextInt(3) === 0 ? 'iron_sword' : 'iron_shovel');
  }
  m.e.living.attrs.get('knockback_resistance').add({ id: 'random_spawn_bonus', amount: r.nextFloat() * 0.05, op: 'add' });
  const rf = r.nextFloat() * 0.1;
  m.e.living.attrs.get('spawn_reinforcements').setBase(rf);
  if (r.nextFloat() < mult * 0.05) {
    m.e.living.attrs.get('spawn_reinforcements').add({ id: 'leader_zombie_bonus', amount: r.nextFloat() * 0.25 + 0.5, op: 'add' });
    m.e.living.attrs.get('max_health').add({ id: 'leader_zombie_bonus', amount: r.nextFloat() * 3 + 1, op: 'mul_total' });
    m.e.living.health = m.maxHealth;
  }
  // Halloween pumpkins
  const d = new Date();
  if (m.equipment[5]!.isEmpty() && d.getMonth() === 9 && d.getDate() === 31 && r.nextFloat() < 0.25) {
    m.equipment[5] = new ItemStack(r.nextFloat() < 0.1 ? 'jack_o_lantern' : 'carved_pumpkin', 1);
    m.dropChances[5] = 0;
  }
}

export function setZombieBaby(m: Mob, baby: boolean): void {
  m.data['baby'] = baby;
  const speed = m.e.living.attrs.get('movement_speed');
  if (baby) speed.add({ id: 'baby', amount: 0.5, op: 'mul_base' });
  else speed.remove('baby');
  m.e.input.speed = m.speed;
  updateSize(m);
}

/** Hard difficulty: call nearby reinforcements when hurt (reference Zombie.hurt). */
export function zombieReinforcements(m: Mob, attacker: import('../../../common/entity/ecs').Entity | null): void {
  const level = m.level;
  if (!attacker || !attacker.living || level.getDifficulty() !== 3 || level.getGameRule('doMobSpawning') === false) return;
  if (m.random.nextFloat() >= m.attr('spawn_reinforcements')) return;
  const r = m.random;
  for (let i = 0; i < 50; i++) {
    const x = Math.floor(m.x) + r.nextIntBetween(7, 40) * r.nextIntBetween(-1, 1);
    const y = Math.floor(m.y) + r.nextIntBetween(7, 40) * r.nextIntBetween(-1, 1);
    const z = Math.floor(m.z) + r.nextIntBetween(7, 40) * r.nextIntBetween(-1, 1);
    const below = level.getBlockState(x, y - 1, z);
    if (below === 0 || level.getMaxLocalRawBrightness(x, y, z) > 7) continue;
    if (level.getBlockState(x, y, z) !== 0 || level.getBlockState(x, y + 1, z) !== 0) continue;
    let near = false;
    for (const p of level.players) if (p.entity.transform.x - x < 7 && p.entity.transform.x - x > -7 && p.entity.transform.z - z < 7 && p.entity.transform.z - z > -7) near = true;
    if (near) continue;
    const z2 = spawnMob(level, m.def.id, x + 0.5, y, z + 0.5, 'reinforcement');
    if (!z2) continue;
    z2.setTarget(attacker);
    m.e.living.attrs.get('spawn_reinforcements').add({ id: 'reinforcement_caller_charge', amount: -0.05, op: 'add' });
    z2.e.living.attrs.get('spawn_reinforcements').add({ id: 'reinforcement_callee_charge', amount: -0.05, op: 'add' });
    break;
  }
}

export function zombieDef(id: string, extra: Partial<MobDef>): MobDef {
  return {
    id,
    attrs: { max_health: 20, movement_speed: 0.23, attack_damage: 3, armor: 2, follow_range: 35 },
    undead: true, hostile: true, burnsInDay: true, headItem: 'zombie_head',
    xp: (m) => (m.data['baby'] ? 12 : 5),
    ...sounds(id),
    setup: zombieGoals,
    init: zombieInit,
    onHurt(m, _t, _a, attacker) {
      zombieReinforcements(m, attacker);
    },
    ...extra,
  };
}

registerMob(zombieDef('zombie', {
  tick(m) {
    // Submerged zombies turn into drowned after 45 seconds
    const p = m.e.physics;
    if (p.underWater) {
      const t = ((m.data['inWaterTime'] as number | undefined) ?? 0) + 1;
      m.data['inWaterTime'] = t;
      if (t >= 600) {
        const c = ((m.data['conversionTime'] as number | undefined) ?? 300) - 1;
        m.data['conversionTime'] = c;
        m.setMeta('converting', true);
        if (c <= 0) convertZombie(m, 'drowned');
      }
    } else {
      m.data['inWaterTime'] = 0;
      delete m.data['conversionTime'];
      m.setMeta('converting', false);
    }
  },
}));

registerMob(zombieDef('husk', {
  burnsInDay: false,
  doHurtTarget(m, target) {
    const ok = defaultHurtTarget(m, target);
    if (ok && m.equipment[0]!.isEmpty() && target.living) {
      const f = m.level.getDifficulty();
      m.level.addEntityEffect(target, 'hunger', 140 * f, 0);
    }
    return ok;
  },
  canSpawn(level, x, y, z) {
    return level.canSeeSky(x, y, z);
  },
  tick(m) {
    const p = m.e.physics;
    if (p.underWater) {
      const t = ((m.data['inWaterTime'] as number | undefined) ?? 0) + 1;
      m.data['inWaterTime'] = t;
      if (t >= 600) {
        const c = ((m.data['conversionTime'] as number | undefined) ?? 300) - 1;
        m.data['conversionTime'] = c;
        if (c <= 0) convertZombie(m, 'zombie');
      }
    } else m.data['inWaterTime'] = 0;
  },
}));

/** Replace a zombie by another type keeping equipment, name and baby state. */
export function convertZombie(m: Mob, to: string): Mob | null {
  const level = m.level;
  const n = spawnMob(level, to, m.x, m.y, m.z, 'conversion', { baby: !!m.data['baby'] });
  if (!n) return null;
  n.e.transform.yaw = m.e.transform.yaw;
  for (let i = 0; i < 6; i++) n.equipment[i] = m.equipment[i]!.copy();
  n.dropChances = [...m.dropChances];
  if (m.data['baby']) setZombieBaby(n, true);
  if (m.e['customName']) n.e['customName'] = m.e['customName'];
  if (m.persistent) n.setPersistent();
  n.def.syncMeta?.(n);
  level.playSound(m.x, m.y, m.z, to === 'drowned' ? 'entity.zombie.converted_to_drowned' : 'entity.husk.converted_to_zombie');
  level.entities.remove(m.e);
  return n;
}
