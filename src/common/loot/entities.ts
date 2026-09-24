/**
 * Entity loot tables (entities/<mob>). Drops follow the reference quantities: base counts, a
 * looting bonus, cooking when the mob died burning and rare player-kill drops.
 */
import {
  registerLootTable, table, pool, entry, alternatives, empty, w, when, apply, setCount, lootingBonus, smeltIfBurning,
  killedByPlayer, lootingChance, flag, setData, LootContext,
} from './loot';

const count = (min: number, max: number) => apply(setCount([min, max]));
const loot = (min = 0, max = 1) => apply(lootingBonus(min, max));
const cook = (id: string) => apply(smeltIfBurning(id));

function simple(mob: string, ...pools: ReturnType<typeof pool>[]): void {
  registerLootTable(`entities/${mob}`, table(...pools));
}

/** Uniform count that may roll negative (reference -1..1 spider eyes): clamps at zero. */
const countSigned = (min: number, max: number) => apply((s, c: LootContext) => {
  s.count = Math.max(0, c.rng.nextIntBetween(min, max));
  return s;
});

// ---- Farm animals ----------------------------------------------------------------------------
simple('pig', pool([entry('porkchop', count(1, 3), cook('cooked_porkchop'), loot())]));
simple('cow', pool([entry('leather', count(0, 2), loot())]), pool([entry('beef', count(1, 3), cook('cooked_beef'), loot())]));
simple('mushcow', pool([entry('leather', count(0, 2), loot())]), pool([entry('beef', count(1, 3), cook('cooked_beef'), loot())]));
simple('chicken', pool([entry('feather', count(0, 2), loot())]), pool([entry('chicken', cook('cooked_chicken'), loot())]));
simple('rabbit',
  pool([entry('rabbit_hide', count(0, 1), loot())]),
  pool([entry('rabbit', count(0, 1), cook('cooked_rabbit'), loot())]),
  pool([entry('rabbit_foot')], 1, when(killedByPlayer), when(lootingChance(0.1, 0.03))));

const WOOL_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
simple('sheep',
  pool([entry('mutton', count(1, 2), cook('cooked_mutton'), loot())]),
  pool([alternatives(...WOOL_COLORS.map((c) => entry(`${c}_wool`, when(flag('color', c)), when(flag('sheared', false)))))]));

for (const m of ['horse', 'donkey', 'mule', 'llama']) simple(m, pool([entry('leather', count(0, 2), loot())]));
simple('skeleton_horse', pool([entry('bone', count(0, 2), loot())]));
simple('zombie_horse', pool([entry('rotten_flesh', count(0, 2), loot())]));
simple('cat', pool([entry('string', count(0, 2), loot())]));
simple('parrot', pool([entry('feather', count(1, 2), loot())]));
simple('turtle', pool([entry('seagrass', count(0, 2), loot())]));
simple('panda', pool([entry('bamboo', count(0, 2))]));
simple('polar_bear', pool([
  entry('cod', w(3), count(0, 2), cook('cooked_cod'), loot()),
  entry('salmon', w(1), count(0, 2), cook('cooked_salmon'), loot()),
]));
simple('sniffer', pool([entry('moss_block')]));

// ---- Aquatic ---------------------------------------------------------------------------------
simple('squid', pool([entry('ink_sac', count(1, 3), loot())]));
simple('glow_squid', pool([entry('glow_ink_sac', count(1, 3), loot())]));
const fishBoneMeal = pool([entry('bone_meal')], 1, when((c) => c.rng.nextFloat() < 0.05));
simple('cod', pool([entry('cod', cook('cooked_cod'))]), fishBoneMeal);
simple('salmon', pool([entry('salmon', cook('cooked_salmon'))]), fishBoneMeal);
simple('pufferfish', pool([entry('pufferfish')]), fishBoneMeal);
simple('tropical_fish', pool([entry('tropical_fish')]), fishBoneMeal);
simple('dolphin', pool([entry('cod', count(0, 1), cook('cooked_cod'), loot())]));
const guardianRare = pool([
  entry('cod', w(2), cook('cooked_cod'), loot()),
  entry('prismarine_crystals', w(2), loot()),
  empty(1),
]);
simple('guardian', pool([entry('prismarine_shard', count(0, 2), loot())]), guardianRare);
simple('elder_guardian',
  pool([entry('prismarine_shard', count(0, 2), loot())]),
  guardianRare,
  pool([entry('wet_sponge')], 1, when(killedByPlayer)),
  pool([entry('undertow_armor_trim_smithing_template')], 1, when(killedByPlayer), when((c) => c.rng.nextFloat() < 0.2)));

// ---- Golems ----------------------------------------------------------------------------------
simple('iron_golem', pool([entry('poppy', count(0, 2))]), pool([entry('iron_ingot', count(3, 5))]));
simple('snow_golem', pool([entry('snowball', count(0, 15))]));

// ---- Hostile ---------------------------------------------------------------------------------
const zombieRare = pool([entry('iron_ingot'), entry('carrot'), entry('potato')], 1, when(killedByPlayer), when(lootingChance(0.025, 0.01)));
simple('zombie', pool([entry('rotten_flesh', count(0, 2), loot())]), zombieRare);
simple('husk', pool([entry('rotten_flesh', count(0, 2), loot())]), zombieRare);
simple('drowned', pool([entry('rotten_flesh', count(0, 2), loot())]), pool([entry('copper_ingot')], 1, when(killedByPlayer), when(lootingChance(0.11, 0.02))));
simple('zombie_villager', pool([entry('rotten_flesh', count(0, 2), loot())]), zombieRare);
const bones = [pool([entry('arrow', count(0, 2), loot())]), pool([entry('bone', count(0, 2), loot())])];
simple('skeleton', ...bones);
simple('stray', ...bones, pool([entry('tipped_arrow', count(0, 1), apply(lootingBonus(0, 1, 1)), apply(setData({ potion: 'slowness' })))], 1, when(killedByPlayer)));
simple('bogged', ...bones, pool([entry('tipped_arrow', count(0, 1), apply(lootingBonus(0, 1, 1)), apply(setData({ potion: 'poison' })))], 1, when(killedByPlayer)));
/** Discs a hisser drops when killed by a skeleton's arrow (the first twelve of the original set). */
export const HISSER_DISCS = ['disc_ember', 'disc_tide', 'disc_lantern', 'disc_meadow', 'disc_drift', 'disc_hollow', 'disc_quartz', 'disc_orbit', 'disc_cinder', 'disc_fathom', 'disc_bloom', 'disc_vesper'];
simple('hisser', pool([entry('gunpowder', count(0, 2), loot())]), pool(HISSER_DISCS.map((d) => entry(d)), 1, when(flag('killedBySkeleton'))));
const spider = [pool([entry('string', count(0, 2), loot())]), pool([entry('spider_eye', countSigned(-1, 1), loot())], 1, when(killedByPlayer))];
simple('spider', ...spider);
simple('cave_spider', ...spider);
simple('voidwalker', pool([entry('void_pearl', count(0, 1), loot())]));
simple('slime', pool([entry('slime_ball', count(0, 2), loot())], 1, when(flag('size', 1))));
simple('phantom', pool([entry('phantom_membrane', count(0, 1), loot())], 1, when(killedByPlayer)));
simple('gustling', pool([entry('gust_rod', count(1, 2), loot())], 1, when(killedByPlayer)));
simple('echo_warden', pool([entry('echo_catalyst')]));
