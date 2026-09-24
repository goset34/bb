/**
 * Frogs and tadpoles: tadpoles swim, can be bucketed and grow into frogs whose coat depends on
 * the biome where they grow up. Frogs hop on land, swim, croak, long-jump, lay frogspawn on
 * water after breeding with slime balls and catch small slimes and magma cubes with their tongue
 * (magma cubes turn into froglights matching the frog).
 */
import type { Entity } from '../../../common/entity/ecs';
import { ItemStack } from '../../../common/item/stack';
import { BIOMES } from '../../../common/worldgen/biomes';
import { blockOf, getBlock, stateFlags, F } from '../../../common/block/registry';
import { registerMob, Mob, mobOf } from '../mob';
import { Goal, Flag, reducedTickDelay } from '../goals';
import {
  FloatGoal, PanicGoal, BreedGoal, TemptGoal, RandomStrollGoal, RandomSwimmingGoal, LookAtPlayerGoal, NearestAttackableTargetGoal,
  MoveToBlockGoal,
} from '../goallib';
import { PathType } from '../pathfinding';
import { handStack, useItem, exchangeItem, resetLove } from '../actions';
import { LongJumpGoal } from './animals';
import { items, sounds } from './common';

export const FROG_VARIANTS = ['temperate', 'warm', 'cold'] as const;
const FROGLIGHTS: Record<string, string> = { temperate: 'ochre_froglight', warm: 'pearlescent_froglight', cold: 'verdant_froglight' };

function biomeVariant(m: Mob): string {
  const b = BIOMES[m.level.getBiome(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))];
  if (!b) return 'temperate';
  if (b.category === 'jungle' || b.category === 'desert' || b.category === 'badlands' || b.category === 'savanna' || b.name === 'mangrove_swamp' || b.category === 'inferno') return 'warm';
  if (b.category === 'icy' || b.temperature < 0.2 || b.name === 'snowy_taiga' || b.name === 'frozen_river' || b.category === 'verge') return 'cold';
  return 'temperate';
}

/** Small slimes and magma cubes are frog food. */
function frogPrey(e: Entity): boolean {
  const m = mobOf(e);
  return !!m && (m.def.id === 'slime' || m.def.id === 'magma_cube') && ((m.data['size'] as number | undefined) ?? 1) === 1;
}

/** Tongue attack: reach out, pull the prey in and eat it (reference ShootTongue). */
class TongueGoal extends Goal {
  private phase: 'move' | 'catch' | 'eat' | null = null;
  private timer = 0;
  private prey: Entity | null = null;
  constructor(private readonly f: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const t = this.f.getTarget();
    return !!t && frogPrey(t) && !t.living?.dead && !this.f.inWater;
  }
  override canContinueToUse(): boolean {
    return this.phase !== null && !!this.prey && !this.prey.removed;
  }
  override start(): void {
    this.prey = this.f.getTarget();
    this.phase = 'move';
    this.timer = 0;
  }
  override stop(): void {
    this.phase = null;
    this.f.setMeta('tongue', 0);
    this.f.setTarget(null);
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const f = this.f, prey = this.prey!;
    f.look.setLookAtEntity(prey, 30, 30);
    const d = f.distanceToSqr(prey);
    if (this.phase === 'move') {
      if (d <= 10.24 && f.hasLineOfSight(prey)) {
        this.phase = 'catch';
        this.timer = 0;
        f.nav.stop();
        f.playSound('entity.frog.tongue', 2);
        f.setMeta('tongue', prey.id);
        f.broadcastEvent('tongue');
      } else {
        if (++this.timer > 100) {
          this.phase = null;
          return;
        }
        f.nav.moveToEntity(prey, 1.75);
      }
      return;
    }
    this.timer++;
    if (this.phase === 'catch' && this.timer >= 6) {
      // The prey is pulled in and eaten
      const m = mobOf(prey);
      if (m?.def.id === 'magma_cube' && f.level.getGameRule('doMobLoot') !== false) {
        const light = FROGLIGHTS[(f.data['variant'] as string | undefined) ?? 'temperate']!;
        f.level.spawnItem(prey.transform!.x, prey.transform!.y, prey.transform!.z, new ItemStack(light, 1));
      } else if (m?.def.id === 'slime' && f.level.getGameRule('doMobLoot') !== false) {
        f.level.spawnItem(prey.transform!.x, prey.transform!.y, prey.transform!.z, new ItemStack('slime_ball', 1));
      }
      f.playSound('entity.frog.eat', 2);
      f.level.entities.remove(prey);
      this.phase = 'eat';
      this.timer = 0;
    } else if (this.phase === 'eat' && this.timer >= 10) this.phase = null;
  }
}

/** A frog carrying spawn looks for still water with air above to lay it. */
class LayFrogspawnGoal extends MoveToBlockGoal {
  constructor(private readonly f: Mob) {
    super(f, 1, 8, 2);
  }
  override canUse(): boolean {
    return !!this.f.data['pregnant'] && super.canUse();
  }
  protected override nextStart(): number {
    return 20;
  }
  protected isValidTarget(x: number, y: number, z: number): boolean {
    const level = this.f.level;
    const s = level.getBlockState(x, y, z);
    if (!(stateFlags[s]! & F.WATER) || !level.isWaterSource(s)) return false;
    return !!(stateFlags[level.getBlockState(x, y + 1, z)]! & F.AIR);
  }
  protected override moveTarget(): [number, number, number] {
    return [this.blockPos[0], this.blockPos[1], this.blockPos[2]];
  }
  override tick(): void {
    super.tick();
    const f = this.f;
    if (!this.reachedTarget || !f.data['pregnant']) return;
    const [x, y, z] = this.blockPos;
    if (this.isValidTarget(x, y, z)) {
      f.level.setBlock(x, y + 1, z, getBlock('frogspawn').defaultState, 3);
      f.playSound('entity.frog.lay_spawn');
      f.data['pregnant'] = false;
    }
  }
}

registerMob({
  id: 'frog', attrs: { max_health: 10, movement_speed: 1, attack_damage: 10 }, nav: 'amphibious', move: 'swim', swimStyle: 'smooth',
  xp: (m) => 1 + m.random.nextInt(3),
  food: items('slime_ball'), waterBreather: true, noFallDamage: false, ...sounds('frog'), loot: null,
  malus: { [PathType.WATER]: 4, [PathType.TRAPDOOR]: -1 },
  setup(m) {
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new PanicGoal(m, 2));
    m.goals.add(2, new TongueGoal(m));
    m.goals.add(3, new BreedGoal(m, 1));
    m.goals.add(3, new LayFrogspawnGoal(m));
    m.goals.add(4, new TemptGoal(m, 1.25, items('slime_ball'), false));
    m.goals.add(5, new LongJumpGoal(m, 100, 140, 4, 3, 'entity.frog.long_jump', (x, y, z) => !(stateFlags[m.level.getBlockState(x, y - 1, z)]! & F.WATER)));
    m.goals.add(6, new (class extends RandomSwimmingGoal {
      override canUse(): boolean {
        return m.inWater && super.canUse();
      }
    })(m, 1, 60));
    m.goals.add(7, new RandomStrollGoal(m, 1, 120, true, false));
    m.goals.add(8, new LookAtPlayerGoal(m, 6));
    m.targets.add(1, new NearestAttackableTargetGoal(m, frogPrey, 10, true));
  },
  init(m, ctx) {
    m.data['variant'] = (ctx.opts['variant'] as string | undefined) ?? biomeVariant(m);
  },
  syncMeta(m) {
    m.setMeta('variant', (m.data['variant'] as string | undefined) ?? 'temperate');
  },
  tick(m) {
    // Croak now and then while idle on land
    if (!m.inWater && m.onGround && m.nav.isDone() && m.random.nextInt(reducedTickDelay(800)) === 0) {
      m.broadcastEvent('croak');
      m.playSound('entity.frog.ambient');
    }
    m.setMeta('swimming', m.inWater);
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (s.id === 'slime_ball' && !m.data['pregnant'] && !(m.tmp['inLove'] as number | undefined)) {
      useItem(p, hand, s);
      m.tmp['inLove'] = 600;
      m.tmp['loveCause'] = p.entity.id;
      m.broadcastEvent('love');
      return true;
    }
    return false;
  },
  canMate(m, other) {
    return other !== m && other.def === m.def && (m.tmp['inLove'] as number | undefined ?? 0) > 0 && (other.tmp['inLove'] as number | undefined ?? 0) > 0 && !m.data['pregnant'] && !other.data['pregnant'];
  },
  offspring(m, partner) {
    // Frogs lay spawn instead of giving birth
    m.data['pregnant'] = true;
    resetLove(partner);
    return null;
  },
  canSpawn(level, x, y, z) {
    const b = blockOf(level.getBlockState(x, y - 1, z)).name;
    return ['grass_block', 'mud', 'mangrove_roots', 'muddy_mangrove_roots'].includes(b) && level.getMaxLocalRawBrightness(x, y, z) > 8;
  },
});

// ---- Tadpole ---------------------------------------------------------------------------------

const TADPOLE_GROW = 24000;

registerMob({
  id: 'tadpole', attrs: { max_health: 6, movement_speed: 1 }, nav: 'swim', move: 'swim', swimStyle: 'smooth', aquatic: true, xp: 0, loot: null,
  hurtSound: 'entity.tadpole.hurt', deathSound: 'entity.tadpole.death', food: items('slime_ball'),
  setup(m) {
    m.goals.add(0, new PanicGoal(m, 1.25));
    m.goals.add(4, new RandomSwimmingGoal(m, 1, 40));
    m.goals.add(5, new TemptGoal(m, 1.25, items('slime_ball'), false));
  },
  init(m, ctx) {
    m.data['growAge'] = (ctx.opts['growAge'] as number | undefined) ?? 0;
  },
  tick(m) {
    const age = ((m.data['growAge'] as number | undefined) ?? 0) + 1;
    m.data['growAge'] = age;
    if (age >= TADPOLE_GROW) {
      const frog = m.level.createEntity('frog', m.x, m.y, m.z, { reason: 'conversion', yaw: m.e.transform.yaw });
      if (frog) {
        const f = mobOf(frog);
        if (f) {
          f.data['variant'] = biomeVariant(m);
          f.def.syncMeta?.(f);
          if (m.e['customName']) frog['customName'] = m.e['customName'];
          if (m.data['persistent']) f.setPersistent();
        }
        m.playSound('entity.tadpole.grow_up');
        m.level.entities.remove(m.e);
      }
    }
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (s.id === 'slime_ball') {
      // Feeding speeds up growth by a tenth of the remaining time
      useItem(p, hand, s);
      const age = (m.data['growAge'] as number | undefined) ?? 0;
      m.data['growAge'] = age + Math.floor((TADPOLE_GROW - age) * 0.1);
      m.broadcastEvent('villagerHappy');
      m.playSound('entity.tadpole.grow_up', 0.4);
      return true;
    }
    if (s.id === 'water_bucket') {
      const b = new ItemStack('tadpole_bucket', 1, { entity: { growAge: m.data['growAge'] ?? 0, name: m.e['customName'] } });
      m.playSound('item.bucket.fill_tadpole');
      exchangeItem(p, hand, s, b);
      m.level.entities.remove(m.e);
      return true;
    }
    return false;
  },
});
