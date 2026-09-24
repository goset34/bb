/** Air, fluids, terrain, stones, ores and mineral blocks. */
import {
  reg, cube, cubeBT, pillar, slab, stairs, wall, button, pressurePlate, stoneLike, dirtLike, metalLike, P, Tint, Wave,
  shapeOf, EMPTY_SHAPE, model, box, crossElements, multiface, rotateModel,
} from './helpers';
import { cubeTex, Element } from '../model';
import { Direction, DOWN, UP } from '../../world/direction';

export function registerNatural(): void {
  // ---- air & fluids ---------------------------------------------------------------------------
  reg('air', [], { air: true, collision: false, replaceable: true, noItem: true, occludes: false, push: 'ignore' });
  reg('water', [P.level15], {
    fluid: 'water', collision: false, replaceable: true, layer: 'translucent', opacity: 1, hardness: 100, noItem: true,
    occludes: false, cullSame: true, push: 'destroy', noDrops: true, map: 'water',
    model: () => ({ kind: 'liquid', still: 'water_still', flow: 'water_flow', lava: false }),
    wave: Wave.Water,
  });
  reg('lava', [P.level15], {
    fluid: 'lava', collision: false, replaceable: true, layer: 'solid', light: 15, hardness: 100, noItem: true, randomTicks: true,
    occludes: false, cullSame: true, push: 'destroy', noDrops: true, emissive: true, map: 'fire', hot: true,
    model: () => ({ kind: 'liquid', still: 'lava_still', flow: 'lava_flow', lava: true }),
    wave: Wave.Lava,
  });

  // ---- stone & variants -----------------------------------------------------------------------
  cube('stone', stoneLike(1.5, 6, { tags: ['base_stone_overworld', 'stone_ore_replaceables', 'mineable/pickaxe'], drops: 'cobblestone' }));
  for (const n of ['granite', 'diorite', 'andesite']) {
    cube(n, stoneLike(1.5, 6, { tags: ['base_stone_overworld', 'stone_ore_replaceables'] }));
    cube(`polished_${n}`, stoneLike(1.5, 6));
  }
  cube('cobblestone', stoneLike(2, 6));
  cube('mossy_cobblestone', stoneLike(2, 6));
  cube('smooth_stone', stoneLike(2, 6));
  cube('stone_bricks', stoneLike(1.5, 6));
  cube('mossy_stone_bricks', stoneLike(1.5, 6));
  cube('cracked_stone_bricks', stoneLike(1.5, 6));
  cube('chiseled_stone_bricks', stoneLike(1.5, 6));

  pillar('deepslate', stoneLike(3, 6, { sound: 'deepslate', map: 'deepslate', tags: ['base_stone_overworld', 'deepslate_ore_replaceables'], drops: 'cobbled_deepslate' }));
  cube('cobbled_deepslate', stoneLike(3.5, 6, { sound: 'deepslate', map: 'deepslate' }));
  cube('polished_deepslate', stoneLike(3.5, 6, { sound: 'polished_deepslate', map: 'deepslate' }));
  cube('deepslate_bricks', stoneLike(3.5, 6, { sound: 'deepslate_bricks', map: 'deepslate' }));
  cube('cracked_deepslate_bricks', stoneLike(3.5, 6, { sound: 'deepslate_bricks', map: 'deepslate' }));
  cube('deepslate_tiles', stoneLike(3.5, 6, { sound: 'deepslate_tiles', map: 'deepslate' }));
  cube('cracked_deepslate_tiles', stoneLike(3.5, 6, { sound: 'deepslate_tiles', map: 'deepslate' }));
  cube('chiseled_deepslate', stoneLike(3.5, 6, { sound: 'deepslate_bricks', map: 'deepslate' }));
  cubeBT('reinforced_deepslate', { hardness: 55, resistance: 1200, sound: 'deepslate', map: 'deepslate', push: 'block', noDrops: true }, 'reinforced_deepslate_bottom', 'reinforced_deepslate_top', 'reinforced_deepslate_side');

  cube('tuff', stoneLike(1.5, 6, { sound: 'tuff', map: 'terracotta_gray', tags: ['base_stone_overworld'] }));
  cube('polished_tuff', stoneLike(1.5, 6, { sound: 'tuff', map: 'terracotta_gray' }));
  cube('tuff_bricks', stoneLike(1.5, 6, { sound: 'tuff', map: 'terracotta_gray' }));
  cubeBT('chiseled_tuff', stoneLike(1.5, 6, { sound: 'tuff' }), 'chiseled_tuff_top', 'chiseled_tuff_top', 'chiseled_tuff');
  cubeBT('chiseled_tuff_bricks', stoneLike(1.5, 6, { sound: 'tuff' }), 'chiseled_tuff_bricks_top', 'chiseled_tuff_bricks_top', 'chiseled_tuff_bricks');
  cube('calcite', stoneLike(0.75, 0.75, { sound: 'calcite', map: 'terracotta_white' }));
  cube('dripstone_block', stoneLike(1.5, 1, { sound: 'dripstone', map: 'terracotta_brown' }));

  // Stone family shapes
  const fam = (base: string, tex = base, s = stoneLike(1.5, 6), w = true, st = true, sl = true) => {
    if (st) stairs(`${base}_stairs`, tex, s);
    if (sl) slab(`${base}_slab`, tex, s);
    if (w) wall(`${base}_wall`, tex, s);
  };
  fam('stone', 'stone', stoneLike(1.5, 6), false);
  button('stone_button', 'stone', { sound: 'stone', map: 'none' });
  pressurePlate('stone_pressure_plate', 'stone', { ...stoneLike(0.5, 0.5), collision: false });
  fam('cobblestone', 'cobblestone', stoneLike(2, 6));
  fam('mossy_cobblestone', 'mossy_cobblestone', stoneLike(2, 6));
  slab('smooth_stone_slab', { top: 'smooth_stone', bottom: 'smooth_stone', side: 'smooth_stone_slab_side' }, stoneLike(2, 6));
  fam('stone_brick', 'stone_bricks');
  fam('mossy_stone_brick', 'mossy_stone_bricks');
  for (const n of ['granite', 'diorite', 'andesite']) {
    fam(n, n);
    fam(`polished_${n}`, `polished_${n}`, stoneLike(1.5, 6), false);
  }
  fam('cobbled_deepslate', 'cobbled_deepslate', stoneLike(3.5, 6, { sound: 'deepslate' }));
  fam('polished_deepslate', 'polished_deepslate', stoneLike(3.5, 6, { sound: 'polished_deepslate' }));
  fam('deepslate_brick', 'deepslate_bricks', stoneLike(3.5, 6, { sound: 'deepslate_bricks' }));
  fam('deepslate_tile', 'deepslate_tiles', stoneLike(3.5, 6, { sound: 'deepslate_tiles' }));
  fam('tuff', 'tuff', stoneLike(1.5, 6, { sound: 'tuff' }));
  fam('polished_tuff', 'polished_tuff', stoneLike(1.5, 6, { sound: 'tuff' }));
  fam('tuff_brick', 'tuff_bricks', stoneLike(1.5, 6, { sound: 'tuff' }));

  // Pointed dripstone
  reg('pointed_dripstone', [P.verticalDirection, P.thickness, P.waterlogged], {
    defaults: { vertical_direction: 1, thickness: 'tip' },
    ...stoneLike(1.5, 3, { sound: 'pointed_dripstone', map: 'terracotta_brown', requiresTool: false }),
    layer: 'cutout', occludes: false, randomTicks: true, offset: 'xz', push: 'destroy',
    model: (s) => {
      const dir = s.get(P.verticalDirection) === UP ? 'up' : 'down';
      return model(crossElements(`pointed_dripstone_${dir}_${s.get(P.thickness)}`), false);
    },
    shape: (s) => {
      const t = s.get(P.thickness);
      const r = t === 'tip_merge' || t === 'tip' ? 3 : t === 'frustum' ? 4 : t === 'middle' ? 5 : 6;
      return shapeOf([8 - r, 0, 8 - r, 8 + r, 16, 8 + r]);
    },
  });

  // ---- dirt family ----------------------------------------------------------------------------
  reg('grass_block', [P.snowy], {
    ...dirtLike(0.6, { sound: 'grass', map: 'grass', randomTicks: true, tags: ['dirt', 'mineable/shovel'], drops: 'dirt' }),
    model: (s) => s.get(P.snowy)
      ? { kind: 'cube', tex: ['dirt', 'grass_block_top', 'grass_block_snow', 'grass_block_snow', 'grass_block_snow', 'grass_block_snow'] }
      : { kind: 'cube', tex: ['dirt', 'grass_block_top', 'grass_block_side', 'grass_block_side', 'grass_block_side', 'grass_block_side'], tint: [0, Tint.Grass, Tint.Grass, Tint.Grass, Tint.Grass, Tint.Grass] },
  });
  cube('dirt', dirtLike(0.5, { tags: ['dirt'] }));
  cube('coarse_dirt', dirtLike(0.5, { tags: ['dirt'] }));
  reg('podzol', [P.snowy], {
    ...dirtLike(0.5, { map: 'podzol', tags: ['dirt'], drops: 'dirt' }),
    model: (s) => s.get(P.snowy) ? { kind: 'cube', tex: ['dirt', 'podzol_top', 'grass_block_snow', 'grass_block_snow', 'grass_block_snow', 'grass_block_snow'] } : { kind: 'cube', tex: ['dirt', 'podzol_top', 'podzol_side', 'podzol_side', 'podzol_side', 'podzol_side'] },
  });
  cube('rooted_dirt', dirtLike(0.5, { sound: 'rooted_dirt', tags: ['dirt'] }));
  reg('mycelium', [P.snowy], {
    ...dirtLike(0.6, { sound: 'grass', map: 'color_purple', randomTicks: true, tags: ['dirt'], drops: 'dirt' }),
    model: (s) => s.get(P.snowy) ? { kind: 'cube', tex: ['dirt', 'mycelium_top', 'grass_block_snow', 'grass_block_snow', 'grass_block_snow', 'grass_block_snow'] } : { kind: 'cube', tex: ['dirt', 'mycelium_top', 'mycelium_side', 'mycelium_side', 'mycelium_side', 'mycelium_side'] },
  });
  reg('dirt_path', [], {
    ...dirtLike(0.65, { sound: 'grass', drops: 'dirt' }), occludes: false,
    model: () => model([box([0, 0, 0], [16, 15, 16], { 0: 'dirt', 1: 'dirt_path_top', 2: 'dirt_path_side', 3: 'dirt_path_side', 4: 'dirt_path_side', 5: 'dirt_path_side' })]),
    solid: true, spawnable: false,
  });
  reg('farmland', [P.moisture], {
    ...dirtLike(0.6, { drops: 'dirt', randomTicks: true }), occludes: false,
    model: (s) => model([box([0, 0, 0], [16, 15, 16], { 0: 'dirt', 1: s.get(P.moisture) === 7 ? 'farmland_moist' : 'farmland', 2: 'dirt', 3: 'dirt', 4: 'dirt', 5: 'dirt' })]),
    solid: true, spawnable: false,
  });
  reg('mud', [], {
    ...dirtLike(0.5, { sound: 'mud', map: 'terracotta_cyan', tags: ['dirt'] }),
    model: () => cubeTex('mud'),
    shape: () => shapeOf([0, 0, 0, 16, 14, 16]),
    outline: () => shapeOf([0, 0, 0, 16, 16, 16]),
    solid: true, spawnable: true,
  });
  cube('packed_mud', { hardness: 1, resistance: 3, sound: 'packed_mud', map: 'dirt' });
  cube('mud_bricks', stoneLike(1.5, 3, { sound: 'mud_bricks', map: 'terracotta_light_gray' }));
  stairs('mud_brick_stairs', 'mud_bricks', stoneLike(1.5, 3, { sound: 'mud_bricks' }));
  slab('mud_brick_slab', 'mud_bricks', stoneLike(1.5, 3, { sound: 'mud_bricks' }));
  wall('mud_brick_wall', 'mud_bricks', stoneLike(1.5, 3, { sound: 'mud_bricks' }));
  cube('clay', { hardness: 0.6, tool: 'shovel', sound: 'gravel', map: 'clay' });
  cube('gravel', { hardness: 0.6, tool: 'shovel', sound: 'gravel', map: 'stone', tags: ['falling'] });
  cube('sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', map: 'sand', tags: ['sand', 'falling'] });
  cube('red_sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', map: 'color_orange', tags: ['sand', 'falling'] });
  reg('suspicious_sand', [P.dusted], { hardness: 0.25, tool: 'shovel', sound: 'sand', map: 'sand', blockEntity: 'brushable', noDrops: true, model: (s) => cubeTex(`suspicious_sand_${s.get(P.dusted)}`) });
  reg('suspicious_gravel', [P.dusted], { hardness: 0.25, tool: 'shovel', sound: 'gravel', map: 'stone', blockEntity: 'brushable', noDrops: true, model: (s) => cubeTex(`suspicious_gravel_${s.get(P.dusted)}`) });

  // ---- sandstone ------------------------------------------------------------------------------
  for (const pre of ['', 'red_']) {
    const sb = `${pre}sandstone`;
    const s = stoneLike(0.8, 0.8, { map: pre ? 'color_orange' : 'sand' });
    cubeBT(sb, s, `${sb}_bottom`, `${sb}_top`, sb);
    cubeBT(`chiseled_${sb}`, s, `${sb}_top`, `${sb}_top`, `chiseled_${sb}`);
    cubeBT(`cut_${sb}`, s, `${sb}_top`, `${sb}_top`, `cut_${sb}`);
    cube(`smooth_${sb}`, stoneLike(2, 6, { map: pre ? 'color_orange' : 'sand' }), `${sb}_top`);
    stairs(`${sb}_stairs`, { top: `${sb}_top`, bottom: `${sb}_bottom`, side: sb }, s);
    slab(`${sb}_slab`, { top: `${sb}_top`, bottom: `${sb}_bottom`, side: sb }, stoneLike(2, 6));
    wall(`${sb}_wall`, sb, s);
    slab(`cut_${sb}_slab`, { top: `${sb}_top`, bottom: `${sb}_top`, side: `cut_${sb}` }, stoneLike(2, 6));
    stairs(`smooth_${sb}_stairs`, `${sb}_top`, stoneLike(2, 6));
    slab(`smooth_${sb}_slab`, `${sb}_top`, stoneLike(2, 6));
  }

  // ---- bricks ---------------------------------------------------------------------------------
  cube('bricks', stoneLike(2, 6, { map: 'color_red' }));
  stairs('brick_stairs', 'bricks', stoneLike(2, 6));
  slab('brick_slab', 'bricks', stoneLike(2, 6));
  wall('brick_wall', 'bricks', stoneLike(2, 6));

  // ---- ice & snow -----------------------------------------------------------------------------
  cube('ice', { hardness: 0.5, tool: 'pickaxe', sound: 'glass', map: 'ice', friction: 0.98, layer: 'translucent', opacity: 1, randomTicks: true, occludes: false, cullSame: true, noDrops: true, tags: ['ice'] });
  cube('packed_ice', { hardness: 0.5, tool: 'pickaxe', sound: 'glass', map: 'ice', friction: 0.98, noDrops: true, tags: ['ice'] });
  cube('blue_ice', { hardness: 2.8, tool: 'pickaxe', sound: 'glass', map: 'ice', friction: 0.989, noDrops: true, tags: ['ice'] });
  reg('frosted_ice', [P.age3], { hardness: 0.5, sound: 'glass', map: 'ice', friction: 0.98, layer: 'translucent', opacity: 1, randomTicks: true, occludes: false, cullSame: true, noDrops: true, noItem: true, model: (s) => cubeTex(`frosted_ice_${s.get(P.age3)}`) });
  reg('snow', [P.layers], {
    hardness: 0.1, tool: 'shovel', requiresTool: true, sound: 'snow', map: 'snow', replaceable: false, randomTicks: true, occludes: false,
    model: (s) => (s.get(P.layers) === 8 ? cubeTex('snow') : model([box([0, 0, 0], [16, s.get(P.layers) * 2, 16], 'snow')])),
    shape: (s) => (s.get(P.layers) <= 1 ? EMPTY_SHAPE : shapeOf([0, 0, 0, 16, (s.get(P.layers) - 1) * 2, 16])),
    outline: (s) => shapeOf([0, 0, 0, 16, s.get(P.layers) * 2, 16]),
    push: 'destroy', tags: ['snow'],
  });
  cube('snow_block', { hardness: 0.2, tool: 'shovel', requiresTool: true, sound: 'snow', map: 'snow', tags: ['snow'] });
  reg('powder_snow', [], {
    hardness: 0.25, sound: 'powder_snow', map: 'snow', collision: false, layer: 'translucent', occludes: false, opacity: 1, cullSame: true,
    model: () => cubeTex('powder_snow'), noDrops: true, itemId: 'powder_snow_bucket', noItem: true, tags: ['snow'],
  });

  // ---- misc natural ---------------------------------------------------------------------------
  cube('bedrock', { hardness: -1, resistance: 3600000, sound: 'stone', map: 'stone', push: 'block', noDrops: true });
  cube('obsidian', stoneLike(50, 1200, { tier: 3, map: 'color_black', push: 'block' }));
  cube('crying_obsidian', stoneLike(50, 1200, { tier: 3, map: 'color_black', push: 'block', light: 10 }));
  cube('magma_block', stoneLike(0.5, 0.5, { map: 'nether', light: 3, emissive: true, hot: true, randomTicks: true, sound: 'cinderrack', tags: ['infiniburn_overworld'] }));
  cube('moss_block', { hardness: 0.1, tool: 'hoe', sound: 'moss', map: 'color_green', tags: ['dirt'] });
  reg('moss_carpet', [], { hardness: 0.1, sound: 'moss', map: 'color_green', push: 'destroy', occludes: false, model: () => model([box([0, 0, 0], [16, 1, 16], 'moss_block')]) });
  cube('pale_moss_block', { hardness: 0.1, tool: 'hoe', sound: 'moss', map: 'color_light_gray', tags: ['dirt'] });
  reg('pale_moss_carpet', [P.mossyBottom, P.wallNorth, P.wallEast, P.wallSouth, P.wallWest], {
    hardness: 0.1, sound: 'moss', map: 'color_light_gray', push: 'destroy', occludes: false, layer: 'cutout', dynamicShape: true,
    model: (s) => {
      const els: Element[] = [];
      if (s.get(P.mossyBottom)) els.push(box([0, 0, 0], [16, 1, 16], 'pale_moss_carpet'));
      const sides: Array<[string, Direction]> = [[s.get(P.wallNorth), 2], [s.get(P.wallSouth), 3], [s.get(P.wallWest), 4], [s.get(P.wallEast), 5]];
      for (const [v, d] of sides) {
        if (v === 'none') continue;
        const h = v === 'tall' ? 16 : 10;
        const e: Element = d === 2 ? box([0, 0, 0.1], [16, h, 0.1], 'pale_moss_carpet_side', { cullEdges: false }) : d === 3 ? box([0, 0, 15.9], [16, h, 15.9], 'pale_moss_carpet_side', { cullEdges: false }) : d === 4 ? box([0.1, 0, 0], [0.1, h, 16], 'pale_moss_carpet_side', { cullEdges: false }) : box([15.9, 0, 0], [15.9, h, 16], 'pale_moss_carpet_side', { cullEdges: false });
        els.push(e);
      }
      return model(els, false);
    },
    shape: (s) => (s.get(P.mossyBottom) ? shapeOf([0, 0, 0, 16, 1, 16]) : EMPTY_SHAPE),
  });
  reg('pale_hanging_moss', [P.tip], { ...{ hardness: 0, collision: false, sound: 'moss', map: 'color_light_gray', layer: 'cutout', push: 'destroy', occludes: false, wave: Wave.Hanging, replaceable: true }, model: (s) => model(crossElements(s.get(P.tip) ? 'pale_hanging_moss_tip' : 'pale_hanging_moss'), false) });

  // Amethyst
  cube('amethyst_block', stoneLike(1.5, 1.5, { sound: 'amethyst', map: 'color_purple', requiresTool: true }));
  cube('budding_amethyst', stoneLike(1.5, 1.5, { sound: 'amethyst', map: 'color_purple', randomTicks: true, push: 'destroy', noDrops: true }));
  const bud = (name: string, h: number, inset: number, light: number) =>
    reg(name, [P.facing6, P.waterlogged], {
      ...stoneLike(1.5, 1.5, { sound: 'amethyst', map: 'color_purple', requiresTool: false }), layer: 'cutout', occludes: false, light, push: 'destroy',
      model: (s) => {
        const f = s.get(P.facing6);
        const els = crossElements(name, Tint.None, 16);
        // Orient: authored pointing up
        const rx = f === UP ? 0 : f === DOWN ? 180 : 90;
        const ry = f === 2 ? 0 : f === 5 ? 90 : f === 3 ? 180 : f === 4 ? 270 : 0;
        return model(rotateModel(els, rx, ry), false);
      },
      shape: (s) => {
        const f = s.get(P.facing6);
        const a = inset, b = 16 - inset;
        switch (f) {
          case UP: return shapeOf([a, 0, a, b, h, b]);
          case DOWN: return shapeOf([a, 16 - h, a, b, 16, b]);
          case 2: return shapeOf([a, a, 16 - h, b, b, 16]);
          case 3: return shapeOf([a, a, 0, b, b, h]);
          case 4: return shapeOf([16 - h, a, a, 16, b, b]);
          default: return shapeOf([0, a, a, h, b, b]);
        }
      },
    });
  bud('small_amethyst_bud', 3, 4, 1);
  bud('medium_amethyst_bud', 4, 3, 2);
  bud('large_amethyst_bud', 5, 3, 4);
  bud('amethyst_cluster', 7, 3, 5);

  // ---- ores -----------------------------------------------------------------------------------
  const ore = (name: string, tier: number, deep: boolean, extra = {}) =>
    cube(name, stoneLike(deep ? 4.5 : 3, 3, { tier, sound: deep ? 'deepslate' : 'stone', map: deep ? 'deepslate' : 'stone', tags: ['ores'], ...extra }));
  ore('coal_ore', 0, false); ore('deepslate_coal_ore', 0, true);
  ore('iron_ore', 1, false); ore('deepslate_iron_ore', 1, true);
  ore('copper_ore', 1, false); ore('deepslate_copper_ore', 1, true);
  ore('gold_ore', 2, false); ore('deepslate_gold_ore', 2, true);
  for (const [n, deep] of [['flux_ore', false], ['deepslate_flux_ore', true]] as const) {
    reg(n, [P.lit], {
      ...stoneLike(deep ? 4.5 : 3, 3, { tier: 2, sound: deep ? 'deepslate' : 'stone', tags: ['ores'] }),
      randomTicks: true, light: (s) => (s.get(P.lit) ? 9 : 0),
      model: (s) => cubeTex(s.get(P.lit) ? `${n}_lit` : n),
    });
  }
  ore('emerald_ore', 2, false); ore('deepslate_emerald_ore', 2, true);
  ore('lapis_ore', 1, false); ore('deepslate_lapis_ore', 1, true);
  ore('diamond_ore', 2, false); ore('deepslate_diamond_ore', 2, true);

  cube('coal_block', stoneLike(5, 6, { map: 'color_black', flammable: [5, 5] }));
  cube('raw_iron_block', stoneLike(5, 6, { tier: 1, map: 'raw_iron' }));
  cube('raw_copper_block', stoneLike(5, 6, { tier: 1, map: 'color_orange' }));
  cube('raw_gold_block', stoneLike(5, 6, { tier: 2, map: 'gold' }));
  cube('iron_block', metalLike(5, 6, { tier: 1, tags: ['beacon_base'] }));
  cube('gold_block', metalLike(3, 6, { tier: 2, map: 'gold', tags: ['beacon_base'] }));
  cube('diamond_block', metalLike(5, 6, { tier: 2, map: 'diamond', tags: ['beacon_base'] }));
  cube('emerald_block', metalLike(5, 6, { tier: 2, map: 'emerald', tags: ['beacon_base'] }));
  cube('lapis_block', stoneLike(3, 3, { tier: 1, map: 'lapis' }));
  cube('flux_block', metalLike(5, 6, { tier: 0, map: 'fire', conductor: false }));
  cube('infernium_block', metalLike(50, 1200, { tier: 3, map: 'color_black', sound: 'infernium', push: 'block', tags: ['beacon_base'] }));

  // Glow lichen & friends
  multiface('glow_lichen', { sound: 'glow_lichen', map: 'glow_lichen', light: (s) => (s.get(P.down) || s.get(P.up) || s.get(P.north) || s.get(P.south) || s.get(P.west) || s.get(P.east) ? 7 : 0), tool: 'axe' });

  // Bone block (fossils)
  pillar('bone_block', stoneLike(2, 2, { sound: 'bone', map: 'sand' }), 'bone_block_top', 'bone_block_side');
}
