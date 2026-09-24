/**
 * Server side of menus: the always-open player inventory (window 0), opening/closing container
 * menus, click handling, recipe-book placement, creative slot edits and change broadcasting.
 */
import { ItemStack } from '../common/item/stack';
import type { Packet } from '../common/net/protocol';
import { Menu, MenuPlayer, ClickMode, SLOT_OUTSIDE } from '../common/menu/menu';
import { InventoryMenu, CraftingMenu, CraftingMenuBase, placeRecipe } from '../common/menu/menus';
import { maxStackOf } from '../common/menu/container';
import { blockOf } from '../common/block/registry';
import type { TextComponent } from '../common/lang/i18n';
import type { ServerPlayer } from './player';

export interface MenuOpenOptions {
  x: number;
  y: number;
  z: number;
  title?: TextComponent;
  extra?: Record<string, unknown>;
}

export interface MenuFactoryResult {
  menu: Menu;
  title: TextComponent;
  size: number;
  extra?: Record<string, unknown>;
}

/** Server menu factories by kind (block containers register theirs in later milestones). */
export const SERVER_MENUS = new Map<string, (p: ServerPlayer, windowId: number, o: MenuOpenOptions) => MenuFactoryResult | null>();

/** Within 8 blocks of the block and the block is still `name`. */
export function blockMenuValid(p: ServerPlayer, x: number, y: number, z: number, test: (name: string) => boolean): boolean {
  const t = p.entity.transform;
  if ((t.x - x - 0.5) ** 2 + (t.y - y - 0.5) ** 2 + (t.z - z - 0.5) ** 2 > 64) return false;
  return test(blockOf(p.level.getBlockState(x, y, z)).name);
}

SERVER_MENUS.set('crafting', (p, id, o) => ({
  menu: new CraftingMenu(id, p.inventory, () => blockMenuValid(p, o.x, o.y, o.z, (n) => n === 'crafting_table')),
  title: o.title ?? { key: 'container.crafting' },
  size: 9,
}));

interface SyncState {
  slots: ItemStack[];
  carried: ItemStack;
  data: number[];
}

export class PlayerMenus {
  readonly inventory: InventoryMenu;
  open: Menu | null = null;
  private nextId = 1;
  private readonly synced = new Map<Menu, SyncState>();
  readonly menuPlayer: MenuPlayer;

  constructor(private readonly p: ServerPlayer) {
    this.inventory = new InventoryMenu(p.inventory);
    this.menuPlayer = {
      inventory: p.inventory,
      get creative() { return p.data.gameMode === 'creative'; },
      drop: (s) => p.server.hooks.playerDrop(p, s, false),
      onCrafted: (s, n) => p.server.hooks.itemCrafted(p, s, n),
    };
  }

  /** The menu receiving clicks for a window id. */
  menuFor(windowId: number): Menu | null {
    if (windowId === 0) return this.inventory;
    return this.open && this.open.windowId === windowId ? this.open : null;
  }

  openMenu(kind: string, o: MenuOpenOptions): Menu | null {
    const f = SERVER_MENUS.get(kind);
    if (!f) return null;
    this.close(false);
    const id = this.nextId;
    this.nextId = this.nextId >= 100 ? 1 : this.nextId + 1;
    const r = f(this.p, id, o);
    if (!r) return null;
    this.open = r.menu;
    this.p.send({ type: 'containerOpen', windowId: id, kind: r.menu.kind, title: r.title, size: r.size, extra: r.extra ?? {} });
    this.fullSync(r.menu);
    return r.menu;
  }

  /** Close the open menu (returning carried/grid items). */
  close(notify: boolean): void {
    const m = this.open;
    if (!m) {
      // Inventory "close": return the 2×2 grid and carried item
      this.inventory.removed(this.menuPlayer);
      return;
    }
    m.removed(this.menuPlayer);
    this.synced.delete(m);
    this.open = null;
    if (notify) this.p.send({ type: 'containerClose', windowId: m.windowId });
  }

  fullSync(m: Menu): void {
    m.stateId++;
    this.p.send({ type: 'containerContent', windowId: m.windowId, stateId: m.stateId, slots: m.slots.map((s) => s.stack), carried: m.carried });
    m.data.forEach((v, i) => this.p.send({ type: 'containerData', windowId: m.windowId, prop: i, value: v }));
    this.synced.set(m, { slots: m.snapshot(), carried: m.carried.copy(), data: [...m.data] });
  }

  /** Send changed slots / carried / data of window 0 and the open menu. */
  broadcastChanges(): void {
    if (this.open && !this.open.stillValid(this.menuPlayer)) this.close(true);
    for (const m of [this.inventory, this.open]) {
      if (!m) continue;
      const st = this.synced.get(m);
      if (!st) { this.fullSync(m); continue; }
      let changed = false;
      for (let i = 0; i < m.slots.length; i++) {
        const cur = m.slots[i]!.stack;
        const prev = st.slots[i]!;
        if (cur.count === prev.count && cur.id === prev.id && cur.sameItemSameData(prev)) continue;
        if (!changed) { m.stateId++; changed = true; }
        st.slots[i] = cur.copy();
        this.p.send({ type: 'containerSlot', windowId: m.windowId, stateId: m.stateId, slot: i, stack: cur });
      }
      if (!(m.carried.count === st.carried.count && m.carried.sameItemSameData(st.carried))) {
        st.carried = m.carried.copy();
        this.p.send({ type: 'containerSlot', windowId: m.windowId, stateId: m.stateId, slot: -1, stack: m.carried });
      }
      for (let i = 0; i < m.data.length; i++) {
        if (m.data[i] === st.data[i]) continue;
        st.data[i] = m.data[i]!;
        this.p.send({ type: 'containerData', windowId: m.windowId, prop: i, value: m.data[i]! });
      }
    }
  }

  /** Handle menu packets; returns true when consumed. */
  handle(pk: Packet): boolean {
    switch (pk.type) {
      case 'containerClick': {
        const m = this.menuFor(pk['windowId'] as number);
        if (!m) return true;
        if (this.p.data.gameMode === 'spectator' || this.p.entity.living?.dead) { this.fullSync(m); return true; }
        const stale = (pk['stateId'] as number) !== m.stateId;
        const slot = pk['slot'] as number;
        if (slot !== SLOT_OUTSIDE && (slot < -1 || slot >= m.slots.length)) return true;
        m.clicked(slot, pk['button'] as number, pk['mode'] as ClickMode, this.menuPlayer);
        if (stale) this.fullSync(m);
        else this.broadcastChanges();
        return true;
      }
      case 'containerClose': {
        const id = pk['windowId'] as number;
        if (id === 0 || (this.open && this.open.windowId === id)) this.close(false);
        return true;
      }
      case 'containerButton': {
        const m = this.menuFor(pk['windowId'] as number);
        if (m && m.clickButton(this.menuPlayer, pk['button'] as number)) this.broadcastChanges();
        return true;
      }
      case 'placeRecipe': {
        const m = this.menuFor(pk['windowId'] as number);
        if (m instanceof CraftingMenuBase) {
          placeRecipe(m, pk['recipe'] as string, pk['all'] as boolean, this.menuPlayer);
          this.broadcastChanges();
        }
        return true;
      }
      case 'creativeSlot': {
        if (this.p.data.gameMode !== 'creative') return true;
        const slot = pk['slot'] as number;
        const stack = pk['stack'] as ItemStack;
        if (slot === -1) {
          if (!stack.isEmpty()) this.p.server.hooks.playerDrop(this.p, stack.copyWithCount(Math.min(stack.count, maxStackOf(stack))), false);
          return true;
        }
        const menuSlot = this.inventory.slots[slot];
        if (!menuSlot) return true;
        menuSlot.set(stack.isEmpty() ? ItemStack.empty() : stack.copyWithCount(Math.min(stack.count, maxStackOf(stack))));
        this.broadcastChanges();
        return true;
      }
    }
    return false;
  }
}
