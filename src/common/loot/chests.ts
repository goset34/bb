/** Chest and archaeology loot tables (structures register theirs in their own modules). */
import { registerLootTable, table, pool, entry, w, apply, setCountF, enchantRandomly } from './loot';

export function registerChestLoot(): void {
  registerLootTable('chests/simple_dungeon', table(
    pool([
      entry('saddle', w(20)), entry('golden_apple', w(15)), entry('enchanted_golden_apple', w(2)), entry('disc_hollow', w(2)),
      entry('disc_ember', w(15)), entry('disc_tide', w(15)), entry('name_tag', w(20)), entry('golden_horse_armor', w(10)),
      entry('iron_horse_armor', w(15)), entry('diamond_horse_armor', w(5)), entry('book', w(10), apply(enchantRandomly)),
    ], [1, 3]),
    pool([
      entry('iron_ingot', w(10), apply(setCountF(1, 4))), entry('gold_ingot', w(5), apply(setCountF(1, 4))), entry('bread', w(20)),
      entry('wheat', w(20), apply(setCountF(1, 4))), entry('bucket', w(10)), entry('flux_dust', w(15), apply(setCountF(1, 4))),
      entry('coal', w(15), apply(setCountF(1, 4))), entry('melon_seeds', w(10), apply(setCountF(2, 4))),
      entry('pumpkin_seeds', w(10), apply(setCountF(2, 4))), entry('beetroot_seeds', w(10), apply(setCountF(2, 4))),
    ], [1, 4]),
    pool([
      entry('bone', w(10), apply(setCountF(1, 8))), entry('gunpowder', w(10), apply(setCountF(1, 8))),
      entry('rotten_flesh', w(10), apply(setCountF(1, 8))), entry('string', w(10), apply(setCountF(1, 8))),
    ], 3),
  ));
  registerLootTable('archaeology/desert_well', table(pool([
    entry('arms_up_pottery_sherd', w(2)), entry('brewer_pottery_sherd'), entry('brick'), entry('emerald'), entry('stick'), entry('suspicious_stew'),
  ], 1)));
}
