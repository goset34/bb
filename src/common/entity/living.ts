/**
 * Living entities: attributes with modifiers, health/absorption, status effects, damage
 * sources and the armor/resistance damage formulas, food and experience math. Shared by the
 * server simulation and the client HUD.
 */
import type { Entity } from './ecs';

// ---------------------------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------------------------

export type AttrOp = 'add' | 'mul_base' | 'mul_total';

export interface AttrModifier {
  id: string;
  amount: number;
  op: AttrOp;
}

export const ATTRIBUTES: Record<string, { base: number; min: number; max: number }> = {
  max_health: { base: 20, min: 1, max: 1024 },
  max_absorption: { base: 0, min: 0, max: 2048 },
  movement_speed: { base: 0.1, min: 0, max: 1024 },
  flying_speed: { base: 0.4, min: 0, max: 1024 },
  attack_damage: { base: 1, min: 0, max: 2048 },
  attack_speed: { base: 4, min: 0, max: 1024 },
  attack_knockback: { base: 0, min: 0, max: 5 },
  armor: { base: 0, min: 0, max: 30 },
  armor_toughness: { base: 0, min: 0, max: 20 },
  knockback_resistance: { base: 0, min: 0, max: 1 },
  explosion_knockback_resistance: { base: 0, min: 0, max: 1 },
  luck: { base: 0, min: -1024, max: 1024 },
  block_interaction_range: { base: 4.5, min: 0, max: 64 },
  entity_interaction_range: { base: 3, min: 0, max: 64 },
  block_break_speed: { base: 1, min: 0, max: 1024 },
  mining_efficiency: { base: 0, min: 0, max: 1024 },
  submerged_mining_speed: { base: 0.2, min: 0, max: 20 },
  sneaking_speed: { base: 0.3, min: 0, max: 1 },
  gravity: { base: 0.08, min: -1, max: 1 },
  jump_strength: { base: 0.42, min: 0, max: 32 },
  step_height: { base: 0.6, min: 0, max: 10 },
  safe_fall_distance: { base: 3, min: -1024, max: 1024 },
  fall_damage_multiplier: { base: 1, min: 0, max: 100 },
  scale: { base: 1, min: 0.0625, max: 16 },
  oxygen_bonus: { base: 0, min: 0, max: 1024 },
  water_movement_efficiency: { base: 0, min: 0, max: 1 },
  movement_efficiency: { base: 0, min: 0, max: 1 },
  burning_time: { base: 1, min: 0, max: 1024 },
  follow_range: { base: 32, min: 0, max: 2048 },
  spawn_reinforcements: { base: 0, min: 0, max: 1 },
  tempt_range: { base: 10, min: 0, max: 2048 },
  camera_distance: { base: 4, min: 0, max: 32 },
  waypoint_transmit_range: { base: 60, min: 0, max: 60000000 },
  waypoint_receive_range: { base: 60, min: 0, max: 60000000 },
};

export class Attribute {
  private readonly mods = new Map<string, AttrModifier>();
  private cached = NaN;

  constructor(readonly name: string, public base: number) {}

  setBase(v: number): void {
    this.base = v;
    this.cached = NaN;
  }

  add(m: AttrModifier): void {
    this.mods.set(m.id, m);
    this.cached = NaN;
  }

  remove(id: string): void {
    if (this.mods.delete(id)) this.cached = NaN;
  }

  has(id: string): boolean {
    return this.mods.has(id);
  }

  modifiers(): IterableIterator<AttrModifier> {
    return this.mods.values();
  }

  get value(): number {
    if (!Number.isNaN(this.cached)) return this.cached;
    let v = this.base;
    for (const m of this.mods.values()) if (m.op === 'add') v += m.amount;
    let r = v;
    for (const m of this.mods.values()) if (m.op === 'mul_base') r += v * m.amount;
    for (const m of this.mods.values()) if (m.op === 'mul_total') r *= 1 + m.amount;
    const spec = ATTRIBUTES[this.name];
    if (spec) r = Math.max(spec.min, Math.min(spec.max, r));
    this.cached = r;
    return r;
  }
}

export class Attributes {
  readonly map = new Map<string, Attribute>();

  constructor(overrides: Record<string, number> = {}) {
    for (const [k, v] of Object.entries(overrides)) this.map.set(k, new Attribute(k, v));
  }

  get(name: string): Attribute {
    let a = this.map.get(name);
    if (!a) {
      a = new Attribute(name, ATTRIBUTES[name]?.base ?? 0);
      this.map.set(name, a);
    }
    return a;
  }

  value(name: string): number {
    return this.get(name).value;
  }

  toJSON(): Record<string, { base: number; mods: AttrModifier[] }> {
    const o: Record<string, { base: number; mods: AttrModifier[] }> = {};
    for (const [k, a] of this.map) o[k] = { base: a.base, mods: [...a.modifiers()] };
    return o;
  }

  load(o: Record<string, { base: number; mods: AttrModifier[] }>): void {
    for (const [k, v] of Object.entries(o)) {
      const a = this.get(k);
      a.setBase(v.base);
      for (const m of v.mods) a.add(m);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Status effects
// ---------------------------------------------------------------------------------------------

export interface EffectInstance {
  id: string;
  /** Amplifier (0 = level I). */
  amp: number;
  /** Remaining ticks (-1 = infinite). */
  dur: number;
  ambient: boolean;
  particles: boolean;
  icon: boolean;
}

export function effect(id: string, dur: number, amp = 0, ambient = false, particles = true): EffectInstance {
  return { id, amp, dur, ambient, particles, icon: true };
}

// ---------------------------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------------------------

export interface DamageSource {
  /** Damage type id (fall, drown, in_fire, lava, mob_attack, player_attack, arrow…). */
  type: string;
  /** Entity responsible (shooter / attacker). */
  attacker?: Entity | null;
  /** Direct entity (projectile) or attacker. */
  direct?: Entity | null;
  /** Source position for knockback/explosions. */
  pos?: [number, number, number];
}

interface DamageTypeInfo {
  bypassArmor?: boolean;
  bypassInvulnerability?: boolean;
  bypassEffects?: boolean;
  bypassResistance?: boolean;
  isFire?: boolean;
  isProjectile?: boolean;
  isExplosion?: boolean;
  isFall?: boolean;
  noKnockback?: boolean;
  scalesWithDifficulty?: boolean;
  /** Exhaustion added to the victim. */
  exhaustion: number;
}

export const DAMAGE_TYPES: Record<string, DamageTypeInfo> = {
  generic: { exhaustion: 0 },
  generic_kill: { bypassArmor: true, bypassInvulnerability: true, bypassEffects: true, bypassResistance: true, exhaustion: 0 },
  fall: { bypassArmor: true, isFall: true, noKnockback: true, exhaustion: 0 },
  fly_into_wall: { bypassArmor: true, noKnockback: true, exhaustion: 0 },
  drown: { bypassArmor: true, noKnockback: true, exhaustion: 0 },
  in_fire: { bypassArmor: true, isFire: true, noKnockback: true, exhaustion: 0.1 },
  campfire: { bypassArmor: true, isFire: true, noKnockback: true, exhaustion: 0.1 },
  on_fire: { bypassArmor: true, isFire: true, noKnockback: true, exhaustion: 0 },
  lava: { isFire: true, noKnockback: true, exhaustion: 0.1 },
  hot_floor: { isFire: true, noKnockback: true, exhaustion: 0.1 },
  in_wall: { bypassArmor: true, noKnockback: true, exhaustion: 0 },
  cramming: { bypassArmor: true, noKnockback: true, exhaustion: 0 },
  cactus: { noKnockback: true, exhaustion: 0.1 },
  sweet_berry_bush: { noKnockback: true, exhaustion: 0.1 },
  starve: { bypassArmor: true, bypassEffects: true, noKnockback: true, exhaustion: 0 },
  out_of_world: { bypassArmor: true, bypassInvulnerability: true, noKnockback: true, exhaustion: 0 },
  outside_border: { bypassArmor: true, noKnockback: true, exhaustion: 0 },
  magic: { bypassArmor: true, noKnockback: true, exhaustion: 0 },
  indirect_magic: { bypassArmor: true, noKnockback: true, exhaustion: 0 },
  withering: { bypassArmor: true, noKnockback: true, exhaustion: 0 },
  lightning_bolt: { exhaustion: 0.1 },
  freeze: { noKnockback: true, exhaustion: 0 },
  stalagmite: { bypassArmor: true, isFall: true, noKnockback: true, exhaustion: 0 },
  falling_block: { exhaustion: 0.1 },
  falling_anvil: { exhaustion: 0.1 },
  falling_stalactite: { exhaustion: 0.1 },
  dragon_breath: { bypassArmor: true, noKnockback: true, exhaustion: 0 },
  mob_attack: { scalesWithDifficulty: true, exhaustion: 0.1 },
  mob_attack_no_aggro: { scalesWithDifficulty: true, exhaustion: 0.1 },
  player_attack: { exhaustion: 0.1 },
  arrow: { isProjectile: true, exhaustion: 0.1 },
  trident: { isProjectile: true, exhaustion: 0.1 },
  thrown: { isProjectile: true, exhaustion: 0.1 },
  mob_projectile: { isProjectile: true, scalesWithDifficulty: true, exhaustion: 0.1 },
  fireball: { isProjectile: true, isFire: true, scalesWithDifficulty: true, exhaustion: 0.1 },
  blight_skull: { isProjectile: true, scalesWithDifficulty: true, exhaustion: 0.1 },
  explosion: { isExplosion: true, scalesWithDifficulty: true, exhaustion: 0.1 },
  player_explosion: { isExplosion: true, scalesWithDifficulty: true, exhaustion: 0.1 },
  firework: { isExplosion: true, exhaustion: 0.1 },
  sonic_boom: { bypassArmor: true, bypassEffects: true, exhaustion: 0 },
  thorns: { exhaustion: 0.1 },
  mace_smash: { exhaustion: 0.1 },
  bad_respawn_point: { isExplosion: true, exhaustion: 0.1 },
  wind_charge: { exhaustion: 0.1 },
  sting: { exhaustion: 0.1 },
  ender_pearl: { bypassArmor: true, isFall: true, exhaustion: 0 },
  dry_out: { noKnockback: true, exhaustion: 0 },
};

export function damageInfo(type: string): DamageTypeInfo {
  return DAMAGE_TYPES[type] ?? DAMAGE_TYPES.generic!;
}

/** Reference armor formula. */
export function applyArmor(damage: number, armor: number, toughness: number): number {
  const f = 2 + toughness / 4;
  const eff = Math.max(0, Math.min(20, Math.max(armor / 5, armor - damage / f)));
  return damage * (1 - eff / 25);
}

/** Enchantment protection factor reduction (EPF capped at 20 → 80%). */
export function applyProtection(damage: number, epf: number): number {
  const e = Math.max(0, Math.min(20, epf));
  return damage * (1 - e / 25);
}

/** Difficulty scaling for mob damage to players. */
export function scaleByDifficulty(damage: number, difficulty: number): number {
  if (difficulty === 0) return 0;
  if (difficulty === 1) return Math.min(damage / 2 + 1, damage);
  if (difficulty === 3) return damage * 1.5;
  return damage;
}

// ---------------------------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------------------------

export interface FoodData {
  food: number;
  saturation: number;
  exhaustion: number;
  timer: number;
}

export function newFoodData(): FoodData {
  return { food: 20, saturation: 5, exhaustion: 0, timer: 0 };
}

export function eatFood(f: FoodData, nutrition: number, saturation: number): void {
  f.food = Math.min(20, f.food + nutrition);
  f.saturation = Math.min(f.food, f.saturation + saturation);
}

export function addExhaustion(f: FoodData, amount: number): void {
  f.exhaustion = Math.min(40, f.exhaustion + amount);
}

// ---------------------------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------------------------

export interface Experience {
  level: number;
  /** Progress to next level 0..1. */
  progress: number;
  total: number;
  /** Enchanting seed. */
  seed: number;
}

export function xpNeeded(level: number): number {
  if (level >= 30) return 112 + (level - 30) * 9;
  if (level >= 15) return 37 + (level - 15) * 5;
  return 7 + level * 2;
}

export function totalXpForLevel(level: number): number {
  if (level <= 16) return level * level + 6 * level;
  if (level <= 31) return Math.floor(2.5 * level * level - 40.5 * level + 360);
  return Math.floor(4.5 * level * level - 162.5 * level + 2220);
}

export function addXpPoints(x: Experience, points: number): void {
  x.progress += points / xpNeeded(x.level);
  x.total = Math.max(0, Math.min(2147483647, x.total + points));
  while (x.progress < 0) {
    const f = x.progress * xpNeeded(x.level);
    if (x.level > 0) {
      x.level--;
      x.progress = 1 + f / xpNeeded(x.level);
    } else {
      x.level = 0;
      x.progress = 0;
    }
  }
  while (x.progress >= 1) {
    x.progress = (x.progress - 1) * xpNeeded(x.level);
    x.level++;
    x.progress /= xpNeeded(x.level);
  }
}

export function addXpLevels(x: Experience, levels: number): void {
  x.level = Math.max(0, x.level + levels);
  if (x.level === 0) {
    x.progress = 0;
    x.total = 0;
  }
}

/** Experience dropped on death. */
export function deathXp(x: Experience): number {
  return Math.min(x.level * 7, 100);
}

/** Split an amount into orb values like the reference game. */
export function orbValues(amount: number): number[] {
  const sizes = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
  const out: number[] = [];
  let left = amount;
  while (left > 0) {
    const v = sizes.find((s) => s <= left) ?? 1;
    out.push(v);
    left -= v;
  }
  return out;
}
