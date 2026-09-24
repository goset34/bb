/**
 * Loot tables: pools of weighted entries with conditions (silk touch, shears, random chance,
 * fortune tables, block state…) and functions (counts, fortune bonuses, explosion decay,
 * damage, enchantments…). Block tables are generated on demand from block definitions.
 */
import { Random } from '../math/random';
import { ItemStack } from '../item/stack';
import { getItem } from '../item/items';

export interface LootContext {
  rng: Random;
  /** Tool used (mining) or weapon (kills). */
  tool?: ItemStack | null;
  /** Block state being broken. */
  state?: number;
  /** Explosion radius when destroyed by an explosion. */
  explosion?: number;
  killedByPlayer?: boolean;
  luck?: number;
  /** Entity-related flags (on fire, baby, sheep colour…). */
  flags?: Record<string, unknown>;
}

export type Condition = (ctx: LootContext) => boolean;
export type LootFn = (stack: ItemStack, ctx: LootContext) => ItemStack;
export type NumberProvider = number | [number, number];

export interface LootEntry {
  kind: 'item' | 'empty' | 'alternatives' | 'group' | 'table';
  id?: string;
  weight: number;
  quality: number;
  conditions: Condition[];
  functions: LootFn[];
  children?: LootEntry[];
}

export interface LootPool {
  rolls: NumberProvider;
  bonusRolls: number;
  entries: LootEntry[];
  conditions: Condition[];
  functions: LootFn[];
}

export interface LootTable {
  pools: LootPool[];
  functions: LootFn[];
}

const TABLES = new Map<string, LootTable>();
const lazy: Array<(id: string) => LootTable | null> = [];

export function registerLootTable(id: string, t: LootTable): void {
  TABLES.set(id, t);
}

/** Resolver for generated tables (block drops…). */
export function registerLootResolver(fn: (id: string) => LootTable | null): void {
  lazy.push(fn);
}

export function lootTable(id: string): LootTable | null {
  let t = TABLES.get(id);
  if (t) return t;
  for (const fn of lazy) {
    const r = fn(id);
    if (r) {
      TABLES.set(id, r);
      return r;
    }
  }
  return null;
}

export function hasLootTable(id: string): boolean {
  return lootTable(id) !== null;
}

// ---------------------------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------------------------

export function num(p: NumberProvider, r: Random): number {
  return typeof p === 'number' ? p : r.nextIntBetween(p[0], p[1]);
}

function expand(e: LootEntry, ctx: LootContext, out: LootEntry[]): boolean {
  if (!e.conditions.every((c) => c(ctx))) return false;
  if (e.kind === 'alternatives') {
    for (const c of e.children!) if (expand(c, ctx, out)) return true;
    return false;
  }
  if (e.kind === 'group') {
    for (const c of e.children!) expand(c, ctx, out);
    return true;
  }
  out.push(e);
  return true;
}

function rollPool(pool: LootPool, ctx: LootContext, out: ItemStack[]): void {
  if (!pool.conditions.every((c) => c(ctx))) return;
  const rolls = num(pool.rolls, ctx.rng) + Math.floor(pool.bonusRolls * (ctx.luck ?? 0));
  for (let i = 0; i < rolls; i++) {
    const cands: LootEntry[] = [];
    for (const e of pool.entries) expand(e, ctx, cands);
    if (!cands.length) continue;
    const luck = ctx.luck ?? 0;
    const w = (e: LootEntry) => Math.max(0, Math.floor(e.weight + e.quality * luck));
    const chosen = cands.length === 1 ? cands[0]! : ctx.rng.pickWeighted(cands, w);
    if (!chosen) continue;
    if (chosen.kind === 'empty') continue;
    if (chosen.kind === 'table') {
      out.push(...rollLoot(chosen.id!, ctx));
      continue;
    }
    let stack = new ItemStack(chosen.id!, 1);
    for (const f of chosen.functions) stack = f(stack, ctx);
    for (const f of pool.functions) stack = f(stack, ctx);
    if (!stack.isEmpty()) out.push(stack);
  }
}

/** Roll a table; returns stacks (possibly oversized; callers split by max stack size). */
export function rollLoot(id: string, ctx: LootContext): ItemStack[] {
  const t = lootTable(id);
  if (!t) return [];
  const out: ItemStack[] = [];
  for (const pool of t.pools) rollPool(pool, ctx, out);
  const res: ItemStack[] = [];
  for (let s of out) {
    for (const f of t.functions) s = f(s, ctx);
    if (s.isEmpty()) continue;
    const max = getItem(s.id)?.maxStack ?? 64;
    while (s.count > max) res.push(s.split(max));
    res.push(s);
  }
  return res;
}

/** Spread stacks over `slots` container slots like the reference chest filler. */
export function fillContainer(stacks: ItemStack[], slots: number, r: Random): Array<ItemStack | null> {
  const out: Array<ItemStack | null> = new Array(slots).fill(null);
  const free: number[] = [];
  for (let i = 0; i < slots; i++) free.push(i);
  r.shuffle(free);
  const pending = [...stacks];
  // Split some stacks to spread them out
  const split: ItemStack[] = [];
  for (const s of pending) {
    let st = s;
    while (st.count > 1 && free.length - split.length - pending.length > 0 && r.nextInt(3) === 0) {
      const part = st.split(r.nextIntBetween(1, Math.max(1, Math.floor(st.count / 2))));
      split.push(part);
    }
    split.push(st);
  }
  for (const s of split) {
    const slot = free.pop();
    if (slot === undefined) break;
    out[slot] = s;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

type Mod = { cond?: Condition; fn?: LootFn; weight?: number; quality?: number };

export function entry(id: string, ...mods: Mod[]): LootEntry {
  const e: LootEntry = { kind: 'item', id, weight: 1, quality: 0, conditions: [], functions: [] };
  for (const m of mods) {
    if (m.cond) e.conditions.push(m.cond);
    if (m.fn) e.functions.push(m.fn);
    if (m.weight !== undefined) e.weight = m.weight;
    if (m.quality !== undefined) e.quality = m.quality;
  }
  return e;
}

export function empty(weight = 1): LootEntry {
  return { kind: 'empty', weight, quality: 0, conditions: [], functions: [] };
}

export function tableRef(id: string, weight = 1): LootEntry {
  return { kind: 'table', id, weight, quality: 0, conditions: [], functions: [] };
}

export function alternatives(...children: LootEntry[]): LootEntry {
  return { kind: 'alternatives', weight: 1, quality: 0, conditions: [], functions: [], children };
}

export function group(...children: LootEntry[]): LootEntry {
  return { kind: 'group', weight: 1, quality: 0, conditions: [], functions: [], children };
}

export function pool(entries: LootEntry[], rolls: NumberProvider = 1, ...mods: Mod[]): LootPool {
  const p: LootPool = { rolls, bonusRolls: 0, entries, conditions: [], functions: [] };
  for (const m of mods) {
    if (m.cond) p.conditions.push(m.cond);
    if (m.fn) p.functions.push(m.fn);
  }
  return p;
}

export function table(...pools: LootPool[]): LootTable {
  return { pools, functions: [] };
}

export const w = (weight: number, quality = 0): Mod => ({ weight, quality });
export const when = (cond: Condition): Mod => ({ cond });
export const apply = (fn: LootFn): Mod => ({ fn });

// Conditions
export const hasSilk: Condition = (c) => (c.tool?.getEnchant('silk_touch') ?? 0) > 0;
export const noSilk: Condition = (c) => !hasSilk(c);
export const hasShears: Condition = (c) => c.tool?.id === 'shears';
export const silkOrShears: Condition = (c) => hasSilk(c) || hasShears(c);
export const chance = (p: number): Condition => (c) => c.rng.nextFloat() < p;
export const killedByPlayer: Condition = (c) => !!c.killedByPlayer;
export const survivesExplosion: Condition = (c) => !c.explosion || c.rng.nextFloat() < 1 / c.explosion;
export const flag = (name: string, value: unknown = true): Condition => (c) => c.flags?.[name] === value;
/** Chance by fortune level (table_bonus). */
export const fortuneChance = (chances: number[]): Condition => (c) => {
  const f = c.tool?.getEnchant('fortune') ?? 0;
  return c.rng.nextFloat() < chances[Math.min(f, chances.length - 1)]!;
};
export const lootingChance = (base: number, perLevel: number): Condition => (c) => c.rng.nextFloat() < base + (c.tool?.getEnchant('looting') ?? 0) * perLevel;

// Functions
export const setCount = (n: NumberProvider): LootFn => (s, c) => {
  s.count = num(n, c.rng);
  return s;
};
export const setCountF = (min: number, max: number): LootFn => (s, c) => {
  s.count = Math.floor(min + c.rng.nextFloat() * (max - min + 1));
  return s;
};
/** Ore drops: multiply by 1..fortune+1 with the reference distribution. */
export const oreBonus: LootFn = (s, c) => {
  const f = c.tool?.getEnchant('fortune') ?? 0;
  if (f > 0) {
    const i = c.rng.nextInt(f + 2) - 1;
    s.count *= Math.max(1, i + 1);
  }
  return s;
};
/** Uniform bonus: + 0..fortune×mult. */
export const uniformBonus = (mult = 1): LootFn => (s, c) => {
  const f = c.tool?.getEnchant('fortune') ?? 0;
  if (f > 0) s.count += c.rng.nextInt(f * mult + 1);
  return s;
};
/** Binomial bonus: extra tries at probability p (crops). */
export const binomialBonus = (extra: number, p: number): LootFn => (s, c) => {
  const f = c.tool?.getEnchant('fortune') ?? 0;
  for (let i = 0; i < f + extra; i++) if (c.rng.nextFloat() < p) s.count++;
  return s;
};
export const limit = (min: number, max: number): LootFn => (s) => {
  s.count = Math.max(min, Math.min(max, s.count));
  return s;
};
/** Explosion decay: each item survives with probability 1/radius. */
export const explosionDecay: LootFn = (s, c) => {
  if (!c.explosion) return s;
  let n = 0;
  for (let i = 0; i < s.count; i++) if (c.rng.nextFloat() <= 1 / c.explosion) n++;
  s.count = n;
  return s;
};
export const lootingBonus = (min: number, max: number, cap = 0): LootFn => (s, c) => {
  const l = c.tool?.getEnchant('looting') ?? 0;
  if (l > 0) s.count += Math.round(min + c.rng.nextFloat() * (max - min) * l);
  if (cap > 0) s.count = Math.min(cap, s.count);
  return s;
};
export const setDamage = (min: number, max: number): LootFn => (s, c) => {
  const def = getItem(s.id);
  if (def && def.maxDamage > 0) {
    const frac = min + c.rng.nextFloat() * (max - min);
    s.damage = Math.floor(def.maxDamage * (1 - frac));
  }
  return s;
};
export const setData = (data: Partial<ItemStack['data']>): LootFn => (s) => {
  Object.assign(s.data, JSON.parse(JSON.stringify(data)));
  return s;
};
/** Cooks the drop when the entity died burning (reference furnace_smelt). */
export const smeltIfBurning = (cooked: string): LootFn => (s, c) => (c.flags?.['onFire'] ? new ItemStack(cooked, s.count, s.data) : s);

/** Enchantment hooks filled by the enchanting module (H8); identity until then. */
export const enchantHooks = {
  randomly: (s: ItemStack, _r: Random): ItemStack => s,
  withLevels: (s: ItemStack, _r: Random, _levels: NumberProvider, _treasure: boolean): ItemStack => s,
};
export const enchantRandomly: LootFn = (s, c) => enchantHooks.randomly(s, c.rng);
export const enchantWithLevels = (levels: NumberProvider, treasure = false): LootFn => (s, c) => enchantHooks.withLevels(s, c.rng, levels, treasure);
