/**
 * Pandas: two genes (main and hidden) decide personality — lazy, worried, playful, aggressive,
 * weak, brown or normal. Pandas eat bamboo and cake from the ground, sit to eat, roll around,
 * lie on their backs, sneeze (dropping slime balls), fear thunderstorms and fight back only
 * when aggressive.
 */
import { ItemStack } from '../../../common/item/stack';
import { blockOf } from '../../../common/block/registry';
import { registerMob, Mob, mobOf } from '../mob';
import { Goal, Flag, reducedTickDelay } from '../goals';
import {
  FloatGoal, PanicGoal, BreedGoal, TemptGoal, FollowParentGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal,
  AvoidEntityGoal, MeleeAttackGoal, HurtByTargetGoal,
} from '../goallib';
import { handStack, useItem, getAge, ageUp, setInLove } from '../actions';
import { items, sounds } from './common';

export const PANDA_GENES = ['normal', 'lazy', 'worried', 'playful', 'brown', 'weak', 'aggressive'] as const;
type Gene = (typeof PANDA_GENES)[number];
const RECESSIVE: Gene[] = ['brown', 'weak'];

function randomGene(m: Mob): Gene {
  const i = m.random.nextInt(16);
  if (i === 0) return 'lazy';
  if (i === 1) return 'worried';
  if (i === 2) return 'playful';
  if (i === 4) return 'aggressive';
  if (i < 9) return 'weak';
  if (i < 11) return 'brown';
  return 'normal';
}

/** The gene that shows: recessive genes only show when both copies match. */
export function variantGene(main: Gene, hidden: Gene): Gene {
  if (RECESSIVE.includes(main)) return main === hidden ? main : 'normal';
  return main;
}

const gene = (m: Mob): Gene => variantGene((m.data['mainGene'] as Gene | undefined) ?? 'normal', (m.data['hiddenGene'] as Gene | undefined) ?? 'normal');
const is = (m: Mob, g: Gene) => gene(m) === g;

const PANDA_FOOD = items('bamboo');
const PANDA_EATS = (s: ItemStack) => s.id === 'bamboo' || s.id === 'cake';

function flag(m: Mob, k: 'sitting' | 'onBack' | 'rolling' | 'sneezing' | 'eating', v: boolean): void {
  m.tmp[k] = v;
  m.setMeta(k, v);
}
const has = (m: Mob, k: 'sitting' | 'onBack' | 'rolling' | 'sneezing' | 'eating') => !!m.tmp[k];

/** Scared worried pandas cower during thunderstorms. */
function isScared(m: Mob): boolean {
  return is(m, 'worried') && m.level.isThundering();
}

function canPerformAction(m: Mob): boolean {
  return !has(m, 'onBack') && !isScared(m) && !has(m, 'eating') && !has(m, 'rolling') && !has(m, 'sitting');
}

function syncSpeed(m: Mob): void {
  m.e.living.attrs.get('movement_speed').setBase(is(m, 'lazy') ? 0.07 : 0.15);
  m.e.living.attrs.get('max_health').setBase(is(m, 'weak') ? 10 : 20);
  m.e.input.speed = m.speed;
}

class PandaSitGoal extends Goal {
  private cooldown = 0;
  constructor(private readonly p: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const p = this.p;
    if (this.cooldown > p.tickCount || p.isBaby || p.inWater || !canPerformAction(p) || ((p.tmp['unhappy'] as number | undefined) ?? 0) > 0) return false;
    // Sit down to eat what is held, or to pick up food from the ground
    if (PANDA_EATS(p.equipment[0]!)) return true;
    return p.level.getEntities(p.box().inflate(6, 6, 6), (e) => !!e.item && PANDA_EATS(e.item.stack)).length > 0;
  }
  override canContinueToUse(): boolean {
    const p = this.p;
    if (!p.inWater && !is(p, 'lazy') && p.random.nextInt(reducedTickDelay(600)) === 1) return false;
    return p.random.nextInt(reducedTickDelay(2000)) !== 1;
  }
  override start(): void {
    const p = this.p;
    const food = p.level.getEntities(p.box().inflate(6, 6, 6), (e) => !!e.item && PANDA_EATS(e.item.stack));
    if (food.length && p.equipment[0]!.isEmpty()) p.nav.moveToEntity(food[0]!, 1.2);
    else if (!p.equipment[0]!.isEmpty()) flag(p, 'sitting', true);
    this.cooldown = 0;
  }
  override tick(): void {
    const p = this.p;
    if (!has(p, 'sitting') && !p.equipment[0]!.isEmpty()) {
      p.nav.stop();
      flag(p, 'sitting', true);
    }
  }
  override stop(): void {
    const p = this.p;
    const held = p.equipment[0]!;
    if (!held.isEmpty()) {
      p.level.spawnItem(p.x, p.y + 0.5, p.z, held);
      p.equipment[0] = ItemStack.empty();
      const w = is(p, 'lazy') ? p.random.nextInt(50) + 10 : p.random.nextInt(150) + 10;
      this.cooldown = p.tickCount + w * 20;
    }
    flag(p, 'sitting', false);
  }
}

class PandaLieOnBackGoal extends Goal {
  private cooldown = 0;
  constructor(private readonly p: Mob) {
    super();
  }
  canUse(): boolean {
    const p = this.p;
    return this.cooldown < p.tickCount && is(p, 'lazy') && canPerformAction(p) && p.random.nextInt(reducedTickDelay(400)) === 1;
  }
  override canContinueToUse(): boolean {
    const p = this.p;
    if (!p.inWater && (is(p, 'lazy') || p.random.nextInt(reducedTickDelay(600)) !== 1)) return p.random.nextInt(reducedTickDelay(2000)) !== 1;
    return false;
  }
  override start(): void {
    flag(this.p, 'onBack', true);
    this.cooldown = 0;
  }
  override stop(): void {
    flag(this.p, 'onBack', false);
    this.cooldown = this.p.tickCount + 200;
  }
}

class PandaSneezeGoal extends Goal {
  constructor(private readonly p: Mob) {
    super();
  }
  canUse(): boolean {
    const p = this.p;
    if (!p.isBaby || !canPerformAction(p)) return false;
    return is(p, 'weak') && p.random.nextInt(reducedTickDelay(500)) === 1 ? true : p.random.nextInt(reducedTickDelay(6000)) === 1;
  }
  override canContinueToUse(): boolean {
    return false;
  }
  override start(): void {
    flag(this.p, 'sneezing', true);
    this.p.tmp['sneezeTime'] = 0;
  }
}

class PandaRollGoal extends Goal {
  constructor(private readonly p: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK | Flag.JUMP;
  }
  canUse(): boolean {
    const p = this.p;
    if ((!p.isBaby && !is(p, 'playful')) || !p.onGround) return false;
    if (!canPerformAction(p)) return false;
    const r = p.random.nextInt(reducedTickDelay(p.isBaby ? 120 : 600));
    return r === 1 && (p.e.physics.vx ** 2 + p.e.physics.vz ** 2 > 0 || p.random.nextInt(10) === 0);
  }
  override canContinueToUse(): boolean {
    return false;
  }
  override start(): void {
    flag(this.p, 'rolling', true);
    this.p.tmp['rollTime'] = 0;
  }
  override isInterruptable(): boolean {
    return false;
  }
}

class PandaAttackGoal extends MeleeAttackGoal {
  override canUse(): boolean {
    return canPerformAction(this.m) && super.canUse();
  }
}

class PandaHurtByTargetGoal extends HurtByTargetGoal {
  override canContinueToUse(): boolean {
    const m = this.m;
    if (!has(m, 'sneezing') && m.getTarget() && is(m, 'aggressive')) return super.canContinueToUse();
    return false;
  }
  override canUse(): boolean {
    return is(this.m, 'aggressive') && super.canUse();
  }
}

function pandaTick(m: Mob): void {
  if (isScared(m)) {
    if (!m.inWater) {
      flag(m, 'sitting', true);
      flag(m, 'eating', false);
      m.tmp['cowering'] = true;
    }
  } else if (m.tmp['cowering']) {
    // The storm is over
    m.tmp['cowering'] = false;
    flag(m, 'sitting', false);
  }
  if (m.getTarget()) {
    flag(m, 'sitting', false);
    flag(m, 'onBack', false);
  }
  const unhappy = (m.tmp['unhappy'] as number | undefined) ?? 0;
  if (unhappy > 0) {
    if (m.getTarget()) m.setTarget(null);
    if (unhappy === 1) m.playSound('entity.panda.cant_breed');
    m.tmp['unhappy'] = unhappy - 1;
  }
  // Sneezing: babies scare the adults around and drop a slime ball
  if (has(m, 'sneezing')) {
    const t = ((m.tmp['sneezeTime'] as number | undefined) ?? 0) + 1;
    m.tmp['sneezeTime'] = t;
    if (t > 20) {
      flag(m, 'sneezing', false);
      m.playSound('entity.panda.sneeze');
      const yaw = (m.e.transform.bodyYaw * Math.PI) / 180;
      m.level.spawnItem(m.x - m.width * 0.5 * Math.sin(yaw), m.eyeY - 0.1, m.z + m.width * 0.5 * Math.cos(yaw), new ItemStack('slime_ball', 1));
      for (const e of m.level.getEntities(m.box().inflate(10), (e) => e.type === 'panda' && e !== m.e)) {
        const o = mobOf(e);
        if (o && !o.isBaby && o.onGround && !o.inWater && canPerformAction(o)) o.e.physics.vy = 0.42;
      }
    } else if (t === 1) m.playSound('entity.panda.pre_sneeze');
  }
  // Rolling forward
  if (has(m, 'rolling')) {
    const t = ((m.tmp['rollTime'] as number | undefined) ?? 0) + 1;
    m.tmp['rollTime'] = t;
    if (t > 32) flag(m, 'rolling', false);
    else if (t > 1) {
      const yaw = (m.e.transform.bodyYaw * Math.PI) / 180;
      const f = m.isBaby ? 0.1 : 0.2;
      const p = m.e.physics;
      p.vx = -Math.sin(yaw) * f;
      p.vz = Math.cos(yaw) * f;
      if (t > 1 && t < 5 && m.onGround) p.vy = 0.27;
    }
  }
  // Eating what is held while sitting
  const held = m.equipment[0]!;
  if (has(m, 'sitting') && PANDA_EATS(held)) {
    const eat = ((m.tmp['eatCounter'] as number | undefined) ?? 0) + 1;
    m.tmp['eatCounter'] = eat;
    flag(m, 'eating', true);
    if (eat > 100) {
      m.equipment[0] = ItemStack.empty();
      m.tmp['eatCounter'] = 0;
      flag(m, 'eating', false);
    } else if (eat % 5 === 0) m.playSound('entity.panda.eat', 0.5 + 0.5 * m.random.nextInt(2));
  } else {
    m.tmp['eatCounter'] = 0;
    if (has(m, 'eating')) flag(m, 'eating', false);
  }
}

registerMob({
  id: 'panda', attrs: { max_health: 20, movement_speed: 0.15, attack_damage: 6 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: PANDA_FOOD, ...sounds('panda'),
  ambientFor(m) {
    if (is(m, 'aggressive')) return 'entity.panda.aggressive_ambient';
    if (is(m, 'worried')) return 'entity.panda.worried_ambient';
    return 'entity.panda.ambient';
  },
  setup(m) {
    m.canPickUpLoot = true;
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(2, new (class extends PanicGoal {
      override canUse(): boolean {
        return !is(m, 'aggressive') && !isScared(m) && super.canUse();
      }
    })(m, 2));
    m.goals.add(2, new BreedGoal(m, 1));
    m.goals.add(3, new PandaAttackGoal(m, 1.2, true));
    m.goals.add(4, new TemptGoal(m, 1, (s) => s.id === 'bamboo' || s.id === 'cake', false));
    m.goals.add(6, new AvoidEntityGoal(m, (e) => !!e.player && is(m, 'worried') && canPerformAction(m), 8, 2, 2));
    m.goals.add(6, new AvoidEntityGoal(m, (e) => !!e['hostile'] && canPerformAction(m), 4, 2, 2));
    m.goals.add(7, new PandaSitGoal(m));
    m.goals.add(8, new PandaLieOnBackGoal(m));
    m.goals.add(8, new PandaSneezeGoal(m));
    m.goals.add(9, new (class extends LookAtPlayerGoal {
      override canUse(): boolean {
        return canPerformAction(m) && super.canUse();
      }
    })(m, 6));
    m.goals.add(10, new RandomLookAroundGoal(m));
    m.goals.add(12, new PandaRollGoal(m));
    m.goals.add(13, new FollowParentGoal(m, 1.25));
    m.goals.add(14, new (class extends RandomStrollGoal {
      override canUse(): boolean {
        return canPerformAction(m) && super.canUse();
      }
    })(m, 1, 120, true, true));
    m.targets.add(1, new PandaHurtByTargetGoal(m).setAlertOthers());
  },
  init(m, ctx) {
    m.data['mainGene'] = (ctx.opts['mainGene'] as Gene | undefined) ?? randomGene(m);
    m.data['hiddenGene'] = (ctx.opts['hiddenGene'] as Gene | undefined) ?? randomGene(m);
    syncSpeed(m);
    m.e.living.health = m.maxHealth;
    if (m.random.nextInt(5) === 0) m.data['age'] = -24000;
  },
  loaded: syncSpeed,
  syncMeta(m) {
    m.setMeta('gene', gene(m));
  },
  tick: pandaTick,
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (isScared(m)) return false;
    if (has(m, 'onBack')) {
      flag(m, 'onBack', false);
      return true;
    }
    if (!PANDA_FOOD(s)) return false;
    if (m.getTarget()) m.setTarget(null);
    // Pandas only breed with bamboo jungle around (eight bamboo within five blocks)
    if (!m.isBaby && getAge(m) === 0 && !m.tmp['inLove']) {
      useItem(p, hand, s);
      if (bambooNearby(m) >= 8) setInLove(m, p.entity);
      else m.tmp['unhappy'] = 32;
      m.playSound('entity.panda.eat');
      return true;
    }
    if (m.isBaby) {
      useItem(p, hand, s);
      ageUp(m, Math.floor((-getAge(m) / 20) * 0.1), true);
      return true;
    }
    if (m.equipment[0]!.isEmpty()) {
      m.equipment[0] = new ItemStack(s.id, 1);
      useItem(p, hand, s);
      flag(m, 'sitting', true);
      return true;
    }
    return false;
  },
  wantsToPickUp(m, s) {
    return m.equipment[0]!.isEmpty() && PANDA_EATS(s) && canPerformAction(m) && !m.isBaby;
  },
  pickUp(m, e) {
    const it = e.item!;
    m.equipment[0] = it.stack.split(1);
    m.guaranteedDrops[0] = true;
    flag(m, 'sitting', true);
  },
  offspring(m, partner) {
    // Each parent passes one of its genes; one time in 32 a gene mutates
    const pick = (x: Mob) => ((m.random.nextBool() ? x.data['mainGene'] : x.data['hiddenGene']) as Gene | undefined) ?? 'normal';
    let main = pick(m), hidden = pick(partner);
    if (m.random.nextInt(32) === 0) main = randomGene(m);
    if (m.random.nextInt(32) === 0) hidden = randomGene(m);
    return { type: 'panda', data: { mainGene: main, hiddenGene: hidden } };
  },
  onHurt(m) {
    flag(m, 'sitting', false);
    flag(m, 'onBack', false);
  },
  lootFlags(m) {
    return { gene: gene(m) };
  },
  canSpawn(level, x, y, z) {
    return blockOf(level.getBlockState(x, y - 1, z)).name === 'grass_block' && level.getMaxLocalRawBrightness(x, y, z) > 8;
  },
});

function bambooNearby(m: Mob): number {
  let n = 0;
  const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
  for (let dx = -5; dx <= 5; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -5; dz <= 5; dz++) {
    if (blockOf(m.level.getBlockState(bx + dx, by + dy, bz + dz)).name === 'bamboo') n++;
  }
  return n;
}
