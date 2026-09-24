/**
 * Special crafting recipes whose result depends on the grid content: dyeing, fireworks, banner
 * and book copies, shield decoration, repairs, suspicious stew, tipped arrows, decorated pots,
 * recolouring containers while keeping their contents.
 */
import { addRecipe, CraftingGrid } from './recipes';
import { ItemStack, FireworkExplosion } from '../item/stack';
import { getItem } from '../item/items';
import { COLORS } from '../block/defs/helpers';

/** Dye colour values (RGB) used for leather, fireworks and potions of colour. */
export const DYE_RGB: Record<string, number> = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f, pink: 0xf38baa,
  gray: 0x474f52, light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa, brown: 0x835432, green: 0x5e7c16,
  red: 0xb02e26, black: 0x1d1d21,
};

function items(g: CraftingGrid): ItemStack[] {
  return g.items.filter((s) => !s.isEmpty());
}

function dyeColor(s: ItemStack): string | null {
  const m = /^(.+)_dye$/.exec(s.id);
  return m && (COLORS as readonly string[]).includes(m[1]!) ? m[1]! : null;
}

/** Leather dyeing: average of existing colour and dyes, scaled to the brightest channel. */
export function mixColors(base: number | undefined, dyes: number[]): number {
  let r = 0, g = 0, b = 0, maxSum = 0, n = 0;
  const addC = (c: number) => {
    const cr = (c >> 16) & 255, cg = (c >> 8) & 255, cb = c & 255;
    maxSum += Math.max(cr, cg, cb);
    r += cr; g += cg; b += cb; n++;
  };
  if (base !== undefined) addC(base);
  for (const d of dyes) addC(d);
  let ar = r / n, ag = g / n, ab = b / n;
  const avgMax = maxSum / n;
  const curMax = Math.max(ar, ag, ab);
  if (curMax > 0) {
    ar = (ar * avgMax) / curMax; ag = (ag * avgMax) / curMax; ab = (ab * avgMax) / curMax;
  }
  return (Math.round(ar) << 16) | (Math.round(ag) << 8) | Math.round(ab);
}

const DYEABLE = new Set(['leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots', 'leather_horse_armor', 'wolf_armor']);

/** Small flowers → suspicious stew effect. */
export const STEW_EFFECTS: Record<string, { id: string; dur: number }> = {
  allium: { id: 'fire_resistance', dur: 60 }, azure_bluet: { id: 'blindness', dur: 160 }, blue_orchid: { id: 'saturation', dur: 7 },
  dandelion: { id: 'saturation', dur: 7 }, cornflower: { id: 'jump_boost', dur: 120 }, lily_of_the_valley: { id: 'poison', dur: 240 },
  oxeye_daisy: { id: 'regeneration', dur: 160 }, poppy: { id: 'night_vision', dur: 100 }, red_tulip: { id: 'weakness', dur: 180 },
  orange_tulip: { id: 'weakness', dur: 180 }, white_tulip: { id: 'weakness', dur: 180 }, pink_tulip: { id: 'weakness', dur: 180 },
  blight_rose: { id: 'withering', dur: 160 }, torchflower: { id: 'night_vision', dur: 100 }, open_gazebloom: { id: 'blindness', dur: 220 },
  closed_gazebloom: { id: 'nausea', dur: 140 },
};

export function registerSpecialRecipes(): void {
  addRecipe({
    type: 'special', id: 'armor_dye', category: 'misc',
    match(g) {
      let armor: ItemStack | null = null;
      const dyes: number[] = [];
      for (const s of items(g)) {
        const c = dyeColor(s);
        if (c) dyes.push(DYE_RGB[c]!);
        else if (DYEABLE.has(s.id) && !armor) armor = s;
        else return null;
      }
      if (!armor || dyes.length === 0) return null;
      const out = armor.copyWithCount(1);
      out.data.color = mixColors(armor.data.color, dyes);
      return out;
    },
  });

  addRecipe({
    type: 'special', id: 'firework_star', category: 'misc',
    match(g) {
      let gunpowder = 0, shape: FireworkExplosion['shape'] = 'small_ball', trail = false, twinkle = false, shapes = 0;
      const colors: number[] = [];
      for (const s of items(g)) {
        const c = dyeColor(s);
        if (c) colors.push(DYE_RGB[c]!);
        else if (s.id === 'gunpowder') gunpowder++;
        else if (s.id === 'fire_charge') { shape = 'large_ball'; shapes++; }
        else if (s.id === 'gold_nugget') { shape = 'star'; shapes++; }
        else if (s.id === 'feather') { shape = 'burst'; shapes++; }
        else if (/_head$|_skull$/.test(s.id)) { shape = 'creeper'; shapes++; }
        else if (s.id === 'diamond') { if (trail) return null; trail = true; }
        else if (s.id === 'glowstone_dust') { if (twinkle) return null; twinkle = true; }
        else return null;
      }
      if (gunpowder !== 1 || colors.length === 0 || shapes > 1) return null;
      const out = new ItemStack('firework_star', 1);
      out.data.explosion = { shape, colors, fadeColors: [], trail, twinkle };
      return out;
    },
  });

  addRecipe({
    type: 'special', id: 'firework_star_fade', category: 'misc',
    match(g) {
      let star: ItemStack | null = null;
      const fade: number[] = [];
      for (const s of items(g)) {
        const c = dyeColor(s);
        if (c) fade.push(DYE_RGB[c]!);
        else if (s.id === 'firework_star' && s.data.explosion && !star) star = s;
        else return null;
      }
      if (!star || !fade.length) return null;
      const out = star.copyWithCount(1);
      out.data.explosion = { ...out.data.explosion!, fadeColors: fade };
      return out;
    },
  });

  addRecipe({
    type: 'special', id: 'firework_rocket', category: 'misc',
    match(g) {
      let paper = 0, gunpowder = 0;
      const explosions: FireworkExplosion[] = [];
      for (const s of items(g)) {
        if (s.id === 'paper') paper++;
        else if (s.id === 'gunpowder') gunpowder++;
        else if (s.id === 'firework_star') { if (s.data.explosion) explosions.push(s.data.explosion); }
        else return null;
      }
      if (paper !== 1 || gunpowder < 1 || gunpowder > 3) return null;
      const out = new ItemStack('firework_rocket', 3);
      out.data.fireworks = { flight: gunpowder, explosions };
      return out;
    },
  });

  addRecipe({
    type: 'special', id: 'banner_duplicate', category: 'misc',
    match(g) {
      const list = items(g);
      if (list.length !== 2 || !list.every((s) => s.id.endsWith('_banner') && s.id === list[0]!.id)) return null;
      const src = list.find((s) => s.data.banner && s.data.banner.length > 0);
      const blank = list.find((s) => !s.data.banner || s.data.banner.length === 0);
      if (!src || !blank) return null;
      return src.copyWithCount(1);
    },
    remainders(g) {
      return g.items.map((s) => (s.data.banner && s.data.banner.length > 0 ? s.copyWithCount(1) : ItemStack.empty()));
    },
  });

  addRecipe({
    type: 'special', id: 'shield_decoration', category: 'misc',
    match(g) {
      const list = items(g);
      if (list.length !== 2) return null;
      const shield = list.find((s) => s.id === 'shield');
      const banner = list.find((s) => s.id.endsWith('_banner'));
      if (!shield || !banner || shield.data.baseColor) return null;
      const out = shield.copyWithCount(1);
      out.data.baseColor = banner.id.replace(/_banner$/, '');
      out.data.banner = banner.data.banner ? JSON.parse(JSON.stringify(banner.data.banner)) as typeof out.data.banner : [];
      return out;
    },
  });

  addRecipe({
    type: 'special', id: 'book_cloning', category: 'misc',
    match(g) {
      let book: ItemStack | null = null, blanks = 0;
      for (const s of items(g)) {
        if (s.id === 'written_book' && !book) book = s;
        else if (s.id === 'writable_book') blanks++;
        else return null;
      }
      if (!book || blanks === 0 || (book.data.generation ?? 0) >= 2) return null;
      const out = book.copyWithCount(blanks);
      out.data.generation = (book.data.generation ?? 0) + 1;
      return out;
    },
    remainders(g) {
      return g.items.map((s) => (s.id === 'written_book' ? s.copyWithCount(1) : ItemStack.empty()));
    },
  });

  addRecipe({
    type: 'special', id: 'map_cloning', category: 'misc',
    match(g) {
      let map: ItemStack | null = null, blanks = 0;
      for (const s of items(g)) {
        if (s.id === 'filled_map' && !map) map = s;
        else if (s.id === 'map') blanks++;
        else return null;
      }
      if (!map || blanks === 0) return null;
      return map.copyWithCount(blanks + 1);
    },
  });

  addRecipe({
    type: 'special', id: 'map_extending', category: 'misc',
    match(g) {
      if (g.width < 3 || g.height < 3) return null;
      let map: ItemStack | null = null;
      for (let i = 0; i < g.items.length; i++) {
        const s = g.items[i]!;
        const center = i === Math.floor(g.items.length / 2);
        if (center) { if (s.id !== 'filled_map') return null; map = s; }
        else if (s.id !== 'paper') return null;
      }
      if (!map) return null;
      const scale = (map.data.extra?.['scale'] as number | undefined) ?? 0;
      if (scale >= 4 || map.data.extra?.['locked']) return null;
      const out = map.copyWithCount(1);
      out.data.extra = { ...(out.data.extra ?? {}), scale: scale + 1, zoomFrom: map.data.mapId };
      return out;
    },
  });

  addRecipe({
    type: 'special', id: 'repair_item', category: 'misc',
    match(g) {
      const list = items(g);
      if (list.length !== 2 || list[0]!.id !== list[1]!.id) return null;
      const def = getItem(list[0]!.id);
      if (!def || def.maxDamage <= 0 || list[0]!.count !== 1 || list[1]!.count !== 1) return null;
      const max = def.maxDamage;
      const left = (max - list[0]!.damage) + (max - list[1]!.damage) + Math.floor(max * 0.05);
      const out = new ItemStack(def.id, 1);
      out.damage = Math.max(0, max - left);
      return out;
    },
  });

  addRecipe({
    type: 'special', id: 'suspicious_stew', category: 'food',
    match(g) {
      let red = false, brown = false, bowl = false, flower: string | null = null;
      for (const s of items(g)) {
        if (s.id === 'red_mushroom' && !red) red = true;
        else if (s.id === 'brown_mushroom' && !brown) brown = true;
        else if (s.id === 'bowl' && !bowl) bowl = true;
        else if (STEW_EFFECTS[s.id] && !flower) flower = s.id;
        else return null;
      }
      if (!red || !brown || !bowl || !flower) return null;
      const out = new ItemStack('suspicious_stew', 1);
      out.data.suspicious = [STEW_EFFECTS[flower]!];
      return out;
    },
  });

  addRecipe({
    type: 'special', id: 'tipped_arrow', category: 'equipment',
    match(g) {
      if (g.width !== 3 || g.height !== 3) return null;
      for (let i = 0; i < 9; i++) {
        const s = g.items[i]!;
        if (i === 4) { if (s.id !== 'lingering_potion') return null; }
        else if (s.id !== 'arrow') return null;
      }
      const out = new ItemStack('tipped_arrow', 8);
      const pot = g.items[4]!;
      if (pot.data.potion) out.data.potion = pot.data.potion;
      if (pot.data.customEffects) out.data.customEffects = pot.data.customEffects;
      return out;
    },
  });

  addRecipe({
    type: 'special', id: 'decorated_pot', category: 'misc',
    match(g) {
      if (g.width !== 3 || g.height !== 3) return null;
      const slots = [1, 3, 5, 7];
      for (let i = 0; i < 9; i++) {
        const s = g.items[i]!;
        if (slots.includes(i)) {
          if (!(s.id === 'brick' || s.id.endsWith('_pottery_sherd'))) return null;
        } else if (!s.isEmpty()) return null;
      }
      const out = new ItemStack('decorated_pot', 1);
      const sherds = [g.items[1]!.id, g.items[3]!.id, g.items[5]!.id, g.items[7]!.id];
      if (sherds.some((s) => s !== 'brick')) out.data.sherds = sherds;
      return out;
    },
  });

  // Recolouring containers keeps their contents
  addRecipe({
    type: 'special', id: 'shell_box_coloring', category: 'misc',
    match(g) {
      let box: ItemStack | null = null, color: string | null = null;
      for (const s of items(g)) {
        const c = dyeColor(s);
        if (c && !color) color = c;
        else if ((s.id === 'shell_box' || s.id.endsWith('_shell_box')) && !box) box = s;
        else return null;
      }
      if (!box || !color || box.id === `${color}_shell_box`) return null;
      const out = new ItemStack(`${color}_shell_box`, 1, JSON.parse(JSON.stringify(box.data)));
      return out;
    },
  });
  addRecipe({
    type: 'special', id: 'bundle_coloring', category: 'equipment',
    match(g) {
      let bundle: ItemStack | null = null, color: string | null = null;
      for (const s of items(g)) {
        const c = dyeColor(s);
        if (c && !color) color = c;
        else if ((s.id === 'bundle' || s.id.endsWith('_bundle')) && !bundle) bundle = s;
        else return null;
      }
      if (!bundle || !color || bundle.id === `${color}_bundle`) return null;
      return new ItemStack(`${color}_bundle`, 1, JSON.parse(JSON.stringify(bundle.data)));
    },
  });
}
