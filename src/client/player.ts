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
import { blockForItem } from '../common/item/items';
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
  health = 20;
  food = 20;
  sprintToggle = false;

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
    // Predict
    tickLivingMovement(this.level, e, this.travel);
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
    // Attack / break
    if (input.isDown('attack') && h) {
      if (creative) {
        if (input.pressed('attack') || this.attackCooldown === 0) {
          this.send({ type: 'action', action: 'start_dig', x: h.x, y: h.y, z: h.z, face: h.face, seq: this.seq });
          if (blockOf(h.state).hardness >= 0 || creative) this.predictBreak(h.x, h.y, h.z);
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
        dg.progress += destroyProgressPerTick(this.inventory.mainHand, h.state, { efficiency: 0, haste: 0, miningFatigue: 0, inWater, aquaAffinity: false, onGround: this.entity.physics.onGround || this.entity.input.flying, breakSpeed: 1 });
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
    if ((input.pressed('use') || (input.isDown('use') && this.useCooldown === 0)) && h) {
      this.useCooldown = 4;
      const hx = h.px - h.x, hy = h.py - h.y, hz = h.pz - h.z;
      this.send({ type: 'useItemOn', x: h.x, y: h.y, z: h.z, face: h.face, hx, hy, hz, hand: 'main', seq: this.seq, inside: false });
      this.predictPlace(h, hx, hy, hz);
    }
    if (input.pressed('pickBlock') && h) {
      this.send({ type: 'pickBlock', x: h.x, y: h.y, z: h.z, withData: false });
    }
  }

  private predictBreak(x: number, y: number, z: number): void {
    const s = this.level.getBlockState(x, y, z);
    this.level.setBlock(x, y, z, stateFlags[s]! & F.WATERLOGGED ? S('water') : 0);
  }

  private predictPlace(h: BlockHit, hx: number, hy: number, hz: number): void {
    const stack = this.inventory.mainHand;
    const block = blockForItem(stack.id);
    if (!block || stack.isEmpty()) return;
    const clicked = this.level.getBlockState(h.x, h.y, h.z);
    // Interactive blocks: don't predict (server decides)
    if (!this.entity.input.sneaking && (blockHasTag(blockOf(clicked), 'doors') || blockHasTag(blockOf(clicked), 'trapdoors') || blockHasTag(blockOf(clicked), 'fence_gates') || blockHasTag(blockOf(clicked), 'chests') || ['crafting_table', 'furnace', 'lever', 'barrel'].includes(blockOf(clicked).name))) return;
    let x = h.x, y = h.y, z = h.z;
    const replacing = isReplaceable(clicked);
    if (!replacing) { x += DX[h.face]!; y += DY[h.face]!; z += DZ[h.face]!; }
    if (!isReplaceable(this.level.getBlockState(x, y, z))) return;
    const t = this.entity.transform;
    const ctx = new BlockPlaceContext(this.prediction, x, y, z, h.face, replacing ? hx : hx - DX[h.face]!, replacing ? hy : hy - DY[h.face]!, replacing ? hz : hz - DZ[h.face]!, block, t.yaw, t.pitch, this.entity.input.sneaking, replacing, this.entity, stack);
    const state = block.behavior.getStateForPlacement(ctx);
    if (state === null) return;
    // Don't place inside the player
    const shape = getCollisionShape(state);
    const px = t.x, py = t.y, pz = t.z, hw = 0.3, ph = this.entity.physics.height;
    for (let i = 0; i < shape.length; i += 6) {
      if (px + hw > x + shape[i]! && px - hw < x + shape[i + 3]! && py + ph > y + shape[i + 1]! && py < y + shape[i + 4]! && pz + hw > z + shape[i + 2]! && pz - hw < z + shape[i + 5]!) return;
    }
    // Multi-block placements (doors, beds) are left to the server
    if (blockHasTag(block, 'doors') || blockHasTag(block, 'beds')) return;
    this.level.setBlock(x, y, z, state);
  }
}
