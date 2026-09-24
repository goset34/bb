/** Inferno (nether-like) and Verge (end-like) terrain blocks. */
import { reg, cube, cubeBT, stoneLike, shapeOf } from './helpers';
import { cubeTex } from '../model';

export function registerDimension(): void {
  cube('cinderrack', stoneLike(0.4, 0.4, { map: 'nether', sound: 'cinderrack', tags: ['base_stone_inferno', 'infiniburn_overworld'] }));
  for (const n of ['crimson', 'warped']) {
    cubeBT(`${n}_nylium`, stoneLike(0.4, 0.4, { map: n === 'crimson' ? 'crimson_nylium' : 'warped_nylium', sound: 'nylium', randomTicks: true, tags: ['nylium'], drops: 'cinderrack' }), 'cinderrack', `${n}_nylium`, `${n}_nylium_side`);
  }
  reg('soul_sand', [], {
    hardness: 0.5, tool: 'shovel', sound: 'soul_sand', map: 'color_brown', speedFactor: 0.4, tags: ['soul_fire_base_blocks', 'soul_speed_blocks'],
    model: () => cubeTex('soul_sand'), shape: () => shapeOf([0, 0, 0, 16, 14, 16]), outline: () => shapeOf([0, 0, 0, 16, 16, 16]),
    solid: true, spawnable: true,
  });
  cube('soul_soil', { hardness: 0.5, tool: 'shovel', sound: 'soul_soil', map: 'color_brown', tags: ['soul_fire_base_blocks', 'soul_speed_blocks'] });
  cube('glowstone', { hardness: 0.3, sound: 'glass', map: 'sand', light: 15, emissive: false });
  cube('cinder_gold_ore', stoneLike(3, 3, { map: 'nether', sound: 'nether_gold_ore', tier: 0, tags: ['ores'] }));
  cube('cinder_quartz_ore', stoneLike(3, 3, { map: 'nether', sound: 'nether_ore', tier: 0, tags: ['ores'] }));
  cubeBT('ancient_debris', stoneLike(30, 1200, { tier: 3, map: 'color_black', sound: 'ancient_debris', push: 'normal' }), 'ancient_debris_top', 'ancient_debris_top', 'ancient_debris_side');
  cube('ember_wart_block', { hardness: 1, tool: 'hoe', sound: 'wart_block', map: 'color_red', tags: ['wart_blocks'] });
  cube('warped_wart_block', { hardness: 1, tool: 'hoe', sound: 'wart_block', map: 'warped_wart_block', tags: ['wart_blocks'] });
  cube('glowcap', { hardness: 1, tool: 'hoe', sound: 'shroomlight', map: 'color_red', light: 15 });
}
