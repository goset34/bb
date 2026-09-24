/** Tiny DOM helpers for the UI layer. */
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return h('button', { class: `btn txt ${cls}`, onclick: onClick }, label);
}

export function slider(opts: { min: number; max: number; step: number; value: number; label: (v: number) => string; onChange: (v: number) => void }): HTMLDivElement {
  const knob = h('div', { class: 'knob' });
  const lbl = h('div', { class: 'lbl txt' });
  const el = h('div', { class: 'slider' }, knob, lbl);
  let value = opts.value;
  const render = () => {
    const f = (value - opts.min) / (opts.max - opts.min);
    knob.style.left = `calc(${f * 100}% - ${f}em)`;
    lbl.textContent = opts.label(value);
  };
  const setFrom = (clientX: number) => {
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    let v = opts.min + f * (opts.max - opts.min);
    v = Math.round(v / opts.step) * opts.step;
    v = Math.max(opts.min, Math.min(opts.max, v));
    if (v !== value) {
      value = v;
      opts.onChange(v);
      render();
    }
  };
  el.addEventListener('pointerdown', (e) => {
    setFrom(e.clientX);
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setFrom(ev.clientX);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  render();
  return el;
}

export function cycleButton<T>(label: (v: T) => string, values: readonly T[], value: T, onChange: (v: T) => void, cls = ''): HTMLButtonElement {
  let i = Math.max(0, values.indexOf(value));
  const b = h('button', { class: `btn txt ${cls}` }, label(values[i]!));
  b.addEventListener('click', () => {
    i = (i + 1) % values.length;
    b.textContent = label(values[i]!);
    onChange(values[i]!);
  });
  return b;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
