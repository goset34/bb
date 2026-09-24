/** Shared rendering of an item stack inside a slot element (icon, count, durability bar, glint). */
import { h, clear } from './dom';
import type { IconRenderer } from './icons';
import type { ItemStack } from '../../common/item/stack';
import { durabilityBar } from './tooltip';
import { hasGlint } from '../render/entity/itemmodel';

export function renderStack(el: HTMLElement, stack: ItemStack, icons: IconRenderer, countOverride?: number): void {
  clear(el);
  if (stack.isEmpty()) return;
  const img = h('img', { src: icons.stackIcon(stack), draggable: 'false', alt: '' });
  el.appendChild(img);
  if (hasGlint(stack)) el.appendChild(h('div', { class: 'glint' }));
  const count = countOverride ?? stack.count;
  if (count !== 1) el.appendChild(h('div', { class: 'count' }, String(count)));
  const bar = durabilityBar(stack);
  if (bar) el.appendChild(h('div', { class: 'dmg' }, h('div', { style: { width: `${bar.width * 100}%`, background: bar.color } })));
}
