/**
 * Registers every block in a fixed order (ids must be identical in every thread).
 */
import { registerNatural } from './natural';
import { registerWood } from './wood';
import { registerPlants } from './plants';
import { registerColored } from './colored';
import { registerBuilding } from './building';
import { registerFunctional } from './functional';
import { registerDimension } from './dimension';
import { freezeRegistry, isFrozen, StateTables } from '../registry';

let done = false;

export function initBlocks(pre?: StateTables): void {
  if (done || isFrozen()) return;
  done = true;
  registerNatural();
  registerWood();
  registerPlants();
  registerColored();
  registerBuilding();
  registerFunctional();
  registerDimension();
  freezeRegistry(pre);
}
