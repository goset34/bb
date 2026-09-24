/**
 * Creative inventory: category tabs, search, scrollable item palette, hotbar row, trash slot and a
 * survival-inventory tab. Edits happen locally on the inventory menu and are synced to the
 * server with creativeSlot packets (the server trusts creative-mode edits).
 */
import { h, clear } from './dom';
import type { IconRenderer } from './icons';
import { px } from './containers';
import { renderStack } from './slotview';
import { tooltipElement } from './tooltip';
import { itemName } from './names';
import { ITEM_LIST, ItemCategory } from '../../common/item/items';
import { ItemStack } from '../../common/item/stack';
import { InventoryMenu } from '../../common/menu/menus';
import type { MenuPlayer } from '../../common/menu/menu';
import { maxStackOf } from '../../common/menu/container';
import { t } from '../../common/lang/i18n';

type Tab = ItemCategory | 'search' | 'inventory';
const TABS: Tab[] = ['building', 'colored', 'natural', 'functional', 'redstone', 'tools', 'combat', 'food', 'ingredients', 'spawn_eggs', 'search', 'inventory'];
const TAB_ICON: Record<string, string> = {
  building: 'bricks', colored: 'cyan_wool', natural: 'grass_block', functional: 'crafting_table', redstone: 'flux_dust', tools: 'diamond_pickaxe',
  combat: 'iron_sword', food: 'apple', ingredients: 'iron_ingot', spawn_eggs: 'egg', search: 'compass', inventory: 'chest', operator: 'command_block',
};
const COLS = 9, ROWS = 5;

export interface CreativeHost {
  icons: IconRenderer;
  menu: InventoryMenu;
  player: MenuPlayer;
  /** Sync a changed inventory-menu slot (-1 = drop the stack). */
  sendSlot(slot: number, stack: ItemStack): void;
  close(): void;
  keyAction(code: string): string | null;
  advancedTooltips: boolean;
}

export class CreativeScreen {
  readonly el: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private tab: Tab = 'building';
  private scroll = 0;
  private items: ItemStack[] = [];
  private search = '';
  private readonly body: HTMLDivElement;
  private carried = ItemStack.empty();
  private readonly carriedEl: HTMLDivElement;
  private tooltip: HTMLDivElement | null = null;
  private hoverSlot: number | null = null;
  private hoverPalette: ItemStack | null = null;
  private mouseX = 0;
  private mouseY = 0;
  private lastKey = '';
  private readonly searchInput: HTMLInputElement;
  private readonly scrollbar: HTMLDivElement;
  private paletteEls: HTMLDivElement[] = [];
  private slotEls = new Map<number, HTMLDivElement>();

  constructor(private readonly host: CreativeHost) {
    this.panel = h('div', { class: 'gui-panel creative', style: { width: px(195), height: px(136) } });
    const tabs = h('div', { class: 'cr-tabs' });
    for (const tb of TABS) {
      const el = h('div', { class: `cr-tab ${tb === this.tab ? 'sel' : ''}`, title: t(`itemGroup.${tb}`) }, h('img', { src: host.icons.icon(TAB_ICON[tb] ?? 'stone'), alt: '', draggable: 'false' }));
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.setTab(tb);
        for (const c of tabs.children) c.classList.remove('sel');
        el.classList.add('sel');
      });
      tabs.appendChild(el);
    }
    this.searchInput = h('input', { class: 'input cr-search', type: 'text', spellcheck: 'false', placeholder: t('itemGroup.search') }) as HTMLInputElement;
    this.searchInput.addEventListener('input', () => { this.search = this.searchInput.value.toLowerCase(); this.scroll = 0; this.refreshItems(); });
    this.searchInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.host.close();
    });
    this.body = h('div', { class: 'cr-body' });
    this.scrollbar = h('div', { class: 'cr-scroll' }, h('div', { class: 'knob' }));
    this.panel.append(h('div', { class: 'gui-label cr-title' }), this.searchInput, this.body, this.scrollbar);
    this.panel.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rows = Math.ceil(this.items.length / COLS);
      this.scroll = Math.max(0, Math.min(Math.max(0, rows - ROWS), this.scroll + Math.sign(e.deltaY)));
      this.lastKey = '';
    }, { passive: false });
    this.carriedEl = h('div', { class: 'gui-carried' });
    this.el = h('div', { class: 'screen gui-screen' }, h('div', { class: 'cr-wrap' }, tabs, this.panel), this.carriedEl);
    this.el.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.position();
    });
    this.el.addEventListener('mousedown', (e) => {
      if (e.target !== this.el && !(e.target as HTMLElement).classList.contains('cr-wrap')) return;
      if (!this.carried.isEmpty()) {
        const out = e.button === 2 ? this.carried.split(1) : this.carried;
        if (e.button !== 2) this.carried = ItemStack.empty();
        host.sendSlot(-1, out);
        this.lastKey = '';
      }
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.setTab('building');
  }

  destroy(): void {
    this.tooltip?.remove();
    // Carried creative items vanish when the screen closes (reference behaviour)
    this.el.remove();
  }

  private setTab(tb: Tab): void {
    this.tab = tb;
    this.scroll = 0;
    this.searchInput.style.display = tb === 'search' ? '' : 'none';
    (this.panel.querySelector('.cr-title') as HTMLElement).textContent = t(`itemGroup.${tb}`);
    this.panel.classList.toggle('inv', tb === 'inventory');
    if (tb === 'search') setTimeout(() => this.searchInput.focus(), 0);
    this.refreshItems();
    this.build();
  }

  private refreshItems(): void {
    if (this.tab === 'inventory') { this.items = []; return; }
    const list = ITEM_LIST.filter((d) => {
      if (d.category === 'operator') return false;
      if (this.tab === 'search') {
        if (!this.search) return true;
        return itemName(d.id).toLowerCase().includes(this.search) || d.id.includes(this.search.replace(/ /g, '_'));
      }
      return d.category === this.tab;
    });
    this.items = list.map((d) => new ItemStack(d.id, 1));
    this.lastKey = '';
  }

  /** Build slot elements for the current tab. */
  private build(): void {
    clear(this.body);
    this.paletteEls = [];
    this.slotEls.clear();
    if (this.tab === 'inventory') {
      // Armor (5-8), main (9-35), hotbar (36-44), off hand (45)
      const place = (idx: number, x: number, y: number) => {
        const el = h('div', { class: 'gui-slot', style: { left: px(x - 1), top: px(y - 1) } });
        el.addEventListener('mousedown', (e) => this.clickSlot(e, idx));
        el.addEventListener('mouseenter', () => { this.hoverSlot = idx; this.hoverPalette = null; this.showTooltip(); });
        el.addEventListener('mouseleave', () => { this.hoverSlot = null; this.showTooltip(); });
        this.slotEls.set(idx, el);
        this.body.appendChild(el);
      };
      for (let i = 0; i < 4; i++) place(5 + i, 54 + (i % 2) * 54, 6 + Math.floor(i / 2) * 27);
      place(45, 35, 20);
      for (let i = 0; i < 27; i++) place(9 + i, 9 + (i % 9) * 18, 54 + Math.floor(i / 9) * 18);
      for (let i = 0; i < 9; i++) place(36 + i, 9 + i * 18, 112);
      const trash = h('div', { class: 'gui-slot trash', style: { left: px(172), top: px(111) }, title: t('inventory.binSlot') });
      trash.addEventListener('mousedown', (e) => this.clickTrash(e));
      this.body.appendChild(trash);
    } else {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const el = h('div', { class: 'gui-slot', style: { left: px(8 + c * 18), top: px(17 + r * 18) } });
          el.addEventListener('mousedown', (e) => this.clickPalette(e, i));
          el.addEventListener('mouseenter', () => { this.hoverPalette = this.items[this.scroll * COLS + i] ?? null; this.hoverSlot = null; this.showTooltip(); });
          el.addEventListener('mouseleave', () => { this.hoverPalette = null; this.showTooltip(); });
          this.paletteEls.push(el);
          this.body.appendChild(el);
        }
      }
      for (let i = 0; i < 9; i++) {
        const idx = 36 + i;
        const el = h('div', { class: 'gui-slot', style: { left: px(8 + i * 18), top: px(111) } });
        el.addEventListener('mousedown', (e) => this.clickSlot(e, idx));
        el.addEventListener('mouseenter', () => { this.hoverSlot = idx; this.hoverPalette = null; this.showTooltip(); });
        el.addEventListener('mouseleave', () => { this.hoverSlot = null; this.showTooltip(); });
        this.slotEls.set(idx, el);
        this.body.appendChild(el);
      }
      const trash = h('div', { class: 'gui-slot trash', style: { left: px(172), top: px(111) }, title: t('inventory.binSlot') });
      trash.addEventListener('mousedown', (e) => this.clickTrash(e));
      this.body.appendChild(trash);
    }
    this.lastKey = '';
  }

  render(): void {
    const m = this.host.menu;
    const key = `${this.tab}|${this.scroll}|${this.items.length}|${this.host.player.inventory.revision}|${this.carried.id}:${this.carried.count}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.paletteEls.forEach((el, i) => renderStack(el, this.items[this.scroll * COLS + i] ?? ItemStack.empty(), this.host.icons));
    for (const [idx, el] of this.slotEls) renderStack(el, m.slots[idx]!.stack, this.host.icons);
    renderStack(this.carriedEl, this.carried, this.host.icons);
    const rows = Math.ceil(this.items.length / COLS);
    const knob = this.scrollbar.firstChild as HTMLElement;
    this.scrollbar.style.display = this.tab === 'inventory' ? 'none' : '';
    knob.style.top = `${rows > ROWS ? (this.scroll / (rows - ROWS)) * 80 : 0}%`;
    this.showTooltip();
  }

  private position(): void {
    const r = this.el.getBoundingClientRect();
    this.carriedEl.style.left = `${this.mouseX - r.left}px`;
    this.carriedEl.style.top = `${this.mouseY - r.top}px`;
    if (this.tooltip) {
      this.tooltip.style.left = `${this.mouseX - r.left + 14}px`;
      this.tooltip.style.top = `${this.mouseY - r.top - 18}px`;
    }
  }

  private showTooltip(): void {
    this.tooltip?.remove();
    this.tooltip = null;
    if (!this.carried.isEmpty()) return;
    const s = this.hoverPalette ?? (this.hoverSlot !== null ? this.host.menu.slots[this.hoverSlot]!.stack : null);
    if (!s || s.isEmpty()) return;
    this.tooltip = tooltipElement(s, this.host.advancedTooltips);
    this.el.appendChild(this.tooltip);
    this.position();
  }

  private clickPalette(e: MouseEvent, i: number): void {
    e.preventDefault();
    e.stopPropagation();
    const item = this.items[this.scroll * COLS + i];
    if (!this.carried.isEmpty()) {
      if (item && this.carried.sameItemSameData(item) && e.button === 0 && this.carried.count < maxStackOf(item)) this.carried.grow(1);
      else if (e.button === 0) this.carried = ItemStack.empty();
      else this.carried.shrink(1);
      if (this.carried.isEmpty()) this.carried = ItemStack.empty();
      this.lastKey = '';
      return;
    }
    if (!item) return;
    if (e.shiftKey) {
      // Put a full stack into the hotbar
      const full = item.copyWithCount(maxStackOf(item));
      for (let s = 36; s < 45; s++) {
        if (this.host.menu.slots[s]!.stack.isEmpty()) {
          this.setSlot(s, full);
          break;
        }
      }
      return;
    }
    this.carried = item.copyWithCount(e.button === 0 ? maxStackOf(item) : e.button === 1 ? maxStackOf(item) : 1);
    this.lastKey = '';
  }

  private setSlot(idx: number, s: ItemStack): void {
    this.host.menu.slots[idx]!.set(s);
    this.host.sendSlot(idx, s);
    this.lastKey = '';
  }

  private clickSlot(e: MouseEvent, idx: number): void {
    e.preventDefault();
    e.stopPropagation();
    const slot = this.host.menu.slots[idx]!;
    const cur = slot.stack;
    if (e.button === 1) {
      if (this.carried.isEmpty() && !cur.isEmpty()) this.carried = cur.copyWithCount(maxStackOf(cur));
      this.lastKey = '';
      return;
    }
    if (e.shiftKey && this.carried.isEmpty()) {
      this.setSlot(idx, ItemStack.empty());
      return;
    }
    if (this.carried.isEmpty()) {
      if (cur.isEmpty()) return;
      const n = e.button === 0 ? cur.count : Math.ceil(cur.count / 2);
      this.carried = cur.copyWithCount(n);
      this.setSlot(idx, cur.count - n > 0 ? cur.copyWithCount(cur.count - n) : ItemStack.empty());
      return;
    }
    if (!slot.mayPlace(this.carried)) return;
    if (cur.isEmpty() || cur.sameItemSameData(this.carried)) {
      const have = cur.isEmpty() ? 0 : cur.count;
      const room = slot.maxStack(this.carried) - have;
      const n = Math.min(room, e.button === 0 ? this.carried.count : 1);
      if (n <= 0) return;
      this.setSlot(idx, this.carried.copyWithCount(have + n));
      this.carried.shrink(n);
      if (this.carried.isEmpty()) this.carried = ItemStack.empty();
    } else {
      const prev = cur.copy();
      this.setSlot(idx, this.carried);
      this.carried = prev;
    }
    this.lastKey = '';
  }

  private clickTrash(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) {
      for (let i = 5; i < 46; i++) if (!this.host.menu.slots[i]!.stack.isEmpty()) this.setSlot(i, ItemStack.empty());
      return;
    }
    this.carried = ItemStack.empty();
    this.lastKey = '';
  }

  key(code: string): boolean {
    if (document.activeElement === this.searchInput) return false;
    const action = this.host.keyAction(code);
    if (code === 'Escape' || action === 'inventory') {
      this.host.close();
      return true;
    }
    if (action && action.startsWith('hotbar')) {
      const n = parseInt(action.slice(6), 10) - 1;
      const src = this.hoverPalette ? this.hoverPalette.copyWithCount(maxStackOf(this.hoverPalette)) : this.hoverSlot !== null ? this.host.menu.slots[this.hoverSlot]!.stack.copy() : null;
      if (src && !src.isEmpty()) {
        if (this.hoverSlot !== null && this.hoverSlot !== 36 + n) {
          const other = this.host.menu.slots[36 + n]!.stack.copy();
          this.setSlot(this.hoverSlot, other);
        }
        this.setSlot(36 + n, src);
      }
      return true;
    }
    return false;
  }
}
