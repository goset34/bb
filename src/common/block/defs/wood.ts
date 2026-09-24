/** Wood families (logs, planks, leaves, saplings, carpentry) and nether stems. */
import {
  reg, cube, pillar, slab, stairs, fence, fenceGate, door, trapdoor, button, pressurePlate, leaves, sapling, signs,
  woodLike, P, Tint, Wave, shapeOf, model, crossElements, pottedPlant, BlockSettings,
} from './helpers';
import { cubeColumn } from '../model';

export const OVERWORLD_WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak'] as const;
export const NETHER_WOODS = ['crimson', 'warped'] as const;
export const ALL_WOODS = [...OVERWORLD_WOODS, 'bamboo', ...NETHER_WOODS] as const;

const LEAF_TINT: Record<string, Tint> = {
  oak: Tint.Foliage, spruce: Tint.Spruce, birch: Tint.Birch, jungle: Tint.Foliage, acacia: Tint.Foliage,
  dark_oak: Tint.Foliage, mangrove: Tint.Mangrove, cherry: Tint.None, pale_oak: Tint.None,
};

const WOOD_MAP: Record<string, string> = {
  oak: 'wood', spruce: 'podzol', birch: 'sand', jungle: 'dirt', acacia: 'color_orange', dark_oak: 'color_brown',
  mangrove: 'color_red', cherry: 'terracotta_white', pale_oak: 'quartz', bamboo: 'color_yellow', crimson: 'crimson_stem', warped: 'warped_stem',
};

function carpentry(w: string, planks: string, base: BlockSettings, nether: boolean): void {
  const s: BlockSettings = { ...base, tags: [...(base.tags ?? []), nether ? 'non_flammable_wood' : 'wooden'] };
  stairs(`${w}_stairs`, planks, { ...s, tags: ['wooden_stairs'] });
  slab(`${w}_slab`, planks, { ...s, tags: ['wooden_slabs'] });
  fence(`${w}_fence`, planks, { ...s, tags: ['wooden_fences'] });
  fenceGate(`${w}_fence_gate`, planks, { ...s, tags: ['fence_gates'] });
  door(`${w}_door`, { ...s, hardness: 3, tags: ['wooden_doors'] });
  trapdoor(`${w}_trapdoor`, { ...s, hardness: 3, tags: ['wooden_trapdoors'] });
  button(`${w}_button`, planks, { ...s, hardness: 0.5, tags: ['wooden_buttons'], flammable: undefined });
  pressurePlate(`${w}_pressure_plate`, planks, { ...s, hardness: 0.5, tags: ['wooden_pressure_plates'] });
  signs(w, planks, { ...s, hardness: 1 });
}

export function registerWood(): void {
  for (const w of OVERWORLD_WOODS) {
    const map = WOOD_MAP[w]!;
    const base = woodLike(2, 3, { map, sound: w === 'cherry' ? 'cherry_wood' : 'wood' });
    cube(`${w}_planks`, { ...base, tags: ['planks'] });
    const logTags = ['logs', `${w}_logs`, 'logs_that_burn'];
    pillar(`${w}_log`, { ...base, tags: logTags }, `${w}_log_top`, `${w}_log`);
    pillar(`stripped_${w}_log`, { ...base, tags: logTags }, `stripped_${w}_log_top`, `stripped_${w}_log`);
    pillar(`${w}_wood`, { ...base, tags: logTags }, `${w}_log`, `${w}_log`);
    pillar(`stripped_${w}_wood`, { ...base, tags: logTags }, `stripped_${w}_log`, `stripped_${w}_log`);
    leaves(`${w}_leaves`, LEAF_TINT[w]!, w === 'cherry' ? { sound: 'cherry_leaves', map: 'color_pink' } : w === 'pale_oak' ? { map: 'color_gray' } : {});
    if (w === 'mangrove') {
      reg('mangrove_propagule', [P.age4, P.hanging, P.stage, P.waterlogged], {
        hardness: 0, collision: false, sound: 'grass', map: 'plant', layer: 'cutout', push: 'destroy', occludes: false, randomTicks: true,
        tags: ['saplings'], wave: Wave.PlantBottom,
        model: (s) => model(crossElements(s.get(P.hanging) ? `mangrove_propagule_hanging_${s.get(P.age4)}` : 'mangrove_propagule'), false),
        outline: (s) => (s.get(P.hanging) ? shapeOf([7, 3, 7, 9, 16, 9]) : shapeOf([7, 0, 7, 9, 12, 9])),
      });
    } else {
      sapling(`${w}_sapling`);
    }
    carpentry(w, `${w}_planks`, base, false);
  }
  // Mangrove roots
  reg('mangrove_roots', [P.waterlogged], {
    hardness: 0.7, tool: 'axe', sound: 'mangrove_roots', map: 'podzol', layer: 'cutout', occludes: false, flammable: [5, 20], opacity: 1,
    model: () => ({ kind: 'cube', tex: ['mangrove_roots_top', 'mangrove_roots_top', 'mangrove_roots_side', 'mangrove_roots_side', 'mangrove_roots_side', 'mangrove_roots_side'] }),
  });
  pillar('muddy_mangrove_roots', { hardness: 0.7, tool: 'shovel', sound: 'muddy_mangrove_roots', map: 'podzol' }, 'muddy_mangrove_roots_top', 'muddy_mangrove_roots_side');

  // Bamboo wood set
  const bamboo = woodLike(2, 3, { map: 'color_yellow', sound: 'bamboo_wood' });
  pillar('bamboo_block', { ...bamboo, tags: ['bamboo_blocks'] }, 'bamboo_block_top', 'bamboo_block');
  pillar('stripped_bamboo_block', { ...bamboo, tags: ['bamboo_blocks'] }, 'stripped_bamboo_block_top', 'stripped_bamboo_block');
  cube('bamboo_planks', { ...bamboo, tags: ['planks'] });
  cube('bamboo_mosaic', bamboo);
  stairs('bamboo_mosaic_stairs', 'bamboo_mosaic', bamboo);
  slab('bamboo_mosaic_slab', 'bamboo_mosaic', bamboo);
  carpentry('bamboo', 'bamboo_planks', bamboo, false);

  // Nether "woods"
  for (const w of NETHER_WOODS) {
    const base: BlockSettings = { hardness: 2, resistance: 3, tool: 'axe', sound: 'stem', map: WOOD_MAP[w]! };
    pillar(`${w}_stem`, { ...base, tags: ['logs', `${w}_stems`] }, `${w}_stem_top`, `${w}_stem`);
    pillar(`stripped_${w}_stem`, { ...base, tags: ['logs', `${w}_stems`] }, `stripped_${w}_stem_top`, `stripped_${w}_stem`);
    pillar(`${w}_hyphae`, { ...base, tags: ['logs', `${w}_stems`] }, `${w}_stem`, `${w}_stem`);
    pillar(`stripped_${w}_hyphae`, { ...base, tags: ['logs', `${w}_stems`] }, `stripped_${w}_stem`, `stripped_${w}_stem`);
    cube(`${w}_planks`, { ...base, sound: 'nether_wood', tags: ['planks', 'non_flammable_wood'] });
    carpentry(w, `${w}_planks`, { ...base, sound: 'nether_wood' }, true);
  }

  // Potted saplings
  for (const w of OVERWORLD_WOODS) {
    if (w === 'mangrove') pottedPlant('potted_mangrove_propagule', 'mangrove_propagule');
    else pottedPlant(`potted_${w}_sapling`, `${w}_sapling`);
  }

  // Groaner heart (pale garden)
  reg('groaner_heart', [P.axis, P.groanerState, P.natural], {
    hardness: 10, resistance: 10, tool: 'axe', sound: 'groaner_heart', map: 'color_orange', randomTicks: true, blockEntity: 'groaner_heart',
    model: (s) => {
      const st = s.get(P.groanerState);
      const suffix = st === 'awake' ? '_awake' : st === 'dormant' ? '_dormant' : '';
      return cubeColumn(`groaner_heart_top${suffix}`, `groaner_heart${suffix}`, s.get(P.axis));
    },
    light: () => 0,
  });
}
