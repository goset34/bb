/** Item stacks with structured data components (damage, enchantments, names, potions…). */
import { ByteReader, ByteWriter } from '../util/bytes';

export interface FireworkExplosion {
  shape: 'small_ball' | 'large_ball' | 'star' | 'creeper' | 'burst';
  colors: number[];
  fadeColors: number[];
  trail: boolean;
  twinkle: boolean;
}

export interface BannerLayer {
  pattern: string;
  color: string;
}

export interface ItemData {
  damage?: number;
  enchants?: Record<string, number>;
  /** Enchantments stored in an enchanted book. */
  stored?: Record<string, number>;
  name?: string;
  lore?: string[];
  potion?: string;
  customEffects?: Array<{ id: string; amp: number; dur: number }>;
  /** Dyed leather color / firework star color. */
  color?: number;
  unbreakable?: boolean;
  repairCost?: number;
  trim?: { material: string; pattern: string };
  banner?: BannerLayer[];
  baseColor?: string;
  fireworks?: { flight: number; explosions: FireworkExplosion[] };
  explosion?: FireworkExplosion;
  mapId?: number;
  pages?: string[];
  title?: string;
  author?: string;
  generation?: number;
  bundle?: SerializedStack[];
  container?: Array<SerializedStack | null>;
  entity?: Record<string, unknown>;
  lodestone?: { x: number; y: number; z: number; dim: string; tracked: boolean };
  charged?: SerializedStack[];
  instrument?: string;
  suspicious?: Array<{ id: string; dur: number }>;
  bees?: number;
  honey?: number;
  sherds?: string[];
  ominous?: number;
  /** Arbitrary extra fields for special items. */
  extra?: Record<string, unknown>;
}

export interface SerializedStack {
  id: string;
  count: number;
  data?: ItemData;
}

export class ItemStack {
  static readonly EMPTY = new ItemStack('air', 0);

  constructor(public id: string, public count = 1, public data: ItemData = {}) {}

  isEmpty(): boolean {
    return this.count <= 0 || this.id === 'air';
  }

  copy(): ItemStack {
    return new ItemStack(this.id, this.count, cloneData(this.data));
  }

  copyWithCount(n: number): ItemStack {
    const c = this.copy();
    c.count = n;
    return c;
  }

  /** Remove up to n items and return them as a new stack. */
  split(n: number): ItemStack {
    const take = Math.min(n, this.count);
    const out = this.copyWithCount(take);
    this.count -= take;
    return out;
  }

  shrink(n = 1): void {
    this.count -= n;
  }

  grow(n = 1): void {
    this.count += n;
  }

  is(id: string): boolean {
    return this.id === id && this.count > 0;
  }

  /** Same item and identical data (stackable together). */
  sameItemSameData(o: ItemStack): boolean {
    return this.id === o.id && dataEquals(this.data, o.data);
  }

  get damage(): number {
    return this.data.damage ?? 0;
  }

  set damage(v: number) {
    if (v <= 0) delete this.data.damage;
    else this.data.damage = v;
  }

  getEnchant(id: string): number {
    return this.data.enchants?.[id] ?? 0;
  }

  hasEnchants(): boolean {
    return !!this.data.enchants && Object.keys(this.data.enchants).length > 0;
  }

  toJSON(): SerializedStack {
    const o: SerializedStack = { id: this.id, count: this.count };
    if (Object.keys(this.data).length) o.data = this.data;
    return o;
  }

  static fromJSON(s: SerializedStack | null | undefined): ItemStack {
    if (!s) return ItemStack.empty();
    return new ItemStack(s.id, s.count, cloneData(s.data ?? {}));
  }

  static empty(): ItemStack {
    return new ItemStack('air', 0);
  }

  write(w: ByteWriter): void {
    if (this.isEmpty()) {
      w.string('');
      return;
    }
    w.string(this.id);
    w.varUint(this.count);
    const keys = Object.keys(this.data);
    if (keys.length === 0) w.u8(0);
    else {
      w.u8(1);
      w.json(this.data);
    }
  }

  static read(r: ByteReader): ItemStack {
    const id = r.string();
    if (!id) return ItemStack.empty();
    const count = r.varUint();
    const hasData = r.u8();
    const data = hasData ? r.json<ItemData>() : {};
    return new ItemStack(id, count, data);
  }
}

export function cloneData(d: ItemData): ItemData {
  if (!d || Object.keys(d).length === 0) return {};
  return JSON.parse(JSON.stringify(d)) as ItemData;
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as object).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k])).join(',') + '}';
}

export function dataEquals(a: ItemData, b: ItemData): boolean {
  const ak = Object.keys(a).length;
  const bk = Object.keys(b).length;
  if (ak === 0 && bk === 0) return true;
  if (ak !== bk) return false;
  return stableStringify(a) === stableStringify(b);
}
