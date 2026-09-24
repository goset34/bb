/**
 * Recipe unlocking for the recipe book: a recipe becomes known once the player has held any of
 * its ingredients (or crafted its result). Known recipes persist with the player.
 */
import { RECIPES } from '../../common/recipe/recipes';
import { recipeIngredientIds } from '../../common/menu/menus';
import type { ServerPlayer } from '../player';

let index: Map<string, string[]> | null = null;

function recipeIndex(): Map<string, string[]> {
  if (index) return index;
  index = new Map();
  for (const id of RECIPES.keys()) {
    for (const item of recipeIngredientIds(id)) {
      let arr = index.get(item);
      if (!arr) index.set(item, (arr = []));
      arr.push(id);
    }
  }
  return index;
}

interface RecipeState {
  known: Set<string>;
  seen: Set<string>;
}

function state(p: ServerPlayer): RecipeState {
  let s = p.ext['recipes'] as RecipeState | undefined;
  if (!s) {
    s = { known: new Set(), seen: new Set() };
    p.ext['recipes'] = s;
  }
  return s;
}

/** Unlock recipes that use `item`; returns the newly unlocked ids. */
function unlockFor(p: ServerPlayer, item: string): string[] {
  const s = state(p);
  if (s.seen.has(item)) return [];
  s.seen.add(item);
  const out: string[] = [];
  for (const id of recipeIndex().get(item) ?? []) {
    if (s.known.has(id)) continue;
    s.known.add(id);
    out.push(id);
  }
  return out;
}

/** Scan the inventory for newly obtained items (called periodically). */
export function tickRecipes(p: ServerPlayer): void {
  const added: string[] = [];
  for (const st of p.inventory.slots) if (!st.isEmpty()) added.push(...unlockFor(p, st.id));
  if (added.length) p.send({ type: 'recipes', action: 'add', ids: added });
}

export function recipeCrafted(p: ServerPlayer, item: string): void {
  const added = unlockFor(p, item);
  if (added.length) p.send({ type: 'recipes', action: 'add', ids: added });
}

export function sendAllRecipes(p: ServerPlayer): void {
  p.send({ type: 'recipes', action: 'init', ids: [...state(p).known] });
}

/** Unlock every recipe (/recipe give … *). */
export function unlockAllRecipes(p: ServerPlayer): void {
  const s = state(p);
  const added = [...RECIPES.keys()].filter((id) => !s.known.has(id));
  for (const id of added) s.known.add(id);
  if (added.length) p.send({ type: 'recipes', action: 'add', ids: added });
}

export function saveRecipes(p: ServerPlayer): { known: string[]; seen: string[] } {
  const s = state(p);
  return { known: [...s.known], seen: [...s.seen] };
}

export function loadRecipes(p: ServerPlayer, d: { known?: string[]; seen?: string[] } | undefined): void {
  const s = state(p);
  for (const id of d?.known ?? []) if (RECIPES.has(id)) s.known.add(id);
  for (const id of d?.seen ?? []) s.seen.add(id);
}
