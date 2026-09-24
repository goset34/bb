/**
 * Binary network protocol. Every packet is described by a schema (ordered field list); the same
 * encoder/decoder is used for the in-browser Worker transport, WebSocket and WebRTC.
 */
import { ByteReader, ByteWriter } from '../util/bytes';
import { ItemStack } from '../item/stack';

export type FieldType =
  | 'u8' | 'bool' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64' | 'varint' | 'varuint'
  | 'string' | 'bytes' | 'json' | 'stack' | 'stacks' | 'i32arr' | 'f32arr' | 'strarr';

type Field = readonly [string, FieldType];

export interface PacketDef {
  readonly id: number;
  readonly name: string;
  readonly fields: readonly Field[];
}

function writeField(w: ByteWriter, type: FieldType, v: unknown): void {
  switch (type) {
    case 'u8': w.u8(v as number); break;
    case 'bool': w.bool(!!v); break;
    case 'i16': w.i16(v as number); break;
    case 'u16': w.u16(v as number); break;
    case 'i32': w.i32(v as number); break;
    case 'u32': w.u32(v as number); break;
    case 'f32': w.f32(v as number); break;
    case 'f64': w.f64(v as number); break;
    case 'varint': w.varInt(v as number); break;
    case 'varuint': w.varUint(v as number); break;
    case 'string': w.string((v as string) ?? ''); break;
    case 'bytes': w.blob((v as Uint8Array) ?? new Uint8Array(0)); break;
    case 'json': w.json(v ?? null); break;
    case 'stack': ((v as ItemStack) ?? ItemStack.empty()).write(w); break;
    case 'stacks': {
      const arr = (v as ItemStack[]) ?? [];
      w.varUint(arr.length);
      for (const s of arr) (s ?? ItemStack.empty()).write(w);
      break;
    }
    case 'i32arr': {
      const arr = (v as ArrayLike<number>) ?? [];
      w.varUint(arr.length);
      for (let i = 0; i < arr.length; i++) w.varInt(arr[i]!);
      break;
    }
    case 'f32arr': {
      const arr = (v as ArrayLike<number>) ?? [];
      w.varUint(arr.length);
      for (let i = 0; i < arr.length; i++) w.f32(arr[i]!);
      break;
    }
    case 'strarr': {
      const arr = (v as string[]) ?? [];
      w.varUint(arr.length);
      for (const s of arr) w.string(s);
      break;
    }
  }
}

function readField(r: ByteReader, type: FieldType): unknown {
  switch (type) {
    case 'u8': return r.u8();
    case 'bool': return r.bool();
    case 'i16': return r.i16();
    case 'u16': return r.u16();
    case 'i32': return r.i32();
    case 'u32': return r.u32();
    case 'f32': return r.f32();
    case 'f64': return r.f64();
    case 'varint': return r.varInt();
    case 'varuint': return r.varUint();
    case 'string': return r.string();
    case 'bytes': return r.blob();
    case 'json': return r.json();
    case 'stack': return ItemStack.read(r);
    case 'stacks': {
      const n = r.varUint();
      const a: ItemStack[] = [];
      for (let i = 0; i < n; i++) a.push(ItemStack.read(r));
      return a;
    }
    case 'i32arr': {
      const n = r.varUint();
      const a = new Int32Array(n);
      for (let i = 0; i < n; i++) a[i] = r.varInt();
      return a;
    }
    case 'f32arr': {
      const n = r.varUint();
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = r.f32();
      return a;
    }
    case 'strarr': {
      const n = r.varUint();
      const a: string[] = [];
      for (let i = 0; i < n; i++) a.push(r.string());
      return a;
    }
  }
}

export type Packet = { type: string } & Record<string, unknown>;

export class PacketSet {
  private readonly byName = new Map<string, PacketDef>();
  private readonly byId: PacketDef[] = [];

  define(name: string, fields: Field[]): void {
    const def: PacketDef = { id: this.byId.length, name, fields };
    this.byId.push(def);
    this.byName.set(name, def);
  }

  encode(p: Packet, w: ByteWriter = new ByteWriter(64)): Uint8Array {
    const def = this.byName.get(p.type);
    if (!def) throw new Error('Unknown packet ' + p.type);
    w.reset();
    w.varUint(def.id);
    for (const [k, t] of def.fields) writeField(w, t, p[k]);
    return w.finish();
  }

  decode(buf: Uint8Array): Packet {
    const r = new ByteReader(buf);
    const id = r.varUint();
    const def = this.byId[id];
    if (!def) throw new Error('Unknown packet id ' + id);
    const out: Packet = { type: def.name };
    for (const [k, t] of def.fields) out[k] = readField(r, t);
    return out;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }
}

// ---------------------------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------------------------
export const S2C = new PacketSet();
S2C.define('login', [['entityId', 'varuint'], ['name', 'string'], ['dim', 'string'], ['gameMode', 'string'], ['hardcore', 'bool'], ['difficulty', 'u8'], ['viewDistance', 'u8'], ['seedHash', 'u32'], ['worldName', 'string'], ['rules', 'json'], ['tables', 'json']]);
S2C.define('respawn', [['dim', 'string'], ['gameMode', 'string'], ['keepData', 'bool']]);
S2C.define('chunk', [['dim', 'string'], ['data', 'bytes']]);
S2C.define('unloadChunk', [['cx', 'i32'], ['cz', 'i32']]);
S2C.define('blockUpdate', [['x', 'i32'], ['y', 'i32'], ['z', 'i32'], ['state', 'varuint']]);
S2C.define('multiBlockUpdate', [['cx', 'i32'], ['sy', 'i32'], ['cz', 'i32'], ['entries', 'i32arr']]);
S2C.define('lightUpdate', [['cx', 'i32'], ['sy', 'i32'], ['cz', 'i32'], ['uniform', 'i16'], ['light', 'bytes']]);
S2C.define('blockEntity', [['x', 'i32'], ['y', 'i32'], ['z', 'i32'], ['beType', 'string'], ['data', 'json']]);
S2C.define('blockEvent', [['x', 'i32'], ['y', 'i32'], ['z', 'i32'], ['block', 'varuint'], ['id', 'u8'], ['param', 'varint']]);
S2C.define('blockBreakProgress', [['breaker', 'varuint'], ['x', 'i32'], ['y', 'i32'], ['z', 'i32'], ['stage', 'i16']]);
S2C.define('playerPosition', [['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['yaw', 'f32'], ['pitch', 'f32'], ['vx', 'f64'], ['vy', 'f64'], ['vz', 'f64'], ['teleportId', 'varuint']]);
S2C.define('moveAck', [['seq', 'varuint'], ['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['vx', 'f64'], ['vy', 'f64'], ['vz', 'f64'], ['onGround', 'bool'], ['fallDistance', 'f32'], ['flags', 'u8']]);
S2C.define('abilities', [['flying', 'bool'], ['mayFly', 'bool'], ['instabuild', 'bool'], ['invulnerable', 'bool'], ['mayBuild', 'bool'], ['flySpeed', 'f32'], ['walkSpeed', 'f32']]);
S2C.define('gameMode', [['mode', 'string']]);
S2C.define('time', [['gameTime', 'f64'], ['dayTime', 'f64'], ['doCycle', 'bool']]);
S2C.define('weather', [['rain', 'f32'], ['thunder', 'f32']]);
S2C.define('keepAlive', [['id', 'u32']]);
S2C.define('chat', [['kind', 'string'], ['text', 'json'], ['sender', 'string']]);
S2C.define('title', [['kind', 'string'], ['text', 'json'], ['fadeIn', 'u16'], ['stay', 'u16'], ['fadeOut', 'u16']]);
S2C.define('health', [['health', 'f32'], ['food', 'u8'], ['saturation', 'f32'], ['absorption', 'f32'], ['maxHealth', 'f32']]);
S2C.define('experience', [['progress', 'f32'], ['level', 'varuint'], ['total', 'varuint']]);
S2C.define('air', [['air', 'i16'], ['maxAir', 'i16'], ['frozen', 'i16']]);
S2C.define('spawnEntity', [['id', 'varuint'], ['etype', 'string'], ['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['yaw', 'f32'], ['pitch', 'f32'], ['headYaw', 'f32'], ['vx', 'f32'], ['vy', 'f32'], ['vz', 'f32'], ['meta', 'json']]);
S2C.define('entityMove', [['id', 'varuint'], ['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['yaw', 'f32'], ['pitch', 'f32'], ['headYaw', 'f32'], ['onGround', 'bool'], ['tick', 'f64']]);
S2C.define('entityVelocity', [['id', 'varuint'], ['vx', 'f32'], ['vy', 'f32'], ['vz', 'f32']]);
S2C.define('entityMeta', [['id', 'varuint'], ['meta', 'json']]);
S2C.define('entityEvent', [['id', 'varuint'], ['event', 'string'], ['data', 'varint']]);
S2C.define('entityAnimation', [['id', 'varuint'], ['anim', 'u8']]);
S2C.define('entityEquipment', [['id', 'varuint'], ['slots', 'stacks']]);
S2C.define('entityEffects', [['id', 'varuint'], ['effects', 'json']]);
S2C.define('removeEntities', [['ids', 'i32arr']]);
S2C.define('setPassengers', [['id', 'varuint'], ['passengers', 'i32arr']]);
S2C.define('takeItem', [['item', 'varuint'], ['collector', 'varuint'], ['count', 'varuint']]);
S2C.define('sound', [['sound', 'string'], ['x', 'f32'], ['y', 'f32'], ['z', 'f32'], ['volume', 'f32'], ['pitch', 'f32'], ['category', 'string']]);
S2C.define('levelEvent', [['event', 'varuint'], ['x', 'i32'], ['y', 'i32'], ['z', 'i32'], ['data', 'varint']]);
S2C.define('particles', [['particle', 'string'], ['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['dx', 'f32'], ['dy', 'f32'], ['dz', 'f32'], ['speed', 'f32'], ['count', 'varuint'], ['data', 'varint']]);
S2C.define('explosion', [['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['power', 'f32'], ['blocks', 'i32arr'], ['kx', 'f32'], ['ky', 'f32'], ['kz', 'f32']]);
S2C.define('containerOpen', [['windowId', 'u8'], ['kind', 'string'], ['title', 'json'], ['size', 'u16'], ['extra', 'json']]);
S2C.define('containerContent', [['windowId', 'u8'], ['stateId', 'varuint'], ['slots', 'stacks'], ['carried', 'stack']]);
S2C.define('containerSlot', [['windowId', 'u8'], ['stateId', 'varuint'], ['slot', 'i16'], ['stack', 'stack']]);
S2C.define('containerData', [['windowId', 'u8'], ['prop', 'u16'], ['value', 'varint']]);
S2C.define('containerClose', [['windowId', 'u8']]);
S2C.define('setCarried', [['slot', 'u8']]);
S2C.define('recipes', [['action', 'string'], ['ids', 'strarr']]);
S2C.define('advancements', [['reset', 'bool'], ['data', 'json']]);
S2C.define('stats', [['data', 'json']]);
S2C.define('bossBar', [['uuid', 'string'], ['action', 'string'], ['title', 'json'], ['progress', 'f32'], ['color', 'string'], ['style', 'string']]);
S2C.define('commandSuggestions', [['requestId', 'varuint'], ['start', 'varuint'], ['suggestions', 'strarr']]);
S2C.define('commandTree', [['tree', 'json']]);
S2C.define('gameEvent', [['event', 'string'], ['value', 'f32']]);
S2C.define('mapData', [['mapId', 'varuint'], ['scale', 'u8'], ['locked', 'bool'], ['x0', 'u8'], ['z0', 'u8'], ['w', 'u8'], ['h', 'u8'], ['colors', 'bytes'], ['icons', 'json']]);
S2C.define('tabList', [['players', 'json']]);
S2C.define('win', [['showCredits', 'bool']]);
S2C.define('playerDeath', [['message', 'json'], ['score', 'varuint']]);
S2C.define('cooldown', [['item', 'string'], ['ticks', 'varuint']]);
S2C.define('openSign', [['x', 'i32'], ['y', 'i32'], ['z', 'i32'], ['front', 'bool']]);
S2C.define('openBook', [['hand', 'string']]);
S2C.define('trades', [['windowId', 'u8'], ['offers', 'json'], ['level', 'u8'], ['xp', 'varuint'], ['showProgress', 'bool']]);
S2C.define('worldBorder', [['cx', 'f64'], ['cz', 'f64'], ['size', 'f64']]);
S2C.define('disconnect', [['reason', 'json']]);
S2C.define('spawnPosition', [['x', 'i32'], ['y', 'i32'], ['z', 'i32'], ['angle', 'f32']]);
S2C.define('camera', [['entityId', 'varuint']]);
S2C.define('pong', [['id', 'u32'], ['serverTime', 'f64']]);
S2C.define('saveProgress', [['stage', 'string'], ['progress', 'f32']]);
S2C.define('loadProgress', [['loaded', 'varuint'], ['total', 'varuint']]);
S2C.define('rtcSignal', [['from', 'string'], ['data', 'json']]);

// ---------------------------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------------------------
export const C2S = new PacketSet();
C2S.define('hello', [['name', 'string'], ['viewDistance', 'u8'], ['lang', 'string'], ['protocol', 'varuint'], ['skin', 'json']]);
C2S.define('settings', [['viewDistance', 'u8'], ['lang', 'string'], ['mainHand', 'string']]);
C2S.define('input', [['seq', 'varuint'], ['forward', 'f32'], ['strafe', 'f32'], ['yaw', 'f32'], ['pitch', 'f32'], ['flags', 'u16'], ['clientTick', 'f64']]);
C2S.define('teleportConfirm', [['teleportId', 'varuint']]);
C2S.define('action', [['action', 'string'], ['x', 'i32'], ['y', 'i32'], ['z', 'i32'], ['face', 'u8'], ['seq', 'varuint']]);
C2S.define('useItemOn', [['x', 'i32'], ['y', 'i32'], ['z', 'i32'], ['face', 'u8'], ['hx', 'f32'], ['hy', 'f32'], ['hz', 'f32'], ['hand', 'string'], ['seq', 'varuint'], ['inside', 'bool']]);
C2S.define('useItem', [['hand', 'string'], ['seq', 'varuint'], ['yaw', 'f32'], ['pitch', 'f32']]);
C2S.define('interact', [['entityId', 'varuint'], ['kind', 'string'], ['hand', 'string'], ['hx', 'f32'], ['hy', 'f32'], ['hz', 'f32'], ['sneaking', 'bool'], ['clientTick', 'f64']]);
C2S.define('swing', [['hand', 'string']]);
C2S.define('setCarried', [['slot', 'u8']]);
C2S.define('containerClick', [['windowId', 'u8'], ['stateId', 'varuint'], ['slot', 'i16'], ['button', 'u8'], ['mode', 'string']]);
C2S.define('containerClose', [['windowId', 'u8']]);
C2S.define('containerButton', [['windowId', 'u8'], ['button', 'varint']]);
C2S.define('creativeSlot', [['slot', 'i16'], ['stack', 'stack']]);
C2S.define('pickBlock', [['x', 'i32'], ['y', 'i32'], ['z', 'i32'], ['withData', 'bool']]);
C2S.define('chat', [['message', 'string']]);
C2S.define('command', [['command', 'string']]);
C2S.define('commandSuggest', [['requestId', 'varuint'], ['text', 'string']]);
C2S.define('clientCommand', [['action', 'string']]);
C2S.define('keepAlive', [['id', 'u32']]);
C2S.define('ping', [['id', 'u32']]);
C2S.define('abilities', [['flying', 'bool']]);
C2S.define('playerCommand', [['action', 'string'], ['data', 'varint']]);
C2S.define('signUpdate', [['x', 'i32'], ['y', 'i32'], ['z', 'i32'], ['front', 'bool'], ['lines', 'strarr']]);
C2S.define('renameItem', [['name', 'string']]);
C2S.define('placeRecipe', [['windowId', 'u8'], ['recipe', 'string'], ['all', 'bool']]);
C2S.define('selectTrade', [['index', 'varuint']]);
C2S.define('beacon', [['primary', 'string'], ['secondary', 'string']]);
C2S.define('editBook', [['slot', 'u8'], ['pages', 'strarr'], ['title', 'string']]);
C2S.define('recipeBookPlace', [['windowId', 'u8'], ['recipe', 'string'], ['all', 'bool']]);
C2S.define('advancementTab', [['tab', 'string']]);
C2S.define('rtcSignal', [['to', 'string'], ['data', 'json']]);

/** Input flag bits for the `input` packet. */
export const INPUT = {
  JUMP: 1,
  SNEAK: 2,
  SPRINT: 4,
  FLYING: 8,
  FALL_FLYING: 16,
  USING_ITEM: 32,
  SWIMMING: 64,
  UP: 128,
} as const;

export const PROTOCOL_VERSION = 1;
