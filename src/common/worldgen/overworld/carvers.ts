/**
 * Carvers: winding tunnels with occasional rooms, and deep canyons. Each tunnel system starts in
 * some chunk and is replayed deterministically by every chunk it passes through, so carving
 * works chunk by chunk without neighbours.
 */
import { Random, WorldSeed, chunkRandom, subSeed } from '../../math/random';
import { S, stateFlags, F, hasTag } from '../../block/registry';

const RANGE = 8;
const LAVA_BELOW = -56;

export interface CarverSettings {
  caveChance: number;
  canyonChance: number;
  minY: number;
  maxY: number;
}

interface CarverSystem {
  /** [x, y, z, rh, rv, floor, widthTable] per ellipsoid. */
  ellipsoids: Float64Array;
  count: number;
  widths: Float64Array[];
}

export class Carvers {
  private readonly caveSalt: number;
  private readonly canyonSalt: number;
  private readonly carvable: Uint8Array;
  private readonly air: number;
  private readonly lava: number;
  private readonly water: number;
  private readonly grass: number;
  private readonly dirt: number;
  private readonly mycelium: number;
  private blocks!: Uint16Array;
  private bx = 0;
  private bz = 0;
  private readonly cache = new Map<number, CarverSystem>();
  private out: CarverSystem = { ellipsoids: new Float64Array(0), count: 0, widths: [] };

  constructor(private readonly seed: WorldSeed, readonly minY: number, readonly height: number, readonly settings: CarverSettings, stateCount: number) {
    this.caveSalt = subSeed(seed, 'carver/cave');
    this.canyonSalt = subSeed(seed, 'carver/canyon');
    this.air = S('air');
    this.lava = S('lava');
    this.water = S('water');
    this.grass = S('grass_block');
    this.dirt = S('dirt');
    this.mycelium = S('mycelium');
    this.carvable = new Uint8Array(stateCount);
    for (let s = 1; s < stateCount; s++) {
      if (hasTag(s, 'carvable') || hasTag(s, 'base_stone') || hasTag(s, 'dirt') || hasTag(s, 'terracotta')) this.carvable[s] = 1;
    }
    for (const n of ['stone', 'deepslate', 'granite', 'diorite', 'andesite', 'tuff', 'calcite', 'dirt', 'coarse_dirt', 'grass_block', 'podzol', 'mycelium',
      'sand', 'red_sand', 'sandstone', 'red_sandstone', 'gravel', 'snow_block', 'powder_snow', 'packed_ice', 'terracotta', 'mud', 'clay',
      'copper_ore', 'deepslate_iron_ore', 'raw_copper_block', 'raw_iron_block']) this.carvable[S(n)] = 1;
  }

  carve(cx: number, cz: number, blocks: Uint16Array): void {
    this.blocks = blocks;
    this.bx = cx << 4;
    this.bz = cz << 4;
    const bx = this.bx, bz = this.bz;
    for (let oz = cz - RANGE; oz <= cz + RANGE; oz++) {
      for (let ox = cx - RANGE; ox <= cx + RANGE; ox++) {
        const sys = this.system(ox, oz);
        const e = sys.ellipsoids;
        for (let i = 0; i < sys.count; i++) {
          const o = i * 7;
          const x = e[o]!, z = e[o + 2]!, rh = e[o + 3]!;
          if (x + rh < bx - 1 || x - rh > bx + 17 || z + rh < bz - 1 || z - rh > bz + 17) continue;
          const table = e[o + 6]!;
          this.ellipsoid(x, e[o + 1]!, z, rh, e[o + 4]!, e[o + 5]!, table >= 0 ? sys.widths[table]! : null);
        }
      }
    }
  }

  /** Tunnel and canyon ellipsoids starting in chunk (ox, oz), cached per chunk. */
  private system(ox: number, oz: number): CarverSystem {
    const k = ox * 0x100000 + oz;
    let sys = this.cache.get(k);
    if (sys) return sys;
    this.out = { ellipsoids: new Float64Array(64 * 7), count: 0, widths: [] };
    const r1 = chunkRandom(this.seed, ox, oz, this.caveSalt);
    if (r1.nextFloat() < this.settings.caveChance) this.caveSystem(r1, ox, oz);
    const r2 = chunkRandom(this.seed, ox, oz, this.canyonSalt);
    if (r2.nextFloat() < this.settings.canyonChance) this.canyon(r2, ox, oz);
    sys = this.out;
    this.cache.set(k, sys);
    if (this.cache.size > 4096) this.cache.delete(this.cache.keys().next().value!);
    return sys;
  }

  private emit(x: number, y: number, z: number, rh: number, rv: number, floor: number, table: number): void {
    const out = this.out;
    if ((out.count + 1) * 7 > out.ellipsoids.length) {
      const grown = new Float64Array(out.ellipsoids.length * 2);
      grown.set(out.ellipsoids);
      out.ellipsoids = grown;
    }
    const o = out.count * 7;
    const e = out.ellipsoids;
    e[o] = x; e[o + 1] = y; e[o + 2] = z; e[o + 3] = rh; e[o + 4] = rv; e[o + 5] = floor; e[o + 6] = table;
    out.count++;
  }

  // ------------------------------------------------------------------------------------------
  // Tunnels
  // ------------------------------------------------------------------------------------------

  private caveSystem(r: Random, ox: number, oz: number): void {
    const steps = (RANGE * 2 - 1) * 16;
    const count = r.nextInt(r.nextInt(r.nextInt(15) + 1) + 1);
    const { minY, maxY } = this.settings;
    for (let n = 0; n < count; n++) {
      const x = ox * 16 + r.nextInt(16);
      const y = minY + r.nextInt(r.nextInt(maxY - minY) + 8);
      const z = oz * 16 + r.nextInt(16);
      const hMul = 0.7 + r.nextFloat() * 0.7;
      const vMul = 0.8 + r.nextFloat() * 0.5;
      const floor = -1 + r.nextFloat() * 0.4;
      let tunnels = 1;
      if (r.nextInt(4) === 0) {
        const roomSize = 1 + r.nextFloat() * 6;
        this.room(x + 1, y, z, roomSize, vMul, floor);
        tunnels += r.nextInt(4);
      }
      for (let t = 0; t < tunnels; t++) {
        const yaw = r.nextFloat() * Math.PI * 2;
        const pitch = (r.nextFloat() - 0.5) / 4;
        let thickness = r.nextFloat() * 2 + r.nextFloat();
        if (r.nextInt(10) === 0) thickness *= r.nextFloat() * r.nextFloat() * 3 + 1;
        const end = steps - r.nextInt(steps / 4);
        this.tunnel(r.nextU32(), x, y, z, hMul, vMul, thickness, yaw, pitch, 0, end, 1, floor);
      }
    }
  }

  private room(x: number, y: number, z: number, size: number, vMul: number, floor: number): void {
    const r = 1.5 + size;
    this.emit(x, y, z, r, r * vMul * 0.5, floor, -1);
  }

  private tunnel(seed: number, x: number, y: number, z: number, hMul: number, vMul: number, thickness: number, yaw: number, pitch: number, start: number, end: number, yScale: number, floor: number): void {
    const r = new Random(seed);
    const branch = r.nextInt(end / 2) + end / 4;
    const steep = r.nextInt(6) === 0;
    let dYaw = 0, dPitch = 0;
    for (let step = start; step < end; step++) {
      const rad = 1.5 + Math.sin((Math.PI * step) / end) * thickness;
      const radY = rad * yScale;
      const cp = Math.cos(pitch);
      x += Math.cos(yaw) * cp;
      y += Math.sin(pitch);
      z += Math.sin(yaw) * cp;
      pitch *= steep ? 0.92 : 0.7;
      pitch += dPitch * 0.1;
      yaw += dYaw * 0.1;
      dPitch *= 0.9;
      dYaw *= 0.75;
      dPitch += (r.nextFloat() - r.nextFloat()) * r.nextFloat() * 2;
      dYaw += (r.nextFloat() - r.nextFloat()) * r.nextFloat() * 4;
      if (step === branch && thickness > 1) {
        this.tunnel(r.nextU32(), x, y, z, hMul, vMul, r.nextFloat() * 0.5 + 0.5, yaw - Math.PI / 2, pitch / 3, step, end, 1, floor);
        this.tunnel(r.nextU32(), x, y, z, hMul, vMul, r.nextFloat() * 0.5 + 0.5, yaw + Math.PI / 2, pitch / 3, step, end, 1, floor);
        return;
      }
      if (r.nextInt(4) === 0) continue;
      this.emit(x, y, z, rad * hMul, radY * vMul, floor, -1);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Canyons
  // ------------------------------------------------------------------------------------------

  private canyon(r: Random, ox: number, oz: number): void {
    const x = ox * 16 + r.nextInt(16);
    const y = 10 + r.nextInt(58);
    const z = oz * 16 + r.nextInt(16);
    const yaw = r.nextFloat() * Math.PI * 2;
    const pitch = (r.nextFloat() - 0.5) / 4;
    const thickness = (r.nextFloat() * 2 + r.nextFloat()) * 2;
    const steps = (RANGE * 2 - 1) * 16;
    const end = steps - r.nextInt(steps / 4);
    const yScale = 3;
    const cr = new Random(r.nextU32());
    // Irregular walls: per-height width factors.
    const widths = new Float64Array(this.height);
    let w = 1;
    for (let k = 0; k < widths.length; k++) {
      if (k === 0 || cr.nextInt(3) === 0) w = 1 + cr.nextFloat() * cr.nextFloat();
      widths[k] = w * w;
    }
    const table = this.out.widths.length;
    this.out.widths.push(widths);
    let px = x, py = y, pz = z, cyaw = yaw, cpitch = pitch, dYaw = 0, dPitch = 0;
    for (let step = 0; step < end; step++) {
      const rad = 1.5 + Math.sin((step * Math.PI) / end) * thickness;
      const radY = rad * yScale;
      const cp = Math.cos(cpitch);
      px += Math.cos(cyaw) * cp;
      py += Math.sin(cpitch);
      pz += Math.sin(cyaw) * cp;
      cpitch *= 0.7;
      cpitch += dPitch * 0.05;
      cyaw += dYaw * 0.05;
      dPitch *= 0.8;
      dYaw *= 0.5;
      dPitch += (cr.nextFloat() - cr.nextFloat()) * cr.nextFloat() * 2;
      dYaw += (cr.nextFloat() - cr.nextFloat()) * cr.nextFloat() * 4;
      if (cr.nextInt(4) === 0) continue;
      this.emit(px, py, pz, rad * 0.75 + 1, radY, -1, table);
    }
  }

  // ------------------------------------------------------------------------------------------

  private ellipsoid(x: number, y: number, z: number, rh: number, rv: number, floor: number, widths: Float64Array | null): void {
    const { bx, bz, blocks, minY } = this;
    if (x + rh < bx - 1 || x - rh > bx + 17 || z + rh < bz - 1 || z - rh > bz + 17) return;
    const x0 = Math.max(0, Math.floor(x - rh) - bx - 1), x1 = Math.min(15, Math.floor(x + rh) - bx + 1);
    const z0 = Math.max(0, Math.floor(z - rh) - bz - 1), z1 = Math.min(15, Math.floor(z + rh) - bz + 1);
    const y0 = Math.max(minY + 1, Math.floor(y - rv) - 1), y1 = Math.min(minY + this.height - 8, Math.floor(y + rv) + 1);
    if (x0 > x1 || z0 > z1 || y0 > y1) return;
    // Never carve into water: tunnels stop at seas, rivers and flooded caves.
    for (let lz = z0; lz <= z1; lz++) for (let lx = x0; lx <= x1; lx++) {
      for (let yy = y0; yy <= y1; yy++) {
        const st = blocks[((yy - minY) << 8) | (lz << 4) | lx]!;
        if (st === this.water || (stateFlags[st]! & F.WATER)) {
          const dx = (lx + bx + 0.5 - x) / rh, dz = (lz + bz + 0.5 - z) / rh;
          if (dx * dx + dz * dz < 1.6) return;
        }
      }
    }
    for (let lz = z0; lz <= z1; lz++) {
      const dz = (lz + bz + 0.5 - z) / rh;
      for (let lx = x0; lx <= x1; lx++) {
        const dx = (lx + bx + 0.5 - x) / rh;
        const h2 = dx * dx + dz * dz;
        if (h2 >= 1) continue;
        let exposedGrass = false;
        for (let yy = y1; yy >= y0; yy--) {
          const dy = (yy + 0.5 - y) / rv;
          if (dy <= floor) continue;
          const w = widths ? widths[yy - minY]! : 1;
          if (h2 * w + (widths ? dy * dy / 6 : dy * dy) >= 1) continue;
          const i = ((yy - minY) << 8) | (lz << 4) | lx;
          const st = blocks[i]!;
          if (!this.carvable[st]) continue;
          if (st === this.grass || st === this.mycelium) exposedGrass = true;
          blocks[i] = yy < LAVA_BELOW ? this.lava : this.air;
          // Dirt uncovered below carved grass becomes grass again.
          if (exposedGrass && yy - 1 >= minY) {
            const below = ((yy - 1 - minY) << 8) | (lz << 4) | lx;
            if (blocks[below] === this.dirt) blocks[below] = st === this.mycelium ? this.mycelium : this.grass;
          }
        }
      }
    }
  }
}
