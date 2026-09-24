/**
 * Command argument types: numbers, words, strings, coordinates (absolute, ~relative, ^local),
 * entity selectors (@p @a @r @s @e with filters), items, block states, enums, time and ranges.
 */
import type { Entity } from '../../common/entity/ecs';
import { ArgType, Reader, fail, ParseContext } from './dispatcher';
import type { StrataServer } from '../server';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';
import type { TextComponent } from '../../common/lang/i18n';
import { ITEMS } from '../../common/item/items';
import { BLOCK_BY_NAME, BLOCKS, Block, setValue } from '../../common/block/registry';
import { ItemStack, ItemData } from '../../common/item/stack';

/** Who runs a command and where. */
export interface CommandSource {
  server: StrataServer;
  level: ServerLevel;
  player: ServerPlayer | null;
  entity: Entity | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** 0 = everyone, 2 = game master (command blocks), 4 = owner. */
  permission: number;
  name: string;
  /** Feedback to the source only. */
  send(text: TextComponent): void;
  /** Suppress feedback (command blocks with feedback off). */
  silent?: boolean;
}

type Ctx = ParseContext<CommandSource>;

const NS = /^(minecraft|strata):/;

export function stripNs(id: string): string {
  return id.replace(NS, '');
}

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

export function integer(min = -2147483648, max = 2147483647): ArgType<number, CommandSource> {
  return {
    parse(r) {
      const tok = r.readToken();
      if (!/^-?\d+$/.test(tok)) fail('argument.integer.invalid', tok);
      const v = parseInt(tok, 10);
      if (v < min) fail('argument.integer.low', min, v);
      if (v > max) fail('argument.integer.big', max, v);
      return v;
    },
  };
}

export function float(min = -Infinity, max = Infinity): ArgType<number, CommandSource> {
  return {
    parse(r) {
      const tok = r.readToken();
      const v = Number(tok);
      if (!tok || !Number.isFinite(v)) fail('argument.float.invalid', tok);
      if (v < min) fail('argument.float.low', min, v);
      if (v > max) fail('argument.float.big', max, v);
      return v;
    },
  };
}

export const bool: ArgType<boolean, CommandSource> = {
  parse(r) {
    const tok = r.readToken();
    if (tok !== 'true' && tok !== 'false') fail('argument.bool.invalid', tok);
    return tok === 'true';
  },
  suggest: () => ['true', 'false'],
};

export function word(suggestions: () => string[] = () => []): ArgType<string, CommandSource> {
  return { parse: (r) => r.readToken(), suggest: () => suggestions() };
}

export const str: ArgType<string, CommandSource> = { parse: (r) => r.readQuotedOrToken() };

export const greedy: ArgType<string, CommandSource> = { parse: (r) => r.readRest(), greedy: true };

export function oneOf<T extends string>(values: readonly T[]): ArgType<T, CommandSource> {
  return {
    parse(r) {
      const tok = r.readToken() as T;
      if (!values.includes(tok)) fail('argument.enum.invalid', tok);
      return tok;
    },
    suggest: () => [...values],
  };
}

/** Duration with suffix: d (days = 24000 ticks), s (seconds = 20 ticks), t (ticks, default). */
export const time: ArgType<number, CommandSource> = {
  parse(r) {
    const tok = r.readToken();
    const m = /^(\d+(?:\.\d+)?)([dst]?)$/.exec(tok);
    if (!m) fail('argument.time.invalid', tok);
    const n = parseFloat(m[1]!);
    const mul = m[2] === 'd' ? 24000 : m[2] === 's' ? 20 : 1;
    return Math.round(n * mul);
  },
};

/** Range "a..b", "..b", "a..", or "a". */
export interface Range { min: number; max: number }

export function parseRange(tok: string): Range {
  const m = /^(-?\d*(?:\.\d+)?)(\.\.)?(-?\d*(?:\.\d+)?)$/.exec(tok);
  if (!m || (!m[1] && !m[3])) fail('argument.range.invalid', tok);
  if (!m[2]) { const v = parseFloat(m[1]!); return { min: v, max: v }; }
  return { min: m[1] ? parseFloat(m[1]) : -Infinity, max: m[3] ? parseFloat(m[3]) : Infinity };
}

// ---------------------------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------------------------

function coordTriple(r: Reader, ctx: Ctx, center: boolean): [number, number, number] {
  const toks = [r.readToken()];
  for (let i = 0; i < 2; i++) {
    if (r.peek() !== ' ') fail('argument.pos.incomplete');
    r.pos++;
    toks.push(r.readToken());
  }
  const s = ctx.source;
  const local = toks.every((t) => t.startsWith('^'));
  if (!local && toks.some((t) => t.startsWith('^'))) fail('argument.pos.mixed');
  const num = (t: string) => {
    const v = t.length > 1 ? Number(t.slice(1)) : 0;
    if (!Number.isFinite(v)) fail('argument.pos.invalid', toks.join(' '));
    return v;
  };
  if (local) {
    const [l, u, f] = toks.map(num) as [number, number, number];
    const yaw = (s.yaw * Math.PI) / 180, pitch = (s.pitch * Math.PI) / 180;
    const fx = -Math.sin(yaw) * Math.cos(pitch), fy = -Math.sin(pitch), fz = Math.cos(yaw) * Math.cos(pitch);
    const ux = -Math.sin(yaw) * Math.sin(pitch), uy = Math.cos(pitch), uz = Math.cos(yaw) * Math.sin(pitch);
    const lx = Math.cos(yaw), lz = Math.sin(yaw);
    const eye = s.entity?.physics?.eyeHeight ?? 0;
    return [s.x + fx * f + ux * u + lx * l, s.y + eye + fy * f + uy * u, s.z + fz * f + uz * u + lz * l];
  }
  const base = [s.x, s.y, s.z];
  return toks.map((t, i) => {
    if (t.startsWith('~')) return base[i]! + num(t);
    const v = Number(t);
    if (!t || !Number.isFinite(v)) fail('argument.pos.invalid', toks.join(' '));
    return center && i !== 1 && /^-?\d+$/.test(t) ? v + 0.5 : v;
  }) as [number, number, number];
}

export const blockPos: ArgType<[number, number, number], CommandSource> = {
  parse(r, ctx) {
    const [x, y, z] = coordTriple(r, ctx, false);
    return [Math.floor(x), Math.floor(y), Math.floor(z)];
  },
  suggest: (p) => (p === '' || p.startsWith('~') ? ['~', '~ ~', '~ ~ ~'] : []),
};

export const vec3: ArgType<[number, number, number], CommandSource> = {
  parse: (r, ctx) => coordTriple(r, ctx, true),
  suggest: (p) => (p === '' || p.startsWith('~') ? ['~', '~ ~', '~ ~ ~'] : []),
};

export const rotation: ArgType<[number, number], CommandSource> = {
  parse(r, ctx) {
    const a = r.readToken();
    if (r.peek() !== ' ') fail('argument.rotation.incomplete');
    r.pos++;
    const b = r.readToken();
    const f = (t: string, base: number) => (t.startsWith('~') ? base + (t.length > 1 ? Number(t.slice(1)) : 0) : Number(t));
    const yaw = f(a, ctx.source.yaw), pitch = f(b, ctx.source.pitch);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) fail('argument.rotation.invalid');
    return [yaw, pitch];
  },
};

// ---------------------------------------------------------------------------------------------
// Entity selectors
// ---------------------------------------------------------------------------------------------

export interface SelectorResult {
  entities: Entity[];
}

function allLevels(s: CommandSource): ServerLevel[] {
  return [...s.server.levels.values()];
}

function playerByName(s: CommandSource, name: string): ServerPlayer | undefined {
  return s.server.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

function entityTags(e: Entity): Set<string> {
  let t = e['tags'] as Set<string> | undefined;
  if (!t) { t = new Set(); e['tags'] = t; }
  return t;
}
export { entityTags };

/** Parse and resolve a selector or player name into entities. */
function select(r: Reader, ctx: Ctx, playersOnly: boolean): Entity[] {
  const s = ctx.source;
  const tok = r.readToken();
  if (!tok.startsWith('@')) {
    const p = playerByName(s, tok);
    if (p) return [p.entity];
    // Entity UUID-like numeric id
    if (/^\d+$/.test(tok) && !playersOnly) {
      for (const l of allLevels(s)) { const e = l.entities.get(parseInt(tok, 10)); if (e) return [e]; }
    }
    fail('argument.player.unknown', tok);
  }
  const m = /^@([parse])(?:\[(.*)\])?$/.exec(tok);
  if (!m) fail('argument.entity.selector.unknown', tok);
  const kind = m[1]!;
  const opts = new Map<string, string[]>();
  if (m[2]) {
    for (const part of splitTop(m[2])) {
      const eq = part.indexOf('=');
      if (eq < 0) fail('argument.entity.options.valueless', part);
      const k = part.slice(0, eq).trim(), v = part.slice(eq + 1).trim();
      const arr = opts.get(k) ?? [];
      arr.push(v);
      opts.set(k, arr);
    }
  }
  let list: Entity[];
  const levels = opts.has('x') || opts.has('distance') || kind === 'p' || kind === 'r' ? [s.level] : allLevels(s);
  if (kind === 's') list = s.entity ? [s.entity] : [];
  else if (kind === 'p' || kind === 'a' || kind === 'r' || playersOnly) list = levels.flatMap((l) => l.players.filter((p) => p.joined && !p.disconnected).map((p) => p.entity as Entity));
  else list = levels.flatMap((l) => [...l.entities.all()].filter((e) => !e.removed));
  const ox = opts.has('x') ? Number(opts.get('x')![0]) : s.x;
  const oy = opts.has('y') ? Number(opts.get('y')![0]) : s.y;
  const oz = opts.has('z') ? Number(opts.get('z')![0]) : s.z;
  const dist = (e: Entity) => {
    const t = e.transform!;
    return Math.hypot(t.x - ox, t.y - oy, t.z - oz);
  };
  for (const [k, vals] of opts) {
    for (const v of vals) {
      const neg = v.startsWith('!');
      const val = neg ? v.slice(1) : v;
      switch (k) {
        case 'type': list = list.filter((e) => (stripNs(val) === e.type) !== neg); break;
        case 'name': list = list.filter((e) => ((e.player?.name ?? (e['customName'] as string | undefined) ?? '') === val.replace(/^"|"$/g, '')) !== neg); break;
        case 'tag': list = list.filter((e) => (val === '' ? entityTags(e).size === 0 : entityTags(e).has(val)) !== neg); break;
        case 'gamemode': list = list.filter((e) => (e.player?.gameMode === val) !== neg); break;
        case 'distance': { const rg = parseRange(val); list = list.filter((e) => { const d = dist(e); return d >= rg.min && d <= rg.max; }); break; }
        case 'level': { const rg = parseRange(val); list = list.filter((e) => { const l = e.xp?.level ?? -1; return l >= rg.min && l <= rg.max; }); break; }
        case 'dx': case 'dy': case 'dz': {
          const dx = Number(opts.get('dx')?.[0] ?? 0), dy = Number(opts.get('dy')?.[0] ?? 0), dz = Number(opts.get('dz')?.[0] ?? 0);
          list = list.filter((e) => {
            const t = e.transform!;
            return t.x >= Math.min(ox, ox + dx) && t.x <= Math.max(ox, ox + dx) + 1 && t.y >= Math.min(oy, oy + dy) && t.y <= Math.max(oy, oy + dy) + 1 && t.z >= Math.min(oz, oz + dz) && t.z <= Math.max(oz, oz + dz) + 1;
          });
          break;
        }
        case 'x': case 'y': case 'z': case 'limit': case 'sort': break;
        default: fail('argument.entity.options.unknown', k);
      }
    }
  }
  const sort = opts.get('sort')?.[0] ?? (kind === 'p' ? 'nearest' : kind === 'r' ? 'random' : 'arbitrary');
  if (sort === 'nearest') list.sort((a, b) => dist(a) - dist(b));
  else if (sort === 'furthest') list.sort((a, b) => dist(b) - dist(a));
  else if (sort === 'random') for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j]!, list[i]!]; }
  const limit = opts.has('limit') ? parseInt(opts.get('limit')![0]!, 10) : kind === 'p' || kind === 'r' ? 1 : Infinity;
  return list.slice(0, limit);
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function selectorSuggestions(s: CommandSource): string[] {
  return ['@p', '@a', '@r', '@s', '@e', ...s.server.players.map((p) => p.name)];
}

/** One or more entities (fails when none match). */
export const entities: ArgType<Entity[], CommandSource> = {
  parse(r, ctx) {
    const list = select(r, ctx, false);
    if (!list.length) fail('argument.entity.notfound.entity');
    return list;
  },
  suggest: (_p, ctx) => selectorSuggestions(ctx.source),
};

export const entity: ArgType<Entity, CommandSource> = {
  parse(r, ctx) {
    const list = select(r, ctx, false);
    if (!list.length) fail('argument.entity.notfound.entity');
    if (list.length > 1) fail('argument.entity.toomany');
    return list[0]!;
  },
  suggest: (_p, ctx) => selectorSuggestions(ctx.source),
};

function toPlayers(s: CommandSource, list: Entity[]): ServerPlayer[] {
  return list.map((e) => s.server.players.find((p) => p.entity === e)).filter((p): p is ServerPlayer => !!p);
}

export const players: ArgType<ServerPlayer[], CommandSource> = {
  parse(r, ctx) {
    const list = toPlayers(ctx.source, select(r, ctx, true));
    if (!list.length) fail('argument.entity.notfound.player');
    return list;
  },
  suggest: (_p, ctx) => selectorSuggestions(ctx.source).filter((x) => x !== '@e'),
};

export const player: ArgType<ServerPlayer, CommandSource> = {
  parse(r, ctx) {
    const list = toPlayers(ctx.source, select(r, ctx, true));
    if (!list.length) fail('argument.entity.notfound.player');
    if (list.length > 1) fail('argument.player.toomany');
    return list[0]!;
  },
  suggest: (_p, ctx) => selectorSuggestions(ctx.source).filter((x) => x !== '@e' && x !== '@a'),
};

// ---------------------------------------------------------------------------------------------
// Items and blocks
// ---------------------------------------------------------------------------------------------

/** Item id with optional JSON data: `diamond_sword{"enchants":{"sharpness":5}}`. */
export const item: ArgType<ItemStack, CommandSource> = {
  parse(r) {
    const tok = r.readToken();
    const brace = tok.indexOf('{');
    const id = stripNs(brace < 0 ? tok : tok.slice(0, brace));
    if (!ITEMS.has(id)) fail('argument.item.id.invalid', id);
    let data: ItemData = {};
    if (brace >= 0) {
      try { data = JSON.parse(tok.slice(brace)) as ItemData; } catch { fail('argument.item.data.invalid', tok.slice(brace)); }
    }
    return new ItemStack(id, 1, data);
  },
  suggest: (p) => [...ITEMS.keys()].filter((k) => k.startsWith(stripNs(p))),
};

/** Block state `name[prop=value,…]`. */
export const blockState: ArgType<number, CommandSource> = {
  parse(r) {
    const tok = r.readToken();
    const br = tok.indexOf('[');
    const name = stripNs(br < 0 ? tok : tok.slice(0, br));
    const b = BLOCK_BY_NAME.get(name);
    if (!b) fail('argument.block.id.invalid', name);
    let st = b.defaultState;
    if (br >= 0) {
      if (!tok.endsWith(']')) fail('argument.block.property.unclosed');
      for (const kv of tok.slice(br + 1, -1).split(',').filter(Boolean)) {
        const [k, v] = kv.split('=').map((x) => x.trim()) as [string, string];
        const prop = b.props.find((p) => p.name === k);
        if (!prop) fail('argument.block.property.unknown', name, k);
        const val = (prop.values as readonly unknown[]).find((x) => String(x) === v);
        if (val === undefined) fail('argument.block.property.invalid', name, v, k);
        st = setValue(st, prop, val as never);
      }
    }
    return st;
  },
  suggest: (p) => BLOCKS.map((b: Block) => b.name).filter((k) => k.startsWith(stripNs(p))),
};

export function registryId(ids: () => Iterable<string>, errKey: string): ArgType<string, CommandSource> {
  return {
    parse(r) {
      const id = stripNs(r.readToken());
      if (![...ids()].includes(id)) fail(errKey, id);
      return id;
    },
    suggest: (p) => [...ids()].filter((k) => k.startsWith(stripNs(p))),
  };
}
