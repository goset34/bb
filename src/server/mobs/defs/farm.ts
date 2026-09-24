/**
 * Farm animals: pig, cow, mushcow, sheep and chicken, with climate variants, milking, shearing,
 * dyeing, grazing, egg laying and mushroom stew.
 */
import { ItemStack } from '../../../common/item/stack';
import { BIOMES } from '../../../common/worldgen/biomes';
import { blockOf } from '../../../common/block/registry';
import { damagePlayerSlot } from '../../survival/interaction';
import { registerMob, Mob, MobDef, mobOf } from '../mob';
import { holdsSteeringItem, rideSteered } from '../steering';
import { startRiding, passengersOf } from '../../entity/riding';
import { spawnMob } from '../factory';
import { handStack, exchangeItem, useItem } from '../actions';
import { EatBlockGoal } from '../goallib';
import { animalGoals, items, sounds } from './common';
import type { ServerPlayer } from '../../player';

/** Climate variant from the biome temperature (reference farm animal variants). */
export function climateVariant(m: Mob): 'temperate' | 'warm' | 'cold' {
  const b = BIOMES[m.level.getBiome(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))];
  const t = b?.temperature ?? 0.8;
  if (t >= 1.5 || b?.category === 'desert' || b?.category === 'savanna' || b?.category === 'badlands' || b?.category === 'jungle') return 'warm';
  if (t < 0.2 || b?.category === 'icy') return 'cold';
  return 'temperate';
}

function slotOf(p: ServerPlayer, hand: 'main' | 'off'): number {
  return hand === 'main' ? p.inventory.selected : 40;
}

const variantMeta = (m: Mob) => m.setMeta('variant', (m.data['variant'] as string | undefined) ?? 'temperate');

// ---- Pig -------------------------------------------------------------------------------------
registerMob({
  id: 'pig', attrs: { max_health: 10, movement_speed: 0.25 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: items('carrot', 'potato', 'beetroot'), ...sounds('pig'),
  setup(m) {
    animalGoals(m, { panic: 1.25, breed: 1, tempt: 1.2, temptItems: items('carrot', 'potato', 'beetroot', 'carrot_on_a_stick'), follow: 1.1 });
  },
  init(m, ctx) {
    m.data['variant'] = (ctx.opts['variant'] as string | undefined) ?? climateVariant(m);
  },
  offspring(m, partner) {
    return { type: 'pig', data: { variant: (m.random.nextBool() ? m : partner).data['variant'] } };
  },
  syncMeta(m) {
    variantMeta(m);
    m.setMeta('saddled', !!m.data['saddle']);
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (s.id === 'saddle' && !m.data['saddle'] && !m.isBaby) {
      m.data['saddle'] = true;
      m.setMeta('saddled', true);
      m.playSound('entity.pig.saddle');
      useItem(p, hand, s);
      return true;
    }
    // Climb onto a saddled pig (food still breeds it)
    if (m.data['saddle'] && !m.isBaby && !passengersOf(m.e).length && !p.entity.input.sneaking && !m.def.food?.(s)) {
      return startRiding(m.level, p.entity, m.e);
    }
    return false;
  },
  onDeath(m) {
    if (m.data['saddle']) m.level.spawnItem(m.x, m.y + 0.5, m.z, new ItemStack('saddle', 1));
  },
  steeringItem: 'carrot_on_a_stick',
  controlledBy(m, rider) {
    return !!m.data['saddle'] && holdsSteeringItem(rider, 'carrot_on_a_stick');
  },
  ridden(m, _rider, input) {
    rideSteered(m, input, 0.225);
  },
  onLightning(m) {
    // Lightning turns pigs into zombie swinekin
    if (m.level.getDifficulty() === 0) return false;
    const z = m.level.createEntity('zombie_swinekin', m.x, m.y, m.z, { reason: 'conversion', yaw: m.e.transform.yaw });
    if (!z) return false;
    const zm = mobOf(z);
    if (zm) {
      zm.equipment[0] = new ItemStack('golden_sword', 1);
      zm.setPersistent();
      if (m.e['customName']) z['customName'] = m.e['customName'];
    }
    m.level.entities.remove(m.e);
    return true;
  },
});

// ---- Cow and mushcow -------------------------------------------------------------------------
function milk(m: Mob, p: ServerPlayer, hand: 'main' | 'off'): boolean {
  const s = handStack(p, hand);
  if (s.id !== 'bucket' || m.isBaby) return false;
  m.playSound('entity.cow.milk');
  exchangeItem(p, hand, s, new ItemStack('milk_bucket', 1));
  return true;
}

const cowGoals = (m: Mob) => animalGoals(m, { panic: 2, breed: 1, tempt: 1.25, follow: 1.25 });

registerMob({
  id: 'cow', attrs: { max_health: 10, movement_speed: 0.2 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: items('wheat'), ...sounds('cow'),
  setup: cowGoals,
  init(m, ctx) {
    m.data['variant'] = (ctx.opts['variant'] as string | undefined) ?? climateVariant(m);
  },
  offspring(m, partner) {
    return { type: 'cow', data: { variant: (m.random.nextBool() ? m : partner).data['variant'] } };
  },
  syncMeta: variantMeta,
  interact: milk,
});

registerMob({
  id: 'mushcow', attrs: { max_health: 10, movement_speed: 0.2 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: items('wheat'), ...sounds('cow'),
  setup: cowGoals,
  init(m, ctx) {
    m.data['variant'] = (ctx.opts['variant'] as string | undefined) ?? 'red';
  },
  canSpawn(level, x, y, z) {
    return level.getBlockState(x, y - 1, z) !== 0 && level.getMaxLocalRawBrightness(x, y, z) > 8;
  },
  walkTargetValue(m, x, y, z) {
    return blockOf(m.level.getBlockState(x, y - 1, z)).name === 'mycelium' ? 10 : m.brightness(x, y, z) - 0.5;
  },
  offspring(m, partner) {
    const a = m.data['variant'], b = partner.data['variant'];
    // Two parents of one colour have a 1/1024 chance of a brown/red mutation
    const v = a === b && m.random.nextInt(1024) === 0 ? (a === 'red' ? 'brown' : 'red') : (m.random.nextBool() ? a : b);
    return { type: 'mushcow', data: { variant: v } };
  },
  syncMeta: variantMeta,
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (s.id === 'bowl' && !m.isBaby) {
      const stew = m.data['stewEffect'] as { id: string; dur: number } | undefined;
      const result = stew ? new ItemStack('suspicious_stew', 1, { suspicious: [stew] }) : new ItemStack('mushroom_stew', 1);
      if (stew) delete m.data['stewEffect'];
      m.playSound(stew ? 'entity.mooshroom.suspicious_milk' : 'entity.mooshroom.milk');
      exchangeItem(p, hand, s, result);
      return true;
    }
    if (s.id === 'shears' && !m.isBaby) {
      const level = m.level;
      m.playSound('entity.mooshroom.shear');
      level.addParticle('explosion', m.x, m.y + m.height / 2, m.z, 0, 0, 0);
      const cow = spawnMob(level, 'cow', m.x, m.y, m.z, 'conversion', { variant: 'temperate' });
      if (cow) {
        cow.e.transform.yaw = m.e.transform.yaw;
        cow.e.living.health = m.health;
        if (m.e['customName']) cow.e['customName'] = m.e['customName'];
      }
      const mushroom = m.data['variant'] === 'brown' ? 'brown_mushroom' : 'red_mushroom';
      for (let i = 0; i < 5; i++) level.spawnItem(m.x, m.y + m.height, m.z, new ItemStack(mushroom, 1));
      level.entities.remove(m.e);
      damagePlayerSlot(level, p, slotOf(p, hand), 1);
      return true;
    }
    // Brown mushcows remember one flower for a suspicious stew
    if (m.data['variant'] === 'brown' && !m.data['stewEffect']) {
      const eff = STEW_FLOWERS[s.id];
      if (eff) {
        m.data['stewEffect'] = { id: eff[0], dur: eff[1] };
        useItem(p, hand, s);
        m.playSound('entity.mooshroom.eat');
        m.level.addParticle('effect', m.x, m.y + m.height / 2, m.z, 0, 0.1, 0, 4);
        return true;
      }
    }
    return milk(m, p, hand);
  },
});

/** Flowers and the suspicious stew effect they give (id, ticks). */
export const STEW_FLOWERS: Record<string, [string, number]> = {
  dandelion: ['saturation', 7], poppy: ['night_vision', 100], blue_orchid: ['saturation', 7], allium: ['fire_resistance', 80],
  azure_bluet: ['blindness', 160], red_tulip: ['weakness', 180], orange_tulip: ['weakness', 180], white_tulip: ['weakness', 180],
  pink_tulip: ['weakness', 180], oxeye_daisy: ['regeneration', 160], cornflower: ['jump_boost', 120], lily_of_the_valley: ['poison', 240],
  blight_rose: ['withering', 160], torchflower: ['night_vision', 100], open_gazebloom: ['blindness', 220], closed_gazebloom: ['nausea', 140],
};

// ---- Sheep -----------------------------------------------------------------------------------
export const DYE_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

const COLOR_MIX: Record<string, string> = {
  'red+yellow': 'orange', 'red+white': 'pink', 'blue+white': 'light_blue', 'green+white': 'lime', 'black+white': 'gray',
  'gray+white': 'light_gray', 'blue+green': 'cyan', 'blue+red': 'purple', 'pink+purple': 'magenta',
};

function randomSheepColor(m: Mob): string {
  const i = m.random.nextInt(100);
  if (i < 5) return 'black';
  if (i < 10) return 'gray';
  if (i < 15) return 'light_gray';
  if (i < 18) return 'brown';
  return m.random.nextInt(500) === 0 ? 'pink' : 'white';
}

function sheepAte(m: Mob): void {
  m.data['sheared'] = false;
  m.setMeta('sheared', false);
  if (m.isBaby) {
    const age = (m.data['age'] as number) ?? 0;
    m.data['age'] = Math.min(0, age + 60 * 20);
  }
}

const sheepDef: MobDef = {
  id: 'sheep', attrs: { max_health: 8, movement_speed: 0.23 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: items('wheat'), ...sounds('sheep'),
  setup(m) {
    animalGoals(m, { panic: 1.25, breed: 1, tempt: 1.1, follow: 1.1 });
    m.goals.add(5, new EatBlockGoal(m, sheepAte));
  },
  init(m, ctx) {
    m.data['color'] = (ctx.opts['color'] as string | undefined) ?? randomSheepColor(m);
    m.data['sheared'] = false;
  },
  offspring(m, partner) {
    const a = m.data['color'] as string, b = partner.data['color'] as string;
    const key = [a, b].sort().join('+');
    const color = a === b ? a : COLOR_MIX[key] ?? (m.random.nextBool() ? a : b);
    return { type: 'sheep', data: { color, sheared: false } };
  },
  syncMeta(m) {
    m.setMeta('color', (m.data['color'] as string) ?? 'white');
    m.setMeta('sheared', !!m.data['sheared']);
  },
  lootFlags(m) {
    return { color: m.data['color'] ?? 'white', sheared: !!m.data['sheared'] };
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (s.id === 'shears' && !m.data['sheared'] && !m.isBaby) {
      m.data['sheared'] = true;
      m.setMeta('sheared', true);
      m.playSound('entity.sheep.shear');
      const n = 1 + m.random.nextInt(3);
      for (let i = 0; i < n; i++) {
        const t = m.e.transform;
        m.level.spawnItem(t.x, t.y + 1, t.z, new ItemStack(`${m.data['color'] ?? 'white'}_wool`, 1),
          (m.random.nextFloat() - m.random.nextFloat()) * 0.1, m.random.nextFloat() * 0.05, (m.random.nextFloat() - m.random.nextFloat()) * 0.1);
      }
      damagePlayerSlot(m.level, p, slotOf(p, hand), 1);
      return true;
    }
    if (s.id.endsWith('_dye')) {
      const color = s.id.slice(0, -4);
      if (DYE_COLORS.includes(color) && m.data['color'] !== color && !m.data['sheared']) {
        m.data['color'] = color;
        m.setMeta('color', color);
        m.level.playSound(m.x, m.y, m.z, 'item.dye.use');
        useItem(p, hand, s);
        return true;
      }
    }
    return false;
  },
};
registerMob(sheepDef);

// ---- Chicken ---------------------------------------------------------------------------------
registerMob({
  id: 'chicken', attrs: { max_health: 4, movement_speed: 0.25 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: items('wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds', 'torchflower_seeds', 'pitcher_pod'),
  ...sounds('chicken'), noFallDamage: true,
  setup(m) {
    animalGoals(m, { panic: 1.4, breed: 1, tempt: 1, follow: 1.1 });
  },
  init(m, ctx) {
    m.data['variant'] = (ctx.opts['variant'] as string | undefined) ?? climateVariant(m);
    m.data['eggTime'] = m.random.nextInt(6000) + 6000;
  },
  offspring(m, partner) {
    return { type: 'chicken', data: { variant: (m.random.nextBool() ? m : partner).data['variant'], eggTime: 6000 + m.random.nextInt(6000) } };
  },
  syncMeta: variantMeta,
  tick(m) {
    const p = m.e.physics;
    // Flapping slows the fall
    if (!p.onGround && p.vy < 0) p.vy *= 0.6;
    m.setMeta('flapping', !p.onGround && !p.inWater);
    if (m.isBaby || m.data['jockey']) return;
    const t = ((m.data['eggTime'] as number | undefined) ?? 6000) - 1;
    m.data['eggTime'] = t;
    if (t <= 0) {
      const v = m.data['variant'];
      const egg = v === 'warm' ? 'brown_egg' : v === 'cold' ? 'blue_egg' : 'egg';
      m.playSound('entity.chicken.egg', 1, (m.random.nextFloat() - m.random.nextFloat()) * 0.2 + 1);
      m.level.spawnItem(m.x, m.y, m.z, new ItemStack(egg, 1));
      m.data['eggTime'] = m.random.nextInt(6000) + 6000;
    }
  },
});
