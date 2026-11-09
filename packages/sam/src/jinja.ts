/**
 * The part of Jinja sceptre renders its files with that the files settle
 * (P261, P264).
 *
 * An expression `{{ ... }}` is a name - `var.x`, `environment_variable.X`,
 * `sceptre_user_data.x`, `stack_group_config.x`, or one a statement binds -
 * its members by `.` or `['key']`, literals, `~` and `+`, comparisons,
 * `and` / `or` / `not`, `in`, `is defined`, `a if c else b`, and the common
 * filters (`default`, `lower`, `upper`, `replace`, `join`, `int`, `string`,
 * `trim`, `tojson`, ...). The statements `{% if %}` / `{% elif %}` /
 * `{% else %}`, `{% for %}` over a list or a mapping (with `loop`), and
 * `{% set %}` are run. A comment `{# #}` is taken out, and `-` trims the
 * space beside a tag, as Jinja does.
 *
 * Macros are run too (P273): `{% macro %}` defines one, a call renders its
 * body with its parameters bound (a default where nothing is handed), every
 * way its conditions go, and `{% call %}` hands it a `caller()`. A file of
 * the repository another names is read as Jinja's file loader reads it -
 * beside the file rendered: `{% include %}` renders it with the current
 * names (`without context`, with none; `ignore missing` where it is not
 * there), `{% import ... as m %}` and `{% from ... import a, b as c %}` bind
 * its macros and top-level `set`s (without the current names, unless `with
 * context` says so), and `{% extends %}` renders the file it names with the
 * `{% block %}`s the extending file writes (`super()` the block it
 * replaces). `{% raw %}`, `{% with %}`, `{% filter %}` and a `{% set %}`
 * block are run as Jinja runs them.
 *
 * What the files do not give is not made up. An expression whose value they
 * do not give is kept, by a stand-in, as an expression not rendered; a
 * condition on such a value is not decided, and the text is rendered every
 * way it can go (up to {@link MOST_WAYS}), the reader taking only what every
 * way agrees on; a loop over such a value, a statement or a filter this does
 * not know, and anything that does not parse leave every statement of the
 * file kept by a stand-in, as P261 kept them - which the reader reads as a
 * file it cannot see.
 *
 * sceptre renders with Jinja's strict undefined: a name nothing gives is an
 * error in the text, but `default` and `is defined` see it as undefined, and
 * a default is what is written where the files give nothing (P261).
 */

/** What renders an expression read here: `undefined` where the files do not give its value. */
export type Lookup = (root: string, path: readonly string[]) => unknown;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

/** A lookup into plain records by root name: the stack's `var`, `environment_variable` or `sceptre_user_data`. */
export const lookupIn =
  (roots: Readonly<Record<string, unknown>>): Lookup =>
  (root, path) => {
    let at: unknown = roots[root];
    for (const step of path) {
      if (Array.isArray(at) && /^\d+$/.test(step)) at = at[Number(step)];
      else if (isRecord(at)) at = at[step];
      else return undefined;
    }
    return at;
  };

/** A file a template names by the name written, as Jinja's file loader finds it: its text, and which file it is. */
export type Loader = (name: string) => { readonly text: string; readonly file: string } | undefined;

/** What else a text is rendered with (P273). */
export interface JinjaOptions {
  /** The files `include`, `import`, `from` and `extends` name; none where nothing loads them. */
  readonly load?: Loader;
}

/** A text rendered as far as the files settle it. */
export interface Rendering {
  /** The text, the first way the conditions not decided go. */
  readonly text: string;
  /** Each expression or statement not rendered, as written, by its stand-in in the text. */
  readonly unrendered: ReadonlyMap<string, string>;
  /** Every way the conditions the files do not decide can go, each once; `text` first (P264). */
  readonly ways: readonly string[];
  /** Each condition not decided, as written. */
  readonly undecided: readonly string[];
  /** The files the text names that were read to render it (P273). */
  readonly loaded: readonly string[];
  /**
   * The line of the file each line of `text` comes from, where they differ
   * (P273): a line another file, a macro or a loop wrote is said at the line
   * of the statement that wrote it. Empty where the text keeps the file's lines.
   */
  readonly lines: readonly number[];
}

/** The stand-in an expression not rendered is kept by: text YAML reads as plain, that nothing else holds, distinct per file. */
const unrenderedAt = (file: number, index: number): string => `__jinja_${file}_${index}__`;

/** A stand-in of an expression not rendered, in a text. */
export const UNRENDERED = /__jinja_\d+_\d+__/;

/** How many ways the conditions of one text are rendered; more is not read. */
export const MOST_WAYS = 16;

/** How deep macros, includes, imports and extends are followed; deeper is not read (P273). */
const MOST_DEPTH = 16;

/** The lookup of a file imported without the current names: nothing is given. */
const NOTHING: Lookup = () => undefined;

// ------------------------------------------------------------------ values

/** A name the files give nothing for: undefined to `default` and `is defined`, a value not known to anything else. */
class Undefined {
  constructor(readonly written: string) {}
}

/** A value the files do not settle. */
class Unknown {
  constructor(readonly written: string) {}
}

type JinjaValue = string | number | boolean | null | readonly JinjaValue[] | { readonly [key: string]: JinjaValue } | Undefined | Unknown | Pairs | Macro;

/** What `mapping.items()` is: the pairs of a mapping, iterated as such. */
class Pairs {
  constructor(readonly pairs: readonly (readonly [string, JinjaValue])[]) {}
}

/** A parameter of a macro: its name, and the default written for it. */
interface Parameter {
  readonly name: string;
  readonly fallback?: Expression;
}

/**
 * A macro (P273): its parameters, its body, the names bound where it is
 * defined and the lookup of the file that defines it - none for a file
 * imported without the current names.
 */
class Macro {
  constructor(
    readonly name: string,
    readonly parameters: readonly Parameter[],
    readonly body: readonly Node[],
    readonly closure: ReadonlyMap<string, JinjaValue>,
    readonly lookup: Lookup,
  ) {}
}

const isUnsettled = (value: JinjaValue): value is Undefined | Unknown => value instanceof Undefined || value instanceof Unknown;

/** A value read from what the files give, as a value of Jinja's; anything else - a resolver - is not known. */
const fromFiles = (value: unknown, written: string): JinjaValue => {
  if (value === undefined) return new Undefined(written);
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => fromFiles(item, written));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromFiles(item, written)]));
  return new Unknown(written);
};

/** A value as Jinja writes it into the text, where it is one it writes plainly; `undefined` otherwise. */
const rendered = (value: JinjaValue): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (value === null) return 'None';
  return undefined;
};

/** Python's truth of a value; `undefined` where it is not known. */
const truth = (value: JinjaValue): boolean | undefined => {
  if (isUnsettled(value)) return undefined;
  if (value instanceof Pairs) return value.pairs.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return value !== '' && value !== 0 && value !== false && value !== null;
};

/** Whether a value holds anything not known, at any depth. */
const holdsUnsettled = (value: JinjaValue): boolean =>
  isUnsettled(value) || (value instanceof Pairs ? value.pairs.some(([, item]) => holdsUnsettled(item)) : Array.isArray(value) ? value.some(holdsUnsettled) : isRecord(value) ? Object.values(value).some(holdsUnsettled) : false);

const same = (a: JinjaValue, b: JinjaValue): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A value as JSON, keys sorted as Jinja's `tojson` sorts them. */
const json = (value: JinjaValue): string => {
  const sorted = (item: JinjaValue): unknown =>
    Array.isArray(item) ? item.map(sorted) : isRecord(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, sorted((item as Record<string, JinjaValue>)[key] as JinjaValue)])) : item;
  return JSON.stringify(sorted(value));
};

// ----------------------------------------------------------------- parsing

/** A part of a template that cannot be read here: the whole text falls back to keeping its statements. */
class NotRead extends Error {}

/** An argument of a call: by its place, or by its name. */
interface Argument {
  readonly name?: string;
  readonly value: Expression;
}

type Expression =
  | { readonly kind: 'literal'; readonly value: JinjaValue }
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'member'; readonly of: Expression; readonly key: Expression }
  | { readonly kind: 'call'; readonly of: Expression; readonly args: readonly Argument[] }
  | { readonly kind: 'filter'; readonly of: Expression; readonly name: string; readonly args: readonly Expression[] }
  | { readonly kind: 'list'; readonly items: readonly Expression[] }
  | { readonly kind: 'dict'; readonly entries: readonly (readonly [Expression, Expression])[] }
  | { readonly kind: 'unary'; readonly operator: 'not' | '-'; readonly of: Expression }
  | { readonly kind: 'binary'; readonly operator: string; readonly left: Expression; readonly right: Expression }
  | { readonly kind: 'test'; readonly of: Expression; readonly name: string; readonly negated: boolean }
  | { readonly kind: 'conditional'; readonly test: Expression; readonly then: Expression; readonly otherwise: Expression | undefined };

const TOKEN = /\s*(?:('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\d+(?:\.\d+)?)|([A-Za-z_]\w*)|(==|!=|<=|>=|\/\/|\*\*|[-+*/%~<>()[\]{}.,:|=]))/y;

const tokensOf = (text: string): string[] => {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    if (/^\s*$/.test(text.slice(TOKEN.lastIndex))) break;
    const match = TOKEN.exec(text);
    if (match === null) throw new NotRead('a character no expression holds');
    out.push(match[1] ?? match[2] ?? match[3] ?? (match[4] as string));
  }
  return out;
};

const unquote = (written: string): string => written.slice(1, -1).replace(/\\(.)/g, '$1');

/** An expression of Jinja's, parsed from its tokens (recursive descent, Jinja's precedence). */
class ExpressionParser {
  #at = 0;

  constructor(readonly tokens: readonly string[]) {}

  get done(): boolean {
    return this.#at >= this.tokens.length;
  }

  peek(offset = 0): string | undefined {
    return this.tokens[this.#at + offset];
  }

  next(): string {
    const token = this.tokens[this.#at];
    if (token === undefined) throw new NotRead('an expression ends too soon');
    this.#at += 1;
    return token;
  }

  take(token: string): boolean {
    if (this.peek() !== token) return false;
    this.#at += 1;
    return true;
  }

  expect(token: string): void {
    if (!this.take(token)) throw new NotRead(`${token} expected`);
  }

  expression(): Expression {
    const then = this.or();
    if (this.peek() !== 'if') return then;
    this.next();
    const test = this.or();
    const otherwise = this.take('else') ? this.expression() : undefined;
    return { kind: 'conditional', test, then, otherwise };
  }

  or(): Expression {
    let left = this.and();
    while (this.take('or')) left = { kind: 'binary', operator: 'or', left, right: this.and() };
    return left;
  }

  and(): Expression {
    let left = this.not();
    while (this.take('and')) left = { kind: 'binary', operator: 'and', left, right: this.not() };
    return left;
  }

  not(): Expression {
    if (this.take('not')) return { kind: 'unary', operator: 'not', of: this.not() };
    return this.compare();
  }

  compare(): Expression {
    let left = this.concat();
    for (;;) {
      const token = this.peek();
      if (token === '==' || token === '!=' || token === '<' || token === '>' || token === '<=' || token === '>=') {
        this.next();
        left = { kind: 'binary', operator: token, left, right: this.concat() };
      } else if (token === 'in') {
        this.next();
        left = { kind: 'binary', operator: 'in', left, right: this.concat() };
      } else if (token === 'not' && this.peek(1) === 'in') {
        this.next();
        this.next();
        left = { kind: 'unary', operator: 'not', of: { kind: 'binary', operator: 'in', left, right: this.concat() } };
      } else if (token === 'is') {
        this.next();
        const negated = this.take('not');
        left = { kind: 'test', of: left, name: this.next(), negated };
      } else return left;
    }
  }

  concat(): Expression {
    let left = this.add();
    while (this.take('~')) left = { kind: 'binary', operator: '~', left, right: this.add() };
    return left;
  }

  add(): Expression {
    let left = this.unary();
    while (this.peek() === '+' || this.peek() === '-') left = { kind: 'binary', operator: this.next(), left, right: this.unary() };
    return left;
  }

  unary(): Expression {
    if (this.take('-')) return { kind: 'unary', operator: '-', of: this.unary() };
    return this.postfix();
  }

  postfix(): Expression {
    let of = this.primary();
    for (;;) {
      if (this.take('.')) of = { kind: 'member', of, key: { kind: 'literal', value: this.next() } };
      else if (this.take('[')) {
        const key = this.expression();
        this.expect(']');
        of = { kind: 'member', of, key };
      } else if (this.take('(')) of = { kind: 'call', of, args: this.arguments() };
      else if (this.take('|')) {
        const name = this.next();
        // A filter's keyword argument is read by its place: `default(x, boolean=true)`.
        of = { kind: 'filter', of, name, args: this.take('(') ? this.arguments().map((each) => each.value) : [] };
      } else return of;
    }
  }

  arguments(): Argument[] {
    const args: Argument[] = [];
    while (!this.take(')')) {
      let name: string | undefined;
      if (/^[A-Za-z_]\w*$/.test(this.peek() ?? '') && this.peek(1) === '=') {
        name = this.next();
        this.next();
      }
      args.push({ ...(name === undefined ? {} : { name }), value: this.expression() });
      if (!this.take(',')) {
        this.expect(')');
        break;
      }
    }
    return args;
  }

  /** A macro's parameters, `(a, b='x')` (P273). */
  parameters(): Parameter[] {
    const out: Parameter[] = [];
    if (!this.take('(')) return out;
    while (!this.take(')')) {
      const name = this.next();
      if (!/^[A-Za-z_]\w*$/.test(name)) throw new NotRead('a parameter this does not read');
      out.push({ name, ...(this.take('=') ? { fallback: this.expression() } : {}) });
      if (!this.take(',')) {
        this.expect(')');
        break;
      }
    }
    return out;
  }

  /** Names bound by `a = x, b = y`, as `{% with %}` writes them (P273). */
  assignments(): Array<readonly [string, Expression]> {
    const out: Array<readonly [string, Expression]> = [];
    while (!this.done) {
      const name = this.next();
      if (!/^[A-Za-z_]\w*$/.test(name)) throw new NotRead('an assignment this does not read');
      this.expect('=');
      out.push([name, this.expression()]);
      if (!this.take(',')) break;
    }
    if (!this.done) throw new NotRead('more after an assignment');
    return out;
  }

  primary(): Expression {
    const token = this.next();
    if (/^['"]/.test(token)) return { kind: 'literal', value: unquote(token) };
    if (/^\d/.test(token)) return { kind: 'literal', value: Number(token) };
    if (token === 'true' || token === 'True') return { kind: 'literal', value: true };
    if (token === 'false' || token === 'False') return { kind: 'literal', value: false };
    if (token === 'none' || token === 'None') return { kind: 'literal', value: null };
    if (token === '(') {
      const inner = this.expression();
      this.expect(')');
      return inner;
    }
    if (token === '[') {
      const items: Expression[] = [];
      while (!this.take(']')) {
        items.push(this.expression());
        if (!this.take(',')) {
          this.expect(']');
          break;
        }
      }
      return { kind: 'list', items };
    }
    if (token === '{') {
      const entries: (readonly [Expression, Expression])[] = [];
      while (!this.take('}')) {
        const key = this.expression();
        this.expect(':');
        entries.push([key, this.expression()]);
        if (!this.take(',')) {
          this.expect('}');
          break;
        }
      }
      return { kind: 'dict', entries };
    }
    if (/^[A-Za-z_]\w*$/.test(token)) return { kind: 'name', name: token };
    throw new NotRead(`${token} does not start an expression`);
  }
}

const parseExpression = (text: string): Expression => {
  const parser = new ExpressionParser(tokensOf(text));
  const expression = parser.expression();
  if (!parser.done) throw new NotRead('more after an expression');
  return expression;
};

/** Whether a file named in a statement is read with the current names, and the rest of the statement. */
const contextOf = (rest: string, byDefault: boolean): { rest: string; withContext: boolean } => {
  const match = /\s+(with|without)\s+context\s*$/.exec(rest);
  return match === null ? { rest, withContext: byDefault } : { rest: rest.slice(0, match.index), withContext: match[1] === 'with' };
};

/** The name a filter block or a set block's text is held by while its filters run (P273). */
const HELD = '__jinja_held__';

/** A node, and the line of the file rendered it is written on; none for a node of a file it names (P273). */
type Node = NodeOf & { readonly line?: number };

type NodeOf =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'output'; readonly expression: Expression; readonly written: string }
  | { readonly kind: 'if'; readonly branches: readonly { readonly test: Expression; readonly written: string; readonly body: readonly Node[] }[]; readonly otherwise: readonly Node[] }
  | { readonly kind: 'for'; readonly names: readonly string[]; readonly over: Expression; readonly written: string; readonly body: readonly Node[]; readonly otherwise: readonly Node[] }
  | { readonly kind: 'set'; readonly name: string; readonly value: Expression }
  // P273: a set block, its text through the filters written (\`HELD\` the text).
  | { readonly kind: 'set-block'; readonly name: string; readonly filtered: Expression; readonly written: string; readonly body: readonly Node[] }
  | { readonly kind: 'macro'; readonly name: string; readonly parameters: readonly Parameter[]; readonly body: readonly Node[] }
  | { readonly kind: 'call-block'; readonly call: Expression; readonly parameters: readonly Parameter[]; readonly written: string; readonly body: readonly Node[] }
  | { readonly kind: 'include'; readonly name: Expression; readonly written: string; readonly missing: boolean; readonly withContext: boolean }
  | { readonly kind: 'import'; readonly name: Expression; readonly written: string; readonly as: string; readonly withContext: boolean }
  | { readonly kind: 'from'; readonly name: Expression; readonly written: string; readonly names: readonly (readonly [string, string])[]; readonly withContext: boolean }
  | { readonly kind: 'extends'; readonly name: Expression; readonly written: string }
  | { readonly kind: 'block'; readonly name: string; readonly body: readonly Node[] }
  // The blocks a block replaced, as \`super()\` renders them.
  | { readonly kind: 'super'; readonly chain: readonly (readonly Node[])[] }
  | { readonly kind: 'with'; readonly assignments: readonly (readonly [string, Expression])[]; readonly body: readonly Node[] }
  | { readonly kind: 'filter-block'; readonly filtered: Expression; readonly written: string; readonly body: readonly Node[] };

/** One tag or run of text, with the space trimmed where a `-` asks. */
type Piece = ({ readonly kind: 'text'; text: string } | { readonly kind: 'output' | 'statement'; readonly inner: string; readonly written: string }) & { readonly line: number };

const TAG = /\{#[\s\S]*?#\}|\{%-?([\s\S]*?)-?%\}|\{\{-?([\s\S]*?)-?\}\}/g;

/** Where a raw block ends. */
const END_RAW = /\{%-?\s*endraw\s*-?%\}/g;

const piecesOf = (text: string): Piece[] => {
  const pieces: Piece[] = [];
  let last = 0;
  let trimNext = false;
  /** The line a place of the text is on. */
  const lineAt = (index: number): number => text.slice(0, index).split('\n').length;
  /** A run of text from a place, trimmed as asked, and the line its first kept character is on. */
  const run = (from: number, to: number, trimStart: boolean, trimEnd: boolean): Piece => {
    let held = text.slice(from, to);
    const kept = trimStart ? held.replace(/^\s+/, '') : held;
    const start = from + held.length - kept.length;
    held = trimEnd ? kept.replace(/\s+$/, '') : kept;
    return { kind: 'text', text: held, line: lineAt(start) };
  };
  TAG.lastIndex = 0;
  for (let match = TAG.exec(text); match !== null; match = TAG.exec(text)) {
    const whole = match[0];
    pieces.push(run(last, match.index, trimNext, whole.startsWith('{%-') || whole.startsWith('{{-') || whole.startsWith('{#-')));
    trimNext = whole.endsWith('-%}') || whole.endsWith('-}}') || whole.endsWith('-#}');
    const line = lineAt(match.index);
    last = match.index + whole.length;
    if (whole.startsWith('{%') && (match[1] as string).trim() === 'raw') {
      // What a raw block holds is text, its tags included (P273).
      END_RAW.lastIndex = last;
      const end = END_RAW.exec(text);
      if (end === null) throw new NotRead('a raw block never ends');
      pieces.push(run(last, end.index, trimNext, end[0].startsWith('{%-')));
      trimNext = end[0].endsWith('-%}');
      last = end.index + end[0].length;
      TAG.lastIndex = last;
      continue;
    }
    if (whole.startsWith('{%')) pieces.push({ kind: 'statement', inner: (match[1] as string).trim(), written: whole.replace(/\s+/g, ' ').trim(), line });
    else if (whole.startsWith('{{')) pieces.push({ kind: 'output', inner: match[2] as string, written: whole.replace(/\s+/g, ' ').trim(), line });
  }
  pieces.push(run(last, text.length, trimNext, false));
  return pieces;
};

/** The statements of a text as a tree, each block closed by its end. */
const parseTemplate = (text: string, own = true): Node[] => {
  const pieces = piecesOf(text);
  let at = 0;
  const block = (ends: readonly string[]): { body: Node[]; end: string | undefined } => {
    const body: Node[] = [];
    while (at < pieces.length) {
      const piece = pieces[at] as Piece;
      at += 1;
      /** A node of the file rendered, at the line its piece is on. */
      const place = <T extends NodeOf>(node: T): Node => (own ? { ...node, line: piece.line } : node);
      if (piece.kind === 'text') {
        if (piece.text !== '') body.push(place({ kind: 'text', text: piece.text }));
        continue;
      }
      if (piece.kind === 'output') {
        body.push(place({ kind: 'output', expression: parseExpression(piece.inner), written: piece.written }));
        continue;
      }
      const [word = ''] = piece.inner.split(/\s+/, 1);
      const rest = piece.inner.slice(word.length).trim();
      if (ends.includes(word)) return { body, end: piece.inner };
      /** The body of a block up to its end, which must come. */
      const until = (end: string): Node[] => {
        const inner = block([end]);
        if (inner.end === undefined) throw new NotRead(`a ${word} never ends`);
        return inner.body;
      };
      if (word === 'if') {
        const branches: { test: Expression; written: string; body: readonly Node[] }[] = [];
        let test = rest;
        let written = piece.written;
        let otherwise: readonly Node[] = [];
        for (;;) {
          const inner = block(['elif', 'else', 'endif']);
          branches.push({ test: parseExpression(test), written, body: inner.body });
          if (inner.end === undefined) throw new NotRead('an if never ends');
          if (inner.end.startsWith('elif')) {
            test = inner.end.slice(4).trim();
            written = `{% ${inner.end} %}`;
            continue;
          }
          if (inner.end === 'else') {
            const last = block(['endif']);
            if (last.end === undefined) throw new NotRead('an if never ends');
            otherwise = last.body;
          }
          break;
        }
        body.push(place({ kind: 'if', branches, otherwise }));
        continue;
      }
      if (word === 'for') {
        const match = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+in\s+([\s\S]+)$/.exec(rest);
        if (match === null) throw new NotRead('a for this does not read');
        const inner = block(['else', 'endfor']);
        if (inner.end === undefined) throw new NotRead('a for never ends');
        let otherwise: readonly Node[] = [];
        if (inner.end === 'else') {
          const last = block(['endfor']);
          if (last.end === undefined) throw new NotRead('a for never ends');
          otherwise = last.body;
        }
        body.push(place({ kind: 'for', names: (match[1] as string).split(',').map((name) => name.trim()), over: parseExpression(match[2] as string), written: piece.written, body: inner.body, otherwise }));
        continue;
      }
      if (word === 'set') {
        const match = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(rest);
        if (match !== null) {
          body.push(place({ kind: 'set', name: match[1] as string, value: parseExpression(match[2] as string) }));
          continue;
        }
        // A set block: what its body writes, through the filters written after the name (P273).
        const held = /^([A-Za-z_]\w*)\s*(\|[\s\S]*)?$/.exec(rest);
        if (held === null) throw new NotRead('a set this does not read');
        body.push(place({ kind: 'set-block', name: held[1] as string, filtered: parseExpression(`${HELD} ${held[2] ?? ''}`), written: piece.written, body: until('endset') }));
        continue;
      }
      if (word === 'macro') {
        const parser = new ExpressionParser(tokensOf(rest));
        const name = parser.next();
        if (!/^[A-Za-z_]\w*$/.test(name)) throw new NotRead('a macro this does not read');
        const parameters = parser.parameters();
        if (!parser.done) throw new NotRead('more after a macro');
        body.push(place({ kind: 'macro', name, parameters, body: until('endmacro') }));
        continue;
      }
      if (word === 'call') {
        const parser = new ExpressionParser(tokensOf(rest));
        const parameters = parser.peek() === '(' ? parser.parameters() : [];
        const call = parser.expression();
        if (!parser.done || call.kind !== 'call') throw new NotRead('a call block this does not read');
        body.push(place({ kind: 'call-block', call, parameters, written: piece.written, body: until('endcall') }));
        continue;
      }
      if (word === 'include') {
        const { rest: named, withContext } = contextOf(rest, true);
        const missing = /\s+ignore\s+missing\s*$/.exec(named);
        body.push(place({ kind: 'include', name: parseExpression(missing === null ? named : named.slice(0, missing.index)), written: piece.written, missing: missing !== null, withContext }));
        continue;
      }
      if (word === 'import') {
        const { rest: named, withContext } = contextOf(rest, false);
        const match = /^([\s\S]+?)\s+as\s+([A-Za-z_]\w*)$/.exec(named);
        if (match === null) throw new NotRead('an import this does not read');
        body.push(place({ kind: 'import', name: parseExpression(match[1] as string), written: piece.written, as: match[2] as string, withContext }));
        continue;
      }
      if (word === 'from') {
        const { rest: named, withContext } = contextOf(rest, false);
        const match = /^([\s\S]+?)\s+import\s+([\s\S]+)$/.exec(named);
        if (match === null) throw new NotRead('a from this does not read');
        const names = (match[2] as string)
          .replace(/,\s*$/, '')
          .split(',')
          .map((each): readonly [string, string] => {
            const pair = /^\s*([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(each);
            if (pair === null) throw new NotRead('a from this does not read');
            return [pair[1] as string, pair[2] ?? (pair[1] as string)];
          });
        body.push(place({ kind: 'from', name: parseExpression(match[1] as string), written: piece.written, names, withContext }));
        continue;
      }
      if (word === 'extends') {
        body.push(place({ kind: 'extends', name: parseExpression(rest), written: piece.written }));
        continue;
      }
      if (word === 'block') {
        const match = /^([A-Za-z_]\w*)(?:\s+(?:scoped|required))*$/.exec(rest);
        if (match === null) throw new NotRead('a block this does not read');
        body.push(place({ kind: 'block', name: match[1] as string, body: until('endblock') }));
        continue;
      }
      if (word === 'with') {
        const assignments = rest === '' ? [] : new ExpressionParser(tokensOf(rest)).assignments();
        body.push(place({ kind: 'with', assignments, body: until('endwith') }));
        continue;
      }
      if (word === 'filter') {
        body.push(place({ kind: 'filter-block', filtered: parseExpression(`${HELD} | ${rest}`), written: piece.written, body: until('endfilter') }));
        continue;
      }
      throw new NotRead(`the statement ${word} is not run here`);
    }
    return { body, end: undefined };
  };
  const { body, end } = block([]);
  if (end !== undefined) throw new NotRead('a block ends that never began');
  return body;
};

// --------------------------------------------------------------- rendering

/** The common filters, on values the files settle; any other filter is not known. */
const FILTERS: ReadonlyMap<string, (value: JinjaValue, args: readonly JinjaValue[]) => JinjaValue> = new Map<string, (value: JinjaValue, args: readonly JinjaValue[]) => JinjaValue>([
  ['default', (value, [fallback = '', boolean]) => (value instanceof Undefined || (boolean === true && truth(value) === false) ? fallback : value)],
  ['d', (value, args) => (FILTERS.get('default') as (value: JinjaValue, args: readonly JinjaValue[]) => JinjaValue)(value, args)],
  ['lower', (value) => textual(value, (text) => text.toLowerCase())],
  ['upper', (value) => textual(value, (text) => text.toUpperCase())],
  ['trim', (value) => textual(value, (text) => text.trim())],
  ['string', (value) => textual(value, (text) => text)],
  ['title', (value) => textual(value, (text) => text.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))],
  ['capitalize', (value) => textual(value, (text) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase())],
  [
    'replace',
    (value, [from, to]) => (typeof from === 'string' && typeof to === 'string' ? textual(value, (text) => text.split(from).join(to)) : new Unknown('replace')),
  ],
  [
    'join',
    (value, [separator = '']) => {
      if (!Array.isArray(value) || typeof separator !== 'string') return new Unknown('join');
      const parts = (value as JinjaValue[]).map(rendered);
      return parts.some((part) => part === undefined) ? new Unknown('join') : parts.join(separator);
    },
  ],
  [
    'int',
    (value, [fallback = 0]) => {
      if (isUnsettled(value)) return new Unknown('int');
      const number = typeof value === 'number' ? Math.trunc(value) : typeof value === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value) ? Math.trunc(Number(value)) : typeof value === 'boolean' ? Number(value) : undefined;
      return number ?? fallback;
    },
  ],
  ['length', (value) => (typeof value === 'string' || Array.isArray(value) ? value.length : isRecord(value) ? Object.keys(value).length : new Unknown('length'))],
  ['tojson', (value) => (holdsUnsettled(value) || value instanceof Pairs || value instanceof Macro ? new Unknown('tojson') : json(value))],
]);

/** A filter of text, on a value written as text. */
function textual(value: JinjaValue, change: (text: string) => string): JinjaValue {
  const text = rendered(value);
  return text === undefined ? new Unknown('a filter of text') : change(text);
}

/** The names a rendering binds, and the lookup for every other. */
interface Scope {
  readonly names: ReadonlyMap<string, JinjaValue>;
  readonly lookup: Lookup;
  /** What a macro is rendered with; none where nothing runs a macro (P273). */
  readonly run?: Run;
}

/** A call of a macro: the macro, and what it is handed. */
interface MacroCall {
  readonly macro: Macro;
  readonly positional: readonly JinjaValue[];
  readonly named: ReadonlyMap<string, JinjaValue>;
}

/** The macro a call expression calls and what it hands it; `undefined` where it calls no macro. */
const macroCalled = (expression: Expression, scope: Scope): MacroCall | undefined => {
  if (expression.kind !== 'call' || (expression.of.kind !== 'name' && expression.of.kind !== 'member')) return undefined;
  const callee = evaluate(expression.of, scope);
  if (!(callee instanceof Macro)) return undefined;
  const positional: JinjaValue[] = [];
  const named = new Map<string, JinjaValue>();
  for (const arg of expression.args) {
    const value = evaluate(arg.value, scope);
    if (arg.name === undefined) positional.push(value);
    else named.set(arg.name, value);
  }
  return { macro: callee, positional, named };
};

/**
 * What a macro renders, every way its conditions go, each once (P273): its
 * body with its parameters bound - what the call hands, else the default
 * written, else undefined, as Jinja binds them - over the names bound where
 * it was defined, itself, and the caller a call block hands it.
 */
const renderMacro = (call: MacroCall, run: Run, caller?: Macro): string[] => {
  const { macro, positional, named } = call;
  if (run.depth.value >= MOST_DEPTH) throw new NotRead('macros call each other deeper than is followed');
  if (positional.length > macro.parameters.length) throw new NotRead(`${macro.name} is handed more than it takes`);
  for (const name of named.keys()) if (!macro.parameters.some((each) => each.name === name)) throw new NotRead(`${macro.name} takes no ${name}`);
  const names = new Map(macro.closure);
  names.set(macro.name, macro);
  const inner: Run = { ...run, lookup: macro.lookup };
  macro.parameters.forEach((parameter, index) => {
    const value = index < positional.length ? (positional[index] as JinjaValue) : named.has(parameter.name) ? (named.get(parameter.name) as JinjaValue) : parameter.fallback === undefined ? new Undefined(parameter.name) : evaluate(parameter.fallback, { names, lookup: macro.lookup, run: inner });
    names.set(parameter.name, value);
  });
  if (caller !== undefined) names.set('caller', caller);
  run.depth.value += 1;
  try {
    return [...new Set(renderNodes(macro.body, [{ text: '', names, lines: [] }], inner).map((way) => way.text))];
  } finally {
    run.depth.value -= 1;
  }
};

const evaluate = (expression: Expression, scope: Scope): JinjaValue => {
  switch (expression.kind) {
    case 'literal':
      return expression.value;
    case 'name': {
      const bound = scope.names.get(expression.name);
      return bound !== undefined ? bound : fromFiles(scope.lookup(expression.name, []), expression.name);
    }
    case 'member': {
      const of = evaluate(expression.of, scope);
      const key = evaluate(expression.key, scope);
      if (of instanceof Unknown || isUnsettled(key)) return new Unknown('a member');
      if (of instanceof Undefined) return new Undefined(of.written);
      if (Array.isArray(of) && typeof key === 'number') return (of as JinjaValue[])[key] ?? new Undefined(String(key));
      if (isRecord(of) && (typeof key === 'string' || typeof key === 'number')) return (of as Record<string, JinjaValue>)[String(key)] ?? new Undefined(String(key));
      return new Undefined(String(key));
    }
    case 'call': {
      // A mapping's `items()`, as a `for` iterates it.
      if (expression.of.kind === 'member' && expression.of.key.kind === 'literal' && expression.of.key.value === 'items' && expression.args.length === 0) {
        const of = evaluate(expression.of.of, scope);
        if (isRecord(of)) return new Pairs(Object.entries(of as Record<string, JinjaValue>));
        return new Unknown('items()');
      }
      // A macro, where what calls it can render one (P273): what it writes, where every way writes it alike.
      const called = scope.run === undefined ? undefined : macroCalled(expression, scope);
      if (called !== undefined) {
        const texts = renderMacro(called, scope.run as Run);
        return texts.length === 1 ? (texts[0] as string) : new Unknown(`${called.macro.name}()`);
      }
      throw new NotRead('a call is not run here');
    }
    case 'filter': {
      const filter = FILTERS.get(expression.name);
      if (filter === undefined) throw new NotRead(`the filter ${expression.name} is not run here`);
      const value = evaluate(expression.of, scope);
      if (value instanceof Unknown) return value;
      const args = expression.args.map((arg) => evaluate(arg, scope));
      if (args.some(isUnsettled)) return new Unknown('a filter');
      const out = filter(value, args);
      return out instanceof Undefined && expression.name !== 'default' && expression.name !== 'd' ? new Unknown(expression.name) : out;
    }
    case 'list':
      return expression.items.map((item) => evaluate(item, scope));
    case 'dict': {
      const out: Record<string, JinjaValue> = {};
      for (const [key, value] of expression.entries) {
        const name = evaluate(key, scope);
        if (typeof name !== 'string') return new Unknown('a mapping');
        out[name] = evaluate(value, scope);
      }
      return out;
    }
    case 'unary': {
      const of = evaluate(expression.of, scope);
      if (expression.operator === 'not') {
        const value = truth(of);
        return value === undefined ? new Unknown('not') : !value;
      }
      return typeof of === 'number' ? -of : new Unknown('-');
    }
    case 'test': {
      const of = evaluate(expression.of, scope);
      let answer: boolean | undefined;
      if (expression.name === 'defined') answer = of instanceof Unknown ? undefined : !(of instanceof Undefined);
      else if (expression.name === 'undefined') answer = of instanceof Unknown ? undefined : of instanceof Undefined;
      else if (expression.name === 'none') answer = isUnsettled(of) ? undefined : of === null;
      else if (expression.name === 'string') answer = isUnsettled(of) ? undefined : typeof of === 'string';
      else if (expression.name === 'number') answer = isUnsettled(of) ? undefined : typeof of === 'number';
      else throw new NotRead(`the test ${expression.name} is not run here`);
      return answer === undefined ? new Unknown('a test') : answer !== expression.negated;
    }
    case 'conditional': {
      const test = truth(evaluate(expression.test, scope));
      if (test === undefined) return new Unknown('a condition');
      return test ? evaluate(expression.then, scope) : expression.otherwise === undefined ? '' : evaluate(expression.otherwise, scope);
    }
    case 'binary': {
      const left = evaluate(expression.left, scope);
      if (expression.operator === 'and' || expression.operator === 'or') {
        const first = truth(left);
        if (first === undefined) return new Unknown(expression.operator);
        if (expression.operator === 'and' ? !first : first) return left;
        return evaluate(expression.right, scope);
      }
      const right = evaluate(expression.right, scope);
      if (isUnsettled(left) || isUnsettled(right)) return new Unknown(expression.operator);
      switch (expression.operator) {
        case '~': {
          const a = rendered(left);
          const b = rendered(right);
          return a === undefined || b === undefined ? new Unknown('~') : a + b;
        }
        case '+':
          if (typeof left === 'number' && typeof right === 'number') return left + right;
          if (typeof left === 'string' && typeof right === 'string') return left + right;
          if (Array.isArray(left) && Array.isArray(right)) return [...(left as JinjaValue[]), ...(right as JinjaValue[])];
          return new Unknown('+');
        case '-':
          return typeof left === 'number' && typeof right === 'number' ? left - right : new Unknown('-');
        case '==':
          return same(left, right);
        case '!=':
          return !same(left, right);
        case '<':
        case '>':
        case '<=':
        case '>=': {
          if (!((typeof left === 'number' && typeof right === 'number') || (typeof left === 'string' && typeof right === 'string'))) return new Unknown(expression.operator);
          const a = left as number | string;
          const b = right as number | string;
          return expression.operator === '<' ? a < b : expression.operator === '>' ? a > b : expression.operator === '<=' ? a <= b : a >= b;
        }
        case 'in':
          if (typeof right === 'string' && typeof left === 'string') return right.includes(left);
          if (Array.isArray(right)) return (right as JinjaValue[]).some((item) => same(item, left));
          if (isRecord(right) && typeof left === 'string') return left in right;
          return new Unknown('in');
        default:
          throw new NotRead(`the operator ${expression.operator} is not run here`);
      }
    }
  }
};

/** One way of rendering a text: what it has written so far, and the names bound on the way. */
interface Way {
  readonly text: string;
  readonly names: ReadonlyMap<string, JinjaValue>;
  /** The line of the file rendered each line of the text comes from (P273). */
  readonly lines: readonly number[];
}

/** A line of a way's text nothing has been written on yet: said where its first character is written. */
const PENDING = 0;

/**
 * Text written on a way (P273), each line said at the line `origin` gives for
 * the place its first character is written - `origin(n)` the line of the
 * piece written after its nth line break.
 */
const appended = (way: Way, text: string, origin: (breaks: number) => number): Way => {
  if (text === '') return way;
  const lines = [...way.lines];
  let breaks = 0;
  for (const character of text) {
    if (lines.length === 0) lines.push(origin(breaks));
    if (character === '\n') {
      breaks += 1;
      lines.push(PENDING);
    } else if (lines[lines.length - 1] === PENDING) lines[lines.length - 1] = origin(breaks);
  }
  return { ...way, text: way.text + text, lines };
};

/** The lines of a way, a line nothing was written on said at the line before it. */
const settledLines = (lines: readonly number[]): number[] => {
  const out: number[] = [];
  for (const line of lines) out.push(line === PENDING ? (out[out.length - 1] ?? 1) : line);
  return out;
};

/** A file a template names, parsed. */
interface Loaded {
  readonly nodes: readonly Node[];
  readonly file: string;
}

/** What rendering a text works out besides its ways. */
interface Run {
  readonly lookup: Lookup;
  readonly file: number;
  /** Each output not rendered, by the place it is written, and its stand-in. */
  readonly kept: Map<object, string>;
  readonly unrendered: Map<string, string>;
  readonly undecided: string[];
  readonly load: Loader | undefined;
  /** The files named so far, parsed, by the name written (`null` where there is none). */
  readonly templates: Map<string, Loaded | null>;
  readonly loaded: Set<string>;
  /** The blocks the files extending the one rendered write, nearest first, by name (P273). */
  readonly blocks: ReadonlyMap<string, readonly (readonly Node[])[]>;
  readonly depth: { value: number };
  /** The line of the file rendered whose statement is being rendered, for text a node of another file writes (P273). */
  readonly anchor?: number;
}

/** The file a statement names, parsed; `undefined` where the repository has no such file. */
const loadNamed = (name: Expression, written: string, scope: Scope, run: Run): Loaded | undefined => {
  const value = evaluate(name, scope);
  // A list of names is the first of them there is, as Jinja's `select_template`.
  const candidates = typeof value === 'string' ? [value] : Array.isArray(value) && value.every((each) => typeof each === 'string') ? (value as string[]) : undefined;
  if (candidates === undefined) throw new NotRead(`${written} names a file the files do not give`);
  for (const candidate of candidates) {
    let found = run.templates.get(candidate);
    if (found === undefined) {
      const loaded = run.load?.(candidate);
      found = loaded === undefined ? null : { nodes: parseTemplate(loaded.text, false), file: loaded.file };
      run.templates.set(candidate, found);
    }
    if (found !== null) {
      run.loaded.add(found.file);
      return found;
    }
  }
  return undefined;
};

/** A value written into a way's text, or kept by a stand-in for the place it is written where it is not one Jinja writes plainly. */
const written = (way: Way, value: JinjaValue, at: object, as: string, run: Run): Way => {
  const text = rendered(value);
  const here = (): number => run.anchor ?? 1;
  if (text !== undefined) return appended(way, text, here);
  let kept = run.kept.get(at);
  if (kept === undefined) {
    kept = unrenderedAt(run.file, run.unrendered.size);
    run.kept.set(at, kept);
    run.unrendered.set(kept, as);
  }
  return appended(way, kept, here);
};

/** Every block a tree of nodes writes, nested ones too, by name. */
const blocksOf = (nodes: readonly Node[], into = new Map<string, readonly Node[]>()): Map<string, readonly Node[]> => {
  for (const node of nodes) {
    if (node.kind !== 'block') continue;
    if (!into.has(node.name)) into.set(node.name, node.body);
    blocksOf(node.body, into);
  }
  return into;
};

/**
 * A file's nodes rendered (P273). A file that extends another writes nothing
 * of its own: what it binds at the top is kept, its blocks replace the ones
 * of the same name the file it extends writes (a block the files extending it
 * replace in turn staying replaced), and that file is rendered.
 */
const renderTemplate = (nodes: readonly Node[], ways: readonly Way[], run: Run): Way[] => {
  const extended = nodes.find((node): node is Extract<Node, { kind: 'extends' }> => node.kind === 'extends');
  if (extended === undefined) return renderNodes(nodes, ways, run);
  if (run.depth.value >= MOST_DEPTH) throw new NotRead('files extend each other deeper than is followed');
  const blocks = new Map(run.blocks);
  for (const [name, body] of blocksOf(nodes)) blocks.set(name, [...(blocks.get(name) ?? []), body]);
  const own = nodes.filter((node) => node.kind !== 'block' && node.kind !== 'extends' && node.kind !== 'text' && node.kind !== 'output');
  return ways.flatMap((way) =>
    renderNodes(own, [way], run).flatMap((bound) => {
      const parent = loadNamed(extended.name, extended.written, { names: bound.names, lookup: run.lookup, run }, run);
      if (parent === undefined) throw new NotRead(`${extended.written} names a file that is not in the repository`);
      run.depth.value += 1;
      try {
        return renderTemplate(parent.nodes, [{ ...way, names: bound.names }], { ...run, blocks, ...(extended.line === undefined ? {} : { anchor: extended.line }) });
      } finally {
        run.depth.value -= 1;
      }
    }),
  );
};

/** A block rendered: the nearest one replacing it, `super()` the one it replaced. */
const renderBlock = (chain: readonly (readonly Node[])[], way: Way, run: Run): Way[] => {
  const [first = [], ...rest] = chain;
  const names = rest.length === 0 ? way.names : new Map([...way.names, ['super', new Macro('super', [], [{ kind: 'super', chain: rest }], way.names, run.lookup)]]);
  return renderNodes(first, [{ ...way, names }], run).map((done) => ({ ...done, names: way.names }));
};

/** A file another names, rendered with the names bound and the lookup, or none of them (P273). */
const renderLoaded = (loaded: Loaded, start: Way, withContext: boolean, run: Run): Way[] => {
  if (run.depth.value >= MOST_DEPTH) throw new NotRead('files include each other deeper than is followed');
  run.depth.value += 1;
  try {
    return renderTemplate(loaded.nodes, [withContext ? start : { ...start, names: new Map() }], withContext ? run : { ...run, lookup: NOTHING, blocks: new Map() });
  } finally {
    run.depth.value -= 1;
  }
};

/**
 * What a file imported binds (P273): its macros and top-level `set`s, a name
 * starting `_` kept private, as Jinja exports them. A name the ways the
 * file's conditions go bind differently is not known.
 */
const moduleOf = (node: Extract<Node, { kind: 'import' | 'from' }>, way: Way, run: Run): Record<string, JinjaValue> => {
  const loaded = loadNamed(node.name, node.written, { names: way.names, lookup: run.lookup, run }, run);
  if (loaded === undefined) throw new NotRead(`${node.written} names a file that is not in the repository`);
  const start: Way = { text: '', names: node.withContext ? way.names : new Map(), lines: [] };
  const ways = renderLoaded(loaded, start, node.withContext, run);
  const out: Record<string, JinjaValue> = {};
  // What the file binds itself: a name the current names hold is its own only where the file binds it anew.
  const names = new Set(ways.flatMap((each) => [...each.names.entries()].filter(([name, value]) => !name.startsWith('_') && start.names.get(name) !== value).map(([name]) => name)));
  for (const name of names) {
    const values = ways.map((each) => each.names.get(name));
    const [first] = values;
    const agreed = values.every((value) => value === first || (value instanceof Macro && first instanceof Macro ? value.body === first.body : value !== undefined && first !== undefined && same(value, first)));
    out[name] = first !== undefined && agreed ? first : new Unknown(name);
  }
  return out;
};

const renderNodes = (nodes: readonly Node[], ways: readonly Way[], run: Run): Way[] => {
  let out = [...ways];
  for (const node of nodes) {
    out = out.flatMap((way) => renderNode(node, way, run));
    if (out.length > MOST_WAYS) throw new NotRead('too many ways');
  }
  return out;
};

/** A text rendered on its own from a way, and handed back to it with the names it had. */
const renderApart = (body: readonly Node[], way: Way, run: Run): string[] => renderNodes(body, [{ text: '', names: way.names, lines: [] }], run).map((done) => done.text);

const renderNode = (node: Node, way: Way, outer: Run): Way[] => {
  // What a node of the file rendered writes through another file or a macro is said at its line (P273).
  const run: Run = node.line === undefined ? outer : { ...outer, anchor: node.line };
  const scope: Scope = { names: way.names, lookup: run.lookup, run };
  const here = (): number => run.anchor ?? 1;
  switch (node.kind) {
    case 'text':
      return [appended(way, node.text, (line) => (node.line === undefined ? here() : node.line + line))];
    case 'output': {
      // A macro called where its text is written is written every way it renders (P273).
      const called = macroCalled(node.expression, scope);
      if (called !== undefined) return renderMacro(called, run).map((text) => appended(way, text, here));
      return [written(way, evaluate(node.expression, scope), node, node.written, run)];
    }
    case 'set':
      return [{ ...way, names: new Map([...way.names, [node.name, evaluate(node.value, scope)]]) }];
    case 'set-block':
      return renderApart(node.body, way, run).map((text) => ({ ...way, names: new Map([...way.names, [node.name, evaluate(node.filtered, { ...scope, names: new Map([...way.names, [HELD, text]]) })]]) }));
    case 'filter-block':
      return renderApart(node.body, way, run).map((text) => written(way, evaluate(node.filtered, { ...scope, names: new Map([...way.names, [HELD, text]]) }), node, node.written, run));
    case 'with': {
      const bound = new Map(way.names);
      for (const [name, value] of node.assignments) bound.set(name, evaluate(value, scope));
      return renderNodes(node.body, [{ ...way, names: bound }], run).map((done) => ({ ...done, names: way.names }));
    }
    case 'macro':
      return [{ ...way, names: new Map([...way.names, [node.name, new Macro(node.name, node.parameters, node.body, way.names, run.lookup)]]) }];
    case 'call-block': {
      const called = macroCalled(node.call, scope);
      if (called === undefined) throw new NotRead(`${node.written} calls no macro the files define`);
      const caller = new Macro('caller', node.parameters, node.body, way.names, run.lookup);
      return renderMacro(called, run, caller).map((text) => appended(way, text, here));
    }
    case 'include': {
      const loaded = loadNamed(node.name, node.written, scope, run);
      if (loaded === undefined) {
        if (node.missing) return [way];
        throw new NotRead(`${node.written} names a file that is not in the repository`);
      }
      // What the included file binds stays in it.
      return renderLoaded(loaded, way, node.withContext, run).map((done) => ({ ...done, names: way.names }));
    }
    case 'import':
      return [{ ...way, names: new Map([...way.names, [node.as, moduleOf(node, way, run)]]) }];
    case 'from': {
      const module = moduleOf(node, way, run);
      return [{ ...way, names: new Map([...way.names, ...node.names.map(([name, as]): [string, JinjaValue] => [as, module[name] ?? new Undefined(name)])]) }];
    }
    case 'extends':
      // An extends below the top of a file is not read as one.
      throw new NotRead(`${node.written} is not at the top of its file`);
    case 'block':
      return renderBlock([...(run.blocks.get(node.name) ?? []), node.body], way, run);
    case 'super':
      return renderBlock(node.chain, way, run);
    case 'if': {
      for (const [index, branch] of node.branches.entries()) {
        const test = truth(evaluate(branch.test, scope));
        if (test === true) return renderNodes(branch.body, [way], run);
        if (test === false) continue;
        // Not decided by what the files give: this branch, and every way the rest can go (P264).
        if (!run.undecided.includes(branch.written)) run.undecided.push(branch.written);
        const rest: Node = { kind: 'if', branches: node.branches.slice(index + 1), otherwise: node.otherwise };
        return [...renderNodes(branch.body, [way], run), ...renderNode(rest, way, run)];
      }
      return renderNodes(node.otherwise, [way], run);
    }
    case 'for': {
      const over = evaluate(node.over, scope);
      if (!(over instanceof Pairs) && !Array.isArray(over) && !isRecord(over) && typeof over !== 'string') throw new NotRead(`${node.written} loops over what the files do not give`);
      const items: JinjaValue[] = over instanceof Pairs ? over.pairs.map(([key, value]) => [key, value]) : Array.isArray(over) ? [...(over as JinjaValue[])] : isRecord(over) ? Object.keys(over) : [...over];
      if (items.length === 0) return renderNodes(node.otherwise, [way], run);
      let ways: Way[] = [way];
      items.forEach((item, index) => {
        const bound = new Map<string, JinjaValue>();
        const [only] = node.names;
        if (node.names.length === 1 && only !== undefined) bound.set(only, item);
        else if (Array.isArray(item) && item.length === node.names.length) node.names.forEach((name, at) => bound.set(name, (item as JinjaValue[])[at] as JinjaValue));
        else throw new NotRead(`${node.written} unpacks what it does not hold`);
        bound.set('loop', { index: index + 1, index0: index, first: index === 0, last: index === items.length - 1, length: items.length });
        // What the body binds stays in the body, as Jinja scopes a loop.
        ways = ways.flatMap((at) => renderNodes(node.body, [{ ...at, names: new Map([...at.names, ...bound]) }], run).map((done) => ({ ...done, names: at.names })));
      });
      return ways;
    }
  }
};

/** The text as P261 read it: every expression it settles rendered, every statement kept by a stand-in. */
const keptStatements = (text: string, lookup: Lookup, file: number): Rendering => {
  const unrendered = new Map<string, string>();
  const keep = (whole: string): string => {
    const at = unrenderedAt(file, unrendered.size);
    unrendered.set(at, whole.replace(/\s+/g, ' ').trim());
    return at;
  };
  const out = text
    .replace(/\{#[\s\S]*?#\}/g, '')
    .replace(/\{%[\s\S]*?%\}/g, keep)
    .replace(/\{\{-?([\s\S]*?)-?\}\}/g, (whole, inner: string) => {
      try {
        const value = rendered(evaluate(parseExpression(inner), { names: new Map(), lookup }));
        return value ?? keep(whole);
      } catch (error) {
        if (error instanceof NotRead) return keep(whole);
        throw error;
      }
    });
  return { text: out, unrendered, ways: [out], undecided: [], loaded: [], lines: [] };
};

/**
 * A text rendered as far as the files settle it: every way the conditions
 * they do not decide can go, each expression they do not settle kept by a
 * stand-in numbered under `file`, so the stand-ins of several files read
 * together stay apart. The files it names are read through `options.load`
 * (P273). Where the text holds what is not run here, every expression it
 * settles rendered and every statement kept, as before (P261).
 */
export const renderJinja = (text: string, lookup: Lookup, file = 0, options: JinjaOptions = {}): Rendering => {
  try {
    const nodes = parseTemplate(text);
    const run: Run = { lookup, file, kept: new Map(), unrendered: new Map(), undecided: [], load: options.load, templates: new Map(), loaded: new Set(), blocks: new Map(), depth: { value: 0 } };
    const all = renderTemplate(nodes, [{ text: '', names: new Map(), lines: [] }], run);
    const ways = [...new Set(all.map((way) => way.text))];
    return { text: ways[0] ?? '', unrendered: run.unrendered, ways, undecided: run.undecided, loaded: [...run.loaded].sort(), lines: settledLines(all[0]?.lines ?? []) };
  } catch (error) {
    if (error instanceof NotRead) return keptStatements(text, lookup, file);
    throw error;
  }
};
