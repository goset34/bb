/**
 * Block texture recipes, resolved by name. Every texture referenced by a block model must be
 * producible here (checked by tests/unit/textures.test.ts).
 */
import { Painter, RGB } from './painter';
import {
  hex, mix, shade, add, jitter, noiseFill, speckle, voronoi, stone, cobble, bricks, tiles, polished, planks, bark,
  logTop, strippedSide, leaves, wool, concrete, powder, terracotta, glazed, glass, metalBlock, gemBlock, ore, sandy,
  pebbles, dirt, grassFringe, fluid,
} from './materials';

// ---------------------------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------------------------
export const DYE: Record<string, RGB> = {
  white: hex('#eaeded'), orange: hex('#ee7a1a'), magenta: hex('#b948b0'), light_blue: hex('#43acd6'),
  yellow: hex('#f3c32d'), lime: hex('#74b823'), pink: hex('#ea90ae'), gray: hex('#42484b'),
  light_gray: hex('#909089'), cyan: hex('#1a878f'), purple: hex('#7532a6'), blue: hex('#3a3f9b'),
  brown: hex('#744a2c'), green: hex('#566f20'), red: hex('#a02c26'), black: hex('#18191c'),
};
const TERRA: Record<string, RGB> = {
  white: hex('#d1b1a0'), orange: hex('#a15426'), magenta: hex('#95586c'), light_blue: hex('#716c89'),
  yellow: hex('#ba8524'), lime: hex('#677535'), pink: hex('#a24e4f'), gray: hex('#3a2a24'),
  light_gray: hex('#876b62'), cyan: hex('#575b5b'), purple: hex('#764656'), blue: hex('#4a3b5b'),
  brown: hex('#4d3324'), green: hex('#4c532a'), red: hex('#8e3c2e'), black: hex('#251610'),
};
const PLANKS: Record<string, RGB> = {
  oak: hex('#b0894f'), spruce: hex('#6f4f2e'), birch: hex('#c9b77a'), jungle: hex('#a4724c'), acacia: hex('#ad5d32'),
  dark_oak: hex('#4a2f17'), mangrove: hex('#773431'), cherry: hex('#e2b2ab'), pale_oak: hex('#e4dbd1'),
  bamboo: hex('#c9b156'), crimson: hex('#6c344c'), warped: hex('#2b6964'),
};
const BARK: Record<string, [RGB, RGB]> = {
  oak: [hex('#6d5434'), hex('#44351f')], spruce: hex2('#3d2b1a', '#27190e'), birch: hex2('#e3ded2', '#2e2b27'),
  jungle: hex2('#5b451d', '#3a2b10'), acacia: hex2('#6c645b', '#4a4238'), dark_oak: hex2('#3e301c', '#261c0f'),
  mangrove: hex2('#5a432f', '#3c2c1d'), cherry: hex2('#3b2328', '#231316'), pale_oak: hex2('#524a45', '#342e2a'),
  crimson: hex2('#5d1b20', '#a0303a'), warped: hex2('#3b3a4c', '#2f8c80'),
};
const LEAF_BASE: RGB = hex('#8c8c8c');

function hex2(a: string, b: string): [RGB, RGB] {
  return [hex(a), hex(b)];
}

const STONE = hex('#7e7e7e');
const DEEPSLATE = hex('#4f4f55');

type Recipe = (p: Painter, m: RegExpMatchArray) => void;

const exact = new Map<string, (p: Painter) => void>();
const rules: Array<[RegExp, Recipe]> = [];
function def(name: string, fn: (p: Painter) => void): void {
  exact.set(name, fn);
}
function rule(re: RegExp, fn: Recipe): void {
  rules.push([re, fn]);
}

/** Frame counts for animated textures. */
export const ANIMATED: Record<string, number> = {
  water_still: 16, water_flow: 16, lava_still: 16, lava_flow: 16, fire: 8, soul_fire: 8, campfire_fire: 8,
  soul_campfire_fire: 8, inferno_portal: 16, verge_portal: 8, prismarine: 8, sea_lantern: 8, magma_block: 4,
  echo_moss: 8, echo_vein: 8, echo_sensor_tendril_active: 4, echo_catalyst_top_bloom: 4,
};

// ---------------------------------------------------------------------------------------------
// Sprite helpers
// ---------------------------------------------------------------------------------------------
function clear(p: Painter): void {
  p.clear();
  p.material({ smooth: 0.2, tint: 1, bump: 0.6 });
  p.height.fill(0.5);
}

function stem(p: Painter, u0: number, v0: number, u1: number, v1: number, c: RGB, w = 1): void {
  p.line(u0, v0, u1, v1, c, w);
}

function blob(p: Painter, cu: number, cv: number, r: number, c: RGB, shadeEdge = true): void {
  p.disc(cu, cv, r, (x, y, d) => p.set(x, y, shadeEdge ? jitter(shade(c, 1.1 - d * 0.35), 0.05, p.rnd(x, y, 3)) : c, 0.7 - d * 0.3));
}

/** Grass-like blades (gray, tinted). */
function blades(p: Painter, color: RGB, count: number, maxH: number, salt = 0, bottom = 16): void {
  for (let i = 0; i < count; i++) {
    const u = 1 + p.rnd(i, 0, salt) * 14;
    const h = maxH * (0.5 + p.rnd(i, 1, salt) * 0.5);
    const lean = (p.rnd(i, 2, salt) - 0.5) * 4;
    const c = shade(color, 0.75 + p.rnd(i, 3, salt) * 0.4);
    stem(p, u, bottom - 0.01, u + lean, bottom - h, c, 1);
  }
}

function flowerHead(p: Painter, cu: number, cv: number, petals: RGB, center: RGB, r = 2.2, n = 5): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    blob(p, cu + Math.cos(a) * r * 0.7, cv + Math.sin(a) * r * 0.7, r * 0.6, petals);
  }
  blob(p, cu, cv, r * 0.45, center, false);
  for (let x = 0; x < p.n; x++) for (let y = 0; y < p.n; y++) if (p.alpha(x, y) > 0 && p.get(x, y)[1] !== 0) p.setMat(x, y, { tint: 0 });
}

function markNoTint(p: Painter): void {
  p.tint.fill(0);
}

function plantStem(p: Painter, top = 7, color: RGB = hex('#3f7a2b')): void {
  stem(p, 8, 16, 8, top, color, 1);
  blob(p, 6.5, 12, 1.2, shade(color, 1.1));
  blob(p, 9.5, 10.5, 1.2, shade(color, 1.05));
}

// ---------------------------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------------------------
def('stone', (p) => stone(p, STONE, { cracks: 0.5 }));
def('smooth_stone', (p) => polished(p, hex('#a2a2a2')));
def('smooth_stone_slab_side', (p) => {
  polished(p, hex('#a2a2a2'));
  p.each((x, y, u, v) => {
    if (Math.abs(v - 8) < 0.5) p.set(x, y, hex('#6f6f6f'), 0.1);
  });
});
def('granite', (p) => {
  stone(p, hex('#9b6b58'), { variance: 0.1 });
  speckle(p, [hex('#b98673'), hex('#6d4a3e'), hex('#c9a092')], 0.22);
});
def('polished_granite', (p) => { polished(p, hex('#9d6d59')); speckle(p, [hex('#b58472'), hex('#7a5244')], 0.1); });
def('diorite', (p) => {
  stone(p, hex('#bdbdbe'), { variance: 0.08 });
  speckle(p, [hex('#7c7c7e'), hex('#e6e6e6'), hex('#979798')], 0.25);
});
def('polished_diorite', (p) => { polished(p, hex('#c3c3c4')); speckle(p, [hex('#8d8d8f'), hex('#e3e3e3')], 0.12); });
def('andesite', (p) => { stone(p, hex('#878888'), { blotch: 0.12 }); speckle(p, [hex('#9fa0a0'), hex('#6c6d6d')], 0.18); });
def('polished_andesite', (p) => { polished(p, hex('#848786')); speckle(p, [hex('#9a9c9b')], 0.08); });
def('deepslate', (p) => {
  stone(p, DEEPSLATE, { variance: 0.07, blotch: 0.04 });
  p.each((x, y, u, v) => {
    if (p.vnoise(u * 0.3, v * 3, 8, 4) < 0.28) p.set(x, y, shade(DEEPSLATE, 0.8), 0.25);
  });
});
def('deepslate_top', (p) => {
  stone(p, shade(DEEPSLATE, 1.05), { variance: 0.06 });
  p.each((x, y, u, v) => {
    const r = Math.max(Math.abs(u - 8), Math.abs(v - 8));
    if (Math.abs(r - 5) < 0.5 || Math.abs(r - 2) < 0.5) p.set(x, y, shade(DEEPSLATE, 0.78), 0.3);
  });
});
def('cobbled_deepslate', (p) => cobble(p, hex('#56565b'), hex('#2c2c31'), 5, 3));
def('polished_deepslate', (p) => polished(p, hex('#48484d')));
def('deepslate_bricks', (p) => bricks(p, hex('#4c4c51'), hex('#2e2e32'), { rows: 4, cols: 2 }));
def('cracked_deepslate_bricks', (p) => { bricks(p, hex('#4c4c51'), hex('#2e2e32'), { rows: 4, cols: 2 }); crack(p, hex('#262629')); });
def('deepslate_tiles', (p) => tiles(p, hex('#3a3a3f'), hex('#26262a'), 4));
def('cracked_deepslate_tiles', (p) => { tiles(p, hex('#3a3a3f'), hex('#26262a'), 4); crack(p, hex('#1f1f23')); });
def('chiseled_deepslate', (p) => chiseledPattern(p, hex('#48484d'), hex('#2d2d31')));
def('reinforced_deepslate_side', (p) => { metalBlock(p, hex('#626b64'), { rivets: true }); centerInlay(p, hex('#3a3f3d'), 4); });
def('reinforced_deepslate_top', (p) => { tiles(p, hex('#4b4f4d'), hex('#2a2d2b'), 2); centerInlay(p, hex('#7a8a82'), 2); });
def('reinforced_deepslate_bottom', (p) => tiles(p, hex('#3e423f'), hex('#262826'), 2));
def('tuff', (p) => { stone(p, hex('#6c6d66'), { variance: 0.1 }); speckle(p, [hex('#8a8b83'), hex('#55564f'), hex('#7f7a6c')], 0.2); });
def('polished_tuff', (p) => polished(p, hex('#666861')));
def('tuff_bricks', (p) => bricks(p, hex('#6a6c64'), hex('#46473f'), { rows: 4, cols: 2 }));
def('chiseled_tuff', (p) => { bricks(p, hex('#6c6d66'), hex('#4b4c45'), { rows: 2, cols: 1 }); centerInlay(p, hex('#8b8c84'), 3); });
def('chiseled_tuff_top', (p) => { polished(p, hex('#6c6d66')); centerInlay(p, hex('#50514b'), 4); });
def('chiseled_tuff_bricks', (p) => { bricks(p, hex('#6a6c64'), hex('#46473f'), { rows: 2, cols: 2 }); centerInlay(p, hex('#8e8f87'), 2); });
def('chiseled_tuff_bricks_top', (p) => { tiles(p, hex('#6a6c64'), hex('#46473f'), 2); });
def('calcite', (p) => { stone(p, hex('#dcdcd5'), { variance: 0.05 }); speckle(p, [hex('#c3c3bc'), hex('#f2f2ec')], 0.15); });
def('dripstone_block', (p) => {
  stone(p, hex('#866c5b'), { variance: 0.08 });
  p.each((x, y, u, v) => {
    if (Math.sin(v * 1.6 + p.fbm(u, v, 2, 2, 7) * 6) > 0.7) p.set(x, y, hex('#6d5646'), 0.3);
  });
});
rule(/^pointed_dripstone_(up|down)_(tip_merge|tip|frustum|middle|base)$/, (p, m) => {
  clear(p);
  markNoTint(p);
  const up = m[1] === 'up';
  const w = { tip_merge: 1, tip: 1.5, frustum: 2.5, middle: 3.5, base: 4.5 }[m[2] as 'tip']!;
  const base = hex('#866c5b');
  p.each((x, y, u, v) => {
    const t = up ? v / 16 : 1 - v / 16; // 0 at tip end
    const hw = m[2] === 'tip' ? w * t : w;
    if (Math.abs(u - 8) <= hw) p.set(x, y, jitter(shade(base, 0.85 + (1 - Math.abs(u - 8) / (hw + 0.1)) * 0.25), 0.06, p.rnd(x, y)), 0.6);
  });
});
def('dirt', (p) => dirt(p, hex('#866043')));
def('coarse_dirt', (p) => { dirt(p, hex('#77553a')); speckle(p, [hex('#9a8e82'), hex('#5a4a3a')], 0.2, 71); });
def('rooted_dirt', (p) => {
  dirt(p, hex('#8b6446'));
  for (let i = 0; i < 5; i++) {
    const u = p.rnd(i, 1, 9) * 16, v = p.rnd(i, 2, 9) * 16;
    stem(p, u, v, u + 2, v + 3, hex('#c29d6a'), 1);
  }
});
def('grass_block_top', (p) => {
  noiseFill(p, hex('#9a9a9a'), 0.14, 0.1);
  speckle(p, [hex('#b5b5b5'), hex('#7a7a7a')], 0.15);
  p.material({ smooth: 0.12, tint: 1, bump: 1 });
});
def('grass_block_side', (p) => { dirt(p, hex('#866043')); grassFringe(p, hex('#a0a0a0'), 4); });
def('grass_block_snow', (p) => {
  dirt(p, hex('#866043'));
  for (let x = 0; x < p.n; x++) {
    const u = (x + 0.5) / p.s;
    const hang = 3 + Math.floor(p.rndC(u, 0, 5) * 2);
    for (let y = 0; y < Math.round(hang * p.s); y++) p.set(x, y, jitter(hex('#f2f5f7'), 0.03, p.rnd(x, y)), 0.7);
  }
  p.material({ tint: 0 });
});
def('podzol_top', (p) => { dirt(p, hex('#5b3f1d')); speckle(p, [hex('#7a5a26'), hex('#3c2a12'), hex('#8c6a2a')], 0.3); });
def('podzol_side', (p) => { dirt(p, hex('#866043')); fringe(p, hex('#5f431f'), 3); });
def('mycelium_top', (p) => { noiseFill(p, hex('#6f6265'), 0.12, 0.06); speckle(p, [hex('#8c7f8a'), hex('#52464c'), hex('#a594a8')], 0.3); });
def('mycelium_side', (p) => { dirt(p, hex('#866043')); fringe(p, hex('#6f6265'), 4); });
def('dirt_path_top', (p) => { noiseFill(p, hex('#94753f'), 0.1, 0.08); speckle(p, [hex('#7d6134'), hex('#a88a4d')], 0.2); });
def('dirt_path_side', (p) => { dirt(p, hex('#866043')); fringe(p, hex('#94753f'), 2); });
def('farmland', (p) => furrows(p, hex('#8f6848'), hex('#5f4430')));
def('farmland_moist', (p) => furrows(p, hex('#5a3b24'), hex('#3a2616')));
def('mud', (p) => { noiseFill(p, hex('#3c393d'), 0.06, 0.08); p.material({ smooth: 0.6 }); });
def('packed_mud', (p) => { noiseFill(p, hex('#8e6a4f'), 0.08, 0.06); speckle(p, [hex('#a8845f'), hex('#6c4f39')], 0.2); });
def('mud_bricks', (p) => bricks(p, hex('#8a6b52'), hex('#5f4839'), { rows: 4, cols: 2 }));
def('clay', (p) => { noiseFill(p, hex('#a0a6b3'), 0.05, 0.08); p.material({ smooth: 0.3 }); });
def('gravel', (p) => pebbles(p, [hex('#8b8584'), hex('#6d6868'), hex('#a39d9c'), hex('#7a7a80'), hex('#5c5555')], hex('#4f4a49'), 7));
def('sand', (p) => sandy(p, hex('#dbcf9f')));
def('red_sand', (p) => sandy(p, hex('#bd6721')));
rule(/^suspicious_(sand|gravel)_(\d)$/, (p, m) => {
  if (m[1] === 'sand') sandy(p, hex('#d4c595'));
  else pebbles(p, [hex('#8b8584'), hex('#6d6868'), hex('#a39d9c')], hex('#4f4a49'), 7);
  const d = Number(m[2]);
  p.each((x, y, u, v) => {
    const r = Math.hypot(u - 8, v - 8);
    if (r < 2 + d * 1.5 && p.rnd(x, y, 4) < 0.3) p.set(x, y, shade(p.get(x, y) as unknown as RGB, 0.7), 0.3);
  });
});
def('bedrock', (p) => {
  p.each((x, y, u, v) => {
    const vr = voronoi(p, u, v, 5, 3);
    const k = [0.25, 0.45, 0.6, 0.35, 0.5][vr.id % 5]!;
    p.set(x, y, jitter([k * 255, k * 255, k * 255], 0.08, p.grain(x, y)), k);
  });
  p.material({ bump: 1.8 });
});
def('obsidian', (p) => {
  noiseFill(p, hex('#160f22'), 0.05, 0.05);
  speckle(p, [hex('#3b2a58'), hex('#2a1d42'), hex('#0a0612')], 0.25);
  p.material({ smooth: 0.9 });
});
def('crying_obsidian', (p) => {
  noiseFill(p, hex('#1c1030'), 0.05, 0.05);
  speckle(p, [hex('#8b2fd8'), hex('#5a17a0'), hex('#c060ff')], 0.2);
  p.each((x, y) => {
    const c = p.get(x, y);
    if (c[2] > 150) p.setMat(x, y, { emit: 0.9 });
  });
  p.material({ smooth: 0.9 });
});
def('magma_block', (p) => {
  const f = p.frame;
  p.each((x, y, u, v) => {
    const vr = voronoi(p, u, v + f, 4, 5);
    const g = p.grain(x, y, f);
    if (vr.edge < 0.6) {
      const hot = 1 - vr.edge / 0.6;
      p.set(x, y, mix(hex('#8b2b10'), hex('#ffb428'), hot), 0.2);
      p.setMat(x, y, { emit: hot });
    } else p.set(x, y, jitter(hex('#5a2615'), 0.08, g), 0.7);
  });
});
def('moss_block', (p) => { noiseFill(p, hex('#596e2d'), 0.12, 0.1); speckle(p, [hex('#6d8636'), hex('#465826')], 0.3); p.material({ tint: 0, bump: 1.4 }); });
def('pale_moss_block', (p) => { noiseFill(p, hex('#8a9186'), 0.1, 0.08); speckle(p, [hex('#a3aa9f'), hex('#6f756c')], 0.3); p.material({ tint: 0 }); });
def('pale_moss_carpet', (p) => { noiseFill(p, hex('#8a9186'), 0.1, 0.08); p.material({ tint: 0 }); });
def('pale_moss_carpet_side', (p) => { clear(p); markNoTint(p); p.each((x, y, u, v) => { if (p.rndC(u, v, 3) < 0.4 + v / 40) p.set(x, y, jitter(hex('#8a9186'), 0.08, p.rnd(x, y)), 0.6); }); });
def('pale_hanging_moss', (p) => { clear(p); markNoTint(p); hangingStrands(p, hex('#8f968b'), 16); });
def('pale_hanging_moss_tip', (p) => { clear(p); markNoTint(p); hangingStrands(p, hex('#8f968b'), 11); });
def('snow', (p) => { noiseFill(p, hex('#f3f6f8'), 0.03, 0.03); p.material({ smooth: 0.3 }); });
def('snow_block', (p) => { noiseFill(p, hex('#f3f6f8'), 0.03, 0.03); p.material({ smooth: 0.3 }); });
def('powder_snow', (p) => { noiseFill(p, hex('#f6f9fb'), 0.04, 0.05); p.material({ smooth: 0.1 }); });
def('ice', (p) => iceTex(p, [145, 183, 253, 180]));
rule(/^frosted_ice_(\d)$/, (p, m) => { iceTex(p, [150, 190, 253, 190]); crackN(p, Number(m[1])); });
def('packed_ice', (p) => { noiseFill(p, hex('#8db4f8'), 0.05, 0.07); crack(p, hex('#b7d0fa')); p.material({ smooth: 0.8 }); });
def('blue_ice', (p) => { noiseFill(p, hex('#74a8fd'), 0.05, 0.07); crack(p, hex('#9ec3ff')); p.material({ smooth: 0.9 }); });

// ---------------------------------------------------------------------------------------------
// Ores and mineral blocks
// ---------------------------------------------------------------------------------------------
const ORE_COLORS: Record<string, [RGB, RGB, 'blob' | 'crystal' | 'nugget']> = {
  coal: [hex('#2b2b2b'), hex('#4a4a4a'), 'blob'], iron: [hex('#c69b7a'), hex('#e3c0a3'), 'nugget'],
  copper: [hex('#c26a3c'), hex('#6fbf95'), 'nugget'], gold: [hex('#f5cf2a'), hex('#fff39a'), 'nugget'],
  flux: [hex('#b3120e'), hex('#ff4a3a'), 'blob'], emerald: [hex('#18b44e'), hex('#8ff5b2'), 'crystal'],
  lapis: [hex('#2446a6'), hex('#4d78e8'), 'blob'], diamond: [hex('#3fd9d0'), hex('#bafaf4'), 'crystal'],
};
rule(/^(deepslate_)?(coal|iron|copper|gold|flux|emerald|lapis|diamond)_ore(_lit)?$/, (p, m) => {
  const [c, l, sh] = ORE_COLORS[m[2]!]!;
  const host = m[1] ? (q: Painter) => { stone(q, DEEPSLATE, { variance: 0.07 }); } : (q: Painter) => stone(q, STONE, { cracks: 0.4 });
  ore(p, host, c, l, 5, sh);
  if (m[3]) p.each((x, y) => { const k = p.get(x, y); if (k[0] > 150 && k[1] < 100) p.setMat(x, y, { emit: 1 }); });
});
def('cinder_gold_ore', (p) => ore(p, cinderrack, hex('#f5cf2a'), hex('#fff39a'), 6, 'nugget'));
def('cinder_quartz_ore', (p) => ore(p, cinderrack, hex('#e8e1d6'), hex('#ffffff'), 5, 'crystal'));
def('ancient_debris_side', (p) => {
  noiseFill(p, hex('#5e4239'), 0.08, 0.08);
  p.each((x, y, u, v) => { if (Math.sin(u * 2 + p.fbm(u, v, 3, 2, 3) * 5) > 0.6) p.set(x, y, hex('#3b2822'), 0.3); });
  speckle(p, [hex('#7d5d52'), hex('#a4847a')], 0.1);
});
def('ancient_debris_top', (p) => {
  noiseFill(p, hex('#6a4b42'), 0.08, 0.08);
  p.each((x, y, u, v) => { const r = Math.hypot(u - 8, v - 8); if (Math.abs(r - 3.5) < 0.6 || Math.abs(r - 6.5) < 0.6) p.set(x, y, hex('#3e2a24'), 0.3); });
});
def('coal_block', (p) => { noiseFill(p, hex('#1b1b1c'), 0.06, 0.05); speckle(p, [hex('#303033'), hex('#0e0e0f')], 0.3); });
def('iron_block', (p) => metalBlock(p, hex('#d8d8d8'), { rivets: false }));
def('gold_block', (p) => metalBlock(p, hex('#f5d23a'), { smooth: 0.85 }));
def('diamond_block', (p) => gemBlock(p, hex('#5ee6dd'), hex('#d4fffb'), hex('#2a9f98')));
def('emerald_block', (p) => gemBlock(p, hex('#2dcc62'), hex('#b4ffcf'), hex('#118a3b')));
def('lapis_block', (p) => { gemBlock(p, hex('#2549ab'), hex('#5e84ea'), hex('#162d73')); p.material({ smooth: 0.4 }); });
def('flux_block', (p) => { metalBlock(p, hex('#b0140f'), { smooth: 0.5 }); speckle(p, [hex('#ff4a3a')], 0.1); p.material({ metal: 0 }); });
def('infernium_block', (p) => metalBlock(p, hex('#3d3a3a'), { rivets: true, smooth: 0.8 }));
def('raw_iron_block', (p) => rawBlock(p, hex('#a7866b'), hex('#d4b89f')));
def('raw_copper_block', (p) => rawBlock(p, hex('#b0613a'), hex('#e0915f')));
def('raw_gold_block', (p) => rawBlock(p, hex('#d2a42a'), hex('#fbe16a')));
def('amethyst_block', (p) => crystalTex(p, hex('#8a5cc4'), hex('#c9a3f5')));
def('budding_amethyst', (p) => { crystalTex(p, hex('#7e53b6'), hex('#c29bf2')); speckle(p, [hex('#e7d0ff')], 0.08); });
rule(/^(small_amethyst_bud|medium_amethyst_bud|large_amethyst_bud|amethyst_cluster)$/, (p, m) => {
  clear(p); markNoTint(p);
  const h = { small_amethyst_bud: 5, medium_amethyst_bud: 8, large_amethyst_bud: 11, amethyst_cluster: 14 }[m[1] as 'small_amethyst_bud']!;
  for (let i = 0; i < 3; i++) {
    const u = 5 + i * 3;
    const hh = h * (i === 1 ? 1 : 0.75);
    p.each((x, y, uu, vv) => {
      if (vv > 16 - hh && Math.abs(uu - u) < 1.5 * (1 - (16 - vv) / (hh + 1)) + 0.5) p.set(x, y, mix(hex('#8a5cc4'), hex('#e2c8ff'), (16 - vv) / hh), 0.7);
    });
  }
  p.material({ smooth: 0.8, emit: 0.3 });
});
def('glowstone', (p) => {
  p.each((x, y, u, v) => {
    const vr = voronoi(p, u, v, 5, 8);
    const k = Math.min(1, vr.edge / 1.5);
    p.set(x, y, mix(hex('#8a6a36'), hex('#ffe7a0'), k), 0.3 + k * 0.5);
    p.setMat(x, y, { emit: 0.4 + k * 0.6 });
  });
});
def('sea_lantern', (p) => {
  const f = p.frame;
  p.each((x, y, u, v) => {
    const edge = Math.min(u, v, 16 - u, 16 - v);
    const w = Math.sin((u + v) * 0.6 + f * 0.8) * 0.5 + 0.5;
    const c = edge < 2 ? hex('#a7c6bd') : mix(hex('#cfe7df'), hex('#f5fffb'), w);
    p.set(x, y, c, edge < 2 ? 0.4 : 0.6);
    p.setMat(x, y, { emit: edge < 2 ? 0.3 : 0.8 });
  });
});

// ---------------------------------------------------------------------------------------------
// Building stones
// ---------------------------------------------------------------------------------------------
def('cobblestone', (p) => cobble(p, hex('#7d7d7d'), hex('#4a4a4a'), 5));
def('mossy_cobblestone', (p) => { cobble(p, hex('#7d7d7d'), hex('#4a4a4a'), 5); moss(p); });
def('stone_bricks', (p) => bricks(p, hex('#7c7c7c'), hex('#565656'), { rows: 4, cols: 2 }));
def('mossy_stone_bricks', (p) => { bricks(p, hex('#7c7c7c'), hex('#565656'), { rows: 4, cols: 2 }); moss(p); });
def('cracked_stone_bricks', (p) => { bricks(p, hex('#797979'), hex('#545454'), { rows: 4, cols: 2 }); crack(p, hex('#444444')); });
def('chiseled_stone_bricks', (p) => chiseledPattern(p, hex('#7c7c7c'), hex('#505050')));
def('bricks', (p) => bricks(p, hex('#96503e'), hex('#b4a79b'), { rows: 4, cols: 2, vary: 0.25 }));
function sandstoneTex(p: Painter, base: RGB, kind: string): void {
  const dark = shade(base, 0.82);
  if (kind === 'top') { sandy(p, base); return; }
  if (kind === 'bottom') { sandy(p, shade(base, 0.96)); p.each((x, y, u, v) => { if (v > 13) p.set(x, y, dark, 0.3); }); return; }
  if (kind === 'cut') { sandy(p, base); p.each((x, y, u, v) => { if (v % 8 < 1 || u < 1 || u > 15) p.set(x, y, dark, 0.2); }); return; }
  if (kind === 'chiseled') {
    sandy(p, base);
    p.each((x, y, u, v) => {
      if (v < 2 || v > 14) p.set(x, y, dark, 0.3);
      const du = Math.abs(u - 8), dv = Math.abs(v - 8);
      if ((Math.abs(du - dv) < 0.6 && du < 4) || (du < 1 && dv < 1)) p.set(x, y, dark, 0.2);
    });
    return;
  }
  sandy(p, base);
  p.each((x, y, u, v) => {
    if (v < 3) p.set(x, y, shade(base, 1.05), 0.6);
    if (Math.abs(v - 3) < 0.5 || (v > 11 && Math.sin(u * 1.2 + v) > 0.6)) p.set(x, y, dark, 0.3);
  });
}
rule(/^(red_)?sandstone(_top|_bottom)?$/, (p, m) => sandstoneTex(p, m[1] ? hex('#b75e20') : hex('#d8cb99'), m[2] ? m[2].slice(1) : 'side'));
rule(/^(chiseled|cut)_(red_)?sandstone$/, (p, m) => sandstoneTex(p, m[2] ? hex('#b75e20') : hex('#d8cb99'), m[1]!));
def('prismarine', (p) => {
  const f = p.frame;
  p.each((x, y, u, v) => {
    const vr = voronoi(p, u, v, 4, 5);
    const hue = (Math.sin(f * 0.8 + vr.id) + 1) / 2;
    const c = mix(hex('#5d9e8f'), hex('#6fa7b0'), hue);
    p.set(x, y, vr.edge < 0.5 ? shade(c, 0.7) : jitter(c, 0.08, p.grain(x, y)), vr.edge < 0.5 ? 0.2 : 0.6);
  });
  p.material({ smooth: 0.5 });
});
def('prismarine_bricks', (p) => bricks(p, hex('#63ab9c'), hex('#3f7a6e'), { rows: 4, cols: 2 }));
def('dark_prismarine', (p) => { tiles(p, hex('#335b4c'), hex('#1f3a30'), 2); speckle(p, [hex('#46725f')], 0.2); });
def('quartz_block_side', (p) => { polished(p, hex('#ece6df')); p.material({ smooth: 0.6 }); });
def('quartz_block_top', (p) => { polished(p, hex('#ece6df')); p.material({ smooth: 0.6 }); });
def('quartz_block_bottom', (p) => { noiseFill(p, hex('#e9e3dc'), 0.03, 0.03); p.material({ smooth: 0.6 }); });
def('chiseled_quartz_block', (p) => { polished(p, hex('#e8e2da')); p.each((x, y, u, v) => { if ((v > 3 && v < 4) || (v > 12 && v < 13) || (Math.abs(u - 8) < 0.5 && v > 4 && v < 12)) p.set(x, y, hex('#c8c1b8'), 0.2); }); });
def('chiseled_quartz_block_top', (p) => { polished(p, hex('#e8e2da')); centerInlay(p, hex('#c8c1b8'), 4); });
def('quartz_pillar', (p) => { noiseFill(p, hex('#ebe5de'), 0.03, 0.02); p.each((x, y, u) => { if (u < 1 || u > 15 || Math.abs(u - 5) < 0.4 || Math.abs(u - 11) < 0.4) p.set(x, y, hex('#cfc8bf'), 0.2); }); });
def('quartz_pillar_top', (p) => { polished(p, hex('#ebe5de')); centerInlay(p, hex('#cfc8bf'), 5); });
def('quartz_bricks', (p) => bricks(p, hex('#ebe4dc'), hex('#c9c1b7'), { rows: 4, cols: 2, vary: 0.05 }));
def('purpur_block', (p) => tiles(p, hex('#a77ba7'), hex('#80597f'), 2));
def('purpur_pillar', (p) => { noiseFill(p, hex('#aa7eaa'), 0.05, 0.03); p.each((x, y, u) => { if (Math.abs(u - 4) < 0.5 || Math.abs(u - 12) < 0.5) p.set(x, y, hex('#86608a'), 0.2); }); });
def('purpur_pillar_top', (p) => { polished(p, hex('#aa7eaa')); centerInlay(p, hex('#86608a'), 5); });
def('verge_stone', (p) => { stone(p, hex('#dcde9d'), { variance: 0.07 }); speckle(p, [hex('#c1c283'), hex('#e9ebb4'), hex('#b0b172')], 0.25); });
def('verge_stone_bricks', (p) => bricks(p, hex('#dcde9d'), hex('#b3b47a'), { rows: 4, cols: 2, vary: 0.06 }));
function cinderrack(p: Painter): void {
  noiseFill(p, hex('#6f2e2e'), 0.12, 0.08);
  speckle(p, [hex('#8c3d3a'), hex('#4c1e1e'), hex('#a5524e')], 0.3);
}
def('cinderrack', (p) => cinderrack(p));
def('cinder_bricks', (p) => bricks(p, hex('#3c1d22'), hex('#200d10'), { rows: 4, cols: 2 }));
def('cracked_cinder_bricks', (p) => { bricks(p, hex('#3c1d22'), hex('#200d10'), { rows: 4, cols: 2 }); crack(p, hex('#170a0c')); });
def('chiseled_cinder_bricks', (p) => chiseledPattern(p, hex('#3c1d22'), hex('#1f0c10')));
def('red_cinder_bricks', (p) => bricks(p, hex('#480a0c'), hex('#2a0507'), { rows: 4, cols: 2 }));
def('blackstone', (p) => { stone(p, hex('#2b272f'), { variance: 0.08 }); speckle(p, [hex('#3e3945'), hex('#1b181d')], 0.25); });
def('blackstone_top', (p) => { stone(p, hex('#2f2a33'), { variance: 0.06 }); p.each((x, y, u, v) => { const r = Math.hypot(u - 8, v - 8); if (Math.abs(r - 5) < 0.5) p.set(x, y, hex('#1b181d'), 0.2); }); });
def('gilded_blackstone', (p) => { stone(p, hex('#2b272f'), { variance: 0.08 }); speckle(p, [hex('#f0c02e'), hex('#d49b1d')], 0.12, 44, 0.8); });
def('polished_blackstone', (p) => polished(p, hex('#36303b')));
def('polished_blackstone_bricks', (p) => bricks(p, hex('#342e39'), hex('#1e1a21'), { rows: 4, cols: 2 }));
def('cracked_polished_blackstone_bricks', (p) => { bricks(p, hex('#342e39'), hex('#1e1a21'), { rows: 4, cols: 2 }); crack(p, hex('#151217')); });
def('chiseled_polished_blackstone', (p) => chiseledPattern(p, hex('#36303b'), hex('#1e1a21')));
def('basalt_side', (p) => { noiseFill(p, hex('#4b4b52'), 0.08, 0.04); p.each((x, y, u, v) => { if (p.vnoise(u * 3, v * 0.3, 4, 8) < 0.35) p.set(x, y, hex('#35353b'), 0.3); }); });
def('basalt_top', (p) => { stone(p, hex('#57575e'), { variance: 0.06 }); p.each((x, y, u, v) => { const r = Math.hypot(u - 8, v - 8); if (Math.abs(r - 4) < 0.5 || Math.abs(r - 7) < 0.4) p.set(x, y, hex('#3b3b41'), 0.3); }); });
def('polished_basalt_side', (p) => { noiseFill(p, hex('#5a5a61'), 0.04, 0.03); p.each((x, y, u) => { if (u % 4 < 0.6) p.set(x, y, hex('#44444a'), 0.3); }); });
def('polished_basalt_top', (p) => polished(p, hex('#5d5d64')));
def('smooth_basalt', (p) => polished(p, hex('#48474d')));
def('resin_block', (p) => { noiseFill(p, hex('#d9661f'), 0.06, 0.1); speckle(p, [hex('#f59a3b'), hex('#b84f12')], 0.2); p.material({ smooth: 0.7 }); });
def('resin_bricks', (p) => bricks(p, hex('#ce5f1a'), hex('#8e3e0f'), { rows: 4, cols: 2 }));
def('chiseled_resin_bricks', (p) => chiseledPattern(p, hex('#ce5f1a'), hex('#8e3e0f')));
def('bone_block_side', (p) => { noiseFill(p, hex('#e3dfc5'), 0.04, 0.03); p.each((x, y, u) => { if (u < 1 || u > 15) p.set(x, y, hex('#c8c3a6'), 0.3); }); });
def('bone_block_top', (p) => { noiseFill(p, hex('#e0dcc0'), 0.04, 0.03); p.disc(8, 8, 3, (x, y) => p.set(x, y, hex('#c6c1a3'), 0.3)); p.disc(8, 8, 1.5, (x, y) => p.set(x, y, hex('#a8a386'), 0.2)); });
def('honeycomb_block', (p) => { p.each((x, y, u, v) => { const vr = voronoi(p, u, v, 4, 2); p.set(x, y, vr.edge < 0.6 ? hex('#b86a11') : mix(hex('#e59a1f'), hex('#f6c14a'), vr.edge / 3), vr.edge < 0.6 ? 0.2 : 0.6); }); p.material({ smooth: 0.6 }); });
def('honey_block_top', (p) => { noiseFill(p, hex('#f4a52e'), 0.04, 0.04); p.each((x, y, u, v) => p.setAlpha(x, y, Math.min(u, v, 16 - u, 16 - v) < 1 ? 255 : 190)); p.material({ smooth: 0.9 }); });
def('honey_block_side', (p) => { noiseFill(p, hex('#f09b24'), 0.04, 0.04); p.each((x, y, u, v) => p.setAlpha(x, y, Math.min(u, v, 16 - u, 16 - v) < 1 ? 255 : 190)); p.material({ smooth: 0.9 }); });
def('honey_block_bottom', (p) => { noiseFill(p, hex('#e18c1a'), 0.04, 0.04); p.each((x, y) => p.setAlpha(x, y, 200)); });
def('slime_block', (p) => { p.each((x, y, u, v) => { const edge = Math.min(u, v, 16 - u, 16 - v); const c = edge < 1 ? hex('#5ea64a') : edge < 3 ? hex('#8ad97a') : hex('#79c05f'); p.set(x, y, [c[0], c[1], c[2], edge < 1 ? 230 : 170], 0.6); }); p.material({ smooth: 0.8 }); });
def('sponge', (p) => { p.each((x, y, u, v) => { const vr = voronoi(p, u, v, 6, 4); p.set(x, y, vr.d1 < 0.8 ? hex('#8e7d22') : jitter(hex('#c7b73c'), 0.07, p.grain(x, y)), vr.d1 < 0.8 ? 0.1 : 0.6); }); p.material({ bump: 1.6 }); });
def('wet_sponge', (p) => { p.each((x, y, u, v) => { const vr = voronoi(p, u, v, 6, 4); p.set(x, y, vr.d1 < 0.8 ? hex('#6f6219') : jitter(hex('#a59a33'), 0.07, p.grain(x, y)), vr.d1 < 0.8 ? 0.1 : 0.6); }); p.material({ smooth: 0.6 }); });
def('hay_block_side', (p) => { p.each((x, y, u, v) => { const s = p.vnoise(u * 3, v * 0.3, 8, 2); let c = mix(hex('#a8870f'), hex('#d8b62b'), s); if (Math.abs(v - 4) < 0.6 || Math.abs(v - 12) < 0.6) c = hex('#7a4f16'); p.set(x, y, jitter(c, 0.05, p.grain(x, y)), s); }); });
def('hay_block_top', (p) => { p.each((x, y, u, v) => { const r = Math.hypot(u - 8, v - 8); const s = p.vnoise(u, v, 8, 3); p.set(x, y, jitter(mix(hex('#b08f16'), hex('#d8b62b'), s), 0.06, p.grain(x, y)), 0.5 + (r % 2) * 0.1); }); });
def('dried_kelp_side', (p) => { p.each((x, y, u, v) => { const s = p.vnoise(u * 3, v * 0.3, 8, 4); p.set(x, y, jitter(mix(hex('#2f3b1e'), hex('#4a5a2b'), s), 0.06, p.grain(x, y)), s); }); });
def('dried_kelp_top', (p) => { noiseFill(p, hex('#3a4722'), 0.08, 0.08); p.each((x, y, u, v) => { if (Math.abs(Math.hypot(u - 8, v - 8) - 5) < 0.6) p.set(x, y, hex('#27301a'), 0.2); }); });
rule(/^(ochre|verdant|pearlescent)_froglight_(top|side)$/, (p, m) => {
  const col = { ochre: [hex('#f7e3a3'), hex('#d8a64f')], verdant: [hex('#e3f5d2'), hex('#8fbf7a')], pearlescent: [hex('#f5e2ef'), hex('#c69ac9')] }[m[1] as 'ochre']!;
  p.each((x, y, u, v) => {
    const edge = Math.min(u, v, 16 - u, 16 - v);
    const k = m[2] === 'top' ? Math.hypot(u - 8, v - 8) / 11 : edge < 2 ? 1 : 0.2;
    p.set(x, y, mix(col[0]!, col[1]!, Math.min(1, k)), 0.5);
    p.setMat(x, y, { emit: 1 - Math.min(1, k) * 0.4 });
  });
});
def('glowcap', (p) => { p.each((x, y, u, v) => { const vr = voronoi(p, u, v, 5, 9); const k = Math.min(1, vr.edge / 1.4); p.set(x, y, mix(hex('#e36f2a'), hex('#ffd98a'), k), 0.3 + k * 0.4); p.setMat(x, y, { emit: 0.5 + k * 0.5 }); }); });
def('ember_wart_block', (p) => wartBlock(p, hex('#7d0e0e'), hex('#a3201c')));
def('warped_wart_block', (p) => wartBlock(p, hex('#167a6f'), hex('#27a597')));
rule(/^(crimson|warped)_nylium$/, (p, m) => { const c = m[1] === 'crimson' ? hex('#8e1d1d') : hex('#2a8272'); noiseFill(p, c, 0.12, 0.1); speckle(p, [shade(c, 1.3), shade(c, 0.7)], 0.3); p.material({ tint: 0 }); });
rule(/^(crimson|warped)_nylium_side$/, (p, m) => { cinderrack(p); fringe(p, m[1] === 'crimson' ? hex('#8e1d1d') : hex('#2a8272'), 4); });
def('soul_sand', (p) => { noiseFill(p, hex('#50392b'), 0.1, 0.06); p.each((x, y, u, v) => { const vr = voronoi(p, u, v, 3, 6); if (vr.d1 < 1.5) { const d = vr.d1; if ((d > 0.4 && d < 0.8) || (d < 0.3)) p.set(x, y, hex('#2c1f16'), 0.2); } }); });
def('soul_soil', (p) => { noiseFill(p, hex('#4b3a2d'), 0.1, 0.1); speckle(p, [hex('#63503f'), hex('#352a20')], 0.25); });

// ---------------------------------------------------------------------------------------------
// Wood
// ---------------------------------------------------------------------------------------------
rule(/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_planks$/, (p, m) => {
  planks(p, PLANKS[m[1]!]!, { boards: m[1] === 'bamboo' ? 8 : 4 });
});
def('bamboo_mosaic', (p) => {
  const b = PLANKS.bamboo!;
  p.each((x, y, u, v) => {
    const cell = (Math.floor(u / 8) + Math.floor(v / 8)) % 2;
    const inner = cell ? u % 8 : v % 8;
    let c = shade(b, 0.9 + (inner % 4 < 1 ? -0.15 : 0.05));
    if (u % 8 < 0.6 || v % 8 < 0.6) c = shade(b, 0.6);
    p.set(x, y, jitter(c, 0.04, p.grain(x, y)), 0.5);
  });
});
rule(/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/, (p, m) => {
  const [b, d] = BARK[m[1]!]!;
  if (m[1] === 'birch') {
    noiseFill(p, b, 0.04, 0.03);
    for (let i = 0; i < 7; i++) {
      const u = p.rnd(i, 0, 3) * 16, v = p.rnd(i, 1, 3) * 16, w = 1 + p.rnd(i, 2, 3) * 3;
      p.fillRect(u, v, u + w, v + 1, d, 0.2);
    }
    return;
  }
  bark(p, b, d);
});
rule(/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log_top$/, (p, m) => {
  const pl = PLANKS[m[1]!]!;
  logTop(p, pl, shade(pl, 0.8), BARK[m[1]!]![0]);
});
rule(/^stripped_(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/, (p, m) => strippedSide(p, shade(PLANKS[m[1]!]!, 0.95)));
rule(/^stripped_(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log_top$/, (p, m) => {
  const pl = PLANKS[m[1]!]!;
  logTop(p, pl, shade(pl, 0.82), shade(pl, 0.9));
});
rule(/^(crimson|warped)_stem$/, (p, m) => {
  const [b, d] = BARK[m[1]!]!;
  bark(p, b, shade(b, 0.7));
  speckle(p, [d], 0.12, 8, 0.7);
  p.each((x, y) => { const c = p.get(x, y); if (Math.abs(c[0] - d[0]) < 20 && Math.abs(c[1] - d[1]) < 20) p.setMat(x, y, { emit: 0.4 }); });
});
rule(/^(crimson|warped)_stem_top$/, (p, m) => logTop(p, PLANKS[m[1]!]!, shade(PLANKS[m[1]!]!, 0.8), BARK[m[1]!]![0]));
rule(/^stripped_(crimson|warped)_stem$/, (p, m) => strippedSide(p, shade(PLANKS[m[1]!]!, 1.05)));
rule(/^stripped_(crimson|warped)_stem_top$/, (p, m) => logTop(p, PLANKS[m[1]!]!, shade(PLANKS[m[1]!]!, 0.85), shade(PLANKS[m[1]!]!, 0.95)));
def('bamboo_block', (p) => { p.each((x, y, u, v) => { let c = shade(hex('#7a8f2a'), 0.9 + p.vnoise(u, v, 4, 2) * 0.2); if (u % 8 < 1) c = hex('#5c6c1d'); if (Math.abs(v - 4) < 0.5 || Math.abs(v - 12) < 0.5) c = hex('#a6ba48'); p.set(x, y, jitter(c, 0.04, p.grain(x, y)), 0.5); }); });
def('bamboo_block_top', (p) => { p.each((x, y, u, v) => { const inner = u % 8 > 1 && u % 8 < 7 && v % 8 > 1 && v % 8 < 7; p.set(x, y, inner ? hex('#d7c07a') : hex('#6f8a24'), inner ? 0.4 : 0.6); }); });
def('stripped_bamboo_block', (p) => { p.each((x, y, u, v) => { let c = shade(hex('#c9b04e'), 0.9 + p.vnoise(u, v, 4, 2) * 0.2); if (u % 8 < 1) c = hex('#a88f33'); p.set(x, y, jitter(c, 0.04, p.grain(x, y)), 0.5); }); });
def('stripped_bamboo_block_top', (p) => { p.each((x, y, u, v) => { const inner = u % 8 > 1 && u % 8 < 7 && v % 8 > 1 && v % 8 < 7; p.set(x, y, inner ? hex('#e6d69b') : hex('#c2a946'), 0.5); }); });
rule(/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove)_leaves$/, (p) => leaves(p, LEAF_BASE, 0.16));
def('cherry_leaves', (p) => { leaves(p, hex('#e8a3c4'), 0.2, 3, [hex('#f7cfe0'), hex('#d77aa5')]); markNoTint(p); });
def('pale_oak_leaves', (p) => { leaves(p, hex('#8d928a'), 0.15, 4); markNoTint(p); });
def('azalea_leaves', (p) => { leaves(p, hex('#5d7c2a'), 0.12, 5); markNoTint(p); });
def('flowering_azalea_leaves', (p) => { leaves(p, hex('#5d7c2a'), 0.12, 5, [hex('#d67ac4'), hex('#e9a0d8')]); markNoTint(p); });
rule(/^(oak|spruce|birch|jungle|acacia|dark_oak|cherry|pale_oak)_sapling$/, (p, m) => sapling(p, m[1]!));
def('mangrove_propagule', (p) => { clear(p); markNoTint(p); stem(p, 8, 4, 8, 15, hex('#6b8a3a'), 1); blob(p, 8, 4, 2, hex('#5c7d2d')); blob(p, 8, 15, 1, hex('#8a6f3a')); });
rule(/^mangrove_propagule_hanging_(\d)$/, (p, m) => { clear(p); markNoTint(p); const len = 4 + Number(m[1]) * 2.5; stem(p, 8, 0, 8, len, hex('#6b8a3a'), 1); blob(p, 8, 1, 2, hex('#5c7d2d')); });
rule(/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_door_(top|bottom)$/, (p, m) => door(p, PLANKS[m[1]!]!, m[2] === 'top', m[1]!));
rule(/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_trapdoor$/, (p, m) => trapdoorTex(p, PLANKS[m[1]!]!, m[1]!));
rule(/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_shelf$/, (p, m) => {
  planks(p, shade(PLANKS[m[1]!]!, 0.95), { boards: 2 });
  p.each((x, y, u, v) => { if (u < 1 || u > 15 || v < 1 || v > 15) p.set(x, y, shade(PLANKS[m[1]!]!, 0.7), 0.3); });
});
def('iron_door_top', (p) => { metalBlock(p, hex('#cfcfcf')); p.each((x, y, u, v) => { if (u > 3 && u < 13 && v > 3 && v < 12) p.set(x, y, hex('#9a9a9a'), 0.3); }); });
def('iron_door_bottom', (p) => { metalBlock(p, hex('#cfcfcf')); p.each((x, y, u, v) => { if (u > 3 && u < 13 && v > 4 && v < 13 && (Math.floor(v) % 3 === 0)) p.set(x, y, hex('#9a9a9a'), 0.3); }); });
def('iron_trapdoor', (p) => { metalBlock(p, hex('#cfcfcf')); p.each((x, y, u, v) => { if ((u > 2 && u < 7 || u > 9 && u < 14) && (v > 2 && v < 7 || v > 9 && v < 14)) p.set(x, y, [0, 0, 0, 0], 0); }); });

// ---------------------------------------------------------------------------------------------
// Coloured families
// ---------------------------------------------------------------------------------------------
const COLOR_RE = '(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)';
rule(new RegExp(`^${COLOR_RE}_wool$`), (p, m) => wool(p, DYE[m[1]!]!));
rule(new RegExp(`^${COLOR_RE}_concrete$`), (p, m) => concrete(p, shade(DYE[m[1]!]!, 0.92)));
rule(new RegExp(`^${COLOR_RE}_concrete_powder$`), (p, m) => powder(p, mix(DYE[m[1]!]!, hex('#ffffff'), 0.12)));
rule(new RegExp(`^${COLOR_RE}_terracotta$`), (p, m) => terracotta(p, TERRA[m[1]!]!));
def('terracotta', (p) => terracotta(p, hex('#985e43')));
rule(new RegExp(`^${COLOR_RE}_glazed_terracotta$`), (p, m) => {
  const c = DYE[m[1]!]!;
  const accent = m[1] === 'white' ? hex('#5fb3d6') : m[1] === 'black' ? hex('#b02a2a') : mix(c, hex('#ffffff'), 0.5);
  glazed(p, c, accent, shade(c, 0.55), Object.keys(DYE).indexOf(m[1]!));
});
rule(new RegExp(`^${COLOR_RE}_stained_glass$`), (p, m) => { const c = DYE[m[1]!]!; glass(p, [c[0], c[1], c[2], 120], shade(c, 0.8)); markNoTint(p); });
rule(new RegExp(`^${COLOR_RE}_stained_glass_pane_top$`), (p, m) => { const c = DYE[m[1]!]!; p.each((x, y) => p.set(x, y, shade(c, 0.8))); markNoTint(p); });
def('glass', (p) => { glass(p, null, hex('#dbe9ec')); markNoTint(p); });
def('glass_pane_top', (p) => { p.each((x, y) => p.set(x, y, hex('#dbe9ec'))); markNoTint(p); });
def('tinted_glass', (p) => { glass(p, [44, 38, 52, 200], hex('#3a3342')); markNoTint(p); });
rule(new RegExp(`^(${COLOR_RE}_)?candle$`), (p, m) => {
  const c = m[2] ? DYE[m[2]!]! : hex('#e8d8b0');
  noiseFill(p, c, 0.04, 0.03);
  p.each((x, y, u, v) => { if (v < 2) p.set(x, y, shade(c, 1.1), 0.7); });
  p.material({ smooth: 0.5 });
});
def('candle_wick', (p) => { p.each((x, y) => p.set(x, y, hex('#2b2b2b'))); });
def('candle_wick_lit', (p) => { p.each((x, y, u, v) => { p.set(x, y, v < 8 ? hex('#ffcf5a') : hex('#ffe9a8')); p.setMat(x, y, { emit: 1 }); }); });
rule(new RegExp(`^${COLOR_RE}_bed_top$`), (p, m) => {
  const c = DYE[m[1]!]!;
  p.each((x, y, u, v) => {
    if (v < 5) p.set(x, y, jitter(hex('#ecebe6'), 0.03, p.grain(x, y)), 0.7);
    else p.set(x, y, jitter(shade(c, 0.95 + (Math.floor(u / 2) % 2) * 0.05), 0.04, p.grain(x, y)), 0.6);
  });
  p.material({ tint: 0 });
});
rule(new RegExp(`^${COLOR_RE}_bed_side$`), (p, m) => { wool(p, DYE[m[1]!]!); p.material({ tint: 0 }); });
def('bed_bottom', (p) => planks(p, PLANKS.oak!));
def('bed_leg', (p) => planks(p, shade(PLANKS.oak!, 0.8)));
rule(new RegExp(`^${COLOR_RE}_banner_cloth$`), (p, m) => { wool(p, DYE[m[1]!]!); p.material({ tint: 0 }); });
def('banner_pole', (p) => strippedSide(p, PLANKS.oak!));
rule(new RegExp(`^(${COLOR_RE}_)?shell_box_(top|side|bottom)$`), (p, m) => {
  const c = m[2] ? DYE[m[2]!]! : hex('#8b5f8e');
  const kind = m[3];
  p.each((x, y, u, v) => {
    const edge = Math.min(u, v, 16 - u, 16 - v);
    let col = jitter(c, 0.04, p.grain(x, y));
    if (kind === 'side' && Math.abs(v - 8) < 1) col = shade(c, 0.6);
    if (edge < 1) col = shade(c, 0.75);
    if (kind === 'top' && Math.hypot(u - 8, v - 8) < 3) col = shade(c, 1.15);
    p.set(x, y, col, edge < 1 ? 0.3 : 0.6);
  });
  p.material({ smooth: 0.5, tint: 0 });
});

// ---------------------------------------------------------------------------------------------
// Copper (4 oxidation stages)
// ---------------------------------------------------------------------------------------------
const OX: Record<string, [RGB, RGB]> = {
  '': [hex('#c46b4a'), hex('#e08b64')], exposed_: [hex('#a67e6a'), hex('#8fa27c')],
  weathered_: [hex('#6fa074'), hex('#58866c')], oxidized_: [hex('#4fab91'), hex('#3a8a72')],
};
function copperBase(p: Painter, ox: string): void {
  const [a, b] = OX[ox]!;
  p.each((x, y, u, v) => {
    const k = p.fbm(u, v, 3, 3, 4);
    p.set(x, y, jitter(mix(a, b, k), 0.04, p.grain(x, y)), 0.5 + (k - 0.5) * 0.3);
  });
  p.material({ smooth: ox === 'oxidized_' ? 0.2 : 0.7 - (ox ? 0.25 : 0), metal: ox === 'oxidized_' ? 0.2 : 0.9 - (ox === 'weathered_' ? 0.4 : 0), tint: 0 });
}
rule(/^(exposed_|weathered_|oxidized_)?copper_block$/, (p, m) => { copperBase(p, m[1] ?? ''); p.each((x, y, u, v) => { if (Math.min(u, v, 16 - u, 16 - v) < 1) p.set(x, y, shade(OX[m[1] ?? '']![0], 0.8), 0.3); }); });
rule(/^(exposed_|weathered_|oxidized_)?cut_copper$/, (p, m) => { copperBase(p, m[1] ?? ''); p.each((x, y, u, v) => { if (u % 8 < 1 || v % 8 < 1) p.set(x, y, shade(OX[m[1] ?? '']![0], 0.7), 0.2); }); });
rule(/^(exposed_|weathered_|oxidized_)?chiseled_copper$/, (p, m) => { copperBase(p, m[1] ?? ''); centerInlay(p, shade(OX[m[1] ?? '']![0], 0.7), 4); });
rule(/^(exposed_|weathered_|oxidized_)?copper_grate$/, (p, m) => { copperBase(p, m[1] ?? ''); p.each((x, y, u, v) => { if (u % 4 > 1 && v % 4 > 1) p.set(x, y, [0, 0, 0, 0], 0); }); });
rule(/^(exposed_|weathered_|oxidized_)?copper_door_(top|bottom)$/, (p, m) => { copperBase(p, m[1] ?? ''); p.each((x, y, u, v) => { if (u < 1 || u > 15 || (m[2] === 'top' && u > 3 && u < 13 && v > 3 && v < 12 && (u % 4 > 1))) p.set(x, y, [0, 0, 0, m[2] === 'top' && u > 1 && u < 15 ? 0 : 255], 0.3); }); });
rule(/^(exposed_|weathered_|oxidized_)?copper_trapdoor$/, (p, m) => { copperBase(p, m[1] ?? ''); p.each((x, y, u, v) => { if (u > 3 && u < 13 && v > 3 && v < 13 && ((u + v) % 4 < 1)) p.set(x, y, [0, 0, 0, 0], 0); }); });
rule(/^(exposed_|weathered_|oxidized_)?copper_bulb(_lit)?(_powered)?$/, (p, m) => {
  copperBase(p, m[1] ?? '');
  p.each((x, y, u, v) => {
    if (u > 3 && u < 13 && v > 3 && v < 13) {
      p.set(x, y, m[2] ? hex('#ffd98a') : hex('#6b4a3a'), 0.4);
      if (m[2]) p.setMat(x, y, { emit: 1, metal: 0 });
    }
    if (m[3] && Math.abs(u - 8) < 1 && Math.abs(v - 8) < 1) p.set(x, y, hex('#ff3a2a'), 0.5);
  });
});
rule(/^(exposed_|weathered_|oxidized_)?copper_(bars|chain|lantern)$/, (p, m) => {
  clear(p);
  const [a] = OX[m[1] ?? '']!;
  markNoTint(p);
  if (m[2] === 'bars') p.each((x, y, u, v) => { if (u % 4 > 1.5 && u % 4 < 3.5 || v < 1 || v > 15) p.set(x, y, a, 0.6); });
  else if (m[2] === 'chain') p.each((x, y, u, v) => { if ((u > 1 && u < 2.5) && (v % 5 < 4)) p.set(x, y, a, 0.6); if (u > 3.5 && u < 5 && v % 5 > 2) p.set(x, y, shade(a, 0.8), 0.6); });
  else lanternTex(p, a, hex('#9fe8c9'));
  p.material({ metal: 0.8, smooth: 0.6 });
});
rule(/^(exposed_|weathered_|oxidized_)?copper_chest_(front|side|top)$/, (p, m) => { copperBase(p, m[1] ?? ''); p.each((x, y, u, v) => { if (Math.abs(v - 5) < 0.6 && m[2] !== 'top') p.set(x, y, shade(OX[m[1] ?? '']![0], 0.6), 0.2); }); });
rule(/^(exposed_|weathered_|oxidized_)?lightning_rod(_on)?$/, (p, m) => { copperBase(p, m[1] ?? ''); if (m[2]) p.material({ emit: 0.7 }); });
def('copper_torch', (p) => torchTex(p, hex('#6fd8a8')));

// ---------------------------------------------------------------------------------------------
// Coral
// ---------------------------------------------------------------------------------------------
const CORAL: Record<string, RGB> = { tube: hex('#3155d6'), brain: hex('#cc5a9b'), bubble: hex('#a51fa4'), fire: hex('#c32b37'), horn: hex('#d8c141') };
rule(/^(dead_)?(tube|brain|bubble|fire|horn)_coral_block$/, (p, m) => {
  const c = m[1] ? hex('#847f7a') : CORAL[m[2]!]!;
  p.each((x, y, u, v) => {
    const vr = voronoi(p, u, v, 5, 3);
    p.set(x, y, vr.d1 < 0.6 ? shade(c, 0.6) : jitter(shade(c, 0.9 + p.fbm(u, v, 3, 2) * 0.2), 0.06, p.grain(x, y)), vr.d1 < 0.6 ? 0.1 : 0.6);
  });
  p.material({ tint: 0, bump: 1.6 });
});
rule(/^(dead_)?(tube|brain|bubble|fire|horn)_coral$/, (p, m) => {
  clear(p); markNoTint(p);
  const c = m[1] ? hex('#847f7a') : CORAL[m[2]!]!;
  for (let i = 0; i < 5; i++) {
    const u = 3 + i * 2.5, top = 3 + p.rnd(i, 0, 5) * 5;
    stem(p, u, 16, u + (p.rnd(i, 1, 5) - 0.5) * 3, top, shade(c, 0.9 + i * 0.03), 1);
    blob(p, u + (p.rnd(i, 1, 5) - 0.5) * 3, top, 1.2, shade(c, 1.1));
  }
});
rule(/^(dead_)?(tube|brain|bubble|fire|horn)_coral_fan$/, (p, m) => {
  clear(p); markNoTint(p);
  const c = m[1] ? hex('#847f7a') : CORAL[m[2]!]!;
  p.each((x, y, u, v) => {
    const du = u - 8, dv = 16 - v;
    const a = Math.atan2(dv, du);
    if (dv > 0 && dv < 9 && a > 0.3 && a < 2.8 && (Math.sin(a * 9) > -0.3 || dv < 3)) p.set(x, y, jitter(c, 0.08, p.rnd(x, y)), 0.6);
  });
});

// ---------------------------------------------------------------------------------------------
// Plants
// ---------------------------------------------------------------------------------------------
def('short_grass', (p) => { clear(p); blades(p, hex('#b4b4b4'), 11, 12); });
def('fern', (p) => { clear(p); fernTex(p, hex('#a8a8a8'), 14); });
def('tall_grass_bottom', (p) => { clear(p); blades(p, hex('#b4b4b4'), 14, 16); });
def('tall_grass_top', (p) => { clear(p); blades(p, hex('#b4b4b4'), 10, 13); });
def('large_fern_bottom', (p) => { clear(p); fernTex(p, hex('#a8a8a8'), 16); });
def('large_fern_top', (p) => { clear(p); fernTex(p, hex('#a8a8a8'), 12); });
def('bush', (p) => { clear(p); for (let i = 0; i < 12; i++) blob(p, 3 + p.rnd(i, 0, 2) * 10, 6 + p.rnd(i, 1, 2) * 9, 2, hex('#a0a0a0')); });
def('dead_bush', (p) => { clear(p); markNoTint(p); deadBranches(p, hex('#7a5a33')); });
def('short_dry_grass', (p) => { clear(p); markNoTint(p); blades(p, hex('#c9ad6b'), 10, 10); });
def('tall_dry_grass', (p) => { clear(p); markNoTint(p); blades(p, hex('#c9ad6b'), 14, 15); });
def('firefly_bush', (p) => { clear(p); markNoTint(p); for (let i = 0; i < 12; i++) blob(p, 3 + p.rnd(i, 0, 2) * 10, 5 + p.rnd(i, 1, 2) * 10, 1.8, hex('#4f6a2a')); speckle(p, [hex('#fff2a0')], 0.03, 9, 0.9); p.each((x, y) => { const c = p.get(x, y); if (c[0] > 240) p.setMat(x, y, { emit: 1 }); }); });
def('seagrass', (p) => { clear(p); markNoTint(p); blades(p, hex('#3a8a4a'), 8, 15); });
def('tall_seagrass_bottom', (p) => { clear(p); markNoTint(p); blades(p, hex('#3a8a4a'), 9, 16); });
def('tall_seagrass_top', (p) => { clear(p); markNoTint(p); blades(p, hex('#3a8a4a'), 7, 12); });
def('kelp', (p) => { clear(p); markNoTint(p); kelpTex(p, true); });
def('kelp_plant', (p) => { clear(p); markNoTint(p); kelpTex(p, false); });
def('sugar_cane', (p) => {
  clear(p);
  for (const u of [3, 7.5, 12]) {
    p.fillRect(u, 0, u + 2, 16, hex('#a6a6a6'));
    for (const v of [3, 9, 14]) p.fillRect(u, v, u + 2, v + 1, hex('#8a8a8a'));
    blob(p, u + 2.5, 6 + u * 0.3, 1, hex('#b8b8b8'));
  }
});
def('cactus_side', (p) => {
  p.each((x, y, u, v) => {
    let c = shade(hex('#5d8a2f'), 0.9 + (u % 4 < 1 ? -0.15 : 0.05));
    if (u < 1 || u > 15) c = [0, 0, 0] as RGB;
    p.set(x, y, u < 1 || u > 15 ? [0, 0, 0, 0] : c, 0.6);
    if ((Math.floor(v) % 4 === 2) && (Math.floor(u) % 4 === 2)) p.set(x, y, hex('#e6e2b5'), 0.8);
  });
  markNoTint(p);
});
def('cactus_top', (p) => { p.each((x, y, u, v) => { const r = Math.hypot(u - 8, v - 8); p.set(x, y, jitter(r < 5 ? hex('#8ab050') : hex('#5d8a2f'), 0.05, p.grain(x, y)), 0.5); }); markNoTint(p); });
def('cactus_bottom', (p) => { noiseFill(p, hex('#8fb566'), 0.05, 0.04); markNoTint(p); });
def('cactus_flower', (p) => { clear(p); markNoTint(p); flowerHead(p, 8, 10, hex('#f07ca8'), hex('#f7d04a'), 3, 6); });
const FLOWERS: Record<string, (p: Painter) => void> = {
  dandelion: (p) => { plantStem(p, 8); blob(p, 8, 7, 2.3, hex('#f7d51c')); },
  poppy: (p) => { plantStem(p, 8); flowerHead(p, 8, 6.5, hex('#d8231a'), hex('#1d1d1d'), 2.6, 4); },
  blue_orchid: (p) => { plantStem(p, 7); flowerHead(p, 8, 6, hex('#2aa9e8'), hex('#8ad6ff'), 2.6, 5); },
  allium: (p) => { stem(p, 8, 16, 8, 6, hex('#4f7a2d')); for (let i = 0; i < 10; i++) blob(p, 6 + p.rnd(i, 0, 1) * 4, 3 + p.rnd(i, 1, 1) * 4, 1, i % 2 ? hex('#b664e0') : hex('#d99af5')); },
  azure_bluet: (p) => { for (let i = 0; i < 4; i++) { const u = 4 + i * 2.5, v = 6 + (i % 2) * 3; stem(p, u, 16, u, v, hex('#4f7a2d')); flowerHead(p, u, v, hex('#f4f4f4'), hex('#f7d34a'), 1.3, 4); } },
  red_tulip: (p) => tulip(p, hex('#c9271c')),
  orange_tulip: (p) => tulip(p, hex('#e8741a')),
  white_tulip: (p) => tulip(p, hex('#eaeaea')),
  pink_tulip: (p) => tulip(p, hex('#eba0c3')),
  oxeye_daisy: (p) => { plantStem(p, 7); flowerHead(p, 8, 6, hex('#f7f7f7'), hex('#f2c616'), 2.8, 8); },
  cornflower: (p) => { plantStem(p, 7); flowerHead(p, 8, 6, hex('#4467de'), hex('#1e2f86'), 2.6, 7); },
  lily_of_the_valley: (p) => { stem(p, 7, 16, 9, 4, hex('#4f7a2d')); blob(p, 5, 12, 2, hex('#4f7a2d')); for (let i = 0; i < 4; i++) blob(p, 10 + (i % 2), 5 + i * 2, 1.1, hex('#f5f5f0')); },
  blight_rose: (p) => { plantStem(p, 8, hex('#2f3a24')); flowerHead(p, 8, 6.5, hex('#2a1f1f'), hex('#120c0c'), 2.6, 5); },
  torchflower: (p) => { plantStem(p, 8); for (let i = 0; i < 6; i++) blob(p, 8 + (i % 3 - 1) * 1.5, 7 - Math.floor(i / 3) * 2.2, 1.3, i % 2 ? hex('#f28a1d') : hex('#e2371f')); p.each((x, y) => { const c = p.get(x, y); if (c[0] > 200 && c[3] > 0) p.setMat(x, y, { emit: 0.6 }); }); },
  open_gazebloom: (p) => { plantStem(p, 8, hex('#4a5a3a')); flowerHead(p, 8, 6.5, hex('#f0a44a'), hex('#1b1b2a'), 2.8, 6); p.each((x, y) => { const c = p.get(x, y); if (c[0] > 200 && c[3] > 0) p.setMat(x, y, { emit: 0.7 }); }); },
  closed_gazebloom: (p) => { plantStem(p, 8, hex('#4a5a3a')); blob(p, 8, 7, 2, hex('#6b5a7a')); },
};
for (const [name, fn] of Object.entries(FLOWERS)) def(name, (p) => { clear(p); markNoTint(p); fn(p); });
rule(/^(sunflower|lilac|rose_bush|peony|pitcher_plant)_(top|bottom)$/, (p, m) => {
  clear(p); markNoTint(p);
  const top = m[2] === 'top';
  const green = hex('#4f7a2d');
  if (!top) { stem(p, 8, 16, 8, 0, green); for (let i = 0; i < 4; i++) blob(p, 5 + (i % 2) * 6, 4 + i * 3, 2, shade(green, 1.1)); return; }
  switch (m[1]) {
    case 'sunflower': stem(p, 8, 16, 8, 8, green); flowerHead(p, 8, 6, hex('#f6d31c'), hex('#6a4a1a'), 4, 10); break;
    case 'lilac': stem(p, 8, 16, 8, 6, green); for (let i = 0; i < 16; i++) blob(p, 5 + p.rnd(i, 0, 3) * 6, 2 + p.rnd(i, 1, 3) * 8, 1.2, i % 2 ? hex('#c38bd8') : hex('#a86bc2')); break;
    case 'rose_bush': for (let i = 0; i < 10; i++) blob(p, 3 + p.rnd(i, 0, 4) * 10, 4 + p.rnd(i, 1, 4) * 11, 2, green); for (let i = 0; i < 5; i++) blob(p, 4 + p.rnd(i, 2, 4) * 8, 3 + p.rnd(i, 3, 4) * 9, 1.3, hex('#d1261c')); break;
    case 'peony': for (let i = 0; i < 8; i++) blob(p, 3 + p.rnd(i, 0, 5) * 10, 6 + p.rnd(i, 1, 5) * 9, 2, green); for (let i = 0; i < 12; i++) blob(p, 5 + p.rnd(i, 2, 5) * 6, 2 + p.rnd(i, 3, 5) * 6, 1.3, i % 2 ? hex('#e8a8d8') : hex('#d58ac4')); break;
    default: stem(p, 8, 16, 8, 6, green); for (let i = 0; i < 5; i++) blob(p, 6 + (i % 2) * 4, 3 + i * 1.5, 1.6, i % 2 ? hex('#6b8ad8') : hex('#b86ac8'));
  }
});
rule(/^(pink_petals|wildflowers|leaf_litter)$/, (p, m) => {
  clear(p); markNoTint(p);
  if (m[1] === 'leaf_litter') { for (let i = 0; i < 20; i++) blob(p, p.rnd(i, 0, 1) * 16, p.rnd(i, 1, 1) * 16, 1.3, [hex('#9a6a2a'), hex('#b8842e'), hex('#7a4f1f')][i % 3]!); return; }
  const cols = m[1] === 'pink_petals' ? [hex('#f5b6d0'), hex('#e592b8')] : [hex('#f7d34a'), hex('#f4f4f4'), hex('#b58ae0')];
  for (let i = 0; i < 12; i++) {
    const u = p.rnd(i, 0, 2) * 14 + 1, v = p.rnd(i, 1, 2) * 14 + 1;
    stem(p, u, v, u + 1, v + 2, hex('#5c8a2a'));
    blob(p, u, v, 1.2, cols[i % cols.length]!);
  }
});
def('spore_blossom', (p) => { clear(p); markNoTint(p); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; stem(p, 8, 8, 8 + Math.cos(a) * 7, 8 + Math.sin(a) * 7, i % 2 ? hex('#d26cb4') : hex('#e98fcf'), 1.5); } blob(p, 8, 8, 2, hex('#5aa83a')); });
rule(/^(wheat)_stage(\d)$/, (p, m) => cropTex(p, Number(m[2]), 7, hex('#4f9a2a'), hex('#c9a83a')));
rule(/^(carrots|potatoes)_stage(\d)$/, (p, m) => cropRoot(p, Number(m[2]), m[1] === 'carrots' ? hex('#e8801c') : hex('#c7a64a')));
rule(/^beetroots_stage(\d)$/, (p, m) => cropRoot(p, Number(m[1]), hex('#8a1a2a'), hex('#8a2a3a')));
rule(/^torchflower_crop_stage(\d)$/, (p, m) => { clear(p); markNoTint(p); plantStem(p, 10 - Number(m[1]) * 2); blob(p, 8, 8 - Number(m[1]) * 2, 1.5, hex('#e8741a')); });
rule(/^pitcher_crop_(upper|lower)_stage_(\d)$/, (p, m) => {
  clear(p); markNoTint(p);
  const s = Number(m[2]);
  if (m[1] === 'lower') { stem(p, 8, 16, 8, 16 - s * 3, hex('#5c7a3a')); blob(p, 8, 13, 2 + s * 0.4, hex('#6b8ad8')); }
  else if (s >= 3) { stem(p, 8, 16, 8, 10 - s, hex('#5c7a3a')); blob(p, 8, 12 - s, 2, hex('#b86ac8')); }
});
def('stem', (p) => { clear(p); stem(p, 8, 16, 8, 0, hex('#a8a8a8'), 1); for (let v = 2; v < 16; v += 4) blob(p, 7 + (v % 8 ? 2 : -1), v, 1, hex('#b0b0b0')); });
def('attached_stem', (p) => { clear(p); stem(p, 0, 8, 9, 16, hex('#a8a8a8'), 1); stem(p, 0, 8, 4, 4, hex('#a0a0a0'), 1); });
rule(/^cocoa_stage(\d)$/, (p, m) => { const s = Number(m[1]); const c = [hex('#8a9a3a'), hex('#b58a3a'), hex('#8a4f1f')][s]!; noiseFill(p, c, 0.06, 0.05); p.each((x, y, u) => { if (u % 3 < 0.6) p.set(x, y, shade(c, 0.8), 0.3); }); markNoTint(p); });
rule(/^sweet_berry_bush_stage(\d)$/, (p, m) => {
  clear(p); markNoTint(p);
  const s = Number(m[1]);
  for (let i = 0; i < 8 + s * 3; i++) blob(p, 3 + p.rnd(i, 0, 7) * 10, 16 - p.rnd(i, 1, 7) * (6 + s * 3), 1.6, hex('#3b6a2a'));
  if (s >= 2) for (let i = 0; i < s * 3; i++) blob(p, 4 + p.rnd(i, 2, 7) * 8, 16 - p.rnd(i, 3, 7) * (5 + s * 2), 0.9, s === 3 ? hex('#c21a2a') : hex('#8a2a3a'));
});
rule(/^ember_wart_stage(\d)$/, (p, m) => { clear(p); markNoTint(p); const s = Number(m[1]); for (let i = 0; i < 5 + s * 3; i++) blob(p, 3 + p.rnd(i, 0, 4) * 10, 16 - p.rnd(i, 1, 4) * (5 + s * 4), 1.4 + s * 0.3, [hex('#9a1a1f'), hex('#c82a2a'), hex('#6a0f12')][i % 3]!); });
def('brown_mushroom', (p) => { clear(p); markNoTint(p); stem(p, 8, 16, 8, 11, hex('#d8c8a8'), 1.5); p.disc(8, 10, 3.5, (x, y, d) => { if ((y + 0.5) / p.s < 11) p.set(x, y, jitter(hex('#9a6b4a'), 0.05, p.rnd(x, y)), 0.7 - d * 0.3); }); });
def('red_mushroom', (p) => { clear(p); markNoTint(p); stem(p, 8, 16, 8, 11, hex('#e8dcc8'), 1.5); p.disc(8, 10, 3.5, (x, y, d) => { if ((y + 0.5) / p.s < 11) p.set(x, y, p.rnd(x, y, 9) < 0.15 ? hex('#f4f4f4') : hex('#c8221a'), 0.7 - d * 0.3); }); });
def('brown_mushroom_block', (p) => { noiseFill(p, hex('#946a4b'), 0.08, 0.06); markNoTint(p); });
def('red_mushroom_block', (p) => { noiseFill(p, hex('#c52a24'), 0.06, 0.05); speckle(p, [hex('#f0e8e0')], 0.1); markNoTint(p); });
def('mushroom_stem', (p) => { noiseFill(p, hex('#d6cdbf'), 0.05, 0.03); p.each((x, y, u) => { if (u % 5 < 0.5) p.set(x, y, hex('#c1b6a5'), 0.3); }); markNoTint(p); });
def('mushroom_block_inside', (p) => { noiseFill(p, hex('#d8c3a3'), 0.06, 0.04); markNoTint(p); });
rule(/^(crimson|warped)_fungus$/, (p, m) => { clear(p); markNoTint(p); const c = m[1] === 'crimson' ? hex('#a1232a') : hex('#1f8a76'); stem(p, 8, 16, 8, 10, hex('#d8a86a'), 1.5); p.disc(8, 9, 3.5, (x, y, d) => { if ((y + 0.5) / p.s < 10) p.set(x, y, jitter(c, 0.06, p.rnd(x, y)), 0.7 - d * 0.2); }); speckle(p, [hex('#f0a860')], 0.02, 6); });
rule(/^(crimson|warped)_roots$/, (p, m) => { clear(p); markNoTint(p); blades(p, m[1] === 'crimson' ? hex('#b02a3a') : hex('#2aa08a'), 9, 12); });
def('nether_sprouts', (p) => { clear(p); markNoTint(p); blades(p, hex('#2aa08a'), 12, 7); });
rule(/^(weeping|twisting)_vines(_plant)?$/, (p, m) => { clear(p); markNoTint(p); const c = m[1] === 'weeping' ? hex('#a51f1f') : hex('#1f9a8a'); for (const u of [5, 8, 11]) { const top = m[2] ? 0 : m[1] === 'weeping' ? 0 : 5; const bot = m[2] ? 16 : m[1] === 'weeping' ? 11 : 16; stem(p, u, top, u + 1, bot, c, 1); blob(p, u + 1, (top + bot) / 2, 1.2, shade(c, 1.2)); } });
rule(/^cave_vines(_plant)?(_lit)?$/, (p, m) => {
  clear(p); markNoTint(p);
  for (const u of [6, 10]) stem(p, u, 0, u, m[1] ? 16 : 12, hex('#4f7a2d'), 1);
  for (let i = 0; i < 6; i++) blob(p, 5 + (i % 2) * 5, 2 + i * 2.2, 1.3, hex('#5c8a2a'));
  if (m[2]) for (let i = 0; i < 3; i++) { blob(p, 7 + (i % 2) * 3, 5 + i * 3.5, 1.3, hex('#f5b52a')); }
  p.each((x, y) => { const c = p.get(x, y); if (c[0] > 220 && c[3] > 0) p.setMat(x, y, { emit: 1 }); });
});
def('hanging_roots', (p) => { clear(p); markNoTint(p); for (let i = 0; i < 7; i++) { const u = 2 + i * 2; stem(p, u, 0, u + (p.rnd(i, 0, 2) - 0.5) * 2, 6 + p.rnd(i, 1, 2) * 9, hex('#b08a64'), 1); } });
def('vine', (p) => { clear(p); for (let i = 0; i < 26; i++) blob(p, p.rnd(i, 0, 3) * 16, p.rnd(i, 1, 3) * 16, 1.1, hex('#9c9c9c')); for (const u of [3, 9, 13]) stem(p, u, 0, u + 2, 16, hex('#8a8a8a'), 1); });
def('glow_lichen', (p) => { clear(p); markNoTint(p); for (let i = 0; i < 30; i++) blob(p, p.rnd(i, 0, 3) * 16, p.rnd(i, 1, 3) * 16, 1, hex('#7a8f7a')); speckle(p, [hex('#c7f2c0')], 0.08, 8, 0.8); p.each((x, y) => { const c = p.get(x, y); if (c[1] > 200) p.setMat(x, y, { emit: 1 }); }); });
def('lily_pad', (p) => { clear(p); p.disc(8, 8, 7, (x, y, d) => { const u = (x + 0.5) / p.s, v = (y + 0.5) / p.s; if (!(u > 8 && Math.abs(v - 8) < (u - 8) * 0.35)) p.set(x, y, jitter(hex('#9a9a9a'), 0.06, p.rnd(x, y)), 0.6 - d * 0.2); }); });
def('big_dripleaf_top', (p) => { clear(p); markNoTint(p); p.disc(8, 8, 7.5, (x, y, d) => p.set(x, y, jitter(shade(hex('#6fae3a'), 1.05 - d * 0.2), 0.05, p.rnd(x, y)), 0.6)); p.each((x, y, u, v) => { if (Math.abs(u - 8) < 0.5 && v > 2 && v < 14 && p.alpha(x, y) > 0) p.set(x, y, hex('#4f8a2a'), 0.5); }); });
def('big_dripleaf_stem', (p) => { clear(p); markNoTint(p); stem(p, 8, 16, 8, 0, hex('#5c8a2a'), 1.5); });
def('small_dripleaf_top', (p) => { clear(p); markNoTint(p); p.disc(8, 8, 6, (x, y) => p.set(x, y, jitter(hex('#6fae3a'), 0.05, p.rnd(x, y)), 0.6)); });
def('small_dripleaf_stem_top', (p) => { clear(p); markNoTint(p); stem(p, 8, 16, 8, 3, hex('#5c8a2a'), 1); });
def('small_dripleaf_stem_bottom', (p) => { clear(p); markNoTint(p); stem(p, 8, 16, 8, 0, hex('#5c8a2a'), 1); blob(p, 6, 12, 1.5, hex('#6fae3a')); });
rule(/^(flowering_)?azalea_(top|side|plant)$/, (p, m) => {
  const flowering = !!m[1];
  if (m[2] === 'plant') { clear(p); markNoTint(p); stem(p, 8, 16, 8, 2, hex('#6a5a3a'), 1.5); stem(p, 8, 10, 4, 5, hex('#6a5a3a'), 1); stem(p, 8, 9, 12, 4, hex('#6a5a3a'), 1); return; }
  leaves(p, hex('#6a8f33'), m[2] === 'side' ? 0.1 : 0, 2, flowering ? [hex('#d67ac4'), hex('#e9a0d8')] : undefined);
  markNoTint(p);
});
def('chorus_plant', (p) => { noiseFill(p, hex('#5d3a5d'), 0.08, 0.1); speckle(p, [hex('#8a6a8a'), hex('#3a203a')], 0.25); markNoTint(p); });
def('chorus_flower', (p) => { noiseFill(p, hex('#98749e'), 0.06, 0.08); p.each((x, y, u, v) => { if (Math.min(u, v, 16 - u, 16 - v) < 3) p.set(x, y, hex('#b995c0'), 0.7); }); markNoTint(p); });
def('chorus_flower_dead', (p) => { noiseFill(p, hex('#6a4a6e'), 0.06, 0.08); markNoTint(p); });
def('frogspawn', (p) => { clear(p); markNoTint(p); for (let i = 0; i < 14; i++) { const u = 2 + p.rnd(i, 0, 1) * 12, v = 2 + p.rnd(i, 1, 1) * 12; blob(p, u, v, 1.3, [220, 220, 200]); blob(p, u, v, 0.5, [30, 30, 30], false); } });
def('turtle_egg', (p) => { noiseFill(p, hex('#e6dfc4'), 0.04, 0.03); speckle(p, [hex('#7aa35a'), hex('#9ac27a')], 0.15); markNoTint(p); });
def('turtle_egg_slightly_cracked', (p) => { noiseFill(p, hex('#e6dfc4'), 0.04, 0.03); speckle(p, [hex('#7aa35a')], 0.15); crackN(p, 1); markNoTint(p); });
def('turtle_egg_very_cracked', (p) => { noiseFill(p, hex('#e6dfc4'), 0.04, 0.03); speckle(p, [hex('#7aa35a')], 0.15); crackN(p, 3); markNoTint(p); });
def('sniffer_egg', (p) => { noiseFill(p, hex('#a8402f'), 0.05, 0.06); speckle(p, [hex('#3a7a5a'), hex('#c25a3f')], 0.18); markNoTint(p); });
def('sniffer_egg_slightly_cracked', (p) => { noiseFill(p, hex('#a8402f'), 0.05, 0.06); speckle(p, [hex('#3a7a5a')], 0.18); crackN(p, 1); markNoTint(p); });
def('sniffer_egg_very_cracked', (p) => { noiseFill(p, hex('#a8402f'), 0.05, 0.06); speckle(p, [hex('#3a7a5a')], 0.18); crackN(p, 3); markNoTint(p); });
def('sea_pickle', (p) => { noiseFill(p, hex('#6a7a2a'), 0.06, 0.05); speckle(p, [hex('#9aaa4a')], 0.2); p.material({ emit: 0.3, tint: 0 }); });
def('bamboo_stalk', (p) => { p.each((x, y, u, v) => { let c = shade(hex('#6a8f2a'), 0.9 + (u % 3 < 1 ? 0.1 : 0)); if (Math.abs(v - 5) < 0.5) c = hex('#8faf3a'); p.set(x, y, jitter(c, 0.04, p.grain(x, y)), 0.5); }); markNoTint(p); });
def('bamboo_stalk_top', (p) => { noiseFill(p, hex('#b8c86a'), 0.05, 0.03); markNoTint(p); });
def('bamboo_small_leaves', (p) => { clear(p); markNoTint(p); for (let i = 0; i < 4; i++) stem(p, 8, 8, 8 + (i % 2 ? 6 : -6), 3 + i * 3, hex('#5c8a2a'), 1.5); });
def('bamboo_large_leaves', (p) => { clear(p); markNoTint(p); for (let i = 0; i < 7; i++) stem(p, 8, 9, 8 + (i % 2 ? 7 : -7), 1 + i * 2, hex('#5c8a2a'), 1.5); });
def('bamboo_stage0', (p) => { clear(p); markNoTint(p); stem(p, 8, 16, 8, 8, hex('#6a8f2a'), 1.5); blob(p, 10, 8, 1.5, hex('#5c8a2a')); });

// ---------------------------------------------------------------------------------------------
// Fluids, fire, portals
// ---------------------------------------------------------------------------------------------
def('water_still', (p) => fluid(p, hex('#b8b8b8'), hex('#f2f2f2'), p.frame, 16, { alpha: 180 }));
def('water_flow', (p) => fluid(p, hex('#b0b0b0'), hex('#f2f2f2'), p.frame, 16, { alpha: 180, flow: true }));
def('lava_still', (p) => fluid(p, hex('#c8360e'), hex('#ffcf3a'), p.frame, 16, { emissive: true }));
def('lava_flow', (p) => fluid(p, hex('#c8360e'), hex('#ffcf3a'), p.frame, 16, { emissive: true, flow: true }));
function fireTex(p: Painter, hot: RGB, mid: RGB, cool: RGB): void {
  clear(p); markNoTint(p);
  const f = p.frame;
  p.each((x, y, u, v) => {
    const n = p.fbm(u, v + f * 4, 4, 3, 2);
    const h = (16 - v) / 16;
    const k = n * 1.3 - h * 0.9 + 0.1;
    if (k > 0.35) {
      const t = Math.min(1, (k - 0.35) * 2.2);
      p.set(x, y, t > 0.66 ? hot : t > 0.33 ? mid : cool, 0.5);
      p.setMat(x, y, { emit: 1 });
    }
  });
}
def('fire', (p) => fireTex(p, hex('#fff2a8'), hex('#ffb12e'), hex('#e0520f')));
def('soul_fire', (p) => fireTex(p, hex('#d8fbff'), hex('#6fe0f0'), hex('#1f8fb0')));
def('campfire_fire', (p) => fireTex(p, hex('#fff2a8'), hex('#ffb12e'), hex('#e0520f')));
def('soul_campfire_fire', (p) => fireTex(p, hex('#d8fbff'), hex('#6fe0f0'), hex('#1f8fb0')));
def('inferno_portal', (p) => {
  const f = p.frame;
  p.each((x, y, u, v) => {
    const a = Math.atan2(v - 8, u - 8) + f * 0.4;
    const r = Math.hypot(u - 8, v - 8);
    const k = (Math.sin(a * 3 + r * 0.9) + 1) / 2 * 0.6 + p.fbm(u, v, 4, 2, f) * 0.4;
    const c = mix(hex('#5a0fb0'), hex('#d27cff'), k);
    p.set(x, y, [c[0], c[1], c[2], 200], 0.5);
    p.setMat(x, y, { emit: 0.7 + k * 0.3 });
  });
  markNoTint(p);
});
def('verge_portal', (p) => {
  p.each((x, y) => {
    const r = p.rnd(x, y, p.frame);
    const c: RGB = r > 0.985 ? hex('#e8f7ff') : r > 0.96 ? hex('#6fbfb5') : hex('#060a12');
    p.set(x, y, c, 0.5);
    p.setMat(x, y, { emit: r > 0.96 ? 1 : 0.2 });
  });
  markNoTint(p);
});
def('verge_portal_frame_top', (p) => { noiseFill(p, hex('#3a6f5a'), 0.06, 0.06); p.each((x, y, u, v) => { if (Math.min(u, v, 16 - u, 16 - v) < 2) p.set(x, y, hex('#dcde9d'), 0.5); if (Math.hypot(u - 8, v - 8) < 3.5) p.set(x, y, hex('#18302a'), 0.2); }); });
def('verge_portal_frame_side', (p) => { stone(p, hex('#dcde9d'), { variance: 0.06 }); p.each((x, y, u, v) => { if (v < 3) p.set(x, y, hex('#3a6f5a'), 0.6); }); });
def('verge_portal_frame_eye', (p) => { p.each((x, y, u, v) => { const r = Math.hypot(u - 8, v - 8); p.set(x, y, r < 2 ? hex('#0a1f1a') : r < 5 ? hex('#2f9a7a') : hex('#1f5f4f'), 0.7); p.setMat(x, y, { emit: 0.6 }); }); });
def('verge_rod', (p) => { p.each((x, y, u) => { p.set(x, y, u < 8 ? hex('#f4efe8') : hex('#d8cfc4'), 0.6); p.setMat(x, y, { emit: 0.9 }); }); markNoTint(p); });

// ---------------------------------------------------------------------------------------------
// Functional blocks
// ---------------------------------------------------------------------------------------------
def('crafting_table_top', (p) => { planks(p, PLANKS.oak!); p.each((x, y, u, v) => { const e = Math.min(u, v, 16 - u, 16 - v); if (e < 1.2) p.set(x, y, hex('#5a3d1f'), 0.3); if (u > 2 && u < 14 && v > 2 && v < 14 && ((u - 2) % 4 < 0.6 || (v - 2) % 4 < 0.6)) p.set(x, y, hex('#6a4a28'), 0.3); }); });
def('crafting_table_side', (p) => { planks(p, PLANKS.oak!); p.each((x, y, u, v) => { if (v < 3) p.set(x, y, hex('#6a4a28'), 0.4); }); toolIcon(p, 'saw', 4, 6); toolIcon(p, 'hammer', 10, 6); });
def('crafting_table_front', (p) => { planks(p, PLANKS.oak!); p.each((x, y, u, v) => { if (v < 3) p.set(x, y, hex('#6a4a28'), 0.4); }); toolIcon(p, 'pick', 7, 6); });
function furnaceSides(p: Painter, base: RGB, top = false): void { cobble(p, base, shade(base, 0.6), 5, 2); if (top) centerInlay(p, shade(base, 0.8), 5); }
rule(/^(furnace|blast_furnace|smoker)_(front|front_on|side|top|bottom)$/, (p, m) => {
  const kind = m[1]!, face = m[2]!;
  const base = kind === 'furnace' ? hex('#7a7a7a') : kind === 'blast_furnace' ? hex('#5d5d61') : hex('#6b5a4a');
  if (face === 'side' || face === 'bottom') { if (kind === 'smoker' && face === 'side') { planks(p, hex('#6a5038'), { boards: 4 }); p.each((x, y, u, v) => { if (v < 3 || v > 13) p.set(x, y, hex('#555555'), 0.3); }); } else furnaceSides(p, base); return; }
  if (face === 'top') { furnaceSides(p, base, true); return; }
  furnaceSides(p, base);
  const on = face === 'front_on';
  p.each((x, y, u, v) => {
    if (u > 3 && u < 13 && v > 8 && v < 14) {
      p.set(x, y, on ? mix(hex('#ff9a2a'), hex('#ffe08a'), p.fbm(u, v, 4, 2, 3)) : hex('#1e1e1e'), 0.1);
      if (on) p.setMat(x, y, { emit: 1 });
    }
    if (u > 3 && u < 13 && (Math.abs(v - 5) < 0.6)) p.set(x, y, shade(base, 0.55), 0.2);
  });
});
rule(/^(chest|trapped_chest|void_chest)_(front|side|top)$/, (p, m) => {
  const kind = m[1]!;
  if (kind === 'void_chest') { noiseFill(p, hex('#1a1d24'), 0.05, 0.05); speckle(p, [hex('#2f8a7a')], 0.08); } else planks(p, hex('#a2742f'), { boards: 4 });
  const band = kind === 'void_chest' ? hex('#2f8a7a') : kind === 'trapped_chest' ? hex('#8a2a2a') : hex('#5a3d1f');
  p.each((x, y, u, v) => {
    if (Math.min(u, v, 16 - u, 16 - v) < 1) p.set(x, y, band, 0.3);
    if (m[2] !== 'top' && Math.abs(v - 5.5) < 0.6) p.set(x, y, band, 0.3);
  });
});
def('chest_lock', (p) => metalBlock(p, hex('#c8c8c8')));
def('barrel_side', (p) => { planks(p, hex('#7a5431'), { boards: 1 }); p.each((x, y, u, v) => { if (u % 4 < 0.6) p.set(x, y, hex('#4f3520'), 0.2); if (Math.abs(v - 3) < 0.7 || Math.abs(v - 13) < 0.7) p.set(x, y, hex('#3a3a3a'), 0.6); }); });
def('barrel_top', (p) => { planks(p, hex('#8a6038'), { boards: 4 }); p.each((x, y, u, v) => { if (Math.min(u, v, 16 - u, 16 - v) < 1.2) p.set(x, y, hex('#3a3a3a'), 0.6); }); });
def('barrel_top_open', (p) => { planks(p, hex('#8a6038'), { boards: 4 }); p.each((x, y, u, v) => { const e = Math.min(u, v, 16 - u, 16 - v); if (e < 1.2) p.set(x, y, hex('#3a3a3a'), 0.6); else if (e > 2) p.set(x, y, hex('#2a1d12'), 0.1); }); });
def('barrel_bottom', (p) => { planks(p, hex('#7a5431'), { boards: 4 }); p.each((x, y, u, v) => { if (Math.min(u, v, 16 - u, 16 - v) < 1.2) p.set(x, y, hex('#3a3a3a'), 0.6); }); });
def('enchanting_table_top', (p) => { noiseFill(p, hex('#a0282a'), 0.05, 0.06); p.each((x, y, u, v) => { const e = Math.min(u, v, 16 - u, 16 - v); if (e < 2) p.set(x, y, hex('#2a1a3a'), 0.4); if (Math.abs(Math.hypot(u - 8, v - 8) - 4) < 0.5) p.set(x, y, hex('#e0c060'), 0.6); }); });
def('enchanting_table_side', (p) => { obsidianish(p); p.each((x, y, u, v) => { if (v < 4) p.set(x, y, hex('#a0282a'), 0.6); if (Math.abs(v - 4) < 0.5) p.set(x, y, hex('#e0c060'), 0.7); }); });
def('enchanting_table_bottom', (p) => obsidianish(p));
def('anvil', (p) => { noiseFill(p, hex('#444444'), 0.05, 0.05); p.material({ metal: 0.9, smooth: 0.5 }); });
rule(/^(chipped_|damaged_)?anvil_top$/, (p, m) => { noiseFill(p, hex('#4a4a4a'), 0.05, 0.05); p.each((x, y, u, v) => { if (Math.abs(u - 8) < 3 && v > 2 && v < 14) p.set(x, y, hex('#5c5c5c'), 0.7); }); if (m[1]) crackN(p, m[1] === 'chipped_' ? 1 : 3); p.material({ metal: 0.9, smooth: 0.5 }); });
def('brewing_stand', (p) => { clear(p); markNoTint(p); stem(p, 8, 16, 8, 1, hex('#a88a3a'), 1.5); p.fillRect(2, 4, 14, 5, hex('#a88a3a')); p.material({ metal: 0.8 }); });
def('brewing_stand_base', (p) => { noiseFill(p, hex('#6a6a6a'), 0.05, 0.05); });
def('cauldron_side', (p) => { metalBlock(p, hex('#3c3c3c'), {}); p.each((x, y, u, v) => { if (v > 13 && u > 4 && u < 12) p.set(x, y, [0, 0, 0, 0], 0); }); });
def('cauldron_top', (p) => metalBlock(p, hex('#434343'), {}));
def('cauldron_inner', (p) => noiseFill(p, hex('#2a2a2a'), 0.05, 0.04));
def('cauldron_bottom', (p) => noiseFill(p, hex('#303030'), 0.05, 0.04));
def('grindstone_round', (p) => stone(p, hex('#8a8a8a'), { variance: 0.06 }));
def('grindstone_side', (p) => { stone(p, hex('#8a8a8a'), { variance: 0.06 }); p.each((x, y, u, v) => { if (Math.abs(Math.hypot(u - 8, v - 8) - 6) < 0.6) p.set(x, y, hex('#6a6a6a'), 0.3); }); });
def('grindstone_pivot', (p) => planks(p, PLANKS.dark_oak!));
def('smithing_table_top', (p) => { metalBlock(p, hex('#3a3a44'), {}); p.material({ metal: 0.3 }); });
def('smithing_table_side', (p) => { planks(p, hex('#3a2a20'), { boards: 4 }); p.each((x, y, u, v) => { if (v < 4) p.set(x, y, hex('#3a3a44'), 0.6); }); });
def('smithing_table_front', (p) => { planks(p, hex('#3a2a20'), { boards: 4 }); p.each((x, y, u, v) => { if (v < 4) p.set(x, y, hex('#3a3a44'), 0.6); }); toolIcon(p, 'hammer', 7, 7); });
def('smithing_table_bottom', (p) => planks(p, hex('#3a2a20')));
def('fletching_table_top', (p) => { planks(p, hex('#c9b77a')); p.each((x, y, u, v) => { if (Math.abs(u - v) < 0.6) p.set(x, y, hex('#8a6a3a'), 0.3); }); });
def('fletching_table_side', (p) => { planks(p, hex('#c9b77a')); p.each((x, y, u, v) => { if (v < 3) p.set(x, y, hex('#8a7a4a'), 0.4); }); });
def('fletching_table_front', (p) => { planks(p, hex('#c9b77a')); stem(p, 4, 12, 12, 4, hex('#6a4a2a')); blob(p, 12, 4, 1, hex('#e8e8e8')); });
def('cartography_table_top', (p) => { planks(p, PLANKS.dark_oak!); p.each((x, y, u, v) => { if (u > 2 && u < 14 && v > 2 && v < 14) p.set(x, y, mix(hex('#e8dcb0'), hex('#c8b88a'), p.fbm(u, v, 3)), 0.6); }); });
rule(/^cartography_table_side(\d)$/, (p) => { planks(p, PLANKS.dark_oak!); p.each((x, y, u, v) => { if (v > 4 && v < 11 && u > 2 && u < 14) p.set(x, y, hex('#d8c89a'), 0.5); }); });
rule(/^loom_(front|side|top|bottom)$/, (p, m) => { planks(p, hex('#a88a5a'), { boards: 4 }); if (m[1] === 'front') p.each((x, y, u, v) => { if (u > 3 && u < 13 && v > 3 && v < 13) p.set(x, y, (Math.floor(u) + Math.floor(v)) % 2 ? hex('#e8e8e8') : hex('#b83a3a'), 0.5); }); if (m[1] === 'top') p.each((x, y, u) => { if (u % 3 < 1) p.set(x, y, hex('#e8e8e8'), 0.5); }); });
rule(/^stonecutter_(top|side|bottom|saw)$/, (p, m) => {
  if (m[1] === 'saw') { clear(p); markNoTint(p); p.disc(8, 16, 7, (x, y, d) => p.set(x, y, d > 0.85 ? hex('#e8e8e8') : hex('#8a8a8a'), 0.7)); p.material({ metal: 1, smooth: 0.8 }); return; }
  if (m[1] === 'top') { stone(p, hex('#7a7a7a')); p.each((x, y, u, v) => { if (Math.abs(v - 8) < 1) p.set(x, y, hex('#303030'), 0.1); }); return; }
  planks(p, PLANKS.oak!); p.each((x, y, u, v) => { if (v < 4) p.set(x, y, hex('#7a7a7a'), 0.6); });
});
rule(/^composter_(side|top|bottom|compost|ready)$/, (p, m) => {
  if (m[1] === 'compost' || m[1] === 'ready') { noiseFill(p, m[1] === 'ready' ? hex('#7a6a4a') : hex('#4a3a24'), 0.12, 0.1); if (m[1] === 'ready') speckle(p, [hex('#f2f2f2')], 0.12); return; }
  planks(p, hex('#8a6a3a'), { boards: m[1] === 'side' ? 1 : 4 });
  if (m[1] === 'side') p.each((x, y, u) => { if (u % 4 < 0.7) p.set(x, y, hex('#5a4020'), 0.2); });
});
rule(/^lectern_(base|front|sides|top)$/, (p, m) => { planks(p, PLANKS.oak!); if (m[1] === 'top') p.each((x, y, u, v) => { if (Math.min(u, v, 16 - u, 16 - v) < 1) p.set(x, y, hex('#5a3d1f'), 0.3); }); });
def('book_pages', (p) => { p.each((x, y, u, v) => p.set(x, y, Math.abs(u - 8) < 0.5 ? hex('#8a7a5a') : v % 2 < 1 && u % 8 > 1 && u % 8 < 7 ? hex('#b8ac94') : hex('#efe7d2'), 0.5)); markNoTint(p); });
def('bell_body', (p) => metalBlock(p, hex('#e8c43a'), { smooth: 0.8 }));
def('campfire_log', (p) => { bark(p, hex('#5a4228'), hex('#3a2a18')); });
def('campfire_log_lit', (p) => { bark(p, hex('#5a4228'), hex('#3a2a18')); p.each((x, y, u, v) => { if (p.fbm(u, v, 4, 2, 3) > 0.55) { p.set(x, y, hex('#ff9a2a'), 0.3); p.setMat(x, y, { emit: 1 }); } }); });
def('beacon', (p) => { p.each((x, y, u, v) => { const r = Math.hypot(u - 8, v - 8); p.set(x, y, mix(hex('#e8fffc'), hex('#7af2e8'), r / 11), 0.6); p.setMat(x, y, { emit: 1 }); }); });
def('conduit', (p) => { p.each((x, y, u, v) => { const e = Math.min(u, v, 16 - u, 16 - v); p.set(x, y, e < 2 ? hex('#8a6a3a') : mix(hex('#3a9a8a'), hex('#9af2e0'), p.fbm(u, v, 3)), 0.6); if (e >= 2) p.setMat(x, y, { emit: 0.8 }); }); });
def('lodestone_top', (p) => { metalBlock(p, hex('#8a8a90'), {}); centerInlay(p, hex('#5a5a60'), 4); });
def('lodestone_side', (p) => { stone(p, hex('#7a7a80'), {}); p.each((x, y, u, v) => { if (v < 3 || v > 13) p.set(x, y, hex('#9a9aa0'), 0.6); }); });
rule(/^respawn_anchor_(top|top_off|bottom|side(\d))$/, (p, m) => {
  obsidianish(p);
  if (m[1] === 'top') p.each((x, y, u, v) => { if (Math.hypot(u - 8, v - 8) < 4) { p.set(x, y, mix(hex('#7a2af2'), hex('#f2a0ff'), p.fbm(u, v, 4)), 0.5); p.setMat(x, y, { emit: 1 }); } });
  if (m[1] === 'top_off') p.each((x, y, u, v) => { if (Math.hypot(u - 8, v - 8) < 4) p.set(x, y, hex('#1a0f24'), 0.2); });
  if (m[2]) { const n = Number(m[2]); p.each((x, y, u, v) => { if (v > 12 && u > 2 && u < 14) { const lit = Math.floor((u - 2) / 3) < n; p.set(x, y, lit ? hex('#e8a0ff') : hex('#3a2a4a'), 0.5); if (lit) p.setMat(x, y, { emit: 1 }); } }); }
});
def('bookshelf', (p) => bookshelfTex(p, 6));
def('chiseled_bookshelf_top', (p) => planks(p, PLANKS.oak!));
def('chiseled_bookshelf_side', (p) => planks(p, PLANKS.oak!, { boards: 2 }));
def('chiseled_bookshelf_empty', (p) => { planks(p, PLANKS.oak!); p.each((x, y, u, v) => { if ((v > 1 && v < 7 || v > 9 && v < 15) && u > 1 && u < 15) p.set(x, y, hex('#3a2a18'), 0.1); }); });
def('chiseled_bookshelf_occupied', (p) => bookshelfTex(p, 6));
rule(/^chiseled_bookshelf_occupied_(\d)$/, (p, m) => bookshelfTex(p, Number(m[1])));
def('jukebox_side', (p) => { planks(p, hex('#6a4a2a')); p.each((x, y, u, v) => { if (Math.min(u, v, 16 - u, 16 - v) < 1.5) p.set(x, y, hex('#3a2a18'), 0.3); }); });
def('jukebox_top', (p) => { planks(p, hex('#6a4a2a')); p.each((x, y, u, v) => { if (Math.abs(v - 8) < 1 && u > 3 && u < 13) p.set(x, y, hex('#1a1a1a'), 0.1); }); });
def('note_block', (p) => { planks(p, hex('#6a4a2a')); p.each((x, y, u, v) => { if (Math.min(u, v, 16 - u, 16 - v) < 1.5) p.set(x, y, hex('#3a2a18'), 0.3); }); toolIcon(p, 'note', 8, 8); });
rule(/^(beehive|bee_nest)_(front|front_honey|side|top|bottom)$/, (p, m) => {
  const nest = m[1] === 'bee_nest';
  const base = nest ? hex('#c9a04a') : hex('#b89160');
  if (m[2] === 'top' || m[2] === 'bottom') { nest ? noiseFill(p, base, 0.08, 0.06) : planks(p, base); return; }
  if (nest) { p.each((x, y, u, v) => p.set(x, y, jitter(v % 4 < 1 ? shade(base, 0.8) : base, 0.05, p.grain(x, y)), 0.5)); }
  else planks(p, base, { boards: 4 });
  if (m[2]!.startsWith('front')) p.disc(8, 9, 2, (x, y) => p.set(x, y, hex('#2a1a0a'), 0.1));
  if (m[2] === 'front_honey') p.each((x, y, u, v) => { if (v < 4 && u > 3 && u < 13 && p.rnd(x, y) < 0.6) p.set(x, y, hex('#f5b82a'), 0.6); });
});
def('spawner', (p) => { clear(p); markNoTint(p); p.each((x, y, u, v) => { if (u % 4 < 1 || v % 4 < 1) p.set(x, y, hex('#2a3a4a'), 0.6); }); p.material({ metal: 0.9, smooth: 0.5 }); });
rule(/^trial_spawner_(.+)$/, (p, m) => {
  const ominous = m[1]!.includes('ominous');
  const active = m[1]!.includes('active') && !m[1]!.includes('inactive');
  const accent = ominous ? hex('#5ab8f0') : hex('#f09a3a');
  metalBlock(p, hex('#3f4a4f'), {});
  p.each((x, y, u, v) => { if ((u % 5 < 1.2 || v % 5 < 1.2) && Math.min(u, v, 16 - u, 16 - v) > 1) p.set(x, y, active ? accent : shade(accent, 0.4), 0.4); if (active) p.setMat(x, y, { emit: (u % 5 < 1.2 || v % 5 < 1.2) ? 0.8 : 0 }); });
  p.material({ metal: 0.7 });
});
rule(/^vault_(.+)$/, (p, m) => {
  const ominous = m[1]!.includes('ominous');
  const on = m[1]!.includes('_on');
  const accent = ominous ? hex('#5ab8f0') : hex('#f09a3a');
  metalBlock(p, hex('#46545a'), { rivets: true });
  if (m[1]!.startsWith('front')) p.disc(8, 8, 3, (x, y) => { p.set(x, y, on ? accent : shade(accent, 0.4), 0.5); if (on) p.setMat(x, y, { emit: 1 }); });
});
rule(/^decorated_pot_(base|side)$/, (p, m) => { terracotta(p, hex('#98503a')); if (m[1] === 'side') p.each((x, y, u, v) => { if (Math.abs(v - 4) < 0.5 || Math.abs(v - 12) < 0.5) p.set(x, y, hex('#5a2a1a'), 0.3); }); });
rule(/^scaffolding_(top|side|bottom)$/, (p, m) => { clear(p); markNoTint(p); const c = hex('#c9a45a'); p.each((x, y, u, v) => { const e = Math.min(u, v, 16 - u, 16 - v); if (e < 2 || (m[1] !== 'side' && Math.abs(u - v) < 1.2) || (m[1] === 'side' && Math.abs(u - 8) < 1)) p.set(x, y, jitter(c, 0.05, p.grain(x, y)), 0.6); }); });
def('ladder', (p) => { clear(p); markNoTint(p); const c = PLANKS.oak!; p.each((x, y, u, v) => { if ((u > 2 && u < 4.5) || (u > 11.5 && u < 14) || ((v % 4) < 1.4 && u > 2 && u < 14)) p.set(x, y, jitter(c, 0.06, p.grain(x, y)), 0.6); }); });
function torchTex(p: Painter, flame: RGB): void {
  clear(p); markNoTint(p);
  p.fillRect(7, 8, 9, 16, hex('#6a4a28'));
  p.fillRect(7, 6, 9, 8, flame);
  p.fillRect(7.5, 5.5, 8.5, 6.5, add(flame, 40));
  p.each((x, y, u, v) => { if (v < 8 && v > 5) p.setMat(x, y, { emit: 1 }); });
}
def('torch', (p) => torchTex(p, hex('#ffc84a')));
def('soul_torch', (p) => torchTex(p, hex('#6fe0f0')));
def('flux_torch', (p) => torchTex(p, hex('#ff3a2a')));
def('flux_torch_off', (p) => { torchTex(p, hex('#6a2a2a')); p.emit.fill(0); });
function lanternTex(p: Painter, frame: RGB, glow: RGB): void {
  clear(p); markNoTint(p);
  p.each((x, y, u, v) => {
    const inBody = u < 6 && v > 2 && v < 9;
    if (inBody) { const e = Math.min(u, v - 2, 6 - u, 9 - v); p.set(x, y, e < 1 ? frame : glow, 0.6); if (e >= 1) p.setMat(x, y, { emit: 1 }); }
    if (u >= 11 && u < 14 && v < 3) p.set(x, y, frame, 0.6);
  });
}
def('lantern', (p) => lanternTex(p, hex('#3a3f48'), hex('#ffd07a')));
def('soul_lantern', (p) => lanternTex(p, hex('#3a3f48'), hex('#7ae8f0')));
def('chain', (p) => { clear(p); markNoTint(p); p.each((x, y, u, v) => { if (u > 1 && u < 2.5 && v % 5 < 4) p.set(x, y, hex('#3a3f48'), 0.6); if (u > 3.5 && u < 5 && v % 5 > 2) p.set(x, y, hex('#2a2e36'), 0.6); }); p.material({ metal: 0.8 }); });
def('iron_bars', (p) => { clear(p); markNoTint(p); p.each((x, y, u, v) => { if ((u % 4) > 1.5 && (u % 4) < 3 || v < 1 || v > 15) p.set(x, y, hex('#6a6d70'), 0.6); }); p.material({ metal: 0.9, smooth: 0.4 }); });
def('flower_pot', (p) => { terracotta(p, hex('#7a3a24')); markNoTint(p); });
rule(/^(rail|rail_corner|powered_rail|powered_rail_on|detector_rail|detector_rail_on|activator_rail|activator_rail_on)$/, (p, m) => {
  clear(p); markNoTint(p);
  const name = m[1]!;
  const rail = name.startsWith('powered') ? hex('#e8c43a') : name.startsWith('detector') ? hex('#8a8a8a') : name.startsWith('activator') ? hex('#9a2a2a') : hex('#8a8a8a');
  const tie = hex('#6a4a28');
  const on = name.endsWith('_on');
  if (name === 'rail_corner') {
    p.each((x, y, u, v) => { if ((v % 4) < 1.8 && u > 1 && u < 15 && v > 1) p.set(x, y, tie, 0.5); const r = Math.hypot(u - 16, v - 16); if (Math.abs(r - 13) < 0.8 || Math.abs(r - 3) < 0.8) p.set(x, y, rail, 0.7); });
    return;
  }
  p.each((x, y, u, v) => {
    if ((v % 4) < 1.8 && u > 1 && u < 15) p.set(x, y, tie, 0.5);
    if (Math.abs(u - 3) < 0.8 || Math.abs(u - 13) < 0.8) p.set(x, y, rail, 0.7);
    if (on && (Math.abs(u - 3) < 0.8 || Math.abs(u - 13) < 0.8) && v % 4 > 2) { p.set(x, y, hex('#ff3a2a'), 0.7); p.setMat(x, y, { emit: 1 }); }
  });
  p.material({ metal: 0.6 });
});
def('flux_dust_dot', (p) => { clear(p); p.disc(8, 8, 3, (x, y) => p.set(x, y, hex('#f2f2f2'), 0.6)); });
def('flux_dust_line', (p) => { clear(p); p.each((x, y, u) => { if (Math.abs(u - 8) < 1.6) p.set(x, y, hex('#f2f2f2'), 0.6); }); });
function diodeTop(p: Painter, on: boolean, comparator: boolean): void {
  polished(p, hex('#a2a2a2'));
  p.each((x, y, u, v) => {
    if (Math.abs(u - 8) < 0.6 && v > 2 && v < 14) { p.set(x, y, on ? hex('#ff3a2a') : hex('#6a2020'), 0.4); if (on) p.setMat(x, y, { emit: 1 }); }
    if (comparator && Math.abs(v - 12) < 0.6 && u > 4 && u < 12) p.set(x, y, on ? hex('#ff3a2a') : hex('#6a2020'), 0.4);
  });
}
def('repeater', (p) => diodeTop(p, false, false));
def('repeater_on', (p) => diodeTop(p, true, false));
def('comparator', (p) => diodeTop(p, false, true));
def('comparator_on', (p) => diodeTop(p, true, true));
def('lever', (p) => { clear(p); markNoTint(p); p.fillRect(7, 6, 9, 16, hex('#6a4a28')); p.fillRect(7, 6, 9, 8, hex('#5a5a5a')); });
def('flux_lamp', (p) => { p.each((x, y, u, v) => { const vr = voronoi(p, u, v, 4, 3); p.set(x, y, vr.edge < 0.6 ? hex('#3a2a20') : jitter(hex('#7a5a3a'), 0.06, p.grain(x, y)), 0.5); }); });
def('flux_lamp_on', (p) => { p.each((x, y, u, v) => { const vr = voronoi(p, u, v, 4, 3); p.set(x, y, vr.edge < 0.6 ? hex('#8a5a2a') : jitter(hex('#ffd9a0'), 0.04, p.grain(x, y)), 0.5); p.setMat(x, y, { emit: vr.edge < 0.6 ? 0.3 : 1 }); }); });
def('target_side', (p) => { noiseFill(p, hex('#e8ddd0'), 0.05, 0.04); p.each((x, y, u, v) => { const r = Math.max(Math.abs(u - 8), Math.abs(v - 8)); if (Math.floor(r / 2) % 2 === 0) p.set(x, y, hex('#d83a3a'), 0.5); }); });
def('target_top', (p) => { noiseFill(p, hex('#e8ddd0'), 0.05, 0.04); p.each((x, y, u, v) => { const r = Math.hypot(u - 8, v - 8); if (Math.floor(r / 2) % 2 === 0) p.set(x, y, hex('#d83a3a'), 0.5); }); });
def('daylight_detector_top', (p) => { polished(p, hex('#d8d0c0')); p.each((x, y, u, v) => { if (u > 2 && u < 14 && v > 2 && v < 14) p.set(x, y, (Math.floor(u) + Math.floor(v)) % 3 ? hex('#4a6a8a') : hex('#2a3a4a'), 0.6); }); p.material({ smooth: 0.8 }); });
def('daylight_detector_inverted_top', (p) => { polished(p, hex('#8a8070')); p.each((x, y, u, v) => { if (u > 2 && u < 14 && v > 2 && v < 14) p.set(x, y, (Math.floor(u) + Math.floor(v)) % 3 ? hex('#8a3a3a') : hex('#4a1a1a'), 0.6); }); });
def('daylight_detector_side', (p) => planks(p, PLANKS.oak!));
def('tripwire_hook', (p) => { clear(p); markNoTint(p); p.fillRect(7, 2, 9, 14, hex('#8a8a8a')); p.disc(8, 3, 1.5, (x, y) => p.set(x, y, hex('#6a6a6a'))); });
def('tripwire', (p) => { clear(p); markNoTint(p); p.each((x, y, u, v) => { if (Math.abs(v - 8) < 0.6) p.set(x, y, hex('#e8e8e8'), 0.6); }); });
def('tnt_side', (p) => { p.each((x, y, u, v) => { let c = u % 4 < 1 ? hex('#a82a1a') : hex('#d83a24'); if (v > 5 && v < 11) c = hex('#e8e4dc'); if (v > 7 && v < 9 && u > 4 && u < 12) c = hex('#2a2a2a'); p.set(x, y, jitter(c, 0.04, p.grain(x, y)), 0.5); }); });
def('tnt_top', (p) => { noiseFill(p, hex('#c8321e'), 0.05, 0.04); p.disc(8, 8, 2, (x, y) => p.set(x, y, hex('#e8e4dc'), 0.6)); p.disc(8, 8, 0.8, (x, y) => p.set(x, y, hex('#2a2a2a'), 0.3)); });
def('tnt_bottom', (p) => noiseFill(p, hex('#c8321e'), 0.05, 0.04));
def('piston_top', (p) => { planks(p, PLANKS.oak!); p.each((x, y, u, v) => { if (Math.min(u, v, 16 - u, 16 - v) < 1.5) p.set(x, y, hex('#8a8a8a'), 0.5); }); });
def('piston_top_sticky', (p) => { planks(p, PLANKS.oak!); p.each((x, y, u, v) => { const e = Math.min(u, v, 16 - u, 16 - v); if (e < 1.5) p.set(x, y, hex('#8a8a8a'), 0.5); else if (e > 3) p.set(x, y, jitter(hex('#6ab85a'), 0.06, p.grain(x, y)), 0.6); }); });
def('piston_side', (p) => { cobble(p, hex('#7a7a7a'), hex('#4a4a4a'), 5); p.each((x, y, u, v) => { if (v < 4) p.set(x, y, jitter(PLANKS.oak!, 0.05, p.grain(x, y)), 0.6); if (Math.abs(u - 8) < 1 && v >= 4 && v < 12) p.set(x, y, hex('#b8b8b8'), 0.7); }); });
def('piston_bottom', (p) => { cobble(p, hex('#7a7a7a'), hex('#4a4a4a'), 5); centerInlay(p, hex('#b8b8b8'), 3); });
def('piston_inner', (p) => { cobble(p, hex('#6a6a6a'), hex('#3a3a3a'), 5); p.disc(8, 8, 3, (x, y) => p.set(x, y, hex('#b8b8b8'), 0.7)); });
rule(/^observer_(front|side|back|back_on)$/, (p, m) => {
  cobble(p, hex('#6a6a6a'), hex('#3a3a3a'), 5);
  if (m[1] === 'front') { p.each((x, y, u, v) => { if (Math.abs(v - 7) < 2 && (Math.abs(u - 4.5) < 2 || Math.abs(u - 11.5) < 2)) p.set(x, y, hex('#1a1a1a'), 0.2); }); }
  if (m[1] === 'side') p.each((x, y, u, v) => { if (Math.abs(v - 8) < 0.8) p.set(x, y, hex('#8a2a2a'), 0.3); });
  if (m[1]!.startsWith('back')) p.disc(8, 8, 1.5, (x, y) => { p.set(x, y, m[1] === 'back_on' ? hex('#ff3a2a') : hex('#5a1a1a'), 0.5); if (m[1] === 'back_on') p.setMat(x, y, { emit: 1 }); });
});
rule(/^(dispenser|dropper)_front(_vertical)?$/, (p, m) => {
  cobble(p, hex('#7a7a7a'), hex('#4a4a4a'), 5);
  if (m[1] === 'dispenser') p.each((x, y, u, v) => { if (Math.abs(Math.hypot(u - 8, v - 8) - 3) < 1) p.set(x, y, hex('#1e1e1e'), 0.1); });
  else p.each((x, y, u, v) => { if (Math.abs(u - 8) < 2.5 && Math.abs(v - 8) < 2.5) p.set(x, y, hex('#1e1e1e'), 0.1); });
});
def('hopper_outside', (p) => metalBlock(p, hex('#3a3a3a'), {}));
def('hopper_inside', (p) => noiseFill(p, hex('#262626'), 0.04, 0.04));
def('hopper_top', (p) => metalBlock(p, hex('#444444'), {}));
rule(/^crafter_(front|side|bottom)(_crafting|_triggered)?$/, (p, m) => {
  furnaceSides(p, hex('#6a6a6a'));
  if (m[1] === 'front') p.each((x, y, u, v) => { if (u > 4 && u < 12 && v > 4 && v < 12) p.set(x, y, (Math.floor(u) + Math.floor(v)) % 2 ? hex('#3a3a3a') : hex('#4a4a4a'), 0.2); });
  if (m[2]) p.each((x, y, u, v) => { if (Math.abs(v - 2) < 1) { p.set(x, y, m[2] === '_crafting' ? hex('#ffd07a') : hex('#ff3a2a'), 0.5); p.setMat(x, y, { emit: 1 }); } });
});
rule(/^(\w+)_head_(face|back|side|top|bottom)$/, (p, m) => headTex(p, m[1]!, m[2]!));
rule(/^(chain_|repeating_)?command_block_(front|back|side|conditional)$/, (p, m) => {
  const c = m[1] === 'chain_' ? hex('#6aa38a') : m[1] === 'repeating_' ? hex('#7a5ab8') : hex('#b8845a');
  metalBlock(p, c, {});
  p.each((x, y, u, v) => { if (u > 3 && u < 13 && v > 3 && v < 13) p.set(x, y, hex('#1e1e1e'), 0.3); });
  if (m[2] === 'front' || m[2] === 'conditional') p.each((x, y, u, v) => { if (u > 5 && u < 11 && Math.abs(v - 8) < 0.6 || m[2] === 'conditional' && Math.abs(u - 8) < 0.6 && v > 5 && v < 11) p.set(x, y, hex('#e8e8e8'), 0.6); });
});
rule(/^structure_block_(save|load|corner|data)$/, (p, m) => { metalBlock(p, hex('#4a4a52'), {}); const col = { save: hex('#5ab8f0'), load: hex('#f0a23a'), corner: hex('#e8e8e8'), data: hex('#5af09a') }[m[1] as 'save']!; p.disc(8, 8, 3, (x, y) => p.set(x, y, col, 0.6)); });
def('jigsaw_side', (p) => { metalBlock(p, hex('#4a3f52'), {}); p.each((x, y, u, v) => { if (Math.abs(u - 8) < 2 && v < 5) p.set(x, y, hex('#e8e8e8'), 0.6); }); });
def('heavy_core', (p) => { metalBlock(p, hex('#4a4d52'), { rivets: true }); centerInlay(p, hex('#2a2d32'), 3); });
rule(/^dried_ghast_(top|bottom|side|face)$/, (p, m) => { noiseFill(p, hex('#b8b0aa'), 0.08, 0.1); crack(p, hex('#8a847e')); if (m[1] === 'face') { p.fillRect(3, 5, 6, 8, hex('#3a3a3a')); p.fillRect(10, 5, 13, 8, hex('#3a3a3a')); p.fillRect(6, 10, 10, 12, hex('#3a3a3a')); } });

// ---------------------------------------------------------------------------------------------
// Echo (sculk) family
// ---------------------------------------------------------------------------------------------
function echoBase(p: Painter): void {
  const f = p.frame;
  p.each((x, y, u, v) => {
    const vr = voronoi(p, u, v, 5, 7);
    const pulse = (Math.sin(f * 0.8 + vr.id) + 1) / 2;
    const vein = vr.edge < 0.5;
    p.set(x, y, vein ? mix(hex('#0f3a45'), hex('#29d6e0'), pulse) : jitter(hex('#0b1a22'), 0.05, p.grain(x, y)), vein ? 0.3 : 0.5);
    if (vein) p.setMat(x, y, { emit: 0.3 + pulse * 0.6 });
  });
  markNoTint(p);
}
def('echo_moss', (p) => echoBase(p));
def('echo_vein', (p) => { echoBase(p); p.each((x, y, u, v) => { if (voronoi(p, u, v, 5, 7).edge > 0.5) p.set(x, y, [0, 0, 0, 0], 0); }); });
rule(/^echo_catalyst_(top|top_bloom|side|bottom)$/, (p, m) => {
  if (m[1] === 'bottom') { stone(p, hex('#3a3a3a')); return; }
  if (m[1] === 'side') { echoBase(p); p.each((x, y, u, v) => { if (v > 8) p.set(x, y, jitter(hex('#ded9c8'), 0.05, p.grain(x, y)), 0.6); }); return; }
  echoBase(p);
  p.each((x, y, u, v) => { if (Math.hypot(u - 8, v - 8) < (m[1] === 'top_bloom' ? 5 : 3)) { p.set(x, y, hex('#d8f6ff'), 0.7); p.setMat(x, y, { emit: 1 }); } });
});
rule(/^echo_shrieker_(top|side|bottom|inner)$/, (p, m) => {
  if (m[1] === 'bottom' || m[1] === 'side') { stone(p, hex('#3f3a33')); if (m[1] === 'side') p.each((x, y, u, v) => { if (v < 6) p.set(x, y, hex('#0b1a22'), 0.4); }); return; }
  if (m[1] === 'inner') { echoBase(p); return; }
  noiseFill(p, hex('#d8d2bd'), 0.05, 0.05);
  p.each((x, y, u, v) => { if (Math.hypot(u - 8, v - 8) < 5) p.set(x, y, hex('#0b1a22'), 0.2); });
});
rule(/^(calibrated_)?echo_sensor_(top|side|bottom)$/, (p, m) => {
  if (m[2] === 'bottom') { stone(p, hex('#3a3a3a')); return; }
  echoBase(p);
  if (m[1]) p.each((x, y, u, v) => { if (Math.min(u, v, 16 - u, 16 - v) < 1.5) p.set(x, y, hex('#8a5ac4'), 0.6); });
});
rule(/^echo_sensor_tendril_(active|inactive)$/, (p, m) => { clear(p); markNoTint(p); for (const u of [4, 8, 12]) { stem(p, u, 16, u, 3, hex('#0f5a6a'), 1); blob(p, u, 3, 1, m[1] === 'active' ? hex('#6ffaff') : hex('#1f8a9a')); } if (m[1] === 'active') p.each((x, y) => { const c = p.get(x, y); if (c[1] > 200) p.setMat(x, y, { emit: 1 }); }); });

// ---------------------------------------------------------------------------------------------
// Creaking heart, misc
// ---------------------------------------------------------------------------------------------
rule(/^creaking_heart(_top)?(_awake|_dormant)?$/, (p, m) => {
  const [b, d] = BARK.pale_oak!;
  if (m[1]) logTop(p, PLANKS.pale_oak!, shade(PLANKS.pale_oak!, 0.8), b); else bark(p, b, d);
  if (m[2]) p.each((x, y, u, v) => {
    if (Math.abs(u - 8) < 2 && Math.abs(v - 8) < 3) {
      p.set(x, y, m[2] === '_awake' ? hex('#ff8a1a') : hex('#8a4a1a'), 0.5);
      if (m[2] === '_awake') p.setMat(x, y, { emit: 1 });
    }
  });
});
rule(/^(cake)_(top|side|bottom|inner)$/, (p, m) => {
  if (m[2] === 'top') { noiseFill(p, hex('#f2eee6'), 0.03, 0.03); speckle(p, [hex('#d8323a')], 0.06); return; }
  if (m[2] === 'bottom') { noiseFill(p, hex('#b8783a'), 0.05, 0.04); return; }
  p.each((x, y, u, v) => { const c = v < 4 ? hex('#f2eee6') : m[2] === 'inner' ? hex('#e8c89a') : hex('#b8783a'); p.set(x, y, jitter(c, 0.04, p.grain(x, y)), 0.5); });
  markNoTint(p);
});

rule(/^(exposed_|weathered_|oxidized_)copper$/, (p, m) => { copperBase(p, m[1]!); p.each((x, y, u, v) => { if (Math.min(u, v, 16 - u, 16 - v) < 1) p.set(x, y, shade(OX[m[1]!]![0], 0.8), 0.3); }); });
function gourdSide(p: Painter, base: RGB, rib: RGB): void {
  p.each((x, y, u, v) => {
    const r = (u % 4) / 4;
    const k = Math.sin(r * Math.PI);
    p.set(x, y, jitter(mix(rib, base, k), 0.05, p.grain(x, y)), 0.3 + k * 0.5);
  });
  p.material({ tint: 0, smooth: 0.35 });
}
def('pumpkin_side', (p) => gourdSide(p, hex('#e38a1d'), hex('#b8620f')));
def('pumpkin_top', (p) => { gourdSide(p, hex('#d9801a'), hex('#b8620f')); p.disc(8, 8, 1.5, (x, y) => p.set(x, y, hex('#6a7a2a'), 0.8)); });
def('melon_side', (p) => { p.each((x, y, u, v) => { const stripe = Math.sin(u * 1.2 + p.fbm(u, v, 3, 2) * 3) > 0.3; p.set(x, y, jitter(stripe ? hex('#5a8a1f') : hex('#8ab02a'), 0.05, p.grain(x, y)), stripe ? 0.4 : 0.6); }); p.material({ tint: 0, smooth: 0.4 }); });
def('melon_top', (p) => { p.each((x, y, u, v) => { const r = Math.hypot(u - 8, v - 8); p.set(x, y, jitter(Math.sin(r * 1.4) > 0.2 ? hex('#5a8a1f') : hex('#8ab02a'), 0.05, p.grain(x, y)), 0.5); }); p.material({ tint: 0 }); });
function carvedFace(p: Painter, lit: boolean): void {
  gourdSide(p, hex('#e38a1d'), hex('#b8620f'));
  const hole = lit ? hex('#ffd24a') : hex('#3a1a05');
  p.fillRect(3, 4, 6, 7, hole); p.fillRect(10, 4, 13, 7, hole); p.fillRect(7, 7, 9, 9, hole);
  p.fillRect(3, 10, 13, 12, hole); p.fillRect(4, 12, 6, 13, hole); p.fillRect(8, 12, 10, 13, hole); p.fillRect(11, 9, 13, 10, hole);
  if (lit) p.each((x, y) => { const c = p.get(x, y); if (c[1] > 190) p.setMat(x, y, { emit: 1 }); });
}
def('carved_pumpkin', (p) => carvedFace(p, false));
def('jack_o_lantern', (p) => carvedFace(p, true));
def('mangrove_roots_side', (p) => { clear(p); markNoTint(p); p.each((x, y, u, v) => { const k = Math.sin(u * 0.9 + v * 0.3) + Math.sin(u * 0.4 - v * 0.8); if (k > 0.6) p.set(x, y, jitter(hex('#4f3a28'), 0.06, p.grain(x, y)), 0.6); }); });
def('mangrove_roots_top', (p) => { clear(p); markNoTint(p); p.each((x, y, u, v) => { const k = Math.sin(u * 0.9) + Math.sin(v * 0.9); if (k > 0.7) p.set(x, y, jitter(hex('#4f3a28'), 0.06, p.grain(x, y)), 0.6); }); });
def('muddy_mangrove_roots_side', (p) => { noiseFill(p, hex('#3c393d'), 0.06, 0.08); p.each((x, y, u, v) => { if (Math.sin(u * 0.9 + v * 0.3) + Math.sin(u * 0.4 - v * 0.8) > 0.6) p.set(x, y, hex('#5a4430'), 0.7); }); });
def('muddy_mangrove_roots_top', (p) => { noiseFill(p, hex('#3c393d'), 0.06, 0.08); p.each((x, y, u, v) => { if (Math.sin(u * 0.9) + Math.sin(v * 0.9) > 0.7) p.set(x, y, hex('#5a4430'), 0.7); }); });
def('dragon_egg', (p) => { noiseFill(p, hex('#120a18'), 0.05, 0.06); speckle(p, [hex('#3a1a4a'), hex('#5a2a6a')], 0.25); p.material({ smooth: 0.7 }); });

// Crack overlays (block breaking animation)
for (let i = 0; i < 10; i++) {
  def(`destroy_stage_${i}`, (p) => {
    clear(p); markNoTint(p);
    const n = 2 + i * 2;
    for (let k = 0; k < n; k++) {
      let u = 8, v = 8;
      const a0 = p.rnd(k, 0, 5) * Math.PI * 2;
      for (let s = 0; s < 3 + i; s++) {
        const a = a0 + (p.rnd(k, s, 6) - 0.5) * 1.4;
        const nu = u + Math.cos(a) * 1.6, nv = v + Math.sin(a) * 1.6;
        p.line(u, v, nu, nv, [20, 20, 20, 190]);
        u = nu; v = nv;
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Helpers used above
// ---------------------------------------------------------------------------------------------
function crack(p: Painter, c: RGB): void {
  p.each((x, y, u, v) => {
    const vr = voronoi(p, u, v, 3, 99);
    if (vr.edge < 0.25 && p.rnd(x, y, 3) < 0.9) p.set(x, y, c, 0.1);
  });
}

function crackN(p: Painter, n: number): void {
  for (let k = 0; k < n * 2; k++) {
    let u = 3 + p.rnd(k, 0, 4) * 10, v = 3 + p.rnd(k, 1, 4) * 10;
    for (let s = 0; s < 4; s++) {
      const nu = u + (p.rnd(k, s + 2, 4) - 0.5) * 4, nv = v + (p.rnd(k, s + 7, 4) - 0.5) * 4;
      p.line(u, v, nu, nv, [60, 60, 70, 255]);
      u = nu; v = nv;
    }
  }
}

function moss(p: Painter): void {
  p.each((x, y, u, v) => {
    if (p.fbm(u, v, 3, 2, 21) > 0.58) p.set(x, y, jitter(hex('#5f7a33'), 0.08, p.grain(x, y, 3)), 0.7);
  });
}

function chiseledPattern(p: Painter, base: RGB, dark: RGB): void {
  polished(p, base);
  p.each((x, y, u, v) => {
    const du = Math.abs(u - 8), dv = Math.abs(v - 8);
    if (Math.abs(Math.max(du, dv) - 5) < 0.6 || Math.abs(du + dv - 4) < 0.6) p.set(x, y, dark, 0.2);
  });
}

function centerInlay(p: Painter, c: RGB, r: number): void {
  p.each((x, y, u, v) => {
    const d = Math.max(Math.abs(u - 8), Math.abs(v - 8));
    if (Math.abs(d - r) < 0.6) p.set(x, y, c, 0.3);
  });
}

function fringe(p: Painter, c: RGB, depth: number): void {
  for (let x = 0; x < p.n; x++) {
    const u = (x + 0.5) / p.s;
    const hang = depth - 1 + Math.floor(p.rndC(u, 0, 13) * 3);
    for (let y = 0; y < p.n; y++) {
      if ((y + 0.5) / p.s < hang) p.set(x, y, jitter(c, 0.08, p.grain(x, y, 3)), 0.7);
    }
  }
  p.material({ tint: 0 });
}

function furrows(p: Painter, a: RGB, b: RGB): void {
  p.each((x, y, u, v) => {
    const row = Math.floor(v / 4);
    const inRow = v - row * 4;
    const c = inRow < 1 ? b : a;
    p.set(x, y, jitter(c, 0.08, p.grain(x, y)), inRow < 1 ? 0.2 : 0.6);
  });
  p.material({ tint: 0 });
}

function iceTex(p: Painter, c: [number, number, number, number]): void {
  p.each((x, y, u, v) => {
    const k = p.fbm(u, v, 3, 2, 3);
    const streak = Math.abs(u - v * 0.6 - 4) < 0.5 || Math.abs(u - v * 0.6 - 11) < 0.4;
    p.set(x, y, [c[0] + k * 20, c[1] + k * 20, c[2], streak ? 220 : c[3]], 0.5);
  });
  p.material({ smooth: 0.9, bump: 0.3, tint: 0 });
}

function rawBlock(p: Painter, base: RGB, light: RGB): void {
  p.each((x, y, u, v) => {
    const vr = voronoi(p, u, v, 4, 5);
    const k = Math.min(1, vr.edge / 2);
    p.set(x, y, jitter(mix(shade(base, 0.7), light, k), 0.06, p.grain(x, y)), 0.3 + k * 0.6);
  });
  p.material({ bump: 1.6, metal: 0.3 });
}

function crystalTex(p: Painter, base: RGB, light: RGB): void {
  p.each((x, y, u, v) => {
    const vr = voronoi(p, u, v, 4, 8);
    const f = (vr.id * 37) % 5 / 5;
    p.set(x, y, vr.edge < 0.4 ? shade(base, 0.7) : mix(base, light, f), 0.4 + f * 0.4);
  });
  p.material({ smooth: 0.8 });
}

function wartBlock(p: Painter, base: RGB, light: RGB): void {
  p.each((x, y, u, v) => {
    const vr = voronoi(p, u, v, 5, 11);
    const k = Math.min(1, vr.edge / 1.5);
    p.set(x, y, jitter(mix(shade(base, 0.7), light, k), 0.06, p.grain(x, y)), 0.3 + k * 0.5);
  });
  p.material({ tint: 0 });
}

function hangingStrands(p: Painter, c: RGB, len: number): void {
  for (let i = 0; i < 6; i++) {
    const u = 2 + i * 2.4;
    const l = len * (0.6 + p.rnd(i, 0, 3) * 0.4);
    stem(p, u, 0, u + (p.rnd(i, 1, 3) - 0.5) * 1.5, l, shade(c, 0.9 + p.rnd(i, 2, 3) * 0.2), 1);
  }
}

function fernTex(p: Painter, c: RGB, h: number): void {
  for (let i = 0; i < 3; i++) {
    const baseU = 4 + i * 4;
    const topU = baseU + (i - 1) * 2.5;
    stem(p, baseU, 16, topU, 16 - h, shade(c, 0.85), 1);
    for (let k = 1; k < 7; k++) {
      const t = k / 7;
      const u = baseU + (topU - baseU) * t, v = 16 - h * t;
      stem(p, u, v, u - 2 * (1 - t), v - 1, c, 1);
      stem(p, u, v, u + 2 * (1 - t), v - 1, c, 1);
    }
  }
}

function deadBranches(p: Painter, c: RGB): void {
  stem(p, 8, 16, 8, 8, c, 1);
  stem(p, 8, 11, 4, 5, c, 1);
  stem(p, 8, 10, 12, 4, c, 1);
  stem(p, 5, 7, 2, 4, c, 1);
  stem(p, 11, 6, 14, 3, c, 1);
}

function kelpTex(p: Painter, top: boolean): void {
  stem(p, 8, 16, 8, top ? 4 : 0, hex('#3f7a2a'), 1.5);
  for (let v = 2; v < 16; v += 4) {
    blob(p, 6, v, 1.5, hex('#4f8a33'));
    blob(p, 10, v + 2, 1.5, hex('#4f8a33'));
  }
  if (top) blob(p, 8, 3, 1.5, hex('#6aa84a'));
}

function tulip(p: Painter, c: RGB): void {
  plantStem(p, 7);
  p.each((x, y, u, v) => {
    if (v > 3 && v < 8 && Math.abs(u - 8) < 2.5 - (v < 5 ? (5 - v) * 0.4 : 0)) p.set(x, y, jitter(c, 0.06, p.rnd(x, y)), 0.7);
  });
}

function sapling(p: Painter, wood: string): void {
  clear(p);
  markNoTint(p);
  const trunk = BARK[wood]?.[0] ?? hex('#6a4a28');
  const leaf: Record<string, RGB> = {
    oak: hex('#4f8a2a'), spruce: hex('#3a5a3a'), birch: hex('#6a9a4a'), jungle: hex('#3f8a2a'), acacia: hex('#6a8a2a'),
    dark_oak: hex('#2f5a1f'), cherry: hex('#f0a8c8'), pale_oak: hex('#8a928a'),
  };
  stem(p, 8, 16, 8, 8, trunk, 1);
  const lc = leaf[wood] ?? hex('#4f8a2a');
  if (wood === 'spruce') {
    for (let k = 0; k < 4; k++) p.fillRect(8 - (4 - k), 4 + k * 2.5, 8 + (4 - k), 5 + k * 2.5, lc);
  } else {
    for (let i = 0; i < 7; i++) blob(p, 5 + p.rnd(i, 0, 4) * 6, 3 + p.rnd(i, 1, 4) * 6, 2, lc);
  }
}

function cropTex(p: Painter, stage: number, maxStage: number, green: RGB, ripe: RGB): void {
  clear(p); markNoTint(p);
  const t = stage / maxStage;
  const c = mix(green, ripe, Math.max(0, (t - 0.5) * 2));
  const h = 3 + t * 12;
  for (let i = 0; i < 6; i++) {
    const u = 1.5 + i * 2.6;
    stem(p, u, 16, u + (p.rnd(i, 0, 1) - 0.5) * 2, 16 - h * (0.8 + p.rnd(i, 1, 1) * 0.2), c, 1);
    if (stage === maxStage) blob(p, u, 16 - h + 1, 1, shade(ripe, 1.1));
  }
}

function cropRoot(p: Painter, stage: number, root: RGB, leaf: RGB = hex('#4f9a2a')): void {
  clear(p); markNoTint(p);
  const h = 3 + stage * 3;
  for (let i = 0; i < 5; i++) {
    const u = 2 + i * 3;
    stem(p, u, 16, u, 16 - h, leaf, 1);
    blob(p, u, 16 - h, 1.2, shade(leaf, 1.1));
    if (stage === 3) blob(p, u, 15, 1.2, root);
  }
}

function door(p: Painter, c: RGB, top: boolean, wood: string): void {
  planks(p, c, { boards: 1 });
  p.each((x, y, u, v) => {
    const e = Math.min(u, v, 16 - u, 16 - v);
    if (e < 1.5) p.set(x, y, shade(c, 0.7), 0.3);
    if (top && u > 3 && u < 13 && v > 3 && v < 11 && wood !== 'dark_oak' && wood !== 'crimson' && wood !== 'warped') {
      if (Math.abs(u - 8) > 0.5 && Math.abs(v - 7) > 0.5) p.set(x, y, [0, 0, 0, 0], 0);
      else p.set(x, y, shade(c, 0.75), 0.4);
    }
    if (!top && Math.abs(u - 12.5) < 0.7 && v > 1 && v < 3) p.set(x, y, hex('#3a3a3a'), 0.7);
  });
  markNoTint(p);
}

function trapdoorTex(p: Painter, c: RGB, wood: string): void {
  planks(p, c, { boards: 4 });
  p.each((x, y, u, v) => {
    const e = Math.min(u, v, 16 - u, 16 - v);
    if (e < 1.5) p.set(x, y, shade(c, 0.7), 0.3);
    if (wood !== 'dark_oak' && wood !== 'spruce' && e > 2.5 && (Math.floor(u / 4) + Math.floor(v / 4)) % 2 === 0 && u % 4 > 1 && v % 4 > 1) p.set(x, y, [0, 0, 0, 0], 0);
  });
  markNoTint(p);
}

function obsidianish(p: Painter): void {
  noiseFill(p, hex('#160f22'), 0.05, 0.05);
  speckle(p, [hex('#3b2a58'), hex('#2a1d42')], 0.2);
}

function bookshelfTex(p: Painter, books: number): void {
  planks(p, PLANKS.oak!);
  const colors = [hex('#8a2a2a'), hex('#2a4a8a'), hex('#2a7a3a'), hex('#8a6a2a'), hex('#5a2a6a'), hex('#6a6a6a')];
  let n = 0;
  for (const row of [1, 9]) {
    for (let i = 0; i < 6; i++) {
      if (n++ >= books * 2) break;
      const u = 1 + i * 2.4;
      const h = 5 + p.rnd(i, row, 3) * 1.5;
      p.fillRect(u, row + (6 - h), u + 2, row + 6, colors[(i + row) % colors.length]!);
    }
  }
  markNoTint(p);
}

function toolIcon(p: Painter, kind: string, cu: number, cv: number): void {
  const dark = hex('#3a3a3a');
  if (kind === 'saw') { p.fillRect(cu - 2, cv, cu + 2, cv + 1, dark); p.fillRect(cu - 2, cv + 1, cu + 2, cv + 3, hex('#b8b8b8')); }
  else if (kind === 'hammer') { p.fillRect(cu - 1, cv, cu + 2, cv + 1.5, dark); p.fillRect(cu, cv + 1.5, cu + 1, cv + 5, hex('#6a4a28')); }
  else if (kind === 'pick') { p.line(cu - 3, cv, cu + 3, cv, hex('#8a8a8a')); p.line(cu, cv, cu, cv + 6, hex('#6a4a28')); }
  else if (kind === 'note') { p.disc(cu - 1, cv + 2, 1.5, (x, y) => p.set(x, y, dark)); p.fillRect(cu, cv - 3, cu + 0.8, cv + 2, dark); }
}

function headTex(p: Painter, kind: string, face: string): void {
  const col: Record<string, RGB> = {
    skeleton: hex('#d8d8d0'), blight_skeleton: hex('#2a2a2a'), zombie: hex('#4f8a4a'), player: hex('#c8966a'),
    hisser: hex('#5aa84a'), dragon: hex('#1a1a1f'), swinekin: hex('#e89a8a'),
  };
  const c = col[kind] ?? hex('#888888');
  noiseFill(p, c, 0.06, 0.06);
  markNoTint(p);
  if (face !== 'face') return;
  const dark = kind === 'blight_skeleton' || kind === 'dragon' ? hex('#8a2a8a') : hex('#1a1a1a');
  if (kind === 'hisser') {
    p.fillRect(3, 4, 6, 7, dark); p.fillRect(10, 4, 13, 7, dark);
    p.fillRect(6, 7, 10, 11, dark); p.fillRect(5, 9, 6, 13, dark); p.fillRect(10, 9, 11, 13, dark);
  } else {
    p.fillRect(3, 5, 6, 8, dark); p.fillRect(10, 5, 13, 8, dark);
    if (kind === 'swinekin') { p.fillRect(5, 9, 11, 13, hex('#d8847a')); p.fillRect(6, 10, 7, 12, dark); p.fillRect(9, 10, 10, 12, dark); }
    else if (kind === 'player') { p.fillRect(3, 5, 6, 8, hex('#f2f2f2')); p.fillRect(4, 5, 6, 8, hex('#3a5aa8')); p.fillRect(10, 5, 13, 8, hex('#f2f2f2')); p.fillRect(10, 5, 12, 8, hex('#3a5aa8')); p.fillRect(6, 11, 10, 12, hex('#8a5a3a')); p.fillRect(0, 0, 16, 3, hex('#4a2a1a')); }
    else p.fillRect(5, 10, 11, 12, dark);
  }
}

// ---------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------

/** Paint a texture by name. Returns false if no recipe matched. */
export function paintBlockTexture(p: Painter, name: string): boolean {
  const e = exact.get(name);
  if (e) {
    e(p);
    return true;
  }
  for (const [re, fn] of rules) {
    const m = re.exec(name);
    if (m) {
      fn(p, m);
      return true;
    }
  }
  return false;
}

export function hasBlockTexture(name: string): boolean {
  if (exact.has(name)) return true;
  return rules.some(([re]) => re.test(name));
}

export { add };
