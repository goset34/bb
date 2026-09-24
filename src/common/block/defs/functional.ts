/** Functional blocks: workstations, containers, flux (redstone) components, rails, portals, fire, heads, technical. */
import {
  reg, cube, cubeBT, horizontalFacing, stoneLike, metalLike, woodLike, P, shapeOf, model, box, crossElements,
  facingRot, rotateModel, BlockSettings, directional6, cubeDir6,
} from './helpers';
import { cubeTex, cubeOrientable, Element, Tint } from '../model';
import {
  torchElements, wallTorchElements, lanternElements, lanternShape, leverElements, attachRotation, AttachFace, railElements,
  wireElements, wireShape, repeaterElements, comparatorElements, ladderElements, ladderShape, chestElements, chestShape,
} from '../shapes';
import { Direction, NORTH, SOUTH, WEST, EAST, UP, DOWN } from '../../world/direction';

export function registerFunctional(): void {
  // ---- workstations ----------------------------------------------------------------------------
  reg('crafting_table', [], { ...woodLike(2.5, 2.5), model: () => ({ kind: 'cube', tex: ['oak_planks', 'crafting_table_top', 'crafting_table_front', 'crafting_table_side', 'crafting_table_side', 'crafting_table_front'] }) });
  for (const [n, top] of [['furnace', 'furnace_top'], ['blast_furnace', 'blast_furnace_top'], ['smoker', 'smoker_top']] as const) {
    reg(n, [P.facing, P.lit], {
      ...stoneLike(3.5, 3.5), blockEntity: n, light: (s) => (s.get(P.lit) ? 13 : 0),
      model: (s) => {
        const r = cubeOrientable(s.get(P.facing), s.get(P.lit) ? `${n}_front_on` : `${n}_front`, `${n}_side`, top, n === 'smoker' ? 'smoker_bottom' : top);
        if (r.kind === 'cube' && s.get(P.lit)) r.emissive = [0, 1, 2, 3, 4, 5].map((d) => d === s.get(P.facing));
        return r;
      },
    });
  }
  reg('chest', [P.facing, P.chestType, P.waterlogged], { ...woodLike(2.5, 2.5), flammable: undefined, occludes: false, blockEntity: 'chest', tags: ['chests'], model: (s) => model(chestElements('chest', s.get(P.chestType), s.get(P.facing))), shape: (s) => chestShape(s.get(P.chestType), s.get(P.facing)) });
  reg('trapped_chest', [P.facing, P.chestType, P.waterlogged], { ...woodLike(2.5, 2.5), flammable: undefined, occludes: false, blockEntity: 'chest', tags: ['chests'], model: (s) => model(chestElements('trapped_chest', s.get(P.chestType), s.get(P.facing))), shape: (s) => chestShape(s.get(P.chestType), s.get(P.facing)) });
  reg('void_chest', [P.facing, P.waterlogged], { ...stoneLike(22.5, 600), light: 7, occludes: false, blockEntity: 'void_chest', drops: 'obsidian', model: (s) => model(chestElements('void_chest', 'single', s.get(P.facing))), shape: () => shapeOf([1, 0, 1, 15, 14, 15]) });
  reg('barrel', [P.facing6, P.open], { ...woodLike(2.5, 2.5), blockEntity: 'barrel', model: (s) => cubeDir6(s.get(P.facing6), s.get(P.open) ? 'barrel_top_open' : 'barrel_top', 'barrel_bottom', 'barrel_side') });
  reg('enchanting_table', [], { ...stoneLike(5, 1200, { map: 'color_red' }), light: 7, occludes: false, blockEntity: 'enchanting_table', model: () => model([box([0, 0, 0], [16, 12, 16], { 0: 'enchanting_table_bottom', 1: 'enchanting_table_top', 2: 'enchanting_table_side', 3: 'enchanting_table_side', 4: 'enchanting_table_side', 5: 'enchanting_table_side' })]) });
  for (const n of ['anvil', 'chipped_anvil', 'damaged_anvil']) {
    reg(n, [P.facing], {
      ...metalLike(5, 1200, { sound: 'anvil', tier: 0, tags: ['anvil', 'falling'] }), occludes: false,
      model: (s) => {
        const top = `${n}_top`;
        const els = [
          box([2, 0, 2], [14, 4, 14], 'anvil', { cullEdges: false }),
          box([4, 4, 3], [12, 5, 13], 'anvil', { cullEdges: false }),
          box([6, 5, 4], [10, 10, 12], 'anvil', { cullEdges: false }),
          box([3, 10, 0], [13, 16, 16], { 0: 'anvil', 1: top, 2: 'anvil', 3: 'anvil', 4: 'anvil', 5: 'anvil' }, { cullEdges: false }),
        ];
        return model(rotateModel(els, 0, s.get(P.facing) === NORTH || s.get(P.facing) === SOUTH ? 90 : 0));
      },
      shape: (s) => (s.get(P.facing) === NORTH || s.get(P.facing) === SOUTH ? shapeOf([2, 0, 2, 14, 4, 14], [4, 4, 3, 12, 5, 13], [6, 5, 4, 10, 10, 12], [0, 10, 3, 16, 16, 13]) : shapeOf([2, 0, 2, 14, 4, 14], [3, 4, 4, 13, 5, 12], [4, 5, 6, 12, 10, 10], [3, 10, 0, 13, 16, 16])),
    });
  }
  reg('brewing_stand', [P.hasBottle0, P.hasBottle1, P.hasBottle2], {
    ...metalLike(0.5, 0.5, { tier: 0, sound: 'metal' }), layer: 'cutout', occludes: false, light: 1, blockEntity: 'brewing_stand',
    model: () => model([
      box([7, 0, 7], [9, 14, 9], 'brewing_stand', { cullEdges: false }),
      box([9, 0, 5], [15, 2, 11], 'brewing_stand_base', { cullEdges: false }),
      box([2, 0, 1], [8, 2, 7], 'brewing_stand_base', { cullEdges: false }),
      box([2, 0, 9], [8, 2, 15], 'brewing_stand_base', { cullEdges: false }),
      ...crossElements('brewing_stand'),
    ]),
    shape: () => shapeOf([1, 0, 1, 15, 2, 15], [7, 0, 7, 9, 14, 9]),
  });
  reg('cauldron', [], { ...stoneLike(2, 2), occludes: false, model: () => model(cauldronElements(null, 0)), shape: () => cauldronShape() });
  reg('water_cauldron', [P.cauldronLevel], { ...stoneLike(2, 2), occludes: false, drops: 'cauldron', itemId: 'cauldron', noItem: true, model: (s) => model(cauldronElements('water_still', s.get(P.cauldronLevel))), shape: () => cauldronShape() });
  reg('lava_cauldron', [], { ...stoneLike(2, 2), occludes: false, light: 15, drops: 'cauldron', itemId: 'cauldron', noItem: true, model: () => model(cauldronElements('lava_still', 3)), shape: () => cauldronShape() });
  reg('powder_snow_cauldron', [P.cauldronLevel], { ...stoneLike(2, 2), occludes: false, drops: 'cauldron', itemId: 'cauldron', noItem: true, model: (s) => model(cauldronElements('powder_snow', s.get(P.cauldronLevel))), shape: () => cauldronShape() });
  reg('grindstone', [P.attachFace, P.facing], {
    ...stoneLike(2, 6, { tier: 0 }), occludes: false,
    model: (s) => {
      const els = [
        box([4, 4, 2], [12, 16, 14], { 0: 'grindstone_round', 1: 'grindstone_round', 2: 'grindstone_side', 3: 'grindstone_side', 4: 'grindstone_pivot', 5: 'grindstone_pivot' }, { cullEdges: false }),
        box([2, 0, 6], [4, 7, 10], 'dark_oak_log', { cullEdges: false }), box([12, 0, 6], [14, 7, 10], 'dark_oak_log', { cullEdges: false }),
        box([2, 7, 5], [4, 13, 11], 'grindstone_pivot', { cullEdges: false }), box([12, 7, 5], [14, 13, 11], 'grindstone_pivot', { cullEdges: false }),
      ];
      const [x, y] = attachRotation(s.get(P.attachFace) as AttachFace, s.get(P.facing));
      return model(rotateModel(els, x, y));
    },
  });
  reg('smithing_table', [], { ...woodLike(2.5, 2.5), model: () => ({ kind: 'cube', tex: ['smithing_table_bottom', 'smithing_table_top', 'smithing_table_front', 'smithing_table_front', 'smithing_table_side', 'smithing_table_side'] }) });
  reg('fletching_table', [], { ...woodLike(2.5, 2.5), model: () => ({ kind: 'cube', tex: ['birch_planks', 'fletching_table_top', 'fletching_table_front', 'fletching_table_front', 'fletching_table_side', 'fletching_table_side'] }) });
  reg('cartography_table', [], { ...woodLike(2.5, 2.5), model: () => ({ kind: 'cube', tex: ['dark_oak_planks', 'cartography_table_top', 'cartography_table_side3', 'cartography_table_side1', 'cartography_table_side2', 'cartography_table_side3'] }) });
  horizontalFacing('loom', woodLike(2.5, 2.5), 'loom_front', 'loom_side', 'loom_top', 'loom_bottom');
  reg('stonecutter', [P.facing], {
    ...stoneLike(3.5, 3.5), occludes: false,
    model: (s) => model(facingRot([
      box([0, 0, 0], [16, 9, 16], { 0: 'stonecutter_bottom', 1: 'stonecutter_top', 2: 'stonecutter_side', 3: 'stonecutter_side', 4: 'stonecutter_side', 5: 'stonecutter_side' }),
      { from: [1, 9, 8], to: [15, 16, 8], shade: false, faces: { 2: { tex: 'stonecutter_saw', uv: [1, 9, 15, 16] }, 3: { tex: 'stonecutter_saw', uv: [15, 9, 1, 16] } } } as Element,
    ], s.get(P.facing))),
    shape: () => shapeOf([0, 0, 0, 16, 9, 16]),
  });
  reg('composter', [P.composterLevel], {
    ...woodLike(0.6, 0.6), occludes: false,
    model: (s) => {
      const lv = s.get(P.composterLevel);
      const els: Element[] = [
        box([0, 0, 0], [16, 2, 16], { 0: 'composter_bottom', 1: 'composter_bottom', 2: 'composter_side', 3: 'composter_side', 4: 'composter_side', 5: 'composter_side' }),
        box([0, 2, 0], [2, 16, 16], { 1: 'composter_top', 2: 'composter_side', 3: 'composter_side', 4: 'composter_side', 5: 'composter_side' }),
        box([14, 2, 0], [16, 16, 16], { 1: 'composter_top', 2: 'composter_side', 3: 'composter_side', 4: 'composter_side', 5: 'composter_side' }),
        box([2, 2, 0], [14, 16, 2], { 1: 'composter_top', 2: 'composter_side', 3: 'composter_side' }),
        box([2, 2, 14], [14, 16, 16], { 1: 'composter_top', 2: 'composter_side', 3: 'composter_side' }),
      ];
      if (lv > 0) els.push(box([2, 2, 2], [14, lv === 8 ? 15 : 1 + lv * 2, 14], { 1: lv === 8 ? 'composter_ready' : 'composter_compost' }, { cullEdges: false }));
      return model(els);
    },
    shape: () => shapeOf([0, 0, 0, 16, 2, 16], [0, 0, 0, 2, 16, 16], [14, 0, 0, 16, 16, 16], [0, 0, 0, 16, 16, 2], [0, 0, 14, 16, 16, 16]),
  });
  reg('lectern', [P.facing, P.powered, P.hasBook], {
    ...woodLike(2.5, 2.5), occludes: false, blockEntity: 'lectern',
    model: (s) => {
      const els: Element[] = [
        box([0, 0, 0], [16, 2, 16], { 0: 'oak_planks', 1: 'lectern_base', 2: 'lectern_base', 3: 'lectern_base', 4: 'lectern_base', 5: 'lectern_base' }),
        box([4, 2, 4], [12, 15, 12], { 2: 'lectern_front', 3: 'lectern_front', 4: 'lectern_sides', 5: 'lectern_sides' }, { cullEdges: false }),
        { ...box([0, 12, 3], [16, 16, 13], { 1: 'lectern_top', 0: 'oak_planks', 2: 'lectern_sides', 3: 'lectern_sides', 4: 'lectern_sides', 5: 'lectern_sides' }, { cullEdges: false }), rot: { axis: 0, angle: -22.5, origin: [8, 14, 8] } },
      ];
      if (s.get(P.hasBook)) els.push({ ...box([2, 16, 4], [14, 17, 12], 'book_pages', { cullEdges: false }), rot: { axis: 0, angle: -22.5, origin: [8, 14, 8] } });
      return model(facingRot(els, s.get(P.facing)));
    },
    shape: () => shapeOf([0, 0, 0, 16, 2, 16], [4, 2, 4, 12, 14, 12]),
  });
  reg('bell', [P.facing, P.bellAttachment, P.powered], {
    ...metalLike(5, 5, { tier: 0, map: 'gold', sound: 'anvil' }), occludes: false, blockEntity: 'bell',
    model: (s) => {
      const att = s.get(P.bellAttachment);
      const els: Element[] = [box([5, 6, 5], [11, 13, 11], 'bell_body', { cullEdges: false }), box([4, 4, 4], [12, 6, 12], 'bell_body', { cullEdges: false })];
      if (att === 'floor') els.push(box([2, 0, 7], [4, 16, 9], 'dark_oak_planks', { cullEdges: false }), box([12, 0, 7], [14, 16, 9], 'dark_oak_planks', { cullEdges: false }), box([4, 13, 7], [12, 15, 9], 'stone', { cullEdges: false }));
      else if (att === 'ceiling') els.push(box([7, 13, 7], [9, 16, 9], 'stone', { cullEdges: false }));
      else if (att === 'single_wall') els.push(box([7, 13, 2], [9, 15, 16], 'stone', { cullEdges: false }));
      else els.push(box([7, 13, 0], [9, 15, 16], 'stone', { cullEdges: false }));
      return model(facingRot(els, s.get(P.facing)));
    },
    shape: () => shapeOf([4, 4, 4, 12, 16, 12]),
  });
  for (const [n, fireTex, light] of [['campfire', 'campfire_fire', 15], ['soul_campfire', 'soul_campfire_fire', 10]] as const) {
    reg(n, [P.facing, P.lit, P.signalFire, P.waterlogged], {
      ...woodLike(2, 2), occludes: false, blockEntity: 'campfire', light: (s) => (s.get(P.lit) ? light : 0), hot: true,
      model: (s) => {
        const logs: Element[] = [
          box([1, 0, 0], [5, 4, 16], { 0: 'campfire_log', 1: 'campfire_log', 2: 'campfire_log', 3: 'campfire_log', 4: 'campfire_log', 5: 'campfire_log' }, { cullEdges: false }),
          box([11, 0, 0], [15, 4, 16], 'campfire_log', { cullEdges: false }),
          box([0, 3, 1], [16, 7, 5], 'campfire_log', { cullEdges: false }),
          box([0, 3, 11], [16, 7, 15], 'campfire_log', { cullEdges: false }),
          box([5, 0, 0], [11, 1, 16], s.get(P.lit) ? 'campfire_log_lit' : 'campfire_log', { cullEdges: false, emissive: s.get(P.lit) }),
        ];
        if (s.get(P.lit)) logs.push(...crossElements(fireTex, Tint.None, 16, true));
        return model(facingRot(logs, s.get(P.facing)));
      },
      shape: () => shapeOf([0, 0, 0, 16, 7, 16]),
    });
  }
  reg('beacon', [], {
    hardness: 3, sound: 'glass', map: 'diamond', light: 15, layer: 'translucent', occludes: false, blockEntity: 'beacon',
    model: () => model([
      box([0, 0, 0], [16, 16, 16], 'glass'),
      box([2, 0.1, 2], [14, 3, 14], 'obsidian', { cullEdges: false }),
      box([3, 3, 3], [13, 14, 13], 'beacon', { cullEdges: false, emissive: true }),
    ]),
    shape: () => shapeOf([0, 0, 0, 16, 16, 16]),
    solid: true,
  });
  reg('conduit', [P.waterlogged], { hardness: 3, sound: 'glass', map: 'diamond', light: 15, occludes: false, blockEntity: 'conduit', model: () => model([box([5, 5, 5], [11, 11, 11], 'conduit', { cullEdges: false })]) });
  cubeBT('lodestone', stoneLike(3.5, 3.5, { tier: 0, sound: 'lodestone', map: 'metal' }), 'lodestone_top', 'lodestone_top', 'lodestone_side');
  reg('respawn_anchor', [P.charges], { ...stoneLike(50, 1200, { tier: 3, map: 'color_black' }), light: (s) => [0, 3, 7, 11, 15][s.get(P.charges)]!, model: (s) => ({ kind: 'cube', tex: ['respawn_anchor_bottom', `respawn_anchor_top${s.get(P.charges) > 0 ? '' : '_off'}`, `respawn_anchor_side${s.get(P.charges)}`, `respawn_anchor_side${s.get(P.charges)}`, `respawn_anchor_side${s.get(P.charges)}`, `respawn_anchor_side${s.get(P.charges)}`] }) });
  reg('chiseled_bookshelf', [P.facing, P.slot0, P.slot1, P.slot2, P.slot3, P.slot4, P.slot5], {
    ...woodLike(1.5, 1.5), blockEntity: 'chiseled_bookshelf',
    model: (s) => {
      const t: [string, string, string, string, string, string] = ['chiseled_bookshelf_top', 'chiseled_bookshelf_top', 'chiseled_bookshelf_side', 'chiseled_bookshelf_side', 'chiseled_bookshelf_side', 'chiseled_bookshelf_side'];
      const filled = [P.slot0, P.slot1, P.slot2, P.slot3, P.slot4, P.slot5].filter((p) => s.get(p)).length;
      t[s.get(P.facing)] = filled === 0 ? 'chiseled_bookshelf_empty' : filled >= 6 ? 'chiseled_bookshelf_occupied' : `chiseled_bookshelf_occupied_${Math.min(5, filled)}`;
      return { kind: 'cube', tex: t };
    },
  });
  reg('jukebox', [P.hasRecord], { ...woodLike(2, 6), blockEntity: 'jukebox', model: () => ({ kind: 'cube', tex: ['jukebox_side', 'jukebox_top', 'jukebox_side', 'jukebox_side', 'jukebox_side', 'jukebox_side'] }) });
  reg('note_block', [P.instrument, P.note, P.powered], { ...woodLike(0.8, 0.8), model: () => cubeTex('note_block') });
  for (const n of ['beehive', 'bee_nest']) {
    reg(n, [P.facing, P.honeyLevel], {
      ...woodLike(n === 'bee_nest' ? 0.3 : 0.6, 0.6), blockEntity: 'beehive', tags: ['beehives'],
      model: (s) => {
        const t: [string, string, string, string, string, string] = [`${n}_bottom`, `${n}_top`, `${n}_side`, `${n}_side`, `${n}_side`, `${n}_side`];
        t[s.get(P.facing)] = s.get(P.honeyLevel) === 5 ? `${n}_front_honey` : `${n}_front`;
        return { kind: 'cube', tex: t };
      },
    });
  }
  reg('spawner', [], { ...stoneLike(5, 5, { tier: 0 }), layer: 'cutout', occludes: false, blockEntity: 'spawner', noDrops: true, model: () => model([box([0, 0, 0], [16, 16, 16], 'spawner'), box([0.1, 0.1, 0.1], [15.9, 15.9, 15.9], 'spawner', { cullEdges: false })]) });
  reg('trial_spawner', [P.trialState, P.ominous], {
    ...stoneLike(50, 50, { tier: 0, sound: 'trial_spawner' }), layer: 'cutout', occludes: false, blockEntity: 'trial_spawner', noDrops: true,
    light: (s) => (s.get(P.trialState) === 'inactive' || s.get(P.trialState) === 'cooldown' ? 4 : 8),
    model: (s) => {
      const o = s.get(P.ominous) ? '_ominous' : '';
      const st = s.get(P.trialState);
      const side = st === 'inactive' || st === 'cooldown' ? `trial_spawner_side_inactive${o}` : `trial_spawner_side_active${o}`;
      return model([box([0, 0, 0], [16, 16, 16], { 0: 'trial_spawner_bottom', 1: `trial_spawner_top${st === 'inactive' ? '_inactive' : ''}${o}`, 2: side, 3: side, 4: side, 5: side })]);
    },
  });
  reg('vault', [P.facing, P.vaultState, P.ominous], {
    ...stoneLike(50, 50, { tier: 0, sound: 'vault' }), layer: 'cutout', occludes: false, blockEntity: 'vault', noDrops: true,
    light: (s) => (s.get(P.vaultState) === 'inactive' ? 6 : 12),
    model: (s) => {
      const o = s.get(P.ominous) ? '_ominous' : '';
      const on = s.get(P.vaultState) !== 'inactive' ? '_on' : '';
      const t: [string, string, string, string, string, string] = [`vault_bottom${o}`, `vault_top${o}`, `vault_side${on}${o}`, `vault_side${on}${o}`, `vault_side${on}${o}`, `vault_side${on}${o}`];
      t[s.get(P.facing)] = `vault_front${on}${o}`;
      return { kind: 'cube', tex: t };
    },
  });
  reg('decorated_pot', [P.facing, P.cracked, P.waterlogged], {
    hardness: 0, sound: 'decorated_pot', map: 'terracotta_red', occludes: false, blockEntity: 'decorated_pot', push: 'destroy',
    model: (s) => model(facingRot([box([1, 0, 1], [15, 16, 15], { 0: 'decorated_pot_base', 1: 'decorated_pot_base', 2: 'decorated_pot_side', 3: 'decorated_pot_side', 4: 'decorated_pot_side', 5: 'decorated_pot_side' }, { cullEdges: false }), box([4, 16, 4], [12, 20, 12], 'decorated_pot_side', { cullEdges: false })], s.get(P.facing))),
    shape: () => shapeOf([1, 0, 1, 15, 16, 15]),
  });
  reg('scaffolding', [P.distance7, P.mossyBottom, P.waterlogged], {
    hardness: 0, sound: 'scaffolding', map: 'sand', layer: 'cutout', occludes: false, tags: ['climbable'], push: 'destroy',
    model: (s) => model([
      box([0, 15.99, 0], [16, 16, 16], { 1: 'scaffolding_top', 0: 'scaffolding_bottom' }),
      box([0, 0, 0], [2, 16, 2], 'scaffolding_side', { cullEdges: false }), box([14, 0, 0], [16, 16, 2], 'scaffolding_side', { cullEdges: false }),
      box([0, 0, 14], [2, 16, 16], 'scaffolding_side', { cullEdges: false }), box([14, 0, 14], [16, 16, 16], 'scaffolding_side', { cullEdges: false }),
      ...(s.get(P.mossyBottom) ? [box([0, 0, 0], [16, 2, 16], 'scaffolding_bottom', { cullEdges: false })] : []),
    ]),
    shape: () => shapeOf([0, 14, 0, 16, 16, 16]),
    outline: () => shapeOf([0, 0, 0, 16, 16, 16]),
  });
  reg('ladder', [P.facing, P.waterlogged], { hardness: 0.4, tool: 'axe', sound: 'ladder', map: 'none', layer: 'cutout', occludes: false, push: 'destroy', tags: ['climbable'], model: (s) => model(ladderElements('ladder', s.get(P.facing)), false), shape: (s) => ladderShape(s.get(P.facing)) });
  const torchSet = (name: string, wallName: string, tex: string, light: number, extra: BlockSettings = {}) => {
    reg(name, [], { hardness: 0, collision: false, sound: 'wood', light, layer: 'cutout', push: 'destroy', occludes: false, fluidBreaks: true, ...extra, model: () => model(torchElements(tex)), outline: () => shapeOf([6, 0, 6, 10, 10, 10]) });
    reg(wallName, [P.facing], {
      hardness: 0, collision: false, sound: 'wood', light, layer: 'cutout', push: 'destroy', occludes: false, fluidBreaks: true, noItem: true, itemId: name, drops: name, ...extra,
      model: (s) => model(wallTorchElements(tex, s.get(P.facing))),
      outline: (s) => {
        const f = s.get(P.facing);
        return f === NORTH ? shapeOf([5.5, 3, 11, 10.5, 13, 16]) : f === SOUTH ? shapeOf([5.5, 3, 0, 10.5, 13, 5]) : f === WEST ? shapeOf([11, 3, 5.5, 16, 13, 10.5]) : shapeOf([0, 3, 5.5, 5, 13, 10.5]);
      },
    });
  };
  torchSet('torch', 'wall_torch', 'torch', 14);
  torchSet('soul_torch', 'soul_wall_torch', 'soul_torch', 10);
  for (const [n, light] of [['lantern', 15], ['soul_lantern', 10]] as const) {
    reg(n, [P.hanging, P.waterlogged], { ...metalLike(3.5, 3.5, { tier: 0, sound: 'lantern' }), layer: 'cutout', occludes: false, light, push: 'destroy', model: (s) => model(lanternElements(n, s.get(P.hanging))), shape: (s) => lanternShape(s.get(P.hanging)) });
  }
  reg('verge_rod', [P.facing6], {
    hardness: 0, sound: 'wood', light: 14, layer: 'cutout', occludes: false, push: 'normal',
    model: (s) => {
      const f = s.get(P.facing6);
      const els = [box([6, 0, 6], [10, 1, 10], 'verge_rod', { cullEdges: false, emissive: true }), box([7, 1, 7], [9, 16, 9], 'verge_rod', { cullEdges: false, emissive: true })];
      const rx = f === UP ? 0 : f === DOWN ? 180 : 90;
      const ry = f === NORTH ? 0 : f === EAST ? 90 : f === SOUTH ? 180 : f === WEST ? 270 : 0;
      return model(rotateModel(els, rx, ry));
    },
    shape: (s) => {
      const f = s.get(P.facing6);
      return f === UP || f === DOWN ? shapeOf([6, 0, 6, 10, 16, 10]) : f === NORTH || f === SOUTH ? shapeOf([6, 6, 0, 10, 10, 16]) : shapeOf([0, 6, 6, 16, 10, 10]);
    },
  });
  reg('flower_pot', [], { hardness: 0, sound: 'stone', map: 'none', layer: 'cutout', push: 'destroy', occludes: false, tags: ['flower_pots'], model: () => model(potOnly()), shape: () => shapeOf([5, 0, 5, 11, 6, 11]) });

  // ---- flux (redstone) components ---------------------------------------------------------------
  reg('flux_wire', [P.wireNorth, P.wireEast, P.wireSouth, P.wireWest, P.power], {
    hardness: 0, collision: false, sound: 'stone', map: 'fire', layer: 'cutout', push: 'destroy', occludes: false, noItem: true, itemId: 'flux_dust', drops: 'flux_dust', dynamicShape: true,
    model: (s) => model(wireElements([s.get(P.wireNorth), s.get(P.wireEast), s.get(P.wireSouth), s.get(P.wireWest)]), false),
    outline: () => wireShape(),
  });
  reg('flux_torch', [P.lit], { defaults: { lit: true }, hardness: 0, collision: false, sound: 'wood', light: (s) => (s.get(P.lit) ? 7 : 0), layer: 'cutout', push: 'destroy', occludes: false, model: (s) => model(torchElements(s.get(P.lit) ? 'flux_torch' : 'flux_torch_off')), outline: () => shapeOf([6, 0, 6, 10, 10, 10]) });
  reg('flux_wall_torch', [P.facing, P.lit], { defaults: { lit: true }, hardness: 0, collision: false, sound: 'wood', light: (s) => (s.get(P.lit) ? 7 : 0), layer: 'cutout', push: 'destroy', occludes: false, noItem: true, itemId: 'flux_torch', drops: 'flux_torch', model: (s) => model(wallTorchElements(s.get(P.lit) ? 'flux_torch' : 'flux_torch_off', s.get(P.facing))) });
  reg('repeater', [P.facing, P.delay, P.locked, P.powered], { hardness: 0, sound: 'wood', map: 'none', layer: 'cutout', push: 'destroy', occludes: false, model: (s) => model(repeaterElements(s.get(P.facing), s.get(P.delay), s.get(P.powered), s.get(P.locked))), shape: () => shapeOf([0, 0, 0, 16, 2, 16]) });
  reg('comparator', [P.facing, P.comparatorMode, P.powered], { hardness: 0, sound: 'wood', map: 'none', layer: 'cutout', push: 'destroy', occludes: false, blockEntity: 'comparator', model: (s) => model(comparatorElements(s.get(P.facing), s.get(P.comparatorMode) === 'subtract', s.get(P.powered))), shape: () => shapeOf([0, 0, 0, 16, 2, 16]) });
  reg('lever', [P.attachFace, P.facing, P.powered], { hardness: 0.5, collision: false, sound: 'wood', map: 'none', push: 'destroy', occludes: false, model: (s) => model(leverElements('cobblestone', 'lever', s.get(P.attachFace) as AttachFace, s.get(P.facing), s.get(P.powered))), outline: (s) => leverOutline(s.get(P.attachFace) as AttachFace, s.get(P.facing)) });
  reg('flux_lamp', [P.lit], { hardness: 0.3, sound: 'glass', map: 'none', light: (s) => (s.get(P.lit) ? 15 : 0), model: (s) => { const r = cubeTex(s.get(P.lit) ? 'flux_lamp_on' : 'flux_lamp'); if (r.kind === 'cube' && s.get(P.lit)) r.emissive = [true, true, true, true, true, true]; return r; } });
  reg('target', [P.power], { hardness: 0.5, tool: 'hoe', sound: 'grass', map: 'quartz', model: () => ({ kind: 'cube', tex: ['target_top', 'target_top', 'target_side', 'target_side', 'target_side', 'target_side'] }) });
  reg('daylight_detector', [P.inverted, P.power], { ...woodLike(0.2, 0.2), occludes: false, blockEntity: 'daylight_detector', model: (s) => model([box([0, 0, 0], [16, 6, 16], { 0: 'daylight_detector_side', 1: s.get(P.inverted) ? 'daylight_detector_inverted_top' : 'daylight_detector_top', 2: 'daylight_detector_side', 3: 'daylight_detector_side', 4: 'daylight_detector_side', 5: 'daylight_detector_side' })]), shape: () => shapeOf([0, 0, 0, 16, 6, 16]) });
  reg('tripwire_hook', [P.facing, P.attached, P.powered], {
    hardness: 0, collision: false, sound: 'wood', map: 'none', layer: 'cutout', push: 'destroy', occludes: false,
    model: (s) => model(facingRot([box([6.2, 3.8, 14], [9.8, 12.2, 16], 'oak_planks', { cullEdges: false }), box([7.5, s.get(P.attached) ? 2 : 3.8, 6], [8.5, s.get(P.attached) ? 3.5 : 5.3, 14], 'tripwire_hook', { cullEdges: false })], s.get(P.facing))),
  });
  reg('tripwire', [P.north, P.east, P.south, P.west, P.attached, P.disarmed, P.powered], {
    hardness: 0, collision: false, sound: 'wool', map: 'none', layer: 'cutout', push: 'destroy', occludes: false, noItem: true, itemId: 'string', drops: 'string', dynamicShape: true,
    model: (s) => {
      const y = s.get(P.attached) ? 1.5 : 1;
      const els: Element[] = [];
      const add = (from: [number, number, number], to: [number, number, number]) => els.push({ from, to, shade: false, faces: { 1: { tex: 'tripwire' }, 0: { tex: 'tripwire' } } });
      const n = s.get(P.north), e = s.get(P.east), so = s.get(P.south), w = s.get(P.west);
      if (n || so || (!e && !w)) add([7.75, y, n ? 0 : 4], [8.25, y, so ? 16 : 12]);
      if (e || w) add([w ? 0 : 4, y, 7.75], [e ? 16 : 12, y, 8.25]);
      return model(els, false);
    },
    outline: (s) => (s.get(P.attached) ? shapeOf([0, 1, 0, 16, 2.5, 16]) : shapeOf([0, 0, 0, 16, 8, 16])),
  });
  reg('tnt', [P.unstable], { hardness: 0, sound: 'grass', map: 'fire', flammable: [15, 100], model: () => ({ kind: 'cube', tex: ['tnt_bottom', 'tnt_top', 'tnt_side', 'tnt_side', 'tnt_side', 'tnt_side'] }) });
  // Pistons
  for (const [name, sticky] of [['piston', false], ['sticky_piston', true]] as const) {
    reg(name, [P.facing6, P.extended], {
      hardness: 1.5, tool: 'pickaxe', sound: 'stone', map: 'stone', push: 'normal', occludes: false,
      model: (s) => {
        const f = s.get(P.facing6);
        const front = sticky ? 'piston_top_sticky' : 'piston_top';
        if (!s.get(P.extended)) return cubeDir6(f, front, 'piston_bottom', 'piston_side');
        const els = [box([0, 0, 4], [16, 16, 16], { 2: 'piston_inner', 3: 'piston_bottom', 4: 'piston_side', 5: 'piston_side', 0: 'piston_side', 1: 'piston_side' })];
        return model(orient6(els, f));
      },
      shape: (s) => (s.get(P.extended) ? shape6([0, 0, 4, 16, 16, 16], s.get(P.facing6)) : shapeOf([0, 0, 0, 16, 16, 16])),
      dynamicShape: false,
    });
  }
  reg('piston_head', [P.facing6, P.pistonType, P.short], {
    hardness: 1.5, sound: 'stone', map: 'stone', push: 'block', occludes: false, noItem: true, noDrops: true,
    model: (s) => {
      const front = s.get(P.pistonType) === 'sticky' ? 'piston_top_sticky' : 'piston_top';
      const els = [box([0, 0, 0], [16, 16, 4], { 2: front, 3: 'piston_top', 0: 'piston_side', 1: 'piston_side', 4: 'piston_side', 5: 'piston_side' }), box([6, 6, 4], [10, 10, s.get(P.short) ? 16 : 20], 'piston_side', { cullEdges: false })];
      return model(orient6(els, s.get(P.facing6)));
    },
    shape: (s) => shape6multi([[0, 0, 0, 16, 16, 4], [6, 6, 4, 10, 10, 16]], s.get(P.facing6)),
  });
  reg('moving_piston', [P.facing6, P.pistonType], { hardness: -1, collision: false, push: 'block', noItem: true, noDrops: true, blockEntity: 'moving_piston', occludes: false, model: () => ({ kind: 'none' }) });
  directional6('observer', { ...stoneLike(3, 3, { requiresTool: true }), model: (s) => cubeDir6(s.get(P.facing6), 'observer_front', s.get(P.powered) ? 'observer_back_on' : 'observer_back', 'observer_side') }, 'observer_front', 'observer_back', 'observer_side', [P.powered]);
  for (const n of ['dispenser', 'dropper']) {
    reg(n, [P.facing6, P.triggered], {
      ...stoneLike(3.5, 3.5), blockEntity: n,
      model: (s) => {
        const f = s.get(P.facing6);
        if (f === UP || f === DOWN) {
          const t: [string, string, string, string, string, string] = ['furnace_top', 'furnace_top', 'furnace_top', 'furnace_top', 'furnace_top', 'furnace_top'];
          t[f] = `${n}_front_vertical`;
          return { kind: 'cube', tex: t };
        }
        return cubeOrientable(f, `${n}_front`, 'furnace_side', 'furnace_top');
      },
    });
  }
  reg('hopper', [P.hopperFacing, P.enabled], {
    ...metalLike(3, 4.8, { tier: 0 }), defaults: { enabled: true }, occludes: false, blockEntity: 'hopper',
    model: (s) => {
      const f = s.get(P.hopperFacing);
      const els: Element[] = [
        box([0, 10, 0], [16, 11, 16], { 0: 'hopper_outside', 1: 'hopper_inside' }, { cullEdges: false }),
        box([0, 11, 0], [2, 16, 16], { 1: 'hopper_top', 2: 'hopper_outside', 3: 'hopper_outside', 4: 'hopper_outside', 5: 'hopper_outside' }),
        box([14, 11, 0], [16, 16, 16], { 1: 'hopper_top', 2: 'hopper_outside', 3: 'hopper_outside', 4: 'hopper_outside', 5: 'hopper_outside' }),
        box([2, 11, 0], [14, 16, 2], { 1: 'hopper_top', 2: 'hopper_outside', 3: 'hopper_outside' }),
        box([2, 11, 14], [14, 16, 16], { 1: 'hopper_top', 2: 'hopper_outside', 3: 'hopper_outside' }),
        box([4, 4, 4], [12, 10, 12], 'hopper_outside', { cullEdges: false }),
      ];
      if (f === DOWN) els.push(box([6, 0, 6], [10, 4, 10], 'hopper_outside', { cullEdges: false }));
      else {
        const spout = box([6, 4, 0], [10, 8, 4], 'hopper_outside', { cullEdges: false });
        els.push(...facingRot([spout], f === NORTH ? NORTH : f === EAST ? EAST : f === SOUTH ? SOUTH : WEST));
      }
      return model(els);
    },
    shape: () => shapeOf([0, 10, 0, 16, 16, 16], [4, 4, 4, 12, 10, 12]),
  });
  reg('crafter', [P.orientation, P.triggered, P.crafting], {
    ...stoneLike(1.5, 3.5, { requiresTool: true, tier: 0 }), blockEntity: 'crafter',
    model: (s) => {
      const o = s.get(P.orientation);
      const facing = o.split('_')[0]!;
      const f = ['down', 'up', 'north', 'south', 'west', 'east'].indexOf(facing) as Direction;
      const suffix = s.get(P.crafting) ? '_crafting' : s.get(P.triggered) ? '_triggered' : '';
      return cubeDir6(f, `crafter_front${suffix}`, 'crafter_bottom', `crafter_side${suffix}`);
    },
  });
  // Rails
  reg('rail', [P.railShape, P.waterlogged], { hardness: 0.7, collision: false, sound: 'metal', map: 'none', layer: 'cutout', push: 'normal', occludes: false, tags: ['rails'], model: (s) => model(railElements(isCurve(s.get(P.railShape)) ? 'rail_corner' : 'rail', s.get(P.railShape)), false), outline: (s) => railOutline(s.get(P.railShape)) });
  for (const n of ['powered_rail', 'detector_rail', 'activator_rail']) {
    reg(n, [P.railShapeStraight, P.powered, P.waterlogged], { hardness: 0.7, collision: false, sound: 'metal', map: 'none', layer: 'cutout', occludes: false, tags: ['rails'], model: (s) => model(railElements(s.get(P.powered) ? `${n}_on` : n, s.get(P.railShapeStraight)), false), outline: (s) => railOutline(s.get(P.railShapeStraight)) });
  }
  // Sculk (echo) family
  cube('echo_moss', { hardness: 0.2, tool: 'hoe', sound: 'sculk', map: 'color_black' });
  reg('echo_vein', [P.down, P.up, P.north, P.south, P.west, P.east, P.waterlogged], {
    hardness: 0.2, tool: 'hoe', collision: false, replaceable: true, sound: 'sculk_vein', map: 'color_black', layer: 'cutout', push: 'destroy', occludes: false,
    model: (s) => {
      const f = [s.get(P.down), s.get(P.up), s.get(P.north), s.get(P.south), s.get(P.west), s.get(P.east)];
      const els: Element[] = [];
      for (let d = 0; d < 6; d++) if (f[d]) els.push(planeOn6(d as Direction, 'echo_vein'));
      return model(els, false);
    },
  });
  reg('echo_catalyst', [P.bloom], { hardness: 3, resistance: 3, tool: 'hoe', sound: 'sculk_catalyst', map: 'color_black', light: 6, blockEntity: 'echo_catalyst', model: (s) => ({ kind: 'cube', tex: ['echo_catalyst_bottom', s.get(P.bloom) ? 'echo_catalyst_top_bloom' : 'echo_catalyst_top', 'echo_catalyst_side', 'echo_catalyst_side', 'echo_catalyst_side', 'echo_catalyst_side'] }) });
  reg('echo_shrieker', [P.shrieking, P.waterlogged, P.canSummon], { hardness: 3, resistance: 3, tool: 'hoe', sound: 'sculk_shrieker', map: 'color_black', occludes: false, blockEntity: 'echo_shrieker', model: () => model([box([0, 0, 0], [16, 8, 16], { 0: 'echo_shrieker_bottom', 1: 'echo_shrieker_top', 2: 'echo_shrieker_side', 3: 'echo_shrieker_side', 4: 'echo_shrieker_side', 5: 'echo_shrieker_side' }), box([1, 8, 1], [15, 15, 15], 'echo_shrieker_inner', { cullEdges: false })]), shape: () => shapeOf([0, 0, 0, 16, 8, 16]) });
  for (const [n, extra] of [['echo_sensor', []], ['calibrated_echo_sensor', [P.facing]]] as const) {
    reg(n, [...extra, P.sculkPhase, P.power, P.waterlogged], {
      hardness: 1.5, tool: 'hoe', sound: 'sculk_sensor', map: 'color_cyan', light: 1, occludes: false, blockEntity: n, layer: 'cutout',
      model: (s) => model([
        box([0, 0, 0], [16, 8, 16], { 0: 'echo_sensor_bottom', 1: n === 'calibrated_echo_sensor' ? 'calibrated_echo_sensor_top' : 'echo_sensor_top', 2: 'echo_sensor_side', 3: 'echo_sensor_side', 4: 'echo_sensor_side', 5: 'echo_sensor_side' }),
        ...crossElements(s.get(P.sculkPhase) === 'active' ? 'echo_sensor_tendril_active' : 'echo_sensor_tendril_inactive', Tint.None, 8).map((e) => ({ ...e, from: [e.from[0], 8, e.from[2]] as [number, number, number], to: [e.to[0], 16, e.to[2]] as [number, number, number] })),
      ]),
      shape: () => shapeOf([0, 0, 0, 16, 8, 16]),
    });
  }

  // ---- fire & portals --------------------------------------------------------------------------
  reg('fire', [P.age15, P.north, P.east, P.south, P.west, P.up], {
    hardness: 0, collision: false, replaceable: true, sound: 'wool', map: 'fire', light: 15, layer: 'cutout', push: 'destroy', occludes: false, noItem: true, noDrops: true, randomTicks: true, hot: true, emissive: true,
    model: (s) => {
      const any = s.get(P.north) || s.get(P.east) || s.get(P.south) || s.get(P.west) || s.get(P.up);
      if (!any) return model(fireFloor('fire'), false);
      const els: Element[] = [];
      if (s.get(P.north)) els.push(firePlane('fire', NORTH));
      if (s.get(P.south)) els.push(firePlane('fire', SOUTH));
      if (s.get(P.west)) els.push(firePlane('fire', WEST));
      if (s.get(P.east)) els.push(firePlane('fire', EAST));
      if (s.get(P.up)) els.push({ from: [0, 15.5, 0], to: [16, 15.5, 16], shade: false, faces: { 0: { tex: 'fire', emissive: true } } });
      return model(els, false);
    },
    outline: () => shapeOf([0, 0, 0, 16, 1, 16]),
  });
  reg('soul_fire', [], { hardness: 0, collision: false, replaceable: true, sound: 'wool', map: 'color_light_blue', light: 10, layer: 'cutout', push: 'destroy', occludes: false, noItem: true, noDrops: true, hot: true, emissive: true, model: () => model(fireFloor('soul_fire'), false), outline: () => shapeOf([0, 0, 0, 16, 1, 16]) });
  reg('inferno_portal', [P.hAxis], {
    hardness: -1, collision: false, sound: 'glass', map: 'none', light: 11, layer: 'translucent', push: 'block', occludes: false, noItem: true, noDrops: true, randomTicks: true, emissive: true,
    model: (s) => model([s.get(P.hAxis) === 'x' ? box([0, 0, 6], [16, 16, 10], { 2: 'inferno_portal', 3: 'inferno_portal' }, { emissive: true }) : box([6, 0, 0], [10, 16, 16], { 4: 'inferno_portal', 5: 'inferno_portal' }, { emissive: true })], false),
    outline: (s) => (s.get(P.hAxis) === 'x' ? shapeOf([0, 0, 6, 16, 16, 10]) : shapeOf([6, 0, 0, 10, 16, 16])),
  });
  reg('verge_portal', [], { hardness: -1, resistance: 3600000, collision: false, map: 'color_black', light: 15, push: 'block', occludes: false, noItem: true, noDrops: true, blockEntity: 'verge_portal', emissive: true, model: () => model([box([0, 12, 0], [16, 12, 16], { 1: 'verge_portal', 0: 'verge_portal' }, { emissive: true })], false), outline: () => shapeOf([0, 6, 0, 16, 12, 16]) });
  reg('verge_gateway', [], { hardness: -1, resistance: 3600000, collision: false, map: 'color_black', light: 15, push: 'block', occludes: false, noItem: true, noDrops: true, blockEntity: 'verge_gateway', emissive: true, model: () => ({ kind: 'cube', tex: ['verge_portal', 'verge_portal', 'verge_portal', 'verge_portal', 'verge_portal', 'verge_portal'], emissive: [true, true, true, true, true, true] }) });
  reg('verge_portal_frame', [P.facing, P.eye], {
    hardness: -1, resistance: 3600000, sound: 'glass', map: 'color_green', light: 1, push: 'block', occludes: false, noDrops: true,
    model: (s) => {
      const els = [box([0, 0, 0], [16, 13, 16], { 0: 'verge_stone', 1: 'verge_portal_frame_top', 2: 'verge_portal_frame_side', 3: 'verge_portal_frame_side', 4: 'verge_portal_frame_side', 5: 'verge_portal_frame_side' })];
      if (s.get(P.eye)) els.push(box([4, 13, 4], [12, 16, 12], 'verge_portal_frame_eye', { cullEdges: false }));
      return model(facingRot(els, s.get(P.facing)));
    },
    shape: (s) => (s.get(P.eye) ? shapeOf([0, 0, 0, 16, 13, 16], [4, 13, 4, 12, 16, 12]) : shapeOf([0, 0, 0, 16, 13, 16])),
  });
  reg('dragon_egg', [], { hardness: 3, resistance: 9, sound: 'stone', map: 'color_black', light: 1, push: 'destroy', occludes: false, tags: ['falling'], model: () => model([box([6, 15, 6], [10, 16, 10], 'dragon_egg', { cullEdges: false }), box([5, 14, 5], [11, 15, 11], 'dragon_egg', { cullEdges: false }), box([4, 13, 4], [12, 14, 12], 'dragon_egg', { cullEdges: false }), box([3, 11, 3], [13, 13, 13], 'dragon_egg', { cullEdges: false }), box([2, 8, 2], [14, 11, 14], 'dragon_egg', { cullEdges: false }), box([1, 3, 1], [15, 8, 15], 'dragon_egg', { cullEdges: false }), box([2, 1, 2], [14, 3, 14], 'dragon_egg', { cullEdges: false }), box([3, 0, 3], [13, 1, 13], 'dragon_egg', { cullEdges: false })]), shape: () => shapeOf([1, 0, 1, 15, 16, 15]) });
  reg('bubble_column', [P.drag], { defaults: { drag: true }, hardness: 0, collision: false, replaceable: true, fluid: 'water', noItem: true, noDrops: true, occludes: false, layer: 'translucent', model: () => ({ kind: 'liquid', still: 'water_still', flow: 'water_flow', lava: false }), waterloggedProp: true });

  // ---- heads & skulls -------------------------------------------------------------------------
  for (const [n, h] of [['skeleton_skull', 8], ['blight_skeleton_skull', 8], ['zombie_head', 8], ['player_head', 8], ['hisser_head', 8], ['dragon_head', 8], ['swinekin_head', 8]] as const) {
    const wallName = n.replace(/_(skull|head)$/, '_wall_$1');
    const tex = n.replace(/_(skull|head)$/, '');
    reg(n, [P.rotation16, P.powered], {
      hardness: 1, sound: 'stone', map: 'none', push: 'destroy', occludes: false, blockEntity: 'skull', tags: ['skulls'],
      model: (s) => {
        const snapped = (Math.round(s.get(P.rotation16) / 4) * 90) % 360;
        const w = n === 'dragon_head' ? 16 : 8;
        const a = 8 - w / 2;
        return model(rotateModel([box([a, 0, a], [a + w, h, a + w], { 0: `${tex}_head_bottom`, 1: `${tex}_head_top`, 2: `${tex}_head_back`, 3: `${tex}_head_face`, 4: `${tex}_head_side`, 5: `${tex}_head_side` }, { cullEdges: false })], 0, snapped));
      },
      shape: () => (n === 'dragon_head' ? shapeOf([0, 0, 0, 16, 8, 16]) : shapeOf([4, 0, 4, 12, 8, 12])),
    });
    reg(wallName, [P.facing, P.powered], {
      hardness: 1, sound: 'stone', map: 'none', push: 'destroy', occludes: false, blockEntity: 'skull', noItem: true, itemId: n, drops: n, tags: ['skulls'],
      model: (s) => model(facingRot([box([4, 4, 8], [12, 12, 16], { 0: `${tex}_head_bottom`, 1: `${tex}_head_top`, 2: `${tex}_head_face`, 3: `${tex}_head_back`, 4: `${tex}_head_side`, 5: `${tex}_head_side` }, { cullEdges: false })], s.get(P.facing))),
      shape: (s) => shape6([4, 4, 8, 12, 12, 16], s.get(P.facing)),
    });
  }

  // ---- technical --------------------------------------------------------------------------------
  cube('barrier', { hardness: -1, resistance: 3600000, sound: 'stone', map: 'none', push: 'block', noDrops: true, occludes: false, model: () => ({ kind: 'none' }) });
  reg('light', [P.lightLevel, P.waterlogged], { hardness: -1, resistance: 3600000, collision: false, replaceable: true, map: 'none', noDrops: true, occludes: false, light: (s) => s.get(P.lightLevel), model: () => ({ kind: 'none' }) });
  cube('structure_void', { hardness: -1, collision: false, replaceable: true, map: 'none', noDrops: true, occludes: false, model: () => ({ kind: 'none' }) });
  reg('structure_block', [P.structureMode], { hardness: -1, resistance: 3600000, sound: 'metal', map: 'color_light_gray', noDrops: true, blockEntity: 'structure_block', model: (s) => cubeTex(`structure_block_${s.get(P.structureMode)}`) });
  reg('jigsaw', [P.orientation], { hardness: -1, resistance: 3600000, sound: 'metal', map: 'color_light_gray', noDrops: true, blockEntity: 'jigsaw', model: () => cubeTex('jigsaw_side') });
  for (const n of ['command_block', 'chain_command_block', 'repeating_command_block']) {
    reg(n, [P.facing6, P.conditional], { hardness: -1, resistance: 3600000, sound: 'metal', map: 'color_brown', noDrops: true, blockEntity: 'command_block', model: (s) => cubeDir6(s.get(P.facing6), `${n}_front`, `${n}_back`, s.get(P.conditional) ? `${n}_conditional` : `${n}_side`) });
  }
  reg('cave_air', [], { air: true, collision: false, replaceable: true, noItem: true, occludes: false, push: 'ignore' });
  reg('void_air', [], { air: true, collision: false, replaceable: true, noItem: true, occludes: false, push: 'ignore' });

  // ---- infested blocks --------------------------------------------------------------------------
  for (const base of ['stone', 'cobblestone', 'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks']) {
    cube(`infested_${base}`, { hardness: 0.75, resistance: 0.75, sound: 'stone', map: 'clay', noDrops: true, tags: ['infested'] }, base);
  }
  reg('infested_deepslate', [P.axis], { hardness: 0.75, resistance: 0.75, sound: 'deepslate', map: 'deepslate', noDrops: true, tags: ['infested'], model: (s) => ({ kind: 'cube', tex: s.get(P.axis) === 'y' ? ['deepslate_top', 'deepslate_top', 'deepslate', 'deepslate', 'deepslate', 'deepslate'] : ['deepslate', 'deepslate', 'deepslate', 'deepslate', 'deepslate_top', 'deepslate_top'] }) });

  // ---- misc: heavy core, dried ghast, shelves --------------------------------------------------
  reg('heavy_core', [P.waterlogged], { hardness: 10, resistance: 1200, sound: 'heavy_core', map: 'metal', occludes: false, model: () => model([box([4, 0, 4], [12, 8, 12], 'heavy_core', { cullEdges: false })]) });
  reg('dried_ghast', [P.facing, P.hydration, P.waterlogged], {
    hardness: 0, sound: 'dried_ghast', map: 'color_gray', occludes: false, randomTicks: true,
    model: (s) => model(facingRot([box([3, 0, 3], [13, 10, 13], { 0: 'dried_ghast_bottom', 1: 'dried_ghast_top', 2: 'dried_ghast_side', 3: 'dried_ghast_face', 4: 'dried_ghast_side', 5: 'dried_ghast_side' }, { cullEdges: false })], s.get(P.facing))),
    shape: () => shapeOf([3, 0, 3, 13, 10, 13]),
  });
  for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped']) {
    reg(`${w}_shelf`, [P.facing, P.powered, P.sideChain, P.waterlogged], {
      ...woodLike(2, 3), occludes: false, blockEntity: 'shelf', tags: ['shelves'],
      model: (s) => model(facingRot([box([0, 0, 11], [16, 16, 16], `${w}_shelf`, { cullEdges: false })], s.get(P.facing))),
      shape: (s) => shape6([0, 0, 11, 16, 16, 16], s.get(P.facing)),
    });
  }
}

// ---- local helpers ----------------------------------------------------------------------------

function cauldronElements(fluidTex: string | null, level: number): Element[] {
  const els: Element[] = [
    box([0, 3, 0], [2, 16, 16], { 1: 'cauldron_top', 2: 'cauldron_side', 3: 'cauldron_side', 4: 'cauldron_side', 5: 'cauldron_inner' }, { cullEdges: true }),
    box([14, 3, 0], [16, 16, 16], { 1: 'cauldron_top', 2: 'cauldron_side', 3: 'cauldron_side', 4: 'cauldron_inner', 5: 'cauldron_side' }),
    box([2, 3, 0], [14, 16, 2], { 1: 'cauldron_top', 2: 'cauldron_side', 3: 'cauldron_inner' }),
    box([2, 3, 14], [14, 16, 16], { 1: 'cauldron_top', 2: 'cauldron_inner', 3: 'cauldron_side' }),
    box([2, 3, 2], [14, 4, 14], { 1: 'cauldron_inner', 0: 'cauldron_bottom' }, { cullEdges: false }),
    box([0, 0, 0], [4, 3, 2], 'cauldron_side'), box([0, 0, 2], [2, 3, 4], 'cauldron_side'),
    box([12, 0, 0], [16, 3, 2], 'cauldron_side'), box([14, 0, 2], [16, 3, 4], 'cauldron_side'),
    box([0, 0, 14], [4, 3, 16], 'cauldron_side'), box([0, 0, 12], [2, 3, 14], 'cauldron_side'),
    box([12, 0, 14], [16, 3, 16], 'cauldron_side'), box([14, 0, 12], [16, 3, 14], 'cauldron_side'),
  ];
  if (fluidTex && level > 0) {
    const h = level === 1 ? 9 : level === 2 ? 12 : 15;
    els.push({ from: [2, h, 2], to: [14, h, 14], faces: { 1: { tex: fluidTex, tint: fluidTex === 'water_still' ? Tint.Water : Tint.None, emissive: fluidTex === 'lava_still' } } });
  }
  return els;
}

function cauldronShape() {
  return shapeOf([0, 0, 0, 16, 4, 16], [0, 4, 0, 2, 16, 16], [14, 4, 0, 16, 16, 16], [0, 4, 0, 16, 16, 2], [0, 4, 14, 16, 16, 16]);
}

function potOnly(): Element[] {
  return [
    box([5, 0, 5], [6, 6, 11], 'flower_pot', { cullEdges: false }),
    box([10, 0, 5], [11, 6, 11], 'flower_pot', { cullEdges: false }),
    box([6, 0, 5], [10, 6, 6], 'flower_pot', { cullEdges: false }),
    box([6, 0, 10], [10, 6, 11], 'flower_pot', { cullEdges: false }),
    box([6, 0, 6], [10, 4, 10], { 1: 'dirt', 0: 'flower_pot' }, { cullEdges: false }),
  ];
}

/** Orient elements authored facing north (front at z=0) to any of the six directions. */
function orient6(els: Element[], f: Direction): Element[] {
  if (f === UP) return rotateModel(els, 270, 0);
  if (f === DOWN) return rotateModel(els, 90, 0);
  return facingRot(els, f);
}

function shape6(b: number[], f: Direction) {
  return shape6multi([b], f);
}

function shape6multi(boxes: number[][], f: Direction) {
  const out: number[][] = [];
  for (const b of boxes) {
    const [x0, y0, z0, x1, y1, z1] = b as [number, number, number, number, number, number];
    let r: number[];
    switch (f) {
      case NORTH: r = [x0, y0, z0, x1, y1, z1]; break;
      case SOUTH: r = [16 - x1, y0, 16 - z1, 16 - x0, y1, 16 - z0]; break;
      case EAST: r = [16 - z1, y0, x0, 16 - z0, y1, x1]; break;
      case WEST: r = [z0, y0, 16 - x1, z1, y1, 16 - x0]; break;
      case UP: r = [x0, 16 - z1, y0, x1, 16 - z0, y1]; break;
      default: r = [x0, z0, 16 - y1, x1, z1, 16 - y0]; break;
    }
    out.push(r);
  }
  return shapeOf(...out);
}

function leverOutline(face: AttachFace, facing: Direction) {
  if (face === 'floor') return facing === NORTH || facing === SOUTH ? shapeOf([5, 0, 4, 11, 6, 12]) : shapeOf([4, 0, 5, 12, 6, 11]);
  if (face === 'ceiling') return facing === NORTH || facing === SOUTH ? shapeOf([5, 10, 4, 11, 16, 12]) : shapeOf([4, 10, 5, 12, 16, 11]);
  return facing === NORTH ? shapeOf([5, 4, 10, 11, 12, 16]) : facing === SOUTH ? shapeOf([5, 4, 0, 11, 12, 6]) : facing === WEST ? shapeOf([10, 4, 5, 16, 12, 11]) : shapeOf([0, 4, 5, 6, 12, 11]);
}

function isCurve(shape: string): boolean {
  return shape === 'south_east' || shape === 'south_west' || shape === 'north_west' || shape === 'north_east';
}

function railOutline(shape: string) {
  return shape.startsWith('ascending') ? shapeOf([0, 0, 0, 16, 8, 16]) : shapeOf([0, 0, 0, 16, 2, 16]);
}

function planeOn6(d: Direction, tex: string): Element {
  const inset = 0.8;
  const f = { tex };
  switch (d) {
    case DOWN: return { from: [0, inset, 0], to: [16, inset, 16], shade: false, faces: { 0: f, 1: f } };
    case UP: return { from: [0, 16 - inset, 0], to: [16, 16 - inset, 16], shade: false, faces: { 0: f, 1: f } };
    case NORTH: return { from: [0, 0, inset], to: [16, 16, inset], shade: false, faces: { 2: f, 3: f } };
    case SOUTH: return { from: [0, 0, 16 - inset], to: [16, 16, 16 - inset], shade: false, faces: { 2: f, 3: f } };
    case WEST: return { from: [inset, 0, 0], to: [inset, 16, 16], shade: false, faces: { 4: f, 5: f } };
    default: return { from: [16 - inset, 0, 0], to: [16 - inset, 16, 16], shade: false, faces: { 4: f, 5: f } };
  }
}

function fireFloor(tex: string): Element[] {
  const e = (from: [number, number, number], to: [number, number, number], rot: number, axis: 0 | 2, faces: 'x' | 'z'): Element => ({
    from, to, shade: false, rot: { axis, angle: rot, origin: [8, 8, 8], rescale: false },
    faces: faces === 'z' ? { 2: { tex, emissive: true }, 3: { tex, emissive: true } } : { 4: { tex, emissive: true }, 5: { tex, emissive: true } },
  });
  return [
    e([0, 0, 8.8], [16, 22.4, 8.8], -22.5, 0, 'z'),
    e([0, 0, 7.2], [16, 22.4, 7.2], 22.5, 0, 'z'),
    e([8.8, 0, 0], [8.8, 22.4, 16], -22.5, 2, 'x'),
    e([7.2, 0, 0], [7.2, 22.4, 16], 22.5, 2, 'x'),
  ];
}

function firePlane(tex: string, d: Direction): Element {
  const inset = 0.01;
  switch (d) {
    case NORTH: return { from: [0, 0, inset], to: [16, 22.4, inset], shade: false, faces: { 3: { tex, emissive: true }, 2: { tex, emissive: true } } };
    case SOUTH: return { from: [0, 0, 16 - inset], to: [16, 22.4, 16 - inset], shade: false, faces: { 2: { tex, emissive: true }, 3: { tex, emissive: true } } };
    case WEST: return { from: [inset, 0, 0], to: [inset, 22.4, 16], shade: false, faces: { 5: { tex, emissive: true }, 4: { tex, emissive: true } } };
    default: return { from: [16 - inset, 0, 0], to: [16 - inset, 22.4, 16], shade: false, faces: { 4: { tex, emissive: true }, 5: { tex, emissive: true } } };
  }
}

