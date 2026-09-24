/**
 * Block registry: numeric ids, contiguous state ids and flat per-state lookup tables.
 * The registry is built identically (same order → same ids) in every thread/process.
 */
import { Property, PropValue, P } from './properties';
import {
  RenderShape, RenderLayer, Shape, Element, EMPTY_SHAPE, FULL_SHAPE, shapeFromElements, boundsOfElements, fullFaceMask, Wave,
} from './model';
import type { BlockBehavior } from './behavior';

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears';
export type PushReaction = 'normal' | 'destroy' | 'block' | 'push_only' | 'ignore';
export type Fluid = 'none' | 'water' | 'lava';
export type OffsetType = 'none' | 'xz' | 'xyz';

/** Read-only view of a state used by model/shape functions. */
export class StateView {
  constructor(readonly block: Block, readonly state: number) {}
  get<T extends PropValue>(p: Property<T>): T {
    return getValue(this.state, p);
  }
  has(p: Property): boolean {
    return this.block.props.includes(p);
  }
}

export interface BlockSettings {
  hardness?: number;
  resistance?: number;
  sound?: string;
  map?: string;
  tool?: ToolKind;
  /** Minimum harvest tier: 0 wood/gold, 1 stone, 2 iron, 3 diamond, 4 infernium. */
  tier?: number;
  requiresTool?: boolean;
  light?: number | ((s: StateView) => number);
  opacity?: number;
  friction?: number;
  speedFactor?: number;
  jumpFactor?: number;
  collision?: boolean;
  replaceable?: boolean;
  randomTicks?: boolean;
  /** [igniteOdds, burnOdds] */
  flammable?: [number, number];
  layer?: RenderLayer;
  push?: PushReaction;
  conductor?: boolean;
  offset?: OffsetType;
  tags?: string[];
  fluid?: Fluid;
  air?: boolean;
  /** Visual model. */
  model?: (s: StateView) => RenderShape;
  /** Collision shape override. */
  shape?: (s: StateView) => Shape;
  /** Outline / selection shape override. */
  outline?: (s: StateView) => Shape;
  /** Waving class for the foliage shader. */
  wave?: Wave | ((s: StateView) => Wave);
  /** The block drops nothing when broken (unless a loot table says otherwise). */
  noDrops?: boolean;
  /** Custom drop item id; default: the block's own item. */
  drops?: string;
  /** Whether an item form exists. */
  noItem?: boolean;
  /** Item id used for pick-block and the block item name. */
  itemId?: string;
  /** Is this state considered "waterlogged" (fluid state = water source). */
  waterloggedProp?: boolean;
  /** Emits particles/sounds when the player walks, used by the audio layer. */
  stepSound?: string;
  /** Is the block a full solid for mob spawning / suffocation etc. (default: collision full cube). */
  solid?: boolean;
  /** Is a valid spawn surface (default: solid & opaque). */
  spawnable?: boolean;
  /** Ignites entities / damage on contact. */
  hot?: boolean;
  /** Block entity type id. */
  blockEntity?: string;
  /** Explicit dynamic shape (depends on neighbours) — handled by behaviors. */
  dynamicShape?: boolean;
  /** The block can be replaced by fluids flowing into it (plants, torches…). */
  fluidBreaks?: boolean;
  instrument?: string;
  /** Emissive render (always full-bright), e.g. magma, lava. */
  emissive?: boolean;
  /** Occlusion: when false, the block never hides neighbour faces even if full cube (glass, leaves). */
  occludes?: boolean;
  /** Culls faces against the same block (glass-to-glass, water-to-water). */
  cullSame?: boolean;
  /** Mining speed multiplier for swords (cobweb, bamboo) */
  swordFast?: boolean;
  /** Name override for language keys. */
  lang?: string;
  /** Default property values (by property name). */
  defaults?: Record<string, PropValue>;
}

/** Global default property values (reference defaults), applied when a block has the property. */
const GLOBAL_DEFAULTS: Record<string, PropValue> = {
  axis: 'y', half: 'bottom', type: 'bottom', distance: 7,
};

export class Block {
  id = 0;
  baseState = 0;
  stateCount = 1;
  defaultState = 0;
  readonly strides: number[] = [];
  behavior!: BlockBehavior;
  /** Item id that places this block (filled by the item registry). */
  item = '';
  constructor(readonly name: string, readonly props: Property[], readonly settings: BlockSettings) {}

  hasProp(p: Property): boolean {
    return this.props.includes(p);
  }

  get hardness(): number {
    return this.settings.hardness ?? 0;
  }

  get resistance(): number {
    return this.settings.resistance ?? this.settings.hardness ?? 0;
  }

  /** Default state with some properties overridden. */
  with(values: Partial<Record<string, PropValue>>): number {
    let s = this.defaultState;
    for (const [k, v] of Object.entries(values)) {
      const p = this.props.find((pp) => pp.name === k);
      if (!p || v === undefined) continue;
      s = setValue(s, p, v);
    }
    return s;
  }

  toString(): string {
    return this.name;
  }
}

// ---------------------------------------------------------------------------------------------
// Global tables
// ---------------------------------------------------------------------------------------------

export const BLOCKS: Block[] = [];
export const BLOCK_BY_NAME = new Map<string, Block>();
export const TAGS = new Map<string, Set<number>>();

export let STATE_COUNT = 0;
export let stateBlock = new Uint16Array(0);
export let stateFlags = new Uint32Array(0);
export let stateLight = new Uint8Array(0);
export let stateOpacity = new Uint8Array(0);
export let stateFaceMask = new Uint8Array(0);
export let stateWave = new Uint8Array(0);

/** State flag bits. */
export const F = {
  AIR: 1 << 0,
  OPAQUE_CUBE: 1 << 1, // full, opaque, occluding cube (culls neighbours, blocks light)
  FULL_COLLISION: 1 << 2, // collision is a full cube
  NO_COLLISION: 1 << 3,
  REPLACEABLE: 1 << 4,
  RANDOM_TICKS: 1 << 5,
  WATER: 1 << 6, // fluid state is water (water block or waterlogged)
  LAVA: 1 << 7,
  CONDUCTOR: 1 << 8, // redstone conductor
  CUTOUT: 1 << 9,
  TRANSLUCENT: 1 << 10,
  CUBE_MODEL: 1 << 11,
  INVISIBLE: 1 << 12,
  SOLID: 1 << 13, // blocks motion (suffocation, spawning surface)
  FLUID_BLOCK: 1 << 14, // the block itself is a liquid (water / lava block)
  HAS_BE: 1 << 15,
  WATERLOGGED: 1 << 16,
  FLAMMABLE: 1 << 17,
  EMISSIVE: 1 << 18,
  CULL_SAME: 1 << 19,
  FLUID_BREAKS: 1 << 20,
  SPAWNABLE: 1 << 21,
  HOT: 1 << 22,
} as const;

let frozen = false;
const shapeCache: (Shape | undefined)[] = [];
const outlineCache: (Shape | undefined)[] = [];
const renderCache: (RenderShape | undefined)[] = [];

export function registerBlock(name: string, props: Property[], settings: BlockSettings): Block {
  if (frozen) throw new Error('Block registry is frozen');
  if (BLOCK_BY_NAME.has(name)) throw new Error('Duplicate block ' + name);
  const b = new Block(name, props, settings);
  b.id = BLOCKS.length;
  b.baseState = STATE_COUNT;
  let count = 1;
  for (let i = props.length - 1; i >= 0; i--) {
    b.strides[i] = count;
    count *= props[i]!.count;
  }
  b.stateCount = count;
  // Default state: index 0 for each property unless overridden
  let def = b.baseState;
  const defaults = { ...GLOBAL_DEFAULTS, ...(settings.defaults ?? {}) };
  props.forEach((p, i) => {
    let v: PropValue | undefined = defaults[p.name];
    if (p.name === 'half' && p.values.includes('lower' as never)) v = settings.defaults?.['half'] ?? 'lower';
    if (p.name === 'type' && !p.values.includes('bottom' as never)) v = settings.defaults?.['type'];
    if (v === undefined) return;
    const idx = (p.values as readonly PropValue[]).indexOf(v);
    if (idx > 0) def += idx * b.strides[i]!;
  });
  b.defaultState = def;
  STATE_COUNT += count;
  BLOCKS.push(b);
  BLOCK_BY_NAME.set(name, b);
  for (const t of settings.tags ?? []) addTag(t, b);
  return b;
}

export function addTag(tag: string, b: Block): void {
  let s = TAGS.get(tag);
  if (!s) TAGS.set(tag, (s = new Set()));
  s.add(b.id);
}

export function hasTag(state: number, tag: string): boolean {
  const s = TAGS.get(tag);
  return !!s && s.has(stateBlock[state]!);
}

export function blockHasTag(b: Block, tag: string): boolean {
  const s = TAGS.get(tag);
  return !!s && s.has(b.id);
}

export function blocksInTag(tag: string): Block[] {
  const s = TAGS.get(tag);
  return s ? [...s].map((i) => BLOCKS[i]!) : [];
}

export function blockOf(state: number): Block {
  return BLOCKS[stateBlock[state]!]!;
}

export function getBlock(name: string): Block {
  const b = BLOCK_BY_NAME.get(name);
  if (!b) throw new Error('Unknown block ' + name);
  return b;
}

export function tryGetBlock(name: string): Block | undefined {
  return BLOCK_BY_NAME.get(name);
}

/** Default state of a named block. */
export function S(name: string): number {
  return getBlock(name).defaultState;
}

export function isBlock(state: number, b: Block): boolean {
  return stateBlock[state] === b.id;
}

export function propIndexOf(b: Block, p: Property): number {
  return b.props.indexOf(p);
}

export function getIndex(state: number, p: Property): number {
  const b = BLOCKS[stateBlock[state]!]!;
  const i = b.props.indexOf(p);
  if (i < 0) return -1;
  return Math.floor((state - b.baseState) / b.strides[i]!) % p.count;
}

export function getValue<T extends PropValue>(state: number, p: Property<T>): T {
  const i = getIndex(state, p);
  if (i < 0) throw new Error(`Block ${blockOf(state).name} has no property ${p.name}`);
  return p.values[i]!;
}

export function tryGetValue<T extends PropValue>(state: number, p: Property<T>): T | undefined {
  const i = getIndex(state, p);
  return i < 0 ? undefined : p.values[i];
}

export function withIndex(state: number, p: Property, idx: number): number {
  const b = BLOCKS[stateBlock[state]!]!;
  const i = b.props.indexOf(p);
  if (i < 0) return state;
  const stride = b.strides[i]!;
  const cur = Math.floor((state - b.baseState) / stride) % p.count;
  return state + (idx - cur) * stride;
}

export function setValue<T extends PropValue>(state: number, p: Property<T>, v: T): number {
  const b = BLOCKS[stateBlock[state]!]!;
  if (!b.props.includes(p)) return state;
  return withIndex(state, p, p.indexOf(v));
}

/** Cycle to the next value of a property. */
export function cycle(state: number, p: Property): number {
  const i = getIndex(state, p);
  if (i < 0) return state;
  return withIndex(state, p, (i + 1) % p.count);
}

export function stateToString(state: number): string {
  const b = blockOf(state);
  if (b.props.length === 0) return b.name;
  const parts = b.props.map((p) => `${p.name}=${p.names[getIndex(state, p)]}`);
  return `${b.name}[${parts.join(',')}]`;
}

/** Parse "name[prop=value,...]" into a state id (unknown props ignored). */
export function parseState(str: string): number | undefined {
  const m = /^([a-z0-9_:]+)(?:\[(.*)\])?$/.exec(str.trim());
  if (!m) return undefined;
  const name = m[1]!.replace(/^strata:/, '');
  const b = BLOCK_BY_NAME.get(name);
  if (!b) return undefined;
  let s = b.defaultState;
  if (m[2]) {
    for (const kv of m[2].split(',')) {
      const [k, v] = kv.split('=');
      if (!k || v === undefined) continue;
      const p = b.props.find((pp) => pp.name === k.trim());
      if (!p) continue;
      const idx = p.indexOfName(v.trim());
      if (idx >= 0) s = withIndex(s, p, idx);
    }
  }
  return s;
}

export function stateProps(state: number): Record<string, string> {
  const b = blockOf(state);
  const o: Record<string, string> = {};
  for (const p of b.props) o[p.name] = p.names[getIndex(state, p)]!;
  return o;
}

// ---------------------------------------------------------------------------------------------
// Shapes & render data (lazy per state)
// ---------------------------------------------------------------------------------------------

export function getRenderShape(state: number): RenderShape {
  let r = renderCache[state];
  if (r) return r;
  const b = blockOf(state);
  r = b.settings.model ? b.settings.model(new StateView(b, state)) : { kind: 'none' };
  renderCache[state] = r;
  return r;
}

export function getCollisionShape(state: number): Shape {
  let s = shapeCache[state];
  if (s) return s;
  const b = blockOf(state);
  if (b.settings.collision === false || b.settings.air || b.settings.fluid && !b.settings.waterloggedProp && isFluidBlock(b)) {
    s = EMPTY_SHAPE;
  } else if (b.settings.shape) {
    s = b.settings.shape(new StateView(b, state));
  } else {
    const r = getRenderShape(state);
    if (r.kind === 'cube') s = FULL_SHAPE;
    else if (r.kind === 'model') s = shapeFromElements(r.elements);
    else s = EMPTY_SHAPE;
  }
  shapeCache[state] = s;
  return s;
}

export function getOutlineShape(state: number): Shape {
  let s = outlineCache[state];
  if (s) return s;
  const b = blockOf(state);
  if (b.settings.outline) s = b.settings.outline(new StateView(b, state));
  else {
    const c = b.settings.collision === false ? EMPTY_SHAPE : getCollisionShape(state);
    if (c.length > 0) s = c;
    else {
      const r = getRenderShape(state);
      if (r.kind === 'model') s = boundsOfElements(r.elements);
      else if (r.kind === 'cube') s = FULL_SHAPE;
      else s = EMPTY_SHAPE;
    }
  }
  outlineCache[state] = s;
  return s;
}

function isFluidBlock(b: Block): boolean {
  return b.name === 'water' || b.name === 'lava';
}

let sturdyCache = new Int8Array(0);

/** Is the given face of the block's collision shape a full square (can support torches, buttons…). */
export function isFaceSturdy(state: number, dir: number): boolean {
  if (sturdyCache.length !== STATE_COUNT) sturdyCache = new Int8Array(STATE_COUNT).fill(-1);
  let m = sturdyCache[state]!;
  if (m < 0) {
    const f = stateFlags[state]!;
    m = f & F.FULL_COLLISION ? 63 : f & F.NO_COLLISION ? 0 : fullFaceMask(getCollisionShape(state));
    sturdyCache[state] = m;
  }
  return (m & (1 << dir)) !== 0;
}

export function renderElements(state: number): Element[] {
  const r = getRenderShape(state);
  return r.kind === 'model' ? r.elements : [];
}

/**
 * Freeze the registry and compute flat state tables. Must be called once after all
 * registerBlock calls (done by blocks.ts → initBlocks()).
 */
export interface StateTables {
  flags: Uint32Array;
  light: Uint8Array;
  opacity: Uint8Array;
  faceMask: Uint8Array;
  wave: Uint8Array;
}

/** Export computed per-state tables so other threads can skip the expensive freeze pass. */
export function exportStateTables(): StateTables {
  return { flags: stateFlags.slice(), light: stateLight.slice(), opacity: stateOpacity.slice(), faceMask: stateFaceMask.slice(), wave: stateWave.slice() };
}

export function freezeRegistry(pre?: StateTables): void {
  if (frozen) return;
  frozen = true;
  stateBlock = new Uint16Array(STATE_COUNT);
  if (pre && pre.flags.length === STATE_COUNT) {
    for (const b of BLOCKS) {
      for (let s = b.baseState; s < b.baseState + b.stateCount; s++) stateBlock[s] = b.id;
    }
    stateFlags = pre.flags;
    stateLight = pre.light;
    stateOpacity = pre.opacity;
    stateFaceMask = pre.faceMask;
    stateWave = pre.wave;
    return;
  }
  stateFlags = new Uint32Array(STATE_COUNT);
  stateLight = new Uint8Array(STATE_COUNT);
  stateOpacity = new Uint8Array(STATE_COUNT);
  stateFaceMask = new Uint8Array(STATE_COUNT);
  stateWave = new Uint8Array(STATE_COUNT);
  for (const b of BLOCKS) {
    for (let s = b.baseState; s < b.baseState + b.stateCount; s++) stateBlock[s] = b.id;
  }
  const waterlogged = P.waterlogged;
  for (const b of BLOCKS) {
    const st = b.settings;
    for (let s = b.baseState; s < b.baseState + b.stateCount; s++) {
      const view = new StateView(b, s);
      let flags = 0;
      const layer = st.layer ?? 'solid';
      const isAir = !!st.air;
      if (isAir) flags |= F.AIR;
      const render = isAir ? ({ kind: 'none' } as RenderShape) : getRenderShape(s);
      if (render.kind === 'none') flags |= F.INVISIBLE;
      if (render.kind === 'cube') flags |= F.CUBE_MODEL;
      if (layer === 'cutout') flags |= F.CUTOUT;
      if (layer === 'translucent') flags |= F.TRANSLUCENT;
      const coll = getCollisionShape(s);
      const fullColl = coll.length === 6 && coll[0] === 0 && coll[1] === 0 && coll[2] === 0 && coll[3] === 1 && coll[4] === 1 && coll[5] === 1;
      if (fullColl) flags |= F.FULL_COLLISION;
      if (coll.length === 0) flags |= F.NO_COLLISION;
      const occludes = st.occludes ?? (layer === 'solid');
      const opaqueCube = render.kind === 'cube' && occludes && fullColl;
      if (opaqueCube) flags |= F.OPAQUE_CUBE;
      if (st.replaceable || isAir) flags |= F.REPLACEABLE;
      if (st.randomTicks) flags |= F.RANDOM_TICKS;
      if (st.fluid === 'water') flags |= F.WATER | (isFluidBlock(b) ? F.FLUID_BLOCK : 0);
      if (st.fluid === 'lava') flags |= F.LAVA | F.FLUID_BLOCK;
      if (b.props.includes(waterlogged) && view.get(waterlogged)) flags |= F.WATER | F.WATERLOGGED;
      if (st.conductor ?? opaqueCube) flags |= F.CONDUCTOR;
      if (st.blockEntity) flags |= F.HAS_BE;
      if (st.flammable) flags |= F.FLAMMABLE;
      if (st.emissive) flags |= F.EMISSIVE;
      if (st.cullSame) flags |= F.CULL_SAME;
      if (st.fluidBreaks) flags |= F.FLUID_BREAKS;
      if (st.hot) flags |= F.HOT;
      const solid = st.solid ?? fullColl;
      if (solid) flags |= F.SOLID;
      if (st.spawnable ?? (solid && occludes)) flags |= F.SPAWNABLE;
      stateFlags[s] = flags;
      const light = typeof st.light === 'function' ? st.light(view) : st.light ?? 0;
      stateLight[s] = light;
      stateOpacity[s] = st.opacity ?? (opaqueCube ? 15 : 0);
      if (occludes && render.kind !== 'none') {
        stateFaceMask[s] = render.kind === 'cube' ? 63 : fullFaceMask(getCollisionShape(s).length ? getCollisionShape(s) : EMPTY_SHAPE);
      }
      if (st.dynamicShape) stateFaceMask[s] = 0;
      const w = typeof st.wave === 'function' ? st.wave(view) : st.wave ?? 0;
      stateWave[s] = w;
    }
  }
}

export function isFrozen(): boolean {
  return frozen;
}

// Convenience flag tests ------------------------------------------------------------------------
export const isAir = (s: number): boolean => (stateFlags[s]! & F.AIR) !== 0;
export const isOpaqueCube = (s: number): boolean => (stateFlags[s]! & F.OPAQUE_CUBE) !== 0;
export const isReplaceable = (s: number): boolean => (stateFlags[s]! & F.REPLACEABLE) !== 0;
export const hasWater = (s: number): boolean => (stateFlags[s]! & F.WATER) !== 0;
export const hasLava = (s: number): boolean => (stateFlags[s]! & F.LAVA) !== 0;
export const isFluid = (s: number): boolean => (stateFlags[s]! & (F.WATER | F.LAVA)) !== 0;
export const isSolid = (s: number): boolean => (stateFlags[s]! & F.SOLID) !== 0;
export const isConductor = (s: number): boolean => (stateFlags[s]! & F.CONDUCTOR) !== 0;
export const hasCollision = (s: number): boolean => (stateFlags[s]! & F.NO_COLLISION) === 0;
export const isFullCollision = (s: number): boolean => (stateFlags[s]! & F.FULL_COLLISION) !== 0;
