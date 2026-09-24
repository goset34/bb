/**
 * Pets and small wild animals: wolves (taming with bones, collars, armour, packs, begging,
 * shaking off water, hunting), cats (variants, relaxing on the owner's bed, morning gifts,
 * sitting on chests and furnaces), ocelots (trust) and rabbits (hopping movement, garden raids,
 * the fierce variant).
 */
import type { Entity } from '../../../common/entity/ecs';
import { ItemStack } from '../../../common/item/stack';
import { getItem } from '../../../common/item/items';
import { BIOMES } from '../../../common/worldgen/biomes';
import { blockOf, blockHasTag, stateFlags, F, getValue, setValue, tryGetValue } from '../../../common/block/registry';
import { P } from '../../../common/block/properties';
import { damageInfo } from '../../../common/entity/living';
import { rollLoot } from '../../../common/loot/loot';
import { heal, livingHooks } from '../../survival/living';
import { damagePlayerSlot } from '../../survival/interaction';
import { sleepingOf } from '../../survival/sleep';
import { containerViewers } from '../../survival/containers';
import type { ServerPlayer } from '../../player';
import { registerMob, Mob, mobOf, yawTo, rotlerp } from '../mob';
import { Goal, Flag, reducedTickDelay } from '../goals';
import { MoveControl, MoveOp } from '../controls';
import {
  FloatGoal, PanicGoal, BreedGoal, TemptGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, AvoidEntityGoal,
  LeapAtTargetGoal, MeleeAttackGoal, HurtByTargetGoal, NearestAttackableTargetGoal, isAngryAt, startAnger, tickAnger,
} from '../goallib';
import { handStack, useItem, feedAnimal, getAge, doHurtTarget, defaultHurtTarget } from '../actions';
import { nearestPlayer } from '../targeting';
import {
  isTame, isOwnedBy, ownerPlayer, tameAttempt, toggleSit, isOrderedToSit, isInSittingPose, setInSittingPose, wantsToAttack,
  SitWhenOrderedToGoal, TamablePanicGoal, FollowOwnerGoal, OwnerHurtByTargetGoal, OwnerHurtTargetGoal, NonTameRandomTargetGoal,
} from '../tamable';
import { items, sounds } from './common';
import { DYE_COLORS } from './farm';

export const MEAT = items(
  'beef', 'cooked_beef', 'chicken', 'cooked_chicken', 'porkchop', 'cooked_porkchop', 'mutton', 'cooked_mutton', 'rabbit', 'cooked_rabbit', 'rotten_flesh',
);
export const CAT_FOOD = items('cod', 'salmon');

const dyeColor = (s: ItemStack): string | null => (s.id.endsWith('_dye') && DYE_COLORS.includes(s.id.slice(0, -4)) ? s.id.slice(0, -4) : null);

/** Baby turtles on land are prey for wolves, cats and foxes. */
export function babyTurtleOnLand(e: Entity): boolean {
  const m = mobOf(e);
  return !!m && m.def.id === 'turtle' && m.isBaby && !m.inWater;
}

function nutrition(s: ItemStack): number {
  return getItem(s.id)?.food?.nutrition ?? 1;
}

function syncCollar(m: Mob): void {
  m.setMeta('collar', isTame(m) ? (m.data['collar'] as string | undefined) ?? 'red' : '');
}

/** Dye a tamed pet's collar (owner only). */
function dyeCollar(m: Mob, p: ServerPlayer, hand: 'main' | 'off'): boolean {
  const s = handStack(p, hand);
  const c = dyeColor(s);
  if (!c || !isOwnedBy(m, p.entity)) return false;
  if (c !== ((m.data['collar'] as string | undefined) ?? 'red')) {
    m.data['collar'] = c;
    syncCollar(m);
    useItem(p, hand, s);
  }
  return true;
}

// =============================================================================================
// Wolf
// =============================================================================================

/** Coat variants by biome (reference wolf variants, original names). */
const WOLF_VARIANTS: Record<string, string> = {
  taiga: 'pale', forest: 'woods', snowy_taiga: 'ash', old_growth_pine_taiga: 'dusk', old_growth_spruce_taiga: 'chestnut',
  sparse_jungle: 'rust', savanna_plateau: 'spotted', wooded_badlands: 'striped', grove: 'snow',
};
export const WOLF_VARIANT_IDS = ['pale', 'woods', 'ash', 'dusk', 'chestnut', 'rust', 'spotted', 'striped', 'snow'];

const WOLF_ARMOR_BYPASS = new Set(['cactus', 'campfire', 'dragon_breath', 'hot_floor', 'in_fire', 'lava', 'on_fire', 'magic', 'indirect_magic', 'sweet_berry_bush', 'withering', 'freeze']);

function wolfArmor(m: Mob): ItemStack {
  const a = m.data['bodyArmor'] as Record<string, unknown> | undefined;
  return a ? ItemStack.fromJSON(a as never) : ItemStack.empty();
}

function setWolfArmor(m: Mob, s: ItemStack): void {
  if (s.isEmpty()) delete m.data['bodyArmor'];
  else m.data['bodyArmor'] = s.toJSON();
  const armor = m.e.living.attrs.get('armor');
  armor.remove('wolf_armor');
  if (!s.isEmpty()) armor.add({ id: 'wolf_armor', amount: (getItem(s.id)?.extra?.['wolfArmor'] as number | undefined) ?? 11, op: 'add' });
  syncWolfArmor(m);
}

/** Crack level 0..3 from the remaining durability (reference crackiness thresholds). */
function crackLevel(s: ItemStack): number {
  const max = getItem(s.id)?.maxDamage ?? 0;
  if (!max) return 0;
  const f = 1 - s.damage / max;
  return f < 0.32 ? 3 : f < 0.69 ? 2 : f < 0.95 ? 1 : 0;
}

function syncWolfArmor(m: Mob): void {
  const s = wolfArmor(m);
  m.setMeta('armor', !s.isEmpty());
  m.setMeta('armorColor', s.isEmpty() ? -1 : (s.data['color'] as number | undefined) ?? -1);
  m.setMeta('armorCrack', s.isEmpty() ? 0 : crackLevel(s));
}

/** Wolf armour takes the whole hit (reference Wolf.actuallyHurt). */
function wolfAbsorb(m: Mob, type: string, amount: number): boolean {
  const s = wolfArmor(m);
  if (s.isEmpty() || damageInfo(type).bypassArmor || WOLF_ARMOR_BYPASS.has(type)) return false;
  const before = crackLevel(s);
  s.damage += Math.ceil(amount);
  const max = getItem(s.id)?.maxDamage ?? 0;
  if (max && s.damage >= max) {
    m.playSound('item.wolf_armor.break');
    setWolfArmor(m, ItemStack.empty());
  } else {
    setWolfArmor(m, s);
    if (crackLevel(s) !== before) {
      m.playSound('item.wolf_armor.crack');
      m.broadcastEvent('armorCrack');
    }
  }
  return true;
}

/** Tilt the head when a player holds a bone or meat nearby (reference BegGoal). */
class BegGoal extends Goal {
  private player: Entity | null = null;
  private lookTime = 0;
  constructor(private readonly m: Mob, private readonly range: number) {
    super();
    this.flags = Flag.LOOK;
  }
  private interesting(e: Entity): boolean {
    const inv = e.player?.inventory;
    if (!inv) return false;
    return [inv.mainHand, inv.get(40)].some((s) => s.id === 'bone' || MEAT(s));
  }
  canUse(): boolean {
    this.player = nearestPlayer(this.m, { range: this.range, combat: false, lineOfSight: false, testInvisible: true });
    return !!this.player && this.interesting(this.player);
  }
  override canContinueToUse(): boolean {
    const p = this.player;
    if (!p || p.removed || p.living?.dead) return false;
    if (this.m.distanceToSqr(p) > this.range * this.range) return false;
    return this.lookTime > 0 && this.interesting(p);
  }
  override start(): void {
    this.m.setMeta('begging', true);
    this.lookTime = this.adjustedTickDelay(40 + this.m.random.nextInt(40));
  }
  override stop(): void {
    this.m.setMeta('begging', false);
    this.player = null;
  }
  override tick(): void {
    const t = this.player!.transform!;
    this.m.look.setLookAt(t.x, t.y + (this.player!.physics?.eyeHeight ?? 1.62), t.z, 10, 40);
    this.lookTime--;
  }
}

function wolfTick(m: Mob): void {
  tickAnger(m);
  // Shake off water once back on dry ground (reference wet/shaking state)
  const wet = m.inWater || m.level.isRainingAt(Math.floor(m.x), Math.floor(m.y + m.height), Math.floor(m.z));
  if (wet) {
    m.tmp['wet'] = true;
    if (m.tmp['shaking']) {
      m.tmp['shaking'] = 0;
      m.broadcastEvent('shakeStop');
    }
  } else if (m.tmp['wet'] && !m.tmp['shaking'] && m.nav.isDone() && m.onGround) {
    m.tmp['shaking'] = 40;
    m.playSound('entity.wolf.shake');
    m.broadcastEvent('shake');
  }
  const sh = (m.tmp['shaking'] as number | undefined) ?? 0;
  if (sh > 0) {
    m.tmp['shaking'] = sh - 1;
    if (sh === 1) m.tmp['wet'] = false;
  }
  // Tail height follows health for tamed wolves
  m.setMeta('hp', Math.round((m.health / m.maxHealth) * 20));
}

function wolfInteract(m: Mob, p: ServerPlayer, hand: 'main' | 'off'): boolean {
  const s = handStack(p, hand);
  if (isTame(m)) {
    if (MEAT(s) && m.health < m.maxHealth) {
      useItem(p, hand, s);
      heal(m.e, 2 * nutrition(s));
      m.playSound('entity.wolf.eat');
      return true;
    }
    if (dyeCollar(m, p, hand)) return true;
    const owned = isOwnedBy(m, p.entity);
    if (s.id === 'wolf_armor' && owned && wolfArmor(m).isEmpty() && !m.isBaby) {
      setWolfArmor(m, s.copyWithCount(1));
      m.playSound('item.armor.equip_wolf');
      useItem(p, hand, s);
      return true;
    }
    const armor = wolfArmor(m);
    if (s.id === 'shears' && owned && !armor.isEmpty() && !isOrderedToSit(m)) {
      setWolfArmor(m, ItemStack.empty());
      m.level.spawnItem(m.x, m.y + 0.5, m.z, armor);
      m.playSound('item.armor.unequip_wolf');
      if (p.data.gameMode !== 'creative') damagePlayerSlot(m.level, p, hand === 'main' ? p.inventory.selected : 40, 1);
      return true;
    }
    if (s.id === 'armadillo_scute' && owned && !armor.isEmpty() && armor.damage > 0) {
      const max = getItem(armor.id)?.maxDamage ?? 0;
      armor.damage = Math.max(0, armor.damage - Math.floor(max * 0.125));
      setWolfArmor(m, armor);
      m.playSound('item.wolf_armor.repair');
      useItem(p, hand, s);
      return true;
    }
    if (m.def.food?.(s) && (getAge(m) === 0 || m.isBaby) && feedAnimal(m, p, hand)) return true;
    return toggleSit(m, p);
  }
  if (s.id === 'bone' && !((m.data['anger'] as number | undefined) ?? 0)) {
    useItem(p, hand, s);
    if (tameAttempt(m, p, 3)) {
      m.e.living.attrs.get('max_health').setBase(40);
      m.e.living.health = 40;
      syncCollar(m);
    }
    return true;
  }
  return false;
}

registerMob({
  id: 'wolf', attrs: { max_health: 8, movement_speed: 0.3, attack_damage: 4 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: MEAT, loot: null, ...sounds('wolf'), soundVolume: 0.4,
  ambientFor(m) {
    if ((m.data['anger'] as number | undefined ?? 0) > 0) return 'entity.wolf.growl';
    if (m.random.nextInt(3) === 0) return isTame(m) && m.health < 10 ? 'entity.wolf.whine' : 'entity.wolf.pant';
    return 'entity.wolf.ambient';
  },
  setup(m) {
    m.goals.add(1, new FloatGoal(m));
    m.goals.add(1, new TamablePanicGoal(m, 1.5));
    m.goals.add(2, new SitWhenOrderedToGoal(m));
    m.goals.add(3, new AvoidEntityGoal(m, (e) => {
      const l = mobOf(e);
      return !!l && l.def.id === 'llama' && !isTame(m) && ((l.data['strength'] as number | undefined) ?? 1) >= m.random.nextInt(5);
    }, 24, 1.5, 1.5));
    m.goals.add(4, new LeapAtTargetGoal(m, 0.4));
    m.goals.add(5, new MeleeAttackGoal(m, 1, true));
    m.goals.add(6, new FollowOwnerGoal(m, 1, 10, 2));
    m.goals.add(7, new BreedGoal(m, 1));
    m.goals.add(8, new RandomStrollGoal(m, 1, 120, true, true));
    m.goals.add(9, new BegGoal(m, 8));
    m.goals.add(10, new LookAtPlayerGoal(m, 8));
    m.goals.add(10, new RandomLookAroundGoal(m));
    m.targets.add(1, new OwnerHurtByTargetGoal(m));
    m.targets.add(2, new OwnerHurtTargetGoal(m));
    m.targets.add(3, new HurtByTargetGoal(m).setAlertOthers());
    m.targets.add(4, new NearestAttackableTargetGoal(m, 'player', 10, true, false, (e) => isAngryAt(m, e)));
    m.targets.add(5, new NonTameRandomTargetGoal(m, (e) => e.type === 'sheep' || e.type === 'rabbit' || e.type === 'fox'));
    m.targets.add(6, new NonTameRandomTargetGoal(m, babyTurtleOnLand));
    m.targets.add(7, new NearestAttackableTargetGoal(m, (e) => e.type === 'skeleton' || e.type === 'stray' || e.type === 'bogged' || e.type === 'blight_skeleton', 10, false));
  },
  init(m, ctx) {
    const b = BIOMES[m.level.getBiome(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))];
    m.data['variant'] = (ctx.opts['variant'] as string | undefined) ?? WOLF_VARIANTS[b?.name ?? ''] ?? 'pale';
  },
  loaded(m) {
    if (isTame(m)) m.e.living.attrs.get('max_health').setBase(40);
    const a = wolfArmor(m);
    if (!a.isEmpty()) setWolfArmor(m, a);
    if (isOrderedToSit(m)) setInSittingPose(m, true);
  },
  syncMeta(m) {
    m.setMeta('variant', (m.data['variant'] as string | undefined) ?? 'pale');
    m.setMeta('tamed', isTame(m));
    syncCollar(m);
    syncWolfArmor(m);
    m.setMeta('sitting', isInSittingPose(m));
  },
  offspring(m, partner) {
    const owner = m.data['owner'] ?? partner.data['owner'];
    return {
      type: 'wolf',
      data: { variant: (m.random.nextBool() ? m : partner).data['variant'], ...(owner ? { tamed: true, owner, collar: m.data['collar'] ?? 'red' } : {}) },
    };
  },
  canMate(m, other) {
    return other !== m && other.def === m.def && isTame(m) && isTame(other) && !isInSittingPose(m) && !isInSittingPose(other)
      && (m.tmp['inLove'] as number | undefined ?? 0) > 0 && (other.tmp['inLove'] as number | undefined ?? 0) > 0;
  },
  canAttack(m, target) {
    return wantsToAttack(m, target);
  },
  tick: wolfTick,
  interact: wolfInteract,
  onHurt(m, _type, _amount, attacker) {
    if (attacker && !isTame(m) && attacker.player) startAnger(m, attacker);
    if (isOrderedToSit(m) && !isTame(m)) setInSittingPose(m, false);
  },
  onDeath(m) {
    const a = wolfArmor(m);
    if (!a.isEmpty()) m.level.spawnItem(m.x, m.y + 0.5, m.z, a);
  },
});

// =============================================================================================
// Cat
// =============================================================================================

export const CAT_VARIANTS = ['tabby', 'tuxedo', 'ginger', 'siamese', 'grey', 'calico', 'persian', 'ragdoll', 'white', 'patchy', 'black'];

/** Walk-attack at the target with distance-dependent speed (reference OcelotAttackGoal). */
class PounceAttackGoal extends Goal {
  private target: Entity | null = null;
  private attackTime = 0;
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const t = this.m.getTarget();
    if (!t) return false;
    this.target = t;
    return true;
  }
  override canContinueToUse(): boolean {
    const t = this.target;
    if (!t || t.removed || t.living?.dead) return false;
    if (this.m.distanceToSqr(t) > 225) return false;
    return !this.m.nav.isDone() || this.canUse();
  }
  override stop(): void {
    this.target = null;
    this.m.nav.stop();
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const t = this.target!;
    this.m.look.setLookAtEntity(t, 30, 30);
    const reach = this.m.width * 2 * this.m.width * 2;
    const d = this.m.distanceToSqr(t);
    let speed = 0.8;
    if (d > reach && d < 16) speed = 1.33;
    else if (d < 225) speed = 0.6;
    this.m.nav.moveToEntity(t, speed);
    this.attackTime = Math.max(this.attackTime - 1, 0);
    if (d <= reach && this.attackTime <= 0) {
      this.attackTime = this.adjustedTickDelay(20);
      this.m.swing();
      doHurtTarget(this.m, t);
    }
  }
}

/** Cats and ocelots creep towards a player holding fish, and bolt at sudden moves. */
class CatTemptGoal extends TemptGoal {
  constructor(private readonly cat: Mob, speed: number, private readonly onlyWild: 'cat' | 'ocelot') {
    super(cat, speed, CAT_FOOD, true);
  }
  override canUse(): boolean {
    if (this.onlyWild === 'cat' ? isTame(this.cat) : this.cat.data['trusting']) return false;
    return super.canUse();
  }
  override start(): void {
    super.start();
    this.cat.setMeta('crouch', true);
  }
  override stop(): void {
    super.stop();
    this.cat.setMeta('crouch', false);
  }
}

/** At night a tamed cat lies down on its sleeping owner's bed and may bring a gift at dawn. */
class CatRelaxOnOwnerGoal extends Goal {
  private owner: ServerPlayer | null = null;
  private bed: [number, number, number] | null = null;
  private onBedTicks = 0;
  constructor(private readonly cat: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const c = this.cat;
    if (!isTame(c) || isOrderedToSit(c)) return false;
    const p = ownerPlayer(c);
    const sleep = p ? sleepingOf(p) : undefined;
    if (!p || !sleep || c.distanceToSqr(p.entity) > 100) return false;
    // Another cat already lies on this bed
    for (const e of c.level.getEntities(c.box().inflate(2), (e) => e.type === 'cat' && e !== c.e)) if (mobOf(e)?.tmp['relaxing']) return false;
    this.owner = p;
    this.bed = [sleep.x, sleep.y, sleep.z];
    return true;
  }
  override canContinueToUse(): boolean {
    const p = this.owner;
    return !!p && isTame(this.cat) && !isOrderedToSit(this.cat) && !!sleepingOf(p) && this.cat.level.players.includes(p);
  }
  override start(): void {
    const [x, y, z] = this.bed!;
    this.cat.nav.moveTo(x + 0.5, y + 0.6, z + 0.5, 1.1);
    this.onBedTicks = 0;
    setInSittingPose(this.cat, false);
    this.cat.tmp['relaxing'] = true;
  }
  override stop(): void {
    this.cat.tmp['relaxing'] = false;
    this.cat.setMeta('lying', false);
    const p = this.owner;
    // Morning gift (reference: 70 % chance when the owner wakes up at dawn)
    const t = this.cat.level.getDayTime() % 24000;
    if (p && !sleepingOf(p) && (t > 23000 || t < 500) && this.cat.random.nextFloat() < 0.7) this.giveGift(p);
    this.owner = null;
  }
  private giveGift(p: ServerPlayer): void {
    const c = this.cat;
    const stacks = rollLoot('gameplay/cat_morning_gift', { rng: c.random });
    const t = p.entity.transform;
    for (const s of stacks) c.level.spawnItem(c.x - Math.sin((c.e.transform.bodyYaw * Math.PI) / 180), c.y, c.z + Math.cos((c.e.transform.bodyYaw * Math.PI) / 180), s, 0, 0.1, 0);
    c.look.setLookAt(t.x, t.y + 1.5, t.z);
  }
  override tick(): void {
    const [x, y, z] = this.bed!;
    const d = (this.cat.x - x - 0.5) ** 2 + (this.cat.z - z - 0.5) ** 2;
    if (d < 1.5) {
      this.onBedTicks++;
      this.cat.nav.stop();
      this.cat.setMeta('lying', this.onBedTicks > 16);
    } else if (this.cat.nav.isDone()) {
      this.cat.nav.moveTo(x + 0.5, y + 0.6, z + 0.5, 1.1);
    }
  }
}

/** Cats sit on chests, lit furnaces and beds now and then (reference CatSitOnBlockGoal). */
class CatSitOnBlockGoal extends Goal {
  private target: [number, number, number] | null = null;
  private ticks = 0;
  private sitTime = 0;
  private nextStart = 0;
  constructor(private readonly cat: Mob, private readonly speed: number) {
    super();
    this.flags = Flag.MOVE | Flag.JUMP;
  }
  private valid(x: number, y: number, z: number): boolean {
    const level = this.cat.level;
    if (getCollisionShape0(level.getBlockState(x, y + 1, z))) return false;
    const s = level.getBlockState(x, y, z);
    const b = blockOf(s);
    if (b.name === 'chest' || b.name === 'trapped_chest') return containerViewers(level, x, y, z) === 0;
    if (b.name === 'furnace' || b.name === 'blast_furnace' || b.name === 'smoker') return tryGetValue(s, P.lit) === true;
    return b.name.endsWith('_bed') && tryGetValue(s, P.bedPart) !== 'head';
  }
  canUse(): boolean {
    const c = this.cat;
    if (!isTame(c) || isOrderedToSit(c) || isInSittingPose(c)) return false;
    if (this.nextStart > 0) {
      this.nextStart--;
      return false;
    }
    this.nextStart = reducedTickDelay(200 + c.random.nextInt(200));
    const bx = Math.floor(c.x), by = Math.floor(c.y), bz = Math.floor(c.z);
    for (let dy = -1; dy <= 2; dy++) {
      for (let r = 0; r < 8; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            if (this.valid(bx + dx, by + dy, bz + dz)) {
              this.target = [bx + dx, by + dy, bz + dz];
              return true;
            }
          }
        }
      }
    }
    return false;
  }
  override canContinueToUse(): boolean {
    if (!this.target || isOrderedToSit(this.cat)) return false;
    return this.ticks < 1200 && this.sitTime < 1200 && this.valid(...this.target);
  }
  override start(): void {
    const [x, y, z] = this.target!;
    this.cat.nav.moveTo(x + 0.5, y + 1, z + 0.5, this.speed);
    this.ticks = 0;
    this.sitTime = 0;
  }
  override stop(): void {
    setInSittingPose(this.cat, false);
    this.target = null;
  }
  override tick(): void {
    const [x, y, z] = this.target!;
    this.ticks++;
    const d = (this.cat.x - x - 0.5) ** 2 + (this.cat.y - y - 1) ** 2 + (this.cat.z - z - 0.5) ** 2;
    if (d < 1) {
      this.cat.nav.stop();
      setInSittingPose(this.cat, true);
      this.sitTime++;
    } else {
      setInSittingPose(this.cat, false);
      if (this.ticks % 40 === 0) this.cat.nav.moveTo(x + 0.5, y + 1, z + 0.5, this.speed);
    }
  }
}

function getCollisionShape0(s: number): boolean {
  return !!(stateFlags[s]! & F.SOLID);
}

function catInteract(m: Mob, p: ServerPlayer, hand: 'main' | 'off'): boolean {
  const s = handStack(p, hand);
  if (isTame(m)) {
    if (isOwnedBy(m, p.entity) && dyeCollar(m, p, hand)) return true;
    if (CAT_FOOD(s) && m.health < m.maxHealth) {
      useItem(p, hand, s);
      heal(m.e, nutrition(s));
      m.playSound('entity.cat.eat');
      return true;
    }
    if (CAT_FOOD(s) && (getAge(m) === 0 || m.isBaby) && feedAnimal(m, p, hand)) return true;
    return toggleSit(m, p);
  }
  if (CAT_FOOD(s)) {
    useItem(p, hand, s);
    m.playSound('entity.cat.eat');
    if (tameAttempt(m, p, 3)) syncCollar(m);
    return true;
  }
  return false;
}

registerMob({
  id: 'cat', attrs: { max_health: 10, movement_speed: 0.3, attack_damage: 3 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: CAT_FOOD, ...sounds('cat'),
  ambientFor(m) {
    if (!isTame(m)) return 'entity.cat.stray_ambient';
    if ((m.tmp['inLove'] as number | undefined ?? 0) > 0) return 'entity.cat.purr';
    return m.random.nextInt(4) === 0 ? 'entity.cat.purreow' : 'entity.cat.ambient';
  },
  setup(m) {
    m.goals.add(1, new FloatGoal(m));
    m.goals.add(1, new TamablePanicGoal(m, 1.5));
    m.goals.add(2, new SitWhenOrderedToGoal(m));
    m.goals.add(3, new CatRelaxOnOwnerGoal(m));
    m.goals.add(4, new CatTemptGoal(m, 0.6, 'cat'));
    m.goals.add(4, new AvoidEntityGoal(m, (e) => !!e.player && !isTame(m), 16, 0.8, 1.33));
    m.goals.add(6, new FollowOwnerGoal(m, 1, 10, 5));
    m.goals.add(7, new CatSitOnBlockGoal(m, 0.8));
    m.goals.add(8, new LeapAtTargetGoal(m, 0.3));
    m.goals.add(9, new PounceAttackGoal(m));
    m.goals.add(10, new BreedGoal(m, 0.8));
    m.goals.add(11, new RandomStrollGoal(m, 0.8, 120, true, true));
    m.goals.add(12, new LookAtPlayerGoal(m, 10));
    m.targets.add(1, new NonTameRandomTargetGoal(m, (e) => e.type === 'rabbit'));
    m.targets.add(1, new NonTameRandomTargetGoal(m, babyTurtleOnLand));
  },
  init(m, ctx) {
    let v = ctx.opts['variant'] as string | undefined;
    if (!v) {
      // Full moons bring out black cats; witch huts always have one
      const day = Math.floor(m.level.getDayTime() / 24000);
      const fullMoon = day % 8 === 0;
      const pool = fullMoon || ctx.opts['hut'] ? CAT_VARIANTS : CAT_VARIANTS.filter((c) => c !== 'black');
      v = ctx.opts['hut'] ? 'black' : pool[m.random.nextInt(pool.length)]!;
    }
    m.data['variant'] = v;
  },
  loaded(m) {
    if (isOrderedToSit(m)) setInSittingPose(m, true);
  },
  syncMeta(m) {
    m.setMeta('variant', (m.data['variant'] as string | undefined) ?? 'tabby');
    m.setMeta('tamed', isTame(m));
    syncCollar(m);
    m.setMeta('sitting', isInSittingPose(m));
  },
  offspring(m, partner) {
    const owner = m.data['owner'] ?? partner.data['owner'];
    const variant = m.random.nextBool() ? m.data['variant'] : partner.data['variant'];
    return { type: 'cat', data: { variant, ...(owner && isTame(m) ? { tamed: true, owner, collar: m.data['collar'] ?? 'red' } : {}) } };
  },
  canAttack(m, target) {
    return wantsToAttack(m, target);
  },
  interact: catInteract,
  onHurt(m) {
    if (isOrderedToSit(m) && !isTame(m)) setInSittingPose(m, false);
  },
});

// =============================================================================================
// Ocelot
// =============================================================================================

registerMob({
  id: 'ocelot', attrs: { max_health: 10, movement_speed: 0.3, attack_damage: 3 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: CAT_FOOD, loot: null, ambient: 'entity.ocelot.ambient', hurtSound: 'entity.ocelot.hurt', deathSound: 'entity.ocelot.death',
  setup(m) {
    m.goals.add(1, new FloatGoal(m));
    m.goals.add(3, new CatTemptGoal(m, 0.6, 'ocelot'));
    m.goals.add(4, new AvoidEntityGoal(m, (e) => !!e.player && !m.data['trusting'], 16, 0.8, 1.33));
    m.goals.add(7, new LeapAtTargetGoal(m, 0.3));
    m.goals.add(8, new PounceAttackGoal(m));
    m.goals.add(9, new BreedGoal(m, 0.8));
    m.goals.add(10, new RandomStrollGoal(m, 0.8, 120, true, true));
    m.goals.add(11, new LookAtPlayerGoal(m, 10));
    m.targets.add(1, new NearestAttackableTargetGoal(m, (e) => e.type === 'chicken', 10, false));
    m.targets.add(1, new NearestAttackableTargetGoal(m, babyTurtleOnLand, 10, false));
  },
  init(m, ctx) {
    // One in seven wild ocelots come with two kittens
    if (ctx.reason === 'natural' && !m.isBaby && m.random.nextInt(7) === 0) {
      for (let i = 0; i < 2; i++) m.level.createEntity('ocelot', m.x, m.y, m.z, { baby: true, reason: 'natural' });
    }
  },
  syncMeta(m) {
    m.setMeta('trusting', !!m.data['trusting']);
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    // Wild ocelots trust a player who feeds them fish while standing close and still
    if (!m.data['trusting'] && CAT_FOOD(s) && m.distanceToSqr(p.entity) < 9) {
      useItem(p, hand, s);
      m.playSound('entity.ocelot.eat');
      if (m.random.nextInt(3) === 0) {
        m.data['trusting'] = true;
        m.setPersistent();
        m.setMeta('trusting', true);
        m.broadcastEvent('tamed');
      } else m.broadcastEvent('tameFailed');
      return true;
    }
    return false;
  },
  canSpawn(level, x, y, z, _reason, r) {
    const b = blockOf(level.getBlockState(x, y - 1, z));
    return r.nextInt(3) !== 0 && (b.name === 'grass_block' || blockHasTag(b, 'leaves'));
  },
  ambientFor(m) {
    return m.data['trusting'] ? null : 'entity.ocelot.ambient';
  },
});

// =============================================================================================
// Rabbit
// =============================================================================================

export const RABBIT_VARIANTS = ['brown', 'white', 'black', 'spotted', 'gold', 'salt', 'fierce'];

/** Rabbits only move while hopping (reference RabbitMoveControl + jump logic). */
class HopMoveControl extends MoveControl {
  nextJumpSpeed = 0;
  jumpDelay = 0;
  wasOnGround = true;
  override setWantedPosition(x: number, y: number, z: number, speed: number): void {
    if (this.mob.inWater) speed = 1.5;
    super.setWantedPosition(x, y, z, speed);
    if (speed > 0) this.nextJumpSpeed = speed;
  }
  override tick(): void {
    const m = this.mob, p = m.e.physics;
    const moving = this.op === MoveOp.MOVE_TO || this.op === MoveOp.JUMPING;
    const wantedX = this.wantedX, wantedY = this.wantedY, wantedZ = this.wantedZ;
    super.tick();
    if (this.jumpDelay > 0) this.jumpDelay--;
    if (m.onGround) {
      if (!this.wasOnGround) this.jumpDelay = this.nextJumpSpeed < 2.2 ? 10 : 1;
      if (moving && this.jumpDelay === 0) {
        // Face the next waypoint and hop towards it
        const next = m.nav.path && !m.nav.path.done ? m.nav.path.next : undefined;
        const nx = next ? next.x + 0.5 : wantedX;
        const nz = next ? next.z + 0.5 : wantedZ;
        const t = m.e.transform;
        t.yaw = rotlerp(t.yaw, yawTo(nx - m.x, nz - m.z), 90);
        let power = this.nextJumpSpeed <= 0.6 ? 0.2 : 0.3;
        const ny = next ? next.y : wantedY;
        if (ny > m.y + 0.5 || p.horizontalCollision) power = 0.5;
        p.vy = power;
        const yaw = (t.yaw * Math.PI) / 180;
        if (p.vx * p.vx + p.vz * p.vz < 0.01) {
          p.vx += -Math.sin(yaw) * 0.1;
          p.vz += Math.cos(yaw) * 0.1;
        }
        m.broadcastEvent('hop');
        this.jumpDelay = 0;
      } else {
        // Standing still between hops
        m.e.input.forward = 0;
        m.e.input.speed = 0;
      }
    } else if (moving || this.nextJumpSpeed > 0) {
      m.e.input.speed = this.nextJumpSpeed * m.speed;
      m.e.input.forward = m.e.input.speed;
    }
    this.wasOnGround = m.onGround;
  }
}

/** Rabbits nibble ripe carrots from farms (reference RaidGardenGoal). */
class RaidGardenGoal extends Goal {
  private target: [number, number, number] | null = null;
  private tries = 0;
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const m = this.m;
    if (m.level.getGameRule('mobGriefing') === false || ((m.tmp['moreCarrotTicks'] as number | undefined) ?? 0) > 0) return false;
    if (m.random.nextInt(reducedTickDelay(200)) !== 0) return false;
    const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        for (let dz = -8; dz <= 8; dz++) {
          const s = m.level.getBlockState(bx + dx, by + dy, bz + dz);
          if (blockOf(s).name === 'carrots' && getValue(s, P.age7) === 7 && blockOf(m.level.getBlockState(bx + dx, by + dy - 1, bz + dz)).name === 'farmland') {
            this.target = [bx + dx, by + dy, bz + dz];
            return true;
          }
        }
      }
    }
    return false;
  }
  override canContinueToUse(): boolean {
    return !!this.target && this.tries < 1200 && blockOf(this.m.level.getBlockState(...this.target)).name === 'carrots';
  }
  override start(): void {
    const [x, y, z] = this.target!;
    this.m.nav.moveTo(x + 0.5, y, z + 0.5, 0.7);
    this.tries = 0;
  }
  override stop(): void {
    this.target = null;
  }
  override tick(): void {
    const [x, y, z] = this.target!;
    this.tries++;
    this.m.look.setLookAt(x + 0.5, y + 1, z + 0.5, 10, 40);
    if ((this.m.x - x - 0.5) ** 2 + (this.m.z - z - 0.5) ** 2 > 1) {
      if (this.m.nav.isDone()) this.m.nav.moveTo(x + 0.5, y, z + 0.5, 0.7);
      return;
    }
    const level = this.m.level;
    const s = level.getBlockState(x, y, z);
    const age = getValue(s, P.age7);
    if (age === 0) level.destroyBlock(x, y, z, true, this.m.e);
    else {
      level.setBlock(x, y, z, setValue(s, P.age7, age - 1), 2);
      level.levelEvent(2001, x, y, z, s);
    }
    this.m.tmp['moreCarrotTicks'] = 40;
    this.target = null;
  }
}

function rabbitVariant(m: Mob): string {
  const b = BIOMES[m.level.getBiome(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))];
  const r = m.random.nextInt(100);
  if (b?.category === 'desert') return 'gold';
  if (b?.category === 'icy' || b?.name === 'snowy_taiga' || b?.name === 'grove' || b?.name === 'snowy_slopes') return r < 80 ? 'white' : 'spotted';
  return r < 50 ? 'brown' : r < 90 ? 'salt' : 'black';
}

function syncRabbitAttrs(m: Mob): void {
  const fierce = m.data['variant'] === 'fierce';
  m.e.living.attrs.get('armor').setBase(fierce ? 8 : 0);
  m.e.living.attrs.get('attack_damage').setBase(fierce ? 5 : 3);
  m.tmp['attacksOwnKind'] = false;
}

registerMob({
  id: 'rabbit', attrs: { max_health: 3, movement_speed: 0.3, attack_damage: 3 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: items('carrot', 'golden_carrot', 'dandelion'), ...sounds('rabbit'),
  setup(m) {
    const hop = new HopMoveControl(m);
    m.move = hop;
    const fierce = () => m.data['variant'] === 'fierce';
    m.goals.add(1, new FloatGoal(m));
    m.goals.add(1, new (class extends PanicGoal {
      override canUse(): boolean {
        return !fierce() && super.canUse();
      }
    })(m, 2.2));
    m.goals.add(2, new BreedGoal(m, 0.8));
    m.goals.add(3, new TemptGoal(m, 1, items('carrot', 'golden_carrot', 'dandelion'), false));
    m.goals.add(4, new AvoidEntityGoal(m, (e) => !fierce() && !!e.player, 8, 2.2, 2.2));
    m.goals.add(4, new AvoidEntityGoal(m, (e) => !fierce() && e.type === 'wolf', 10, 2.2, 2.2));
    m.goals.add(4, new AvoidEntityGoal(m, (e) => !fierce() && !!e['hostile'], 4, 2.2, 2.2));
    m.goals.add(4, new (class extends MeleeAttackGoal {
      override canUse(): boolean {
        return fierce() && super.canUse();
      }
    })(m, 1.4, true));
    m.goals.add(5, new RaidGardenGoal(m));
    m.goals.add(6, new RandomStrollGoal(m, 0.6, 120, true, true));
    m.goals.add(11, new LookAtPlayerGoal(m, 10));
    m.targets.add(1, new (class extends HurtByTargetGoal {
      override canUse(): boolean {
        return fierce() && super.canUse();
      }
    })(m));
    m.targets.add(2, new NearestAttackableTargetGoal(m, 'player', 10, true, false, () => fierce()));
    m.targets.add(2, new NearestAttackableTargetGoal(m, (e) => fierce() && e.type === 'wolf', 10, true));
  },
  init(m, ctx) {
    m.data['variant'] = (ctx.opts['variant'] as string | undefined) ?? rabbitVariant(m);
    syncRabbitAttrs(m);
  },
  loaded: syncRabbitAttrs,
  tick(m) {
    const t = (m.tmp['moreCarrotTicks'] as number | undefined) ?? 0;
    if (t > 0) m.tmp['moreCarrotTicks'] = t - m.random.nextInt(3);
    // The fierce variant pounces at close targets
    if (m.data['variant'] === 'fierce' && m.onGround) {
      const target = m.getTarget();
      if (target && m.distanceToSqr(target) < 16) {
        const tt = target.transform!;
        m.move.setWantedPosition(tt.x, tt.y, tt.z, 1.4);
      }
    }
  },
  syncMeta(m) {
    m.setMeta('variant', (m.data['variant'] as string | undefined) ?? 'brown');
  },
  offspring(m, partner) {
    // Babies take a parent's coat, or the local coat one time in twenty
    const v = m.random.nextInt(20) === 0 ? rabbitVariant(m) : (m.random.nextBool() ? m : partner).data['variant'];
    return { type: 'rabbit', data: { variant: v } };
  },
  doHurtTarget(m, target) {
    if (m.data['variant'] !== 'fierce') return false;
    m.playSound('entity.rabbit.attack');
    return defaultHurtTarget(m, target);
  },
  hurtFilter(m, type, amount) {
    // Rabbits take less fall damage (reference fall multiplier via jump strength)
    return type === 'fall' ? Math.max(0, amount - 1) : amount;
  },
  lootFlags(m) {
    return { variant: m.data['variant'] };
  },
});

// ---- Hooks -----------------------------------------------------------------------------------
const prevAbsorb = livingHooks.absorbHit;
livingHooks.absorbHit = (level, e, type, amount) => {
  const m = mobOf(e);
  if (m && m.def.id === 'wolf' && wolfAbsorb(m, type, amount)) return true;
  return prevAbsorb(level, e, type, amount);
};
