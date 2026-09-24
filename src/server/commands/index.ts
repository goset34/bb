/**
 * Command system installation: builds the dispatcher, registers every command provider, and
 * handles chat / command / suggestion packets.
 */
import { registerGameplayModule } from '../gameplay';
import type { StrataServer } from '../server';
import type { ServerPlayer } from '../player';
import { Dispatcher, CommandError } from './dispatcher';
import type { CommandSource } from './args';
import type { TextComponent } from '../../common/lang/i18n';

export type CommandRegistrar = (d: Dispatcher<CommandSource>, server: StrataServer) => void;

/** Command providers; later milestones push theirs (summon, locate, enchant…). */
export const COMMAND_REGISTRARS: CommandRegistrar[] = [];

const dispatchers = new WeakMap<StrataServer, Dispatcher<CommandSource>>();

export function getDispatcher(server: StrataServer): Dispatcher<CommandSource> {
  const d = dispatchers.get(server);
  if (!d) throw new Error('Commands not installed');
  return d;
}

/** Permission level of a player: singleplayer owner with cheats = 4, ops from the server list. */
export function permissionOf(p: ServerPlayer): number {
  const ops = (p.server.info.data['ops'] as Record<string, number> | undefined) ?? {};
  if (ops[p.uuid] !== undefined) return ops[p.uuid]!;
  if (p.server.singleplayer) return p.server.info.allowCommands ? 4 : 0;
  return 0;
}

export function playerSource(p: ServerPlayer): CommandSource {
  const t = p.entity.transform;
  return {
    server: p.server, level: p.level, player: p, entity: p.entity, x: t.x, y: t.y, z: t.z, yaw: t.yaw, pitch: t.pitch,
    permission: permissionOf(p), name: p.name,
    send: (text) => p.send({ type: 'chat', kind: 'system', text, sender: '' }),
  };
}

/** Run a command line for a source; errors are reported to the source. Returns the result. */
export function runCommand(server: StrataServer, source: CommandSource, line: string): number {
  const d = getDispatcher(server);
  try {
    return d.execute(line.replace(/^\//, ''), source);
  } catch (e) {
    if (e instanceof CommandError) {
      if (!source.silent) source.send(e.text);
      return 0;
    }
    console.error('[commands] error in', line, e);
    if (!source.silent) source.send({ key: 'command.failed', color: 'red' });
    return 0;
  }
}

/** Send command feedback (respecting the sendCommandFeedback rule). */
export function feedback(s: CommandSource, text: TextComponent): void {
  if (s.silent) return;
  if (s.player && s.server.rules.get('sendCommandFeedback') === false) return;
  s.send(text);
}

function install(server: StrataServer): void {
  const d = new Dispatcher<CommandSource>();
  dispatchers.set(server, d);
  for (const r of COMMAND_REGISTRARS) r(d, server);
  const prevChat = server.hooks.chat;
  server.hooks.chat = (p, packet) => {
    switch (packet.type) {
      case 'command':
        runCommand(server, playerSource(p), String(packet['command'] ?? ''));
        return;
      case 'commandSuggest': {
        const text = String(packet['text'] ?? '');
        const [start, list] = d.suggest(text, playerSource(p));
        p.send({ type: 'commandSuggestions', requestId: packet['requestId'] as number, start, suggestions: list });
        return;
      }
      case 'chat': {
        const msg = String(packet['message'] ?? '').slice(0, 256).replace(/[\u0000-\u001f]/g, '');
        if (!msg.trim()) return;
        server.broadcast({ type: 'chat', kind: 'chat', text: { key: 'chat.type.text', args: [p.name, msg] }, sender: '' });
        return;
      }
    }
    prevChat(p, packet);
  };
}

registerGameplayModule(install);
