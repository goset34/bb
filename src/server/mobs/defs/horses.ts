/**
 * Mounts: horses (coats, markings, armour), donkeys and mules (chests), skeleton and zombie
 * horses (trap riders), llamas (carpets, spitting, caravans) and camels (two seats, dashing,
 * sitting). Taming by riding, food effects on health/growth/temper, charged jumps, breeding with
 * inherited stats and mule hybrids, and the mount inventory.
 */
import type { Entity } from '../../../common/entity/ecs';
import { ItemStack } from '../../../common/item/stack';
import { getItem } from '../../../common/item/items';
import { SimpleContainer } from '../../../common/menu/container';
import { MountMenu, MountSlots } from '../../../common/menu/horse';
import { registerMob, Mob, MobDef, mobOf } from '../mob';
import type { ServerPlayer } from '../../player';
import { SERVER_MENUS } from '../../menus';
import { Goal, Flag, reducedTickDelay } from '../goals';
import {
  FloatGoal, PanicGoal, BreedGoal, TemptGoal, FollowParentGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, HurtByTargetGoal,
  NearestAttackableTargetGoal,
} from '../goallib';
import { defaultRandomPos } from '../randompos';
import { handStack, useItem, getAge, setAge, ageUp, setInLove, canFallInLove } from '../actions';
import { heal } from '../../survival/living';
import { startRiding, ejectPassengers, passengersOf, vehicleOf } from '../../entity/riding';
import { RangedAttackGoal, mobThrow } from '../../combat/ranged';
import { items, sounds } from './common';
import { tame } from '../tamable';

// ---------------------------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------------------------

const containers = new WeakMap<Mob, SimpleContainer>();

function columnsOf(m: Mob): number {
  if (!m.data['chest']) return 0;
  if (m.def.id === 'llama') return Math.max(1, Math.min(5, (m.data['strength'] as number | undefined) ?? 3));
  return 5;
}

export function mountSpec(m: Mob): MountSlots {
  const id = m.def.id;
  return {
    saddle: id !== 'llama',
    body: id === 'horse' ? 'armor' : id === 'llama' ? 'carpet' : null,
    columns: columnsOf(m),
  };
}

/** Live inventory of a mount (saddle, body slot, chest), kept in the saved data. */
export function mountInventory(m: Mob): SimpleContainer {
  const size = 2 + columnsOf(m) * 3;
  let c = containers.get(m);
  if (!c || c.size !== size) {
    const old = c;
    c = new SimpleContainer(size);
    c.load((m.data['inv'] as Parameters<SimpleContainer['load']>[0]) ?? []);
    // Keep saddle/armour when the chest is added or removed
    if (old) for (let i = 0; i < Math.min(old.size, size); i++) c.set(i, old.get(i));
    containers.set(m, c);
  }
  return c;
}

function persistInventory(m: Mob): void {
  m.data['inv'] = mountInventory(m).toJSON();
}

function saddled(m: Mob): boolean {
  return mountInventory(m).get(0).id === 'saddle';
}

/** Mirror the inventory on the synced metadata and armour attribute. */
function refreshMount(m: Mob): void {
  const inv = mountInventory(m);
  const body = inv.get(1);
  m.setMeta('saddled', saddled(m));
  m.setMeta('chest', !!m.data['chest']);
  m.setMeta('body', body.isEmpty() ? '' : body.id);
  const armor = (getItem(body.id)?.extra?.['horseArmor'] as number | undefined) ?? 0;
  m.e.living.attrs.get('armor').add({ id: 'horse_armor', amount: armor, op: 'add' });
  m.setMeta('tamed', !!m.data['tamed']);
}

SERVER_MENUS.set('mount', (p, id, o) => {
  const e = p.level.entities.get(o.extra?.['entity'] as number);
  const m = mobOf(e);
  if (!m) return null;
  const spec = mountSpec(m);
  const menu = new MountMenu(id, mountInventory(m), p.inventory, spec, () => m.alive && m.distanceToSqr(p.entity) < 64);
  const name = m.e['customName'] as string | undefined;
  return { menu, title: name ? { text: name } : { key: `entity.${m.def.id}` }, size: 2 + spec.columns * 3, extra: { spec, entity: m.e.id } };
});

export function openMountInventory(m: Mob, p: ServerPlayer): void {
  p.menus.openMenu('mount', { x: Math.floor(m.x), y: Math.floor(m.y), z: Math.floor(m.z), extra: { entity: m.e.id } });
}

// ---------------------------------------------------------------------------------------------
// Food, taming, riding
// ---------------------------------------------------------------------------------------------

interface HorseFood { heal: number; age: number; temper: number; love: boolean }

const HORSE_FOOD: Record<string, HorseFood> = {
  wheat: { heal: 2, age: 20, temper: 3, love: false }, sugar: { heal: 1, age: 30, temper: 3, love: false },
  hay_block: { heal: 20, age: 180, temper: 0, love: false }, apple: { heal: 3, age: 60, temper: 3, love: false },
  golden_carrot: { heal: 4, age: 60, temper: 5, love: true }, golden_apple: { heal: 10, age: 240, temper: 10, love: true },
  enchanted_golden_apple: { heal: 10, age: 240, temper: 10, love: true },
};
const LLAMA_FOOD: Record<string, HorseFood> = {
  wheat: { heal: 2, age: 10, temper: 0, love: false }, hay_block: { heal: 10, age: 90, temper: 0, love: true },
};
const CAMEL_FOOD: Record<string, HorseFood> = { cactus: { heal: 2, age: 10, temper: 0, love: true } };

function foodTable(m: Mob): Record<string, HorseFood> {
  return m.def.id === 'llama' ? LLAMA_FOOD : m.def.id === 'camel' ? CAMEL_FOOD : m.def.id.endsWith('skeleton_horse') || m.def.id === 'zombie_horse' ? {} : HORSE_FOOD;
}

/** Reference AbstractHorse.handleEating. */
function eat(m: Mob, p: ServerPlayer, stack: ItemStack): boolean {
  const f = foodTable(m)[stack.id];
  if (!f) return false;
  let used = false;
  if (m.health < m.maxHealth && f.heal > 0) {
    heal(m.e, f.heal);
    used = true;
  }
  if (m.isBaby && f.age > 0) {
    ageUp(m, f.age, true);
    used = true;
  }
  const temper = (m.data['temper'] as number | undefined) ?? 0;
  if (f.temper > 0 && (used || !m.data['tamed']) && temper < 100) {
    m.data['temper'] = Math.min(100, temper + f.temper);
    used = true;
  }
  if (f.love && m.data['tamed'] && getAge(m) === 0 && canFallInLove(m)) {
    setInLove(m, p.entity);
    used = true;
  }
  if (used) {
    m.playSound(m.def.id === 'llama' ? 'entity.llama.eat' : m.def.id === 'camel' ? 'entity.camel.eat' : 'entity.horse.eat');
    m.setMeta('eating', true);
    m.tmp['eatTicks'] = 30;
    useItem(p, handOf(p, stack), stack);
  }
  return used;
}

function handOf(p: ServerPlayer, stack: ItemStack): 'main' | 'off' {
  return p.inventory.mainHand === stack ? 'main' : 'off';
}


function makeMad(m: Mob): void {
  m.playSound(m.def.id === 'donkey' || m.def.id === 'mule' ? `entity.${m.def.id}.angry` : 'entity.horse.angry');
  m.setMeta('standing', true);
  m.tmp['standTicks'] = 20;
}

/** Wild horses buck random riders until tamed (reference RunAroundLikeCrazyGoal). */
class RunAroundLikeCrazyGoal extends Goal {
  private pos: [number, number, number] | null = null;
  constructor(private readonly m: Mob, private readonly speed: number) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    if (this.m.data['tamed'] || !passengersOf(this.m.e).length) return false;
    this.pos = defaultRandomPos(this.m, 5, 4);
    return this.pos !== null;
  }
  override start(): void {
    const [x, y, z] = this.pos!;
    this.m.nav.moveTo(x, y, z, this.speed);
  }
  override canContinueToUse(): boolean {
    return !this.m.data['tamed'] && !this.m.nav.isDone() && passengersOf(this.m.e).length > 0;
  }
  override tick(): void {
    const m = this.m;
    if (m.data['tamed'] || m.random.nextInt(this.adjustedTickDelay(50)) !== 0) return;
    const rider = passengersOf(m.e)[0];
    if (!rider) return;
    if (rider.player) {
      const temper = (m.data['temper'] as number | undefined) ?? 0;
      if (m.random.nextInt(100) < temper) {
        tame(m, rider);
        return;
      }
      m.data['temper'] = Math.min(100, temper + 5);
    }
    ejectPassengers(m.level, m.e);
    makeMad(m);
    m.broadcastEvent('smoke');
  }
}

/** Charged horse jumps: hold jump on the ground, release to leap (reference jump bar). */
function riddenHorse(m: Mob, _rider: Entity, input: { forward: number; strafe: number; jumping: boolean; yaw: number; pitch: number }): void {
  const t = m.e.transform, inp = m.e.input;
  t.yaw = t.bodyYaw = t.headYaw = input.yaw;
  t.pitch = input.pitch * 0.5;
  let f1 = input.forward;
  if (f1 <= 0) f1 *= 0.25;
  inp.speed = m.speed;
  inp.speedModifier = 1;
  inp.forward = f1;
  inp.strafe = input.strafe * 0.5;
  inp.jumping = false;
  if (m.tmp['standTicks'] && (m.tmp['standTicks'] as number) > 0) {
    inp.forward = 0;
    inp.strafe = 0;
  }
  // Camels dash instead of jumping
  const charge = (m.tmp['jumpCharge'] as number | undefined) ?? 0;
  if (input.jumping && m.onGround) m.tmp['jumpCharge'] = charge + 1;
  else if (charge > 0) {
    m.tmp['jumpCharge'] = 0;
    const pct = charge < 10 ? charge * 0.1 : 0.8 + (2 / (charge - 9)) * 0.1;
    const power = Math.floor(pct * 100) >= 90 ? 1 : 0.4 + (0.4 * Math.floor(pct * 100)) / 90;
    if (m.onGround) {
      if (m.def.id === 'camel') camelDash(m, power);
      else {
        const p = m.e.physics;
        p.vy = m.attr('jump_strength') * power;
        if (f1 > 0) {
          const yaw = (t.yaw * Math.PI) / 180;
          p.vx += -0.4 * Math.sin(yaw) * power;
          p.vz += 0.4 * Math.cos(yaw) * power;
        }
        m.playSound('entity.horse.jump', 0.4);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Shared definition
// ---------------------------------------------------------------------------------------------

const HORSE_COLORS = ['white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'dark_brown'];
const HORSE_MARKINGS = ['none', 'white', 'white_field', 'white_dots', 'black_dots'];

function randomHealth(m: Mob): number {
  return 15 + m.random.nextInt(8) + m.random.nextInt(9);
}
function randomJump(m: Mob): number {
  return 0.4 + m.random.nextDouble() * 0.2 + m.random.nextDouble() * 0.2 + m.random.nextDouble() * 0.2;
}
function randomSpeed(m: Mob): number {
  return (0.45 + m.random.nextDouble() * 0.3 + m.random.nextDouble() * 0.3 + m.random.nextDouble() * 0.3) * 0.25;
}

/** Offspring attribute between the parents' values with some spread (reference). */
function childStat(m: Mob, a: number, b: number, min: number, max: number): number {
  const avg = (a + b) / 2;
  const spread = Math.abs(a - b) + (max - min) * 0.3;
  const v = avg + (m.random.nextDouble() + m.random.nextDouble() + m.random.nextDouble() - 1.5) / 1.5 * spread * 0.5;
  return Math.max(min, Math.min(max, v));
}

function setStats(m: Mob, health: number, speed: number, jump: number): void {
  const a = m.e.living.attrs;
  a.get('max_health').setBase(health);
  a.get('movement_speed').setBase(speed);
  a.get('jump_strength').setBase(jump);
  m.e.living.health = health;
  m.e.input.speed = speed;
}

function horseGoals(m: Mob, tempt?: (s: ItemStack) => boolean): void {
  m.goals.add(0, new FloatGoal(m));
  m.goals.add(1, new PanicGoal(m, 1.2));
  m.goals.add(1, new RunAroundLikeCrazyGoal(m, 1.2));
  m.goals.add(2, new BreedGoal(m, 1));
  if (tempt) m.goals.add(3, new TemptGoal(m, 1.25, tempt, false));
  m.goals.add(4, new FollowParentGoal(m, 1));
  m.goals.add(6, new RandomStrollGoal(m, 0.7, 120, true, true));
  m.goals.add(7, new LookAtPlayerGoal(m, 6));
  m.goals.add(8, new RandomLookAroundGoal(m));
}

/** Right click on a mount (reference AbstractHorse.mobInteract + fedFood/equip logic). */
function mountInteract(m: Mob, p: ServerPlayer, hand: 'main' | 'off'): boolean {
  const stack = handStack(p, hand);
  const tamed = !!m.data['tamed'];
  const sneaking = p.entity.input.sneaking;
  if (m.isBaby) return !stack.isEmpty() && eat(m, p, stack);
  if (tamed && sneaking && !vehicleOf(p.entity)) {
    openMountInventory(m, p);
    return true;
  }
  if (!stack.isEmpty()) {
    if (eat(m, p, stack)) return true;
    const chestable = m.def.id === 'donkey' || m.def.id === 'mule' || m.def.id === 'llama';
    if (tamed && chestable && stack.id === 'chest' && !m.data['chest']) {
      m.data['chest'] = true;
      mountInventory(m);
      refreshMount(m);
      m.playSound('entity.donkey.chest');
      useItem(p, hand, stack);
      return true;
    }
    const inv = mountInventory(m);
    if (stack.id === 'saddle' && mountSpec(m).saddle) {
      if (!tamed) {
        makeMad(m);
        return true;
      }
      if (inv.get(0).isEmpty()) {
        inv.set(0, stack.copyWithCount(1));
        persistInventory(m);
        refreshMount(m);
        m.playSound('entity.horse.saddle');
        useItem(p, hand, stack);
        return true;
      }
    }
    const spec = mountSpec(m);
    const bodyOk = (spec.body === 'armor' && getItem(stack.id)?.extra?.['horseArmor']) || (spec.body === 'carpet' && stack.id.endsWith('_carpet'));
    if (bodyOk && tamed) {
      const old = inv.get(1);
      inv.set(1, stack.copyWithCount(1));
      if (!old.isEmpty()) m.level.spawnItem(m.x, m.y + 1, m.z, old);
      persistInventory(m);
      refreshMount(m);
      m.playSound(spec.body === 'carpet' ? 'entity.llama.swag' : 'entity.horse.armor');
      useItem(p, hand, stack);
      return true;
    }
    if (stack.id === 'lead' || stack.id === 'name_tag') return false;
  }
  if (!vehicleOf(p.entity) && passengersOf(m.e).length < (m.def.id === 'camel' ? 2 : 1)) {
    const t = p.entity.transform;
    t.yaw = m.e.transform.yaw;
    t.pitch = m.e.transform.pitch;
    return startRiding(m.level, p.entity, m.e);
  }
  return false;
}

function mountDef(id: string, extra: Partial<MobDef>): MobDef {
  return {
    id, attrs: { max_health: 20, movement_speed: 0.225, jump_strength: 0.7, follow_range: 16 }, ageable: true, persistent: false,
    xp: (m) => 1 + m.random.nextInt(3),
    ...sounds(id),
    setup: (m) => horseGoals(m, (s) => !!foodTable(m)[s.id]),
    food: () => false,
    interact: mountInteract,
    controlledBy: (m, rider) => !!m.data['tamed'] && saddled(m) && !!rider.player,
    ridden: riddenHorse,
    syncMeta: refreshMount,
    loaded(m) {
      refreshMount(m);
    },
    tick(m) {
      // Foals inherit the stats computed at breeding time
      if (m.data['stats']) childFromStats(m);
      const stand = (m.tmp['standTicks'] as number | undefined) ?? 0;
      if (stand > 0) {
        m.tmp['standTicks'] = stand - 1;
        if (stand === 1) m.setMeta('standing', false);
      }
      const eatTicks = (m.tmp['eatTicks'] as number | undefined) ?? 0;
      if (eatTicks > 0) {
        m.tmp['eatTicks'] = eatTicks - 1;
        if (eatTicks === 1) m.setMeta('eating', false);
      } else if (m.random.nextInt(300) === 0 && !passengersOf(m.e).length && m.onGround) {
        // Idle grazing animation
        m.setMeta('eating', true);
        m.tmp['eatTicks'] = 30;
      }
      // Persist inventory changes made through the menu
      const inv = mountInventory(m);
      const key = inv.toJSON().map((s) => (s ? `${s.id}:${s.count}` : '')).join(',');
      if (key !== m.tmp['invKey']) {
        m.tmp['invKey'] = key;
        persistInventory(m);
        refreshMount(m);
      }
    },
    onDeath(m) {
      const inv = mountInventory(m);
      for (let i = 0; i < inv.size; i++) {
        const s = inv.get(i);
        if (!s.isEmpty()) m.level.spawnItem(m.x, m.y + 0.5, m.z, s.copy());
      }
      if (m.data['chest']) m.level.spawnItem(m.x, m.y + 0.5, m.z, new ItemStack('chest', 1));
    },
    leashable: true,
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------
// Horses, donkeys, mules
// ---------------------------------------------------------------------------------------------

registerMob(mountDef('horse', {
  init(m, ctx) {
    setStats(m, randomHealth(m), randomSpeed(m), randomJump(m));
    const color = typeof ctx.opts['color'] === 'number' ? ctx.opts['color'] as number : m.random.nextInt(HORSE_COLORS.length);
    const markings = m.random.nextInt(HORSE_MARKINGS.length);
    m.data['variant'] = `${HORSE_COLORS[color]}/${HORSE_MARKINGS[markings]}`;
    if (ctx.opts['baby'] !== true && ctx.reason !== 'breeding' && m.random.nextFloat() < 0.2) setAge(m, -24000);
  },
  syncMeta(m) {
    refreshMount(m);
    m.setMeta('variant', (m.data['variant'] as string | undefined) ?? 'brown/none');
  },
  canMate(m, o) {
    return (o.def.id === 'horse' || o.def.id === 'donkey') && o !== m && !!m.tmp['inLove'] && !!o.tmp['inLove'] && !!m.data['tamed'] && !!o.data['tamed'];
  },
  offspring(m, partner) {
    const a = m.e.living.attrs, b = partner.e.living.attrs;
    const stats = {
      max_health: childStat(m, a.get('max_health').base, b.get('max_health').base, 15, 30),
      movement_speed: childStat(m, a.get('movement_speed').base, b.get('movement_speed').base, 0.1125, 0.3375),
      jump_strength: childStat(m, a.get('jump_strength').base, b.get('jump_strength').base, 0.4, 1),
    };
    if (partner.def.id === 'donkey') return { type: 'mule', data: { stats } };
    const r = m.random.nextInt(9);
    const [ca] = String(m.data['variant']).split('/'), [cb] = String(partner.data['variant']).split('/');
    const color = r < 4 ? ca : r < 8 ? cb : HORSE_COLORS[m.random.nextInt(7)];
    const r2 = m.random.nextInt(5);
    const mark = r2 < 2 ? String(m.data['variant']).split('/')[1] : r2 < 4 ? String(partner.data['variant']).split('/')[1] : HORSE_MARKINGS[m.random.nextInt(5)];
    return { type: 'horse', data: { variant: `${color}/${mark}`, stats } };
  },
}));

function childFromStats(m: Mob): void {
  const s = m.data['stats'] as { max_health: number; movement_speed: number; jump_strength: number } | undefined;
  if (!s) return;
  setStats(m, s.max_health, s.movement_speed, s.jump_strength);
  delete m.data['stats'];
}

registerMob(mountDef('donkey', {
  init(m) {
    setStats(m, randomHealth(m), 0.175, 0.5);
  },
  loaded(m) {
    childFromStats(m);
    refreshMount(m);
  },
  canMate(m, o) {
    return (o.def.id === 'horse' || o.def.id === 'donkey') && o !== m && !!m.tmp['inLove'] && !!o.tmp['inLove'] && !!m.data['tamed'] && !!o.data['tamed'];
  },
  offspring(_m, partner) {
    return { type: partner.def.id === 'horse' ? 'mule' : 'donkey' };
  },
}));

registerMob(mountDef('mule', {
  init(m) {
    setStats(m, randomHealth(m), 0.175, 0.5);
  },
  offspring: () => null,
  canMate: () => false,
}));

// ---------------------------------------------------------------------------------------------
// Undead horses
// ---------------------------------------------------------------------------------------------

/** Skeleton trap: when a player comes near, lightning spawns four skeleton riders (reference SkeletonTrapGoal). */
class SkeletonTrapGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
  }
  canUse(): boolean {
    const m = this.m;
    if (!m.data['trap']) return false;
    return m.level.players.some((p) => p.data.gameMode !== 'spectator' && m.distanceToSqr(p.entity) < 100);
  }
  override tick(): void {
    const m = this.m, level = m.level;
    m.data['trap'] = false;
    m.data['tamed'] = true;
    m.setPersistent();
    level.createEntity('lightning_bolt', m.x, m.y, m.z, { visualOnly: true });
    const riders: Mob[] = [];
    const first = level.createEntity('skeleton', m.x, m.y, m.z, { reason: 'triggered' });
    if (first) riders.push(mobOf(first)!);
    for (let i = 0; i < 3; i++) {
      const h = level.createEntity('skeleton_horse', m.x + m.random.triangle(0, 1.1485), m.y, m.z + m.random.triangle(0, 1.1485), { reason: 'triggered' });
      const hm = mobOf(h);
      if (!hm) continue;
      hm.data['tamed'] = true;
      const sk = level.createEntity('skeleton', hm.x, hm.y, hm.z, { reason: 'triggered' });
      const sm = mobOf(sk);
      if (!sm) continue;
      startRiding(level, sm.e, hm.e);
      riders.push(sm);
      hm.e.physics.vx = m.random.triangle(0, 0.5);
      hm.e.physics.vz = m.random.triangle(0, 0.5);
    }
    if (first) startRiding(level, first, m.e);
    for (const r of riders) {
      // Riders wear iron helmets and carry enchanted bows (enchanting module adds the enchantments)
      r.equipment[5] = new ItemStack('iron_helmet', 1);
      r.dropChances[5] = 0;
      r.setPersistent();
    }
  }
}

registerMob(mountDef('skeleton_horse', {
  attrs: { max_health: 15, movement_speed: 0.2, jump_strength: 0.7, follow_range: 16 }, undead: true,
  setup(m) {
    m.goals.add(1, new SkeletonTrapGoal(m));
    horseGoals(m);
  },
  init(m, ctx) {
    setStats(m, 15, 0.2, randomJump(m));
    if (ctx.opts['trap'] === true) {
      m.data['trap'] = true;
      m.data['trapTime'] = 0;
    }
  },
  tick(m) {
    // Untriggered traps vanish after 15 minutes
    if (m.data['trap']) {
      m.data['trapTime'] = ((m.data['trapTime'] as number | undefined) ?? 0) + 1;
      if ((m.data['trapTime'] as number) >= 18000) m.level.entities.remove(m.e);
    }
  },
  offspring: () => null,
  canMate: () => false,
}));

registerMob(mountDef('zombie_horse', {
  attrs: { max_health: 25, movement_speed: 0.2, jump_strength: 0.6, follow_range: 16 }, undead: true, burnsInDay: false,
  init(m) {
    setStats(m, 15 + m.random.nextInt(8) + m.random.nextInt(9) * 0.5, 0.2, randomJump(m));
  },
  offspring: () => null,
  canMate: () => false,
}));

// ---------------------------------------------------------------------------------------------
// Llamas
// ---------------------------------------------------------------------------------------------

const LLAMA_VARIANTS = ['creamy', 'white', 'brown', 'gray'];

function llamaSpit(m: Mob, target: Entity): void {
  mobThrow(m, target, 'llama_spit', 1.5, 10);
  m.playSound('entity.llama.spit', 1, 1 + (m.random.nextFloat() - m.random.nextFloat()) * 0.2);
  m.tmp['didSpit'] = true;
}

/** Llamas follow the llama or leash holder ahead of them in a caravan. */
class FollowCaravanGoal extends Goal {
  private ahead: Mob | null = null;
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const m = this.m;
    if (m.leashHolder || m.tmp['caravanHead']) return false;
    let best: Mob | null = null;
    let bd = Infinity;
    for (const e of m.level.getEntities(m.box().inflate(9, 4, 9), (e) => mobOf(e)?.def.id === 'llama', m.e)) {
      const o = mobOf(e)!;
      if (o.tmp['caravanTail'] || (!o.leashHolder && !o.tmp['caravanHead'])) continue;
      const d = m.distanceToSqr(e);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best || bd < 4) return false;
    this.ahead = best;
    return true;
  }
  override start(): void {
    this.m.tmp['caravanHead'] = this.ahead;
    this.ahead!.tmp['caravanTail'] = this.m;
  }
  override stop(): void {
    if (this.ahead) this.ahead.tmp['caravanTail'] = undefined;
    this.m.tmp['caravanHead'] = undefined;
    this.ahead = null;
  }
  override canContinueToUse(): boolean {
    const a = this.ahead;
    return !!a && a.alive && (!!a.leashHolder || !!a.tmp['caravanHead']) && this.m.distanceToSqr(a.e) <= 676;
  }
  override tick(): void {
    const a = this.ahead!;
    const d = Math.sqrt(this.m.distanceToSqr(a.e));
    if (d > 2) this.m.nav.moveToEntity(a.e, 2.1 * (d > 6 ? 1 : 0.5));
    else this.m.nav.stop();
  }
}

registerMob(mountDef('llama', {
  attrs: { max_health: 22, movement_speed: 0.175, jump_strength: 0.5, follow_range: 40 },
  setup(m) {
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new RunAroundLikeCrazyGoal(m, 1.2));
    m.goals.add(2, new FollowCaravanGoal(m));
    m.goals.add(3, new RangedAttackGoal(m, 1.25, 40, 40, 20, (mm, t) => llamaSpit(mm, t)));
    m.goals.add(3, new PanicGoal(m, 1.2));
    m.goals.add(4, new BreedGoal(m, 1));
    m.goals.add(5, new TemptGoal(m, 1.25, items('hay_block'), false));
    m.goals.add(6, new FollowParentGoal(m, 1));
    m.goals.add(7, new RandomStrollGoal(m, 0.7, 120, true, true));
    m.goals.add(8, new LookAtPlayerGoal(m, 6));
    m.goals.add(9, new RandomLookAroundGoal(m));
    m.targets.add(1, new HurtByTargetGoal(m).setAlertOthers());
    m.targets.add(2, new NearestAttackableTargetGoal(m, (e) => e.type === 'wolf' && !(mobOf(e)?.data['tamed']), 10, true));
  },
  init(m, ctx) {
    setStats(m, randomHealth(m), 0.175, 0.5);
    const r = m.random.nextFloat();
    m.data['strength'] = 1 + (r < 0.04 ? 4 : r < 0.1 ? 3 : r < 0.3 ? 2 : r < 0.6 ? 1 : 0);
    m.data['variant'] = (ctx.opts['variant'] as string | undefined) ?? LLAMA_VARIANTS[m.random.nextInt(4)];
  },
  syncMeta(m) {
    refreshMount(m);
    m.setMeta('variant', (m.data['variant'] as string | undefined) ?? 'creamy');
  },
  onHurt(m, _t, _a, attacker) {
    // Llamas spit back once at whoever hurt them
    if (attacker && m.random.nextFloat() < 0.5) m.setTarget(attacker);
  },
  controlledBy: () => false,
  offspring(m, partner) {
    const strength = Math.max(1, Math.min(5, Math.max((m.data['strength'] as number) ?? 1, (partner.data['strength'] as number) ?? 1) + (m.random.nextFloat() < 0.03 ? 1 : 0)));
    return { type: 'llama', data: { strength, variant: m.random.nextBool() ? m.data['variant'] : partner.data['variant'] } };
  },
}));

// ---------------------------------------------------------------------------------------------
// Camels
// ---------------------------------------------------------------------------------------------

function camelDash(m: Mob, power: number): void {
  const cd = (m.tmp['dashCooldown'] as number | undefined) ?? 0;
  if (cd > 0 || m.data['sitting']) return;
  const t = m.e.transform, p = m.e.physics;
  const yaw = (t.yaw * Math.PI) / 180;
  const f = 22.2222 * power * m.speed * 1.4;
  p.vx += -Math.sin(yaw) * f;
  p.vz += Math.cos(yaw) * f;
  p.vy += 1.4285 * power * 0.42;
  m.tmp['dashCooldown'] = 55;
  m.setMeta('dashing', true);
  m.playSound('entity.camel.dash', 1, 1);
}

/** Camels sit down and stand up on their own when idle. */
class CamelRestGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
  }
  canUse(): boolean {
    return !passengersOf(this.m.e).length && this.m.random.nextInt(reducedTickDelay(800)) === 0 && this.m.onGround;
  }
  override start(): void {
    const m = this.m;
    m.data['sitting'] = !m.data['sitting'];
    m.setMeta('sitting', !!m.data['sitting']);
    m.playSound(m.data['sitting'] ? 'entity.camel.sit' : 'entity.camel.stand');
  }
  override canContinueToUse(): boolean {
    return false;
  }
}

registerMob(mountDef('camel', {
  attrs: { max_health: 32, movement_speed: 0.09, jump_strength: 0.42, follow_range: 16 },
  setup(m) {
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new PanicGoal(m, 4));
    m.goals.add(2, new BreedGoal(m, 1));
    m.goals.add(3, new TemptGoal(m, 2.5, items('cactus'), false));
    m.goals.add(4, new FollowParentGoal(m, 1));
    m.goals.add(5, new CamelRestGoal(m));
    m.goals.add(6, new RandomStrollGoal(m, 1, 120, true, true));
    m.goals.add(7, new LookAtPlayerGoal(m, 6));
    m.goals.add(8, new RandomLookAroundGoal(m));
  },
  init(m) {
    m.data['tamed'] = true;
  },
  tick(m) {
    const cd = (m.tmp['dashCooldown'] as number | undefined) ?? 0;
    if (cd > 0) {
      m.tmp['dashCooldown'] = cd - 1;
      if (cd === 1) m.setMeta('dashing', false);
    }
    // A sitting camel does not wander
    if (m.data['sitting']) {
      m.nav.stop();
      if (passengersOf(m.e).length) {
        m.data['sitting'] = false;
        m.setMeta('sitting', false);
      }
    }
  },
  syncMeta(m) {
    refreshMount(m);
    m.setMeta('sitting', !!m.data['sitting']);
  },
  offspring: () => ({ type: 'camel', data: { tamed: true } }),
}));

export { HORSE_COLORS, HORSE_MARKINGS, LLAMA_VARIANTS };
