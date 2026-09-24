/** Dimension types (height, sky, rules). */
export type DimensionId = 'overworld' | 'inferno' | 'verge';

export interface DimensionType {
  id: DimensionId;
  minY: number;
  height: number;
  logicalHeight: number;
  hasSkylight: boolean;
  hasCeiling: boolean;
  ultrawarm: boolean;
  natural: boolean;
  coordinateScale: number;
  bedWorks: boolean;
  respawnAnchorWorks: boolean;
  fixedTime: number | null;
  ambientLight: number;
  seaLevel: number;
  cloudHeight: number | null;
  sky: 'overworld' | 'inferno' | 'verge';
  fogColor: [number, number, number];
  lavaSpreadTicks: number;
  lavaDistance: number;
  infiniburnTag: string;
}

export const DIMENSIONS: Record<DimensionId, DimensionType> = {
  overworld: {
    id: 'overworld', minY: -64, height: 384, logicalHeight: 384, hasSkylight: true, hasCeiling: false, ultrawarm: false,
    natural: true, coordinateScale: 1, bedWorks: true, respawnAnchorWorks: false, fixedTime: null, ambientLight: 0,
    seaLevel: 63, cloudHeight: 192, sky: 'overworld', fogColor: [0.75, 0.85, 1], lavaSpreadTicks: 30, lavaDistance: 3,
    infiniburnTag: 'infiniburn_overworld',
  },
  inferno: {
    id: 'inferno', minY: 0, height: 256, logicalHeight: 128, hasSkylight: false, hasCeiling: true, ultrawarm: true,
    natural: false, coordinateScale: 8, bedWorks: false, respawnAnchorWorks: true, fixedTime: 18000, ambientLight: 0.1,
    seaLevel: 32, cloudHeight: null, sky: 'inferno', fogColor: [0.2, 0.03, 0.03], lavaSpreadTicks: 10, lavaDistance: 7,
    infiniburnTag: 'infiniburn_overworld',
  },
  verge: {
    id: 'verge', minY: 0, height: 256, logicalHeight: 256, hasSkylight: false, hasCeiling: false, ultrawarm: false,
    natural: false, coordinateScale: 1, bedWorks: false, respawnAnchorWorks: false, fixedTime: 6000, ambientLight: 0,
    seaLevel: 0, cloudHeight: null, sky: 'verge', fogColor: [0.06, 0.04, 0.08], lavaSpreadTicks: 30, lavaDistance: 3,
    infiniburnTag: 'infiniburn_verge',
  },
};

export const DIMENSION_IDS: readonly DimensionId[] = ['overworld', 'inferno', 'verge'];

export function sectionCount(d: DimensionType): number {
  return d.height >> 4;
}
