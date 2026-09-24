/** In-game HUD: crosshair, hotbar, held item name, chat log/input and F3 debug overlay. */
import { h, clear } from './dom';
import type { IconRenderer } from './icons';
import type { Inventory } from '../../common/entity/player';
import { t, resolveText, TextComponent } from '../../common/lang/i18n';
import { itemName } from './names';
import { renderStack } from './slotview';

export class Hud {
  readonly root: HTMLDivElement;
  private readonly hotbar: HTMLDivElement;
  private readonly slots: HTMLDivElement[] = [];
  private readonly debugLeft: HTMLDivElement;
  private readonly debugRight: HTMLDivElement;
  private readonly chatLog: HTMLDivElement;
  private readonly chatBox: HTMLDivElement;
  readonly chatInput: HTMLInputElement;
  private readonly suggest: HTMLDivElement;
  private readonly itemNameEl: HTMLDivElement;
  readonly extra: HTMLDivElement;
  private lastSelected = -1;
  private lastRevision = -1;
  private nameTimer = 0;
  showDebug = false;
  hidden = false;
  chatOpen = false;
  private readonly lines: Array<{ el: HTMLDivElement; time: number }> = [];

  constructor(private readonly icons: IconRenderer) {
    this.root = h('div', { class: 'hud' });
    this.root.appendChild(h('div', { class: 'crosshair' }));
    this.hotbar = h('div', { class: 'hotbar' });
    for (let i = 0; i < 9; i++) {
      const s = h('div', { class: 'slot' });
      this.slots.push(s);
      this.hotbar.appendChild(s);
    }
    this.root.appendChild(this.hotbar);
    this.itemNameEl = h('div', { class: 'item-name txt' });
    this.root.appendChild(this.itemNameEl);
    this.debugLeft = h('div', { class: 'debug' });
    this.debugRight = h('div', { class: 'debug right' });
    this.root.appendChild(this.debugLeft);
    this.root.appendChild(this.debugRight);
    this.chatLog = h('div', { class: 'chat txt' });
    this.root.appendChild(this.chatLog);
    this.chatInput = h('input', { type: 'text', maxlength: '256', spellcheck: 'false', placeholder: t('chat.placeholder') });
    this.suggest = h('div', { class: 'suggest' });
    this.chatBox = h('div', { class: 'chat-input' }, this.suggest, this.chatInput);
    this.root.appendChild(this.chatBox);
    this.extra = h('div', { class: 'passthrough' });
    this.root.appendChild(this.extra);
  }

  update(inv: Inventory, now: number): void {
    this.root.style.display = this.hidden ? 'none' : '';
    if (inv.revision !== this.lastRevision) {
      this.lastRevision = inv.revision;
      for (let i = 0; i < 9; i++) this.renderSlot(this.slots[i]!, inv, i);
    }
    if (inv.selected !== this.lastSelected) {
      this.slots[this.lastSelected]?.classList.remove('sel');
      this.slots[inv.selected]!.classList.add('sel');
      this.lastSelected = inv.selected;
      const st = inv.mainHand;
      this.itemNameEl.textContent = st.isEmpty() ? '' : (st.data.name ?? itemName(st.id));
      this.nameTimer = now + 2000;
    }
    this.itemNameEl.style.opacity = now < this.nameTimer ? '1' : '0';
    this.updateTitles(now);
    for (const l of this.lines) {
      const age = now - l.time;
      l.el.style.opacity = this.chatOpen ? '1' : age > 10000 ? '0' : '1';
    }
  }

  forceInventoryRefresh(): void {
    this.lastRevision = -1;
  }

  private renderSlot(el: HTMLDivElement, inv: Inventory, i: number): void {
    renderStack(el, inv.get(i), this.icons);
  }

  setDebug(left: string[], right: string[]): void {
    this.debugLeft.style.display = this.showDebug ? '' : 'none';
    this.debugRight.style.display = this.showDebug ? '' : 'none';
    if (!this.showDebug) return;
    this.debugLeft.innerHTML = left.map((l) => `<span>${escapeHtml(l)}</span>`).join('\n');
    this.debugRight.innerHTML = right.map((l) => `<span>${escapeHtml(l)}</span>`).join('\n');
  }

  addChat(text: TextComponent | string, sender = ''): void {
    const s = resolveText(text);
    const line = h('div', { class: 'line' }, sender ? `<${sender}> ${s}` : s);
    const color = typeof text === 'object' && text.color ? text.color : null;
    if (color) line.style.color = colorOf(color);
    this.chatLog.appendChild(line);
    this.lines.push({ el: line, time: performance.now() });
    while (this.lines.length > 100) this.lines.shift()!.el.remove();
  }

  openChat(prefix = ''): void {
    this.chatOpen = true;
    this.chatBox.style.display = 'block';
    this.chatInput.value = prefix;
    setTimeout(() => this.chatInput.focus(), 0);
  }

  closeChat(): void {
    this.chatOpen = false;
    this.chatBox.style.display = 'none';
    this.chatInput.blur();
    this.setSuggestions([]);
  }

  // ---- titles -------------------------------------------------------------------------------
  private titleEl: HTMLDivElement | null = null;
  private subtitleEl: HTMLDivElement | null = null;
  private actionEl: HTMLDivElement | null = null;
  private titleTimes = { fadeIn: 10, stay: 70, fadeOut: 20 };
  private titleStart = 0;
  private actionStart = 0;
  private subtitleText = '';

  /** Handle a title packet (title / subtitle / actionbar / clear / reset / times). */
  title(kind: string, text: TextComponent, fadeIn: number, stay: number, fadeOut: number): void {
    if (!this.titleEl) {
      this.titleEl = h('div', { class: 'title-big txt' });
      this.subtitleEl = h('div', { class: 'hud-subtitle txt' });
      this.actionEl = h('div', { class: 'actionbar txt' });
      this.root.append(this.titleEl, this.subtitleEl, this.actionEl);
    }
    const now = performance.now();
    switch (kind) {
      case 'title':
        this.titleEl.textContent = resolveText(text);
        this.subtitleEl!.textContent = this.subtitleText;
        this.subtitleText = '';
        this.titleStart = now;
        break;
      case 'subtitle':
        this.subtitleText = resolveText(text);
        this.subtitleEl!.textContent = this.subtitleText;
        break;
      case 'actionbar':
        this.actionEl!.textContent = resolveText(text);
        this.actionStart = now;
        break;
      case 'times':
        this.titleTimes = { fadeIn, stay, fadeOut };
        break;
      case 'clear':
        this.titleStart = 0;
        break;
      case 'reset':
        this.titleStart = 0;
        this.subtitleText = '';
        this.titleTimes = { fadeIn: 10, stay: 70, fadeOut: 20 };
        break;
    }
  }

  private updateTitles(now: number): void {
    if (!this.titleEl) return;
    const tt = this.titleTimes;
    const total = (tt.fadeIn + tt.stay + tt.fadeOut) * 50;
    const age = now - this.titleStart;
    let a = 0;
    if (this.titleStart && age < total) {
      if (age < tt.fadeIn * 50) a = age / Math.max(1, tt.fadeIn * 50);
      else if (age < (tt.fadeIn + tt.stay) * 50) a = 1;
      else a = 1 - (age - (tt.fadeIn + tt.stay) * 50) / Math.max(1, tt.fadeOut * 50);
    }
    this.titleEl.style.opacity = String(a);
    this.subtitleEl!.style.opacity = String(a);
    const aa = now - this.actionStart;
    this.actionEl!.style.opacity = String(this.actionStart && aa < 3000 ? Math.min(1, (3000 - aa) / 500) : 0);
  }

  /** Small notification in the top-right corner (recipes, advancements, tutorial hints). */
  toast(title: string, detail = '', icon?: string): void {
    let box = this.root.querySelector('.toasts') as HTMLDivElement | null;
    if (!box) {
      box = h('div', { class: 'toasts' });
      this.root.appendChild(box);
    }
    const el = h('div', { class: 'toast txt' },
      icon ? h('img', { src: icon, alt: '', draggable: 'false' }) : null,
      h('div', {}, h('div', { class: 't' }, title), detail ? h('div', { class: 'd' }, detail) : null));
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild!.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 5000);
  }

  /** Command suggestions: `start` is where the completion replaces the input (after '/'). */
  private suggestions: string[] = [];
  private suggestStart = 0;
  private suggestSel = -1;

  setSuggestions(list: string[], start = 0): void {
    this.suggestions = list;
    this.suggestStart = start;
    this.suggestSel = -1;
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    clear(this.suggest);
    const list = this.suggestions;
    const first = Math.max(0, Math.min(this.suggestSel - 4, list.length - 10));
    for (let i = first; i < Math.min(list.length, first + 10); i++) {
      this.suggest.appendChild(h('div', { class: i === this.suggestSel ? 'sel' : '' }, list[i]!));
    }
    this.suggest.style.display = list.length ? '' : 'none';
    this.suggest.style.marginLeft = `${Math.min(30, this.suggestStart + 1) * 0.55}em`;
  }

  /** Tab / arrows: cycle suggestions and insert the selected one. Returns true if handled. */
  cycleSuggestion(dir: number): boolean {
    if (!this.suggestions.length) return false;
    this.suggestSel = (this.suggestSel + dir + this.suggestions.length) % this.suggestions.length;
    const v = this.chatInput.value;
    const head = v.slice(0, 1 + this.suggestStart);
    this.chatInput.value = head + this.suggestions[this.suggestSel]!;
    this.renderSuggestions();
    return true;
  }

  get hasSuggestions(): boolean {
    return this.suggestions.length > 0;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function colorOf(c: string): string {
  const map: Record<string, string> = {
    yellow: '#ffff55', red: '#ff5555', green: '#55ff55', aqua: '#55ffff', gray: '#aaaaaa', gold: '#ffaa00', light_purple: '#ff55ff', white: '#ffffff', dark_red: '#aa0000',
  };
  return map[c] ?? c;
}
