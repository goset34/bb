/** Text components naming items and entities (resolved on the client in its language). */
import type { Entity } from '../../common/entity/ecs';
import type { ItemStack } from '../../common/item/stack';
import type { TextComponent } from '../../common/lang/i18n';

export function itemNameComponent(s: ItemStack): TextComponent {
  return s.data.name ? { text: s.data.name } : { key: `item.${s.id}` };
}

export function entityName(e: Entity): TextComponent {
  if (e.player) return { text: e.player.name };
  const custom = e['customName'] as string | undefined;
  return custom ? { text: custom } : { key: `entity.${e.type}` };
}
