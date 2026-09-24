/**
 * Goal-based AI (reference GoalSelector): goals have a priority and control flags; a goal starts
 * when it can be used and every flag it needs is free or held by a lower-priority interruptible
 * goal. Selection runs every other tick; running goals may request per-tick updates.
 */

export const enum Flag {
  MOVE = 1,
  LOOK = 2,
  JUMP = 4,
  TARGET = 8,
}

const FLAG_LIST = [Flag.MOVE, Flag.LOOK, Flag.JUMP, Flag.TARGET];

export abstract class Goal {
  flags = 0;

  abstract canUse(): boolean;

  canContinueToUse(): boolean {
    return this.canUse();
  }

  isInterruptable(): boolean {
    return true;
  }

  start(): void {}

  stop(): void {}

  requiresUpdateEveryTick(): boolean {
    return false;
  }

  tick(): void {}

  /** Tick delay adjusted for goals that only tick every other game tick. */
  adjustedTickDelay(n: number): number {
    return this.requiresUpdateEveryTick() ? n : reducedTickDelay(n);
  }
}

export function reducedTickDelay(n: number): number {
  return Math.ceil(n / 2);
}

class WrappedGoal {
  running = false;
  constructor(readonly goal: Goal, readonly priority: number) {}

  canBeReplacedBy(o: WrappedGoal): boolean {
    return this.goal.isInterruptable() && o.priority < this.priority;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.goal.start();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.goal.stop();
  }
}

export class GoalSelector {
  readonly available: WrappedGoal[] = [];
  private readonly locked = new Map<Flag, WrappedGoal>();
  private disabled = 0;

  add(priority: number, goal: Goal): void {
    this.available.push(new WrappedGoal(goal, priority));
    this.available.sort((a, b) => a.priority - b.priority);
  }

  remove(goal: Goal): void {
    for (const w of this.available) if (w.goal === goal && w.running) w.stop();
    const i = this.available.findIndex((w) => w.goal === goal);
    if (i >= 0) this.available.splice(i, 1);
  }

  removeAll(pred: (g: Goal) => boolean): void {
    for (const w of [...this.available]) if (pred(w.goal)) this.remove(w.goal);
  }

  has(pred: (g: Goal) => boolean): boolean {
    return this.available.some((w) => pred(w.goal));
  }

  running(): Goal[] {
    return this.available.filter((w) => w.running).map((w) => w.goal);
  }

  isRunning(pred: (g: Goal) => boolean): boolean {
    return this.available.some((w) => w.running && pred(w.goal));
  }

  setControlFlag(flag: Flag, enabled: boolean): void {
    if (enabled) this.disabled &= ~flag;
    else this.disabled |= flag;
  }

  stopAll(): void {
    for (const w of this.available) w.stop();
    this.locked.clear();
  }

  tick(): void {
    for (const w of this.available) {
      if (w.running && ((w.goal.flags & this.disabled) !== 0 || !w.goal.canContinueToUse())) w.stop();
    }
    for (const [f, w] of [...this.locked]) if (!w.running) this.locked.delete(f);
    for (const w of this.available) {
      if (w.running || (w.goal.flags & this.disabled) !== 0) continue;
      if (!this.canReplaceAll(w) || !w.goal.canUse()) continue;
      for (const f of FLAG_LIST) {
        if (!(w.goal.flags & f)) continue;
        this.locked.get(f)?.stop();
        this.locked.set(f, w);
      }
      w.start();
    }
    this.tickRunning(true);
  }

  private canReplaceAll(w: WrappedGoal): boolean {
    for (const f of FLAG_LIST) {
      if (!(w.goal.flags & f)) continue;
      const cur = this.locked.get(f);
      if (cur && cur.running && !cur.canBeReplacedBy(w)) return false;
    }
    return true;
  }

  tickRunning(force: boolean): void {
    for (const w of this.available) {
      if (w.running && (force || w.goal.requiresUpdateEveryTick())) w.goal.tick();
    }
  }
}
