/** Cached block-state lookup by string ("name" or "name[prop=value,…]") for features. */
import { parseState } from '../../block/registry';

const cache = new Map<string, number>();

export function B(str: string): number {
  let s = cache.get(str);
  if (s === undefined) {
    s = parseState(str);
    if (s === undefined) throw new Error('Unknown block state ' + str);
    cache.set(str, s);
  }
  return s;
}
