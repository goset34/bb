/**
 * Container screens (DOM): draws a menu's slots on a bevelled panel and implements the full
 * mouse/keyboard vocabulary (click, right click, shift-click, double click, drag distribution,
 * number-key swaps, off-hand swap, Q throw, middle-click clone). Clicks are predicted locally on
 * the client copy of the menu and sent to the server, which answers with authoritative slots.
 */
import { h } from './dom';
import type { IconRenderer } from './icons';
import { renderStack } from './slotview';
import { tooltipElement } from './tooltip';
import { Menu, MenuPlayer, ClickMode, SLOT_OUTSIDE, Slot } from '../../common/menu/menu';
import { CraftingMenuBase } from '../../common/menu/menus';
import type { FurnaceMenu } from '../../common/menu/furnace';
import { resolveText, t, TextComponent } from '../../common/lang/i18n';
import { ItemStack } from '../../common/item/stack';
import { RecipeBook } from './recipebook';

/** GUI pixel → em (1 GUI px = 0.125em). */
export const px = (v: number): string => `${v * 0.125}em`;

export interface ScreenHost {
  icons: IconRenderer;
  /** Send a click to the server (after local prediction). */
  sendClick(menu: Menu, slot: number, button: number, mode: ClickMode): void;
  close(): void;
  menuPlayer: MenuPlayer;
  /** Is a key bound to an action (inventory / drop / swap / hotbar n). */
  keyAction(code: string): string | null;
  isCtrl(): boolean;
  recipeBook: RecipeBook | null;
  /** Show advanced tooltips (F3+H). */
  advancedTooltips: boolean;
  /** Flat front view of the local player (inventory portrait). */
  portrait?(): HTMLCanvasElement | null;
}

/** Background decoration per menu kind (labels, arrows, panels). */
export interface ScreenLayout {
  width: number;
  height: number;
  decorate(panel: HTMLElement, menu: Menu, title: string): void;
  /** Per-frame update of dynamic parts (progress bars). */
  update?(panel: HTMLElement, menu: Menu): void;
  /** Shows the recipe book button. */
  recipeBook?: boolean;
}

export const SCREEN_LAYOUTS = new Map<string, (menu: Menu) => ScreenLayout>();

function label(text: string, x: number, y: number): HTMLDivElement {
  return h('div', { class: 'gui-label', style: { left: px(x), top: px(y) } }, text);
}

export function arrow(x: number, y: number): HTMLDivElement {
  return h('div', { class: 'gui-arrow', style: { left: px(x), top: px(y) } });
}

SCREEN_LAYOUTS.set('inventory', () => ({
  width: 176, height: 166, recipeBook: true,
  decorate(panel) {
    panel.appendChild(h('div', { class: 'gui-portrait', style: { left: px(26), top: px(8), width: px(49), height: px(70) } }));
    // (the portrait image is inserted by the screen when the host provides one)
    panel.appendChild(label(t('container.crafting'), 97, 6));
    panel.appendChild(arrow(135, 29));
  },
}));

SCREEN_LAYOUTS.set('crafting', () => ({
  width: 176, height: 166, recipeBook: true,
  decorate(panel, _m, title) {
    panel.appendChild(label(title, 28, 6));
    panel.appendChild(label(t('container.inventory'), 8, 72));
    panel.appendChild(arrow(90, 35));
  },
}));

SCREEN_LAYOUTS.set('generic', (m) => {
  const rows = Math.ceil((m.slots.length - 36) / 9);
  return {
    width: 176, height: 114 + rows * 18,
    decorate(panel, _m, title) {
      panel.appendChild(label(title, 8, 6));
      panel.appendChild(label(t('container.inventory'), 8, 20 + rows * 18));
    },
  };
});

SCREEN_LAYOUTS.set('mount', (m) => {
  const cols = Math.max(0, (m.slots.length - 36 - 2) / 3);
  return {
    width: 176, height: 166,
    decorate(panel, _m, title) {
      panel.appendChild(label(title, 8, 6));
      panel.appendChild(label(t('container.inventory'), 8, 72));
      // Frame behind the mount (the chest grid is drawn by its slots)
      panel.appendChild(h('div', { class: 'gui-portrait', style: { left: px(26), top: px(18), width: px(52), height: px(52) } }));
      if (cols === 0) panel.appendChild(h('div', { class: 'gui-portrait', style: { left: px(79), top: px(17), width: px(90), height: px(54), opacity: '0.35' } }));
    },
  };
});

for (const kind of ['furnace', 'blast_furnace', 'smoker']) {
  SCREEN_LAYOUTS.set(kind, () => ({
    width: 176, height: 166,
    decorate(panel, _m, title) {
      panel.appendChild(h('div', { class: 'gui-label center', style: { left: 0, right: 0, top: px(6) } }, title));
      panel.appendChild(label(t('container.inventory'), 8, 72));
      panel.appendChild(h('div', { class: 'gui-flame', style: { left: px(56), top: px(36) } }, h('div', { class: 'fill' })));
      panel.appendChild(h('div', { class: 'gui-progress-arrow', style: { left: px(79), top: px(34) } }, h('div', { class: 'fill' })));
    },
    update(panel, m) {
      const fm = m as FurnaceMenu;
      const flame = panel.querySelector('.gui-flame .fill') as HTMLElement | null;
      const arrowEl = panel.querySelector('.gui-progress-arrow .fill') as HTMLElement | null;
      if (flame) flame.style.height = `${Math.ceil(fm.burnProgress * 13) / 13 * 100}%`;
      if (arrowEl) arrowEl.style.width = `${Math.floor(fm.cookProgress * 24) / 24 * 100}%`;
    },
  }));
}

export class ContainerScreen {
  readonly el: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly slotEls: HTMLDivElement[] = [];
  private readonly carriedEl: HTMLDivElement;
  private tooltipEl: HTMLDivElement | null = null;
  private hovered: Slot | null = null;
  private mouseX = 0;
  private mouseY = 0;
  private lastRender = '';
  // Drag state
  private dragButton = -1;
  private dragStartSlot: Slot | null = null;
  private dragging = false;
  private readonly dragSlots = new Set<Slot>();
  // Double click
  private lastClickTime = 0;
  private lastClickSlot: Slot | null = null;
  private lastClickButton = -1;

  private readonly layout: ScreenLayout;

  constructor(private readonly host: ScreenHost, readonly menu: Menu, readonly title: TextComponent | string) {
    const layoutFn = SCREEN_LAYOUTS.get(menu.kind) ?? SCREEN_LAYOUTS.get('generic')!;
    const layout = layoutFn(menu);
    this.layout = layout;
    this.panel = h('div', { class: 'gui-panel', style: { width: px(layout.width), height: px(layout.height) } });
    layout.decorate(this.panel, menu, typeof title === 'string' ? title : resolveText(title));
    for (const s of menu.slots) {
      const el = h('div', { class: 'gui-slot', style: { left: px(s.x - 1), top: px(s.y - 1) } });
      if (menu instanceof CraftingMenuBase && s.index === 0) el.classList.add('big');
      el.addEventListener('mouseenter', () => this.onEnter(s));
      el.addEventListener('mouseleave', () => { if (this.hovered === s) this.setHovered(null); });
      el.addEventListener('mousedown', (e) => this.onDown(e, s));
      this.slotEls.push(el);
      this.panel.appendChild(el);
    }
    this.carriedEl = h('div', { class: 'gui-carried' });
    const row = h('div', { class: 'gui-row' });
    if (layout.recipeBook && menu instanceof CraftingMenuBase && host.recipeBook) {
      host.recipeBook.attach(menu, row);
      const btn = h('div', { class: 'gui-book-btn', style: { left: px(menu.kind === 'inventory' ? 104 : 5), top: px(menu.kind === 'inventory' ? 61 : 34) }, title: t('recipeBook.toggle') });
      btn.addEventListener('mousedown', (e) => { e.stopPropagation(); host.recipeBook!.toggle(); });
      this.panel.appendChild(btn);
    }
    const portrait = menu.kind === 'inventory' ? host.portrait?.() : null;
    const frame = this.panel.querySelector('.gui-portrait');
    if (portrait && frame) frame.appendChild(portrait);
    row.appendChild(this.panel);
    this.el = h('div', { class: 'screen gui-screen' }, row, this.carriedEl);
    this.el.addEventListener('mousemove', (e) => this.onMove(e));
    this.el.addEventListener('mousedown', (e) => this.onOutside(e));
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseup', this.onUp);
    this.render();
  }

  destroy(): void {
    window.removeEventListener('mouseup', this.onUp);
    this.host.recipeBook?.detach();
    this.el.remove();
  }

  /** Refresh slot contents (called every frame; cheap when nothing changed). */
  render(): void {
    const m = this.menu;
    this.layout.update?.(this.panel, m);
    const key = m.slots.map((s) => { const st = s.stack; return st.isEmpty() ? '' : `${st.id}:${st.count}:${st.damage}:${st.hasEnchants() ? 1 : 0}`; }).join('|') + '#' + (m.carried.isEmpty() ? '' : `${m.carried.id}:${m.carried.count}`) + '#' + [...this.dragSlots].map((s) => s.index).join(',');
    if (key !== this.lastRender) {
      this.lastRender = key;
      const preview = this.dragPreview();
      m.slots.forEach((s, i) => {
        const el = this.slotEls[i]!;
        const pv = preview.get(s);
        if (pv) renderStack(el, pv, this.host.icons);
        else renderStack(el, s.stack, this.host.icons);
        el.classList.toggle('drag', this.dragSlots.has(s));
      });
      renderStack(this.carriedEl, m.carried.isEmpty() || this.dragging ? (this.dragging ? this.dragRemainder() : ItemStack.empty()) : m.carried, this.host.icons);
      if (this.hovered) this.showTooltip(this.hovered);
    }
    this.host.recipeBook?.render();
  }

  private dragPreview(): Map<Slot, ItemStack> {
    const out = new Map<Slot, ItemStack>();
    if (!this.dragging || this.dragSlots.size < 2) return out;
    const c = this.menu.carried;
    const n = this.dragSlots.size;
    const each = this.dragButton === 0 ? Math.floor(c.count / n) : this.dragButton === 1 ? 1 : c.count;
    for (const s of this.dragSlots) {
      const have = s.stack.isEmpty() ? 0 : s.stack.count;
      out.set(s, c.copyWithCount(Math.min(s.maxStack(c), have + each)));
    }
    return out;
  }

  private dragRemainder(): ItemStack {
    const c = this.menu.carried;
    if (this.dragSlots.size < 2 || this.dragButton === 2) return c;
    const each = this.dragButton === 0 ? Math.floor(c.count / this.dragSlots.size) : 1;
    let used = 0;
    for (const s of this.dragSlots) {
      const have = s.stack.isEmpty() ? 0 : s.stack.count;
      used += Math.min(s.maxStack(c), have + each) - have;
    }
    return c.copyWithCount(c.count - used);
  }

  private setHovered(s: Slot | null): void {
    this.hovered = s;
    this.tooltipEl?.remove();
    this.tooltipEl = null;
    if (s) this.showTooltip(s);
  }

  private showTooltip(s: Slot): void {
    this.tooltipEl?.remove();
    this.tooltipEl = null;
    if (!this.menu.carried.isEmpty() || s.stack.isEmpty()) return;
    this.tooltipEl = tooltipElement(s.stack, this.host.advancedTooltips);
    this.el.appendChild(this.tooltipEl);
    this.positionFloating();
  }

  private positionFloating(): void {
    const r = this.el.getBoundingClientRect();
    const x = this.mouseX - r.left, y = this.mouseY - r.top;
    this.carriedEl.style.left = `${x}px`;
    this.carriedEl.style.top = `${y}px`;
    if (this.tooltipEl) {
      const tw = this.tooltipEl.offsetWidth;
      const left = x + 14 + tw > r.width ? x - tw - 14 : x + 14;
      this.tooltipEl.style.left = `${left}px`;
      this.tooltipEl.style.top = `${Math.max(0, y - 18)}px`;
    }
  }

  private onMove(e: MouseEvent): void {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.positionFloating();
  }

  private onEnter(s: Slot): void {
    this.setHovered(s);
    if (this.dragButton >= 0 && !this.menu.carried.isEmpty()) {
      if (!this.dragging && this.dragStartSlot && s !== this.dragStartSlot) {
        this.dragging = true;
        this.click(-999, 0 | (this.dragType() << 2), 'quick_craft');
        this.addDragSlot(this.dragStartSlot);
      }
      if (this.dragging) this.addDragSlot(s);
    }
  }

  private dragType(): number {
    return this.dragButton === 0 ? 0 : this.dragButton === 2 ? 2 : 1;
  }

  private addDragSlot(s: Slot): void {
    const c = this.menu.carried;
    const cur = s.stack;
    if (!(cur.isEmpty() || cur.sameItemSameData(c)) || !s.mayPlace(c)) return;
    if (this.dragType() !== 2 && this.dragSlots.size >= c.count) return;
    if (this.dragSlots.has(s)) return;
    this.dragSlots.add(s);
    this.click(s.index, 1 | (this.dragType() << 2), 'quick_craft');
    this.render();
  }

  private onDown(e: MouseEvent, s: Slot): void {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.button;
    const carried = this.menu.carried;
    if (btn === 2 && this.host.menuPlayer.creative && carried.isEmpty() && s.hasItem()) {
      this.click(s.index, 2, 'clone');
      return;
    }
    if (btn > 2) return;
    const now = performance.now();
    const dbl = now - this.lastClickTime < 250 && this.lastClickSlot === s && this.lastClickButton === btn && btn === 0;
    this.lastClickTime = now;
    this.lastClickSlot = s;
    this.lastClickButton = btn;
    if (e.shiftKey && btn !== 2) {
      if (dbl && !s.hasItem()) return;
      this.click(s.index, btn, 'quick_move');
      return;
    }
    if (dbl && !carried.isEmpty() && btn === 0) {
      this.click(s.index, 0, 'pickup_all');
      return;
    }
    const b = btn === 2 ? 1 : btn === 1 ? 1 : 0;
    if (!carried.isEmpty() && (btn === 0 || btn === 1 || (btn === 2 && this.host.menuPlayer.creative))) {
      // Might become a drag; decide on mouse up
      this.dragButton = btn === 2 ? 2 : btn;
      this.dragStartSlot = s;
      this.dragging = false;
      this.dragSlots.clear();
      return;
    }
    if (btn === 2) return;
    this.click(s.index, b, 'pickup');
  }

  private readonly onUp = (): void => {
    if (this.dragButton < 0) return;
    const start = this.dragStartSlot;
    const btn = this.dragButton;
    const type = this.dragType();
    this.dragButton = -1;
    this.dragStartSlot = null;
    if (this.dragging) {
      this.dragging = false;
      this.click(-999, 2 | (type << 2), 'quick_craft');
      this.dragSlots.clear();
      this.render();
      return;
    }
    this.dragSlots.clear();
    if (start && btn !== 2) this.click(start.index, btn === 1 ? 1 : 0, 'pickup');
  };

  private onOutside(e: MouseEvent): void {
    if (e.target !== this.el && !(e.target as HTMLElement).classList?.contains('gui-row')) return;
    if (this.menu.carried.isEmpty()) return;
    this.click(SLOT_OUTSIDE, e.button === 2 ? 1 : 0, 'pickup');
  }

  /** Keyboard while the screen is open; returns true if consumed. */
  key(code: string): boolean {
    const action = this.host.keyAction(code);
    if (code === 'Escape' || action === 'inventory') {
      this.host.close();
      return true;
    }
    const s = this.hovered;
    if (!s) return false;
    if (action && action.startsWith('hotbar')) {
      const n = parseInt(action.slice(6), 10) - 1;
      if (this.menu.carried.isEmpty()) this.click(s.index, n, 'swap');
      return true;
    }
    if (action === 'swapHands') {
      if (this.menu.carried.isEmpty()) this.click(s.index, 40, 'swap');
      return true;
    }
    if (action === 'drop') {
      this.click(s.index, this.host.isCtrl() ? 1 : 0, 'throw');
      return true;
    }
    return false;
  }

  private click(slot: number, button: number, mode: ClickMode): void {
    this.host.sendClick(this.menu, slot, button, mode);
    this.render();
  }
}
