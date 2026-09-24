/**
 * Command dispatcher: a tree of literal and argument nodes with typed parsers, permission levels,
 * execution and tab-completion suggestions. Written for this project (reference command syntax,
 * own implementation).
 */
import type { TextComponent } from '../../common/lang/i18n';

export class CommandError extends Error {
  constructor(readonly text: TextComponent) {
    super(text.key ?? text.text ?? 'command error');
  }
}

export function fail(key: string, ...args: Array<string | number | TextComponent>): never {
  throw new CommandError({ key, args, color: 'red' });
}

/** Cursor over the command text. */
export class Reader {
  pos = 0;
  constructor(readonly text: string) {}

  get remaining(): string {
    return this.text.slice(this.pos);
  }

  canRead(n = 1): boolean {
    return this.pos + n <= this.text.length;
  }

  peek(o = 0): string {
    return this.text[this.pos + o] ?? '';
  }

  skipSpaces(): void {
    while (this.peek() === ' ') this.pos++;
  }

  /** Read until whitespace (not inside brackets / braces). */
  readToken(): string {
    const start = this.pos;
    let depth = 0;
    while (this.canRead()) {
      const c = this.peek();
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === ' ' && depth <= 0) break;
      this.pos++;
    }
    return this.text.slice(start, this.pos);
  }

  readQuotedOrToken(): string {
    const q = this.peek();
    if (q === '"' || q === "'") {
      this.pos++;
      let out = '';
      while (this.canRead() && this.peek() !== q) {
        if (this.peek() === '\\') this.pos++;
        out += this.peek();
        this.pos++;
      }
      if (!this.canRead()) fail('command.unclosedQuote');
      this.pos++;
      return out;
    }
    return this.readToken();
  }

  readRest(): string {
    const s = this.text.slice(this.pos);
    this.pos = this.text.length;
    return s;
  }
}

/** Parsing context available to argument types (the command source). */
export interface ParseContext<S> {
  source: S;
}

export interface ArgType<T, S = unknown> {
  /** Parse at the reader; throw CommandError on invalid input. */
  parse(r: Reader, ctx: ParseContext<S>): T;
  /** Suggestions for the partial token. */
  suggest?(partial: string, ctx: ParseContext<S>): string[];
  /** Consumes the rest of the line (greedy). */
  greedy?: boolean;
}

export type Executor<S> = (ctx: CommandContext<S>) => number | void;

export class CommandContext<S> {
  constructor(readonly source: S, readonly args: Map<string, unknown>, readonly input: string) {}

  get<T>(name: string): T {
    if (!this.args.has(name)) throw new Error(`Missing argument ${name}`);
    return this.args.get(name) as T;
  }

  opt<T>(name: string, fallback: T): T {
    return this.args.has(name) ? (this.args.get(name) as T) : fallback;
  }

  has(name: string): boolean {
    return this.args.has(name);
  }
}

export class CommandNode<S> {
  readonly children: CommandNode<S>[] = [];
  executes: Executor<S> | null = null;
  requires: (s: S) => boolean = () => true;
  redirect: CommandNode<S> | null = null;

  constructor(readonly name: string, readonly type: ArgType<unknown, S> | null) {}

  get isLiteral(): boolean {
    return this.type === null;
  }

  then(...nodes: CommandNode<S>[]): this {
    this.children.push(...nodes);
    return this;
  }

  run(fn: Executor<S>): this {
    this.executes = fn;
    return this;
  }

  require(fn: (s: S) => boolean): this {
    this.requires = fn;
    return this;
  }
}

export function literal<S>(name: string): CommandNode<S> {
  return new CommandNode<S>(name, null);
}

export function argument<S, T>(name: string, type: ArgType<T, S>): CommandNode<S> {
  return new CommandNode<S>(name, type as ArgType<unknown, S>);
}

interface ParseResult<S> {
  node: CommandNode<S> | null;
  args: Map<string, unknown>;
  error: CommandError | null;
  /** Position where parsing stopped. */
  pos: number;
}

export class Dispatcher<S> {
  readonly root = new CommandNode<S>('', null);
  readonly aliases = new Map<string, string>();

  register(node: CommandNode<S>): CommandNode<S> {
    const i = this.root.children.findIndex((c) => c.name === node.name);
    if (i >= 0) this.root.children.splice(i, 1);
    this.root.children.push(node);
    return node;
  }

  alias(name: string, target: string): void {
    this.aliases.set(name, target);
  }

  private resolveAlias(input: string): string {
    const sp = input.indexOf(' ');
    const head = sp < 0 ? input : input.slice(0, sp);
    const target = this.aliases.get(head);
    return target ? target + (sp < 0 ? '' : input.slice(sp)) : input;
  }

  /** Parse the input as deeply as possible. */
  private parse(input: string, source: S): ParseResult<S> {
    const r = new Reader(input);
    const args = new Map<string, unknown>();
    let node: CommandNode<S> = this.root;
    let lastError: CommandError | null = null;
    while (true) {
      r.skipSpaces();
      if (!r.canRead()) return { node, args, error: null, pos: r.pos };
      let matched: CommandNode<S> | null = null;
      const start = r.pos;
      // Literals first, then arguments in declaration order
      const ordered = [...node.children.filter((c) => c.isLiteral), ...node.children.filter((c) => !c.isLiteral)];
      for (const child of ordered) {
        if (!child.requires(source)) continue;
        r.pos = start;
        if (child.isLiteral) {
          const tok = r.readToken();
          if (tok === child.name) { matched = child; break; }
          continue;
        }
        try {
          const v = child.type!.parse(r, { source });
          if (r.canRead() && r.peek() !== ' ') fail('command.expectedSeparator');
          args.set(child.name, v);
          matched = child;
          break;
        } catch (e) {
          if (e instanceof CommandError) lastError = e;
          else throw e;
        }
      }
      if (!matched) {
        r.pos = start;
        return { node: null, args, error: lastError ?? new CommandError({ key: node === this.root ? 'command.unknown' : 'command.unknownArgument', args: [r.remaining], color: 'red' }), pos: start };
      }
      node = matched.redirect ?? matched;
    }
  }

  /** Execute a command line (without the leading slash). Returns the result value. */
  execute(inputRaw: string, source: S): number {
    const input = this.resolveAlias(inputRaw.trim());
    const res = this.parse(input, source);
    if (res.error) throw res.error;
    if (!res.node || !res.node.executes) fail('command.incomplete');
    const v = res.node.executes(new CommandContext(source, res.args, input));
    return typeof v === 'number' ? v : 1;
  }

  /** Suggestions for the partial input: [replacement start (in the raw input), candidates]. */
  suggest(inputRaw: string, source: S): [number, string[]] {
    const hasSpace = inputRaw.includes(' ');
    const input = hasSpace ? this.resolveAlias(inputRaw) : inputRaw;
    const delta = inputRaw.length - input.length;
    const lastSpace = input.lastIndexOf(' ');
    const head = lastSpace < 0 ? '' : input.slice(0, lastSpace);
    const partial = lastSpace < 0 ? input : input.slice(lastSpace + 1);
    const start = (lastSpace < 0 ? 0 : lastSpace + 1) + delta;
    let node: CommandNode<S> | null = this.root;
    if (head) {
      const res = this.parse(head, source);
      node = res.error ? null : res.node;
    }
    if (!node) return [start, []];
    const out = new Set<string>();
    for (const child of node.children) {
      if (!child.requires(source)) continue;
      if (child.isLiteral) {
        if (child.name.startsWith(partial)) out.add(child.name);
      } else if (child.type!.suggest) {
        for (const s of child.type!.suggest(partial, { source })) if (s.startsWith(partial)) out.add(s);
      }
    }
    if (node === this.root) for (const a of this.aliases.keys()) if (a.startsWith(partial)) out.add(a);
    return [start, [...out].sort().slice(0, 100)];
  }

  /** Usage lines for /help. */
  usage(node: CommandNode<S>, source: S, prefix = ''): string[] {
    const lines: string[] = [];
    const walk = (n: CommandNode<S>, path: string) => {
      if (n.executes && path) lines.push(path);
      for (const c of n.children) {
        if (!c.requires(source)) continue;
        walk(c, path ? `${path} ${c.isLiteral ? c.name : `<${c.name}>`}` : c.name);
      }
    };
    walk(node, prefix);
    return lines;
  }
}
