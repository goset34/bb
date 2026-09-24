/**
 * Recipe definitions. Families (wood sets, stone sets, colours, tools, armor…) are generated
 * programmatically; individual recipes follow.
 */
import { addRecipe, addItemTag, Ingredient, RecipeCategory, CookingKind, RECIPES } from './recipes';
import { COLORS } from '../block/defs/helpers';
import { ITEMS } from '../item/items';
import { SHERDS, TRIM_PATTERNS } from '../item/defs';
import { registerSpecialRecipes } from './special';

const has = (id: string) => ITEMS.has(id);

function rid(result: string, suffix?: string): string {
  return suffix ? `${result}_from_${suffix}` : result;
}

function shaped(result: string, count: number, pattern: string[], key: Record<string, Ingredient>, category: RecipeCategory = 'building', opts: { id?: string; group?: string } = {}): void {
  addRecipe({ type: 'shaped', id: opts.id ?? result, category, group: opts.group, pattern, key, result: { id: result, count } });
}

function shapeless(result: string, count: number, ingredients: Ingredient[], category: RecipeCategory = 'misc', opts: { id?: string; group?: string } = {}): void {
  addRecipe({ type: 'shapeless', id: opts.id ?? result, category, group: opts.group, ingredients, result: { id: result, count } });
}

function cook(input: Ingredient, output: string, xp: number, kinds: CookingKind[], category: RecipeCategory = 'misc', suffix?: string, count = 1): void {
  for (const k of kinds) {
    const time = k === 'smelting' ? 200 : k === 'campfire' ? 600 : 100;
    const id = `${k}:${output}${suffix ? '_from_' + suffix : ''}`;
    addRecipe({ type: k, id, category, ingredient: input, result: { id: output, count }, xp, time });
  }
}

function cut(input: string, output: string, count = 1): void {
  if (!has(input) || !has(output) || RECIPES.has(`stonecutting:${output}_from_${input}`)) return;
  addRecipe({ type: 'stonecutting', id: `stonecutting:${output}_from_${input}`, ingredient: input, result: { id: output, count } });
}

function stairsSlabWall(base: string, prefix: string, category: RecipeCategory = 'building'): void {
  const stairs = `${prefix}_stairs`, slab = `${prefix}_slab`, wall = `${prefix}_wall`;
  if (has(stairs)) shaped(stairs, 4, ['#  ', '## ', '###'], { '#': base }, category);
  if (has(slab)) shaped(slab, 6, ['###'], { '#': base }, category);
  if (has(wall)) shaped(wall, 6, ['###', '###'], { '#': base }, category);
}

/** Stonecutter outputs from `source` to every block in `outputs` (stairs/slab/wall expanded). */
function cutter(source: string, outputs: string[]): void {
  for (const o of outputs) {
    const base = o.replace(/:(\w+)$/, '');
    const expand = o.endsWith(':ssw');
    if (!expand) {
      cut(source, o);
      continue;
    }
    const prefix = base;
    cut(source, `${prefix}_stairs`);
    cut(source, `${prefix}_slab`, 2);
    cut(source, `${prefix}_wall`);
  }
}

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'crimson', 'warped'];

function woodRecipes(): void {
  for (const w of WOODS) {
    const nether = w === 'crimson' || w === 'warped';
    const planks = `${w}_planks`;
    const logs = nether ? `#${w}_stems` : `#${w}_logs`;
    shapeless(planks, 4, [logs], 'building', { group: 'planks' });
    const log = nether ? `${w}_stem` : `${w}_log`;
    const wood = nether ? `${w}_hyphae` : `${w}_wood`;
    shaped(wood, 3, ['##', '##'], { '#': log }, 'building', { group: 'bark' });
    shaped(`stripped_${wood}`, 3, ['##', '##'], { '#': `stripped_${log}` }, 'building', { group: 'bark' });
    stairsSlabWall(planks, w);
    shaped(`${w}_fence`, 3, ['W#W', 'W#W'], { W: planks, '#': 'stick' }, 'misc', { group: 'wooden_fence' });
    shaped(`${w}_fence_gate`, 1, ['#W#', '#W#'], { W: planks, '#': 'stick' }, 'redstone', { group: 'wooden_fence_gate' });
    shaped(`${w}_door`, 3, ['##', '##', '##'], { '#': planks }, 'redstone', { group: 'wooden_door' });
    shaped(`${w}_trapdoor`, 2, ['###', '###'], { '#': planks }, 'redstone', { group: 'wooden_trapdoor' });
    shapeless(`${w}_button`, 1, [planks], 'redstone', { group: 'wooden_button' });
    shaped(`${w}_pressure_plate`, 1, ['##'], { '#': planks }, 'redstone', { group: 'wooden_pressure_plate' });
    shaped(`${w}_sign`, 3, ['###', '###', ' X '], { '#': planks, X: 'stick' }, 'misc', { group: 'wooden_sign' });
    shaped(`${w}_hanging_sign`, 6, ['X X', '###', '###'], { '#': `stripped_${log}`, X: 'chain' }, 'misc', { group: 'hanging_sign' });
    if (has(`${w}_shelf`)) shaped(`${w}_shelf`, 6, ['###', '   ', '###'], { '#': `stripped_${log}` }, 'building', { group: 'shelf' });
    if (has(`${w}_boat`)) {
      shaped(`${w}_boat`, 1, ['# #', '###'], { '#': planks }, 'misc', { group: 'boat' });
      shapeless(`${w}_chest_boat`, 1, [`${w}_boat`, 'chest'], 'misc', { group: 'chest_boat' });
    }
  }
  // Bamboo set
  shapeless('bamboo_planks', 2, ['#bamboo_blocks'], 'building', { group: 'planks' });
  shaped('bamboo_block', 1, ['###', '###', '###'], { '#': 'bamboo' }, 'building');
  shaped('bamboo_mosaic', 1, ['#', '#'], { '#': 'bamboo_slab' }, 'building');
  stairsSlabWall('bamboo_planks', 'bamboo');
  stairsSlabWall('bamboo_mosaic', 'bamboo_mosaic');
  shaped('bamboo_fence', 3, ['W#W', 'W#W'], { W: 'bamboo_planks', '#': 'stick' }, 'misc');
  shaped('bamboo_fence_gate', 1, ['#W#', '#W#'], { W: 'bamboo_planks', '#': 'stick' }, 'redstone');
  shaped('bamboo_door', 3, ['##', '##', '##'], { '#': 'bamboo_planks' }, 'redstone');
  shaped('bamboo_trapdoor', 2, ['###', '###'], { '#': 'bamboo_planks' }, 'redstone');
  shapeless('bamboo_button', 1, ['bamboo_planks'], 'redstone');
  shaped('bamboo_pressure_plate', 1, ['##'], { '#': 'bamboo_planks' }, 'redstone');
  shaped('bamboo_sign', 3, ['###', '###', ' X '], { '#': 'bamboo_planks', X: 'stick' }, 'misc');
  shaped('bamboo_hanging_sign', 6, ['X X', '###', '###'], { '#': 'stripped_bamboo_block', X: 'chain' }, 'misc');
  shaped('bamboo_shelf', 6, ['###', '   ', '###'], { '#': 'stripped_bamboo_block' }, 'building');
  shaped('bamboo_raft', 1, ['# #', '###'], { '#': 'bamboo_planks' }, 'misc');
  shapeless('bamboo_chest_raft', 1, ['bamboo_raft', 'chest'], 'misc');
  shaped('stick', 1, ['#', '#'], { '#': 'bamboo' }, 'misc', { id: 'stick_from_bamboo' });
}

function stoneRecipes(): void {
  // Simple sets: base → stairs/slab/wall + stonecutter
  const sets: Array<[string, string]> = [
    ['stone', 'stone'], ['cobblestone', 'cobblestone'], ['mossy_cobblestone', 'mossy_cobblestone'], ['stone_bricks', 'stone_brick'],
    ['mossy_stone_bricks', 'mossy_stone_brick'], ['granite', 'granite'], ['polished_granite', 'polished_granite'], ['diorite', 'diorite'],
    ['polished_diorite', 'polished_diorite'], ['andesite', 'andesite'], ['polished_andesite', 'polished_andesite'],
    ['cobbled_deepslate', 'cobbled_deepslate'], ['polished_deepslate', 'polished_deepslate'], ['deepslate_bricks', 'deepslate_brick'],
    ['deepslate_tiles', 'deepslate_tile'], ['tuff', 'tuff'], ['polished_tuff', 'polished_tuff'], ['tuff_bricks', 'tuff_brick'],
    ['mud_bricks', 'mud_brick'], ['sandstone', 'sandstone'], ['smooth_sandstone', 'smooth_sandstone'], ['red_sandstone', 'red_sandstone'],
    ['smooth_red_sandstone', 'smooth_red_sandstone'], ['bricks', 'brick'], ['prismarine', 'prismarine'], ['prismarine_bricks', 'prismarine_brick'],
    ['dark_prismarine', 'dark_prismarine'], ['quartz_block', 'quartz'], ['smooth_quartz', 'smooth_quartz'], ['purpur_block', 'purpur'],
    ['verge_stone_bricks', 'verge_stone_brick'], ['cinder_bricks', 'cinder_brick'], ['red_cinder_bricks', 'red_cinder_brick'],
    ['blackstone', 'blackstone'], ['polished_blackstone', 'polished_blackstone'], ['polished_blackstone_bricks', 'polished_blackstone_brick'],
    ['resin_bricks', 'resin_brick'],
  ];
  for (const [base, prefix] of sets) {
    stairsSlabWall(base, prefix);
    cutter(base, [`${prefix}:ssw`]);
  }
  shaped('smooth_stone_slab', 6, ['###'], { '#': 'smooth_stone' });
  cut('smooth_stone', 'smooth_stone_slab', 2);
  shaped('cut_sandstone_slab', 6, ['###'], { '#': 'cut_sandstone' });
  shaped('cut_red_sandstone_slab', 6, ['###'], { '#': 'cut_red_sandstone' });
  // Polished / bricks (2×2 → 4)
  const square: Array<[string, string]> = [
    ['granite', 'polished_granite'], ['diorite', 'polished_diorite'], ['andesite', 'polished_andesite'], ['cobbled_deepslate', 'polished_deepslate'],
    ['polished_deepslate', 'deepslate_bricks'], ['deepslate_bricks', 'deepslate_tiles'], ['tuff', 'polished_tuff'], ['polished_tuff', 'tuff_bricks'],
    ['stone', 'stone_bricks'], ['blackstone', 'polished_blackstone'], ['polished_blackstone', 'polished_blackstone_bricks'], ['basalt', 'polished_basalt'],
    ['packed_mud', 'mud_bricks'], ['verge_stone', 'verge_stone_bricks'], ['quartz_block', 'quartz_bricks'], ['sandstone', 'cut_sandstone'],
    ['red_sandstone', 'cut_red_sandstone'], ['brick', 'bricks'], ['cinder_brick', 'cinder_bricks'], ['resin_brick', 'resin_bricks'],
    ['prismarine_shard', 'prismarine'], ['clay_ball', 'clay'], ['snowball', 'snow_block'], ['honeycomb', 'honeycomb_block'],
    ['amethyst_shard', 'amethyst_block'], ['glowstone_dust', 'glowstone'], ['cinder_quartz', 'quartz_block'], ['popped_chorus_fruit', 'purpur_block'],
    ['magma_cream', 'magma_block'], ['sand', 'sandstone'], ['red_sand', 'red_sandstone'],
  ];
  for (const [a, b] of square) {
    const n = ['brick', 'cinder_brick', 'resin_brick', 'prismarine_shard', 'clay_ball', 'snowball', 'honeycomb', 'amethyst_shard', 'glowstone_dust', 'cinder_quartz', 'magma_cream', 'sand', 'red_sand'].includes(a) ? 1 : 4;
    shaped(b, n, ['##', '##'], { '#': a }, 'building', { id: rid(b, a) });
  }
  shaped('prismarine_bricks', 1, ['###', '###', '###'], { '#': 'prismarine_shard' });
  shaped('dark_prismarine', 1, ['###', '#I#', '###'], { '#': 'prismarine_shard', I: 'black_dye' });
  shaped('sea_lantern', 1, ['#C#', 'CCC', '#C#'], { '#': 'prismarine_shard', C: 'prismarine_crystals' });
  shaped('dripstone_block', 1, ['##', '##'], { '#': 'pointed_dripstone' });
  shapeless('packed_mud', 1, ['mud', 'wheat']);
  shapeless('mud', 1, ['dirt', 'water_bucket'], 'building');
  // Chiseled (2 slabs stacked)
  const chisel: Array<[string, string]> = [
    ['stone_brick_slab', 'chiseled_stone_bricks'], ['cobbled_deepslate_slab', 'chiseled_deepslate'], ['tuff_slab', 'chiseled_tuff'],
    ['tuff_brick_slab', 'chiseled_tuff_bricks'], ['sandstone_slab', 'chiseled_sandstone'], ['red_sandstone_slab', 'chiseled_red_sandstone'],
    ['quartz_slab', 'chiseled_quartz_block'], ['cinder_brick_slab', 'chiseled_cinder_bricks'], ['polished_blackstone_slab', 'chiseled_polished_blackstone'],
    ['resin_brick_slab', 'chiseled_resin_bricks'], ['purpur_slab', 'purpur_pillar'],
  ];
  for (const [slab, block] of chisel) shaped(block, 1, ['#', '#'], { '#': slab });
  shaped('quartz_pillar', 2, ['#', '#'], { '#': 'quartz_block' });
  shapeless('mossy_cobblestone', 1, ['cobblestone', 'vine|moss_block'], 'building');
  shapeless('mossy_stone_bricks', 1, ['stone_bricks', 'vine|moss_block'], 'building');
  shaped('red_cinder_bricks', 1, ['NW', 'WN'], { N: 'cinder_brick', W: 'ember_wart' });
  shaped('cinder_brick_fence', 6, ['W#W', 'W#W'], { W: 'cinder_bricks', '#': 'cinder_brick' });
  shaped('stone_button', 1, ['#'], { '#': 'stone' }, 'redstone');
  shaped('stone_pressure_plate', 1, ['##'], { '#': 'stone' }, 'redstone');
  shaped('polished_blackstone_button', 1, ['#'], { '#': 'polished_blackstone' }, 'redstone');
  shaped('polished_blackstone_pressure_plate', 1, ['##'], { '#': 'polished_blackstone' }, 'redstone');
  // Stonecutter chains
  cutter('stone', ['stone_bricks', 'stone_brick:ssw', 'chiseled_stone_bricks', 'stone_button', 'stone_pressure_plate']);
  cutter('stone_bricks', ['chiseled_stone_bricks']);
  for (const s of ['granite', 'diorite', 'andesite']) cutter(s, [`polished_${s}`, `polished_${s}:ssw`]);
  cutter('cobbled_deepslate', ['polished_deepslate', 'polished_deepslate:ssw', 'deepslate_bricks', 'deepslate_brick:ssw', 'deepslate_tiles', 'deepslate_tile:ssw', 'chiseled_deepslate']);
  cutter('polished_deepslate', ['deepslate_bricks', 'deepslate_brick:ssw', 'deepslate_tiles', 'deepslate_tile:ssw']);
  cutter('deepslate_bricks', ['deepslate_tiles', 'deepslate_tile:ssw']);
  cutter('tuff', ['polished_tuff', 'polished_tuff:ssw', 'tuff_bricks', 'tuff_brick:ssw', 'chiseled_tuff', 'chiseled_tuff_bricks']);
  cutter('polished_tuff', ['tuff_bricks', 'tuff_brick:ssw', 'chiseled_tuff_bricks']);
  cutter('tuff_bricks', ['chiseled_tuff_bricks']);
  cutter('sandstone', ['cut_sandstone', 'chiseled_sandstone']);
  cut('sandstone', 'cut_sandstone_slab', 2);
  cut('cut_sandstone', 'cut_sandstone_slab', 2);
  cutter('red_sandstone', ['cut_red_sandstone', 'chiseled_red_sandstone']);
  cut('red_sandstone', 'cut_red_sandstone_slab', 2);
  cut('cut_red_sandstone', 'cut_red_sandstone_slab', 2);
  cutter('quartz_block', ['chiseled_quartz_block', 'quartz_pillar', 'quartz_bricks']);
  cutter('purpur_block', ['purpur_pillar']);
  cutter('verge_stone', ['verge_stone_bricks', 'verge_stone_brick:ssw']);
  cutter('cinder_bricks', ['chiseled_cinder_bricks']);
  cutter('blackstone', ['polished_blackstone', 'polished_blackstone:ssw', 'polished_blackstone_bricks', 'polished_blackstone_brick:ssw', 'chiseled_polished_blackstone']);
  cutter('polished_blackstone', ['polished_blackstone_bricks', 'polished_blackstone_brick:ssw', 'chiseled_polished_blackstone']);
  cutter('basalt', ['polished_basalt']);
  cutter('resin_bricks', ['chiseled_resin_bricks']);
}

const OXI = ['', 'exposed_', 'weathered_', 'oxidized_'];

function copperRecipes(): void {
  shaped('copper_block', 1, ['###', '###', '###'], { '#': 'copper_ingot' }, 'building');
  shapeless('copper_ingot', 9, ['copper_block'], 'misc', { id: 'copper_ingot_from_block' });
  shapeless('copper_ingot', 4, ['waxed_copper_block'], 'misc', { id: 'copper_ingot_from_waxed_copper_block' });
  shaped('copper_ingot', 1, ['###', '###', '###'], { '#': 'copper_nugget' }, 'misc', { id: 'copper_ingot_from_nuggets' });
  shapeless('copper_nugget', 9, ['copper_ingot'], 'misc');
  for (const wax of ['', 'waxed_']) {
    for (const o of OXI) {
      const block = o === '' ? `${wax}copper_block` : `${wax}${o}copper_block`;
      const p = `${wax}${o}`;
      if (!has(block)) continue;
      shaped(`${p}cut_copper`, 4, ['##', '##'], { '#': block });
      shaped(`${p}chiseled_copper`, 1, ['#', '#'], { '#': `${p}cut_copper_slab` });
      shaped(`${p}copper_grate`, 4, [' # ', '# #', ' # '], { '#': block });
      shaped(`${p}copper_bulb`, 4, [' C ', 'CBC', ' R '], { C: block, B: 'blaze_rod', R: 'flux_dust' }, 'redstone');
      stairsSlabWall(`${p}cut_copper`, `${p}cut_copper`);
      cut(block, `${p}cut_copper`, 4);
      cut(block, `${p}copper_grate`, 4);
      cut(block, `${p}chiseled_copper`, 4);
      cut(block, `${p}cut_copper_slab`, 8);
      cut(block, `${p}cut_copper_stairs`, 4);
      cutter(`${p}cut_copper`, [`${p}cut_copper:ssw`, `${p}chiseled_copper`]);
      if (wax) {
        const plain = o === '' ? 'copper_block' : `${o}copper_block`;
        shapeless(block, 1, [plain, 'honeycomb'], 'building', { id: `${block}_from_honeycomb` });
        for (const piece of ['cut_copper', 'chiseled_copper', 'copper_grate', 'copper_bulb', 'cut_copper_stairs', 'cut_copper_slab', 'copper_door', 'copper_trapdoor', 'copper_bars', 'copper_chain', 'copper_lantern', 'copper_chest', 'lightning_rod']) {
          const target = `waxed_${o}${piece}`;
          if (has(target) && has(`${o}${piece}`)) shapeless(target, 1, [`${o}${piece}`, 'honeycomb'], 'building', { id: `${target}_from_honeycomb` });
        }
      }
    }
  }
  shaped('copper_door', 3, ['##', '##', '##'], { '#': 'copper_ingot' }, 'redstone');
  shaped('copper_trapdoor', 2, ['##', '##'], { '#': 'copper_ingot' }, 'redstone');
  shaped('copper_bars', 16, ['###', '###'], { '#': 'copper_ingot' }, 'building');
  shaped('copper_chain', 1, ['N', 'I', 'N'], { N: 'copper_nugget', I: 'copper_ingot' }, 'building');
  shaped('copper_lantern', 1, ['NNN', 'NTN', 'NNN'], { N: 'copper_nugget', T: 'copper_torch' }, 'building');
  shaped('copper_torch', 4, ['N', 'C', 'S'], { N: 'copper_nugget', C: '#coals', S: 'stick' }, 'building');
  shaped('copper_chest', 1, ['###', '#C#', '###'], { '#': 'copper_ingot', C: 'chest' }, 'building');
  shaped('lightning_rod', 1, ['#', '#', '#'], { '#': 'copper_ingot' }, 'redstone');
}

function colorRecipes(): void {
  for (const c of COLORS) {
    const dye = `${c}_dye`;
    if (c !== 'white') shapeless(`${c}_wool`, 1, [dye, '#wool'], 'building', { group: 'wool', id: `dye_${c}_wool` });
    shaped(`${c}_carpet`, 3, ['##'], { '#': `${c}_wool` }, 'building', { group: 'carpet' });
    shaped(`${c}_carpet`, 8, ['###', '#D#', '###'], { '#': '#wool_carpets', D: dye }, 'building', { id: `dye_${c}_carpet` });
    shaped(`${c}_bed`, 1, ['###', 'XXX'], { '#': `${c}_wool`, X: '#planks' }, 'misc', { group: 'bed' });
    shaped(`${c}_banner`, 1, ['###', '###', ' | '], { '#': `${c}_wool`, '|': 'stick' }, 'misc', { group: 'banner' });
    shaped(`${c}_stained_glass`, 8, ['###', '#X#', '###'], { '#': 'glass', X: dye }, 'building', { group: 'stained_glass' });
    shaped(`${c}_stained_glass_pane`, 16, ['###', '###'], { '#': `${c}_stained_glass` }, 'building', { group: 'stained_glass_pane' });
    shaped(`${c}_stained_glass_pane`, 8, ['###', '#X#', '###'], { '#': 'glass_pane', X: dye }, 'building', { id: `${c}_stained_glass_pane_from_glass_pane` });
    shaped(`${c}_terracotta`, 8, ['###', '#X#', '###'], { '#': 'terracotta', X: dye }, 'building', { group: 'stained_terracotta' });
    shapeless(`${c}_concrete_powder`, 8, [dye, 'sand', 'sand', 'sand', 'sand', 'gravel', 'gravel', 'gravel', 'gravel'], 'building', { group: 'concrete_powder' });
    shapeless(`${c}_candle`, 1, ['candle', dye], 'misc', { group: 'dyed_candle' });
    cook(`${c}_terracotta`, `${c}_glazed_terracotta`, 0.1, ['smelting'], 'blocks');
  }
  shaped('white_wool', 1, ['##', '##'], { '#': 'string' }, 'building', { id: 'white_wool_from_string' });
  shaped('candle', 1, ['S', 'H'], { S: 'string', H: 'honeycomb' }, 'misc');
  // Dyes from plants and materials
  const dyes: Array<[string, string, number]> = [
    ['dandelion', 'yellow', 1], ['poppy', 'red', 1], ['blue_orchid', 'light_blue', 1], ['allium', 'magenta', 1], ['azure_bluet', 'light_gray', 1],
    ['red_tulip', 'red', 1], ['orange_tulip', 'orange', 1], ['white_tulip', 'light_gray', 1], ['pink_tulip', 'pink', 1], ['oxeye_daisy', 'light_gray', 1],
    ['cornflower', 'blue', 1], ['lily_of_the_valley', 'white', 1], ['blight_rose', 'black', 1], ['sunflower', 'yellow', 2], ['lilac', 'magenta', 2],
    ['rose_bush', 'red', 2], ['peony', 'pink', 2], ['pink_petals', 'pink', 1], ['torchflower', 'orange', 1], ['pitcher_plant', 'cyan', 2],
    ['open_gazebloom', 'orange', 1], ['closed_gazebloom', 'gray', 1], ['wildflowers', 'yellow', 1], ['cocoa_beans', 'brown', 1],
    ['lapis_lazuli', 'blue', 1], ['ink_sac', 'black', 1], ['bone_meal', 'white', 1], ['beetroot', 'red', 1], ['cactus_flower', 'pink', 1],
  ];
  for (const [src, color, n] of dyes) shapeless(`${color}_dye`, n, [src], 'misc', { id: `${color}_dye_from_${src}`, group: `${color}_dye` });
  const mixes: Array<[string, string[], number]> = [
    ['gray', ['black_dye', 'white_dye'], 2], ['light_gray', ['gray_dye', 'white_dye'], 2], ['light_gray', ['black_dye', 'white_dye', 'white_dye'], 3],
    ['orange', ['red_dye', 'yellow_dye'], 2], ['pink', ['red_dye', 'white_dye'], 2], ['lime', ['green_dye', 'white_dye'], 2],
    ['cyan', ['blue_dye', 'green_dye'], 2], ['purple', ['blue_dye', 'red_dye'], 2], ['magenta', ['purple_dye', 'pink_dye'], 2],
    ['magenta', ['blue_dye', 'red_dye', 'pink_dye'], 3], ['magenta', ['blue_dye', 'red_dye', 'red_dye', 'white_dye'], 4], ['light_blue', ['blue_dye', 'white_dye'], 2],
  ];
  mixes.forEach(([color, ings, n], i) => shapeless(`${color}_dye`, n, ings, 'misc', { id: `${color}_dye_mix_${i}`, group: `${color}_dye` }));
  cook('cactus', 'green_dye', 1, ['smelting'], 'misc');
  cook('sea_pickle', 'lime_dye', 0.1, ['smelting'], 'misc');
}

function toolRecipes(): void {
  const mats: Array<[string, Ingredient]> = [['wooden', '#planks'], ['stone', '#stone_tool_materials'], ['copper', 'copper_ingot'], ['iron', 'iron_ingot'], ['golden', 'gold_ingot'], ['diamond', 'diamond']];
  for (const [m, ing] of mats) {
    const k = { '#': ing, '|': 'stick' };
    shaped(`${m}_sword`, 1, ['#', '#', '|'], k, 'equipment');
    shaped(`${m}_shovel`, 1, ['#', '|', '|'], k, 'equipment');
    shaped(`${m}_pickaxe`, 1, ['###', ' | ', ' | '], k, 'equipment');
    shaped(`${m}_axe`, 1, ['##', '#|', ' |'], k, 'equipment');
    shaped(`${m}_hoe`, 1, ['##', ' |', ' |'], k, 'equipment');
  }
  const armors: Array<[string, Ingredient]> = [['leather', 'leather'], ['copper', 'copper_ingot'], ['iron', 'iron_ingot'], ['golden', 'gold_ingot'], ['diamond', 'diamond']];
  for (const [m, ing] of armors) {
    const k = { X: ing };
    shaped(`${m}_helmet`, 1, ['XXX', 'X X'], k, 'equipment');
    shaped(`${m}_chestplate`, 1, ['X X', 'XXX', 'XXX'], k, 'equipment');
    shaped(`${m}_leggings`, 1, ['XXX', 'X X', 'X X'], k, 'equipment');
    shaped(`${m}_boots`, 1, ['X X', 'X X'], k, 'equipment');
  }
  shaped('turtle_helmet', 1, ['XXX', 'X X'], { X: 'turtle_scute' }, 'equipment');
  shaped('leather_horse_armor', 1, ['X X', 'XXX', 'X X'], { X: 'leather' }, 'equipment');
  shaped('wolf_armor', 1, ['X  ', 'XXX', 'X X'], { X: 'armadillo_scute' }, 'equipment');
  shaped('bow', 1, [' #S', '# S', ' #S'], { '#': 'stick', S: 'string' }, 'equipment');
  shaped('crossbow', 1, ['#&#', 'STS', ' # '], { '#': 'stick', '&': 'iron_ingot', S: 'string', T: 'tripwire_hook' }, 'equipment');
  shaped('arrow', 4, ['X', '#', 'Y'], { X: 'flint', '#': 'stick', Y: 'feather' }, 'equipment');
  shaped('spectral_arrow', 2, [' # ', '#X#', ' # '], { '#': 'glowstone_dust', X: 'arrow' }, 'equipment');
  shaped('shield', 1, ['WoW', 'WWW', ' W '], { W: '#planks', o: 'iron_ingot' }, 'equipment');
  shaped('shears', 1, [' #', '# '], { '#': 'iron_ingot' }, 'equipment');
  shapeless('flint_and_steel', 1, ['iron_ingot', 'flint'], 'equipment');
  shaped('fishing_rod', 1, ['  #', ' #X', '# X'], { '#': 'stick', X: 'string' }, 'equipment');
  shaped('carrot_on_a_stick', 1, ['# ', ' X'], { '#': 'fishing_rod', X: 'carrot' }, 'equipment');
  shaped('warped_fungus_on_a_stick', 1, ['# ', ' X'], { '#': 'fishing_rod', X: 'warped_fungus' }, 'equipment');
  shaped('brush', 1, ['X', '#', 'I'], { X: 'feather', '#': 'copper_ingot', I: 'stick' }, 'equipment');
  shaped('spyglass', 1, [' # ', ' X ', ' X '], { '#': 'amethyst_shard', X: 'copper_ingot' }, 'equipment');
  shaped('compass', 1, [' # ', '#X#', ' # '], { '#': 'iron_ingot', X: 'flux_dust' }, 'equipment');
  shaped('clock', 1, [' # ', '#X#', ' # '], { '#': 'gold_ingot', X: 'flux_dust' }, 'equipment');
  shaped('recovery_compass', 1, ['SSS', 'SCS', 'SSS'], { S: 'echo_shard', C: 'compass' }, 'equipment');
  shaped('lead', 2, ['~~ ', '~O ', '  ~'], { '~': 'string', O: 'slime_ball' }, 'equipment');
  shaped('mace', 1, [' H ', ' R '], { H: 'heavy_core', R: 'gust_rod' }, 'equipment');
  shapeless('wind_charge', 4, ['gust_rod'], 'equipment');
  shaped('bundle', 1, ['S', 'L'], { S: 'string', L: 'leather' }, 'equipment');
  shaped('saddle', 1, [' X ', 'X#X'], { X: 'leather', '#': 'iron_ingot' }, 'equipment');
  shaped('name_tag', 1, [' I', 'P '], { I: 'iron_nugget', P: 'paper' }, 'equipment');
}

function blockItemRecipes(): void {
  // Storage blocks
  const storage: Array<[string, string]> = [
    ['coal', 'coal_block'], ['iron_ingot', 'iron_block'], ['gold_ingot', 'gold_block'], ['diamond', 'diamond_block'], ['emerald', 'emerald_block'],
    ['lapis_lazuli', 'lapis_block'], ['flux_dust', 'flux_block'], ['raw_iron', 'raw_iron_block'], ['raw_gold', 'raw_gold_block'], ['raw_copper', 'raw_copper_block'],
    ['infernium_ingot', 'infernium_block'], ['wheat', 'hay_block'], ['dried_kelp', 'dried_kelp_block'], ['bone_meal', 'bone_block'], ['slime_ball', 'slime_block'],
    ['melon_slice', 'melon'], ['iron_nugget', 'iron_ingot'], ['gold_nugget', 'gold_ingot'], ['ice', 'packed_ice'], ['packed_ice', 'blue_ice'],
  ];
  for (const [item, block] of storage) {
    shaped(block, 1, ['###', '###', '###'], { '#': item }, 'building', { id: rid(block, item) });
    if (!['melon_slice', 'ice', 'packed_ice'].includes(item)) shapeless(item, 9, [block], 'misc', { id: rid(item, block) });
  }
  shapeless('bone_meal', 3, ['bone'], 'misc', { id: 'bone_meal_from_bone' });
  shapeless('infernium_ingot', 1, ['infernium_scrap', 'infernium_scrap', 'infernium_scrap', 'infernium_scrap', 'gold_ingot', 'gold_ingot', 'gold_ingot', 'gold_ingot'], 'misc');
  shaped('honey_block', 1, ['##', '##'], { '#': 'honey_bottle' }, 'redstone');
  shapeless('honey_bottle', 4, ['honey_block', 'glass_bottle', 'glass_bottle', 'glass_bottle', 'glass_bottle'], 'food', { id: 'honey_bottle_from_block' });
  shapeless('sugar', 3, ['honey_bottle'], 'misc', { id: 'sugar_from_honey_bottle' });
  shapeless('slime_ball', 9, ['slime_block'], 'misc', { id: 'slime_ball_from_block' });
  shaped('snow', 6, ['###'], { '#': 'snow_block' }, 'building');
  shaped('glass_pane', 16, ['###', '###'], { '#': 'glass' }, 'building');
  shaped('iron_bars', 16, ['###', '###'], { '#': 'iron_ingot' }, 'building');
  shaped('chain', 1, ['N', 'I', 'N'], { N: 'iron_nugget', I: 'iron_ingot' }, 'building');
  shaped('tinted_glass', 2, [' S ', 'SGS', ' S '], { S: 'amethyst_shard', G: 'glass' }, 'building');
  shaped('glass_bottle', 3, ['# #', ' # '], { '#': 'glass' }, 'misc');
  shaped('bucket', 1, ['# #', ' # '], { '#': 'iron_ingot' }, 'equipment');
  shaped('bowl', 4, ['# #', ' # '], { '#': '#planks' }, 'misc');
  shaped('stick', 4, ['#', '#'], { '#': '#planks' }, 'misc');
  shaped('crafting_table', 1, ['##', '##'], { '#': '#planks' }, 'misc');
  shaped('chest', 1, ['###', '# #', '###'], { '#': '#planks' }, 'misc');
  shapeless('trapped_chest', 1, ['chest', 'tripwire_hook'], 'redstone');
  shaped('barrel', 1, ['PSP', 'P P', 'PSP'], { P: '#planks', S: '#wooden_slabs' }, 'misc');
  shaped('furnace', 1, ['###', '# #', '###'], { '#': '#stone_crafting_materials' }, 'misc');
  shaped('smoker', 1, [' # ', '#X#', ' # '], { '#': '#logs', X: 'furnace' }, 'misc');
  shaped('blast_furnace', 1, ['III', 'IXI', '###'], { I: 'iron_ingot', X: 'furnace', '#': 'smooth_stone' }, 'misc');
  shaped('campfire', 1, [' S ', 'SCS', 'LLL'], { S: 'stick', C: '#coals', L: '#logs' }, 'misc');
  shaped('soul_campfire', 1, [' S ', 'SCS', 'LLL'], { S: 'stick', C: '#soul_fire_base_blocks', L: '#logs' }, 'misc');
  shaped('torch', 4, ['X', '#'], { X: '#coals', '#': 'stick' }, 'misc');
  shaped('soul_torch', 4, ['X', '#', 'S'], { X: '#coals', '#': 'stick', S: '#soul_fire_base_blocks' }, 'misc');
  shaped('lantern', 1, ['XXX', 'X#X', 'XXX'], { X: 'iron_nugget', '#': 'torch' }, 'misc');
  shaped('soul_lantern', 1, ['XXX', 'X#X', 'XXX'], { X: 'iron_nugget', '#': 'soul_torch' }, 'misc');
  shaped('ladder', 3, ['# #', '###', '# #'], { '#': 'stick' }, 'misc');
  shaped('scaffolding', 6, ['I~I', 'I I', 'I I'], { I: 'bamboo', '~': 'string' }, 'misc');
  shaped('bookshelf', 1, ['###', 'XXX', '###'], { '#': '#planks', X: 'book' }, 'building');
  shaped('chiseled_bookshelf', 1, ['###', 'XXX', '###'], { '#': '#planks', X: '#wooden_slabs' }, 'building');
  shaped('lectern', 1, ['SSS', ' B ', ' S '], { S: '#wooden_slabs', B: 'bookshelf' }, 'redstone');
  shaped('composter', 1, ['# #', '# #', '###'], { '#': '#wooden_slabs' }, 'misc');
  shaped('loom', 1, ['@@', '##'], { '@': 'string', '#': '#planks' }, 'misc');
  shaped('cartography_table', 1, ['@@', '##', '##'], { '@': 'paper', '#': '#planks' }, 'misc');
  shaped('fletching_table', 1, ['@@', '##', '##'], { '@': 'flint', '#': '#planks' }, 'misc');
  shaped('smithing_table', 1, ['@@', '##', '##'], { '@': 'iron_ingot', '#': '#planks' }, 'misc');
  shaped('stonecutter', 1, [' I ', '###'], { I: 'iron_ingot', '#': 'stone' }, 'misc');
  shaped('grindstone', 1, ['I-I', '# #'], { I: 'stick', '-': 'stone_slab', '#': '#planks' }, 'misc');
  shaped('anvil', 1, ['III', ' i ', 'iii'], { I: 'iron_block', i: 'iron_ingot' }, 'misc');
  shaped('cauldron', 1, ['# #', '# #', '###'], { '#': 'iron_ingot' }, 'misc');
  shaped('brewing_stand', 1, [' B ', '###'], { B: 'blaze_rod', '#': '#stone_crafting_materials' }, 'misc');
  shaped('enchanting_table', 1, [' B ', 'D#D', '###'], { B: 'book', D: 'diamond', '#': 'obsidian' }, 'misc');
  shaped('beacon', 1, ['GGG', 'GSG', 'OOO'], { G: 'glass', S: 'blight_star', O: 'obsidian' }, 'misc');
  shaped('conduit', 1, ['XXX', 'X#X', 'XXX'], { '#': 'heart_of_the_sea', X: 'nautilus_shell' }, 'misc');
  shaped('lodestone', 1, ['SSS', 'S#S', 'SSS'], { S: 'chiseled_stone_bricks', '#': 'iron_ingot' }, 'misc');
  shaped('respawn_anchor', 1, ['OOO', 'GGG', 'OOO'], { O: 'crying_obsidian', G: 'glowstone' }, 'misc');
  shaped('jukebox', 1, ['###', '#X#', '###'], { '#': '#planks', X: 'diamond' }, 'misc');
  shaped('note_block', 1, ['###', '#X#', '###'], { '#': '#planks', X: 'flux_dust' }, 'redstone');
  shaped('flower_pot', 1, ['# #', ' # '], { '#': 'brick' }, 'misc');
  shaped('armor_stand', 1, ['///', ' / ', '/_/'], { '/': 'stick', _: 'smooth_stone_slab' }, 'misc');
  shaped('painting', 1, ['///', '/X/', '///'], { '/': 'stick', X: '#wool' }, 'misc');
  shaped('item_frame', 1, ['///', '/L/', '///'], { '/': 'stick', L: 'leather' }, 'misc');
  shapeless('glow_item_frame', 1, ['item_frame', 'glow_ink_sac'], 'misc');
  shaped('beehive', 1, ['PPP', 'HHH', 'PPP'], { P: '#planks', H: 'honeycomb' }, 'misc');
  shaped('jack_o_lantern', 1, ['A', 'B'], { A: 'carved_pumpkin', B: 'torch' }, 'building');
  shapeless('pumpkin_seeds', 4, ['pumpkin'], 'misc');
  shapeless('melon_seeds', 1, ['melon_slice'], 'misc');
  shaped('verge_rod', 4, ['/', '#'], { '/': 'blaze_rod', '#': 'popped_chorus_fruit' }, 'building');
  shaped('verge_crystal', 1, ['GGG', 'GEG', 'GTG'], { G: 'glass', E: 'void_eye', T: 'ghast_tear' }, 'misc');
  shaped('void_chest', 1, ['###', '#E#', '###'], { '#': 'obsidian', E: 'void_eye' }, 'misc');
  shapeless('void_eye', 1, ['void_pearl', 'blaze_powder'], 'misc');
  shaped('shell_box', 1, ['-', '#', '-'], { '-': 'lurker_shell', '#': 'chest' }, 'misc');
  shapeless('blaze_powder', 2, ['blaze_rod'], 'misc');
  shapeless('magma_cream', 1, ['blaze_powder', 'slime_ball'], 'misc');
  shapeless('fermented_spider_eye', 1, ['spider_eye', 'brown_mushroom', 'sugar'], 'misc');
  shaped('glistering_melon_slice', 1, ['###', '#X#', '###'], { '#': 'gold_nugget', X: 'melon_slice' }, 'misc');
  shaped('golden_carrot', 1, ['###', '#X#', '###'], { '#': 'gold_nugget', X: 'carrot' }, 'food');
  shaped('golden_apple', 1, ['###', '#X#', '###'], { '#': 'gold_ingot', X: 'apple' }, 'food');
  shapeless('book', 1, ['paper', 'paper', 'paper', 'leather'], 'misc');
  shapeless('writable_book', 1, ['book', 'ink_sac', 'feather'], 'misc');
  shaped('paper', 3, ['###'], { '#': 'sugar_cane' }, 'misc');
  shapeless('sugar', 1, ['sugar_cane'], 'misc');
  shaped('map', 1, ['###', '#X#', '###'], { '#': 'paper', X: 'compass' }, 'misc');
  shaped('leather', 1, ['##', '##'], { '#': 'rabbit_hide' }, 'misc');
  shaped('tnt', 1, ['X#X', '#X#', 'X#X'], { '#': '#sand', X: 'gunpowder' }, 'redstone');
  shaped('moss_carpet', 3, ['##'], { '#': 'moss_block' }, 'building');
  shaped('pale_moss_carpet', 3, ['##'], { '#': 'pale_moss_block' }, 'building');
  shaped('resin_block', 1, ['###', '###', '###'], { '#': 'resin_clump' }, 'building');
  shapeless('resin_clump', 9, ['resin_block'], 'misc');
  shapeless('coarse_dirt', 4, ['dirt', 'dirt', 'gravel', 'gravel'], 'building');
  shaped('target', 1, [' R ', 'RHR', ' R '], { R: 'flux_dust', H: 'hay_block' }, 'redstone');
  shaped('crafter', 1, ['###', '#C#', 'RDR'], { '#': 'iron_ingot', C: 'crafting_table', R: 'flux_dust', D: 'dropper' }, 'redstone');
  // Redstone
  shaped('flux_torch', 1, ['X', '#'], { X: 'flux_dust', '#': 'stick' }, 'redstone');
  shaped('repeater', 1, ['#X#', 'III'], { '#': 'flux_torch', X: 'flux_dust', I: 'stone' }, 'redstone');
  shaped('comparator', 1, [' # ', '#X#', 'III'], { '#': 'flux_torch', X: 'cinder_quartz', I: 'stone' }, 'redstone');
  shaped('piston', 1, ['TTT', '#X#', '#R#'], { T: '#planks', X: 'iron_ingot', '#': '#stone_crafting_materials', R: 'flux_dust' }, 'redstone');
  shapeless('sticky_piston', 1, ['piston', 'slime_ball'], 'redstone');
  shaped('observer', 1, ['###', 'RRQ', '###'], { '#': 'cobblestone', R: 'flux_dust', Q: 'cinder_quartz' }, 'redstone');
  shaped('dispenser', 1, ['###', '#X#', '#R#'], { '#': 'cobblestone', X: 'bow', R: 'flux_dust' }, 'redstone');
  shaped('dropper', 1, ['###', '# #', '#R#'], { '#': 'cobblestone', R: 'flux_dust' }, 'redstone');
  shaped('hopper', 1, ['I I', 'ICI', ' I '], { I: 'iron_ingot', C: 'chest' }, 'redstone');
  shaped('lever', 1, ['X', '#'], { '#': 'cobblestone', X: 'stick' }, 'redstone');
  shaped('flux_lamp', 1, [' R ', 'RGR', ' R '], { R: 'flux_dust', G: 'glowstone' }, 'redstone');
  shaped('daylight_detector', 1, ['GGG', 'QQQ', 'WWW'], { G: 'glass', Q: 'cinder_quartz', W: '#wooden_slabs' }, 'redstone');
  shaped('tripwire_hook', 2, ['I', 'S', '#'], { '#': '#planks', S: 'stick', I: 'iron_ingot' }, 'redstone');
  shaped('light_weighted_pressure_plate', 1, ['##'], { '#': 'gold_ingot' }, 'redstone');
  shaped('heavy_weighted_pressure_plate', 1, ['##'], { '#': 'iron_ingot' }, 'redstone');
  shaped('iron_door', 3, ['##', '##', '##'], { '#': 'iron_ingot' }, 'redstone');
  shaped('iron_trapdoor', 1, ['##', '##'], { '#': 'iron_ingot' }, 'redstone');
  shaped('rail', 16, ['X X', 'X#X', 'X X'], { X: 'iron_ingot', '#': 'stick' }, 'redstone');
  shaped('powered_rail', 6, ['X X', 'X#X', 'XRX'], { X: 'gold_ingot', '#': 'stick', R: 'flux_dust' }, 'redstone');
  shaped('detector_rail', 6, ['X X', 'X#X', 'XRX'], { X: 'iron_ingot', '#': 'stone_pressure_plate', R: 'flux_dust' }, 'redstone');
  shaped('activator_rail', 6, ['XSX', 'X#X', 'XSX'], { X: 'iron_ingot', '#': 'flux_torch', S: 'stick' }, 'redstone');
  shaped('minecart', 1, ['# #', '###'], { '#': 'iron_ingot' }, 'redstone');
  for (const [cart, part] of [['chest_minecart', 'chest'], ['furnace_minecart', 'furnace'], ['hopper_minecart', 'hopper'], ['tnt_minecart', 'tnt']]) {
    shapeless(cart!, 1, [part!, 'minecart'], 'redstone');
  }
}

function foodRecipes(): void {
  shaped('bread', 1, ['###'], { '#': 'wheat' }, 'food');
  shaped('cookie', 8, ['#X#'], { '#': 'wheat', X: 'cocoa_beans' }, 'food');
  shaped('cake', 1, ['AAA', 'BEB', 'CCC'], { A: 'milk_bucket', B: 'sugar', C: 'wheat', E: '#eggs' }, 'food');
  shapeless('pumpkin_pie', 1, ['pumpkin', 'sugar', '#eggs'], 'food');
  shapeless('mushroom_stew', 1, ['brown_mushroom', 'red_mushroom', 'bowl'], 'food');
  shapeless('rabbit_stew', 1, ['baked_potato', 'cooked_rabbit', 'bowl', 'carrot', 'brown_mushroom|red_mushroom'], 'food');
  shapeless('beetroot_soup', 1, ['bowl', 'beetroot', 'beetroot', 'beetroot', 'beetroot', 'beetroot', 'beetroot'], 'food');
  const meats: Array<[string, string, number]> = [
    ['beef', 'cooked_beef', 0.35], ['porkchop', 'cooked_porkchop', 0.35], ['chicken', 'cooked_chicken', 0.35], ['mutton', 'cooked_mutton', 0.35],
    ['rabbit', 'cooked_rabbit', 0.35], ['cod', 'cooked_cod', 0.35], ['salmon', 'cooked_salmon', 0.35], ['potato', 'baked_potato', 0.35], ['kelp', 'dried_kelp', 0.1],
  ];
  for (const [raw, cooked, xp] of meats) cook(raw, cooked, xp, ['smelting', 'smoking', 'campfire'], 'food');
}

function cookingRecipes(): void {
  const ores: Array<[Ingredient, string, number, string]> = [
    ['iron_ore|deepslate_iron_ore|raw_iron', 'iron_ingot', 0.7, 'ore'], ['gold_ore|deepslate_gold_ore|raw_gold|cinder_gold_ore', 'gold_ingot', 1, 'ore'],
    ['copper_ore|deepslate_copper_ore|raw_copper', 'copper_ingot', 0.7, 'ore'], ['diamond_ore|deepslate_diamond_ore', 'diamond', 1, 'ore'],
    ['emerald_ore|deepslate_emerald_ore', 'emerald', 1, 'ore'], ['lapis_ore|deepslate_lapis_ore', 'lapis_lazuli', 0.2, 'ore'],
    ['flux_ore|deepslate_flux_ore', 'flux_dust', 0.7, 'ore'], ['coal_ore|deepslate_coal_ore', 'coal', 0.1, 'ore'],
    ['cinder_quartz_ore', 'cinder_quartz', 0.2, 'ore'], ['ancient_debris', 'infernium_scrap', 2, 'ore'],
  ];
  for (const [input, out, xp, s] of ores) cook(input, out, xp, ['smelting', 'blasting'], 'misc', s);
  const blocks: Array<[string, string, number]> = [
    ['cobblestone', 'stone', 0.1], ['stone', 'smooth_stone', 0.1], ['sandstone', 'smooth_sandstone', 0.1], ['red_sandstone', 'smooth_red_sandstone', 0.1],
    ['quartz_block', 'smooth_quartz', 0.1], ['stone_bricks', 'cracked_stone_bricks', 0.1], ['cobbled_deepslate', 'deepslate', 0.1],
    ['deepslate_bricks', 'cracked_deepslate_bricks', 0.1], ['deepslate_tiles', 'cracked_deepslate_tiles', 0.1], ['cinder_bricks', 'cracked_cinder_bricks', 0.1],
    ['polished_blackstone_bricks', 'cracked_polished_blackstone_bricks', 0.1], ['basalt', 'smooth_basalt', 0.1], ['clay', 'terracotta', 0.35],
    ['clay_ball', 'brick', 0.3], ['cinderrack', 'cinder_brick', 0.1], ['wet_sponge', 'sponge', 0.15], ['chorus_fruit', 'popped_chorus_fruit', 0.1],
    ['resin_clump', 'resin_brick', 0.1],
  ];
  for (const [a, b, xp] of blocks) cook(a, b, xp, ['smelting'], 'blocks');
  cook('sand|red_sand', 'glass', 0.1, ['smelting'], 'blocks');
  cook('#logs_that_burn', 'charcoal', 0.15, ['smelting'], 'misc');
  const iron = ['iron_sword', 'iron_pickaxe', 'iron_axe', 'iron_shovel', 'iron_hoe', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'chainmail_helmet', 'chainmail_chestplate', 'chainmail_leggings', 'chainmail_boots', 'iron_horse_armor'].join('|');
  const gold = ['golden_sword', 'golden_pickaxe', 'golden_axe', 'golden_shovel', 'golden_hoe', 'golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots', 'golden_horse_armor'].join('|');
  const copper = ['copper_sword', 'copper_pickaxe', 'copper_axe', 'copper_shovel', 'copper_hoe', 'copper_helmet', 'copper_chestplate', 'copper_leggings', 'copper_boots'].join('|');
  cook(iron, 'iron_nugget', 0.1, ['smelting', 'blasting'], 'misc', 'gear');
  cook(gold, 'gold_nugget', 0.1, ['smelting', 'blasting'], 'misc', 'gear');
  cook(copper, 'copper_nugget', 0.1, ['smelting', 'blasting'], 'misc', 'gear');
}

function smithingRecipes(): void {
  const template = 'infernium_upgrade_smithing_template';
  for (const piece of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe', 'helmet', 'chestplate', 'leggings', 'boots']) {
    addRecipe({ type: 'smithing_transform', id: `smithing:infernium_${piece}`, template, base: `diamond_${piece}`, addition: 'infernium_ingot', result: { id: `infernium_${piece}`, count: 1 } });
  }
  for (const p of TRIM_PATTERNS) {
    addRecipe({ type: 'smithing_trim', id: `smithing:trim_${p}`, template: `${p}_armor_trim_smithing_template`, base: '#trimmable_armor', addition: '#trim_materials' });
  }
  // Template duplication
  const dupBase: Record<string, string> = {
    watchman: 'cobblestone', dunes: 'sandstone', shoreline: 'cobblestone', thicket: 'mossy_cobblestone', bulwark: 'cobbled_deepslate', gaze: 'verge_stone', wisp: 'cobblestone', undertow: 'prismarine', muzzle: 'blackstone', ribcage: 'cinderrack', pinnacle: 'purpur_block', pathfinder: 'terracotta', molder: 'terracotta', hush: 'cobbled_deepslate', hoister: 'terracotta', hearth: 'terracotta', eddy: 'gust_rod', rivet: 'copper_block',
  };
  for (const p of TRIM_PATTERNS) {
    shaped(`${p}_armor_trim_smithing_template`, 2, ['#S#', '#C#', '###'], { '#': 'diamond', S: `${p}_armor_trim_smithing_template`, C: dupBase[p] ?? 'cobblestone' }, 'misc', { id: `${p}_template_copy` });
  }
  shaped(template, 2, ['#S#', '#C#', '###'], { '#': 'diamond', S: template, C: 'cinderrack' }, 'misc', { id: 'infernium_template_copy' });
}

export function registerRecipes(): void {
  addItemTag('stone_tool_materials', ['cobblestone', 'blackstone', 'cobbled_deepslate']);
  addItemTag('stone_crafting_materials', ['cobblestone', 'blackstone', 'cobbled_deepslate']);
  addItemTag('coals', ['coal', 'charcoal']);
  addItemTag('soul_fire_base_blocks', ['soul_sand', 'soul_soil']);
  addItemTag('eggs', ['egg', 'blue_egg', 'brown_egg']);
  addItemTag('bundles', ['bundle', ...COLORS.map((c) => `${c}_bundle`)]);
  addItemTag('trim_materials', ['iron_ingot', 'copper_ingot', 'gold_ingot', 'lapis_lazuli', 'emerald', 'diamond', 'infernium_ingot', 'flux_dust', 'amethyst_shard', 'cinder_quartz', 'resin_brick']);
  addItemTag('decorated_pot_ingredients', ['brick', ...SHERDS.map((s) => `${s}_pottery_sherd`)]);
  woodRecipes();
  stoneRecipes();
  copperRecipes();
  colorRecipes();
  toolRecipes();
  blockItemRecipes();
  foodRecipes();
  cookingRecipes();
  smithingRecipes();
  registerSpecialRecipes();
}
