/** Building blocks: prismarine, quartz, purpur, cinder bricks, blackstone, basalt, verge stone, copper, resin, sea blocks. */
import {
  reg, cube, cubeBT, pillar, slab, stairs, wall, fence, button, pressurePlate, door, trapdoor, stoneLike, metalLike, P,
  shapeOf, model, box, crossElements, BlockSettings, facingRot, rotateModel,
} from './helpers';
import { cubeTex, Element } from '../model';
import { paneElements, paneShape, lanternElements, lanternShape, torchElements, wallTorchElements } from '../shapes';
import { Direction, NORTH, SOUTH, WEST, EAST, UP, DOWN } from '../../world/direction';

export const OXIDATION = ['', 'exposed_', 'weathered_', 'oxidized_'] as const;
export const CORALS = ['tube', 'brain', 'bubble', 'fire', 'horn'] as const;

export function registerBuilding(): void {
  // ---- prismarine & ocean ---------------------------------------------------------------------
  cube('prismarine', stoneLike(1.5, 6, { map: 'color_cyan' }));
  cube('prismarine_bricks', stoneLike(1.5, 6, { map: 'diamond' }));
  cube('dark_prismarine', stoneLike(1.5, 6, { map: 'diamond' }));
  stairs('prismarine_stairs', 'prismarine', stoneLike(1.5, 6));
  slab('prismarine_slab', 'prismarine', stoneLike(1.5, 6));
  wall('prismarine_wall', 'prismarine', stoneLike(1.5, 6));
  stairs('prismarine_brick_stairs', 'prismarine_bricks', stoneLike(1.5, 6));
  slab('prismarine_brick_slab', 'prismarine_bricks', stoneLike(1.5, 6));
  stairs('dark_prismarine_stairs', 'dark_prismarine', stoneLike(1.5, 6));
  slab('dark_prismarine_slab', 'dark_prismarine', stoneLike(1.5, 6));
  cube('sea_lantern', { hardness: 0.3, sound: 'glass', map: 'quartz', light: 15, noDrops: false });

  // Coral
  for (const c of CORALS) {
    cube(`${c}_coral_block`, stoneLike(1.5, 6, { sound: 'coral_block', map: `color_${coralColor(c)}`, randomTicks: true, tags: ['coral_blocks'] }));
    cube(`dead_${c}_coral_block`, stoneLike(1.5, 6, { sound: 'stone', map: 'color_gray', tags: ['coral_blocks'] }));
  }
  for (const c of CORALS) {
    for (const dead of ['', 'dead_']) {
      const base: BlockSettings = { hardness: 0, collision: false, sound: dead ? 'stone' : 'coral', map: dead ? 'color_gray' : `color_${coralColor(c)}`, layer: 'cutout', push: 'destroy', occludes: false, randomTicks: !dead, requiresTool: !!dead, tool: 'pickaxe' };
      reg(`${dead}${c}_coral`, [P.waterlogged], { ...base, model: () => model(crossElements(`${dead}${c}_coral`), false), outline: () => shapeOf([2, 0, 2, 14, 15, 14]), tags: ['corals'] });
      reg(`${dead}${c}_coral_fan`, [P.waterlogged], {
        ...base,
        model: () => model(fanElements(`${dead}${c}_coral_fan`), false),
        outline: () => shapeOf([2, 0, 2, 14, 4, 14]), tags: ['corals'],
      });
      reg(`${dead}${c}_coral_wall_fan`, [P.facing, P.waterlogged], {
        ...base, noItem: true, itemId: `${dead}${c}_coral_fan`, drops: `${dead}${c}_coral_fan`,
        model: (s) => model(facingRot(wallFanElements(`${dead}${c}_coral_fan`), s.get(P.facing)), false),
        outline: (s) => {
          const f = s.get(P.facing);
          return f === NORTH ? shapeOf([0, 4, 5, 16, 12, 16]) : f === SOUTH ? shapeOf([0, 4, 0, 16, 12, 11]) : f === WEST ? shapeOf([5, 4, 0, 16, 12, 16]) : shapeOf([0, 4, 0, 11, 12, 16]);
        },
      });
    }
  }

  // ---- quartz ----------------------------------------------------------------------------------
  const q = stoneLike(0.8, 0.8, { map: 'quartz' });
  cubeBT('quartz_block', q, 'quartz_block_bottom', 'quartz_block_top', 'quartz_block_side');
  cubeBT('chiseled_quartz_block', q, 'chiseled_quartz_block_top', 'chiseled_quartz_block_top', 'chiseled_quartz_block');
  pillar('quartz_pillar', q, 'quartz_pillar_top', 'quartz_pillar');
  cube('quartz_bricks', q);
  cube('smooth_quartz', stoneLike(2, 6, { map: 'quartz' }), 'quartz_block_bottom');
  stairs('quartz_stairs', { top: 'quartz_block_top', bottom: 'quartz_block_bottom', side: 'quartz_block_side' }, q);
  slab('quartz_slab', { top: 'quartz_block_top', bottom: 'quartz_block_bottom', side: 'quartz_block_side' }, stoneLike(2, 6));
  stairs('smooth_quartz_stairs', 'quartz_block_bottom', stoneLike(2, 6));
  slab('smooth_quartz_slab', 'quartz_block_bottom', stoneLike(2, 6));

  // ---- purpur & verge stone --------------------------------------------------------------------
  cube('purpur_block', stoneLike(1.5, 6, { map: 'color_magenta' }));
  pillar('purpur_pillar', stoneLike(1.5, 6, { map: 'color_magenta' }), 'purpur_pillar_top', 'purpur_pillar');
  stairs('purpur_stairs', 'purpur_block', stoneLike(1.5, 6));
  slab('purpur_slab', 'purpur_block', stoneLike(2, 6));
  cube('verge_stone', stoneLike(3, 9, { map: 'sand' }));
  cube('verge_stone_bricks', stoneLike(3, 9, { map: 'sand' }));
  stairs('verge_stone_brick_stairs', 'verge_stone_bricks', stoneLike(3, 9));
  slab('verge_stone_brick_slab', 'verge_stone_bricks', stoneLike(3, 9));
  wall('verge_stone_brick_wall', 'verge_stone_bricks', stoneLike(3, 9));

  // ---- inferno building blocks -----------------------------------------------------------------
  const nb = stoneLike(2, 6, { map: 'nether', sound: 'nether_bricks' });
  cube('cinder_bricks', nb);
  cube('cracked_cinder_bricks', nb);
  cube('chiseled_cinder_bricks', nb);
  cube('red_cinder_bricks', nb);
  stairs('cinder_brick_stairs', 'cinder_bricks', nb);
  slab('cinder_brick_slab', 'cinder_bricks', nb);
  wall('cinder_brick_wall', 'cinder_bricks', nb);
  fence('cinder_brick_fence', 'cinder_bricks', nb);
  stairs('red_cinder_brick_stairs', 'red_cinder_bricks', nb);
  slab('red_cinder_brick_slab', 'red_cinder_bricks', nb);
  wall('red_cinder_brick_wall', 'red_cinder_bricks', nb);

  const bs = stoneLike(1.5, 6, { map: 'color_black' });
  cubeBT('blackstone', bs, 'blackstone_top', 'blackstone_top', 'blackstone');
  cube('gilded_blackstone', { ...bs, sound: 'gilded_blackstone' });
  cube('polished_blackstone', stoneLike(2, 6, { map: 'color_black' }));
  cube('polished_blackstone_bricks', bs);
  cube('cracked_polished_blackstone_bricks', bs);
  cube('chiseled_polished_blackstone', bs);
  stairs('blackstone_stairs', 'blackstone', bs);
  slab('blackstone_slab', 'blackstone', stoneLike(2, 6));
  wall('blackstone_wall', 'blackstone', bs);
  stairs('polished_blackstone_stairs', 'polished_blackstone', bs);
  slab('polished_blackstone_slab', 'polished_blackstone', stoneLike(2, 6));
  wall('polished_blackstone_wall', 'polished_blackstone', bs);
  button('polished_blackstone_button', 'polished_blackstone', { sound: 'stone' });
  pressurePlate('polished_blackstone_pressure_plate', 'polished_blackstone', { ...stoneLike(0.5, 0.5), collision: false });
  stairs('polished_blackstone_brick_stairs', 'polished_blackstone_bricks', bs);
  slab('polished_blackstone_brick_slab', 'polished_blackstone_bricks', stoneLike(2, 6));
  wall('polished_blackstone_brick_wall', 'polished_blackstone_bricks', bs);
  pillar('basalt', stoneLike(1.25, 4.2, { sound: 'basalt', map: 'color_black' }), 'basalt_top', 'basalt_side');
  pillar('polished_basalt', stoneLike(1.25, 4.2, { sound: 'basalt', map: 'color_black' }), 'polished_basalt_top', 'polished_basalt_side');
  cube('smooth_basalt', stoneLike(1.25, 4.2, { sound: 'basalt', map: 'color_black' }));

  // ---- resin (pale garden) ---------------------------------------------------------------------
  cube('resin_block', { hardness: 0, sound: 'resin', map: 'terracotta_orange' });
  cube('resin_bricks', stoneLike(1.5, 6, { sound: 'resin_bricks', map: 'terracotta_orange' }));
  cube('chiseled_resin_bricks', stoneLike(1.5, 6, { sound: 'resin_bricks', map: 'terracotta_orange' }));
  stairs('resin_brick_stairs', 'resin_bricks', stoneLike(1.5, 6, { sound: 'resin_bricks' }));
  slab('resin_brick_slab', 'resin_bricks', stoneLike(1.5, 6, { sound: 'resin_bricks' }));
  wall('resin_brick_wall', 'resin_bricks', stoneLike(1.5, 6, { sound: 'resin_bricks' }));

  // ---- copper ----------------------------------------------------------------------------------
  for (const waxed of ['', 'waxed_']) {
    for (const ox of OXIDATION) {
      const pre = `${waxed}${ox}`;
      const tex = `${ox}copper`;
      const s = metalLike(3, 6, { tier: 1, sound: 'copper', map: ox ? `copper_${ox.slice(0, -1)}` : 'color_orange', randomTicks: !waxed && ox !== 'oxidized_', tags: ['copper'] });
      cube(`${pre}copper_block`.replace('copper_copper', 'copper'), s, tex === 'copper' ? 'copper_block' : tex);
      cube(`${pre}cut_copper`, s, `${ox}cut_copper`);
      cube(`${pre}chiseled_copper`, s, `${ox}chiseled_copper`);
      reg(`${pre}copper_grate`, [P.waterlogged], { ...s, layer: 'cutout', occludes: false, model: () => cubeTex(`${ox}copper_grate`) });
      stairs(`${pre}cut_copper_stairs`, `${ox}cut_copper`, s);
      slab(`${pre}cut_copper_slab`, `${ox}cut_copper`, s);
      door(`${pre}copper_door`, { ...s, tags: ['doors', 'copper_doors'] });
      trapdoor(`${pre}copper_trapdoor`, { ...s, tags: ['trapdoors'] });
      reg(`${pre}copper_bulb`, [P.lit, P.powered], {
        ...s, light: (st) => (st.get(P.lit) ? [15, 12, 8, 4][OXIDATION.indexOf(ox)]! : 0),
        model: (st) => cubeTex(`${ox}copper_bulb${st.get(P.lit) ? '_lit' : ''}${st.get(P.powered) ? '_powered' : ''}`),
      });
      // Copper age additions
      reg(`${pre}copper_bars`, [P.north, P.east, P.south, P.west, P.waterlogged], {
        ...s, layer: 'cutout', occludes: false, dynamicShape: true, tags: ['panes'],
        model: (st) => model(paneElements(`${ox}copper_bars`, `${ox}copper_bars`, st.get(P.north), st.get(P.east), st.get(P.south), st.get(P.west))),
        shape: (st) => paneShape(st.get(P.north), st.get(P.east), st.get(P.south), st.get(P.west)),
      });
      chain(`${pre}copper_chain`, `${ox}copper_chain`, s);
      reg(`${pre}copper_lantern`, [P.hanging, P.waterlogged], {
        ...s, hardness: 3.5, layer: 'cutout', occludes: false, light: 15, push: 'destroy',
        model: (st) => model(lanternElements(`${ox}copper_lantern`, st.get(P.hanging))),
        shape: (st) => lanternShape(st.get(P.hanging)),
      });
      reg(`${pre}copper_chest`, [P.facing, P.chestType, P.waterlogged], {
        ...s, occludes: false, blockEntity: 'chest', tags: ['chests', 'copper_chests'],
        model: (st) => model(chestModel(`${ox}copper_chest`, st.get(P.chestType), st.get(P.facing))),
        shape: () => shapeOf([1, 0, 1, 15, 14, 15]),
      });
      reg(`${pre}lightning_rod`, [P.facing6, P.powered, P.waterlogged], {
        ...s, layer: 'cutout', occludes: false,
        model: (st) => {
          const f = st.get(P.facing6);
          const t = `${ox}lightning_rod${st.get(P.powered) ? '_on' : ''}`;
          const els = [box([6, 12, 6], [10, 16, 10], t, { cullEdges: false }), box([7, 0, 7], [9, 12, 9], t, { cullEdges: false })];
          const rx = f === UP ? 0 : f === DOWN ? 180 : 90;
          const ry = f === NORTH ? 0 : f === EAST ? 90 : f === SOUTH ? 180 : f === WEST ? 270 : 0;
          return model(rotateModel(els, rx, ry));
        },
      });
    }
  }
  reg('copper_torch', [], { hardness: 0, collision: false, sound: 'wood', light: 14, layer: 'cutout', push: 'destroy', occludes: false, model: () => model(torchElements('copper_torch')), outline: () => shapeOf([6, 0, 6, 10, 10, 10]) });
  reg('copper_wall_torch', [P.facing], { hardness: 0, collision: false, sound: 'wood', light: 14, layer: 'cutout', push: 'destroy', occludes: false, noItem: true, itemId: 'copper_torch', drops: 'copper_torch', model: (s) => model(wallTorchElements('copper_torch', s.get(P.facing))) });

  // ---- misc building ---------------------------------------------------------------------------
  cube('honeycomb_block', { hardness: 0.6, sound: 'coral', map: 'color_orange' });
  reg('honey_block', [], {
    hardness: 0, sound: 'honey', map: 'color_orange', layer: 'translucent', occludes: false, speedFactor: 0.4, jumpFactor: 0.5, opacity: 1,
    model: () => model([
      box([1, 0, 1], [15, 15, 15], { 0: 'honey_block_bottom', 1: 'honey_block_top', 2: 'honey_block_side', 3: 'honey_block_side', 4: 'honey_block_side', 5: 'honey_block_side' }, { cullEdges: false }),
      box([0, 0, 0], [16, 16, 16], { 0: 'honey_block_bottom', 1: 'honey_block_top', 2: 'honey_block_side', 3: 'honey_block_side', 4: 'honey_block_side', 5: 'honey_block_side' }),
    ]),
    shape: () => shapeOf([1, 0, 1, 15, 15, 15]),
    solid: true,
  });
  reg('slime_block', [], {
    hardness: 0, sound: 'slime', map: 'grass', layer: 'translucent', occludes: false, friction: 0.8, opacity: 1,
    model: () => model([box([3, 3, 3], [13, 13, 13], 'slime_block', { cullEdges: false }), box([0, 0, 0], [16, 16, 16], 'slime_block')]),
    shape: () => shapeOf([0, 0, 0, 16, 16, 16]),
    solid: true,
  });
  cube('bookshelf', { ...woodLike2(), model: () => ({ kind: 'cube', tex: ['oak_planks', 'oak_planks', 'bookshelf', 'bookshelf', 'bookshelf', 'bookshelf'] }) });
  reg('iron_bars', [P.north, P.east, P.south, P.west, P.waterlogged], {
    ...metalLike(5, 6, { tier: 0 }), layer: 'cutout', occludes: false, dynamicShape: true, tags: ['panes'],
    model: (st) => model(paneElements('iron_bars', 'iron_bars', st.get(P.north), st.get(P.east), st.get(P.south), st.get(P.west))),
    shape: (st) => paneShape(st.get(P.north), st.get(P.east), st.get(P.south), st.get(P.west)),
  });
  chain('chain', 'chain', metalLike(5, 6, { tier: 0, sound: 'chain' }));
  door('iron_door', metalLike(5, 5, { tier: 0 }));
  trapdoor('iron_trapdoor', metalLike(5, 5, { tier: 0 }));
  pressurePlate('light_weighted_pressure_plate', 'gold_block', { ...metalLike(0.5, 0.5, { tier: 0 }), collision: false }, true);
  pressurePlate('heavy_weighted_pressure_plate', 'iron_block', { ...metalLike(0.5, 0.5, { tier: 0 }), collision: false }, true);
}

function woodLike2(): BlockSettings {
  return { hardness: 1.5, tool: 'axe', sound: 'wood', map: 'wood', flammable: [30, 20] };
}

function chain(name: string, tex: string, s: BlockSettings): void {
  reg(name, [P.axis, P.waterlogged], {
    ...s, layer: 'cutout', occludes: false,
    model: (st) => {
      const els: Element[] = [
        { from: [6.5, 0, 8], to: [9.5, 16, 8], shade: false, rot: { axis: 1, angle: 45, origin: [8, 8, 8] }, faces: { 2: { tex, uv: [0, 0, 3, 16] }, 3: { tex, uv: [0, 0, 3, 16] } } },
        { from: [8, 0, 6.5], to: [8, 16, 9.5], shade: false, rot: { axis: 1, angle: 45, origin: [8, 8, 8] }, faces: { 4: { tex, uv: [3, 0, 6, 16] }, 5: { tex, uv: [3, 0, 6, 16] } } },
      ];
      const a = st.get(P.axis);
      return model(a === 'y' ? els : a === 'x' ? rotateModel(els, 90, 90) : rotateModel(els, 90, 0), false);
    },
    shape: (st) => {
      const a = st.get(P.axis);
      return a === 'y' ? shapeOf([6.5, 0, 6.5, 9.5, 16, 9.5]) : a === 'x' ? shapeOf([0, 6.5, 6.5, 16, 9.5, 9.5]) : shapeOf([6.5, 6.5, 0, 9.5, 9.5, 16]);
    },
  });
}

function chestModel(tex: string, type: string, facing: Direction): Element[] {
  let x0 = 1, x1 = 15;
  if (type === 'left') x1 = 16;
  if (type === 'right') x0 = 0;
  const els: Element[] = [
    box([x0, 0, 1], [x1, 14, 15], { 0: `${tex}_top`, 1: `${tex}_top`, 2: `${tex}_front`, 3: `${tex}_side`, 4: `${tex}_side`, 5: `${tex}_side` }, { cullEdges: false }),
  ];
  if (type === 'single') els.push(box([7, 7, 0], [9, 11, 1], 'chest_lock', { cullEdges: false }));
  return facingRot(els, facing);
}

export { chestModel };

function coralColor(c: string): string {
  return c === 'tube' ? 'blue' : c === 'brain' ? 'pink' : c === 'bubble' ? 'purple' : c === 'fire' ? 'red' : 'yellow';
}

function fanElements(tex: string): Element[] {
  const f = (axis: 0 | 2, angle: number, from: [number, number, number], to: [number, number, number]): Element => ({
    from, to, shade: false, rot: { axis, angle, origin: [8, 0, 8] },
    faces: axis === 0 ? { 1: { tex, uv: [3, 8, 11, 16] }, 0: { tex, uv: [3, 8, 11, 16] } } : { 1: { tex, uv: [3, 8, 11, 16] }, 0: { tex, uv: [3, 8, 11, 16] } },
  });
  return [
    f(0, 22.5, [8, 0, 0], [8, 8, 16]),
    f(0, -22.5, [8, 0, 0], [8, 8, 16]),
    f(2, 22.5, [0, 0, 8], [16, 8, 8]),
    f(2, -22.5, [0, 0, 8], [16, 8, 8]),
  ].map((e, i) => {
    // planes lying along one axis tilted outward
    if (i < 2) e.faces = { 4: { tex }, 5: { tex } };
    else e.faces = { 2: { tex }, 3: { tex } };
    return e;
  });
}

function wallFanElements(tex: string): Element[] {
  const leaf = (angle: number): Element => ({
    from: [0, 8, 8], to: [16, 8, 16], shade: false,
    rot: { axis: 0, angle, origin: [8, 8, 16] },
    faces: { 1: { tex, uv: [0, 8, 16, 16] }, 0: { tex, uv: [0, 8, 16, 16] } },
  });
  return [leaf(-22.5), leaf(22.5)];
}
