/**
 * Gameplay installer: wires the survival/entity/redstone/... systems into a StrataServer by
 * replacing its hook implementations. Each milestone module registers itself here.
 */
import type { StrataServer } from './server';

export type GameplayModule = (server: StrataServer) => void;

const modules: GameplayModule[] = [];

export function registerGameplayModule(m: GameplayModule): void {
  modules.push(m);
}

export function installGameplay(server: StrataServer): void {
  for (const m of modules) m(server);
}
