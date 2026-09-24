/**
 * Survival interaction: block drops (loot tables, harvest tools, experience), tool durability,
 * items used on blocks (bone meal, hoes, shovels, axes, honeycomb, flint and steel, fire
 * charges, shears, buckets) and items used in the air (food and drinks, buckets, bottles,
 * wearable equipment), plus the drop / swap-hands actions.
 */
import type { Entity } from '../../common/entity/ecs';
import { ItemStack } from '../../common/item/stack';
import { getItem } from '../../common/item/items';
import { canHarvest } from '../../common/item/mining';
import { rollLoot } from '../../common/loot/loot';
import { blockExperience } from '../../common/loot/blocks';
import {
  Block, blockOf, stateFlags, F, tryGetBlock, transferState, tryGetValue, setValue, isFaceSturdy, blockHasTag, isReplaceable,
  BLOCK_BY_NAME,
} from '../../common/block/registry';
import { P } from '../../common/block/properties';
import { FireBehavior } from '../../common/block/behaviors/growth';
import { Direction, DX, DY, DZ, UP, DOWN, HORIZONTALS } from '../../common/world/direction';
import { raycastBlocks, BlockHit } from '../../common/world/raycast';
import { addExhaustion } from '../../common/entity/living';
import { INV_ARMOR, INV_OFFHAND } from '../../common/entity/player';
import type { Random } from '../../common/math/random';
import { AABB } from '../../common/math/geom';
import { biomeId } from '../../common/worldgen/biomes';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';
import { dropFromPlayer, createItemEntity } from './items';
import { startUsing, stopUsing } from './player';
import { refreshEquipment } from './living';

// Level event ids understood by the client (particles + sounds)
export const LE = {
  BREAK: 2001, BONEMEAL: 1505, WAX_ON: 3003, WAX_OFF: 3004, SCRAPE: 3005, EXTINGUISH: 1009, EVAPORATE: 1501, SMOKE: 2000,
} as const;

// ---------------------------------------------------------------------------------------------
// Durability
// ---------------------------------------------------------------------------------------------

/**
 * Apply `amount` damage to a stack respecting unbreaking (armor ignores it 60% of the time).
 * Returns true when the item broke.
 */
export function hurtStack(stack: ItemStack, amount: number, rng: Random): boolean {
  const def = getItem(stack.id);
  if (!def || def.maxDamage <= 0 || stack.data.unbreakable || amount <= 0) return false;
  const unbreaking = stack.getEnchant('unbreaking');
  let applied = 0;
  for (let i = 0; i < amount; i++) {
    if (unbreaking > 0) {
      const armorRoll = !!def.armor && rng.nextFloat() < 0.6;
      if (!armorRoll && rng.nextInt(unbreaking + 1) > 0) continue;
    }
    applied++;
  }
  if (applied === 0) return false;
  stack.damage = stack.damage + applied;
  return stack.damage >= def.maxDamage;
}

/** Damage the item in an inventory slot of a player (removes it with a break effect). */
export function damagePlayerSlot(level: ServerLevel, p: ServerPlayer, slot: number, amount: number): void {
  if (p.data.gameMode === 'creative' || p.data.gameMode === 'spectator') return;
  const inv = p.inventory;
  const s = inv.get(slot);
  if (s.isEmpty()) return;
  if (hurtStack(s, amount, level.random)) {
    const t = p.entity.transform;
    level.broadcastEntityEvent(p.entity, 'item_break', slot);
    level.playSound(t.x, t.y, t.z, 'entity.item.break', 0.8, 0.8 + level.random.nextFloat() * 0.4);
    inv.set(slot, ItemStack.empty());
    refreshEquipment(p.entity);
  }
  inv.revision++;
}

/** Damage an item held or worn by any living entity. */
export function damageEntityItem(level: ServerLevel, e: Entity, stack: ItemStack, amount: number): void {
  const p = level.players.find((pl) => pl.entity === e);
  if (p) {
    const idx = p.inventory.slots.indexOf(stack);
    if (idx >= 0) damagePlayerSlot(level, p, idx, amount);
    return;
  }
  if (hurtStack(stack, amount, level.random)) {
    const eq = e['equipment'] as ItemStack[] | undefined;
    const i = eq?.indexOf(stack) ?? -1;
    if (eq && i >= 0) eq[i] = ItemStack.empty();
    level.broadcastEntityEvent(e, 'item_break', i);
    refreshEquipment(e);
  }
}

function heldSlot(p: ServerPlayer, hand: 'main' | 'off'): number {
  return hand === 'main' ? p.inventory.selected : INV_OFFHAND;
}

// ---------------------------------------------------------------------------------------------
// Block drops
// ---------------------------------------------------------------------------------------------

/** Pop a stack out of a block position with the reference jitter. */
export function popResource(level: ServerLevel, x: number, y: number, z: number, stack: ItemStack): void {
  if (stack.isEmpty() || level.getGameRule('doTileDrops') === false) return;
  const r = level.random;
  const px = x + 0.5 + (r.nextDouble() - 0.5) * 0.5;
  const py = y + 0.5 + (r.nextDouble() - 0.5) * 0.5 - 0.125;
  const pz = z + 0.5 + (r.nextDouble() - 0.5) * 0.5;
  createItemEntity(level, px, py, pz, stack, r.nextDouble() * 0.2 - 0.1, 0.2, r.nextDouble() * 0.2 - 0.1);
}

/** Roll the block's loot table and spawn the drops. */
export function dropBlockLoot(level: ServerLevel, x: number, y: number, z: number, state: number, breaker: Entity | null, tool: ItemStack | null, explosion?: number): void {
  if (level.getGameRule('doTileDrops') === false) return;
  const b = blockOf(state);
  if (b.settings.noDrops) return;
  const drops = rollLoot(`blocks/${b.name}`, {
    rng: level.random, tool, state, explosion,
    flags: { player: !!breaker?.player },
  });
  for (const s of drops) popResource(level, x, y, z, s);
}

/** Survival block break: drops with the held tool, experience, durability and exhaustion. */
export function afterPlayerBreak(p: ServerPlayer, x: number, y: number, z: number, state: number): void {
  const level = p.level;
  const tool = p.inventory.mainHand;
  const b = blockOf(state);
  const silk = tool.getEnchant('silk_touch') > 0;
  if (canHarvest(tool, state)) {
    dropBlockLoot(level, x, y, z, state, p.entity, tool);
    const xp = blockExperience(b.name, level.random, silk);
    if (xp > 0 && level.getGameRule('doTileDrops') !== false) level.spawnExperience(x + 0.5, y + 0.5, z + 0.5, xp);
    // Ice melts into water when broken above something (reference behaviour)
    if (b.name === 'ice' && !silk && !level.dim.ultrawarm) {
      const below = level.getBlockState(x, y - 1, z);
      if (stateFlags[below]! & (F.SOLID | F.FLUID_BLOCK)) level.setBlock(x, y, z, BLOCK_BY_NAME.get('water')!.defaultState, 3);
    }
  }
  const def = getItem(tool.id);
  if (def?.maxDamage && b.hardness !== 0) damagePlayerSlot(level, p, p.inventory.selected, def.tool?.type === 'sword' || def.tool?.type === 'trident' ? 2 : 1);
  const food = p.entity.food;
  if (food) addExhaustion(food, 0.005);
}

// ---------------------------------------------------------------------------------------------
// Items used on blocks
// ---------------------------------------------------------------------------------------------

const TILL: Record<string, string> = { grass_block: 'farmland', dirt_path: 'farmland', dirt: 'farmland', coarse_dirt: 'dirt', rooted_dirt: 'dirt' };
const FLATTEN = new Set(['grass_block', 'dirt', 'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt']);
const OX = ['', 'exposed_', 'weathered_', 'oxidized_'];

/** Previous oxidation stage of a copper block (scraping), or undefined. */
export function previousOxidation(name: string): Block | undefined {
  if (name.startsWith('waxed_')) return undefined;
  for (let i = OX.length - 1; i > 0; i--) {
    const pre = OX[i]!;
    if (!name.startsWith(pre)) continue;
    const rest = name.slice(pre.length);
    const prev = OX[i - 1]!;
    return tryGetBlock(prev + rest);
  }
  return undefined;
}

/** Next oxidation stage of a copper block (weathering), or undefined. */
export function nextOxidation(name: string): Block | undefined {
  if (name.startsWith('waxed_')) return undefined;
  for (let i = OX.length - 2; i >= 0; i--) {
    const pre = OX[i]!;
    if (pre && !name.startsWith(pre)) continue;
    if (!pre && OX.some((o) => o && name.startsWith(o))) continue;
    return tryGetBlock(OX[i + 1]! + name.slice(pre.length));
  }
  return undefined;
}

/** Replace a block keeping its properties; doors and other two-part blocks change both halves. */
function convertBlock(level: ServerLevel, x: number, y: number, z: number, state: number, target: Block): void {
  const b = blockOf(state);
  const half = tryGetValue(state, P.doubleHalf);
  const ns = transferState(state, target);
  if (half !== undefined) {
    const oy = half === 'lower' ? y + 1 : y - 1;
    const other = level.getBlockState(x, oy, z);
    if (blockOf(other) === b) {
      level.setBlock(x, y, z, ns, 2 | 16);
      level.setBlock(x, oy, z, transferState(other, target), 2 | 16);
      level.updateNeighborsAt(x, y, z, target);
      level.updateNeighborsAt(x, oy, z, target);
      return;
    }
  }
  level.setBlock(x, y, z, ns, 11);
}

function spendItem(level: ServerLevel, p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack, durability: boolean): void {
  if (p.data.gameMode === 'creative') return;
  if (durability) damagePlayerSlot(level, p, heldSlot(p, hand), 1);
  else {
    stack.shrink(1);
    if (stack.isEmpty()) p.inventory.set(heldSlot(p, hand), ItemStack.empty());
    p.inventory.revision++;
  }
}

function swingAndEvent(level: ServerLevel, p: ServerPlayer, hand: 'main' | 'off', x: number, y: number, z: number, event: string): void {
  p.server.hooks.swing(p, hand);
  level.gameEvent(event, x + 0.5, y + 0.5, z + 0.5, p.entity);
}

/** Bone meal on a block (crops, saplings, grass, underwater plants). */
export function applyBonemeal(level: ServerLevel, x: number, y: number, z: number, face: Direction): boolean {
  const s = level.getBlockState(x, y, z);
  const beh = blockOf(s).behavior;
  if (beh.isBonemealTarget(s, level, x, y, z)) {
    if (level.random.nextFloat() < beh.bonemealChance(s)) beh.performBonemeal(s, level, x, y, z, level.random);
    level.levelEvent(LE.BONEMEAL, x, y, z, 15);
    return true;
  }
  // Underwater: grow seagrass (and occasionally coral) around the clicked face
  const tx = x + DX[face]!, ty = y + DY[face]!, tz = z + DZ[face]!;
  const target = level.getBlockState(tx, ty, tz);
  if (isFaceSturdy(s, face) && blockOf(target).name === 'water' && tryGetValue(target, P.level15) === 0) {
    growUnderwater(level, tx, ty, tz);
    level.levelEvent(LE.BONEMEAL, tx, ty, tz, 15);
    return true;
  }
  return false;
}

function growUnderwater(level: ServerLevel, x: number, y: number, z: number): void {
  const r = level.random;
  const seagrass = BLOCK_BY_NAME.get('seagrass');
  const corals = ['tube', 'brain', 'bubble', 'fire', 'horn'];
  if (!seagrass) return;
  outer: for (let i = 0; i < 128; i++) {
    let px = x, py = y, pz = z;
    for (let j = 0; j < i / 16; j++) {
      px += r.nextInt(3) - 1;
      py += ((r.nextInt(3) - 1) * r.nextInt(3)) >> 1;
      pz += r.nextInt(3) - 1;
      if (stateFlags[level.getBlockState(px, py, pz)]! & F.SOLID) continue outer;
    }
    const at = level.getBlockState(px, py, pz);
    const below = level.getBlockState(px, py - 1, pz);
    if (blockOf(at).name !== 'water' || tryGetValue(at, P.level15) !== 0 || !isFaceSturdy(below, UP)) continue;
    const reef = BLOCK_BY_NAME.get(`${corals[r.nextInt(corals.length)]}_coral`);
    const useCoral = r.nextInt(10) === 0 && reef && level.getBiome(px, py, pz) === biomeId('warm_ocean');
    const b = useCoral ? reef : seagrass;
    const wl = setValue(b.defaultState, P.waterlogged, true);
    if (b.behavior.canSurvive(wl, level, px, py, pz)) level.setBlock(px, py, pz, wl, 3);
  }
}

/** Items that act on the clicked block. Returns true when the interaction was consumed. */
export function useItemOnBlock(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack, x: number, y: number, z: number, face: Direction): boolean {
  if (stack.isEmpty()) return false;
  const level = p.level;
  const s = level.getBlockState(x, y, z);
  const b = blockOf(s);
  const n = b.name;
  const def = getItem(stack.id);
  const id = stack.id;
  const t = p.entity.transform;
  const sneaking = p.entity.input.sneaking;
  const above = level.getBlockState(x, y + 1, z);

  if (id === 'bone_meal') {
    if (!applyBonemeal(level, x, y, z, face)) return false;
    spendItem(level, p, hand, stack, false);
    swingAndEvent(level, p, hand, x, y, z, 'item_interact_finish');
    return true;
  }

  const toolType = def?.tool?.type;
  if (toolType === 'hoe' && face !== DOWN && TILL[n] && (stateFlags[above]! & F.AIR)) {
    level.setBlock(x, y, z, BLOCK_BY_NAME.get(TILL[n]!)!.defaultState, 11);
    if (n === 'rooted_dirt') popResource(level, x + DX[face]! * 0.7, y + DY[face]! * 0.7, z + DZ[face]! * 0.7, new ItemStack('hanging_roots', 1));
    level.playSound(x + 0.5, y + 0.5, z + 0.5, 'item.hoe.till');
    spendItem(level, p, hand, stack, true);
    swingAndEvent(level, p, hand, x, y, z, 'block_change');
    return true;
  }

  if (toolType === 'shovel') {
    if (b.name.endsWith('campfire') && tryGetValue(s, P.lit)) {
      level.setBlock(x, y, z, setValue(s, P.lit, false), 11);
      level.levelEvent(LE.EXTINGUISH, x, y, z, 0);
      spendItem(level, p, hand, stack, true);
      swingAndEvent(level, p, hand, x, y, z, 'block_change');
      return true;
    }
    if (face !== DOWN && FLATTEN.has(n) && (stateFlags[above]! & F.AIR)) {
      level.setBlock(x, y, z, BLOCK_BY_NAME.get('dirt_path')!.defaultState, 11);
      level.playSound(x + 0.5, y + 0.5, z + 0.5, 'item.shovel.flatten');
      spendItem(level, p, hand, stack, true);
      swingAndEvent(level, p, hand, x, y, z, 'block_change');
      return true;
    }
  }

  if (toolType === 'axe') {
    // Shields in the off hand block stripping while sneaking (reference)
    if (hand === 'main' && p.inventory.offHand.id === 'shield' && !sneaking) return false;
    const stripped = tryGetBlock(`stripped_${n}`);
    const prev = previousOxidation(n);
    const unwaxed = n.startsWith('waxed_') ? tryGetBlock(n.slice(6)) : undefined;
    const target = stripped ?? prev ?? unwaxed;
    if (target) {
      convertBlock(level, x, y, z, s, target);
      if (stripped) level.playSound(x + 0.5, y + 0.5, z + 0.5, 'item.axe.strip');
      else if (prev) { level.playSound(x + 0.5, y + 0.5, z + 0.5, 'item.axe.scrape'); level.levelEvent(LE.SCRAPE, x, y, z, 0); }
      else { level.playSound(x + 0.5, y + 0.5, z + 0.5, 'item.axe.wax_off'); level.levelEvent(LE.WAX_OFF, x, y, z, 0); }
      spendItem(level, p, hand, stack, true);
      swingAndEvent(level, p, hand, x, y, z, 'block_change');
      return true;
    }
  }

  if (id === 'honeycomb') {
    const waxed = !n.startsWith('waxed_') && (blockHasTag(b, 'copper') || /copper|lightning_rod/.test(n)) ? tryGetBlock(`waxed_${n}`) : undefined;
    if (waxed) {
      convertBlock(level, x, y, z, s, waxed);
      level.levelEvent(LE.WAX_ON, x, y, z, 0);
      level.playSound(x + 0.5, y + 0.5, z + 0.5, 'item.honeycomb.wax_on');
      spendItem(level, p, hand, stack, false);
      swingAndEvent(level, p, hand, x, y, z, 'block_change');
      return true;
    }
  }

  if (id === 'shears' && n === 'pumpkin') {
    const f = HORIZONTALS.includes(face) ? face : (HORIZONTALS[Math.floor(((t.yaw % 360) + 360 + 45) / 90) % 4]! ^ 1) as Direction;
    const carved = BLOCK_BY_NAME.get('carved_pumpkin')!;
    level.setBlock(x, y, z, setValue(carved.defaultState, P.facing, f), 11);
    const r = level.random;
    createItemEntity(level, x + 0.5 + DX[f]! * 0.65, y + 0.1, z + 0.5 + DZ[f]! * 0.65, new ItemStack('pumpkin_seeds', 4), DX[f]! * 0.05 + r.nextDouble() * 0.02, 0.05, DZ[f]! * 0.05 + r.nextDouble() * 0.02);
    level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.pumpkin.carve');
    spendItem(level, p, hand, stack, true);
    swingAndEvent(level, p, hand, x, y, z, 'shear');
    return true;
  }

  if (id === 'flint_and_steel' || id === 'fire_charge') {
    const charge = id === 'fire_charge';
    const lightable = (n.endsWith('campfire') || blockHasTag(b, 'candles') || n.endsWith('candle_cake')) && tryGetValue(s, P.lit) === false && tryGetValue(s, P.waterlogged) !== true;
    if (lightable) {
      level.setBlock(x, y, z, setValue(s, P.lit, true), 11);
    } else if (n === 'tnt') {
      level.createEntity('tnt', x + 0.5, y, z + 0.5, { igniter: p.entity.id });
      level.setBlock(x, y, z, 0, 11);
    } else {
      const fx = x + DX[face]!, fy = y + DY[face]!, fz = z + DZ[face]!;
      if (!(stateFlags[level.getBlockState(fx, fy, fz)]! & F.AIR)) return false;
      const fire = FireBehavior.stateAt(level, fx, fy, fz);
      if (!fire) return false;
      level.setBlock(fx, fy, fz, fire, 11);
    }
    level.playSound(x + 0.5, y + 0.5, z + 0.5, charge ? 'item.firecharge.use' : 'item.flintandsteel.use', 1, charge ? (level.random.nextFloat() - level.random.nextFloat()) * 0.2 + 1 : level.random.nextFloat() * 0.4 + 0.8);
    spendItem(level, p, hand, stack, !charge);
    swingAndEvent(level, p, hand, x, y, z, 'block_place');
    return true;
  }

  if (id.endsWith('bucket') && id !== 'milk_bucket') return useBucket(p, hand, stack);
  if (id === 'glass_bottle') return useBottle(p, hand, stack);
  return false;
}

// ---------------------------------------------------------------------------------------------
// Buckets and bottles
// ---------------------------------------------------------------------------------------------

function lookRay(p: ServerPlayer, fluids: 'none' | 'source' | 'any'): BlockHit | null {
  const t = p.entity.transform;
  const yaw = (t.yaw * Math.PI) / 180, pitch = (t.pitch * Math.PI) / 180;
  const dx = -Math.sin(yaw) * Math.cos(pitch), dy = -Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch);
  const reach = p.entity.living?.attrs.value('block_interaction_range') ?? 4.5;
  return raycastBlocks(p.level, t.x, t.y + p.entity.physics.eyeHeight, t.z, dx, dy, dz, reach + (p.data.gameMode === 'creative' ? 0.5 : 0), 'outline', fluids);
}

/** Replace the used item by `result` (keeps one in creative if missing). */
function exchange(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack, result: ItemStack): void {
  const inv = p.inventory;
  const slot = heldSlot(p, hand);
  if (p.data.gameMode === 'creative') {
    if (inv.count(result.id) === 0) inv.add(result, getItem(result.id)?.maxStack ?? 64);
    return;
  }
  stack.shrink(1);
  if (stack.isEmpty()) inv.set(slot, result);
  else if (!inv.add(result, getItem(result.id)?.maxStack ?? 64)) dropFromPlayer(p.level, p, result);
  inv.revision++;
}

const FISH_BUCKETS: Record<string, string> = { cod_bucket: 'cod', salmon_bucket: 'salmon', pufferfish_bucket: 'pufferfish', tropical_fish_bucket: 'tropical_fish', axolotl_bucket: 'axolotl', tadpole_bucket: 'tadpole' };

/** Empty or fill a bucket at the looked-at block. */
export function useBucket(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack): boolean {
  const level = p.level;
  const id = stack.id;
  if (id === 'bucket') {
    const hit = lookRay(p, 'source');
    if (!hit) return false;
    const s = level.getBlockState(hit.x, hit.y, hit.z);
    const b = blockOf(s);
    let filled: string | null = null;
    if (b.name === 'water' && tryGetValue(s, P.level15) === 0) { filled = 'water_bucket'; level.setBlock(hit.x, hit.y, hit.z, 0, 11); }
    else if (b.name === 'lava' && tryGetValue(s, P.level15) === 0) { filled = 'lava_bucket'; level.setBlock(hit.x, hit.y, hit.z, 0, 11); }
    else if (b.name === 'powder_snow') { filled = 'powder_snow_bucket'; level.setBlock(hit.x, hit.y, hit.z, 0, 11); }
    else if (tryGetValue(s, P.waterlogged) === true) { filled = 'water_bucket'; level.setBlock(hit.x, hit.y, hit.z, setValue(s, P.waterlogged, false), 11); }
    if (!filled) return false;
    level.playSound(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, filled === 'lava_bucket' ? 'item.bucket.fill_lava' : filled === 'powder_snow_bucket' ? 'item.bucket.fill_powder_snow' : 'item.bucket.fill');
    level.gameEvent('fluid_pickup', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, p.entity);
    exchange(p, hand, stack, new ItemStack(filled, 1));
    p.server.hooks.swing(p, hand);
    return true;
  }
  const hit = lookRay(p, 'none');
  if (!hit) return false;
  const fluid = id === 'lava_bucket' ? 'lava' : id === 'powder_snow_bucket' ? 'powder_snow' : 'water';
  let x = hit.x, y = hit.y, z = hit.z;
  let s = level.getBlockState(x, y, z);
  const canWaterlog = fluid === 'water' && blockOf(s).props.some((q) => q === P.waterlogged) && tryGetValue(s, P.waterlogged) === false;
  if (!canWaterlog && !(isReplaceable(s) && !(stateFlags[s]! & F.FLUID_BLOCK && fluid === 'powder_snow'))) {
    x += DX[hit.face]!; y += DY[hit.face]!; z += DZ[hit.face]!;
    s = level.getBlockState(x, y, z);
  }
  if (y < level.minY || y >= level.maxY) return false;
  const waterlog = fluid === 'water' && blockOf(s).props.includes(P.waterlogged) && tryGetValue(s, P.waterlogged) === false;
  if (!waterlog && !isReplaceable(s)) return false;
  if (fluid === 'water' && level.dim.ultrawarm) {
    level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.fire.extinguish', 0.5, 2.6 + (level.random.nextFloat() - level.random.nextFloat()) * 0.8);
    level.levelEvent(LE.EVAPORATE, x, y, z, 0);
  } else if (waterlog) {
    level.setBlock(x, y, z, setValue(s, P.waterlogged, true), 11);
    level.scheduleFluidTick(x, y, z, 'water', 5);
  } else if (fluid === 'powder_snow') {
    const box = new AABB(x, y, z, x + 1, y + 1, z + 1);
    if (level.getEntities(box, (e) => e.type !== 'item' && e.type !== 'xp_orb').length) return false;
    level.setBlock(x, y, z, BLOCK_BY_NAME.get('powder_snow')!.defaultState, 11);
  } else {
    // Non-fluid replaceable blocks (grass, flowers…) are destroyed with drops
    if (!(stateFlags[s]! & (F.AIR | F.FLUID_BLOCK))) level.destroyBlock(x, y, z, true);
    level.setBlock(x, y, z, BLOCK_BY_NAME.get(fluid)!.defaultState, 11);
    level.scheduleFluidTick(x, y, z, fluid as 'water' | 'lava', fluid === 'lava' ? (level.dim.ultrawarm ? 10 : 30) : 5);
  }
  level.playSound(x + 0.5, y + 0.5, z + 0.5, fluid === 'lava' ? 'item.bucket.empty_lava' : fluid === 'powder_snow' ? 'item.bucket.empty_powder_snow' : 'item.bucket.empty');
  level.gameEvent('fluid_place', x + 0.5, y + 0.5, z + 0.5, p.entity);
  const mob = FISH_BUCKETS[id];
  if (mob) {
    level.createEntity(mob, x + 0.5, y, z + 0.5, { fromBucket: true, bucketData: stack.data.entity ?? {} });
    level.playSound(x + 0.5, y + 0.5, z + 0.5, 'item.bucket.empty_fish');
  }
  if (p.data.gameMode !== 'creative') {
    const slot = heldSlot(p, hand);
    p.inventory.set(slot, new ItemStack('bucket', 1));
  }
  p.server.hooks.swing(p, hand);
  return true;
}

/** Fill a glass bottle from a water source. */
export function useBottle(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack): boolean {
  const hit = lookRay(p, 'source');
  if (!hit) return false;
  const level = p.level;
  const s = level.getBlockState(hit.x, hit.y, hit.z);
  if (!(stateFlags[s]! & F.WATER)) return false;
  level.playSound(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 'item.bottle.fill');
  level.gameEvent('fluid_pickup', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, p.entity);
  exchange(p, hand, stack, new ItemStack('potion', 1, { potion: 'water' }));
  p.server.hooks.swing(p, hand);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Items used in the air
// ---------------------------------------------------------------------------------------------

/** Equipment slot of a wearable item (armor, elytra, carved pumpkins, heads). */
export function equipmentSlot(id: string): number {
  const def = getItem(id);
  if (def?.armor && def.armor.slot !== 'body') return INV_ARMOR + { feet: 0, legs: 1, chest: 2, head: 3 }[def.armor.slot];
  if (id === 'elytra') return INV_ARMOR + 2;
  if (id === 'carved_pumpkin' || id.endsWith('_head') || id.endsWith('_skull')) return INV_ARMOR + 3;
  return -1;
}

function equip(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack): boolean {
  const slot = equipmentSlot(stack.id);
  if (slot < 0) return false;
  const inv = p.inventory;
  const cur = inv.get(slot);
  if (cur.getEnchant('binding_curse') > 0 && p.data.gameMode !== 'creative') return false;
  const handSlot = heldSlot(p, hand);
  if (p.data.gameMode === 'creative') {
    inv.set(slot, stack.copyWithCount(1));
  } else if (stack.count > 1) {
    if (!cur.isEmpty()) return false;
    inv.set(slot, stack.copyWithCount(1));
    stack.shrink(1);
  } else {
    inv.set(slot, stack);
    inv.set(handSlot, cur);
  }
  inv.revision++;
  const t = p.entity.transform;
  const mat = getItem(stack.id)?.armor?.material;
  p.level.playSound(t.x, t.y, t.z, mat ? `item.armor.equip_${mat}` : stack.id === 'elytra' ? 'item.armor.equip_elytra' : 'item.armor.equip_generic');
  p.level.gameEvent('equip', t.x, t.y, t.z, p.entity);
  refreshEquipment(p.entity);
  p.server.hooks.swing(p, hand);
  return true;
}

/** Items used without a block target. Other systems chain onto this via `airUseHandlers`. */
export const airUseHandlers: Array<(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack) => boolean> = [];

export function useItemInAir(p: ServerPlayer, hand: 'main' | 'off'): boolean {
  const stack = hand === 'main' ? p.inventory.mainHand : p.inventory.offHand;
  if (stack.isEmpty()) return false;
  const cooldowns = p.ext['cooldowns'] as Record<string, number> | undefined;
  if (cooldowns?.[stack.id] && cooldowns[stack.id]! > p.server.gameTime) return false;
  for (const h of airUseHandlers) if (h(p, hand, stack)) return true;
  const def = getItem(stack.id);
  if (def?.food || def?.useAnim === 'drink') return startUsing(p, hand, stack);
  if (stack.id.endsWith('bucket') && stack.id !== 'milk_bucket') return useBucket(p, hand, stack);
  if (stack.id === 'glass_bottle') return useBottle(p, hand, stack);
  if (equipmentSlot(stack.id) >= 0) return equip(p, hand, stack);
  return false;
}

/** Put an item on cooldown (ender pearls, chorus fruit, shields…) and tell the client. */
export function setCooldown(p: ServerPlayer, item: string, ticks: number): void {
  const c = (p.ext['cooldowns'] as Record<string, number> | undefined) ?? {};
  c[item] = p.server.gameTime + ticks;
  p.ext['cooldowns'] = c;
  p.send({ type: 'cooldown', item, ticks });
}

// ---------------------------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------------------------

export function playerAction(p: ServerPlayer, action: string): void {
  const inv = p.inventory;
  const level = p.level;
  if (p.entity.living?.dead) return;
  switch (action) {
    case 'drop_item':
    case 'drop_all': {
      if (p.data.gameMode === 'spectator') return;
      const s = inv.mainHand;
      if (s.isEmpty()) return;
      const out = action === 'drop_all' ? s.split(s.count) : s.split(1);
      if (s.isEmpty()) inv.set(inv.selected, ItemStack.empty());
      inv.revision++;
      dropFromPlayer(level, p, out);
      stopUsing(p);
      break;
    }
    case 'swap_hands': {
      if (p.data.gameMode === 'spectator') return;
      const main = inv.mainHand, off = inv.offHand;
      inv.set(inv.selected, off);
      inv.set(INV_OFFHAND, main);
      stopUsing(p);
      refreshEquipment(p.entity);
      break;
    }
    case 'release_use':
      stopUsing(p);
      break;
  }
}
