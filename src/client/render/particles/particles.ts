/**
 * Client particle engine: simple physics particles drawn as camera-facing billboards through the
 * entity render layer. Sprites come from a procedurally painted sheet (smoke, sparks, bubbles,
 * hearts…) or from block textures (breaking / landing / eating debris).
 */
import type { ClientLevel } from '../../world';
import type { EntityMesh } from '../entity/mesh';
import { TEX_SKIN, TEX_EMISSIVE } from '../entity/mesh';
import { EntityTextures, ENTITY_TEX, registerEntityTexture, EntityCanvas } from '../entity/textures';
import { getCollisionShape, stateFlags, F, getRenderShape } from '../../../common/block/registry';
import { Random } from '../../../common/math/random';
import type { AtlasData } from '../textures/atlas';
import { itemTintColor } from '../entity/itemmodel';
import { biome, grassColor, foliageColor } from '../../../common/worldgen/biomes';

/** Sheet cells (16×16 px, 8 per row). */
export const CELL = {
  smoke: 0, // 0..7 frames
  sparkle: 8, crit: 9, magic: 10, heart: 11, angry: 12, note: 13, bubble: 14, splash: 15,
  flame: 16, soulFlame: 17, lava: 18, drip: 19, dust: 20, ash: 21, snow: 22, glow: 23,
  effect: 24, // 24..31 swirl frames
  sweep: 32, // 32..35
  totem: 36, happy: 37, spark: 38, poof: 39, // 39..43 poof frames
  explosion: 48, // 48..55
} as const;

export interface Particle {
  x: number; y: number; z: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  size: number;
  gravity: number;
  friction: number;
  collide: boolean;
  onGround: boolean;
  r: number; g: number; b: number;
  /** Sheet cell (frames advance over life when `frames` > 1) or -1 for block texture. */
  cell: number;
  frames: number;
  /** Block texture layer and sub-rectangle (block debris). */
  layer: number;
  u0: number; v0: number; u1: number; v1: number;
  emissive: boolean;
  /** Size shrinks / fades towards the end. */
  shrink: boolean;
}

const MAX_PARTICLES = 6000;

export class ParticleEngine {
  readonly list: Particle[] = [];
  private readonly rng = new Random(1234);
  /** Particle level setting: 0 all, 1 decreased, 2 minimal. */
  level = 0;

  constructor(private readonly world: ClientLevel, private readonly atlas: AtlasData) {}

  private base(x: number, y: number, z: number, vx: number, vy: number, vz: number): Particle {
    return {
      x, y, z, px: x, py: y, pz: z, vx, vy, vz, age: 0, life: 20, size: 0.1, gravity: 0, friction: 0.98, collide: true, onGround: false,
      r: 1, g: 1, b: 1, cell: CELL.smoke, frames: 1, layer: 0, u0: 0, v0: 0, u1: 1, v1: 1, emissive: false, shrink: false,
    };
  }

  add(p: Particle): void {
    if (this.level === 2 && this.rng.nextInt(10) !== 0) return;
    if (this.level === 1 && this.rng.nextInt(3) === 0) return;
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push(p);
  }

  clear(): void {
    this.list.length = 0;
  }

  // ------------------------------------------------------------------------------------------
  // Spawners
  // ------------------------------------------------------------------------------------------

  /** Texture layer, tint and a random 4×4-texel sub-rectangle of a block state's particle face. */
  private blockSprite(state: number, p: Particle): boolean {
    const r = getRenderShape(state);
    let tex: string | null = null, tint = 0;
    if (r.kind === 'cube') { tex = r.tex[2]; tint = r.tint?.[2] ?? 0; }
    else if (r.kind === 'model') {
      const f = r.elements[0]?.faces;
      const face = f ? f[2] ?? f[1] ?? Object.values(f)[0] : undefined;
      tex = face?.tex ?? null;
      tint = face?.tint ?? 0;
    } else if (r.kind === 'liquid') tex = r.still;
    if (!tex) return false;
    p.layer = (this.atlas.index[tex] ?? 0) & 0xfff;
    const u = this.rng.nextInt(12) / 16, v = this.rng.nextInt(12) / 16;
    p.u0 = u; p.v0 = v; p.u1 = u + 4 / 16; p.v1 = v + 4 / 16;
    p.cell = -1;
    const plains = biome('plains');
    const col = tint ? (tint === 1 ? grassColor(plains) : tint === 2 ? foliageColor(plains) : itemTintColor(tint)) : 0xffffff;
    p.r = ((col >> 16) & 255) / 255 * 0.6; p.g = ((col >> 8) & 255) / 255 * 0.6; p.b = (col & 255) / 255 * 0.6;
    if (col === 0xffffff) { p.r = p.g = p.b = 0.6; }
    return true;
  }

  /** Block broken: 4×4×4 debris particles. */
  blockBreak(x: number, y: number, z: number, state: number): void {
    if (stateFlags[state]! & F.AIR) return;
    const shape = getCollisionShape(state);
    const [x0, y0, z0, x1, y1, z1] = shape.length ? [shape[0]!, shape[1]!, shape[2]!, shape[3]!, shape[4]!, shape[5]!] : [0, 0, 0, 1, 1, 1];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
      const fx = (i + 0.5) / 4, fy = (j + 0.5) / 4, fz = (k + 0.5) / 4;
      const px = x + x0 + (x1 - x0) * fx, py = y + y0 + (y1 - y0) * fy, pz = z + z0 + (z1 - z0) * fz;
      const p = this.base(px, py, pz, fx - 0.5, fy - 0.5, fz - 0.5);
      if (!this.blockSprite(state, p)) return;
      const s = (this.rng.nextFloat() + this.rng.nextFloat() + 1) * 0.15;
      p.vx = p.vx * s * 0.4 + (this.rng.nextFloat() - 0.5) * 0.08;
      p.vy = p.vy * s * 0.4 + 0.1 + this.rng.nextFloat() * 0.05;
      p.vz = p.vz * s * 0.4 + (this.rng.nextFloat() - 0.5) * 0.08;
      p.gravity = 0.04;
      p.life = Math.floor(4 / (this.rng.nextFloat() * 0.9 + 0.1));
      p.size = 0.1 * (this.rng.nextFloat() * 0.5 + 0.5) * 2 * 0.5;
      this.add(p);
    }
  }

  /** Hitting a block face while mining. */
  blockHit(x: number, y: number, z: number, face: number, state: number): void {
    const n = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][face]!;
    const px = x + 0.5 + n[0]! * 0.55 + (n[0] === 0 ? (this.rng.nextFloat() - 0.5) * 0.9 : 0);
    const py = y + 0.5 + n[1]! * 0.55 + (n[1] === 0 ? (this.rng.nextFloat() - 0.5) * 0.9 : 0);
    const pz = z + 0.5 + n[2]! * 0.55 + (n[2] === 0 ? (this.rng.nextFloat() - 0.5) * 0.9 : 0);
    const p = this.base(px, py, pz, (this.rng.nextFloat() - 0.5) * 0.04, 0.02, (this.rng.nextFloat() - 0.5) * 0.04);
    if (!this.blockSprite(state, p)) return;
    p.gravity = 0.04;
    p.life = 10 + this.rng.nextInt(10);
    p.size = 0.05 + this.rng.nextFloat() * 0.03;
    this.add(p);
  }

  /** Landing dust after a fall (reference: count grows with fall distance). */
  landing(x: number, y: number, z: number, state: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.base(x + (this.rng.nextFloat() - 0.5) * 0.8, y + 1.05, z + (this.rng.nextFloat() - 0.5) * 0.8, (this.rng.nextFloat() - 0.5) * 0.3, 0.15 + this.rng.nextFloat() * 0.1, (this.rng.nextFloat() - 0.5) * 0.3);
      if (!this.blockSprite(state, p)) return;
      p.gravity = 0.04;
      p.life = 8 + this.rng.nextInt(8);
      p.size = 0.05 + this.rng.nextFloat() * 0.04;
      this.add(p);
    }
  }

  /** Item debris (eating, item breaking) using the item's atlas sprite. */
  itemDebris(x: number, y: number, z: number, itemLayer: number, count: number, spread = 0.1): void {
    for (let i = 0; i < count; i++) {
      const p = this.base(x, y, z, (this.rng.nextFloat() - 0.5) * spread, 0.1 + this.rng.nextFloat() * 0.1, (this.rng.nextFloat() - 0.5) * spread);
      p.layer = itemLayer;
      const u = this.rng.nextInt(12) / 16, v = this.rng.nextInt(12) / 16;
      p.u0 = u; p.v0 = v; p.u1 = u + 4 / 16; p.v1 = v + 4 / 16;
      p.cell = -1;
      p.gravity = 0.04;
      p.life = 10 + this.rng.nextInt(8);
      p.size = 0.06;
      this.add(p);
    }
  }

  /** Generic sheet particle. */
  sheet(cell: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, opts: Partial<Particle> = {}): void {
    const p = this.base(x, y, z, vx, vy, vz);
    p.cell = cell;
    Object.assign(p, opts);
    this.add(p);
  }

  /** Spawn a named particle type (server `particles` packets, level events, effects). */
  spawn(type: string, x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, count: number, data = 0): void {
    const r = this.rng;
    const n = Math.max(1, count);
    for (let i = 0; i < n; i++) {
      const ox = count === 0 ? 0 : r.nextGaussian() * dx, oy = count === 0 ? 0 : r.nextGaussian() * dy, oz = count === 0 ? 0 : r.nextGaussian() * dz;
      const vx = count === 0 ? dx * speed : r.nextGaussian() * speed, vy = count === 0 ? dy * speed : r.nextGaussian() * speed, vz = count === 0 ? dz * speed : r.nextGaussian() * speed;
      const px = x + ox, py = y + oy, pz = z + oz;
      switch (type) {
        case 'smoke': case 'large_smoke': case 'campfire_smoke':
          this.sheet(CELL.smoke, px, py, pz, vx * 0.1, vy * 0.1 + 0.01, vz * 0.1, { frames: 8, life: type === 'campfire_smoke' ? 200 : 8 + r.nextInt(12), size: type === 'smoke' ? 0.1 : 0.25, gravity: -0.002, collide: false, r: 0.3, g: 0.3, b: 0.3, shrink: false, friction: 0.96 });
          break;
        case 'white_smoke': case 'cloud': case 'poof':
          this.sheet(CELL.smoke, px, py, pz, vx, vy, vz, { frames: 8, life: 8 + r.nextInt(10), size: 0.2, collide: false, r: 0.9, g: 0.9, b: 0.9, friction: 0.96 });
          break;
        case 'crit': case 'enchanted_hit':
          this.sheet(type === 'crit' ? CELL.crit : CELL.magic, px, py, pz, vx, vy + 0.1, vz, { life: 12 + r.nextInt(6), size: 0.1, gravity: 0.04, r: type === 'crit' ? 1 : 0.75, g: type === 'crit' ? 1 : 0.45, b: 1, shrink: true, friction: 0.7 });
          break;
        case 'sweep_attack':
          this.sheet(CELL.sweep, px, py, pz, 0, 0, 0, { frames: 4, life: 4, size: 1.0, collide: false, emissive: true });
          break;
        case 'heart':
          this.sheet(CELL.heart, px, py, pz, 0, 0.1, 0, { life: 16, size: 0.15, gravity: -0.002, collide: false, emissive: true, friction: 0.86 });
          break;
        case 'angry_villager':
          this.sheet(CELL.angry, px, py, pz, 0, 0.1, 0, { life: 16, size: 0.15, collide: false });
          break;
        case 'happy_villager': case 'composter':
          this.sheet(CELL.happy, px, py, pz, vx, vy, vz, { life: 16 + r.nextInt(8), size: 0.08, collide: false, emissive: true, r: type === 'composter' ? 0.8 : 0.5, g: 1, b: type === 'composter' ? 0.5 : 0.5 });
          break;
        case 'note':
          this.sheet(CELL.note, px, py, pz, 0, 0.2, 0, { life: 6, size: 0.15, collide: false, emissive: true, r: Math.max(0, Math.sin((data / 24) * Math.PI * 2)) * 0.65 + 0.35, g: Math.max(0, Math.sin((data / 24 + 0.33) * Math.PI * 2)) * 0.65 + 0.35, b: Math.max(0, Math.sin((data / 24 + 0.67) * Math.PI * 2)) * 0.65 + 0.35, friction: 0.66 });
          break;
        case 'bubble': case 'bubble_column_up': case 'current_down':
          this.sheet(CELL.bubble, px, py, pz, vx * 0.2, type === 'current_down' ? -0.05 : 0.02 + r.nextFloat() * 0.05, vz * 0.2, { life: 8 + r.nextInt(24), size: 0.05, gravity: -0.002, collide: false, friction: 0.85 });
          break;
        case 'splash': case 'rain': case 'fishing':
          this.sheet(CELL.splash, px, py, pz, vx, 0.1 + r.nextFloat() * 0.2, vz, { life: 8 + r.nextInt(8), size: 0.05, gravity: 0.06, r: 0.35, g: 0.5, b: 1 });
          break;
        case 'flame': case 'small_flame': case 'soul_fire_flame': case 'copper_fire_flame':
          this.sheet(type === 'soul_fire_flame' ? CELL.soulFlame : CELL.flame, px, py, pz, vx * 0.1, vy * 0.1, vz * 0.1, { life: 8 + r.nextInt(4), size: type === 'small_flame' ? 0.05 : 0.08, collide: false, emissive: true, shrink: true, friction: 0.96, r: type === 'copper_fire_flame' ? 0.5 : 1, g: 1, b: 1 });
          break;
        case 'lava':
          this.sheet(CELL.lava, px, py, pz, (r.nextFloat() - 0.5) * 0.2, r.nextFloat() * 0.4 + 0.05, (r.nextFloat() - 0.5) * 0.2, { life: 16 + r.nextInt(16), size: 0.08, gravity: 0.06, emissive: true, shrink: true });
          break;
        case 'dripping_water': case 'dripping_lava': case 'dripping_honey':
          this.sheet(CELL.drip, px, py, pz, 0, 0, 0, { life: 40, size: 0.04, gravity: 0.02, r: type === 'dripping_water' ? 0.25 : 1, g: type === 'dripping_water' ? 0.4 : type === 'dripping_honey' ? 0.75 : 0.35, b: type === 'dripping_water' ? 1 : 0.1, emissive: type === 'dripping_lava' });
          break;
        case 'dust':
          this.sheet(CELL.dust, px, py, pz, vx * 0.1, vy * 0.1, vz * 0.1, { life: 8 + r.nextInt(8), size: 0.08, collide: false, r: ((data >> 16) & 255) / 255 || 1, g: ((data >> 8) & 255) / 255, b: (data & 255) / 255, shrink: true });
          break;
        case 'ash': case 'white_ash':
          this.sheet(CELL.ash, px, py, pz, (r.nextFloat() - 0.5) * 0.02, -0.01, (r.nextFloat() - 0.5) * 0.02, { life: 40 + r.nextInt(40), size: 0.04, gravity: 0.001, r: type === 'ash' ? 0.3 : 0.9, g: type === 'ash' ? 0.3 : 0.9, b: type === 'ash' ? 0.3 : 0.9 });
          break;
        case 'snowflake':
          this.sheet(CELL.snow, px, py, pz, vx, vy, vz, { life: 30 + r.nextInt(20), size: 0.06, gravity: 0.004 });
          break;
        case 'end_rod': case 'glow': case 'electric_spark': case 'wax_on': case 'wax_off': case 'scrape':
          this.sheet(type === 'electric_spark' || type === 'scrape' || type.startsWith('wax') ? CELL.spark : CELL.glow, px, py, pz, vx, vy, vz, {
            life: 20 + r.nextInt(20), size: 0.06, collide: false, emissive: true, shrink: true, friction: 0.9,
            r: type === 'wax_on' ? 0.95 : type === 'wax_off' || type === 'scrape' ? 0.7 : 1, g: type === 'wax_on' ? 0.75 : type === 'scrape' ? 1 : 1, b: type === 'wax_on' ? 0.3 : type === 'scrape' ? 0.9 : 1,
          });
          break;
        case 'totem_of_undying':
          this.sheet(CELL.totem, px, py, pz, vx, vy, vz, { life: 60 + r.nextInt(12), size: 0.12, gravity: 0.01, emissive: true, shrink: true, friction: 0.6, r: r.nextFloat() < 0.5 ? 0.6 + r.nextFloat() * 0.2 : 0.1 + r.nextFloat() * 0.2, g: 0.4 + r.nextFloat() * 0.3, b: r.nextFloat() * 0.2 });
          break;
        case 'effect': case 'entity_effect': case 'instant_effect': case 'witch': {
          const col = data || 0x9966ff;
          this.sheet(CELL.effect, px, py, pz, vx * 0.1, 0.02 + vy * 0.1, vz * 0.1, { frames: 8, life: 8 + r.nextInt(16), size: 0.08, gravity: -0.002, collide: false, r: ((col >> 16) & 255) / 255, g: ((col >> 8) & 255) / 255, b: (col & 255) / 255, friction: 0.96 });
          break;
        }
        case 'explosion': case 'explosion_emitter':
          this.sheet(CELL.explosion, px, py, pz, 0, 0, 0, { frames: 8, life: 6 + r.nextInt(4), size: type === 'explosion' ? 1.0 + r.nextFloat() : 2.0, collide: false, emissive: true });
          break;
        case 'portal': case 'reverse_portal':
          this.sheet(CELL.magic, px, py, pz, vx, vy, vz, { life: 40, size: 0.08, collide: false, emissive: true, r: 0.6, g: 0.25, b: 0.9, friction: 1 });
          break;
        default:
          this.sheet(CELL.sparkle, px, py, pz, vx, vy, vz, { life: 20, size: 0.08, collide: false });
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Simulation and rendering
  // ------------------------------------------------------------------------------------------

  tick(): void {
    const w = this.world;
    let j = 0;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i]!;
      p.px = p.x; p.py = p.y; p.pz = p.z;
      if (++p.age >= p.life) continue;
      p.vy -= p.gravity;
      let nx = p.x + p.vx, ny = p.y + p.vy, nz = p.z + p.vz;
      if (p.collide) {
        const s = w.getBlockState(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (!(stateFlags[s]! & F.NO_COLLISION) && inShape(s, nx, ny, nz)) {
          // Stop on the surface (vertical) or slide (horizontal)
          if (p.vy < 0 && !inShape(w.getBlockState(Math.floor(nx), Math.floor(p.y), Math.floor(nz)), nx, p.y, nz)) { ny = p.y; p.vy = 0; p.onGround = true; }
          else { nx = p.x; nz = p.z; p.vx = 0; p.vz = 0; }
        }
      }
      p.x = nx; p.y = ny; p.z = nz;
      p.vx *= p.friction; p.vy *= p.friction; p.vz *= p.friction;
      if (p.onGround) { p.vx *= 0.7; p.vz *= 0.7; }
      this.list[j++] = p;
    }
    this.list.length = j;
  }

  /** Emit billboards into the mesh (camera-relative). */
  render(mesh: EntityMesh, textures: EntityTextures, cam: [number, number, number], right: [number, number, number], up: [number, number, number], partial: number): void {
    const sheet = textures.layer('particles');
    for (const p of this.list) {
      const x = p.px + (p.x - p.px) * partial - cam[0];
      const y = p.py + (p.y - p.py) * partial - cam[1];
      const z = p.pz + (p.z - p.pz) * partial - cam[2];
      if (x * x + y * y + z * z > 4096) continue;
      const t = (p.age + partial) / p.life;
      let size = p.size * 2;
      if (p.shrink) size *= Math.max(0.1, 1 - t * t);
      const l = this.world.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      mesh.sky = (l >> 4) / 15;
      mesh.block = (l & 15) / 15;
      mesh.hurt = 0;
      mesh.r = Math.min(255, p.r * 255) | 0; mesh.g = Math.min(255, p.g * 255) | 0; mesh.b = Math.min(255, p.b * 255) | 0; mesh.a = 255;
      let u0: number, v0: number, u1: number, v1: number;
      if (p.cell < 0) {
        mesh.layer = p.layer;
        mesh.flags = p.emissive ? TEX_EMISSIVE : 0;
        u0 = p.u0; v0 = p.v0; u1 = p.u1; v1 = p.v1;
      } else {
        const cell = p.cell + (p.frames > 1 ? Math.min(p.frames - 1, Math.floor(t * p.frames)) : 0);
        mesh.layer = sheet;
        mesh.flags = TEX_SKIN | (p.emissive ? TEX_EMISSIVE : 0);
        u0 = ((cell % 8) * 16) / ENTITY_TEX; v0 = (Math.floor(cell / 8) * 16) / ENTITY_TEX;
        u1 = u0 + 16 / ENTITY_TEX; v1 = v0 + 16 / ENTITY_TEX;
      }
      mesh.push();
      mesh.translate(x, y, z);
      mesh.billboard(size, right, up, u0, v0, u1, v1, 1);
      mesh.pop();
    }
  }
}

function inShape(state: number, x: number, y: number, z: number): boolean {
  const s = getCollisionShape(state);
  const lx = x - Math.floor(x), ly = y - Math.floor(y), lz = z - Math.floor(z);
  for (let i = 0; i < s.length; i += 6) {
    if (lx >= s[i]! && lx <= s[i + 3]! && ly >= s[i + 1]! && ly <= s[i + 4]! && lz >= s[i + 2]! && lz <= s[i + 5]!) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Particle sheet (procedural)
// ---------------------------------------------------------------------------------------------

function cellOrigin(cell: number): [number, number] {
  return [(cell % 8) * 16, Math.floor(cell / 8) * 16];
}

function disc(c: EntityCanvas, cell: number, cx: number, cy: number, r: number, color: (d: number, x: number, y: number) => [number, number, number, number] | null): void {
  const [ox, oy] = cellOrigin(cell);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
    if (d > 1) continue;
    const col = color(d, x, y);
    if (col) c.px(ox + x, oy + y, [col[0], col[1], col[2]], col[3]);
  }
}

function glyph(c: EntityCanvas, cell: number, rows: string[], pal: Record<string, [number, number, number]>): void {
  const [ox, oy] = cellOrigin(cell);
  const h = rows.length, w = rows[0]!.length;
  const sx = Math.floor((16 - w) / 2), sy = Math.floor((16 - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = pal[rows[y]![x]!];
    if (col) c.px(ox + sx + x, oy + sy + y, col, 255);
  }
}

function paintParticles(c: EntityCanvas): void {
  c.clear(0, 0, ENTITY_TEX, ENTITY_TEX);
  // Smoke puffs: 8 frames shrinking (white; tinted per particle)
  for (let f = 0; f < 8; f++) {
    const r = 7 - f * 0.75;
    disc(c, CELL.smoke + f, 8, 8, r, (d, x, y) => (c.noise(x + f * 16, y) < 0.15 + d * 0.5 ? null : [230 - d * 60, 230 - d * 60, 230 - d * 60, 255]));
  }
  const W: [number, number, number] = [255, 255, 255];
  glyph(c, CELL.sparkle, ['..#..', '..#..', '#####', '..#..', '..#..'], { '#': W });
  glyph(c, CELL.crit, ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'], { '#': W });
  glyph(c, CELL.magic, ['#.#.#', '.###.', '#####', '.###.', '#.#.#'], { '#': W });
  glyph(c, CELL.heart, ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'], { '#': [230, 40, 60] });
  glyph(c, CELL.angry, ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'], { '#': [90, 30, 30] });
  glyph(c, CELL.note, ['..###', '..#.#', '..#..', '..#..', '###..', '###..'], { '#': W });
  disc(c, CELL.bubble, 8, 8, 4, (d, x, y) => (d > 0.7 ? [200, 230, 255, 255] : x < 7 && y < 7 ? [255, 255, 255, 255] : null));
  glyph(c, CELL.splash, ['.#.', '###', '.#.'], { '#': W });
  disc(c, CELL.flame, 8, 9, 5, (d, x, y) => (y < 4 + d * 3 && c.noise(x, y, 3) < 0.5 ? null : d < 0.45 ? [255, 250, 190, 255] : d < 0.75 ? [255, 190, 60, 255] : [230, 100, 20, 255]));
  disc(c, CELL.soulFlame, 8, 9, 5, (d, x, y) => (y < 4 + d * 3 && c.noise(x, y, 4) < 0.5 ? null : d < 0.45 ? [200, 255, 255, 255] : d < 0.75 ? [80, 220, 230, 255] : [40, 140, 170, 255]));
  disc(c, CELL.lava, 8, 8, 3, (d) => (d < 0.6 ? [255, 220, 80, 255] : [230, 90, 20, 255]));
  glyph(c, CELL.drip, ['.#.', '###', '###', '.#.'], { '#': W });
  disc(c, CELL.dust, 8, 8, 3.5, () => [255, 255, 255, 255]);
  glyph(c, CELL.ash, ['##', '##'], { '#': W });
  glyph(c, CELL.snow, ['#.#.#', '.###.', '##.##', '.###.', '#.#.#'], { '#': W });
  disc(c, CELL.glow, 8, 8, 4, (d) => (d < 0.4 ? [255, 255, 255, 255] : [255, 255, 255, 180]));
  for (let f = 0; f < 8; f++) {
    const a0 = f * 0.8;
    const [ox, oy] = cellOrigin(CELL.effect + f);
    for (let i = 0; i < 18; i++) {
      const a = a0 + i * 0.35, r = 1 + i * 0.35;
      c.px(ox + Math.round(8 + Math.cos(a) * r), oy + Math.round(8 + Math.sin(a) * r), W, 255);
    }
  }
  for (let f = 0; f < 4; f++) {
    const [ox, oy] = cellOrigin(CELL.sweep + f);
    for (let i = 0; i < 40; i++) {
      const a = Math.PI * (0.15 + (i / 40) * 0.7);
      for (let t = 0; t < 2; t++) c.px(ox + Math.round(8 + Math.cos(a) * (6 - t - f * 0.5)), oy + Math.round(12 - Math.sin(a) * (6 - t - f * 0.5)), [240 - f * 30, 240 - f * 30, 240 - f * 30], 255);
    }
  }
  glyph(c, CELL.totem, ['.#.', '###', '.#.'], { '#': W });
  glyph(c, CELL.happy, ['..#..', '.###.', '#####', '.###.', '..#..'], { '#': W });
  glyph(c, CELL.spark, ['#.#', '.#.', '#.#'], { '#': W });
  for (let f = 0; f < 8; f++) {
    const r = 3 + f * 0.6;
    disc(c, CELL.explosion + f, 8, 8, r, (d, x, y) => (c.noise(x + f * 7, y + f * 3) < 0.25 + f * 0.07 ? null : d < 0.5 - f * 0.05 ? [255, 240, 200, 255] : [170 - f * 12, 160 - f * 12, 150 - f * 12, 255]));
  }
}

registerEntityTexture('particles', paintParticles);
