/** Attach behaviour objects to blocks by name, family and tag. */
import { BLOCKS, Block, blockHasTag, addTag, BLOCK_BY_NAME } from '../registry';
import { BlockBehavior, DEFAULT_BEHAVIOR } from '../behavior';
import { P } from '../properties';
import {
  PillarBehavior, FacingPlayerBehavior, FacingAwayBehavior, AnvilBehavior, Facing6Behavior, ClickedFaceBehavior,
  HopperBehavior, ObserverBehavior, CrafterBehavior, SlabBehavior, StairsBehavior, FenceBehavior, PaneBehavior,
  WallBehavior, DoorBehavior, TrapdoorBehavior, FenceGateBehavior, FaceAttachedBehavior, TorchBehavior,
  WallTorchBehavior, LadderBehavior, RotatableStandingBehavior, WallAttachedBehavior, HangingSignBehavior,
  LanternBehavior, SnowLayerBehavior, StackingBehavior, CarpetBehavior, SnowyDirtBehavior, ChestBehavior, BedBehavior,
  TallBlockBehavior,
} from './placement';
import {
  PlantBehavior, TallPlantBehavior, HangingPlantBehavior, CocoaBehavior, VineBehavior, MultifaceBehavior, SUPPORT,
} from './plants';
import { hasTag, isFaceSturdy, blockOf, setValue } from '../registry';
import type { PlaceContext } from '../../world/level';

const extraBehaviors: Array<(b: Block) => BlockBehavior | null> = [];

/** Later milestones (redstone, fluids, containers…) register resolvers here. */
export function registerBehaviorResolver(fn: (b: Block) => BlockBehavior | null): void {
  extraBehaviors.push(fn);
}

function has(b: Block, ...props: Array<(typeof P)[keyof typeof P]>): boolean {
  return props.every((p) => b.props.includes(p as never));
}

function resolve(b: Block): BlockBehavior {
  for (const r of extraBehaviors) {
    const x = r(b);
    if (x) return x;
  }
  const n = b.name;
  const tags = b.settings.tags ?? [];
  // --- shapes
  if (n.endsWith('_slab')) return new SlabBehavior();
  if (n.endsWith('_stairs')) return new StairsBehavior();
  if (tags.includes('fences')) return new FenceBehavior();
  if (tags.includes('walls')) return new WallBehavior();
  if (tags.includes('panes')) return new PaneBehavior();
  if (tags.includes('fence_gates')) return new FenceGateBehavior();
  if (tags.includes('doors')) return new DoorBehavior(!n.startsWith('iron'));
  if (tags.includes('trapdoors')) return new TrapdoorBehavior(!n.startsWith('iron'));
  if (tags.includes('buttons') || n === 'lever' || n === 'grindstone') return new FaceAttachedBehavior();
  if (n === 'torch') return new TorchBehavior('wall_torch');
  if (n === 'soul_torch') return new TorchBehavior('soul_wall_torch');
  if (n === 'copper_torch') return new TorchBehavior('copper_wall_torch');
  if (n === 'flux_torch') return new TorchBehavior('flux_wall_torch');
  if (n.endsWith('wall_torch')) return new WallTorchBehavior();
  if (n === 'ladder') return new LadderBehavior();
  if (tags.includes('standing_signs')) return new RotatableStandingBehavior(n.replace('_sign', '_wall_sign'), true);
  if (tags.includes('wall_signs')) return new WallAttachedBehavior();
  if (n.endsWith('_wall_hanging_sign')) return new WallAttachedBehavior();
  if (n.endsWith('_hanging_sign')) return new HangingSignBehavior();
  if (tags.includes('banners') && !n.includes('wall')) return new RotatableStandingBehavior(n.replace('_banner', '_wall_banner'), true);
  if (tags.includes('banners')) return new WallAttachedBehavior();
  if (tags.includes('skulls') && !n.includes('wall')) return new RotatableStandingBehavior(n.replace(/_(skull|head)$/, '_wall_$1'), false);
  if (tags.includes('skulls')) return new WallAttachedBehavior();
  if (n === 'lantern' || n === 'soul_lantern' || n.endsWith('copper_lantern')) return new LanternBehavior();
  if (n === 'snow') return new SnowLayerBehavior();
  if (tags.includes('candles')) return new StackingBehavior(P.candles);
  if (n === 'sea_pickle') return new StackingBehavior(P.pickles);
  if (n === 'turtle_egg') return new StackingBehavior(P.eggs, false);
  if (n === 'pink_petals' || n === 'wildflowers') return new StackingBehavior(P.flowerAmount);
  if (n === 'leaf_litter') return new StackingBehavior(P.segmentAmount);
  if (n.endsWith('_carpet') || n === 'moss_carpet') return new CarpetBehavior();
  if (n === 'grass_block' || n === 'podzol' || n === 'mycelium') return new SnowyDirtBehavior();
  if (tags.includes('chests') || n === 'void_chest') return new ChestBehavior();
  if (tags.includes('beds')) return new BedBehavior();
  if (n === 'small_dripleaf' || n === 'pitcher_crop') return new TallBlockBehavior();
  // --- orientation
  if (n === 'hopper') return new HopperBehavior();
  if (n === 'observer') return new ObserverBehavior();
  if (n === 'crafter') return new CrafterBehavior();
  if (n.endsWith('anvil')) return new AnvilBehavior();
  if (n === 'verge_rod' || n.includes('amethyst_bud') || n === 'amethyst_cluster' || n.endsWith('lightning_rod')) return new ClickedFaceBehavior();
  if (n === 'piston' || n === 'sticky_piston' || n === 'dispenser' || n === 'dropper' || n === 'barrel' || n.includes('command_block') || tags.includes('shell_boxes')) {
    return tags.includes('shell_boxes') ? new ClickedFaceBehavior6() : new Facing6Behavior();
  }
  if (has(b, P.axis) && !n.includes('chain')) return new PillarBehavior();
  if (n.includes('chain')) return new PillarBehavior();
  if (n === 'repeater' || n === 'comparator') return new FacingPlayerBehavior();
  if (n.includes('campfire') || n === 'bell' || n === 'dried_ghast') return new FacingAwayBehavior();
  if (has(b, P.facing) && !has(b, P.half) && !tags.includes('doors')) return new FacingPlayerBehavior();
  // --- plants
  if (n === 'wheat' || n === 'carrots' || n === 'potatoes' || n === 'beetroots' || n.endsWith('_stem') && !n.includes('mushroom') && !n.includes('crimson') && !n.includes('warped') && !n.includes('dripleaf') || n === 'torchflower_crop') return new PlantBehavior(SUPPORT.crop!);
  if (n === 'ember_wart') return new PlantBehavior(SUPPORT.wart!);
  if (n === 'brown_mushroom' || n === 'red_mushroom') return new PlantBehavior(SUPPORT.mushroom!);
  if (n === 'crimson_fungus' || n === 'warped_fungus' || n === 'crimson_roots' || n === 'warped_roots') return new PlantBehavior(SUPPORT.fungus!);
  if (n === 'nether_sprouts') return new PlantBehavior(SUPPORT.sprouts!);
  if (n === 'sugar_cane') return new PlantBehavior(SUPPORT.sugarCane!);
  if (n === 'cactus') return new PlantBehavior(SUPPORT.cactus!);
  if (n === 'lily_pad') return new PlantBehavior(SUPPORT.lilyPad!);
  if (n === 'seagrass' || tags.includes('corals')) return new PlantBehavior(SUPPORT.underwater!);
  if (n === 'tall_seagrass') return new TallPlantBehavior(SUPPORT.underwater!);
  if (n === 'kelp' || n === 'kelp_plant') return new PlantBehavior(SUPPORT.kelp!);
  if (n === 'sweet_berry_bush') return new PlantBehavior(SUPPORT.berry!);
  if (n === 'bamboo' || n === 'bamboo_sapling') return new PlantBehavior(SUPPORT.bamboo!);
  if (n === 'azalea' || n === 'flowering_azalea') return new PlantBehavior(SUPPORT.azalea!);
  if (n === 'big_dripleaf' || n === 'big_dripleaf_stem') return new PlantBehavior(SUPPORT.dripleaf!);
  if (n === 'dead_bush' || n === 'short_dry_grass' || n === 'tall_dry_grass' || n === 'cactus_flower') return new PlantBehavior(SUPPORT.dry!);
  if (n === 'firefly_bush') return new PlantBehavior(SUPPORT.firefly!);
  if (n === 'cocoa') return new CocoaBehavior();
  if (n === 'vine') return new VineBehavior();
  if (n === 'glow_lichen' || n === 'echo_vein') return new MultifaceBehavior();
  if (n === 'cave_vines' || n === 'cave_vines_plant') return new HangingPlantBehavior((a) => isFaceSturdy(a, 0) || blockOf(a).name.startsWith('cave_vines'));
  if (n === 'weeping_vines' || n === 'weeping_vines_plant') return new HangingPlantBehavior((a) => isFaceSturdy(a, 0) || blockOf(a).name.startsWith('weeping_vines') || hasTag(a, 'leaves'));
  if (n === 'twisting_vines' || n === 'twisting_vines_plant') return new PlantBehavior((below) => isFaceSturdy(below, 1) || blockOf(below).name.startsWith('twisting_vines'));
  if (n === 'hanging_roots' || n === 'spore_blossom') return new HangingPlantBehavior((a) => isFaceSturdy(a, 0));
  if (n === 'pale_hanging_moss') return new HangingPlantBehavior((a) => isFaceSturdy(a, 0) || hasTag(a, 'leaves') || blockOf(a).name === 'pale_hanging_moss');
  if (n === 'mangrove_propagule') return new PlantBehavior(SUPPORT.bush!);
  if (tags.includes('tall_flowers') || n === 'tall_grass' || n === 'large_fern') return new TallPlantBehavior(SUPPORT.bush!);
  if (tags.includes('saplings') || tags.includes('flowers') || n === 'short_grass' || n === 'fern' || n === 'bush') return new PlantBehavior(SUPPORT.bush!);
  return DEFAULT_BEHAVIOR;
}

/** Shell boxes face the clicked face. */
class ClickedFaceBehavior6 extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    return setValue(ctx.block.defaultState, P.facing6, ctx.face);
  }
}

let attached = false;

export function attachBehaviors(): void {
  if (attached) return;
  attached = true;
  // Derived tags used by behaviours and gameplay
  for (const b of BLOCKS) {
    if (b.name.endsWith('_stairs')) addTag('stairs_any', b);
    if (b.name.endsWith('_slab')) addTag('slabs', b);
    if (b.name.startsWith('jungle_') && (b.name.endsWith('_log') || b.name.endsWith('_wood'))) addTag('jungle_logs', b);
    if (b.name.startsWith('stripped_jungle_')) addTag('jungle_logs', b);
    if (b.name.endsWith('_button')) addTag('buttons', b);
    if (blockHasTag(b, 'logs') || blockHasTag(b, 'leaves')) addTag('replaceable_by_trees_or_logs', b);
  }
  for (const n of ['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mycelium', 'moss_block', 'pale_moss_block', 'mud', 'muddy_mangrove_roots']) {
    const b = BLOCK_BY_NAME.get(n);
    if (b) addTag('dirt', b);
  }
  for (const n of ['sand', 'red_sand', 'suspicious_sand']) {
    const b = BLOCK_BY_NAME.get(n);
    if (b) addTag('sand', b);
  }
  for (const b of BLOCKS) b.behavior = resolve(b);
}

/** Re-resolve behaviours (after later milestones register resolvers). */
export function refreshBehaviors(): void {
  for (const b of BLOCKS) b.behavior = resolve(b);
}
