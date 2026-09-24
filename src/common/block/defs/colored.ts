/** 16-color families: wool, carpet, concrete, terracotta, glass, candles, beds, banners, shell boxes. */
import { reg, cube, COLORS, P, shapeOf, model, box, facingRot, BlockSettings } from './helpers';
import { cubeTex, Element } from '../model';
import { paneElements, paneShape, bedElements } from '../shapes';

export function registerColored(): void {
  for (const c of COLORS) cube(`${c}_wool`, { hardness: 0.8, sound: 'wool', map: `color_${c}`, flammable: [30, 60], tool: 'shears', tags: ['wool'] });
  for (const c of COLORS) {
    reg(`${c}_carpet`, [], { hardness: 0.1, sound: 'wool', map: `color_${c}`, flammable: [60, 20], push: 'destroy', occludes: false, tags: ['wool_carpets'], model: () => model([box([0, 0, 0], [16, 1, 16], `${c}_wool`)]) });
  }
  cube('terracotta', { hardness: 1.25, resistance: 4.2, tool: 'pickaxe', requiresTool: true, sound: 'stone', map: 'color_orange', tags: ['terracotta'] });
  for (const c of COLORS) cube(`${c}_terracotta`, { hardness: 1.25, resistance: 4.2, tool: 'pickaxe', requiresTool: true, sound: 'stone', map: `terracotta_${c}`, tags: ['terracotta'] });
  for (const c of COLORS) {
    reg(`${c}_glazed_terracotta`, [P.facing], {
      hardness: 1.4, tool: 'pickaxe', requiresTool: true, sound: 'stone', map: `color_${c}`, push: 'push_only',
      model: (s) => {
        const f = s.get(P.facing);
        const r = f === 3 ? 0 : f === 4 ? 90 : f === 2 ? 180 : 270;
        const t = `${c}_glazed_terracotta`;
        return { kind: 'cube', tex: [t, t, t, t, t, t], rot: [r, r, r, r, r, r] };
      },
    });
  }
  for (const c of COLORS) cube(`${c}_concrete`, { hardness: 1.8, tool: 'pickaxe', requiresTool: true, sound: 'stone', map: `color_${c}` });
  for (const c of COLORS) cube(`${c}_concrete_powder`, { hardness: 0.5, tool: 'shovel', sound: 'sand', map: `color_${c}`, tags: ['falling', 'concrete_powder'] });

  // Glass
  const glass: BlockSettings = { hardness: 0.3, sound: 'glass', map: 'none', layer: 'cutout', occludes: false, cullSame: true, noDrops: true, tags: ['glass'], spawnable: false };
  cube('glass', glass);
  cube('tinted_glass', { ...glass, layer: 'translucent', opacity: 15, noDrops: false });
  for (const c of COLORS) cube(`${c}_stained_glass`, { ...glass, layer: 'translucent', map: `color_${c}` });
  const pane = (name: string, tex: string, edge: string, s: BlockSettings) =>
    reg(name, [P.north, P.east, P.south, P.west, P.waterlogged], {
      ...s, dynamicShape: true, tags: ['panes'],
      model: (st) => model(paneElements(tex, edge, st.get(P.north), st.get(P.east), st.get(P.south), st.get(P.west))),
      shape: (st) => paneShape(st.get(P.north), st.get(P.east), st.get(P.south), st.get(P.west)),
    });
  pane('glass_pane', 'glass', 'glass_pane_top', glass);
  for (const c of COLORS) pane(`${c}_stained_glass_pane`, `${c}_stained_glass`, `${c}_stained_glass_pane_top`, { ...glass, layer: 'translucent' });

  // Candles
  const candle = (name: string, tex: string) =>
    reg(name, [P.candles, P.lit, P.waterlogged], {
      hardness: 0.1, sound: 'candle', map: 'sand', layer: 'cutout', push: 'destroy', occludes: false,
      light: (s) => (s.get(P.lit) ? 3 * s.get(P.candles) : 0), tags: ['candles'],
      model: (s) => {
        const n = s.get(P.candles);
        const pos: Array<[number, number, number]> = [[7, 7, 6], [5, 7, 5], [9, 6, 5], [8, 8, 3]];
        const layouts: Array<Array<[number, number, number]>> = [
          [[7, 7, 6]],
          [[5, 7, 6], [9, 6, 5]],
          [[7, 8, 6], [5, 6, 5], [9, 5, 3]],
          [[5, 5, 6], [9, 5, 5], [5, 9, 5], [8, 8, 3]],
        ];
        void pos;
        const els: Element[] = [];
        for (const [x, z, h] of layouts[n - 1]!) {
          els.push(box([x, 0, z], [x + 2, h, z + 2], tex, { cullEdges: false }));
          els.push(box([x + 0.5, h, z + 1], [x + 1.5, h + 1, z + 1], s.get(P.lit) ? 'candle_wick_lit' : 'candle_wick', { cullEdges: false, emissive: s.get(P.lit) }));
        }
        return model(els);
      },
      shape: () => shapeOf([5, 0, 5, 11, 6, 11]),
    });
  candle('candle', 'candle');
  for (const c of COLORS) candle(`${c}_candle`, `${c}_candle`);

  // Cake & candle cakes
  reg('cake', [P.bites], {
    hardness: 0.5, sound: 'wool', map: 'none', push: 'destroy', occludes: false,
    model: (s) => {
      const x0 = 1 + s.get(P.bites) * 2;
      return model([box([x0, 0, 1], [15, 8, 15], { 0: 'cake_bottom', 1: 'cake_top', 2: 'cake_side', 3: 'cake_side', 4: s.get(P.bites) > 0 ? 'cake_inner' : 'cake_side', 5: 'cake_side' }, { cullEdges: false })]);
    },
    shape: (s) => shapeOf([1 + s.get(P.bites) * 2, 0, 1, 15, 8, 15]),
    noDrops: true,
  });
  const candleCake = (name: string, candleTex: string, candleItem: string) =>
    reg(name, [P.lit], {
      hardness: 0.5, sound: 'wool', map: 'none', push: 'destroy', occludes: false, light: (s) => (s.get(P.lit) ? 3 : 0),
      noItem: true, itemId: 'cake', drops: candleItem,
      model: (s) => model([
        box([1, 0, 1], [15, 8, 15], { 0: 'cake_bottom', 1: 'cake_top', 2: 'cake_side', 3: 'cake_side', 4: 'cake_side', 5: 'cake_side' }, { cullEdges: false }),
        box([7, 8, 7], [9, 14, 9], candleTex, { cullEdges: false }),
        box([7.5, 14, 8], [8.5, 15, 8], s.get(P.lit) ? 'candle_wick_lit' : 'candle_wick', { cullEdges: false, emissive: s.get(P.lit) }),
      ]),
      shape: () => shapeOf([1, 0, 1, 15, 8, 15], [7, 8, 7, 9, 14, 9]),
    });
  candleCake('candle_cake', 'candle', 'candle');
  for (const c of COLORS) candleCake(`${c}_candle_cake`, `${c}_candle`, `${c}_candle`);

  // Beds
  for (const c of COLORS) {
    reg(`${c}_bed`, [P.facing, P.bedPart, P.occupied], {
      defaults: { part: 'foot' }, hardness: 0.2, sound: 'wood', map: `color_${c}`, push: 'destroy', occludes: false, blockEntity: 'bed', tags: ['beds'], flammable: undefined,
      model: (s) => model(bedElements(`${c}_bed`, s.get(P.bedPart), s.get(P.facing))),
      shape: () => shapeOf([0, 0, 0, 16, 9, 16]),
      jumpFactor: 1,
    });
  }

  // Banners
  for (const c of COLORS) {
    reg(`${c}_banner`, [P.rotation16], {
      hardness: 1, sound: 'wood', map: 'wood', collision: false, push: 'destroy', occludes: false, blockEntity: 'banner', tags: ['banners'],
      model: (s) => {
        const rot = s.get(P.rotation16);
        const snapped = (Math.round(rot / 4) * 90) % 360;
        const els: Element[] = [
          box([7, 0, 7], [9, 28, 9], 'banner_pole', { cullEdges: false }),
          box([-2, 28, 7], [18, 30, 9], 'banner_pole', { cullEdges: false }),
          box([-2, 1, 9], [18, 28, 10], { 2: `${c}_banner_cloth`, 3: `${c}_banner_cloth`, 4: `${c}_banner_cloth`, 5: `${c}_banner_cloth`, 1: `${c}_banner_cloth`, 0: `${c}_banner_cloth` }, { cullEdges: false }),
        ];
        return model(facingRotDeg(els, snapped), false);
      },
      outline: () => shapeOf([4, 0, 4, 12, 16, 12]),
      wave: 0,
    });
    reg(`${c}_wall_banner`, [P.facing], {
      hardness: 1, sound: 'wood', map: 'wood', collision: false, push: 'destroy', occludes: false, blockEntity: 'banner', tags: ['banners'],
      noItem: true, itemId: `${c}_banner`, drops: `${c}_banner`,
      model: (s) => model(facingRot([
        box([-2, 14, 13], [18, 16, 15], 'banner_pole', { cullEdges: false }),
        box([-2, -12, 15], [18, 14, 16], `${c}_banner_cloth`, { cullEdges: false }),
      ], s.get(P.facing)), false),
      outline: (s) => {
        const f = s.get(P.facing);
        if (f === 2) return shapeOf([0, 0, 14, 16, 12.5, 16]);
        if (f === 3) return shapeOf([0, 0, 0, 16, 12.5, 2]);
        if (f === 4) return shapeOf([14, 0, 0, 16, 12.5, 16]);
        return shapeOf([0, 0, 0, 2, 12.5, 16]);
      },
    });
  }

  // Shell boxes (plain + 16 colours)
  for (const c of ['', ...COLORS]) {
    const name = c ? `${c}_shell_box` : 'shell_box';
    reg(name, [P.facing6], {
      hardness: 2, sound: 'shell_box', map: c ? `color_${c}` : 'color_purple', push: 'destroy', blockEntity: 'shell_box', tags: ['shell_boxes'],
      model: (s) => {
        const f = s.get(P.facing6);
        const t: [string, string, string, string, string, string] = [`${name}_side`, `${name}_side`, `${name}_side`, `${name}_side`, `${name}_side`, `${name}_side`];
        t[f] = `${name}_top`;
        t[f ^ 1] = `${name}_bottom`;
        return { kind: 'cube', tex: t };
      },
    });
  }
  void cubeTex;
}

function facingRotDeg(els: Element[], deg: number): Element[] {
  const f = deg === 0 ? 2 : deg === 90 ? 5 : deg === 180 ? 3 : 4;
  return facingRot(els, f as 2 | 3 | 4 | 5);
}
