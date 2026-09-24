/** One-shot initialisation of all shared registries (blocks, items, behaviours, recipes…). */
import { initBlocks } from './block/defs/index';
import { StateTables, STATE_COUNT, BLOCKS } from './block/registry';
import { registerBlockItems } from './item/items';
import { attachBehaviors } from './block/behaviors/index';
import { hashString } from './math/random';

let initialised = false;

export function initRegistries(pre?: StateTables): void {
  if (initialised) return;
  initialised = true;
  initBlocks(pre);
  registerBlockItems();
  attachBehaviors();
}

/** Checksum of the registry layout, used to verify client/server compatibility. */
export function registryChecksum(): number {
  let s = `${STATE_COUNT}:`;
  for (const b of BLOCKS) s += `${b.name}/${b.stateCount};`;
  return hashString(s);
}
