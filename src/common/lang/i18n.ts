/** Minimal i18n: language tables, argument substitution and runtime language switching. */
import { ES } from './es';
import { EN } from './en';

export type Lang = 'es' | 'en';
const TABLES: Record<Lang, Record<string, string>> = { es: ES, en: EN };
let current: Lang = 'es';
const extra: Record<Lang, Record<string, string>> = { es: {}, en: {} };

export function setLang(l: Lang): void {
  current = l;
}

export function getLang(): Lang {
  return current;
}

/** Register generated translations (block/item names…). */
export function registerTranslations(lang: Lang, entries: Record<string, string>): void {
  Object.assign(extra[lang], entries);
}

export function has(key: string, lang: Lang = current): boolean {
  return key in TABLES[lang] || key in extra[lang];
}

/** Resolvers for generated keys (item.<id>, entity.<type>) registered by the client. */
const fallbacks: Array<(key: string) => string | null> = [];

export function registerKeyFallback(fn: (key: string) => string | null): void {
  fallbacks.push(fn);
}

function fallback(key: string): string {
  for (const f of fallbacks) {
    const v = f(key);
    if (v !== null) return v;
  }
  return key;
}

export function t(key: string, ...args: Array<string | number>): string {
  const s = TABLES[current][key] ?? extra[current][key] ?? TABLES.en[key] ?? extra.en[key] ?? fallback(key);
  if (!args.length) return s;
  let i = 0;
  return s.replace(/%(\d+\$)?[sd]/g, (m, pos: string | undefined) => {
    if (pos) return String(args[parseInt(pos, 10) - 1] ?? '');
    return String(args[i++] ?? m);
  });
}

/** Text component (chat/titles): { text } | { key, args, color, bold… }. */
export interface TextComponent {
  text?: string;
  key?: string;
  args?: Array<string | number | TextComponent>;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  extra?: TextComponent[];
}

export function resolveText(c: TextComponent | string | null | undefined): string {
  if (c === null || c === undefined) return '';
  if (typeof c === 'string') return c;
  let s = c.text ?? '';
  if (c.key) s += t(c.key, ...(c.args ?? []).map((a) => (typeof a === 'object' ? resolveText(a) : a)));
  if (c.extra) for (const e of c.extra) s += resolveText(e);
  return s;
}
