/**
 * Placed features and their assignment to overworld biomes (by decoration step).
 * Counts, heights and rarities follow the reference distribution of resources.
 */
import { BIOMES } from '../biomes';
import {
  PlacedFeature, Step, placed, count, countRange, countWeighted, rarity, inSquare, heightmap, uniformY, triangleY, biasedY,
  surfaceWaterDepth, filter, Feature, FeatureContext, isAir,
} from './api';
import { ore, oreTargets, baseStoneTarget, blocksTarget, disk, scatteredOre } from './ores';
import { freezeTopLayer, spring, lake, geode, monsterRoom, fossil, iceSpike, iceberg, blueIce, desertWell, forestRock } from './misc';
import { TREES, selector } from './trees';
import * as V from './vegetation';
import * as C from './caves';

const S = Step;

/** Biome name → placed features. */
let sets: Map<number, Set<PlacedFeature>> | null = null;

export function biomeFeatureSets(): Map<number, Set<PlacedFeature>> {
  if (!sets) sets = build();
  return sets;
}

function trees(name: string, feature: Feature, n: number | Array<[number, number]>, water = 0): PlacedFeature {
  return placed(name, S.VEGETAL_DECORATION, feature,
    typeof n === 'number' ? count(n) : countWeighted(n), inSquare(), surfaceWaterDepth(water), heightmap('ocean_floor'));
}

function veg(name: string, feature: Feature, n: number, kind: 'motion' | 'surface' | 'ocean_floor' = 'motion', chance = 1): PlacedFeature {
  return chance < 1
    ? placed(name, S.VEGETAL_DECORATION, feature, rarity(1 / chance), count(n), inSquare(), heightmap(kind))
    : placed(name, S.VEGETAL_DECORATION, feature, count(n), inSquare(), heightmap(kind));
}

function build(): Map<number, Set<PlacedFeature>> {
  // ---- shared underground features ------------------------------------------------------------
  const lavaLakeUnderground = placed('lake_lava_underground', S.LAKES, lake('lava', 'stone'), rarity(9), inSquare(), uniformY(0, 256),
    filter((ctx, x, y, z) => y < ctx.world.getHeight('motion', x, z) - 6));
  const lavaLakeSurface = placed('lake_lava_surface', S.LAKES, lake('lava', 'stone'), rarity(200), inSquare(), heightmap('motion'));
  const amethyst = placed('amethyst_geode', S.LOCAL_MODIFICATIONS, geode, rarity(24), inSquare(), uniformY(-58, 30));
  const dungeon = placed('monster_room', S.UNDERGROUND_STRUCTURES, monsterRoom, count(10), inSquare(), uniformY(0, 256));
  const dungeonDeep = placed('monster_room_deep', S.UNDERGROUND_STRUCTURES, monsterRoom, count(4), inSquare(), uniformY(-58, -1));
  const fossilUpper = placed('fossil_upper', S.UNDERGROUND_STRUCTURES, fossil(false), rarity(64), inSquare(), uniformY(0, 40));
  const fossilLower = placed('fossil_lower', S.UNDERGROUND_STRUCTURES, fossil(true), rarity(64), inSquare(), uniformY(-64, -8));

  const oreDirt = placed('ore_dirt', S.UNDERGROUND_ORES, ore(blocksTarget(['stone', 'granite', 'diorite', 'andesite'], 'dirt'), 33), count(7), inSquare(), uniformY(0, 160));
  const oreGravel = placed('ore_gravel', S.UNDERGROUND_ORES, ore(baseStoneTarget('gravel'), 33), count(14), inSquare(), uniformY(-64, 320));
  const stoneBlob = (n: string, up: boolean) => placed(`ore_${n}_${up ? 'upper' : 'lower'}`, S.UNDERGROUND_ORES,
    ore(blocksTarget(['stone'], n), 64), ...(up ? [rarity(6), inSquare(), uniformY(64, 128)] : [count(2), inSquare(), uniformY(0, 60)]));
  const oreTuff = placed('ore_tuff', S.UNDERGROUND_ORES, ore(blocksTarget(['deepslate'], 'tuff'), 64), count(2), inSquare(), uniformY(-64, 0));
  const oreCoalUpper = placed('ore_coal_upper', S.UNDERGROUND_ORES, ore(oreTargets('coal_ore', 'deepslate_coal_ore'), 17), count(30), inSquare(), uniformY(136, 320));
  const oreCoalLower = placed('ore_coal_lower', S.UNDERGROUND_ORES, ore(oreTargets('coal_ore', 'deepslate_coal_ore'), 17, 0.5), count(20), inSquare(), triangleY(0, 192));
  const oreIronUpper = placed('ore_iron_upper', S.UNDERGROUND_ORES, ore(oreTargets('iron_ore', 'deepslate_iron_ore'), 9), count(90), inSquare(), triangleY(80, 384));
  const oreIronMiddle = placed('ore_iron_middle', S.UNDERGROUND_ORES, ore(oreTargets('iron_ore', 'deepslate_iron_ore'), 9), count(10), inSquare(), triangleY(-24, 56));
  const oreIronSmall = placed('ore_iron_small', S.UNDERGROUND_ORES, ore(oreTargets('iron_ore', 'deepslate_iron_ore'), 4), count(10), inSquare(), uniformY(-64, 72));
  const oreGold = placed('ore_gold', S.UNDERGROUND_ORES, ore(oreTargets('gold_ore', 'deepslate_gold_ore'), 9, 0.5), count(4), inSquare(), triangleY(-64, 32));
  const oreGoldLower = placed('ore_gold_lower', S.UNDERGROUND_ORES, ore(oreTargets('gold_ore', 'deepslate_gold_ore'), 9, 0.5), countRange(0, 1), inSquare(), uniformY(-64, -48));
  const oreGoldExtra = placed('ore_gold_extra', S.UNDERGROUND_ORES, ore(oreTargets('gold_ore', 'deepslate_gold_ore'), 9), count(50), inSquare(), uniformY(32, 256));
  const oreFlux = placed('ore_flux', S.UNDERGROUND_ORES, ore(oreTargets('flux_ore', 'deepslate_flux_ore'), 8), count(4), inSquare(), uniformY(-64, 15));
  const oreFluxLower = placed('ore_flux_lower', S.UNDERGROUND_ORES, ore(oreTargets('flux_ore', 'deepslate_flux_ore'), 8), count(8), inSquare(), triangleY(-96, -32));
  const oreDiamond = placed('ore_diamond', S.UNDERGROUND_ORES, ore(oreTargets('diamond_ore', 'deepslate_diamond_ore'), 4, 0.5), count(7), inSquare(), triangleY(-144, 16));
  const oreDiamondMedium = placed('ore_diamond_medium', S.UNDERGROUND_ORES, ore(oreTargets('diamond_ore', 'deepslate_diamond_ore'), 8, 0.5), count(2), inSquare(), uniformY(-64, -4));
  const oreDiamondLarge = placed('ore_diamond_large', S.UNDERGROUND_ORES, ore(oreTargets('diamond_ore', 'deepslate_diamond_ore'), 12, 0.7), rarity(9), inSquare(), triangleY(-144, 16));
  const oreDiamondBuried = placed('ore_diamond_buried', S.UNDERGROUND_ORES, ore(oreTargets('diamond_ore', 'deepslate_diamond_ore'), 8, 1), count(4), inSquare(), triangleY(-144, 16));
  const oreLapis = placed('ore_lapis', S.UNDERGROUND_ORES, ore(oreTargets('lapis_ore', 'deepslate_lapis_ore'), 7), count(2), inSquare(), triangleY(-32, 32));
  const oreLapisBuried = placed('ore_lapis_buried', S.UNDERGROUND_ORES, ore(oreTargets('lapis_ore', 'deepslate_lapis_ore'), 7, 1), count(4), inSquare(), uniformY(-64, 64));
  const oreCopper = placed('ore_copper', S.UNDERGROUND_ORES, ore(oreTargets('copper_ore', 'deepslate_copper_ore'), 10), count(16), inSquare(), triangleY(-16, 112));
  const oreCopperLarge = placed('ore_copper_large', S.UNDERGROUND_ORES, ore(oreTargets('copper_ore', 'deepslate_copper_ore'), 20), count(16), inSquare(), triangleY(-16, 112));
  const oreEmerald = placed('ore_emerald', S.UNDERGROUND_ORES, scatteredOre(oreTargets('emerald_ore', 'deepslate_emerald_ore'), 3), count(100), inSquare(), triangleY(-16, 480));
  const oreInfested = placed('ore_infested', S.UNDERGROUND_ORES, ore(oreTargets('infested_stone', 'infested_deepslate'), 9), count(14), inSquare(), uniformY(-64, 63));
  const oreClay = placed('ore_clay', S.UNDERGROUND_ORES, ore(baseStoneTarget('clay'), 33), count(46), inSquare(), uniformY(-64, 256));
  const diskSand = placed('disk_sand', S.UNDERGROUND_ORES, disk('sand', ['dirt', 'grass_block'], [2, 6], 2), count(3), inSquare(), heightmap('ocean_floor'));
  const diskClay = placed('disk_clay', S.UNDERGROUND_ORES, disk('clay', ['dirt', 'clay'], [2, 3], 1), count(1), inSquare(), heightmap('ocean_floor'));
  const diskGravel = placed('disk_gravel', S.UNDERGROUND_ORES, disk('gravel', ['dirt', 'grass_block'], [2, 5], 2), count(1), inSquare(), heightmap('ocean_floor'));
  const springWater = placed('spring_water', S.FLUID_SPRINGS, spring('water'), count(25), inSquare(), uniformY(-64, 192));
  const springLava = placed('spring_lava', S.FLUID_SPRINGS, spring('lava'), count(20), inSquare(), biasedY(-56, 180));
  const glowLichen = placed('glow_lichen', S.VEGETAL_DECORATION, C.glowLichen, count(60), inSquare(), uniformY(-64, 120),
    filter((ctx, x, y, z) => y < ctx.world.getHeight('motion', x, z) - 12 && isAir(ctx.world.getBlock(x, y, z))));
  const pointedDrip = placed('pointed_dripstone', S.VEGETAL_DECORATION, C.pointedDripstone, count(24), inSquare(), uniformY(-64, 120),
    filter((ctx, x, y, z) => isAir(ctx.world.getBlock(x, y, z))));
  const freeze = placed('freeze_top_layer', S.TOP_LAYER_MODIFICATION, freezeTopLayer, count(1));

  const COMMON: PlacedFeature[] = [
    lavaLakeUnderground, lavaLakeSurface, amethyst, dungeon, dungeonDeep, fossilLower,
    oreDirt, oreGravel, stoneBlob('granite', true), stoneBlob('granite', false), stoneBlob('diorite', true), stoneBlob('diorite', false),
    stoneBlob('andesite', true), stoneBlob('andesite', false), oreTuff, oreCoalUpper, oreCoalLower, oreIronUpper, oreIronMiddle, oreIronSmall,
    oreGold, oreGoldLower, oreFlux, oreFluxLower, oreDiamond, oreDiamondMedium, oreDiamondLarge, oreDiamondBuried, oreLapis, oreLapisBuried, oreCopper,
    diskSand, diskClay, diskGravel, springWater, springLava, glowLichen, pointedDrip, freeze,
  ];
  const MOUNTAIN = [oreEmerald, oreInfested];

  // ---- vegetation -------------------------------------------------------------------------------
  const grass = (n: number, id = `patch_grass_${n}`) => veg(id, V.grassPatch(32), n);
  const grassFern = (n: number) => veg(`patch_grass_fern_${n}`, V.grassFernPatch(32), n);
  const tallGrass = (n: number) => veg(`patch_tall_grass_${n}`, V.tallGrassPatch(96), n);
  const largeFern = veg('patch_large_fern', V.largeFernPatch(96), 1, 'motion', 1 / 5);
  const sugarCane = veg('patch_sugar_cane', V.sugarCanePatch, 1, 'motion', 1 / 6);
  const sugarCaneMany = veg('patch_sugar_cane_many', V.sugarCanePatch, 10);
  const pumpkin = veg('patch_pumpkin', V.pumpkinPatch, 1, 'motion', 1 / 300);
  const melon = veg('patch_melon', V.melonPatch, 1, 'motion', 1 / 6);
  const berries = veg('patch_berry_common', V.berryPatch, 1, 'motion', 1 / 32);
  const berriesRare = veg('patch_berry_rare', V.berryPatch, 1, 'motion', 1 / 384);
  const mushBrown = veg('brown_mushroom_normal', V.brownMushroomPatch, 1, 'motion', 1 / 256);
  const mushRed = veg('red_mushroom_normal', V.redMushroomPatch, 1, 'motion', 1 / 512);
  const mushBrownTaiga = veg('brown_mushroom_taiga', V.brownMushroomPatch, 1, 'motion', 1 / 4);
  const mushRedTaiga = veg('red_mushroom_taiga', V.redMushroomPatch, 1, 'motion', 1 / 256);
  const mushBrownSwamp = veg('brown_mushroom_swamp', V.brownMushroomPatch, 2);
  const mushRedSwamp = veg('red_mushroom_swamp', V.redMushroomPatch, 1, 'motion', 1 / 2);
  const deadBush = (n: number) => veg(`patch_dead_bush_${n}`, V.deadBushPatch(4), n);
  const dryGrass = (n: number) => veg(`patch_dry_grass_${n}`, V.dryGrassPatch(20), n);
  const cactus = (n: number) => veg(`patch_cactus_${n}`, V.cactusPatch, n);
  const bush = veg('patch_bush', V.bushPatch(12), 1, 'motion', 1 / 4);
  const firefly = veg('patch_firefly_bush', V.fireflyBushPatch, 2);
  const lilyPad = (n: number) => veg(`patch_waterlily_${n}`, V.lilyPadPatch, n);
  const seagrass = (n: number, tall: number) => placed(`seagrass_${n}_${tall}`, S.VEGETAL_DECORATION, V.seagrass(tall), count(n), inSquare(), heightmap('ocean_floor'));
  const kelp = placed('kelp', S.VEGETAL_DECORATION, V.kelpFeature, countRange(40, 80), inSquare(), heightmap('ocean_floor'));
  const pickle = placed('sea_pickle', S.VEGETAL_DECORATION, V.seaPickle, rarity(16), inSquare(), heightmap('ocean_floor'));
  const coral = placed('warm_ocean_vegetation', S.VEGETAL_DECORATION, V.coralReef, countRange(4, 20), inSquare(), heightmap('ocean_floor'));
  const flowers = (id: string, pick: (ctx: FeatureContext, x: number, z: number) => string, n: number, tries = 64) =>
    veg(id, V.flowerPatch(tries, pick), n);
  const flowerDefault = flowers('flower_default', V.FLOWERS.default, 2, 32);
  const flowerPlains = flowers('flower_plains', V.FLOWERS.plains, 4);
  const flowerFlowerForest = flowers('flower_flower_forest', V.FLOWERS.flowerForest, 12);
  const flowerSwamp = flowers('flower_swamp', V.FLOWERS.swamp, 1);
  const flowerMeadow = flowers('flower_meadow', V.FLOWERS.meadow, 6);
  const flowerSunflower = flowers('patch_sunflower', V.FLOWERS.sunflower, 10, 16);
  const flowerTall = flowers('forest_flowers', V.FLOWERS.forest, 1, 32);
  const gazebloom = flowers('flower_pale_garden', V.FLOWERS.paleGarden, 1, 24);
  const pinkPetals = veg('flower_cherry', V.petalsPatch('pink_petals', 64), 10);
  const wildflowersBirch = veg('wildflowers_birch_forest', V.petalsPatch('wildflowers', 48), 3);
  const wildflowersMeadow = veg('wildflowers_meadow', V.petalsPatch('wildflowers', 48), 2);
  const leafLitter = veg('patch_leaf_litter', V.petalsPatch('leaf_litter', 32, 'segment'), 1);
  const paleMoss = veg('pale_moss_patch', V.paleMossPatch, 1);
  const bambooSome = veg('bamboo_light', V.bambooPatch(12, false), 1, 'motion', 1 / 4);
  const bambooMany = veg('bamboo', V.bambooPatch(40, true), 12);
  const iceSpikes = placed('ice_spike', S.SURFACE_STRUCTURES, iceSpike, count(3), inSquare(), heightmap('motion'));
  const icePatch = placed('ice_patch', S.SURFACE_STRUCTURES, disk('packed_ice', ['dirt', 'grass_block', 'snow_block', 'podzol', 'coarse_dirt', 'mycelium'], [2, 3], 1, false), count(2), inSquare(), heightmap('motion'));
  const icebergPacked = placed('iceberg_packed', S.LOCAL_MODIFICATIONS, iceberg('packed_ice'), rarity(16), inSquare());
  const icebergBlue = placed('iceberg_blue', S.LOCAL_MODIFICATIONS, iceberg('blue_ice'), rarity(200), inSquare());
  const blueIcePatch = placed('blue_ice', S.SURFACE_STRUCTURES, blueIce, countRange(0, 19), inSquare(), uniformY(30, 61));
  const well = placed('desert_well', S.SURFACE_STRUCTURES, desertWell, rarity(1000), inSquare(), heightmap('motion'));
  const rock = placed('forest_rock', S.LOCAL_MODIFICATIONS, forestRock, count(2), inSquare(), heightmap('motion'));
  const magma = placed('ore_magma_underwater', S.UNDERGROUND_ORES, C.underwaterMagma, count(4), inSquare(), uniformY(-10, 45),
    filter((ctx, x, _y, z) => ctx.world.getHeight('ocean_floor', x, z) < ctx.world.getHeight('surface', x, z) - 8));
  const hugeMushrooms = placed('mushroom_island_vegetation', S.VEGETAL_DECORATION,
    selector([[TREES.hugeRedMushroom(), 0.5]], TREES.hugeBrownMushroom()), count(1), inSquare(), heightmap('motion'));
  const mushroomsBoth = [veg('brown_mushroom_island', V.brownMushroomPatch, 1, 'motion', 1 / 4), veg('red_mushroom_island', V.redMushroomPatch, 1, 'motion', 1 / 8)];

  // ---- trees ----------------------------------------------------------------------------------
  const oakBirchSel = selector([[TREES.birchBees(0.002), 0.2], [TREES.fancyOakBees(0.002), 0.1]], TREES.oakBees(0.002));
  const treesPlains = trees('trees_plains', selector([[TREES.fancyOakBees(0.05), 0.33]], TREES.oakBees(0.05)), [[0, 19], [1, 1]]);
  const treesForest = trees('trees_birch_and_oak', oakBirchSel, 10);
  const treesFlowerForest = trees('trees_flower_forest', oakBirchSel, 6);
  const treesBirch = trees('trees_birch', TREES.birchBees(0.002), 10);
  const treesOldBirch = trees('birch_tall', selector([[TREES.tallBirch(), 0.5]], TREES.birchBees(0.002)), 10);
  const treesDarkForest = trees('dark_forest_vegetation', selector([
    [TREES.hugeBrownMushroom(), 0.025], [TREES.hugeRedMushroom(), 0.05], [TREES.darkOak(), 0.667], [TREES.birch(), 0.2], [TREES.fancyOak(), 0.1]], TREES.oak()), 16);
  const treesPale = trees('pale_garden_vegetation', selector([[TREES.paleOak(), 0.9]], TREES.paleOak()), 16);
  const treesTaiga = trees('trees_taiga', selector([[TREES.pine(), 0.33]], TREES.spruce()), 10);
  const treesGrove = trees('trees_grove', TREES.spruce(), 10);
  const treesOldPine = trees('trees_old_growth_pine_taiga', selector([[TREES.megaSpruce(), 0.025], [TREES.megaPine(), 0.3], [TREES.pine(), 0.33]], TREES.spruce()), 10);
  const treesOldSpruce = trees('trees_old_growth_spruce_taiga', selector([[TREES.megaSpruce(), 0.33], [TREES.pine(), 0.33]], TREES.spruce()), 10);
  const treesSavanna = trees('trees_savanna', selector([[TREES.acacia(), 0.8]], TREES.oak()), [[1, 9], [2, 1]]);
  const treesWindswept = trees('trees_windswept_hills', selector([[TREES.spruce(), 0.666], [TREES.fancyOak(), 0.1]], TREES.oak()), [[0, 9], [1, 1]]);
  const treesWindsweptForest = trees('trees_windswept_forest', selector([[TREES.spruce(), 0.666], [TREES.fancyOak(), 0.1]], TREES.oak()), 3);
  const treesWindsweptSavanna = trees('trees_windswept_savanna', selector([[TREES.acacia(), 0.8]], TREES.oak()), 2);
  const treesJungle = trees('trees_jungle', selector([[TREES.fancyOak(), 0.1], [TREES.jungleBush(), 0.5], [TREES.megaJungle(), 0.33]], TREES.jungle()), 50);
  const treesSparseJungle = trees('trees_sparse_jungle', selector([[TREES.fancyOak(), 0.1], [TREES.jungleBush(), 0.5]], TREES.jungle()), 2);
  const treesBambooJungle = trees('bamboo_vegetation', selector([[TREES.fancyOak(), 0.05], [TREES.jungleBush(), 0.15], [TREES.megaJungle(), 0.7]], TREES.jungle()), 30);
  const treesSwamp = trees('trees_swamp', TREES.swampOak(), [[2, 9], [3, 1]], 2);
  const treesMangrove = trees('trees_mangrove', selector([[TREES.tallMangrove(), 0.85]], TREES.mangrove()), 25, 5);
  const treesMeadow = trees('trees_meadow', selector([[TREES.fancyOakBees(1), 0.5]], TREES.birchBees(1)), [[0, 99], [1, 1]]);
  const treesCherry = trees('trees_cherry', TREES.cherryBees(0.05), 10);
  const treesWoodedBadlands = trees('trees_badlands', TREES.oak(), 5);
  const treesSnowyPlains = trees('trees_snowy_plains', TREES.spruce(), [[0, 19], [1, 1]]);
  const fallenOak = veg('fallen_oak_tree', TREES.fallenOak(), 1, 'motion', 1 / 80);
  const fallenBirch = veg('fallen_birch_tree', TREES.fallenBirch(), 1, 'motion', 1 / 80);
  const fallenSpruce = veg('fallen_spruce_tree', TREES.fallenSpruce(), 1, 'motion', 1 / 60);
  const fallenJungle = veg('fallen_jungle_tree', TREES.fallenJungle(), 1, 'motion', 1 / 80);

  // ---- caves --------------------------------------------------------------------------------
  const inCave = filter((ctx, x, y, z) => isAir(ctx.world.getBlock(x, y, z)) && y < ctx.world.getHeight('motion', x, z) - 8);
  const lushFloor = placed('lush_caves_vegetation', S.VEGETAL_DECORATION, C.mossFloor, count(60), inSquare(), uniformY(-64, 100), inCave);
  const lushCeiling = placed('lush_caves_ceiling_vegetation', S.VEGETAL_DECORATION, C.mossCeiling, count(60), inSquare(), uniformY(-64, 100), inCave);
  const lushVines = placed('cave_vines', S.VEGETAL_DECORATION, C.caveVines, count(94), inSquare(), uniformY(-64, 100), inCave);
  const lushSpore = placed('spore_blossom', S.VEGETAL_DECORATION, C.sporeBlossom, count(12), inSquare(), uniformY(-64, 100), inCave);
  const lushClay = placed('lush_caves_clay', S.VEGETAL_DECORATION, C.clayPoolWithDripleaf, count(30), inSquare(), uniformY(-64, 100), inCave);
  const lushAzalea = placed('rooted_azalea_tree', S.VEGETAL_DECORATION, C.rootedAzaleaTree, countRange(1, 2), inSquare(), uniformY(-64, 100), inCave);
  const dripCluster = placed('dripstone_cluster', S.LOCAL_MODIFICATIONS, C.dripstoneCluster, countRange(24, 48), inSquare(), uniformY(-64, 120), inCave);
  const dripLarge = placed('large_dripstone', S.LOCAL_MODIFICATIONS, C.largeDripstone, countRange(4, 16), inSquare(), uniformY(-64, 120), inCave);
  const dripPointed = placed('pointed_dripstone_many', S.VEGETAL_DECORATION, C.pointedDripstone, count(96), inSquare(), uniformY(-64, 120), inCave);
  const echo = placed('echo_patch_deep_dark', S.VEGETAL_DECORATION, C.echoPatch, count(48), inSquare(), uniformY(-64, 0), inCave);
  const echoVeins = placed('echo_vein', S.VEGETAL_DECORATION, C.echoVeins, count(80), inSquare(), uniformY(-64, 0), inCave);

  // ---- assignment -----------------------------------------------------------------------------
  const table: Record<string, PlacedFeature[]> = {
    plains: [treesPlains, flowerPlains, grass(10), tallGrass(1), bush, sugarCane, pumpkin, mushBrown, mushRed, fallenOak],
    sunflower_plains: [treesPlains, flowerPlains, flowerSunflower, grass(10), tallGrass(1), sugarCane, pumpkin, mushBrown, mushRed],
    snowy_plains: [treesSnowyPlains, grass(1), sugarCane, pumpkin],
    ice_spikes: [iceSpikes, icePatch, grass(1)],
    desert: [well, fossilUpper, deadBush(2), dryGrass(1), cactus(10), sugarCaneMany, pumpkin],
    swamp: [fossilUpper, treesSwamp, flowerSwamp, grass(5), deadBush(1), lilyPad(4), seagrass(64, 0.6), mushBrownSwamp, mushRedSwamp, sugarCaneMany, firefly, pumpkin, diskClay],
    mangrove_swamp: [fossilUpper, treesMangrove, grass(3), lilyPad(4), seagrass(64, 0.6), firefly, diskClay],
    forest: [treesForest, flowerDefault, flowerTall, grass(2), mushBrown, mushRed, bush, sugarCane, pumpkin, fallenOak, fallenBirch, leafLitter],
    flower_forest: [treesFlowerForest, flowerFlowerForest, flowerTall, grass(2), sugarCane, pumpkin],
    birch_forest: [treesBirch, wildflowersBirch, flowerDefault, grass(2), bush, sugarCane, pumpkin, fallenBirch],
    old_growth_birch_forest: [treesOldBirch, wildflowersBirch, flowerDefault, grass(2), sugarCane, pumpkin, fallenBirch],
    dark_forest: [treesDarkForest, flowerTall, flowerDefault, grass(2), leafLitter, mushBrown, mushRed, sugarCane, pumpkin],
    pale_garden: [treesPale, paleMoss, gazebloom, grass(1)],
    taiga: [treesTaiga, grassFern(7), largeFern, berries, mushBrownTaiga, mushRedTaiga, sugarCane, pumpkin, fallenSpruce],
    snowy_taiga: [treesTaiga, grassFern(7), largeFern, berriesRare, sugarCane, pumpkin, fallenSpruce],
    old_growth_pine_taiga: [rock, treesOldPine, grassFern(7), largeFern, berriesRare, mushBrownTaiga, mushRedTaiga, sugarCane, pumpkin, fallenSpruce],
    old_growth_spruce_taiga: [rock, treesOldSpruce, grassFern(7), largeFern, berriesRare, mushBrownTaiga, mushRedTaiga, sugarCane, pumpkin, fallenSpruce],
    savanna: [treesSavanna, tallGrass(7), grass(20), flowerDefault, sugarCane, pumpkin],
    savanna_plateau: [treesSavanna, tallGrass(7), grass(20), flowerDefault, sugarCane, pumpkin],
    windswept_hills: [...MOUNTAIN, treesWindswept, grass(1), flowerDefault],
    windswept_gravelly_hills: [...MOUNTAIN, treesWindswept, grass(1), flowerDefault],
    windswept_forest: [...MOUNTAIN, treesWindsweptForest, grass(1), flowerDefault],
    windswept_savanna: [treesWindsweptSavanna, tallGrass(7), grass(20)],
    jungle: [treesJungle, bambooSome, flowerDefault, grassFern(25), melon, sugarCane, pumpkin, fallenJungle],
    sparse_jungle: [treesSparseJungle, flowerDefault, grassFern(25), melon, sugarCane, pumpkin, fallenJungle],
    bamboo_jungle: [bambooMany, treesBambooJungle, flowerDefault, grassFern(25), melon, sugarCane, pumpkin],
    badlands: [oreGoldExtra, deadBush(20), dryGrass(2), cactus(5), sugarCane],
    eroded_badlands: [oreGoldExtra, deadBush(20), dryGrass(2), cactus(5), sugarCane],
    wooded_badlands: [oreGoldExtra, treesWoodedBadlands, grass(5), deadBush(1), dryGrass(1), cactus(5), sugarCane],
    meadow: [...MOUNTAIN, treesMeadow, flowerMeadow, wildflowersMeadow, grass(8), tallGrass(3)],
    cherry_grove: [...MOUNTAIN, treesCherry, pinkPetals, grass(6), tallGrass(1)],
    grove: [...MOUNTAIN, treesGrove],
    snowy_slopes: [...MOUNTAIN],
    frozen_peaks: [...MOUNTAIN, blueIcePatch],
    jagged_peaks: [...MOUNTAIN],
    stony_peaks: [...MOUNTAIN],
    river: [seagrass(48, 0.4), sugarCaneMany, diskClay, diskSand, diskGravel],
    frozen_river: [seagrass(24, 0.3)],
    beach: [],
    snowy_beach: [],
    stony_shore: [],
    ocean: [seagrass(48, 0.3), kelp],
    deep_ocean: [seagrass(48, 0.4), kelp, magma],
    cold_ocean: [seagrass(32, 0.3), kelp],
    deep_cold_ocean: [seagrass(40, 0.4), kelp, magma],
    lukewarm_ocean: [seagrass(80, 0.3), kelp, pickle],
    deep_lukewarm_ocean: [seagrass(80, 0.8), kelp, pickle, magma],
    warm_ocean: [seagrass(80, 0.3), coral, pickle],
    frozen_ocean: [icebergPacked, icebergBlue, blueIcePatch],
    deep_frozen_ocean: [icebergPacked, icebergBlue, blueIcePatch, magma],
    mushroom_fields: [hugeMushrooms, ...mushroomsBoth],
    dripstone_caves: [dripCluster, dripLarge, dripPointed, oreCopperLarge],
    lush_caves: [lushFloor, lushCeiling, lushVines, lushSpore, lushClay, lushAzalea, oreClay],
    deep_dark: [echo, echoVeins],
  };
  const out = new Map<number, Set<PlacedFeature>>();
  for (const b of BIOMES) {
    if (b.dimension !== 'overworld' || b.name === 'the_void') continue;
    const list = table[b.name] ?? [];
    const set = new Set<PlacedFeature>(b.name === 'dripstone_caves' ? COMMON.filter((f) => f !== oreCopper) : COMMON);
    for (const f of list) set.add(f);
    out.set(b.id, set);
  }
  return out;
}
