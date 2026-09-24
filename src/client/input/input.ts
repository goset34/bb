/**
 * Input: keyboard/mouse with rebindable actions, pointer lock, and a unified action state that
 * gamepad and touch controllers also feed (see gamepad.ts, touch.ts).
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sneak' | 'sprint'
  | 'attack' | 'use' | 'pickBlock' | 'inventory' | 'drop' | 'chat' | 'command' | 'playerList'
  | 'perspective' | 'hideGui' | 'screenshot' | 'debug' | 'swapHands' | 'fullscreen' | 'pause' | 'advancements' | 'zoom'
  | 'hotbar1' | 'hotbar2' | 'hotbar3' | 'hotbar4' | 'hotbar5' | 'hotbar6' | 'hotbar7' | 'hotbar8' | 'hotbar9';

export const DEFAULT_BINDINGS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sneak: 'ShiftLeft', sprint: 'ControlLeft',
  attack: 'Mouse0', use: 'Mouse2', pickBlock: 'Mouse1', inventory: 'KeyE', drop: 'KeyQ', chat: 'KeyT', command: 'Slash',
  playerList: 'Tab', perspective: 'F5', hideGui: 'F1', screenshot: 'F2', debug: 'F3', swapHands: 'KeyF', fullscreen: 'F11',
  pause: 'Escape', advancements: 'KeyL', zoom: 'KeyC',
  hotbar1: 'Digit1', hotbar2: 'Digit2', hotbar3: 'Digit3', hotbar4: 'Digit4', hotbar5: 'Digit5', hotbar6: 'Digit6',
  hotbar7: 'Digit7', hotbar8: 'Digit8', hotbar9: 'Digit9',
};

export class Input {
  bindings: Record<Action, string> = { ...DEFAULT_BINDINGS };
  private readonly down = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  /** External (gamepad/touch) action levels. */
  readonly virtual = new Map<Action, number>();
  private readonly virtualPressed = new Set<Action>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  /** Analog movement override from gamepad/touch (-1..1). */
  moveX = 0;
  moveY = 0;
  lookX = 0;
  lookY = 0;
  sensitivity = 0.5;
  invertY = false;
  locked = false;
  /** When a text field/menu is open, gameplay input is suspended. */
  captured = true;
  private readonly keyListeners: Array<(code: string, ev: KeyboardEvent) => boolean | void> = [];
  private lastForwardTap = 0;
  doubleTapSprint = false;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    element.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    element.addEventListener('wheel', (e) => {
      if (this.locked) {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      }
    }, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === element;
      if (!this.locked) this.releaseAll();
    });
    window.addEventListener('blur', () => this.releaseAll());
  }

  /** Register a raw key listener; return true to consume. */
  onKey(cb: (code: string, ev: KeyboardEvent) => boolean | void): void {
    this.keyListeners.unshift(cb);
  }

  requestLock(): void {
    if (this.locked) return;
    const req = this.element.requestPointerLock as unknown as (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    try {
      const r = req.call(this.element, { unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { try { this.element.requestPointerLock(); } catch { /* ignore */ } });
    } catch {
      try { this.element.requestPointerLock(); } catch { /* ignore */ }
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onKeyDown(e: KeyboardEvent): void {
    for (const l of this.keyListeners) if (l(e.code, e)) { e.preventDefault(); return; }
    if (!this.captured) return;
    if (['Tab', 'F1', 'F2', 'F3', 'F5', 'F11', 'Space', 'Slash', 'Quote'].includes(e.code) || e.ctrlKey && ['KeyW', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
    if (!this.down.has(e.code)) {
      this.pressedThisFrame.add(e.code);
      if (e.code === this.bindings.forward) {
        const now = performance.now();
        if (now - this.lastForwardTap < 280) this.doubleTapSprint = true;
        this.lastForwardTap = now;
      }
    }
    this.down.add(e.code);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.down.delete(e.code);
    if (e.code === this.bindings.forward) this.doubleTapSprint = false;
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.captured) return;
    if (!this.locked) return;
    const code = 'Mouse' + e.button;
    if (!this.down.has(code)) this.pressedThisFrame.add(code);
    this.down.add(code);
    e.preventDefault();
  }

  private onMouseUp(e: MouseEvent): void {
    this.down.delete('Mouse' + e.button);
  }

  releaseAll(): void {
    this.down.clear();
    this.doubleTapSprint = false;
  }

  isDown(a: Action): boolean {
    return this.down.has(this.bindings[a]) || (this.virtual.get(a) ?? 0) > 0.5;
  }

  /** Pressed since the last `endFrame`. */
  pressed(a: Action): boolean {
    return this.pressedThisFrame.has(this.bindings[a]) || this.virtualPressed.has(a);
  }

  pressVirtual(a: Action): void {
    this.virtualPressed.add(a);
  }

  isCodeDown(code: string): boolean {
    return this.down.has(code);
  }

  consumeMouse(): [number, number] {
    const f = this.sensitivity * 0.6 + 0.2;
    const k = f * f * f * 8 * 0.15;
    const dx = this.mouseDX * k + this.lookX;
    const dy = this.mouseDY * k * (this.invertY ? -1 : 1) + this.lookY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return [dx, dy];
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
    this.virtualPressed.clear();
  }
}
