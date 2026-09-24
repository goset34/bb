/**
 * Local player: input sampling, client-side prediction with server reconciliation, block
 * interaction (breaking/placing with prediction) and camera state.
 */
import { Entity } from '../common/entity/ecs';
import { makeInput, makePhysics, makeTransform } from '../common/entity/components';
import { tickLivingMovement, DEFAULT_TRAVEL, TravelOptions } from '../common/entity/physics';
import { abilitiesFor, GameMode, Inventory, PlayerData } from '../common/entity/player';
import { INPUT } from '../common/net/protocol';
import type { ClientLevel } from './world';
import { PredictionLevel } from './world';
import { Input } from './input/input';
import { raycastBlocks, BlockHit } from '../common/world/raycast';
import { lookVector } from '../common/math/geom';
import { blockOf, stateFlags, F, getOutlineShape, isReplaceable, getCollisionShape, blockHasTag, S } from '../common/block/registry';
import { blockForItem, getItem } from '../common/item/items';
import { ItemStack } from '../common/item/stack';
import type { ClientEntities, ClientEntity } from './entities';
import { riderSeat } from './entities';
import { BlockPlaceContext } from '../common/world/placecontext';
import { DX, DY, DZ, Direction } from '../common/world/direction';
import { destroyProgressPerTick } from '../common/item/mining';
import { AABB } from '../common/math/geom';
import type { Packet } from '../common/net/protocol';

export type LocalPlayerEntity = Entity & Required<Pick<Entity, 'transform' | 'physics' | 'input' | 'player'>>;

interface HistoryEntry {
  seq: number;
  forward: number;
  strafe: number;
  yaw: number;
  pitch: number;
  flags: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
}

export class LocalPlayer {
  readonly entity: LocalPlayerEntity;
  private seq = 0;
  private history: HistoryEntry[] = [];
  private readonly prediction: PredictionLevel;
  target: BlockHit | null = null;
  /** Survival digging progress. */
  digging: { x: number; y: number; z: number; progress: number; face: Direction } | null = null;
  private attackCooldown = 0;
  private useCooldown = 0;
  corrections = 0;
  travel: TravelOptions = { ...DEFAULT_TRAVEL };
  thirdPerson: 0 | 1 | 2 = 0;
  /** Walk bob state for camera. */
  bob = 0;
  prevBob = 0;
  sprintToggle = false;
  // Survival state (from the server)
  health = 20;
  maxHealth = 20;
  absorption = 0;
  food = 20;
  saturation = 5;
  air = 300;
  maxAir = 300;
  frozen = 0;
  xpLevel = 0;
  xpProgress = 0;
  xpTotal = 0;
  dead = false;
  /** Ticks since the last health decrease (HUD heart flash). */
  lastHurtTick = -100;
  hurtTilt = 0;
  /** Entity under the crosshair (closer than the block target). */
  targetEntity: ClientEntity | null = null;
  entities: ClientEntities | null = null;
  /** Entity id of the vehicle being ridden (server authoritative), or null. */
  vehicle: number | null = null;
  /** Ticks since the last attack (attack strength indicator). */
  attackTicker = 100;
  /** Third-person animation state (same shape as ClientInterp's animation fields). */
  readonly anim = { limbSwing: 0, limbSwingAmount: 0, prevLimbSwingAmount: 0, swingTime: 0, swinging: false, swingOffhand: false, hurtTime: 0, deathTime: 0, age: 0 };
  /** First-person hand animation. */
  readonly hand = { equip: 1, prevEquip: 1, shown: ItemStack.empty(), swing: 0, prevSwing: 0, using: false, useTicks: 0, useStack: ItemStack.empty(), useOffhand: false };
  private swingTicks = -1;
  /** Bed facing while sleeping (null = awake). Movement is frozen while asleep. */
  sleeping: number | null = null;
  sleepTicks = 0;
  /** Item cooldowns (item id → end tick). */
  readonly cooldowns = new Map<string, number>();

  constructor(readonly level: ClientLevel, private readonly send: (p: Packet) => void) {
    const player: PlayerData = { name: '', gameMode: 'survival', abilities: abilitiesFor('survival'), inventory: new Inventory(), lastInputSeq: 0 };
    this.entity = {
      id: 0, type: 'player', removed: false,
      transform: makeTransform(0, 100, 0), physics: makePhysics(0.6, 1.8, 1.62), input: makeInput(0.1), player, meta: {},
    } as LocalPlayerEntity;
    this.prediction = new PredictionLevel(level);
  }

  get gameMode(): GameMode {
    return this.entity.player.gameMode;
  }

  get inventory(): Inventory {
    return this.entity.player.inventory;
  }

  setGameMode(mode: GameMode): void {
    const p = this.entity.player;
    p.gameMode = mode;
    p.abilities = abilitiesFor(mode);
    this.entity.physics.noPhysics = mode === 'spectator';
    if (mode === 'spectator') this.entity.input.flying = true;
    else if (!p.abilities.mayFly) this.entity.input.flying = false;
  }

  eyePos(partial = 1): [number, number, number] {
    const t = this.entity.transform;
    return [t.px + (t.x - t.px) * partial, t.py + (t.y - t.py) * partial + this.entity.physics.eyeHeight, t.pz + (t.z - t.pz) * partial];
  }

  reach(): number {
    return this.gameMode === 'creative' ? 5 : 4.5;
  }

  // ------------------------------------------------------------------------------------------
  // Look (per frame, not per tick, for smooth mouse)
  // ------------------------------------------------------------------------------------------
  look(dx: number, dy: number): void {
    const t = this.entity.transform;
    t.yaw += dx;
    t.pitch = Math.max(-90, Math.min(90, t.pitch + dy));
  }

  // ------------------------------------------------------------------------------------------
  // Tick
  // ------------------------------------------------------------------------------------------
  tick(input: Input, uiOpen: boolean): void {
    if (this.dead) uiOpen = true;
    if (this.sleeping !== null) {
      this.sleepTicks++;
      const t0 = this.entity.transform;
      t0.px = t0.x; t0.py = t0.y; t0.pz = t0.z;
      this.tickAnimation();
      return;
    }
    const e = this.entity;
    const t = e.transform;
    t.px = t.x; t.py = t.y; t.pz = t.z; t.pyaw = t.yaw; t.ppitch = t.pitch;
    this.prevBob = this.bob;
    const inp = e.input;
    const a = e.player.abilities;
    let forward = 0, strafe = 0;
    if (!uiOpen) {
      if (input.isDown('forward')) forward += 1;
      if (input.isDown('back')) forward -= 1;
      if (input.isDown('left')) strafe += 1;
      if (input.isDown('right')) strafe -= 1;
      if (input.moveY !== 0 || input.moveX !== 0) { forward = -input.moveY; strafe = -input.moveX; }
    }
    const jump = !uiOpen && input.isDown('jump');
    const sneak = !uiOpen && input.isDown('sneak');
    const wantSprint = !uiOpen && (input.isDown('sprint') || input.doubleTapSprint || this.sprintToggle);
    // Double-tap jump toggles flight
    if (!uiOpen && input.pressed('jump') && a.mayFly) {
      const now = performance.now();
      if (now - this.lastJumpTap < 300 && this.gameMode !== 'spectator') {
        inp.flying = !inp.flying;
        a.flying = inp.flying;
        this.send({ type: 'abilities', flying: inp.flying });
      }
      this.lastJumpTap = now;
    }
    inp.forward = forward;
    inp.strafe = strafe;
    inp.jumping = jump;
    inp.sneaking = sneak;
    const canSprint = forward > 0 && !sneak && (this.food > 6 || a.mayFly);
    inp.sprinting = canSprint && (wantSprint || (inp.sprinting && forward > 0));
    if (e.physics.horizontalCollision && !e.physics.minorHorizontalCollision) inp.sprinting = false;
    inp.speed = a.walkSpeed;
    inp.flySpeed = a.flySpeed;
    inp.flying = a.mayFly && inp.flying;
    this.updatePose();
    let flags = 0;
    if (jump) flags |= INPUT.JUMP;
    if (sneak) flags |= INPUT.SNEAK;
    if (inp.sprinting) flags |= INPUT.SPRINT;
    if (inp.flying) flags |= INPUT.FLYING;
    if (inp.fallFlying) flags |= INPUT.FALL_FLYING;
    if (inp.usingItem) flags |= INPUT.USING_ITEM;
    // Predict (riders are carried by their vehicle: sit on its seat instead)
    const v = this.vehicle !== null ? this.entities?.get(this.vehicle) : undefined;
    if (v) {
      const seat = riderSeat(v);
      t.x = seat[0]; t.y = seat[1]; t.z = seat[2];
      e.physics.vx = e.physics.vy = e.physics.vz = 0;
      e.physics.onGround = false;
      e.physics.fallDistance = 0;
    } else tickLivingMovement(this.level, e, this.travel);
    if (inp.flying && e.physics.onGround && this.gameMode !== 'spectator') {
      inp.flying = false;
      a.flying = false;
    }
    const seq = ++this.seq;
    this.history.push({ seq, forward, strafe, yaw: t.yaw, pitch: t.pitch, flags, x: t.x, y: t.y, z: t.z, vx: e.physics.vx, vy: e.physics.vy, vz: e.physics.vz, onGround: e.physics.onGround });
    if (this.history.length > 200) this.history.shift();
    this.send({ type: 'input', seq, forward, strafe, yaw: t.yaw, pitch: t.pitch, flags, clientTick: this.level.gameTime });
    // Walk bob
    const moved = Math.hypot(t.x - t.px, t.z - t.pz);
    if (e.physics.onGround && !inp.flying) this.bob += moved * 0.6;
    // Interaction
    this.updateTarget();
    if (!uiOpen) this.interact(input);
    else this.stopUsingItem();
    this.tickAnimation();
  }

  /** Third-person limb/arm animation and first-person hand state. */
  private tickAnimation(): void {
    const t = this.entity.transform, a = this.anim, hs = this.hand;
    a.age++;
    this.attackTicker++;
    const dx = t.x - t.px, dz = t.z - t.pz;
    a.prevLimbSwingAmount = a.limbSwingAmount;
    const dist = Math.min(1, Math.sqrt(dx * dx + dz * dz) * 4);
    a.limbSwingAmount += (dist - a.limbSwingAmount) * 0.4;
    a.limbSwing += a.limbSwingAmount;
    // Body yaw follows the head within 50°
    let diff = ((t.yaw - t.bodyYaw) % 360 + 540) % 360 - 180;
    if (dx * dx + dz * dz > 0.0025) t.bodyYaw += diff * 0.3;
    diff = ((t.yaw - t.bodyYaw) % 360 + 540) % 360 - 180;
    if (diff > 50) t.bodyYaw = t.yaw - 50;
    if (diff < -50) t.bodyYaw = t.yaw + 50;
    t.pHeadYaw = t.headYaw;
    t.headYaw = t.yaw;
    if (a.hurtTime > 0) a.hurtTime--;
    if (this.dead && a.deathTime < 20) a.deathTime++;
    if (!this.dead) a.deathTime = 0;
    this.hurtTilt = Math.max(0, this.hurtTilt - 1);
    // Swing (6 ticks)
    hs.prevSwing = hs.swing;
    if (this.swingTicks >= 0) {
      this.swingTicks++;
      if (this.swingTicks >= 6) this.swingTicks = -1;
    }
    hs.swing = this.swingTicks < 0 ? 0 : this.swingTicks / 6;
    a.swinging = this.swingTicks >= 0;
    a.swingTime = Math.max(0, this.swingTicks);
    // Re-equip animation when the held item changes
    const held = this.inventory.mainHand;
    hs.prevEquip = hs.equip;
    const same = held.id === hs.shown.id || (held.isEmpty() && hs.shown.isEmpty());
    const target = same ? 1 : 0;
    hs.equip += Math.max(-0.4, Math.min(0.4, target - hs.equip));
    if (hs.equip < 0.1 || same) hs.shown = held;
    if (hs.using) hs.useTicks++;
  }

  /** Start the local arm swing animation and tell the server (others see it). */
  swingArm(hand: 'main' | 'off' = 'main'): void {
    if (this.swingTicks < 0 || this.swingTicks >= 3) this.swingTicks = 0;
    this.anim.swingOffhand = hand === 'off';
    this.send({ type: 'swing', hand });
  }

  /** Server said we took damage. */
  onHurt(): void {
    this.anim.hurtTime = 10;
    this.hurtTilt = 10;
  }

  private stopUsingItem(): void {
    if (!this.hand.using) return;
    this.hand.using = false;
    this.hand.useTicks = 0;
    this.entity.input.usingItem = false;
    const t = this.entity.transform;
    this.send({ type: 'action', action: 'release_use', x: Math.floor(t.x), y: Math.floor(t.y), z: Math.floor(t.z), face: 0, seq: this.seq });
  }

  /** Can the held stack be used continuously (eaten, drunk, drawn, raised)? */
  private usable(stack: ItemStack): boolean {
    const def = getItem(stack.id);
    if (!def) return false;
    if (def.food) return def.food.alwaysEdible === true || this.food < 20 || this.gameMode === 'creative';
    if (def.useAnim === 'drink') return true;
    const creative = this.gameMode === 'creative';
    const inv = this.inventory;
    const arrows = inv.count('arrow') + inv.count('spectral_arrow') + inv.count('tipped_arrow');
    switch (stack.id) {
      case 'bow': return creative || arrows > 0 || stack.getEnchant('infinity') > 0;
      case 'crossbow': return !stack.data.charged?.length && (creative || arrows > 0 || inv.count('firework_rocket') > 0);
      case 'trident': {
        if (stack.getEnchant('riptide') === 0) return true;
        const t = this.entity.transform;
        const c = this.level.getChunk(Math.floor(t.x) >> 4, Math.floor(t.z) >> 4);
        return this.entity.physics.inWater || (this.level.rain > 0.2 && !!c && c.motion.get(Math.floor(t.x) & 15, Math.floor(t.z) & 15) <= Math.floor(t.y + 1));
      }
      case 'shield': case 'spyglass': return true;
      case 'goat_horn': return !((this.cooldowns.get('goat_horn') ?? 0) > this.level.gameTime);
    }
    return false;
  }

  drop(all: boolean): void {
    const inv = this.inventory;
    const s = inv.mainHand;
    if (s.isEmpty() || this.gameMode === 'spectator') return;
    const t = this.entity.transform;
    this.send({ type: 'action', action: all ? 'drop_all' : 'drop_item', x: Math.floor(t.x), y: Math.floor(t.y), z: Math.floor(t.z), face: 0, seq: this.seq });
    if (all) inv.set(inv.selected, ItemStack.empty());
    else {
      s.count--;
      if (s.count <= 0) inv.set(inv.selected, ItemStack.empty());
      else inv.revision++;
    }
    this.swingArm();
  }

  swapHands(): void {
    if (this.gameMode === 'spectator') return;
    const t = this.entity.transform;
    this.send({ type: 'action', action: 'swap_hands', x: Math.floor(t.x), y: Math.floor(t.y), z: Math.floor(t.z), face: 0, seq: this.seq });
  }

  private lastJumpTap = 0;

  private updatePose(): void {
    const e = this.entity, p = e.physics;
    let h = 1.8, eye = 1.62;
    if (e.input.fallFlying || e.input.swimming) { h = 0.6; eye = 0.4; }
    else if (e.input.sneaking && !e.input.flying) { h = 1.5; eye = 1.27; }
    if (h < p.height || this.canFit(h)) {
      p.height = h;
      p.eyeHeight = eye;
    }
  }

  private canFit(h: number): boolean {
    const t = this.entity.transform;
    const box = new AABB(t.x - 0.3, t.y, t.z - 0.3, t.x + 0.3, t.y + h, t.z + 0.3);
    for (let x = Math.floor(box.minX); x <= Math.floor(box.maxX); x++) for (let y = Math.floor(box.minY); y <= Math.floor(box.maxY); y++) for (let z = Math.floor(box.minZ); z <= Math.floor(box.maxZ); z++) {
      const s = getCollisionShape(this.level.getBlockState(x, y, z));
      for (let i = 0; i < s.length; i += 6) if (box.intersectsRaw(x + s[i]!, y + s[i + 1]!, z + s[i + 2]!, x + s[i + 3]!, y + s[i + 4]!, z + s[i + 5]!)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // Reconciliation
  // ------------------------------------------------------------------------------------------
  onMoveAck(p: Packet): void {
    if (this.vehicle !== null) return;
    const seq = p['seq'] as number;
    while (this.history.length && this.history[0]!.seq < seq) this.history.shift();
    const h = this.history[0];
    if (!h || h.seq !== seq) return;
    const sx = p['x'] as number, sy = p['y'] as number, sz = p['z'] as number;
    const err = Math.abs(h.x - sx) + Math.abs(h.y - sy) + Math.abs(h.z - sz);
    const flags = p['flags'] as number;
    const e = this.entity;
    if (err < 1e-4) return;
    // Mismatch: rewind to server state and replay unacknowledged inputs
    this.corrections++;
    const t = e.transform, ph = e.physics;
    const renderOffset = [t.x, t.y, t.z];
    t.x = sx; t.y = sy; t.z = sz;
    ph.vx = p['vx'] as number; ph.vy = p['vy'] as number; ph.vz = p['vz'] as number;
    ph.onGround = p['onGround'] as boolean;
    ph.fallDistance = p['fallDistance'] as number;
    e.input.flying = (flags & 1) !== 0;
    e.player.abilities.flying = e.input.flying;
    h.x = sx; h.y = sy; h.z = sz;
    const savedYaw = t.yaw, savedPitch = t.pitch;
    for (let i = 1; i < this.history.length; i++) {
      const r = this.history[i]!;
      t.yaw = r.yaw; t.pitch = r.pitch;
      e.input.forward = r.forward; e.input.strafe = r.strafe;
      e.input.jumping = (r.flags & INPUT.JUMP) !== 0;
      e.input.sneaking = (r.flags & INPUT.SNEAK) !== 0;
      e.input.sprinting = (r.flags & INPUT.SPRINT) !== 0;
      e.input.flying = (r.flags & INPUT.FLYING) !== 0;
      tickLivingMovement(this.level, e, this.travel);
      r.x = t.x; r.y = t.y; r.z = t.z; r.vx = ph.vx; r.vy = ph.vy; r.vz = ph.vz; r.onGround = ph.onGround;
    }
    t.yaw = savedYaw; t.pitch = savedPitch;
    // Smooth small corrections by shifting the previous position too
    const dx = t.x - renderOffset[0]!, dy = t.y - renderOffset[1]!, dz = t.z - renderOffset[2]!;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1) { t.px += dx; t.py += dy; t.pz += dz; }
  }

  onTeleport(p: Packet): void {
    const t = this.entity.transform, ph = this.entity.physics;
    t.x = t.px = p['x'] as number;
    t.y = t.py = p['y'] as number;
    t.z = t.pz = p['z'] as number;
    t.yaw = t.pyaw = p['yaw'] as number;
    t.pitch = t.ppitch = p['pitch'] as number;
    ph.vx = p['vx'] as number; ph.vy = p['vy'] as number; ph.vz = p['vz'] as number;
    this.history = [];
    this.send({ type: 'teleportConfirm', teleportId: p['teleportId'] as number });
  }

  // ------------------------------------------------------------------------------------------
  // Targeting & interaction
  // ------------------------------------------------------------------------------------------
  private updateTarget(): void {
    if (this.gameMode === 'spectator') {
      this.target = null;
      return;
    }
    const [ex, ey, ez] = this.eyePos();
    const t = this.entity.transform;
    const [dx, dy, dz] = lookVector(t.yaw, t.pitch);
    this.target = raycastBlocks(this.level, ex, ey, ez, dx, dy, dz, this.reach());
    // Entities within attack reach that are closer than the block hit
    this.targetEntity = null;
    if (!this.entities) return;
    const reach = this.gameMode === 'creative' ? 5 : 3;
    let best = this.target ? Math.min(this.target.distance, reach) : reach;
    for (const e of this.entities.byId.values()) {
      if (e.type === 'item' || e.type === 'xp_orb' || e.interp.deathTime > 0 || e.interp.pickup) continue;
      const et = e.transform, hw = e.physics.width / 2 + 0.1, h = e.physics.height + 0.1;
      const d = rayBox(ex, ey, ez, dx, dy, dz, et.x - hw, et.y - 0.1, et.z - hw, et.x + hw, et.y + h, et.z + hw);
      if (d >= 0 && d < best) {
        best = d;
        this.targetEntity = e;
      }
    }
    if (this.targetEntity) this.target = null;
  }

  selectionShape(): { shape: Float32Array; x: number; y: number; z: number } | null {
    const h = this.target;
    if (!h) return null;
    return { shape: getOutlineShape(h.state), x: h.x, y: h.y, z: h.z };
  }

  private interact(input: Input): void {
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.useCooldown > 0) this.useCooldown--;
    const h = this.target;
    const creative = this.gameMode === 'creative';
    const hs = this.hand;
    // Continuous use (eating, drawing a bow, blocking) ends when the button is released
    const usedNow = hs.useOffhand ? this.inventory.offHand : this.inventory.mainHand;
    if (hs.using && (!input.isDown('use') || usedNow.id !== hs.useStack.id)) this.stopUsingItem();
    // Attack entity
    if (input.pressed('attack') && this.targetEntity && !hs.using) {
      this.send({ type: 'interact', entityId: this.targetEntity.id, kind: 'attack', hand: 'main', hx: 0, hy: 0, hz: 0, sneaking: this.entity.input.sneaking, clientTick: this.level.gameTime });
      this.swingArm();
      this.attackTicker = 0;
      this.attackCooldown = 2;
      return;
    }
    if (input.pressed('attack') && !h && !this.targetEntity) {
      // Swing at the air resets the attack charge
      this.swingArm();
      this.attackTicker = 0;
    }
    // Attack / break
    if (input.isDown('attack') && h && !hs.using) {
      if (creative) {
        if (input.pressed('attack') || this.attackCooldown === 0) {
          this.send({ type: 'action', action: 'start_dig', x: h.x, y: h.y, z: h.z, face: h.face, seq: this.seq });
          this.predictBreak(h.x, h.y, h.z);
          this.swingArm();
          this.attackCooldown = 5;
        }
      } else if (this.gameMode === 'survival') {
        const d = this.digging;
        if (!d || d.x !== h.x || d.y !== h.y || d.z !== h.z) {
          if (d) this.send({ type: 'action', action: 'abort_dig', x: d.x, y: d.y, z: d.z, face: d.face, seq: this.seq });
          this.digging = { x: h.x, y: h.y, z: h.z, progress: 0, face: h.face };
          this.send({ type: 'action', action: 'start_dig', x: h.x, y: h.y, z: h.z, face: h.face, seq: this.seq });
        }
        const dg = this.digging!;
        const inWater = this.entity.physics.underWater;
        dg.progress += destroyProgressPerTick(this.inventory.mainHand, h.state, { efficiency: this.inventory.mainHand.getEnchant('efficiency'), haste: this.effectLevel('haste'), miningFatigue: this.effectLevel('mining_fatigue'), inWater, aquaAffinity: this.inventory.get(39).getEnchant('aqua_affinity') > 0, onGround: this.entity.physics.onGround || this.entity.input.flying, breakSpeed: 1 });
        if (this.level.gameTime % 4 === 0) this.swingArm();
        if (dg.progress >= 1) {
          this.send({ type: 'action', action: 'finish_dig', x: dg.x, y: dg.y, z: dg.z, face: dg.face, seq: this.seq });
          this.predictBreak(dg.x, dg.y, dg.z);
          this.digging = null;
          this.attackCooldown = 5;
        }
      }
    } else if (this.digging) {
      const d = this.digging;
      this.send({ type: 'action', action: 'abort_dig', x: d.x, y: d.y, z: d.z, face: d.face, seq: this.seq });
      this.digging = null;
    }
    // Use / place
    const useNow = input.pressed('use') || (input.isDown('use') && this.useCooldown === 0);
    if (useNow && !hs.using) {
      this.useCooldown = 4;
      const stack = this.inventory.mainHand;
      const cd = this.cooldowns.get(stack.id);
      if (cd !== undefined && cd > this.level.gameTime) return;
      if (this.targetEntity) {
        this.send({ type: 'interact', entityId: this.targetEntity.id, kind: 'interact', hand: 'main', hx: 0, hy: 0, hz: 0, sneaking: this.entity.input.sneaking, clientTick: this.level.gameTime });
        this.swingArm();
      } else if (h) {
        const hx = h.px - h.x, hy = h.py - h.y, hz = h.pz - h.z;
        this.send({ type: 'useItemOn', x: h.x, y: h.y, z: h.z, face: h.face, hx, hy, hz, hand: 'main', seq: this.seq, inside: false });
        if (this.predictPlace(h, hx, hy, hz)) this.swingArm();
      } else if (!stack.isEmpty()) {
        const t = this.entity.transform;
        this.send({ type: 'useItem', hand: 'main', seq: this.seq, yaw: t.yaw, pitch: t.pitch });
      }
      const interactive = !!(h && this.isInteractive(h.state));
      if (!stack.isEmpty() && this.usable(stack) && !interactive) {
        hs.using = true;
        hs.useTicks = 0;
        hs.useStack = stack;
        hs.useOffhand = false;
        this.entity.input.usingItem = true;
      } else if (!interactive && !this.targetEntity) {
        // The off hand is tried when the main hand does nothing (shields, torches…)
        const off = this.inventory.offHand;
        if (!off.isEmpty() && this.usable(off) && !(stack.id !== '' && getItem(stack.id)?.block && h)) {
          const t = this.entity.transform;
          this.send({ type: 'useItem', hand: 'off', seq: this.seq, yaw: t.yaw, pitch: t.pitch });
          hs.using = true;
          hs.useTicks = 0;
          hs.useStack = off;
          hs.useOffhand = true;
          this.entity.input.usingItem = true;
        }
      }
    }
    if (input.pressed('pickBlock') && h) {
      this.send({ type: 'pickBlock', x: h.x, y: h.y, z: h.z, withData: false });
    }
  }

  /** Effect level (amplifier + 1) of the local player, 0 when absent. */
  effectLevel(id: string): number {
    const fx = this.entities?.localEffects.find((e) => e.id === id);
    return fx ? fx.amp + 1 : 0;
  }

  private isInteractive(state: number): boolean {
    const b = blockOf(state);
    return !this.entity.input.sneaking && (blockHasTag(b, 'doors') || blockHasTag(b, 'trapdoors') || blockHasTag(b, 'fence_gates') || blockHasTag(b, 'chests') || blockHasTag(b, 'beds') || blockHasTag(b, 'buttons') || ['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'lever', 'barrel', 'anvil', 'chipped_anvil', 'damaged_anvil', 'enchanting_table', 'loom', 'cartography_table', 'grindstone', 'stonecutter', 'smithing_table', 'brewing_stand', 'hopper', 'dispenser', 'dropper', 'lectern', 'crafter', 'note_block', 'jukebox', 'bell', 'beacon'].includes(b.name));
  }

  private predictBreak(x: number, y: number, z: number): void {
    const s = this.level.getBlockState(x, y, z);
    this.level.setBlock(x, y, z, stateFlags[s]! & F.WATERLOGGED ? S('water') : 0);
  }

  /** Predict a block placement; returns true when something will visibly happen (arm swing). */
  private predictPlace(h: BlockHit, hx: number, hy: number, hz: number): boolean {
    const stack = this.inventory.mainHand;
    const clicked = this.level.getBlockState(h.x, h.y, h.z);
    // Interactive blocks: don't predict (server decides)
    if (this.isInteractive(clicked)) return true;
    const block = blockForItem(stack.id);
    if (!block || stack.isEmpty()) return false;
    let x = h.x, y = h.y, z = h.z;
    const replacing = isReplaceable(clicked);
    if (!replacing) { x += DX[h.face]!; y += DY[h.face]!; z += DZ[h.face]!; }
    if (!isReplaceable(this.level.getBlockState(x, y, z))) return false;
    const t = this.entity.transform;
    const ctx = new BlockPlaceContext(this.prediction, x, y, z, h.face, replacing ? hx : hx - DX[h.face]!, replacing ? hy : hy - DY[h.face]!, replacing ? hz : hz - DZ[h.face]!, block, t.yaw, t.pitch, this.entity.input.sneaking, replacing, this.entity, stack);
    const state = block.behavior.getStateForPlacement(ctx);
    if (state === null) return false;
    // Don't place inside the player
    const shape = getCollisionShape(state);
    const px = t.x, py = t.y, pz = t.z, hw = 0.3, ph = this.entity.physics.height;
    for (let i = 0; i < shape.length; i += 6) {
      if (px + hw > x + shape[i]! && px - hw < x + shape[i + 3]! && py + ph > y + shape[i + 1]! && py < y + shape[i + 4]! && pz + hw > z + shape[i + 2]! && pz - hw < z + shape[i + 5]!) return false;
    }
    // Multi-block placements (doors, beds) are left to the server
    if (blockHasTag(block, 'doors') || blockHasTag(block, 'beds')) return true;
    this.level.setBlock(x, y, z, state);
    return true;
  }
}

/** Ray vs AABB slab test; returns the entry distance or -1. */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let tmin = -Infinity, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-9) {
      if (o[i]! < lo[i]! || o[i]! > hi[i]!) return -1;
      continue;
    }
    let t1 = (lo[i]! - o[i]!) / d[i]!, t2 = (hi[i]! - o[i]!) / d[i]!;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  return Math.max(0, tmin);
}
