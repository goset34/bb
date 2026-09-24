/**
 * Component definitions. Each field of `Components` is an optional component on an entity.
 * Components are plain data; systems (server/entity/*, common/entity/physics) implement logic.
 */
import type { ItemStack } from '../item/stack';
import type { PlayerData } from './player';

export interface Transform {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  headYaw: number;
  bodyYaw: number;
  /** Previous tick values for interpolation. */
  px: number;
  py: number;
  pz: number;
  pyaw: number;
  ppitch: number;
  pHeadYaw: number;
  pBodyYaw: number;
}

export interface Physics {
  vx: number;
  vy: number;
  vz: number;
  width: number;
  height: number;
  eyeHeight: number;
  stepHeight: number;
  gravity: number;
  onGround: boolean;
  wasOnGround: boolean;
  horizontalCollision: boolean;
  verticalCollision: boolean;
  minorHorizontalCollision: boolean;
  fallDistance: number;
  noPhysics: boolean;
  noGravity: boolean;
  inWater: boolean;
  inLava: boolean;
  underWater: boolean;
  eyeInLava: boolean;
  waterHeight: number;
  lavaHeight: number;
  inPowderSnow: boolean;
  wasInPowderSnow: boolean;
  /** Multiplier set by cobwebs / berry bushes / powder snow for one move. */
  stuckX: number;
  stuckY: number;
  stuckZ: number;
  /** Ticks remaining until another jump is allowed. */
  noJumpDelay: number;
  /** Pushable by other entities. */
  pushable: boolean;
  /** Knockback resistance 0..1. */
  knockbackResistance: number;
  /** Distance walked (for step sounds / walk animation). */
  walkDist: number;
  prevWalkDist: number;
  moveDist: number;
  nextStep: number;
  /** Last time a step sound was emitted. */
  flyDist: number;
  /** Entity floats on fluids (boats, items). */
  floats: boolean;
  /** Portal cooldown. */
  portalCooldown: number;
  /** Fire ticks remaining (>0 burning). */
  fireTicks: number;
  /** Frozen ticks (powder snow). */
  frozenTicks: number;
  /** Air supply (300 max for most mobs). */
  air: number;
  maxAir: number;
  /** Mob is immune to fire / lava damage. */
  fireImmune: boolean;
}

/** Movement intent written by input (players) or AI (mobs), consumed by the physics system. */
export interface MoveInput {
  forward: number;
  strafe: number;
  up: number;
  jumping: boolean;
  sneaking: boolean;
  sprinting: boolean;
  /** Movement speed attribute (blocks/tick scale), 0.1 for players. */
  speed: number;
  flying: boolean;
  flySpeed: number;
  fallFlying: boolean;
  swimming: boolean;
  usingItem: boolean;
  /** Mob navigation writes a target speed multiplier. */
  speedModifier: number;
}

export interface ItemEntityData {
  stack: ItemStack;
  pickupDelay: number;
  age: number;
  owner?: number;
  thrower?: number;
  bob: number;
  health: number;
}

export interface ExperienceOrbData {
  value: number;
  age: number;
  count: number;
  followTarget?: number;
}

export interface NetSync {
  /** Last position/rotation sent to clients (to compute deltas). */
  lastX: number;
  lastY: number;
  lastZ: number;
  lastYaw: number;
  lastPitch: number;
  lastHeadYaw: number;
  lastVx: number;
  lastVy: number;
  lastVz: number;
  /** Tracking range in blocks. */
  range: number;
  /** Players currently tracking this entity. */
  trackers: Set<number>;
  updateInterval: number;
  forceSync: boolean;
  metaDirty: boolean;
}

/** Client-side interpolation state. */
export interface ClientInterp {
  /** Snapshot buffer (server tick, x, y, z, yaw, pitch, headYaw). */
  snaps: Array<{ t: number; x: number; y: number; z: number; yaw: number; pitch: number; headYaw: number }>;
  /** Animation state */
  limbSwing: number;
  limbSwingAmount: number;
  prevLimbSwingAmount: number;
  swingProgress: number;
  prevSwingProgress: number;
  swinging: boolean;
  swingTime: number;
  hurtTime: number;
  deathTime: number;
  age: number;
}

/** Generic per-type metadata synchronised to clients (colors, variants, flags…). */
export type Meta = Record<string, number | string | boolean>;

export interface Components {
  transform: Transform;
  physics: Physics;
  input: MoveInput;
  item: ItemEntityData;
  xpOrb: ExperienceOrbData;
  net: NetSync;
  interp: ClientInterp;
  meta: Meta;
  player: PlayerData;
  /** Arbitrary extension components registered by later systems. */
  [key: string]: unknown;
}

export function makeTransform(x: number, y: number, z: number, yaw = 0, pitch = 0): Transform {
  return { x, y, z, yaw, pitch, headYaw: yaw, bodyYaw: yaw, px: x, py: y, pz: z, pyaw: yaw, ppitch: pitch, pHeadYaw: yaw, pBodyYaw: yaw };
}

export function makePhysics(width: number, height: number, eyeHeight = height * 0.85): Physics {
  return {
    vx: 0, vy: 0, vz: 0, width, height, eyeHeight, stepHeight: 0.6, gravity: 0.08,
    onGround: false, wasOnGround: false, horizontalCollision: false, verticalCollision: false, minorHorizontalCollision: false,
    fallDistance: 0, noPhysics: false, noGravity: false,
    inWater: false, inLava: false, underWater: false, eyeInLava: false, waterHeight: 0, lavaHeight: 0,
    inPowderSnow: false, wasInPowderSnow: false,
    stuckX: 0, stuckY: 0, stuckZ: 0, noJumpDelay: 0, pushable: true, knockbackResistance: 0,
    walkDist: 0, prevWalkDist: 0, moveDist: 0, nextStep: 1, flyDist: 0, floats: false,
    portalCooldown: 0, fireTicks: 0, frozenTicks: 0, air: 300, maxAir: 300, fireImmune: false,
  };
}

export function makeInput(speed = 0.1): MoveInput {
  return {
    forward: 0, strafe: 0, up: 0, jumping: false, sneaking: false, sprinting: false, speed,
    flying: false, flySpeed: 0.05, fallFlying: false, swimming: false, usingItem: false, speedModifier: 1,
  };
}
