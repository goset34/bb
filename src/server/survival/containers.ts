/**
 * Container block entities: chests (single and double), barrels, void chests (per player), shell
 * boxes (keep their contents when broken) and the furnace family (ticking smelting with stored
 * experience). Registers the server menu factories and the block-entity tick system.
 */
import type { BlockEntityData } from '../../common/world/chunk';
import { ItemStack, SerializedStack } from '../../common/item/stack';
import { SimpleContainer, Container } from '../../common/menu/container';
import { GenericMenu, ShellBoxSlot } from '../../common/menu/menus';
import type { MenuPlayer } from '../../common/menu/menu';
import { FurnaceMenu, FURNACE_KINDS, FurnaceState, newFurnaceState, tickFurnace, furnaceXp, FD } from '../../common/menu/furnace';
import { blockOf, getValue, setValue, tryGetValue, stateFlags, F } from '../../common/block/registry';
import { P } from '../../common/block/properties';
import { DX, DZ, Direction, rotateCW, rotateCCW } from '../../common/world/direction';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';
import { SERVER_MENUS, blockMenuValid } from '../menus';
import { spawnExperience, createItemEntity } from './items';
import type { Inventory } from '../../common/entity/player';

// ---------------------------------------------------------------------------------------------
// Block entity containers
// ---------------------------------------------------------------------------------------------

const live = new WeakMap<BlockEntityData, SimpleContainer>();

/** Container view over a block entity's `items` (changes are written back and synced). */
export function beContainer(level: ServerLevel, be: BlockEntityData, size: number): SimpleContainer {
  let c = live.get(be);
  if (c) return c;
  c = new SimpleContainer(size);
  c.load(be.data['items'] as Array<SerializedStack | null> | undefined);
  c.onChange((cc) => {
    be.data['items'] = cc.toJSON();
    level.blockEntityChanged(be.x, be.y, be.z);
  });
  live.set(be, c);
  return c;
}

/** Get or create the block entity of a container block. */
export function ensureBE(level: ServerLevel, x: number, y: number, z: number, type: string): BlockEntityData {
  let be = level.getBlockEntity(x, y, z);
  if (!be || be.type !== type) {
    be = { type, x, y, z, data: {} };
    level.setBlockEntity(be);
  }
  return be;
}

export const CONTAINER_SIZES: Record<string, number> = { chest: 27, barrel: 27, shell_box: 27, furnace: 3, blast_furnace: 3, smoker: 3 };

/** Viewers per block position (barrel open state, chest events). */
const viewers = new Map<string, number>();

function setViewers(level: ServerLevel, x: number, y: number, z: number, delta: number): void {
  const k = `${level.dimId}:${x},${y},${z}`;
  const n = Math.max(0, (viewers.get(k) ?? 0) + delta);
  if (n === 0) viewers.delete(k);
  else viewers.set(k, n);
  const s = level.getBlockState(x, y, z);
  const b = blockOf(s);
  if (b.name === 'barrel' && tryGetValue(s, P.open) !== undefined && getValue(s, P.open) !== n > 0) {
    level.setBlock(x, y, z, setValue(s, P.open, n > 0), 3);
    level.playSound(x + 0.5, y + 0.5, z + 0.5, n > 0 ? 'block.barrel.open' : 'block.barrel.close');
  }
  if (b.name.endsWith('chest')) {
    level.blockEvent(x, y, z, b, 1, n);
    if (delta > 0 && n === 1) level.playSound(x + 0.5, y + 0.5, z + 0.5, b.name === 'void_chest' ? 'block.void_chest.open' : 'block.chest.open');
    if (delta < 0 && n === 0) level.playSound(x + 0.5, y + 0.5, z + 0.5, b.name === 'void_chest' ? 'block.void_chest.close' : 'block.chest.close');
  }
}

/** Menu that tracks viewer counts for the block(s) it shows. */
class BlockViewMenu extends GenericMenu {
  private closed = false;
  constructor(kind: string, windowId: number, container: Container, inv: Inventory, valid: (p: MenuPlayer) => boolean, private readonly level: ServerLevel, private readonly positions: Array<[number, number, number]>) {
    super(kind, windowId, container, inv, valid);
    for (const [x, y, z] of positions) setViewers(level, x, y, z, 1);
  }
  override removed(p: MenuPlayer): void {
    super.removed(p);
    if (this.closed) return;
    this.closed = true;
    for (const [x, y, z] of this.positions) setViewers(this.level, x, y, z, -1);
  }
}

/** Two containers presented as one (double chests). */
class CompoundContainer implements Container {
  readonly size: number;
  readonly maxStack = 64;
  constructor(private readonly a: Container, private readonly b: Container) {
    this.size = a.size + b.size;
  }
  get(i: number): ItemStack {
    return i < this.a.size ? this.a.get(i) : this.b.get(i - this.a.size);
  }
  set(i: number, s: ItemStack): void {
    if (i < this.a.size) this.a.set(i, s);
    else this.b.set(i - this.a.size, s);
  }
  changed(): void {
    this.a.changed();
    this.b.changed();
  }
}

class ShellBoxMenu extends BlockViewMenu {
  constructor(windowId: number, container: Container, inv: Inventory, valid: (p: MenuPlayer) => boolean, level: ServerLevel, pos: [number, number, number]) {
    super('shell_box', windowId, container, inv, valid, level, [pos]);
    for (let i = 0; i < container.size; i++) {
      const s = this.slots[i]!;
      const r = new ShellBoxSlot(s.container, s.slot, s.x, s.y);
      r.index = i;
      this.slots[i] = r;
    }
  }
}

function customTitle(be: BlockEntityData | undefined, key: string): { text?: string; key?: string } {
  const name = be?.data['name'] as string | undefined;
  return name ? { text: name } : { key };
}

SERVER_MENUS.set('chest', (p, id, o) => {
  const level = p.level;
  const state = level.getBlockState(o.x, o.y, o.z);
  const b = blockOf(state);
  // A full solid block above the chest prevents opening (reference)
  if (isSolidTop(level.getBlockState(o.x, o.y + 1, o.z))) return null;
  const type = tryGetValue(state, P.chestType) ?? 'single';
  const be = ensureBE(level, o.x, o.y, o.z, 'chest');
  const self = beContainer(level, be, 27);
  const valid = (pp: ServerPlayer) => (x: number, y: number, z: number) => blockMenuValid(pp, x, y, z, (n) => n === b.name);
  if (type !== 'single') {
    const f = getValue(state, P.facing) as Direction;
    const d = type === 'left' ? rotateCW(f) : rotateCCW(f);
    const ox = o.x + DX[d]!, oz = o.z + DZ[d]!;
    const other = level.getBlockState(ox, o.y, oz);
    if (blockOf(other) === b && tryGetValue(other, P.chestType) !== 'single') {
      if (isSolidTop(level.getBlockState(ox, o.y + 1, oz))) return null;
      const obe = ensureBE(level, ox, o.y, oz, 'chest');
      const oc = beContainer(level, obe, 27);
      const [first, second] = type === 'left' ? [self, oc] : [oc, self];
      const menu = new BlockViewMenu('chest', id, new CompoundContainer(first, second), p.inventory, () => valid(p)(o.x, o.y, o.z) && valid(p)(ox, o.y, oz), level, [[o.x, o.y, o.z], [ox, o.y, oz]]);
      return { menu, title: customTitle(be, 'container.chestDouble'), size: 54 };
    }
  }
  const menu = new BlockViewMenu('chest', id, self, p.inventory, () => valid(p)(o.x, o.y, o.z), level, [[o.x, o.y, o.z]]);
  return { menu, title: customTitle(be, b.name === 'trapped_chest' ? 'container.trappedChest' : 'container.chest'), size: 27 };
});

function isSolidTop(state: number): boolean {
  return (stateFlags[state]! & F.OPAQUE_CUBE) !== 0;
}

SERVER_MENUS.set('barrel', (p, id, o) => {
  const be = ensureBE(p.level, o.x, o.y, o.z, 'barrel');
  const menu = new BlockViewMenu('barrel', id, beContainer(p.level, be, 27), p.inventory, () => blockMenuValid(p, o.x, o.y, o.z, (n) => n === 'barrel'), p.level, [[o.x, o.y, o.z]]);
  return { menu, title: customTitle(be, 'container.barrel'), size: 27 };
});

SERVER_MENUS.set('shell_box', (p, id, o) => {
  const name = blockOf(p.level.getBlockState(o.x, o.y, o.z)).name;
  const be = ensureBE(p.level, o.x, o.y, o.z, 'shell_box');
  const menu = new ShellBoxMenu(id, beContainer(p.level, be, 27), p.inventory, () => blockMenuValid(p, o.x, o.y, o.z, (n) => n === name), p.level, [o.x, o.y, o.z]);
  return { menu, title: customTitle(be, 'container.shellBox'), size: 27 };
});

/** Per-player void chest inventory. */
export function voidChestOf(p: ServerPlayer): SimpleContainer {
  let c = p.ext['voidChest'] as SimpleContainer | undefined;
  if (!c) {
    c = new SimpleContainer(27);
    p.ext['voidChest'] = c;
  }
  return c;
}

SERVER_MENUS.set('void_chest', (p, id, o) => {
  const menu = new BlockViewMenu('void_chest', id, voidChestOf(p), p.inventory, () => blockMenuValid(p, o.x, o.y, o.z, (n) => n === 'void_chest'), p.level, [[o.x, o.y, o.z]]);
  return { menu, title: { key: 'container.voidChest' }, size: 27 };
});

// ---------------------------------------------------------------------------------------------
// Furnaces
// ---------------------------------------------------------------------------------------------

function furnaceState(be: BlockEntityData): FurnaceState {
  let s = be.data['furnace'] as FurnaceState | undefined;
  if (!s) {
    s = newFurnaceState();
    be.data['furnace'] = s;
  }
  return s;
}

/** Open furnace menus by block entity (their data slots follow the furnace state). */
const furnaceMenus = new Map<BlockEntityData, Set<FurnaceMenu>>();

for (const kind of Object.keys(FURNACE_KINDS)) {
  SERVER_MENUS.set(kind, (p, id, o) => {
    const level = p.level;
    const be = ensureBE(level, o.x, o.y, o.z, kind);
    const c = beContainer(level, be, 3);
    const menu = new FurnaceMenu(kind, id, c, p.inventory, () => blockMenuValid(p, o.x, o.y, o.z, (n) => n === kind), (_mp, stack) => {
      const xp = furnaceXp(furnaceState(be), () => level.random.nextFloat());
      const t = p.entity.transform;
      if (xp > 0) spawnExperience(level, t.x, t.y + 0.5, t.z, xp);
      level.server.hooks.itemCrafted(p, stack, stack.count);
    });
    let set = furnaceMenus.get(be);
    if (!set) furnaceMenus.set(be, (set = new Set()));
    set.add(menu);
    const origRemoved = menu.removed.bind(menu);
    menu.removed = (mp) => {
      origRemoved(mp);
      set!.delete(menu);
      if (set!.size === 0) furnaceMenus.delete(be);
    };
    syncFurnaceMenu(menu, furnaceState(be));
    return { menu, title: customTitle(be, `container.${kind}`), size: 3 };
  });
}

function syncFurnaceMenu(m: FurnaceMenu, s: FurnaceState): void {
  m.setData(FD.BURN, s.burn);
  m.setData(FD.BURN_TOTAL, s.burnTotal);
  m.setData(FD.COOK, s.cook);
  m.setData(FD.COOK_TOTAL, s.cookTotal);
}

/** Level system ticking furnace block entities in loaded chunks. */
export function furnaceSystem(level: ServerLevel): { name: string; tick(level: ServerLevel): void } {
  return {
    name: 'furnaces',
    tick() {
      for (const h of level.chunks.holders.values()) {
        const c = h.chunk;
        if (!c || !h.chunk?.blockEntities.size) continue;
        for (const be of c.blockEntities.values()) {
          const kind = FURNACE_KINDS[be.type];
          if (!kind) continue;
          const s = furnaceState(be);
          const cont = beContainer(level, be, 3);
          const idle = s.burn <= 0 && s.cook <= 0 && (cont.get(0).isEmpty() || cont.get(1).isEmpty());
          if (idle && !furnaceMenus.has(be)) continue;
          const r = tickFurnace(kind, s, cont);
          if (r.changed) {
            be.data['items'] = cont.toJSON();
            level.blockEntityChanged(be.x, be.y, be.z);
          }
          if (r.litChanged) {
            const st = level.getBlockState(be.x, be.y, be.z);
            if (blockOf(st).name === be.type) level.setBlock(be.x, be.y, be.z, setValue(st, P.lit, s.burn > 0), 3);
          }
          const ms = furnaceMenus.get(be);
          if (ms) for (const m of ms) syncFurnaceMenu(m, s);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Removal and placement
// ---------------------------------------------------------------------------------------------

/** Drop the contents of a removed container block (shell boxes keep theirs in the item). */
export function dropContainerContents(level: ServerLevel, be: BlockEntityData): void {
  if (be.type === 'shell_box') return;
  const size = CONTAINER_SIZES[be.type];
  if (!size) return;
  const c = beContainer(level, be, size);
  const r = level.random;
  for (let i = 0; i < c.size; i++) {
    const s = c.get(i);
    if (s.isEmpty()) continue;
    // Split into random-sized chunks like the reference
    while (!s.isEmpty()) {
      const n = Math.min(s.count, 10 + r.nextInt(21));
      const part = s.split(n);
      createItemEntity(level, be.x + 0.5 + (r.nextDouble() - 0.5) * 0.7, be.y + 0.5 + (r.nextDouble() - 0.5) * 0.7, be.z + 0.5 + (r.nextDouble() - 0.5) * 0.7, part, r.nextGaussian() * 0.05, r.nextGaussian() * 0.05 + 0.2, r.nextGaussian() * 0.05);
    }
    c.set(i, ItemStack.empty());
  }
  if (FURNACE_KINDS[be.type]) {
    const xp = furnaceXp(furnaceState(be), () => r.nextFloat());
    if (xp > 0) spawnExperience(level, be.x + 0.5, be.y + 0.5, be.z + 0.5, xp);
  }
}

/** Shell box item for a broken shell box block (contents and name travel with it). */
export function shellBoxDrop(level: ServerLevel, be: BlockEntityData | undefined, blockName: string): ItemStack {
  const stack = new ItemStack(blockName, 1);
  if (be) {
    const c = beContainer(level, be, 27);
    if (!c.isEmpty()) stack.data.container = c.toJSON();
    const name = be.data['name'] as string | undefined;
    if (name) stack.data.name = name;
  }
  return stack;
}

/** Create the block entity of a freshly placed container and restore contents / name from the item. */
export function restoreContainer(level: ServerLevel, x: number, y: number, z: number, stack: ItemStack): void {
  const b = blockOf(level.getBlockState(x, y, z));
  const type = b.name.endsWith('shell_box') ? 'shell_box' : b.settings.blockEntity;
  if (!type || !(type in CONTAINER_SIZES)) return;
  const be = ensureBE(level, x, y, z, type);
  if (!stack.data.container && !stack.data.name) return;
  if (stack.data.container) {
    const c = beContainer(level, be, CONTAINER_SIZES[type]!);
    c.load(stack.data.container);
    c.changed();
  }
  if (stack.data.name) {
    be.data['name'] = stack.data.name;
    level.blockEntityChanged(x, y, z);
  }
}

export function isContainerBE(type: string): boolean {
  return type in CONTAINER_SIZES || type === 'void_chest';
}
