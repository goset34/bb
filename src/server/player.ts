/**
 * ServerPlayer: connection-bound player state, input processing (authoritative movement),
 * chunk streaming and block interaction.
 */
import { Connection } from '../common/net/connection';
import { Packet, INPUT } from '../common/net/protocol';
import { Entity } from '../common/entity/ecs';
import { makeInput, makePhysics, makeTransform } from '../common/entity/components';
import { tickLivingMovement, DEFAULT_TRAVEL, TravelOptions } from '../common/entity/physics';
import { abilitiesFor, GameMode, Inventory, PlayerData } from '../common/entity/player';
import { chunkKey, Direction, DX, DY, DZ } from '../common/world/direction';
import type { ServerLevel } from './level';
import type { StrataServer } from './server';
import { blockOf, stateFlags, F, getCollisionShape, isReplaceable, blockHasTag } from '../common/block/registry';
import { blockForItem } from '../common/item/items';
import { ItemStack } from '../common/item/stack';
import { BlockPlaceContext } from '../common/world/placecontext';
import { AABB } from '../common/math/geom';
import { ticksToBreak } from '../common/item/mining';
import { PlayerMenus } from './menus';

interface InputPacket {
  seq: number;
  forward: number;
  strafe: number;
  yaw: number;
  pitch: number;
  flags: number;
  clientTick: number;
}

export type PlayerEntity = Entity & Required<Pick<Entity, 'transform' | 'physics' | 'input' | 'player'>>;

/** Spiral offsets sorted by distance (cached per radius). */
const spiralCache = new Map<number, Array<[number, number]>>();
export function spiral(r: number): Array<[number, number]> {
  let s = spiralCache.get(r);
  if (s) return s;
  s = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) s.push([dx, dz]);
  s.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  spiralCache.set(r, s);
  return s;
}

export class ServerPlayer {
  readonly entity: PlayerEntity;
  level!: ServerLevel;
  viewDistance = 8;
  lang = 'es';
  private readonly sentChunks = new Set<number>();
  private readonly inputQueue: InputPacket[] = [];
  private lastProcessedSeq = 0;
  private awaitingTeleport = 0;
  private nextTeleportId = 1;
  private lastKeepAlive = 0;
  private keepAliveId = 0;
  private keepAlivePending = false;
  /** Digging state (survival). */
  private digging: { x: number; y: number; z: number; startTick: number; needed: number } | null = null;
  /** Extension data for later systems (hunger, xp, stats…). */
  readonly ext: Record<string, unknown> = {};
  travelOptions: TravelOptions = { ...DEFAULT_TRAVEL };
  joined = false;
  disconnected = false;
  /** Movement input is ignored (sleeping, credits). */
  frozen = false;
  /** Load progress reporting during spawn. */
  private spawnChunksReported = false;
  /** Inventory menu (window 0) and the open container menu. */
  readonly menus: PlayerMenus;

  constructor(readonly server: StrataServer, readonly conn: Connection, readonly name: string, readonly uuid: string) {
    const player: PlayerData = { name, gameMode: 'survival', abilities: abilitiesFor('survival'), inventory: new Inventory(), lastInputSeq: 0 };
    this.entity = {
      id: 0, type: 'player', removed: false,
      transform: makeTransform(0, 100, 0),
      physics: makePhysics(0.6, 1.8, 1.62),
      input: makeInput(0.1),
      player,
      meta: {},
    } as PlayerEntity;
    this.menus = new PlayerMenus(this);
    conn.onPacket((p) => {
      try {
        this.handle(p);
      } catch (e) {
        console.error('[server] error handling packet', p.type, e);
      }
    });
  }

  get data(): PlayerData {
    return this.entity.player;
  }

  get inventory(): Inventory {
    return this.entity.player.inventory;
  }

  send(p: Packet): void {
    this.conn.send(p);
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.sentChunks.has(chunkKey(cx, cz));
  }

  forgetChunk(cx: number, cz: number): void {
    if (this.sentChunks.delete(chunkKey(cx, cz))) this.send({ type: 'unloadChunk', cx, cz });
  }

  resetChunks(): void {
    this.sentChunks.clear();
  }

  setGameMode(mode: GameMode): void {
    const d = this.data;
    d.gameMode = mode;
    const flying = d.abilities.flying && mode !== 'survival' && mode !== 'adventure';
    d.abilities = abilitiesFor(mode);
    if (flying || mode === 'spectator') d.abilities.flying = true;
    this.entity.input.flying = d.abilities.flying;
    this.entity.physics.noPhysics = mode === 'spectator';
    this.send({ type: 'gameMode', mode });
    this.sendAbilities();
  }

  sendAbilities(): void {
    const a = this.data.abilities;
    this.send({ type: 'abilities', flying: a.flying, mayFly: a.mayFly, instabuild: a.instabuild, invulnerable: a.invulnerable, mayBuild: a.mayBuild, flySpeed: a.flySpeed, walkSpeed: a.walkSpeed });
  }

  /** Authoritatively move the player (teleport) and tell the client. */
  teleport(x: number, y: number, z: number, yaw = this.entity.transform.yaw, pitch = this.entity.transform.pitch): void {
    const t = this.entity.transform;
    t.x = t.px = x;
    t.y = t.py = y;
    t.z = t.pz = z;
    t.yaw = yaw;
    t.pitch = pitch;
    const p = this.entity.physics;
    p.vx = p.vy = p.vz = 0;
    p.fallDistance = 0;
    this.awaitingTeleport = this.nextTeleportId++;
    this.inputQueue.length = 0;
    this.send({ type: 'playerPosition', x, y, z, yaw, pitch, vx: 0, vy: 0, vz: 0, teleportId: this.awaitingTeleport });
  }

  /** Full resync of the inventory menu (window 0) and the selected hotbar slot. */
  syncInventory(): void {
    this.menus.fullSync(this.menus.inventory);
    this.send({ type: 'setCarried', slot: this.inventory.selected });
  }

  // ===========================================================================================
  // Packets
  // ===========================================================================================

  private handle(p: Packet): void {
    if (this.menus.handle(p)) return;
    switch (p.type) {
      case 'input': {
        if (this.inputQueue.length < 40) this.inputQueue.push(p as unknown as InputPacket);
        break;
      }
      case 'teleportConfirm':
        if ((p['teleportId'] as number) === this.awaitingTeleport) this.awaitingTeleport = 0;
        break;
      case 'settings':
        this.viewDistance = Math.max(2, Math.min(this.server.maxViewDistance, p['viewDistance'] as number));
        this.lang = p['lang'] as string;
        break;
      case 'keepAlive':
        if ((p['id'] as number) === this.keepAliveId) this.keepAlivePending = false;
        break;
      case 'ping':
        this.send({ type: 'pong', id: p['id'] as number, serverTime: this.server.gameTime });
        break;
      case 'setCarried': {
        const s = p['slot'] as number;
        if (s >= 0 && s < 9) this.inventory.selected = s;
        break;
      }
      case 'action':
        this.handleAction(p['action'] as string, p['x'] as number, p['y'] as number, p['z'] as number, p['face'] as Direction, p['seq'] as number);
        break;
      case 'useItemOn':
        this.handleUseItemOn(p);
        break;
      case 'useItem': {
        if (this.data.gameMode === 'spectator' || this.entity.living?.dead) break;
        const hand = (p['hand'] as string) === 'off' ? 'off' : 'main';
        this.server.hooks.useItem(this, hand);
        break;
      }
      case 'abilities':
        if (this.data.abilities.mayFly) {
          this.data.abilities.flying = !!p['flying'];
          this.entity.input.flying = this.data.abilities.flying;
        }
        break;
      case 'pickBlock': {
        if (this.data.gameMode === 'spectator') break;
        const s = this.level.getBlockState(p['x'] as number, p['y'] as number, p['z'] as number);
        const item = blockOf(s).item;
        if (!item) break;
        const inv = this.inventory;
        let slot = -1;
        for (let i = 0; i < 9; i++) if (inv.get(i).is(item)) { slot = i; break; }
        if (slot >= 0) {
          inv.selected = slot;
        } else if (this.data.gameMode === 'creative') {
          slot = inv.get(inv.selected).isEmpty() ? inv.selected : (() => {
            for (let i = 0; i < 9; i++) if (inv.get(i).isEmpty()) return i;
            return inv.selected;
          })();
          inv.set(slot, new ItemStack(item, 1));
          inv.selected = slot;
        } else {
          // Survival: bring the stack from the main inventory into the hotbar
          let from = -1;
          for (let i = 9; i < 36; i++) if (inv.get(i).is(item)) { from = i; break; }
          if (from < 0) break;
          let target = inv.selected;
          if (!inv.get(target).isEmpty()) for (let i = 0; i < 9; i++) if (inv.get(i).isEmpty()) { target = i; break; }
          const a = inv.get(target), b = inv.get(from);
          inv.set(target, b);
          inv.set(from, a);
          inv.selected = target;
        }
        this.syncInventory();
        break;
      }
      case 'chat':
      case 'command':
      case 'commandSuggest':
        this.server.hooks.chat(this, p);
        break;
      default:
        this.server.hooks.packet(this, p);
    }
  }

  // ===========================================================================================
  // Movement
  // ===========================================================================================

  /** Process queued inputs (called every server tick). */
  processInputs(): void {
    if (this.awaitingTeleport || this.frozen) {
      this.inputQueue.length = 0;
      return;
    }
    const e = this.entity;
    const t = e.transform;
    t.px = t.x; t.py = t.y; t.pz = t.z; t.pyaw = t.yaw; t.ppitch = t.pitch;
    let processed = 0;
    while (this.inputQueue.length && processed < 10) {
      const ip = this.inputQueue.shift()!;
      processed++;
      t.yaw = ip.yaw;
      t.pitch = Math.max(-90, Math.min(90, ip.pitch));
      t.headYaw = ip.yaw;
      const inp = e.input;
      inp.forward = Math.max(-1, Math.min(1, ip.forward));
      inp.strafe = Math.max(-1, Math.min(1, ip.strafe));
      inp.jumping = (ip.flags & INPUT.JUMP) !== 0;
      inp.sneaking = (ip.flags & INPUT.SNEAK) !== 0;
      inp.sprinting = (ip.flags & INPUT.SPRINT) !== 0 && inp.forward > 0 && !inp.sneaking;
      inp.usingItem = (ip.flags & INPUT.USING_ITEM) !== 0;
      const wantFly = (ip.flags & INPUT.FLYING) !== 0;
      inp.flying = this.data.abilities.mayFly && wantFly;
      this.data.abilities.flying = inp.flying;
      inp.fallFlying = (ip.flags & INPUT.FALL_FLYING) !== 0 && this.server.hooks.canFallFly(this);
      inp.speed = this.data.abilities.walkSpeed * this.server.hooks.speedMultiplier(this);
      inp.flySpeed = this.data.abilities.flySpeed;
      this.updatePose();
      if (this.data.gameMode === 'spectator') {
        e.physics.noPhysics = true;
      }
      tickLivingMovement(this.level, e, this.server.hooks.travelOptions(this, this.travelOptions));
      if (inp.flying && e.physics.onGround && this.data.gameMode !== 'spectator') {
        inp.flying = false;
        this.data.abilities.flying = false;
      }
      this.lastProcessedSeq = ip.seq;
      this.data.lastInputSeq = ip.seq;
      this.server.hooks.afterMove(this);
    }
    if (processed > 0) {
      const p = e.physics;
      let flags = 0;
      if (e.input.flying) flags |= 1;
      if (e.input.fallFlying) flags |= 2;
      this.send({ type: 'moveAck', seq: this.lastProcessedSeq, x: t.x, y: t.y, z: t.z, vx: p.vx, vy: p.vy, vz: p.vz, onGround: p.onGround, fallDistance: p.fallDistance, flags });
    }
  }

  /** Crouching shrinks the hitbox (1.5), swimming/gliding to 0.6. */
  private updatePose(): void {
    const e = this.entity;
    const p = e.physics;
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
    for (let x = Math.floor(box.minX); x <= Math.floor(box.maxX); x++) {
      for (let y = Math.floor(box.minY); y <= Math.floor(box.maxY); y++) {
        for (let z = Math.floor(box.minZ); z <= Math.floor(box.maxZ); z++) {
          const s = getCollisionShape(this.level.getBlockState(x, y, z));
          for (let i = 0; i < s.length; i += 6) {
            if (box.intersectsRaw(x + s[i]!, y + s[i + 1]!, z + s[i + 2]!, x + s[i + 3]!, y + s[i + 4]!, z + s[i + 5]!)) return false;
          }
        }
      }
    }
    return true;
  }

  // ===========================================================================================
  // Interaction
  // ===========================================================================================

  private reach(): number {
    return this.data.gameMode === 'creative' ? 5 : 4.5;
  }

  private withinReach(x: number, y: number, z: number): boolean {
    const t = this.entity.transform;
    const ex = t.x, ey = t.y + this.entity.physics.eyeHeight, ez = t.z;
    const dx = x + 0.5 - ex, dy = y + 0.5 - ey, dz = z + 0.5 - ez;
    return dx * dx + dy * dy + dz * dz <= (this.reach() + 1.5) ** 2;
  }

  private handleAction(action: string, x: number, y: number, z: number, face: Direction, seq: number): void {
    const level = this.level;
    const mode = this.data.gameMode;
    switch (action) {
      case 'start_dig': {
        if (!this.withinReach(x, y, z) || mode === 'spectator') return this.resync(x, y, z);
        if (mode === 'adventure' && !this.server.hooks.canAdventureBreak(this, x, y, z)) return this.resync(x, y, z);
        const s = level.getBlockState(x, y, z);
        if (stateFlags[s]! & F.AIR) return;
        blockOf(s).behavior.attack(s, level, x, y, z, this.entity);
        if (mode === 'creative') {
          if (this.server.hooks.creativeCanBreak(this)) this.breakBlock(x, y, z, false);
          else this.resync(x, y, z);
          return;
        }
        const need = ticksToBreak(this.inventory.mainHand, s, this.server.hooks.miningModifiers(this));
        if (need === 0) {
          this.breakBlock(x, y, z, true);
          return;
        }
        this.digging = { x, y, z, startTick: this.server.gameTime, needed: need };
        break;
      }
      case 'abort_dig':
        if (this.digging) level.broadcastNear(x, y, z, 32, { type: 'blockBreakProgress', breaker: this.entity.id, x, y, z, stage: -1 });
        this.digging = null;
        break;
      case 'finish_dig': {
        const d = this.digging;
        if (!d || d.x !== x || d.y !== y || d.z !== z) return this.resync(x, y, z);
        const s = level.getBlockState(x, y, z);
        const need = ticksToBreak(this.inventory.mainHand, s, this.server.hooks.miningModifiers(this));
        const elapsed = this.server.gameTime - d.startTick;
        // Allow for latency (reference tolerates ~30% early finishes)
        if (elapsed + 1 >= need * 0.7) this.breakBlock(x, y, z, true);
        else this.resync(x, y, z);
        this.digging = null;
        break;
      }
      case 'drop_item':
      case 'drop_all':
      case 'swap_hands':
      case 'release_use':
        this.server.hooks.playerAction(this, action, x, y, z, face);
        break;
    }
    void seq;
  }

  /** Remove a block as the player; returns true if broken. */
  breakBlock(x: number, y: number, z: number, withDrops: boolean): boolean {
    const level = this.level;
    const s = level.getBlockState(x, y, z);
    if (stateFlags[s]! & F.AIR) return false;
    const b = blockOf(s);
    if (b.hardness < 0 && this.data.gameMode !== 'creative') return false;
    if (!this.server.hooks.beforeBreak(this, x, y, z, s)) {
      this.resync(x, y, z);
      return false;
    }
    b.behavior.playerWillDestroy(s, level, x, y, z, this.entity);
    const drops = withDrops && this.data.gameMode !== 'creative';
    level.levelEvent(2001, x, y, z, s);
    const keep = (stateFlags[s]! & F.WATERLOGGED) ? level.getBlockDef('water').defaultState : 0;
    level.breaker = this.entity;
    level.setBlock(x, y, z, keep, 3);
    level.breaker = null;
    level.gameEvent('block_destroy', x, y, z, this.entity, s);
    if (drops) this.server.hooks.afterBreak(this, x, y, z, s);
    return true;
  }

  private resync(x: number, y: number, z: number): void {
    this.send({ type: 'blockUpdate', x, y, z, state: this.level.getBlockState(x, y, z) });
  }

  private handleUseItemOn(p: Packet): void {
    const x = p['x'] as number, y = p['y'] as number, z = p['z'] as number;
    const face = p['face'] as Direction;
    const hand = (p['hand'] as string) === 'off' ? 'off' : 'main';
    const hx = p['hx'] as number, hy = p['hy'] as number, hz = p['hz'] as number;
    const level = this.level;
    const mode = this.data.gameMode;
    if (!this.withinReach(x, y, z) || mode === 'spectator') {
      this.resync(x, y, z);
      this.resync(x + DX[face]!, y + DY[face]!, z + DZ[face]!);
      return;
    }
    const stack = hand === 'main' ? this.inventory.mainHand : this.inventory.offHand;
    const clicked = level.getBlockState(x, y, z);
    const sneaking = this.entity.input.sneaking;
    // 1. Block interaction (unless sneaking with an item)
    if (!sneaking || (this.inventory.mainHand.isEmpty() && this.inventory.offHand.isEmpty())) {
      const r = blockOf(clicked).behavior.use(clicked, level, x, y, z, { player: this.entity, hand, stack, face, hitX: hx, hitY: hy, hitZ: hz, sneaking });
      if (r === 'success' || r === 'consume') {
        this.server.hooks.swing(this, hand);
        return;
      }
    }
    // 2. Item use on block (hoes, buckets, flint & steel…)
    if (this.server.hooks.useItemOn(this, hand, stack, x, y, z, face, hx, hy, hz)) return;
    // 3. Block placement (items that place nothing are used as if clicked in the air)
    const block = blockForItem(stack.id);
    if (!block || stack.isEmpty()) {
      if (!stack.isEmpty()) this.server.hooks.useItem(this, hand);
      this.resync(x, y, z);
      return;
    }
    if (mode === 'adventure' && !this.server.hooks.canAdventurePlace(this, x, y, z)) {
      this.resync(x, y, z);
      return;
    }
    let px = x, py = y, pz = z;
    let replacing = isReplaceable(clicked) && !(blockOf(clicked) === block && block.name !== 'snow');
    // Slabs: clicking a slab of the same type merges
    if (blockOf(clicked) === block && (block.name.endsWith('_slab') || block.name === 'snow' || blockHasTag(block, 'candles') || block.name === 'sea_pickle' || block.name === 'turtle_egg' || block.name === 'pink_petals' || block.name === 'wildflowers' || block.name === 'leaf_litter')) {
      replacing = true;
    }
    if (!replacing) {
      px += DX[face]!;
      py += DY[face]!;
      pz += DZ[face]!;
      const target = level.getBlockState(px, py, pz);
      if (!isReplaceable(target) && !(blockOf(target) === block && (block.name.endsWith('_slab') || blockHasTag(block, 'candles') || block.name === 'sea_pickle' || block.name === 'snow'))) {
        this.resync(px, py, pz);
        return;
      }
    }
    if (py < level.minY || py >= level.maxY || !level.isLoaded(px, pz)) {
      this.resync(px, py, pz);
      return;
    }
    const t = this.entity.transform;
    const ctx = new BlockPlaceContext(level, px, py, pz, face, replacing ? hx : hx - DX[face]!, replacing ? hy : hy - DY[face]!, replacing ? hz : hz - DZ[face]!, block, t.yaw, t.pitch, sneaking, replacing, this.entity, stack);
    const state = block.behavior.getStateForPlacement(ctx);
    if (state === null || !block.behavior.canSurvive(state, level, px, py, pz)) {
      this.resync(px, py, pz);
      return;
    }
    // Entity collision check
    const shape = getCollisionShape(state);
    if (shape.length) {
      for (let i = 0; i < shape.length; i += 6) {
        const bb = new AABB(px + shape[i]!, py + shape[i + 1]!, pz + shape[i + 2]!, px + shape[i + 3]!, py + shape[i + 4]!, pz + shape[i + 5]!);
        const hit = level.getEntities(bb, (e) => this.server.hooks.blocksPlacement(e));
        if (hit.length) {
          this.resync(px, py, pz);
          return;
        }
      }
    }
    if (!level.setBlock(px, py, pz, state, 11)) {
      this.resync(px, py, pz);
      return;
    }
    this.server.hooks.blockPlaced(this, px, py, pz, state, stack, hand);
    level.gameEvent('block_place', px, py, pz, this.entity, state);
    if (mode !== 'creative') {
      stack.shrink(1);
      if (stack.isEmpty()) this.inventory.set(hand === 'main' ? this.inventory.selected : 40, ItemStack.empty());
      this.inventory.revision++;
    }
  }

  // ===========================================================================================
  // Chunk streaming
  // ===========================================================================================

  /** Send pending chunks (nearest first) and unload out-of-range ones. */
  streamChunks(maxPerTick: number): void {
    const t = this.entity.transform;
    const pcx = Math.floor(t.x) >> 4, pcz = Math.floor(t.z) >> 4;
    const r = this.viewDistance;
    // Unload far chunks
    for (const k of [...this.sentChunks]) {
      const cx = Math.floor(k / 2097152) - 1048576;
      const cz = (k % 2097152) - 1048576;
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > r + 1) this.forgetChunk(cx, cz);
    }
    let sent = 0;
    let total = 0, ready = 0;
    for (const [dx, dz] of spiral(r)) {
      const cx = pcx + dx, cz = pcz + dz;
      const k = chunkKey(cx, cz);
      total++;
      if (this.sentChunks.has(k)) {
        ready++;
        continue;
      }
      if (sent >= maxPerTick) continue;
      const c = this.level.chunks.getFull(cx, cz);
      if (!c) continue;
      this.send({ type: 'chunk', dim: this.level.dimId, data: this.level.encodeChunkForClient(c) });
      this.sentChunks.add(k);
      this.server.hooks.chunkSent(this, cx, cz);
      sent++;
      ready++;
    }
    if (!this.spawnChunksReported) {
      this.send({ type: 'loadProgress', loaded: ready, total });
      if (ready >= Math.min(total, 9)) this.spawnChunksReported = true;
    }
  }

  /** Called every tick by the server. */
  tick(): void {
    this.menus.broadcastChanges();
    const now = this.server.gameTime;
    if (now - this.lastKeepAlive > 300) {
      if (this.keepAlivePending && !this.server.singleplayer) {
        this.server.disconnect(this, { key: 'disconnect.timeout' });
        return;
      }
      this.keepAliveId = (Math.random() * 0xffffffff) >>> 0;
      this.keepAlivePending = true;
      this.lastKeepAlive = now;
      this.send({ type: 'keepAlive', id: this.keepAliveId });
    }
    if (this.digging) {
      const d = this.digging;
      const elapsed = now - d.startTick;
      const stage = Math.min(9, Math.floor((elapsed / Math.max(1, d.needed)) * 10));
      if (elapsed % 2 === 0) this.level.broadcastNear(d.x, d.y, d.z, 32, { type: 'blockBreakProgress', breaker: this.entity.id, x: d.x, y: d.y, z: d.z, stage }, this.entity);
    }
  }
}
