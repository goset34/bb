/**
 * Potion types: the effects each brewed potion carries (durations in ticks). Tipped arrows apply
 * one eighth of the duration; splash potions scale by distance; lingering clouds by a quarter.
 */

export interface PotionEffect {
  id: string;
  dur: number;
  amp: number;
}

export const POTIONS = new Map<string, PotionEffect[]>();

function potion(id: string, ...effects: PotionEffect[]): void {
  POTIONS.set(id, effects);
}

const fx = (id: string, dur: number, amp = 0): PotionEffect => ({ id, dur, amp });

potion('water');
potion('mundane');
potion('thick');
potion('awkward');
potion('night_vision', fx('night_vision', 3600));
potion('long_night_vision', fx('night_vision', 9600));
potion('invisibility', fx('invisibility', 3600));
potion('long_invisibility', fx('invisibility', 9600));
potion('leaping', fx('jump_boost', 3600));
potion('long_leaping', fx('jump_boost', 9600));
potion('strong_leaping', fx('jump_boost', 1800, 1));
potion('fire_resistance', fx('fire_resistance', 3600));
potion('long_fire_resistance', fx('fire_resistance', 9600));
potion('swiftness', fx('speed', 3600));
potion('long_swiftness', fx('speed', 9600));
potion('strong_swiftness', fx('speed', 1800, 1));
potion('slowness', fx('slowness', 1800));
potion('long_slowness', fx('slowness', 4800));
potion('strong_slowness', fx('slowness', 400, 3));
potion('turtle_master', fx('slowness', 400, 3), fx('resistance', 400, 2));
potion('long_turtle_master', fx('slowness', 800, 3), fx('resistance', 800, 2));
potion('strong_turtle_master', fx('slowness', 400, 5), fx('resistance', 400, 3));
potion('water_breathing', fx('water_breathing', 3600));
potion('long_water_breathing', fx('water_breathing', 9600));
potion('healing', fx('instant_health', 1));
potion('strong_healing', fx('instant_health', 1, 1));
potion('harming', fx('instant_damage', 1));
potion('strong_harming', fx('instant_damage', 1, 1));
potion('poison', fx('poison', 900));
potion('long_poison', fx('poison', 1800));
potion('strong_poison', fx('poison', 432, 1));
potion('regeneration', fx('regeneration', 900));
potion('long_regeneration', fx('regeneration', 1800));
potion('strong_regeneration', fx('regeneration', 450, 1));
potion('strength', fx('strength', 3600));
potion('long_strength', fx('strength', 9600));
potion('strong_strength', fx('strength', 1800, 1));
potion('weakness', fx('weakness', 1800));
potion('long_weakness', fx('weakness', 4800));
potion('luck', fx('luck', 6000));
potion('slow_falling', fx('slow_falling', 1800));
potion('long_slow_falling', fx('slow_falling', 4800));
potion('wind_charged', fx('wind_charged', 3600));
potion('weaving', fx('weaving', 3600));
potion('oozing', fx('oozing', 3600));
potion('infested', fx('infested', 3600));

/** Effects of a potion-like stack (potion id plus custom effects). */
export function stackEffects(potionId: string | undefined, custom: PotionEffect[] | undefined): PotionEffect[] {
  return [...(potionId ? POTIONS.get(potionId) ?? [] : []), ...(custom ?? [])];
}

/** Display colour of a set of effects (average of effect colours, water blue when empty). */
export function potionColor(effects: PotionEffect[], colorOf: (id: string) => number): number {
  if (!effects.length) return 0x385dc6;
  let r = 0, g = 0, b = 0, n = 0;
  for (const e of effects) {
    const c = colorOf(e.id);
    const w = e.amp + 1;
    r += ((c >> 16) & 255) * w;
    g += ((c >> 8) & 255) * w;
    b += (c & 255) * w;
    n += w;
  }
  return ((Math.round(r / n) & 255) << 16) | ((Math.round(g / n) & 255) << 8) | (Math.round(b / n) & 255);
}
