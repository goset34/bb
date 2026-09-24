/** One-shot initialisation of all shared registries (blocks, items, behaviours, recipes…). */
import { initBlocks } from './block/defs/index';
import { StateTables, STATE_COUNT, BLOCKS, getBlock } from './block/registry';
import { registerBlockItems } from './item/items';
import { registerItems, assignBlockItemProperties } from './item/defs';
import { registerRecipes } from './recipe/data';
import { registerChestLoot } from './loot/chests';
import './loot/blocks';
import { attachBehaviors } from './block/behaviors/index';
import { hashString } from './math/random';

let initialised = false;

export function initRegistries(pre?: StateTables): void {
  if (initialised) return;
  initialised = true;
  initBlocks(pre);
  registerBlockItems();
  registerItems();
  assignBlockItemProperties((name) => getBlock(name).settings.tags ?? []);
  attachBehaviors();
  registerRecipes();
  registerChestLoot();
}

/** Checksum of the registry layout, used to verify client/server compatibility. */
export function registryChecksum(): number {
  let s = `${STATE_COUNT}:`;
  for (const b of BLOCKS) s += `${b.name}/${b.stateCount};`;
  return hashString(s);
}
