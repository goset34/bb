/** Item tooltips: name (rarity colour), enchantments, stored enchantments, effects, attributes, durability, lore. */
import { h } from './dom';
import { ItemStack } from '../../common/item/stack';
import { getItem } from '../../common/item/items';
import { itemName } from './names';
import { t, has } from '../../common/lang/i18n';
import { roman } from './status';

const RARITY_COLORS: Record<string, string> = { common: '#ffffff', uncommon: '#ffff55', rare: '#55ffff', epic: '#ff55ff' };

/** Extra tooltip lines contributed by other systems (potions, maps, fireworks…). */
export const tooltipProviders: Array<(stack: ItemStack, lines: Array<[string, string]>) => void> = [];

export function enchantName(id: string, level: number): string {
  const key = `enchantment.${id}`;
  const name = has(key) ? t(key) : id.replace(/_/g, ' ');
  const max = level > 1 || !['silk_touch', 'mending', 'infinity', 'channeling', 'multishot', 'flame', 'aqua_affinity', 'binding_curse', 'vanishing_curse'].includes(id);
  return max ? `${name} ${roman(level)}` : name;
}

export function tooltipLines(stack: ItemStack, advanced = false): Array<[string, string]> {
  const def = getItem(stack.id);
  const lines: Array<[string, string]> = [];
  const enchanted = stack.hasEnchants();
  const rarity = enchanted && def?.rarity === 'common' ? 'rare' : def?.rarity ?? 'common';
  const name = stack.data.name ?? itemName(stack.id);
  lines.push([name, stack.data.name ? '#ffffff' : RARITY_COLORS[rarity]!]);
  for (const [id, lvl] of Object.entries(stack.data.enchants ?? {})) lines.push([enchantName(id, lvl), id.endsWith('_curse') ? '#ff5555' : '#aaaaaa']);
  for (const [id, lvl] of Object.entries(stack.data.stored ?? {})) lines.push([enchantName(id, lvl), '#aaaaaa']);
  if (stack.data.trim) {
    lines.push([t('item.trim'), '#aaaaaa']);
    lines.push([` ${t('trim_pattern.' + stack.data.trim.pattern)}`, '#8888ff']);
    lines.push([` ${t('trim_material.' + stack.data.trim.material)}`, '#8888ff']);
  }
  for (const p of tooltipProviders) p(stack, lines);
  for (const l of stack.data.lore ?? []) lines.push([l, '#aa00aa']);
  // Attributes
  if (def?.tool && def.tool.type !== 'shears' && def.tool.type !== 'brush') {
    lines.push(['', '#000']);
    lines.push([t('item.modifiers.mainhand'), '#aaaaaa']);
    lines.push([` ${fmt(def.tool.attackDamage)} ${t('attribute.attack_damage')}`, '#00aa00']);
    lines.push([` ${fmt(def.tool.attackSpeed)} ${t('attribute.attack_speed')}`, '#00aa00']);
  } else if (def?.armor) {
    lines.push(['', '#000']);
    lines.push([t(`item.modifiers.${def.armor.slot}`), '#aaaaaa']);
    if (def.armor.defense) lines.push([`+${def.armor.defense} ${t('attribute.armor')}`, '#5555ff']);
    if (def.armor.toughness) lines.push([`+${def.armor.toughness} ${t('attribute.armor_toughness')}`, '#5555ff']);
    if (def.armor.knockbackResistance) lines.push([`+${Math.round(def.armor.knockbackResistance * 10)} ${t('attribute.knockback_resistance')}`, '#5555ff']);
  }
  if (stack.data.unbreakable) lines.push([t('item.unbreakable'), '#5555ff']);
  if (def && def.maxDamage > 0 && (advanced || stack.damage > 0)) lines.push([t('item.durability', def.maxDamage - stack.damage, def.maxDamage), '#ffffff']);
  if (advanced) lines.push([stack.id, '#555555']);
  return lines;
}

function fmt(v: number): string {
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return s;
}

export function tooltipElement(stack: ItemStack, advanced = false): HTMLDivElement {
  const el = h('div', { class: 'tooltip txt' });
  for (const [text, color] of tooltipLines(stack, advanced)) {
    el.appendChild(h('div', { style: { color, minHeight: text ? '' : '0.5em' } }, text));
  }
  return el;
}

/** Durability bar colour (green → red). */
export function durabilityBar(stack: ItemStack): { width: number; color: string } | null {
  const def = getItem(stack.id);
  if (!def || def.maxDamage <= 0 || stack.damage <= 0) return null;
  const f = Math.max(0, 1 - stack.damage / def.maxDamage);
  const hue = f * 120;
  return { width: Math.round(f * 13) / 13, color: `hsl(${hue}, 100%, 50%)` };
}
