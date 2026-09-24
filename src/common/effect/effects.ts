/**
 * Status effect definitions: colours, category, attribute modifiers and per-tick behaviour.
 * The server applies ticks through an {@link EffectHost}; the client shows icons and particles.
 */
import type { Entity } from '../entity/ecs';
import type { AttrModifier } from '../entity/living';

export type EffectCategory = 'beneficial' | 'harmful' | 'neutral';

export interface EffectHost {
  heal(e: Entity, amount: number): void;
  hurt(e: Entity, type: string, amount: number): void;
  health(e: Entity): number;
  maxHealth(e: Entity): number;
  isUndead(e: Entity): boolean;
  addExhaustion(e: Entity, amount: number): void;
  feed(e: Entity, nutrition: number, saturation: number): void;
  setAbsorption(e: Entity, amount: number): void;
  absorption(e: Entity): number;
}

export interface EffectDef {
  id: string;
  category: EffectCategory;
  color: number;
  instant: boolean;
  /** Attribute modifiers applied while active; amount is multiplied by (amp + 1). */
  attributes?: Array<{ attr: string; amount: number; op: AttrModifier['op'] }>;
  /** Whether to run `tick` this tick given remaining duration and amplifier. */
  shouldTick?(dur: number, amp: number): boolean;
  tick?(host: EffectHost, e: Entity, amp: number): void;
  /** Instant effects (and splash potions) apply once. */
  applyInstant?(host: EffectHost, e: Entity, amp: number, scale: number): void;
  /** Called when added (absorption sets the shield). */
  onAdded?(host: EffectHost, e: Entity, amp: number): void;
  onRemoved?(host: EffectHost, e: Entity, amp: number): void;
}

export const EFFECTS = new Map<string, EffectDef>();

function def(d: EffectDef): void {
  EFFECTS.set(d.id, d);
}

const every = (base: number) => (dur: number, amp: number) => {
  const k = base >> amp;
  return k > 0 ? dur % k === 0 : true;
};

export function registerEffects(): void {
  def({ id: 'speed', category: 'beneficial', color: 0x33ebff, instant: false, attributes: [{ attr: 'movement_speed', amount: 0.2, op: 'mul_total' }] });
  def({ id: 'slowness', category: 'harmful', color: 0x8bafe0, instant: false, attributes: [{ attr: 'movement_speed', amount: -0.15, op: 'mul_total' }] });
  def({ id: 'haste', category: 'beneficial', color: 0xd9c043, instant: false, attributes: [{ attr: 'attack_speed', amount: 0.1, op: 'mul_total' }] });
  def({ id: 'mining_fatigue', category: 'harmful', color: 0x4a4217, instant: false, attributes: [{ attr: 'attack_speed', amount: -0.1, op: 'mul_total' }] });
  def({ id: 'strength', category: 'beneficial', color: 0xffc700, instant: false, attributes: [{ attr: 'attack_damage', amount: 3, op: 'add' }] });
  def({
    id: 'instant_health', category: 'beneficial', color: 0xf82423, instant: true,
    applyInstant: (h, e, amp, scale) => (h.isUndead(e) ? h.hurt(e, 'magic', Math.floor(scale * (6 << amp))) : h.heal(e, Math.max(4 << amp, 0) * scale)),
  });
  def({
    id: 'instant_damage', category: 'harmful', color: 0xa9656a, instant: true,
    applyInstant: (h, e, amp, scale) => (h.isUndead(e) ? h.heal(e, (4 << amp) * scale) : h.hurt(e, 'magic', Math.floor(scale * (6 << amp)))),
  });
  def({ id: 'jump_boost', category: 'beneficial', color: 0xfdff84, instant: false, attributes: [{ attr: 'safe_fall_distance', amount: 1, op: 'add' }] });
  def({ id: 'nausea', category: 'harmful', color: 0x551d4a, instant: false });
  def({
    id: 'regeneration', category: 'beneficial', color: 0xcd5cab, instant: false, shouldTick: every(50),
    tick: (h, e) => { if (h.health(e) < h.maxHealth(e)) h.heal(e, 1); },
  });
  def({ id: 'resistance', category: 'beneficial', color: 0x9146f0, instant: false });
  def({ id: 'fire_resistance', category: 'beneficial', color: 0xff9900, instant: false });
  def({ id: 'water_breathing', category: 'beneficial', color: 0x98dac0, instant: false });
  def({ id: 'invisibility', category: 'beneficial', color: 0xf6f6f6, instant: false });
  def({ id: 'blindness', category: 'harmful', color: 0x1f1f23, instant: false });
  def({ id: 'night_vision', category: 'beneficial', color: 0xc2ff66, instant: false });
  def({ id: 'hunger', category: 'harmful', color: 0x587653, instant: false, shouldTick: () => true, tick: (h, e, amp) => h.addExhaustion(e, 0.005 * (amp + 1)) });
  def({ id: 'weakness', category: 'harmful', color: 0x484d48, instant: false, attributes: [{ attr: 'attack_damage', amount: -4, op: 'add' }] });
  def({
    id: 'poison', category: 'harmful', color: 0x87a363, instant: false, shouldTick: every(25),
    tick: (h, e) => { if (h.health(e) > 1) h.hurt(e, 'magic', 1); },
  });
  def({ id: 'withering', category: 'harmful', color: 0x736156, instant: false, shouldTick: every(40), tick: (h, e) => h.hurt(e, 'withering', 1) });
  def({ id: 'health_boost', category: 'beneficial', color: 0xf87d23, instant: false, attributes: [{ attr: 'max_health', amount: 4, op: 'add' }] });
  def({
    id: 'absorption', category: 'beneficial', color: 0x2552a5, instant: false, attributes: [{ attr: 'max_absorption', amount: 4, op: 'add' }],
    onAdded: (h, e, amp) => h.setAbsorption(e, Math.max(h.absorption(e), 4 * (amp + 1))),
    onRemoved: (h, e) => h.setAbsorption(e, 0),
  });
  def({ id: 'saturation', category: 'beneficial', color: 0xf82423, instant: true, shouldTick: () => true, tick: (h, e, amp) => h.feed(e, amp + 1, (amp + 1) * 2), applyInstant: (h, e, amp) => h.feed(e, amp + 1, (amp + 1) * 2) });
  def({ id: 'glowing', category: 'neutral', color: 0x94a061, instant: false });
  def({ id: 'levitation', category: 'harmful', color: 0xceffff, instant: false });
  def({ id: 'luck', category: 'beneficial', color: 0x59c106, instant: false, attributes: [{ attr: 'luck', amount: 1, op: 'add' }] });
  def({ id: 'unluck', category: 'harmful', color: 0xc0a44d, instant: false, attributes: [{ attr: 'luck', amount: -1, op: 'add' }] });
  def({ id: 'slow_falling', category: 'beneficial', color: 0xf3cfb9, instant: false });
  def({ id: 'conduit_power', category: 'beneficial', color: 0x1dc2d1, instant: false });
  def({ id: 'dolphins_grace', category: 'beneficial', color: 0x88a3be, instant: false });
  def({ id: 'bad_omen', category: 'neutral', color: 0x0b6138, instant: false });
  def({ id: 'hero_of_the_village', category: 'beneficial', color: 0x44ff44, instant: false });
  def({ id: 'darkness', category: 'harmful', color: 0x292721, instant: false });
  def({ id: 'trial_omen', category: 'neutral', color: 0x16a6a6, instant: false });
  def({ id: 'raid_omen', category: 'neutral', color: 0xde4058, instant: false });
  def({ id: 'wind_charged', category: 'harmful', color: 0xbdc9ff, instant: false });
  def({ id: 'weaving', category: 'harmful', color: 0x78695a, instant: false });
  def({ id: 'oozing', category: 'harmful', color: 0x99ffa3, instant: false });
  def({ id: 'infested', category: 'harmful', color: 0x8c9b8c, instant: false });
}

export function effectDef(id: string): EffectDef | undefined {
  return EFFECTS.get(id);
}

/** Mix the colours of active effects (potion particle colour). */
export function effectsColor(list: Array<{ id: string; amp: number }>): number {
  let r = 0, g = 0, b = 0, n = 0;
  for (const e of list) {
    const d = EFFECTS.get(e.id);
    if (!d) continue;
    const k = e.amp + 1;
    r += ((d.color >> 16) & 255) * k; g += ((d.color >> 8) & 255) * k; b += (d.color & 255) * k; n += k;
  }
  if (!n) return 0x385dc6;
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}
