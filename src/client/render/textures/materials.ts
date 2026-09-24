/**
 * Reusable procedural material generators (stone, wood, bricks, ores, fabrics, metals…).
 * All coordinates are canonical 16×16 texels; the painter handles resolution.
 */
import { Painter, RGB, RGBA, mix, shade, add, hex, lum } from './painter';

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function jitter(c: RGB, amt: number, r: number): RGB {
  const d = (r - 0.5) * 2 * amt * 255;
  return [clamp255(c[0] + d), clamp255(c[1] + d), clamp255(c[2] + d)];
}

/** Noisy fill: grain + large blotches. */
export function noiseFill(p: Painter, base: RGB, variance = 0.08, blotch = 0.06, salt = 0): void {
  p.each((x, y, u, v) => {
    const g = p.grain(x, y, salt);
    const b = p.fbm(u, v, 3, 2, salt + 5);
    const c = add(base, ((g - 0.5) * variance + (b - 0.5) * blotch) * 255);
    p.set(x, y, [clamp255(c[0]), clamp255(c[1]), clamp255(c[2])], 0.5 + (g - 0.5) * 0.3 + (b - 0.5) * 0.4);
  });
}

/** Scatter specks of the given colours. */
export function speckle(p: Painter, colors: RGB[], density: number, salt = 11, height = 0.6): void {
  p.each((x, y, u, v) => {
    const r = p.rndC(u, v, salt);
    if (r < density) {
      const c = colors[Math.floor(p.rndC(u, v, salt + 1) * colors.length)]!;
      p.set(x, y, jitter(c, 0.05, p.grain(x, y, salt + 2)), height);
    }
  });
}

/** Voronoi cell id + edge distance at canonical coords (tileable over 16). */
export function voronoi(p: Painter, u: number, v: number, cells: number, salt = 0): { id: number; edge: number; d1: number } {
  const cs = 16 / cells;
  const cx = Math.floor(u / cs), cy = Math.floor(v / cs);
  let best = 1e9, second = 1e9, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gy = cy + dy;
      const wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells;
      const px = (gx + 0.15 + 0.7 * p.rnd(wx + 500, wy + 500, salt)) * cs;
      const py = (gy + 0.15 + 0.7 * p.rnd(wx + 500, wy + 500, salt + 1)) * cs;
      const d = Math.hypot(u - px, v - py);
      if (d < best) {
        second = best;
        best = d;
        id = wy * cells + wx;
      } else if (d < second) second = d;
    }
  }
  return { id, edge: second - best, d1: best };
}

/** Natural stone. */
export function stone(p: Painter, base: RGB, opts: { variance?: number; blotch?: number; cracks?: number; salt?: number } = {}): void {
  noiseFill(p, base, opts.variance ?? 0.1, opts.blotch ?? 0.08, opts.salt ?? 0);
  if (opts.cracks) {
    p.each((x, y, u, v) => {
      const vr = voronoi(p, u, v, 4, 77);
      if (vr.edge < 0.35 * opts.cracks!) {
        const c = p.get(x, y);
        p.set(x, y, [c[0] * 0.82, c[1] * 0.82, c[2] * 0.82], 0.25);
      }
    });
  }
  p.material({ smooth: 0.15, bump: 1 });
}

/** Cobblestone-like irregular rocks with dark mortar. */
export function cobble(p: Painter, rock: RGB, mortar: RGB, cells = 4, salt = 0): void {
  p.each((x, y, u, v) => {
    const vr = voronoi(p, u, v, cells, salt);
    const shadeF = 0.85 + p.rnd(vr.id, 0, salt + 3) * 0.3;
    const g = p.grain(x, y, salt + 1);
    if (vr.edge < 0.55) {
      p.set(x, y, jitter(mortar, 0.05, g), 0.15);
    } else {
      const edgeLight = Math.min(1, (vr.edge - 0.55) / 1.2);
      const c = shade(rock, shadeF * (0.9 + edgeLight * 0.15));
      p.set(x, y, jitter(c, 0.08, g), 0.4 + edgeLight * 0.5);
    }
  });
  p.material({ smooth: 0.1, bump: 1.4 });
}

/** Bricks laid in rows with offset. */
export function bricks(p: Painter, brick: RGB, mortar: RGB, opts: { rows?: number; cols?: number; mortarW?: number; vary?: number; salt?: number } = {}): void {
  const rows = opts.rows ?? 4, cols = opts.cols ?? 2, mw = opts.mortarW ?? 1;
  const rh = 16 / rows, cw = 16 / cols;
  p.each((x, y, u, v) => {
    const row = Math.floor(v / rh);
    const off = row % 2 === 1 ? cw / 2 : 0;
    const uu = (u + off) % 16;
    const col = Math.floor(uu / cw);
    const inU = uu - col * cw, inV = v - row * rh;
    const g = p.grain(x, y, opts.salt ?? 0);
    if (inV < mw || inU < mw) {
      p.set(x, y, jitter(mortar, 0.04, g), 0.1);
    } else {
      const k = 0.9 + p.rnd(row * 7 + col, 3, 91) * (opts.vary ?? 0.2);
      const edge = inV < mw + 1 ? 1.06 : inV > rh - 1 ? 0.92 : 1;
      p.set(x, y, jitter(shade(brick, k * edge), 0.07, g), 0.6 + (g - 0.5) * 0.2);
    }
  });
  p.material({ smooth: 0.12, bump: 1.2 });
}

/** Square tiles grid. */
export function tiles(p: Painter, tile: RGB, grout: RGB, n = 2, salt = 0): void {
  const size = 16 / n;
  p.each((x, y, u, v) => {
    const iu = u % size, iv = v % size;
    const g = p.grain(x, y, salt);
    const id = Math.floor(u / size) * 13 + Math.floor(v / size);
    if (iu < 1 || iv < 1) p.set(x, y, jitter(grout, 0.03, g), 0.1);
    else {
      const bevel = iu < 2 || iv < 2 ? 1.08 : iu > size - 1 || iv > size - 1 ? 0.9 : 1;
      p.set(x, y, jitter(shade(tile, bevel * (0.93 + p.rnd(id, 1, salt) * 0.12)), 0.06, g), 0.6);
    }
  });
  p.material({ smooth: 0.2, bump: 1 });
}

/** Polished stone: smooth fill with bevelled border. */
export function polished(p: Painter, base: RGB, salt = 0): void {
  p.each((x, y, u, v) => {
    const g = p.grain(x, y, salt);
    const b = p.fbm(u, v, 2, 2, salt + 4);
    let c = add(base, ((g - 0.5) * 0.05 + (b - 0.5) * 0.06) * 255);
    const edge = Math.min(u, v, 16 - u, 16 - v);
    if (edge < 1) c = shade(c, u < 1 || v < 1 ? 1.12 : 0.8);
    p.set(x, y, c, edge < 1 ? 0.3 : 0.6);
  });
  p.material({ smooth: 0.45, bump: 0.8 });
}

/** Wooden planks: 4 horizontal boards with grain. */
export function planks(p: Painter, base: RGB, opts: { boards?: number; grain?: number; salt?: number } = {}): void {
  const boards = opts.boards ?? 4;
  const bh = 16 / boards;
  p.each((x, y, u, v) => {
    const b = Math.floor(v / bh);
    const inV = v - b * bh;
    const boardShade = 0.9 + p.rnd(b, 17, opts.salt ?? 0) * 0.16;
    const seam = (b * 7 + 3) % 16;
    const w = p.vnoise(u * 0.25, v * 4, 4, b + 3);
    let c = shade(base, boardShade * (0.92 + w * 0.12 * (opts.grain ?? 1)));
    const g = p.grain(x, y, 5);
    c = jitter(c, 0.04, g);
    let h = 0.55 + w * 0.1;
    if (inV < 1) { c = shade(base, 0.62); h = 0.1; }
    else if (inV >= bh - 0.001 - 1 / p.s && p.s > 1) { c = shade(c, 0.85); }
    // board end seam
    const su = (u + b * 5) % 16;
    if (Math.abs(su - seam) < 0.5 && inV >= 1) { c = shade(base, 0.7); h = 0.2; }
    // nails at seam ends
    if (inV >= 1 && inV < 2 && (Math.abs(su - (seam + 1.5)) < 0.5 || Math.abs(su - (seam - 1.5 + 16) % 16) < 0.5)) c = shade(base, 0.75);
    p.set(x, y, c, h);
  });
  p.material({ smooth: 0.18, bump: 1 });
}

/** Log bark (vertical streaks). */
export function bark(p: Painter, base: RGB, dark: RGB, salt = 0): void {
  p.each((x, y, u, v) => {
    const streak = p.vnoise(u * 3, v * 0.35, 4, salt);
    const fine = p.grain(x, y, salt + 2);
    const t = Math.max(0, Math.min(1, streak * 1.2 - 0.1));
    let c = mix(dark, base, t);
    c = jitter(c, 0.06, fine);
    const groove = p.vnoise(u * 4, v * 0.5, 8, salt + 9) < 0.3;
    if (groove) c = shade(c, 0.78);
    p.set(x, y, c, groove ? 0.2 : 0.4 + t * 0.4);
  });
  p.material({ smooth: 0.08, bump: 1.5 });
}

/** Log top: concentric rings inside a bark border. */
export function logTop(p: Painter, inner: RGB, ring: RGB, barkC: RGB, salt = 0): void {
  p.each((x, y, u, v) => {
    const du = u - 8, dv = v - 8;
    const edge = Math.min(u, v, 16 - u, 16 - v);
    const g = p.grain(x, y, salt);
    if (edge < 1) {
      p.set(x, y, jitter(barkC, 0.06, g), 0.3);
      return;
    }
    const r = Math.sqrt(du * du + dv * dv) + (p.vnoise(u, v, 4, salt + 3) - 0.5) * 1.5;
    const band = Math.floor(r / 1.8) % 2;
    const c = band ? ring : inner;
    p.set(x, y, jitter(c, 0.05, g), band ? 0.45 : 0.55);
  });
  p.material({ smooth: 0.15 });
}

/** Stripped log side: smooth wood with long grain. */
export function strippedSide(p: Painter, base: RGB, salt = 0): void {
  p.each((x, y, u, v) => {
    const w = p.vnoise(u * 2, v * 0.3, 6, salt);
    const g = p.grain(x, y, salt + 1);
    p.set(x, y, jitter(shade(base, 0.9 + w * 0.18), 0.03, g), 0.5 + w * 0.1);
  });
  p.material({ smooth: 0.2 });
}

/** Leaves: clustered foliage with transparent gaps (tint mask 1). */
export function leaves(p: Painter, base: RGB, holes = 0.18, salt = 0, flowers?: RGB[]): void {
  p.each((x, y, u, v) => {
    const clump = p.fbm(u, v, 6, 2, salt);
    const g = p.grain(x, y, salt + 1);
    const hole = p.rndC(u, v, salt + 2) < holes && clump < 0.55;
    if (hole) {
      p.set(x, y, [0, 0, 0, 0], 0);
      return;
    }
    const c = shade(base, 0.65 + clump * 0.55 + (g - 0.5) * 0.2);
    p.set(x, y, [clamp255(c[0]), clamp255(c[1]), clamp255(c[2]), 255], clump);
    if (flowers && p.rndC(u, v, salt + 5) < 0.08) {
      p.set(x, y, flowers[Math.floor(p.rndC(u, v, salt + 6) * flowers.length)]!, 0.8);
      p.setMat(x, y, { tint: 0 });
    }
  });
  p.material({ smooth: 0.25, bump: 1.2 });
}

/** Knitted wool. */
export function wool(p: Painter, base: RGB, salt = 0): void {
  p.each((x, y, u, v) => {
    const row = Math.floor(v / 2);
    const k = ((u + (row % 2) * 1) % 2) < 1 ? 1.05 : 0.93;
    const g = p.grain(x, y, salt);
    const fuzz = p.fbm(u, v, 4, 2, salt + 3);
    const c = shade(base, k * (0.92 + fuzz * 0.14));
    p.set(x, y, jitter(c, 0.05, g), 0.4 + (k - 0.93) * 3);
  });
  p.material({ smooth: 0.02, bump: 1.3 });
}

export function concrete(p: Painter, base: RGB, salt = 0): void {
  p.each((x, y, u, v) => {
    const g = p.grain(x, y, salt);
    const b = p.fbm(u, v, 2, 2, salt + 1);
    p.set(x, y, jitter(add(base, (b - 0.5) * 8), 0.02, g), 0.5 + (g - 0.5) * 0.05);
  });
  p.material({ smooth: 0.35, bump: 0.3 });
}

export function powder(p: Painter, base: RGB, salt = 0): void {
  p.each((x, y) => {
    const g = p.grain(x, y, salt);
    const r = p.rnd(x, y, salt + 9);
    let c = jitter(base, 0.09, g);
    if (r < 0.08) c = shade(base, 0.8);
    if (r > 0.94) c = shade(base, 1.15);
    p.set(x, y, c, 0.5 + (g - 0.5) * 0.3);
  });
  p.material({ smooth: 0.05 });
}

export function terracotta(p: Painter, base: RGB, salt = 0): void {
  p.each((x, y, u, v) => {
    const g = p.grain(x, y, salt);
    const b = p.fbm(u, v, 3, 2, salt + 2);
    p.set(x, y, jitter(shade(base, 0.94 + b * 0.1), 0.045, g), 0.5 + (b - 0.5) * 0.2);
  });
  p.material({ smooth: 0.12, bump: 0.6 });
}

/** Glazed terracotta: symmetric ornamental pattern (distinct per colour). */
export function glazed(p: Painter, base: RGB, accent: RGB, dark: RGB, variant: number): void {
  p.each((x, y, u, v) => {
    // quarter-symmetric motif with swirl depending on variant
    const du = u - 8, dv = v - 8;
    const a = Math.atan2(dv, du);
    const r = Math.hypot(du, dv);
    const swirl = Math.sin(a * (2 + (variant % 3)) + r * (0.6 + (variant % 4) * 0.15));
    const ring = Math.sin(r * (1.2 + (variant % 5) * 0.2));
    const cornerD = Math.min(Math.hypot(u, v), Math.hypot(16 - u, v), Math.hypot(u, 16 - v), Math.hypot(16 - u, 16 - v));
    let c: RGB = base;
    if (swirl > 0.55) c = accent;
    else if (ring > 0.8) c = dark;
    if (cornerD < 3 + (variant % 3)) c = mix(dark, accent, (variant % 2) * 0.5);
    const edge = Math.min(u, v, 16 - u, 16 - v);
    if (edge < 1 && (Math.floor(u + v) % 3 === 0)) c = dark;
    p.set(x, y, jitter(c, 0.03, p.grain(x, y, 1)), c === base ? 0.55 : 0.6);
  });
  p.material({ smooth: 0.75, bump: 0.5 });
}

/** Glass: frame + streak highlights, transparent middle. */
export function glass(p: Painter, tint: RGBA | null, frame: RGB): void {
  p.each((x, y, u, v) => {
    const edge = Math.min(u, v, 16 - u, 16 - v);
    if (edge < 1) {
      p.set(x, y, [frame[0], frame[1], frame[2], 255], 0.7);
      return;
    }
    const streak = (Math.abs(u - v - 3) < 0.6 || Math.abs(u - v + 4) < 0.5) && u > 2 && v > 2 && u < 13 && v < 13;
    if (tint) {
      const a = streak ? Math.min(255, tint[3] + 60) : tint[3];
      p.set(x, y, [tint[0], tint[1], tint[2], a], 0.5);
    } else {
      p.set(x, y, streak ? [255, 255, 255, 110] : [255, 255, 255, 0], 0.5);
    }
  });
  p.material({ smooth: 0.95, bump: 0.2 });
}

/** Metal storage block: bevelled border, brushed surface, rivets. */
export function metalBlock(p: Painter, base: RGB, opts: { rivets?: boolean; smooth?: number; salt?: number } = {}): void {
  p.each((x, y, u, v) => {
    const g = p.grain(x, y, opts.salt ?? 0);
    const brushed = p.vnoise(u * 0.2, v * 3, 8, 3);
    let c = shade(base, 0.9 + brushed * 0.15);
    const edge = Math.min(u, v, 16 - u, 16 - v);
    let h = 0.6;
    if (edge < 1) { c = shade(base, u < 1 || v < 1 ? 1.25 : 0.65); h = 0.3; }
    else if (edge < 2) { c = shade(c, u < 2 || v < 2 ? 1.1 : 0.85); h = 0.5; }
    if (opts.rivets && ((Math.abs(u - 2.5) < 0.6 || Math.abs(u - 13.5) < 0.6) && (Math.abs(v - 2.5) < 0.6 || Math.abs(v - 13.5) < 0.6))) { c = shade(base, 1.3); h = 0.9; }
    // diagonal shine
    const shine = Math.max(0, 1 - Math.abs(u - v) / 3) * 0.12;
    c = add(c, shine * 255);
    p.set(x, y, jitter(c, 0.02, g), h);
  });
  p.material({ smooth: opts.smooth ?? 0.7, metal: 1, bump: 0.8 });
}

/** Gem block (diamond/emerald/lapis): faceted pattern. */
export function gemBlock(p: Painter, base: RGB, light: RGB, dark: RGB): void {
  p.each((x, y, u, v) => {
    const cu = (u % 8) - 4, cv = (v % 8) - 4;
    const facet = Math.abs(cu) + Math.abs(cv);
    let c = base;
    if (facet < 1.5) c = light;
    else if (facet > 3.2) c = dark;
    else if (cu > 0 === cv > 0) c = mix(base, light, 0.35);
    const edge = Math.min(u, v, 16 - u, 16 - v);
    if (edge < 1) c = shade(dark, 0.9);
    p.set(x, y, jitter(c, 0.03, p.grain(x, y, 2)), 1 - facet / 8);
  });
  p.material({ smooth: 0.85, bump: 1 });
}

/** Ore: host rock + mineral clusters. */
export function ore(p: Painter, host: (p: Painter) => void, mineral: RGB, light: RGB, clusters = 5, shape: 'blob' | 'crystal' | 'nugget' = 'blob'): void {
  host(p);
  for (let i = 0; i < clusters; i++) {
    const cu = 2 + p.rnd(i, 1, 101) * 12, cv = 2 + p.rnd(i, 2, 101) * 12;
    const r = shape === 'crystal' ? 1.5 : 1.3 + p.rnd(i, 3, 101) * 0.9;
    p.disc(cu, cv, r, (x, y, d) => {
      const k = p.rnd(x, y, 55);
      if (shape === 'blob' && k < 0.18) return;
      const c = d < 0.45 ? light : mineral;
      p.set(x, y, jitter(c, 0.05, k), 0.8 - d * 0.3);
      p.setMat(x, y, { smooth: 0.6, metal: shape === 'nugget' ? 0.8 : 0.1 });
    });
    if (shape === 'crystal') {
      p.px(cu - 0.5, cv - 1.5, light, 0.9);
    }
  }
}

/** Sand-like fine grains. */
export function sandy(p: Painter, base: RGB, salt = 0): void {
  p.each((x, y, u, v) => {
    const g = p.grain(x, y, salt);
    const r = p.rnd(x, y, salt + 1);
    let c = jitter(base, 0.07, g);
    if (r < 0.07) c = shade(base, 0.85);
    if (r > 0.95) c = shade(base, 1.1);
    const ripple = Math.sin((u + v * 0.5) * 1.3 + p.fbm(u, v, 2, 1, salt) * 4) * 0.02;
    p.set(x, y, add(c, ripple * 255), 0.5 + (g - 0.5) * 0.4 + ripple * 3);
  });
  p.material({ smooth: 0.05, bump: 0.8 });
}

/** Gravel: pebbles of various greys. */
export function pebbles(p: Painter, colors: RGB[], bg: RGB, cells = 6, salt = 0): void {
  p.each((x, y, u, v) => {
    const vr = voronoi(p, u, v, cells, salt);
    const g = p.grain(x, y, salt + 1);
    if (vr.edge < 0.4) p.set(x, y, jitter(bg, 0.05, g), 0.15);
    else {
      const c = colors[vr.id % colors.length]!;
      const lit = vr.edge > 1.2 ? 1.1 : 1;
      p.set(x, y, jitter(shade(c, lit), 0.07, g), 0.4 + Math.min(0.5, vr.edge * 0.25));
    }
  });
  p.material({ smooth: 0.1, bump: 1.5 });
}

/** Dirt: earthy noise with small stones and roots. */
export function dirt(p: Painter, base: RGB, salt = 0): void {
  noiseFill(p, base, 0.12, 0.08, salt);
  speckle(p, [shade(base, 0.7), shade(base, 1.2), hex('#8a7c6a')], 0.12, salt + 4, 0.7);
  p.material({ smooth: 0.05, bump: 1.2 });
}

/** Overlay a grassy fringe on the top rows (grass block side). */
export function grassFringe(p: Painter, grass: RGB, depth = 4, salt = 0): void {
  for (let x = 0; x < p.n; x++) {
    const u = (x + 0.5) / p.s;
    const hang = depth - 1 + Math.floor(p.rndC(u, 0, salt) * 3) - (p.rndC(u, 1, salt) < 0.3 ? 1 : 0);
    for (let y = 0; y < p.n; y++) {
      const v = (y + 0.5) / p.s;
      if (v < hang) {
        const g = p.grain(x, y, salt + 1);
        p.set(x, y, jitter(shade(grass, 0.85 + g * 0.3), 0.04, g), 0.7);
        p.setMat(x, y, { tint: 1 });
      } else p.setMat(x, y, { tint: 0 });
    }
  }
}

/** Soft animated fluid surface. */
export function fluid(p: Painter, base: RGB, light: RGB, frame: number, frames: number, opts: { alpha?: number; emissive?: boolean; flow?: boolean } = {}): void {
  const t = frame / frames;
  p.each((x, y, u, v) => {
    const vv = opts.flow ? v - t * 16 : v;
    const a = Math.sin((u / 16) * Math.PI * 2 * 2 + t * Math.PI * 2) * 0.5 + 0.5;
    const n1 = p.fbm(u + t * 16 * 0.0, vv, 3, 3, 1);
    const n2 = p.fbm(u, vv + 8, 5, 2, 2);
    const k = n1 * 0.6 + n2 * 0.3 + a * 0.1;
    const c = mix(base, light, Math.pow(k, opts.emissive ? 1.2 : 2));
    p.set(x, y, [clamp255(c[0]), clamp255(c[1]), clamp255(c[2]), opts.alpha ?? 255], k);
    if (opts.emissive) p.setMat(x, y, { emit: 0.6 + k * 0.4 });
  });
  p.material({ smooth: opts.emissive ? 0.3 : 0.95, bump: 0.6 });
}

export { hex, mix, shade, add, lum };
export type { RGB, RGBA };
