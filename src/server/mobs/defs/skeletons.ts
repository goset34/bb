/**
 * Skeletons (bow archers that switch to melee without a bow), strays (slowing arrows, formed by
 * freezing skeletons) and bogged (poison arrows, shearable mushrooms); hissers (swell and
 * explode, charged by lightning, head drops from charged blasts).
 */
import type { Entity } from '../../../common/entity/ecs';
import { ItemStack } from '../../../common/item/stack';
import { registerMob, Mob, MobDef, mobOf } from '../mob';
import { spawnMob } from '../factory';
import { Goal, Flag } from '../goals';
import {
  FloatGoal, MeleeAttackGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, HurtByTargetGoal, NearestAttackableTargetGoal,
  RestrictSunGoal, FleeSunGoal, AvoidEntityGoal,
} from '../goallib';
import { RangedBowAttackGoal } from '../../combat/ranged';
import { explode } from '../../combat/explosion';
import { damagePlayerSlot } from '../../survival/interaction';
import { handStack } from '../actions';
import { populateArmor, equip, sounds } from './common';

// ---------------------------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------------------------

/** Swap between bow and melee goals when the weapon changes (reference reassessWeaponGoal). */
function reassessWeapon(m: Mob): void {
  const bow = m.equipment[0]!.id === 'bow';
  if (m.tmp['weaponMode'] === (bow ? 'bow' : 'melee')) return;
  m.tmp['weaponMode'] = bow ? 'bow' : 'melee';
  const old = m.tmp['weaponGoal'] as Goal | undefined;
  if (old) m.goals.remove(old);
  const hard = m.level.getDifficulty() === 3;
  const interval = m.tmp['bowInterval'] as [number, number] | undefined ?? [20, 40];
  const g = bow ? new RangedBowAttackGoal(m, 1, () => (hard ? interval[0] : interval[1]), 15) : new MeleeAttackGoal(m, 1.2, false);
  m.tmp['weaponGoal'] = g;
  m.goals.add(4, g);
}

function skeletonGoals(m: Mob): void {
  m.goals.add(2, new RestrictSunGoal(m));
  m.goals.add(3, new FleeSunGoal(m, 1));
  m.goals.add(3, new AvoidEntityGoal(m, (e) => e.type === 'wolf', 6, 1, 1.2));
  m.goals.add(5, new RandomStrollGoal(m, 1, 120, true, true));
  m.goals.add(6, new LookAtPlayerGoal(m, 8));
  m.goals.add(6, new RandomLookAroundGoal(m));
  m.targets.add(1, new HurtByTargetGoal(m));
  m.targets.add(2, new NearestAttackableTargetGoal(m, 'player', 10, true));
  m.targets.add(3, new NearestAttackableTargetGoal(m, (e) => e.type === 'iron_golem', 10, true));
  m.targets.add(3, new NearestAttackableTargetGoal(m, (e) => e.type === 'turtle' && (mobOf(e)?.isBaby ?? false) && !e.physics?.inWater, 10, true));
}

interface SkeletonVariant {
  /** Arrow/sound configuration stored in the transient state. */
  prepare?(m: Mob): void;
  /** Extra per-tick behaviour. */
  tick?(m: Mob): void;
  def?: Partial<MobDef>;
}

function skeletonDef(id: string, v: SkeletonVariant): MobDef {
  return {
    id,
    attrs: { max_health: 20, movement_speed: 0.25 },
    undead: true, hostile: true, burnsInDay: true, headItem: 'skeleton_skull', xp: 5,
    ...sounds(id),
    setup(m) {
      skeletonGoals(m);
      v.prepare?.(m);
      reassessWeapon(m);
    },
    init(m, ctx) {
      populateArmor(m, ctx.difficulty);
      equip(m, 0, 'bow');
      m.canPickUpLoot = m.random.nextFloat() < 0.55 * Math.max(0, Math.min(1, (ctx.difficulty - 2) / 2));
      reassessWeapon(m);
      const d = new Date();
      if (m.equipment[5]!.isEmpty() && d.getMonth() === 9 && d.getDate() === 31 && m.random.nextFloat() < 0.25) {
        m.equipment[5] = new ItemStack(m.random.nextFloat() < 0.1 ? 'jack_o_lantern' : 'carved_pumpkin', 1);
        m.dropChances[5] = 0;
      }
    },
    loaded(m) {
      reassessWeapon(m);
    },
    tick(m) {
      reassessWeapon(m);
      v.tick?.(m);
    },
    ...v.def,
  };
}

registerMob(skeletonDef('skeleton', {
  tick(m) {
    // Freezing in powder snow turns a skeleton into a stray
    const p = m.e.physics;
    if (p.inPowderSnow && p.frozenTicks >= 140) {
      const t = ((m.data['strayConversion'] as number | undefined) ?? 300) - 1;
      m.data['strayConversion'] = t;
      m.setMeta('converting', true);
      if (t <= 0) {
        const s = spawnMob(m.level, 'stray', m.x, m.y, m.z, 'conversion');
        if (s) {
          for (let i = 0; i < 6; i++) s.equipment[i] = m.equipment[i]!.copy();
          s.e.transform.yaw = m.e.transform.yaw;
          if (m.persistent) s.setPersistent();
          if (m.e['customName']) s.e['customName'] = m.e['customName'];
        }
        m.level.playSound(m.x, m.y, m.z, 'entity.skeleton.converted_to_stray');
        m.level.entities.remove(m.e);
      }
    } else if (m.data['strayConversion'] !== undefined) {
      delete m.data['strayConversion'];
      m.setMeta('converting', false);
    }
  },
}));

registerMob(skeletonDef('stray', {
  prepare(m) {
    m.tmp['arrowItem'] = 'tipped_arrow';
    m.tmp['arrowPotion'] = 'slowness';
    m.tmp['shootSound'] = 'entity.stray.shoot';
  },
  def: {
    canSpawn(level, x, y, z) {
      return level.canSeeSky(x, y, z);
    },
  },
}));

registerMob(skeletonDef('bogged', {
  prepare(m) {
    m.tmp['arrowItem'] = 'tipped_arrow';
    m.tmp['arrowPotion'] = 'poison';
    m.tmp['shootSound'] = 'entity.bogged.shoot';
    m.tmp['bowInterval'] = [50, 70];
  },
  def: {
    attrs: { max_health: 16, movement_speed: 0.25 },
    syncMeta(m) {
      m.setMeta('sheared', !!m.data['sheared']);
    },
    interact(m, p, hand) {
      const s = handStack(p, hand);
      if (s.id !== 'shears' || m.data['sheared']) return false;
      m.data['sheared'] = true;
      m.setMeta('sheared', true);
      m.playSound('entity.bogged.shear');
      for (let i = 0; i < 2; i++) m.level.spawnItem(m.x, m.y + m.height, m.z, new ItemStack(m.random.nextBool() ? 'red_mushroom' : 'brown_mushroom', 1));
      damagePlayerSlot(m.level, p, hand === 'main' ? p.inventory.selected : 40, 1);
      return true;
    },
  },
}));

// ---------------------------------------------------------------------------------------------
// Hisser
// ---------------------------------------------------------------------------------------------

const MAX_SWELL = 30;

function swellDir(m: Mob): number {
  return (m.tmp['swellDir'] as number | undefined) ?? -1;
}

/** Reference SwellGoal: swell while a seen target is within 7 blocks. */
class SwellGoal extends Goal {
  private target: Entity | null = null;
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const t = this.m.getTarget();
    return swellDir(this.m) > 0 || (!!t && this.m.distanceToSqr(t) < 9);
  }
  override start(): void {
    this.m.nav.stop();
    this.target = this.m.getTarget();
  }
  override stop(): void {
    this.target = null;
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const m = this.m, t = this.target;
    if (m.data['ignited']) m.tmp['swellDir'] = 1;
    else if (!t || m.distanceToSqr(t) > 49 || !m.hasLineOfSight(t)) m.tmp['swellDir'] = -1;
    else m.tmp['swellDir'] = 1;
  }
}

function hisserExplode(m: Mob): void {
  const level = m.level;
  const powered = !!m.data['powered'];
  level.entities.remove(m.e);
  m.e.living.dead = true;
  explode(level, m.e, m.x, m.y, m.z, 3 * (powered ? 2 : 1), false, 'mob');
  // Lingering effects of potions the hisser carried
  const effects = [...m.e.living.effects.values()];
  if (effects.length) level.createEntity('area_effect_cloud', m.x, m.y, m.z, { effects, radius: 2.5, duration: 600 });
}

registerMob({
  id: 'hisser', attrs: { max_health: 20, movement_speed: 0.25 }, hostile: true, headItem: 'hisser_head', xp: 5,
  hurtSound: 'entity.hisser.hurt', deathSound: 'entity.hisser.death',
  setup(m) {
    m.goals.add(1, new FloatGoal(m));
    m.goals.add(2, new SwellGoal(m));
    m.goals.add(3, new AvoidEntityGoal(m, (e) => e.type === 'ocelot' || e.type === 'cat', 6, 1, 1.2));
    m.goals.add(4, new MeleeAttackGoal(m, 1, false));
    m.goals.add(5, new RandomStrollGoal(m, 0.8, 120, true, true));
    m.goals.add(6, new LookAtPlayerGoal(m, 8));
    m.goals.add(6, new RandomLookAroundGoal(m));
    m.targets.add(1, new NearestAttackableTargetGoal(m, 'player', 10, true));
    m.targets.add(2, new HurtByTargetGoal(m));
  },
  syncMeta(m) {
    m.setMeta('powered', !!m.data['powered']);
  },
  tick(m) {
    const old = (m.tmp['swell'] as number | undefined) ?? 0;
    if (m.data['ignited']) m.tmp['swellDir'] = 1;
    const dir = swellDir(m);
    if (dir > 0 && old === 0) {
      m.playSound('entity.hisser.primed', 1, 0.5);
      m.level.gameEvent('prime_fuse', m.x, m.y, m.z, m.e);
    }
    const swell = Math.max(0, Math.min(MAX_SWELL, old + dir));
    m.tmp['swell'] = swell;
    if (swell !== old) m.setMeta('swell', swell);
    if (swell >= MAX_SWELL) hisserExplode(m);
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (s.id !== 'flint_and_steel' && s.id !== 'fire_charge') return false;
    m.level.playSound(m.x, m.y, m.z, s.id === 'fire_charge' ? 'item.firecharge.use' : 'item.flintandsteel.use', 1, m.random.nextFloat() * 0.4 + 0.8);
    m.data['ignited'] = true;
    if (s.id === 'fire_charge') {
      if (p.data.gameMode !== 'creative') { s.shrink(1); p.inventory.revision++; }
    } else damagePlayerSlot(m.level, p, hand === 'main' ? p.inventory.selected : 40, 1);
    return true;
  },
  onLightning(m) {
    m.data['powered'] = true;
    m.setMeta('powered', true);
    return false;
  },
  lootFlags(m) {
    return { killedBySkeleton: m.tmp['killedBySkeleton'] === true };
  },
  onKill(m, victim) {
    // A charged blast makes one victim per explosion drop its head
    if (!m.data['powered'] || m.tmp['headDropped']) return;
    const head = victim.player ? 'player_head' : mobOf(victim)?.def.headItem;
    if (!head) return;
    m.tmp['headDropped'] = true;
    const t = victim.transform!;
    const stack = new ItemStack(head, 1);
    if (victim.player) stack.data.extra = { owner: victim.player.name };
    m.level.spawnItem(t.x, t.y + 0.5, t.z, stack);
  },
});
