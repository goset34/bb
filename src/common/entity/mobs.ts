/**
 * Mob types known to both client and server: hitbox, eye height, spawn category and spawn egg
 * colours. Behaviour lives in server/mobs, models in client/render/entity/mobs.
 */

export type MobCategory = 'monster' | 'creature' | 'ambient' | 'water_creature' | 'water_ambient' | 'underground_water_creature' | 'axolotls' | 'misc';

export interface MobInfo {
  id: string;
  category: MobCategory;
  width: number;
  height: number;
  eyeHeight?: number;
  /** Spawn egg colours (base, spots); omitted = no egg. */
  egg?: [number, number];
  /** Baby hitbox scale (ageable mobs). */
  baby?: number;
}

export const MOBS = new Map<string, MobInfo>();

function mob(id: string, category: MobCategory, width: number, height: number, egg?: [number, number], extra: Partial<MobInfo> = {}): void {
  MOBS.set(id, { id, category, width, height, egg, ...extra });
}

// ---- Farm and wild animals ------------------------------------------------------------------
mob('pig', 'creature', 0.9, 0.9, [0xe8a3a0, 0xb65a61], { baby: 0.5 });
mob('cow', 'creature', 0.9, 1.4, [0x4a3a2c, 0xc8c2b8], { baby: 0.5, eyeHeight: 1.3 });
mob('mushcow', 'creature', 0.9, 1.4, [0xa01818, 0xc8c2b8], { baby: 0.5, eyeHeight: 1.3 });
mob('sheep', 'creature', 0.9, 1.3, [0xe0dfd8, 0xf2b8a0], { baby: 0.5, eyeHeight: 1.235 });
mob('chicken', 'creature', 0.4, 0.7, [0xd9d9d9, 0xe23030], { baby: 0.5, eyeHeight: 0.644 });
mob('rabbit', 'creature', 0.4, 0.5, [0x9a7650, 0x6c4e2e], { baby: 0.6 });
mob('horse', 'creature', 1.3964844, 1.6, [0xb88b58, 0xe8d2a4], { baby: 0.5, eyeHeight: 1.52 });
mob('donkey', 'creature', 1.3964844, 1.5, [0x6a5a4c, 0x3a3028], { baby: 0.5 });
mob('mule', 'creature', 1.3964844, 1.6, [0x3c2a1e, 0x5e3e24], { baby: 0.5 });
mob('skeleton_horse', 'creature', 1.3964844, 1.6, [0x7a7a64, 0xe0e0cc]);
mob('zombie_horse', 'creature', 1.3964844, 1.6, [0x2e4a2a, 0x96b67a]);
mob('llama', 'creature', 0.9, 1.87, [0xc4aa80, 0x98744c], { baby: 0.5, eyeHeight: 1.7 });
mob('camel', 'creature', 1.7, 2.375, [0xd0a868, 0xa87c44], { baby: 0.45, eyeHeight: 2.275 });
mob('cat', 'creature', 0.6, 0.7, [0xecc48c, 0x7a5a3c], { baby: 0.5 });
mob('ocelot', 'creature', 0.6, 0.7, [0xe8d078, 0x5a4a2c], { baby: 0.5 });
mob('wolf', 'creature', 0.6, 0.85, [0xd6d6d6, 0xc0a890], { baby: 0.5, eyeHeight: 0.68 });
mob('fox', 'creature', 0.6, 0.7, [0xd06a2c, 0xf2ecdc], { baby: 0.5, eyeHeight: 0.4 });
mob('parrot', 'creature', 0.5, 0.9, [0x1ab01a, 0xf01010], { eyeHeight: 0.54 });
mob('turtle', 'creature', 1.2, 0.4, [0xe8e8d0, 0x4a8a3c], { baby: 0.3 });
mob('panda', 'creature', 1.3, 1.25, [0xecece6, 0x1c1c1c], { baby: 0.5 });
mob('polar_bear', 'creature', 1.4, 1.4, [0xf0f0e8, 0x959590], { baby: 0.5 });
mob('bee', 'creature', 0.7, 0.6, [0xecc030, 0x3a2412], { baby: 0.5, eyeHeight: 0.3 });
mob('goat', 'creature', 0.9, 1.3, [0xa89c8c, 0x5a524a], { baby: 0.5 });
mob('frog', 'creature', 0.5, 0.5, [0xc07840, 0x7a5a3a]);
mob('tadpole', 'water_creature', 0.4, 0.3, [0x6a4c30, 0x2c2014]);
mob('sniffer', 'creature', 1.9, 1.75, [0x8a2c20, 0x2a9a6c], { baby: 0.5, eyeHeight: 1.05 });
mob('armadillo', 'creature', 0.7, 0.65, [0xaa6a64, 0x5e3a38], { baby: 0.6, eyeHeight: 0.26 });
mob('bat', 'ambient', 0.5, 0.9, [0x4a3c2c, 0x0c0c0c], { eyeHeight: 0.45 });

// ---- Aquatic ------------------------------------------------------------------------------
mob('squid', 'water_creature', 0.8, 0.8, [0x243c50, 0x6a7a8c], { eyeHeight: 0.4 });
mob('glow_squid', 'underground_water_creature', 0.8, 0.8, [0x0a5a5a, 0x7af0c8], { eyeHeight: 0.4 });
mob('cod', 'water_ambient', 0.5, 0.3, [0xbca47c, 0xe2d2a4], { eyeHeight: 0.195 });
mob('salmon', 'water_ambient', 0.7, 0.4, [0xa0282a, 0x3e6a4c], { eyeHeight: 0.26 });
mob('pufferfish', 'water_ambient', 0.7, 0.7, [0xf0c020, 0x3aa0c0], { eyeHeight: 0.455 });
mob('tropical_fish', 'water_ambient', 0.5, 0.4, [0xf06a1c, 0xfaf0e0], { eyeHeight: 0.26 });
mob('dolphin', 'water_creature', 0.9, 0.6, [0x243c5c, 0xf0f0f0], { baby: 0.65, eyeHeight: 0.3 });
mob('axolotl', 'axolotls', 0.75, 0.42, [0xf4a0c0, 0xa82060], { baby: 0.5, eyeHeight: 0.273 });
mob('guardian', 'monster', 0.85, 0.85, [0x5a8a7a, 0xf07a2a], { eyeHeight: 0.425 });
mob('elder_guardian', 'monster', 1.9975, 1.9975, [0xcec8b0, 0x7a7090], { eyeHeight: 0.999 });

// ---- Golems and helpers --------------------------------------------------------------------
mob('iron_golem', 'misc', 1.4, 2.7, [0xd8d0c4, 0x6a8a4c], { eyeHeight: 2.43 });
mob('snow_golem', 'misc', 0.7, 1.9, [0xf2f8fa, 0xe28a2c], { eyeHeight: 1.7 });
mob('allay', 'creature', 0.35, 0.6, [0x40d0ff, 0x80e0ff], { eyeHeight: 0.36 });

// ---- Hostile -------------------------------------------------------------------------------
mob('zombie', 'monster', 0.6, 1.95, [0x2e6a4c, 0x7a9a5a], { baby: 0.5, eyeHeight: 1.74 });
mob('husk', 'monster', 0.6, 1.95, [0x7a6c4c, 0xd0b87a], { baby: 0.5, eyeHeight: 1.74 });
mob('drowned', 'monster', 0.6, 1.95, [0x5ab0a8, 0x7a6a3c], { baby: 0.5, eyeHeight: 1.74 });
mob('skeleton', 'monster', 0.6, 1.99, [0xc4c4c4, 0x484848], { eyeHeight: 1.74 });
mob('stray', 'monster', 0.6, 1.99, [0x607676, 0xdce8e8], { eyeHeight: 1.74 });
mob('bogged', 'monster', 0.6, 1.99, [0x8aa06a, 0x4e3c2e], { eyeHeight: 1.74 });
mob('hisser', 'monster', 0.6, 1.7, [0x14b02a, 0x0a0a0a], { eyeHeight: 1.445 });
mob('spider', 'monster', 1.4, 0.9, [0x362a24, 0xa00a0a], { eyeHeight: 0.65 });
mob('cave_spider', 'monster', 0.7, 0.5, [0x0c3c4a, 0xa00a0a], { eyeHeight: 0.45 });
mob('voidwalker', 'monster', 0.6, 2.9, [0x161616, 0x2c0a38], { eyeHeight: 2.55 });
mob('voidmite', 'monster', 0.4, 0.3, [0x161616, 0x5a3a6a], { eyeHeight: 0.13 });
mob('slime', 'monster', 0.52, 0.52, [0x52a042, 0x7ec068]);
mob('phantom', 'monster', 0.9, 0.5, [0x46528a, 0x88ff00], { eyeHeight: 0.175 });
mob('silverfish', 'monster', 0.4, 0.3, [0x6a6a6a, 0x303030], { eyeHeight: 0.13 });
mob('echo_warden', 'monster', 0.9, 2.9, [0x0f4648, 0x39d6e0], { eyeHeight: 2.55 });
mob('gustling', 'monster', 0.6, 1.77, [0xa3a8e0, 0xe8e8ff], { eyeHeight: 1.3452 });
mob('groaner', 'monster', 0.9, 2.7, [0x5f5f5f, 0xfc7812], { eyeHeight: 2.3 });

/** Spawn egg item id of a mob. */
export function spawnEggOf(id: string): string {
  return `${id}_spawn_egg`;
}

export function mobInfo(id: string): MobInfo | undefined {
  return MOBS.get(id);
}
