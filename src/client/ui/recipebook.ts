/**
 * Recipe book panel beside crafting screens: known recipes filtered by category, search text and
 * craftability; clicking fills the grid (shift = as many as possible).
 */
import { h, clear } from './dom';
import type { IconRenderer } from './icons';
import { px } from './containers';
import { CraftingMenuBase, recipeLayout, placeRecipe } from '../../common/menu/menus';
import type { MenuPlayer } from '../../common/menu/menu';
import { RECIPES, matches, ingredientItems, resultStack, CraftingRecipe } from '../../common/recipe/recipes';
import { itemName } from './names';
import { t } from '../../common/lang/i18n';
import { renderStack } from './slotview';
import { tooltipElement } from './tooltip';
import { ItemStack } from '../../common/item/stack';

type Tab = 'all' | 'equipment' | 'building' | 'redstone' | 'misc';
const TABS: Tab[] = ['all', 'equipment', 'building', 'redstone', 'misc'];
const TAB_ICONS: Record<Tab, string> = { all: 'compass', equipment: 'iron_axe', building: 'bricks', redstone: 'flux_dust', misc: 'lava_bucket' };
const PER_PAGE = 20;

function tabOf(r: CraftingRecipe): Tab {
  switch (r.category) {
    case 'equipment': return 'equipment';
    case 'building': case 'blocks': return 'building';
    case 'redstone': return 'redstone';
    default: return 'misc';
  }
}

export class RecipeBook {
  /** Recipe ids unlocked by the server. */
  readonly known = new Set<string>();
  open = false;
  craftableOnly = false;
  private tab: Tab = 'all';
  private search = '';
  private page = 0;
  private menu: CraftingMenuBase | null = null;
  private el: HTMLDivElement | null = null;
  private grid: HTMLDivElement | null = null;
  private pageLabel: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private lastKey = '';
  private list: Array<{ id: string; craftable: boolean }> = [];
  /** Notified when the book opens/closes (screen re-layout). */
  onToggle: (() => void) | null = null;

  constructor(private readonly icons: IconRenderer, private readonly player: MenuPlayer, private readonly send: (windowId: number, recipe: string, all: boolean) => void) {}

  attach(menu: CraftingMenuBase, row: HTMLElement): void {
    this.menu = menu;
    this.lastKey = '';
    const search = h('input', { class: 'input rb-search', type: 'text', placeholder: t('recipeBook.search'), spellcheck: 'false', value: this.search }) as HTMLInputElement;
    search.addEventListener('input', () => { this.search = search.value.toLowerCase(); this.page = 0; this.lastKey = ''; });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    const filter = h('div', { class: `rb-filter ${this.craftableOnly ? 'on' : ''}`, title: t(this.craftableOnly ? 'recipeBook.showAll' : 'recipeBook.craftableOnly') });
    filter.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.craftableOnly = !this.craftableOnly;
      filter.classList.toggle('on', this.craftableOnly);
      filter.title = t(this.craftableOnly ? 'recipeBook.showAll' : 'recipeBook.craftableOnly');
      this.page = 0;
      this.lastKey = '';
    });
    const tabs = h('div', { class: 'rb-tabs' });
    for (const tb of TABS) {
      const el = h('div', { class: `rb-tab ${tb === this.tab ? 'sel' : ''}`, title: t(`recipeBook.tab.${tb}`) }, h('img', { src: this.icons.icon(TAB_ICONS[tb]), alt: '', draggable: 'false' }));
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.tab = tb;
        this.page = 0;
        this.lastKey = '';
        for (const c of tabs.children) c.classList.remove('sel');
        el.classList.add('sel');
      });
      tabs.appendChild(el);
    }
    this.grid = h('div', { class: 'rb-grid' });
    const prev = h('div', { class: 'rb-page prev' }, '◀');
    const next = h('div', { class: 'rb-page next' }, '▶');
    this.pageLabel = h('div', { class: 'rb-page-label txt' });
    prev.addEventListener('mousedown', (e) => { e.stopPropagation(); if (this.page > 0) { this.page--; this.lastKey = ''; } });
    next.addEventListener('mousedown', (e) => { e.stopPropagation(); if ((this.page + 1) * PER_PAGE < this.list.length) { this.page++; this.lastKey = ''; } });
    this.el = h('div', { class: 'gui-panel rb-panel', style: { width: px(147), height: px(166), display: this.open ? '' : 'none' } },
      tabs, search, filter, this.grid, prev, this.pageLabel, next);
    row.prepend(this.el);
  }

  detach(): void {
    this.el?.remove();
    this.el = null;
    this.menu = null;
    this.tooltip?.remove();
    this.tooltip = null;
  }

  toggle(): void {
    this.open = !this.open;
    if (this.el) this.el.style.display = this.open ? '' : 'none';
    this.lastKey = '';
    this.onToggle?.();
  }

  /** Recompute and redraw when inventory / filters changed. */
  render(): void {
    if (!this.el || !this.open || !this.menu || !this.grid) return;
    const inv = this.player.inventory;
    const key = `${inv.revision}|${this.known.size}|${this.tab}|${this.search}|${this.craftableOnly}|${this.page}|${this.menu.grid.width}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const counts = new Map<string, number>();
    for (let i = 0; i < 36; i++) {
      const s = inv.get(i);
      if (!s.isEmpty()) counts.set(s.id, (counts.get(s.id) ?? 0) + s.count);
    }
    for (let i = 0; i < this.menu.grid.size; i++) {
      const s = this.menu.grid.get(i);
      if (!s.isEmpty()) counts.set(s.id, (counts.get(s.id) ?? 0) + s.count);
    }
    const w = this.menu.grid.width, hgt = this.menu.grid.height;
    const list: Array<{ id: string; craftable: boolean }> = [];
    for (const id of this.known) {
      const r = RECIPES.get(id);
      if (!r || (r.type !== 'shaped' && r.type !== 'shapeless')) continue;
      if (this.tab !== 'all' && tabOf(r) !== this.tab) continue;
      const layout = recipeLayout(id, w, hgt);
      if (!layout) continue;
      if (this.search && !itemName(r.result.id).toLowerCase().includes(this.search) && !r.result.id.includes(this.search)) continue;
      const craftable = canCraft(layout, counts);
      if (this.craftableOnly && !craftable) continue;
      list.push({ id, craftable });
    }
    list.sort((a, b) => (a.craftable === b.craftable ? 0 : a.craftable ? -1 : 1) || a.id.localeCompare(b.id));
    this.list = list;
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (this.page >= pages) this.page = pages - 1;
    clear(this.grid);
    for (const { id, craftable } of list.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE)) {
      const r = RECIPES.get(id) as CraftingRecipe & { result: { id: string; count: number } };
      const cell = h('div', { class: `rb-cell ${craftable ? '' : 'missing'}` });
      renderStack(cell, resultStack(r.result), this.icons);
      cell.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (!this.menu) return;
        placeRecipe(this.menu, id, e.shiftKey, this.player);
        this.send(this.menu.windowId, id, e.shiftKey);
        this.lastKey = '';
      });
      cell.addEventListener('mouseenter', () => this.showTooltip(cell, id, craftable));
      cell.addEventListener('mouseleave', () => { this.tooltip?.remove(); this.tooltip = null; });
      this.grid.appendChild(cell);
    }
    if (this.pageLabel) this.pageLabel.textContent = `${this.page + 1}/${pages}`;
  }

  private showTooltip(cell: HTMLElement, id: string, craftable: boolean): void {
    this.tooltip?.remove();
    const r = RECIPES.get(id) as CraftingRecipe & { result: { id: string; count: number } };
    const tip = tooltipElement(resultStack(r.result));
    if (!craftable) {
      const layout = recipeLayout(id, 3, 3) ?? [];
      const need = new Map<string, number>();
      for (const ing of layout) if (ing) need.set(ing, (need.get(ing) ?? 0) + 1);
      tip.appendChild(h('div', { style: { color: '#ff7070' } }, t('recipeBook.requires')));
      for (const [ing, n] of need) {
        const first = [...ingredientItems(ing)][0] ?? ing;
        tip.appendChild(h('div', { style: { color: '#bbbbbb' } }, ` ${n}× ${ing.startsWith('#') ? `${itemName(first)}…` : itemName(first)}`));
      }
    }
    const rect = cell.getBoundingClientRect();
    tip.style.position = 'fixed';
    tip.style.left = `${rect.right + 6}px`;
    tip.style.top = `${rect.top}px`;
    document.body.appendChild(tip);
    this.tooltip = tip;
  }
}

/** Greedy availability check of a recipe layout against item counts. */
function canCraft(layout: Array<string | null>, counts: Map<string, number>): boolean {
  const left = new Map(counts);
  for (const ing of layout) {
    if (!ing) continue;
    let found = false;
    for (const [id, n] of left) {
      if (n <= 0) continue;
      if (!matches(ing, new ItemStack(id, 1))) continue;
      left.set(id, n - 1);
      found = true;
      break;
    }
    if (!found) return false;
  }
  return true;
}
