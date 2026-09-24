/** Block state properties. Values are stored as indices; names are used for (de)serialisation. */
import { Direction, DIR_NAMES } from '../world/direction';

export type PropValue = string | number | boolean;

export class Property<T extends PropValue = PropValue> {
  readonly names: readonly string[];
  constructor(readonly name: string, readonly values: readonly T[], names?: readonly string[]) {
    this.names = names ?? values.map((v) => String(v));
  }

  get count(): number {
    return this.values.length;
  }

  indexOf(v: T): number {
    const i = this.values.indexOf(v);
    if (i < 0) throw new Error(`Invalid value ${String(v)} for property ${this.name}`);
    return i;
  }

  indexOfName(n: string): number {
    return this.names.indexOf(n);
  }
}

export class BoolProperty extends Property<boolean> {
  constructor(name: string) {
    super(name, [false, true]);
  }
}

export class IntProperty extends Property<number> {
  constructor(name: string, readonly min: number, readonly max: number) {
    const v: number[] = [];
    for (let i = min; i <= max; i++) v.push(i);
    super(name, v);
  }
}

export class EnumProperty<T extends string = string> extends Property<T> {
  constructor(name: string, values: readonly T[]) {
    super(name, values);
  }
}

export class DirProperty extends Property<Direction> {
  constructor(name: string, dirs: readonly Direction[]) {
    super(name, dirs, dirs.map((d) => DIR_NAMES[d]));
  }
}

// ---------------------------------------------------------------------------------------------
// Shared property instances (identity matters: blocks share the same objects).
// ---------------------------------------------------------------------------------------------
export const P = {
  /** Horizontal facing. */
  facing: new DirProperty('facing', [2, 3, 4, 5]),
  /** Any of the six directions. */
  facing6: new DirProperty('facing', [0, 1, 2, 3, 4, 5]),
  /** Hopper facing (no up). */
  hopperFacing: new DirProperty('facing', [0, 2, 3, 4, 5]),
  axis: new EnumProperty('axis', ['x', 'y', 'z'] as const),
  hAxis: new EnumProperty('axis', ['x', 'z'] as const),
  half: new EnumProperty('half', ['top', 'bottom'] as const),
  doubleHalf: new EnumProperty('half', ['upper', 'lower'] as const),
  slabType: new EnumProperty('type', ['top', 'bottom', 'double'] as const),
  stairShape: new EnumProperty('shape', ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'] as const),
  waterlogged: new BoolProperty('waterlogged'),
  powered: new BoolProperty('powered'),
  open: new BoolProperty('open'),
  lit: new BoolProperty('lit'),
  snowy: new BoolProperty('snowy'),
  persistent: new BoolProperty('persistent'),
  distance7: new IntProperty('distance', 1, 7),
  age1: new IntProperty('age', 0, 1),
  age2: new IntProperty('age', 0, 2),
  age3: new IntProperty('age', 0, 3),
  age4: new IntProperty('age', 0, 4),
  age5: new IntProperty('age', 0, 5),
  age7: new IntProperty('age', 0, 7),
  age15: new IntProperty('age', 0, 15),
  age25: new IntProperty('age', 0, 25),
  stage: new IntProperty('stage', 0, 1),
  level15: new IntProperty('level', 0, 15),
  level8: new IntProperty('level', 0, 8),
  cauldronLevel: new IntProperty('level', 1, 3),
  composterLevel: new IntProperty('level', 0, 8),
  lightLevel: new IntProperty('level', 0, 15),
  power: new IntProperty('power', 0, 15),
  layers: new IntProperty('layers', 1, 8),
  moisture: new IntProperty('moisture', 0, 7),
  rotation16: new IntProperty('rotation', 0, 15),
  delay: new IntProperty('delay', 1, 4),
  locked: new BoolProperty('locked'),
  comparatorMode: new EnumProperty('mode', ['compare', 'subtract'] as const),
  hinge: new EnumProperty('hinge', ['left', 'right'] as const),
  inWall: new BoolProperty('in_wall'),
  attachFace: new EnumProperty('face', ['floor', 'wall', 'ceiling'] as const),
  north: new BoolProperty('north'),
  east: new BoolProperty('east'),
  south: new BoolProperty('south'),
  west: new BoolProperty('west'),
  up: new BoolProperty('up'),
  down: new BoolProperty('down'),
  wallNorth: new EnumProperty('north', ['none', 'low', 'tall'] as const),
  wallEast: new EnumProperty('east', ['none', 'low', 'tall'] as const),
  wallSouth: new EnumProperty('south', ['none', 'low', 'tall'] as const),
  wallWest: new EnumProperty('west', ['none', 'low', 'tall'] as const),
  wireNorth: new EnumProperty('north', ['none', 'side', 'up'] as const),
  wireEast: new EnumProperty('east', ['none', 'side', 'up'] as const),
  wireSouth: new EnumProperty('south', ['none', 'side', 'up'] as const),
  wireWest: new EnumProperty('west', ['none', 'side', 'up'] as const),
  railShape: new EnumProperty('shape', ['north_south', 'east_west', 'ascending_east', 'ascending_west', 'ascending_north', 'ascending_south', 'south_east', 'south_west', 'north_west', 'north_east'] as const),
  railShapeStraight: new EnumProperty('shape', ['north_south', 'east_west', 'ascending_east', 'ascending_west', 'ascending_north', 'ascending_south'] as const),
  bedPart: new EnumProperty('part', ['head', 'foot'] as const),
  occupied: new BoolProperty('occupied'),
  chestType: new EnumProperty('type', ['single', 'left', 'right'] as const),
  pistonType: new EnumProperty('type', ['normal', 'sticky'] as const),
  extended: new BoolProperty('extended'),
  short: new BoolProperty('short'),
  triggered: new BoolProperty('triggered'),
  enabled: new BoolProperty('enabled'),
  inverted: new BoolProperty('inverted'),
  attached: new BoolProperty('attached'),
  disarmed: new BoolProperty('disarmed'),
  hasBook: new BoolProperty('has_book'),
  hasRecord: new BoolProperty('has_record'),
  hasBottle0: new BoolProperty('has_bottle_0'),
  hasBottle1: new BoolProperty('has_bottle_1'),
  hasBottle2: new BoolProperty('has_bottle_2'),
  eye: new BoolProperty('eye'),
  hanging: new BoolProperty('hanging'),
  signalFire: new BoolProperty('signal_fire'),
  bites: new IntProperty('bites', 0, 6),
  candles: new IntProperty('candles', 1, 4),
  pickles: new IntProperty('pickles', 1, 4),
  eggs: new IntProperty('eggs', 1, 4),
  hatch: new IntProperty('hatch', 0, 2),
  charges: new IntProperty('charges', 0, 4),
  honeyLevel: new IntProperty('honey_level', 0, 5),
  note: new IntProperty('note', 0, 24),
  instrument: new EnumProperty('instrument', ['harp', 'basedrum', 'snare', 'hat', 'bass', 'flute', 'bell', 'guitar', 'chime', 'xylophone', 'iron_xylophone', 'cow_bell', 'didgeridoo', 'bit', 'banjo', 'pling', 'zombie', 'skeleton', 'hisser', 'dragon', 'blight_skeleton', 'swinekin', 'custom_head'] as const),
  leaves: new EnumProperty('leaves', ['none', 'small', 'large'] as const),
  bambooAge: new IntProperty('age', 0, 1),
  bambooStage: new IntProperty('stage', 0, 1),
  thickness: new EnumProperty('thickness', ['tip_merge', 'tip', 'frustum', 'middle', 'base'] as const),
  verticalDirection: new DirProperty('vertical_direction', [0, 1]),
  tilt: new EnumProperty('tilt', ['none', 'unstable', 'partial', 'full'] as const),
  echoPhase: new EnumProperty('echo_sensor_phase', ['inactive', 'active', 'cooldown'] as const),
  bloom: new BoolProperty('bloom'),
  shrieking: new BoolProperty('shrieking'),
  canSummon: new BoolProperty('can_summon'),
  berries: new BoolProperty('berries'),
  tip: new BoolProperty('tip'),
  orientation: new EnumProperty('orientation', ['down_east', 'down_north', 'down_south', 'down_west', 'up_east', 'up_north', 'up_south', 'up_west', 'west_up', 'east_up', 'north_up', 'south_up'] as const),
  attachment: new EnumProperty('attachment', ['floor', 'ceiling', 'single_wall', 'double_wall'] as const),
  bellAttachment: new EnumProperty('attachment', ['floor', 'ceiling', 'single_wall', 'double_wall'] as const),
  structureMode: new EnumProperty('mode', ['save', 'load', 'corner', 'data'] as const),
  trialState: new EnumProperty('trial_spawner_state', ['inactive', 'waiting_for_players', 'active', 'waiting_for_reward_ejection', 'ejecting_reward', 'cooldown'] as const),
  vaultState: new EnumProperty('vault_state', ['inactive', 'active', 'unlocking', 'ejecting'] as const),
  ominous: new BoolProperty('ominous'),
  crafting: new BoolProperty('crafting'),
  cracked: new BoolProperty('cracked'),
  flowerAmount: new IntProperty('flower_amount', 1, 4),
  segmentAmount: new IntProperty('segment_amount', 1, 4),
  dusted: new IntProperty('dusted', 0, 3),
  slot0: new BoolProperty('slot_0_occupied'),
  slot1: new BoolProperty('slot_1_occupied'),
  slot2: new BoolProperty('slot_2_occupied'),
  slot3: new BoolProperty('slot_3_occupied'),
  slot4: new BoolProperty('slot_4_occupied'),
  slot5: new BoolProperty('slot_5_occupied'),
  groanerState: new EnumProperty('groaner_heart_state', ['uprooted', 'dormant', 'awake'] as const),
  natural: new BoolProperty('natural'),
  paleTip: new EnumProperty('tip', ['false', 'true'] as const),
  moistureBool: new BoolProperty('moist'),
  inOrientation: new DirProperty('facing', [2, 3, 4, 5]),
  mossyBottom: new BoolProperty('bottom'),
  conditional: new BoolProperty('conditional'),
  unstable: new BoolProperty('unstable'),
  drag: new BoolProperty('drag'),
  summoned: new BoolProperty('summoned'),
  eggsSniffer: new IntProperty('hatch', 0, 2),
  hydration: new IntProperty('hydration', 0, 3),
  sideChain: new EnumProperty('side_chain', ['unconnected', 'right', 'center', 'left'] as const),
} as const;

/** The six boolean connection props for multi-face blocks (glow lichen, echo veins, vines…). */
export const FACE_PROPS: readonly BoolProperty[] = [P.down, P.up, P.north, P.south, P.west, P.east];
