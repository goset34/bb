/** In-game HUD: crosshair, hotbar, held item name, chat log/input and F3 debug overlay. */
import { h, clear } from './dom';
import type { IconRenderer } from './icons';
import type { Inventory } from '../../common/entity/player';
import { t, resolveText, TextComponent } from '../../common/lang/i18n';
import { itemName } from './names';

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
    for (const l of this.lines) {
      const age = now - l.time;
      l.el.style.opacity = this.chatOpen ? '1' : age > 10000 ? '0' : '1';
    }
  }

  forceInventoryRefresh(): void {
    this.lastRevision = -1;
  }

  private renderSlot(el: HTMLDivElement, inv: Inventory, i: number): void {
    clear(el);
    const st = inv.get(i);
    if (st.isEmpty()) return;
    el.appendChild(h('img', { src: this.icons.icon(st.id), draggable: 'false', alt: '' }));
    if (st.count > 1) el.appendChild(h('div', { class: 'count' }, String(st.count)));
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
    this.suggest.textContent = '';
  }

  setSuggestions(list: string[]): void {
    this.suggest.textContent = list.slice(0, 10).join('\n');
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
