/** Vegetation: grasses, flowers, crops, mushrooms, vines, cave plants, aquatic plants. */
import {
  reg, cube, cross, tallPlant, pottedPlant, plantLike, P, Tint, Wave, shapeOf, EMPTY_SHAPE, model, box, crossElements,
  mushroomBlock, multiface, rotateModel, facingRot, BlockSettings, UP, NORTH, SOUTH, WEST, EAST,
} from './helpers';
import { cropElements, planeOn, cubeTex, Element } from '../model';
import { cactusElements } from '../shapes';
import { Direction } from '../../world/direction';

export const SMALL_FLOWERS = [
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
  'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'blight_rose', 'torchflower', 'open_gazebloom', 'closed_gazebloom',
] as const;

export function registerPlants(): void {
  // ---- grasses ---------------------------------------------------------------------------------
  cross('short_grass', { replaceable: true, drops: 'none', tags: ['replaceable_by_trees'] }, 'short_grass', Tint.Grass);
  cross('fern', { replaceable: true, drops: 'none', tags: ['replaceable_by_trees'] }, 'fern', Tint.Grass);
  tallPlant('tall_grass', { drops: 'none', tags: ['replaceable_by_trees'] }, Tint.Grass);
  tallPlant('large_fern', { drops: 'none', tags: ['replaceable_by_trees'] }, Tint.Grass);
  cross('dead_bush', { replaceable: true, drops: 'none', map: 'wood', tags: ['replaceable_by_trees'] });
  cross('bush', { replaceable: true, drops: 'none', tags: ['replaceable_by_trees'] }, 'bush', Tint.Grass);
  cross('short_dry_grass', { replaceable: true, drops: 'none', map: 'color_yellow', tags: ['replaceable_by_trees'] });
  cross('tall_dry_grass', { replaceable: true, drops: 'none', map: 'color_yellow', tags: ['replaceable_by_trees'] });
  cross('firefly_bush', { light: 2, drops: 'firefly_bush', tags: ['replaceable_by_trees'] });

  // ---- flowers ---------------------------------------------------------------------------------
  for (const f of SMALL_FLOWERS) {
    const light = f === 'open_gazebloom' ? 0 : 0;
    cross(f, { tags: ['flowers', 'small_flowers'], light, randomTicks: f.includes('gazebloom') }, f);
    pottedPlant(`potted_${f}`, f);
  }
  reg('torchflower_crop', [P.age1], { ...plantLike({ randomTicks: true, noItem: true, drops: 'torchflower_seeds', itemId: 'torchflower_seeds', tags: ['crops'] }), offset: 'none', model: (s) => model(crossElements(`torchflower_crop_stage${s.get(P.age1)}`), false) });
  tallPlant('sunflower', { tags: ['flowers', 'tall_flowers'] });
  tallPlant('lilac', { tags: ['flowers', 'tall_flowers'] });
  tallPlant('rose_bush', { tags: ['flowers', 'tall_flowers'] });
  tallPlant('peony', { tags: ['flowers', 'tall_flowers'] });
  tallPlant('pitcher_plant', { tags: ['flowers', 'tall_flowers'] });
  reg('pitcher_crop', [P.age4, P.doubleHalf], {
    ...plantLike({ randomTicks: true, noItem: true, itemId: 'pitcher_pod', drops: 'pitcher_pod', tags: ['crops'] }), offset: 'none',
    model: (s) => model(crossElements(`pitcher_crop_${s.get(P.doubleHalf)}_stage_${s.get(P.age4)}`), false),
    shape: (s) => (s.get(P.doubleHalf) === 'lower' ? shapeOf([3, -1, 3, 13, 5, 13]) : EMPTY_SHAPE),
  });
  const petals = (name: string, prop = P.flowerAmount) => reg(name, [P.facing, prop], {
    ...plantLike({ replaceable: true, tags: ['flowers'] }), offset: 'none', wave: Wave.None,
    model: (s) => {
      const n = s.get(prop) as number;
      const els: Element[] = [];
      const quads: Array<[number, number]> = [[0, 0], [8, 0], [8, 8], [0, 8]];
      for (let i = 0; i < n; i++) {
        const [x, z] = quads[i]!;
        els.push({ from: [x, 1.5, z], to: [x + 8, 1.5, z + 8], shade: false, faces: { 1: { tex: `${name}`, uv: [x, z, x + 8, z + 8] }, 0: { tex: `${name}`, uv: [x, z, x + 8, z + 8] } } });
      }
      return model(facingRot(els, s.get(P.facing)), false);
    },
    outline: () => shapeOf([0, 0, 0, 16, 3, 16]),
  });
  petals('pink_petals');
  petals('wildflowers');
  petals('leaf_litter', P.segmentAmount);
  cross('cactus_flower', { tags: ['flowers'] });
  cross('spore_blossom', { light: 0, wave: Wave.Hanging, outline: () => shapeOf([2, 13, 2, 14, 16, 14]) });

  // ---- sugar cane, cactus, bamboo ---------------------------------------------------------------
  reg('sugar_cane', [P.age15], { ...plantLike({ randomTicks: true, offset: 'none' }), model: () => model(crossElements('sugar_cane', Tint.Grass), false), outline: () => shapeOf([2, 0, 2, 14, 16, 14]) });
  reg('cactus', [P.age15], {
    hardness: 0.4, sound: 'wool', map: 'plant', randomTicks: true, layer: 'cutout', push: 'destroy', occludes: false,
    model: () => model(cactusElements('cactus_side', 'cactus_top', 'cactus_bottom')),
    shape: () => shapeOf([1, 0, 1, 15, 15, 15]),
    outline: () => shapeOf([1, 0, 1, 15, 16, 15]),
  });
  reg('bamboo', [P.bambooAge, P.leaves, P.bambooStage], {
    hardness: 1, sound: 'bamboo', map: 'plant', randomTicks: true, layer: 'cutout', push: 'destroy', offset: 'xz', occludes: false, swordFast: true,
    model: (s) => {
      const thick = s.get(P.bambooAge) === 1 ? 3 : 2;
      const a = 8 - thick / 2 - 0.5, b = a + thick;
      const els: Element[] = [box([a, 0, a], [b, 16, b], { 0: 'bamboo_stalk_top', 1: 'bamboo_stalk_top', 2: 'bamboo_stalk', 3: 'bamboo_stalk', 4: 'bamboo_stalk', 5: 'bamboo_stalk' }, { cullEdges: false })];
      const lv = s.get(P.leaves);
      if (lv !== 'none') els.push(...crossElements(lv === 'small' ? 'bamboo_small_leaves' : 'bamboo_large_leaves'));
      return model(els, false);
    },
    shape: () => shapeOf([6.5, 0, 6.5, 9.5, 16, 9.5]),
  });
  reg('bamboo_sapling', [], { ...plantLike({ randomTicks: true, drops: 'bamboo', itemId: 'bamboo', noItem: true }), model: () => model(crossElements('bamboo_stage0'), false), outline: () => shapeOf([4, 0, 4, 12, 12, 12]) });
  pottedPlant('potted_bamboo', 'bamboo_stage0');
  pottedPlant('potted_cactus', 'cactus_side');
  pottedPlant('potted_dead_bush', 'dead_bush');
  pottedPlant('potted_fern', 'fern', Tint.Grass);

  // ---- crops ----------------------------------------------------------------------------------
  const crop = (name: string, prop: typeof P.age7 | typeof P.age3, texBase: string, stages: number[], seed: string) =>
    reg(name, [prop], {
      ...plantLike({ randomTicks: true, offset: 'none', tags: ['crops'], itemId: seed, noItem: name !== seed, drops: seed }),
      model: (s) => model(cropElements(`${texBase}_stage${stages[s.get(prop)]!}`), false),
      outline: (s) => shapeOf([0, 0, 0, 16, 2 + (s.get(prop) as number) * 2, 16]),
    });
  crop('wheat', P.age7, 'wheat', [0, 1, 2, 3, 4, 5, 6, 7], 'wheat_seeds');
  crop('carrots', P.age7, 'carrots', [0, 0, 1, 1, 2, 2, 2, 3], 'carrot');
  crop('potatoes', P.age7, 'potatoes', [0, 0, 1, 1, 2, 2, 2, 3], 'potato');
  crop('beetroots', P.age3, 'beetroots', [0, 1, 2, 3], 'beetroot_seeds');
  const stem = (name: string, fruit: string, seed: string) => {
    reg(`${name}_stem`, [P.age7], {
      ...plantLike({ randomTicks: true, offset: 'none', itemId: seed, noItem: true, drops: seed, tags: ['crops'] }),
      model: (s) => {
        const h = (s.get(P.age7) + 1) * 2;
        return model(crossElements('stem', Tint.Stem, h), false);
      },
      outline: (s) => shapeOf([7, 0, 7, 9, (s.get(P.age7) + 1) * 2, 9]),
    });
    reg(`attached_${name}_stem`, [P.facing], {
      ...plantLike({ offset: 'none', itemId: seed, noItem: true, drops: seed }),
      model: (s) => {
        const f = s.get(P.facing);
        const el: Element = { from: [0, 0, 8], to: [9, 16, 8], shade: false, faces: { 2: { tex: 'attached_stem', tint: Tint.AttachedStem, uv: [9, 0, 0, 16] }, 3: { tex: 'attached_stem', tint: Tint.AttachedStem, uv: [0, 0, 9, 16] } } };
        // authored pointing west
        const y = f === WEST ? 0 : f === NORTH ? 90 : f === EAST ? 180 : 270;
        return model(rotateModel([el], 0, y), false);
      },
    });
    void fruit;
  };
  stem('melon', 'melon', 'melon_seeds');
  stem('pumpkin', 'pumpkin', 'pumpkin_seeds');
  cube('melon', { hardness: 1, tool: 'axe', sound: 'wood', map: 'color_lime', push: 'destroy', model: () => ({ kind: 'cube', tex: ['melon_top', 'melon_top', 'melon_side', 'melon_side', 'melon_side', 'melon_side'] }) });
  cube('pumpkin', { hardness: 1, tool: 'axe', sound: 'wood', map: 'color_orange', push: 'destroy', model: () => ({ kind: 'cube', tex: ['pumpkin_top', 'pumpkin_top', 'pumpkin_side', 'pumpkin_side', 'pumpkin_side', 'pumpkin_side'] }) });
  for (const [n, front, light] of [['carved_pumpkin', 'carved_pumpkin', 0], ['jack_o_lantern', 'jack_o_lantern', 15]] as const) {
    reg(n, [P.facing], {
      hardness: 1, tool: 'axe', sound: 'wood', map: 'color_orange', light, push: 'destroy',
      model: (s) => {
        const t: [string, string, string, string, string, string] = ['pumpkin_top', 'pumpkin_top', 'pumpkin_side', 'pumpkin_side', 'pumpkin_side', 'pumpkin_side'];
        t[s.get(P.facing)] = front;
        return { kind: 'cube', tex: t, emissive: light ? [false, false, ...[2, 3, 4, 5].map((d) => d === s.get(P.facing))] : undefined };
      },
    });
  }
  reg('cocoa', [P.facing, P.age2], {
    hardness: 0.2, resistance: 3, tool: 'axe', sound: 'wood', map: 'plant', randomTicks: true, layer: 'cutout', push: 'destroy', occludes: false,
    model: (s) => {
      const age = s.get(P.age2);
      const w = 4 + age * 2, h = 5 + age * 2;
      const a = 8 - w / 2;
      const tex = `cocoa_stage${age}`;
      const els = [box([a, 12 - h, 15 - w], [a + w, 12, 15], tex, { cullEdges: false }), { from: [8, 12, 12], to: [8, 16, 16], shade: false, faces: { 4: { tex, uv: [12, 0, 16, 4] as [number, number, number, number] }, 5: { tex, uv: [16, 0, 12, 4] as [number, number, number, number] } } } as Element];
      // authored facing south (attached to the south log); facing = direction to the log
      const f = s.get(P.facing);
      const y = f === SOUTH ? 0 : f === WEST ? 90 : f === NORTH ? 180 : 270;
      return model(rotateModel(els, 0, y));
    },
  });
  reg('sweet_berry_bush', [P.age3], {
    ...plantLike({ randomTicks: true, offset: 'none', itemId: 'sweet_berries', noItem: true, drops: 'sweet_berries' }),
    model: (s) => model(crossElements(`sweet_berry_bush_stage${s.get(P.age3)}`), false),
  });
  reg('ember_wart', [P.age3], {
    ...plantLike({ randomTicks: true, offset: 'none', map: 'color_red', itemId: 'ember_wart', noItem: false, sound: 'nether_wart' }),
    model: (s) => model(cropElements(`ember_wart_stage${[0, 1, 1, 2][s.get(P.age3)]}`), false),
    outline: (s) => shapeOf([0, 0, 0, 16, [5, 8, 11, 14][s.get(P.age3)]!, 16]),
  });

  // ---- mushrooms ------------------------------------------------------------------------------
  cross('brown_mushroom', { light: 1, randomTicks: true, map: 'color_brown', offset: 'none', outline: () => shapeOf([5, 0, 5, 11, 6, 11]) });
  cross('red_mushroom', { randomTicks: true, map: 'color_red', offset: 'none', outline: () => shapeOf([5, 0, 5, 11, 6, 11]) });
  pottedPlant('potted_brown_mushroom', 'brown_mushroom');
  pottedPlant('potted_red_mushroom', 'red_mushroom');
  mushroomBlock('brown_mushroom_block', { hardness: 0.2, tool: 'axe', sound: 'wood', map: 'dirt', flammable: undefined }, 'brown_mushroom_block', 'mushroom_block_inside');
  mushroomBlock('red_mushroom_block', { hardness: 0.2, tool: 'axe', sound: 'wood', map: 'color_red' }, 'red_mushroom_block', 'mushroom_block_inside');
  mushroomBlock('mushroom_stem', { hardness: 0.2, tool: 'axe', sound: 'wood', map: 'wool' }, 'mushroom_stem', 'mushroom_block_inside');

  // ---- vines & hanging plants ------------------------------------------------------------------
  reg('vine', [P.up, P.north, P.south, P.west, P.east], {
    hardness: 0.2, tool: 'axe', collision: false, replaceable: true, randomTicks: true, sound: 'vine', map: 'plant', layer: 'cutout', push: 'destroy',
    flammable: [15, 100], occludes: false, wave: Wave.Leaves, tags: ['climbable'],
    model: (s) => {
      const els: Element[] = [];
      const faces: Array<[boolean, Direction]> = [[s.get(P.up), UP], [s.get(P.north), NORTH], [s.get(P.south), SOUTH], [s.get(P.west), WEST], [s.get(P.east), EAST]];
      for (const [on, d] of faces) if (on) els.push(planeOn(d, 'vine', 0.8, Tint.Foliage));
      return model(els, false);
    },
    outline: (s) => {
      const b: number[][] = [];
      if (s.get(P.up)) b.push([0, 15, 0, 16, 16, 16]);
      if (s.get(P.north)) b.push([0, 0, 0, 16, 16, 1]);
      if (s.get(P.south)) b.push([0, 0, 15, 16, 16, 16]);
      if (s.get(P.west)) b.push([0, 0, 0, 1, 16, 16]);
      if (s.get(P.east)) b.push([15, 0, 0, 16, 16, 16]);
      return b.length ? shapeOf(...b) : shapeOf([0, 15, 0, 16, 16, 16]);
    },
  });
  const hangVine = (name: string, dir: 'up' | 'down', extra: BlockSettings = {}) => {
    reg(name, [P.age25], {
      ...plantLike({ randomTicks: true, offset: 'none', wave: Wave.Hanging, tags: ['climbable'], ...extra }),
      model: () => model(crossElements(name), false),
      outline: () => (dir === 'down' ? shapeOf([4, 9, 4, 12, 16, 12]) : shapeOf([4, 0, 4, 12, 15, 12])),
    });
    reg(`${name}_plant`, [], {
      ...plantLike({ offset: 'none', wave: Wave.Hanging, noItem: true, itemId: name, drops: name, tags: ['climbable'], ...extra }),
      model: () => model(crossElements(`${name}_plant`), false),
      outline: () => shapeOf([1, 0, 1, 15, 16, 15]),
    });
  };
  hangVine('weeping_vines', 'down', { map: 'nether', sound: 'weeping_vines' });
  hangVine('twisting_vines', 'up', { map: 'color_cyan', sound: 'weeping_vines' });
  reg('cave_vines', [P.age25, P.berries], {
    ...plantLike({ randomTicks: true, offset: 'none', wave: Wave.Hanging, noItem: true, itemId: 'glow_berries', drops: 'glow_berries', tags: ['climbable'], sound: 'cave_vines' }),
    light: (s) => (s.get(P.berries) ? 14 : 0),
    model: (s) => model(crossElements(s.get(P.berries) ? 'cave_vines_lit' : 'cave_vines', Tint.None, 16, s.get(P.berries)), false),
    outline: () => shapeOf([1, 0, 1, 15, 16, 15]),
  });
  reg('cave_vines_plant', [P.berries], {
    ...plantLike({ offset: 'none', wave: Wave.Hanging, noItem: true, itemId: 'glow_berries', drops: 'glow_berries', tags: ['climbable'], sound: 'cave_vines' }),
    light: (s) => (s.get(P.berries) ? 14 : 0),
    model: (s) => model(crossElements(s.get(P.berries) ? 'cave_vines_plant_lit' : 'cave_vines_plant', Tint.None, 16, s.get(P.berries)), false),
    outline: () => shapeOf([1, 0, 1, 15, 16, 15]),
  });
  cross('hanging_roots', { wave: Wave.Hanging, sound: 'hanging_roots', replaceable: true, outline: () => shapeOf([2, 10, 2, 14, 16, 14]) });

  // ---- lush caves -----------------------------------------------------------------------------
  const azalea = (name: string) => reg(name, [], {
    hardness: 0, sound: 'azalea', map: 'plant', layer: 'cutout', push: 'destroy', occludes: false,
    model: () => model([
      box([0, 8, 0], [16, 16, 16], { 1: `${name}_top`, 2: `${name}_side`, 3: `${name}_side`, 4: `${name}_side`, 5: `${name}_side` }, { cullEdges: false }),
      { from: [0, 15.9, 0], to: [16, 15.9, 16], shade: false, faces: { 0: { tex: `${name}_top` } } } as Element,
      ...crossElements(`${name}_plant`, Tint.None, 8).map((e) => ({ ...e, to: [e.to[0], 8, e.to[2]] as [number, number, number] })),
    ]),
    shape: () => shapeOf([0, 8, 0, 16, 16, 16], [6, 0, 6, 10, 8, 10]),
    tags: ['saplings'],
  });
  azalea('azalea');
  azalea('flowering_azalea');
  pottedPlant('potted_azalea_bush', 'azalea_plant');
  pottedPlant('potted_flowering_azalea_bush', 'flowering_azalea_plant');
  reg('azalea_leaves', [P.distance7, P.persistent, P.waterlogged], {
    hardness: 0.2, tool: 'hoe', sound: 'azalea_leaves', map: 'plant', layer: 'cutout', randomTicks: true, flammable: [30, 60], opacity: 1, push: 'destroy', occludes: false, wave: Wave.Leaves, tags: ['leaves'],
    model: () => cubeTex('azalea_leaves'),
  });
  reg('flowering_azalea_leaves', [P.distance7, P.persistent, P.waterlogged], {
    hardness: 0.2, tool: 'hoe', sound: 'azalea_leaves', map: 'plant', layer: 'cutout', randomTicks: true, flammable: [30, 60], opacity: 1, push: 'destroy', occludes: false, wave: Wave.Leaves, tags: ['leaves'],
    model: () => cubeTex('flowering_azalea_leaves'),
  });
  reg('big_dripleaf', [P.facing, P.tilt, P.waterlogged], {
    hardness: 0.1, tool: 'axe', sound: 'big_dripleaf', map: 'plant', layer: 'cutout', push: 'destroy', occludes: false,
    model: (s) => {
      const tilt = s.get(P.tilt);
      const angle = tilt === 'partial' ? 22.5 : tilt === 'full' ? 45 : 0;
      const leaf: Element = { from: [0, 15, 0], to: [16, 15, 16], shade: false, faces: { 1: { tex: 'big_dripleaf_top' }, 0: { tex: 'big_dripleaf_top' } } };
      if (angle) leaf.rot = { axis: 0, angle, origin: [8, 15, 16] };
      const stemEl = crossElements('big_dripleaf_stem', Tint.None, 15);
      return model(facingRot([leaf, ...stemEl], s.get(P.facing)), false);
    },
    shape: (s) => (s.get(P.tilt) === 'full' ? EMPTY_SHAPE : s.get(P.tilt) === 'partial' ? shapeOf([0, 11, 0, 16, 13, 16]) : shapeOf([0, 11, 0, 16, 15, 16])),
    outline: () => shapeOf([0, 11, 0, 16, 15, 16]),
  });
  reg('big_dripleaf_stem', [P.facing, P.waterlogged], {
    ...plantLike({ noItem: true, itemId: 'big_dripleaf', drops: 'big_dripleaf', sound: 'big_dripleaf', offset: 'none' }),
    model: () => model(crossElements('big_dripleaf_stem'), false),
    outline: () => shapeOf([5, 0, 5, 11, 16, 11]),
  });
  reg('small_dripleaf', [P.facing, P.doubleHalf, P.waterlogged], {
    ...plantLike({ sound: 'small_dripleaf', offset: 'xz' }),
    model: (s) => {
      if (s.get(P.doubleHalf) === 'upper') {
        const leaf: Element = { from: [2, 13, 2], to: [14, 13, 14], shade: false, faces: { 1: { tex: 'small_dripleaf_top' }, 0: { tex: 'small_dripleaf_top' } } };
        return model(facingRot([leaf, ...crossElements('small_dripleaf_stem_top', Tint.None, 13)], s.get(P.facing)), false);
      }
      return model(crossElements('small_dripleaf_stem_bottom'), false);
    },
  });

  // ---- misc plants --------------------------------------------------------------------------------
  reg('lily_pad', [], {
    hardness: 0, sound: 'lily_pad', map: 'plant', layer: 'cutout', push: 'destroy', occludes: false,
    model: () => model([{ from: [0, 0.25, 0], to: [16, 0.25, 16], shade: false, faces: { 1: { tex: 'lily_pad', tint: Tint.LilyPad }, 0: { tex: 'lily_pad', tint: Tint.LilyPad, uv: [16, 16, 0, 0] } } }], false),
    shape: () => shapeOf([1, 0, 1, 15, 1.5, 15]),
  });
  reg('chorus_plant', [P.north, P.east, P.south, P.west, P.up, P.down], {
    hardness: 0.4, tool: 'axe', sound: 'wood', map: 'color_purple', layer: 'cutout', push: 'destroy', occludes: false, dynamicShape: true,
    model: (s) => {
      const els: Element[] = [box([4, 4, 4], [12, 12, 12], 'chorus_plant', { cullEdges: false })];
      if (s.get(P.north)) els.push(box([4, 4, 0], [12, 12, 4], 'chorus_plant'));
      if (s.get(P.south)) els.push(box([4, 4, 12], [12, 12, 16], 'chorus_plant'));
      if (s.get(P.west)) els.push(box([0, 4, 4], [4, 12, 12], 'chorus_plant'));
      if (s.get(P.east)) els.push(box([12, 4, 4], [16, 12, 12], 'chorus_plant'));
      if (s.get(P.up)) els.push(box([4, 12, 4], [12, 16, 12], 'chorus_plant'));
      if (s.get(P.down)) els.push(box([4, 0, 4], [12, 4, 12], 'chorus_plant'));
      return model(els);
    },
  });
  reg('chorus_flower', [P.age5], {
    hardness: 0.4, tool: 'axe', sound: 'wood', map: 'color_purple', randomTicks: true, layer: 'cutout', push: 'destroy', occludes: false,
    model: (s) => cubeTex(s.get(P.age5) === 5 ? 'chorus_flower_dead' : 'chorus_flower'),
  });
  // Sea grass & kelp
  reg('seagrass', [], { ...plantLike({ replaceable: true, drops: 'none', map: 'water', sound: 'wet_grass', offset: 'none', wave: Wave.PlantBottom }), model: () => model(crossElements('seagrass'), false), waterloggedProp: true, fluid: 'water' });
  reg('tall_seagrass', [P.doubleHalf], { ...plantLike({ replaceable: true, drops: 'none', noItem: true, itemId: 'seagrass', map: 'water', sound: 'wet_grass', offset: 'none' }), model: (s) => model(crossElements(s.get(P.doubleHalf) === 'upper' ? 'tall_seagrass_top' : 'tall_seagrass_bottom'), false), waterloggedProp: true, fluid: 'water' });
  reg('kelp', [P.age25], { ...plantLike({ randomTicks: true, map: 'water', sound: 'wet_grass', offset: 'none' }), model: () => model(crossElements('kelp'), false), waterloggedProp: true, fluid: 'water' });
  reg('kelp_plant', [], { ...plantLike({ noItem: true, itemId: 'kelp', drops: 'kelp', map: 'water', sound: 'wet_grass', offset: 'none' }), model: () => model(crossElements('kelp_plant'), false), waterloggedProp: true, fluid: 'water' });
  reg('sea_pickle', [P.pickles, P.waterlogged], {
    hardness: 0, sound: 'slime', map: 'color_green', layer: 'cutout', push: 'destroy', occludes: false,
    light: (s) => (s.get(P.waterlogged) ? 3 + 3 * s.get(P.pickles) : 0),
    model: (s) => {
      const n = s.get(P.pickles);
      const pos: Array<[number, number]> = [[6, 6], [2, 2], [10, 9], [3, 10]];
      const els: Element[] = [];
      for (let i = 0; i < n; i++) {
        const [x, z] = pos[i]!;
        const h = [6, 4, 6, 7][i]!;
        els.push(box([x, 0, z], [x + 4, h, z + 4], 'sea_pickle', { cullEdges: false }));
      }
      return model(els);
    },
    shape: (s) => shapeOf([2, 0, 2, 14, s.get(P.pickles) === 1 ? 6 : 7, 14]),
  });
  reg('turtle_egg', [P.eggs, P.hatch], {
    hardness: 0.5, sound: 'metal', map: 'sand', randomTicks: true, layer: 'cutout', push: 'destroy', occludes: false,
    model: (s) => {
      const n = s.get(P.eggs);
      const tex = ['turtle_egg', 'turtle_egg_slightly_cracked', 'turtle_egg_very_cracked'][s.get(P.hatch)]!;
      const pos: Array<[number, number]> = [[5, 4], [1, 7], [11, 10], [6, 11]];
      const els: Element[] = [];
      for (let i = 0; i < n; i++) els.push(box([pos[i]![0], 0, pos[i]![1]], [pos[i]![0] + 4, 7, pos[i]![1] + 4], tex, { cullEdges: false }));
      return model(els);
    },
    shape: (s) => (s.get(P.eggs) > 1 ? shapeOf([1, 0, 1, 15, 7, 15]) : shapeOf([3, 0, 3, 12, 7, 12])),
  });
  reg('sniffer_egg', [P.eggsSniffer], {
    hardness: 0.5, sound: 'metal', map: 'color_red', randomTicks: true, push: 'destroy', occludes: false,
    model: (s) => model([box([1, 0, 2], [15, 16, 14], ['sniffer_egg', 'sniffer_egg_slightly_cracked', 'sniffer_egg_very_cracked'][s.get(P.eggsSniffer)]!, { cullEdges: false })]),
  });
  reg('frogspawn', [], { hardness: 0, collision: false, sound: 'frogspawn', map: 'water', layer: 'cutout', push: 'destroy', occludes: false, randomTicks: true, model: () => model([{ from: [0, 1.5, 0], to: [16, 1.5, 16], shade: false, faces: { 1: { tex: 'frogspawn' }, 0: { tex: 'frogspawn' } } }], false) });

  // Nether flora
  cross('crimson_fungus', { map: 'nether', sound: 'fungus', offset: 'none', tags: ['saplings'] });
  cross('warped_fungus', { map: 'color_cyan', sound: 'fungus', offset: 'none', tags: ['saplings'] });
  cross('crimson_roots', { map: 'nether', sound: 'roots', replaceable: true });
  cross('warped_roots', { map: 'color_cyan', sound: 'roots', replaceable: true });
  cross('nether_sprouts', { map: 'color_cyan', sound: 'nether_sprouts', replaceable: true, drops: 'none' });
  for (const n of ['crimson_fungus', 'warped_fungus', 'crimson_roots', 'warped_roots']) pottedPlant(`potted_${n}`, n);

  // Hay, sponges, dried kelp, froglights, honeycomb etc.
  reg('hay_block', [P.axis], { hardness: 0.5, tool: 'hoe', sound: 'grass', map: 'color_yellow', flammable: [60, 20], model: (s) => ({ kind: 'cube', ...colTex('hay_block_top', 'hay_block_side', s.get(P.axis)) }) });
  cube('dried_kelp_block', { hardness: 0.5, resistance: 2.5, tool: 'hoe', sound: 'grass', map: 'color_green', flammable: [30, 60], model: () => ({ kind: 'cube', tex: ['dried_kelp_top', 'dried_kelp_top', 'dried_kelp_side', 'dried_kelp_side', 'dried_kelp_side', 'dried_kelp_side'] }) });
  cube('sponge', { hardness: 0.6, tool: 'hoe', sound: 'sponge', map: 'color_yellow' });
  cube('wet_sponge', { hardness: 0.6, tool: 'hoe', sound: 'wet_sponge', map: 'color_yellow' });
  for (const f of ['ochre', 'verdant', 'pearlescent']) {
    reg(`${f}_froglight`, [P.axis], { hardness: 0.3, sound: 'froglight', map: 'sand', light: 15, model: (s) => ({ kind: 'cube', ...colTex(`${f}_froglight_top`, `${f}_froglight_side`, s.get(P.axis)) }) });
  }
}

function colTex(end: string, side: string, axis: string): { tex: [string, string, string, string, string, string]; rot?: number[] } {
  if (axis === 'y') return { tex: [end, end, side, side, side, side] };
  if (axis === 'x') return { tex: [side, side, side, side, end, end], rot: [90, 90, 90, 90, 0, 0] };
  return { tex: [side, side, end, end, side, side], rot: [0, 0, 0, 0, 90, 90] };
}

export { multiface };
