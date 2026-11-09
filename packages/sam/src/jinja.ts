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
}

/** The stand-in an expression not rendered is kept by: text YAML reads as plain, that nothing else holds, distinct per file. */
const unrenderedAt = (file: number, index: number): string => `__jinja_${file}_${index}__`;

/** A stand-in of an expression not rendered, in a text. */
export const UNRENDERED = /__jinja_\d+_\d+__/;

/** How many ways the conditions of one text are rendered; more is not read. */
export const MOST_WAYS = 16;

// ------------------------------------------------------------------ values

/** A name the files give nothing for: undefined to `default` and `is defined`, a value not known to anything else. */
class Undefined {
  constructor(readonly written: string) {}
}

/** A value the files do not settle. */
class Unknown {
  constructor(readonly written: string) {}
}

type JinjaValue = string | number | boolean | null | readonly JinjaValue[] | { readonly [key: string]: JinjaValue } | Undefined | Unknown | Pairs;

/** What `mapping.items()` is: the pairs of a mapping, iterated as such. */
class Pairs {
  constructor(readonly pairs: readonly (readonly [string, JinjaValue])[]) {}
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

type Expression =
  | { readonly kind: 'literal'; readonly value: JinjaValue }
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'member'; readonly of: Expression; readonly key: Expression }
  | { readonly kind: 'call'; readonly of: Expression; readonly args: readonly Expression[] }
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
        of = { kind: 'filter', of, name, args: this.take('(') ? this.arguments() : [] };
      } else return of;
    }
  }

  arguments(): Expression[] {
    const args: Expression[] = [];
    while (!this.take(')')) {
      // A keyword argument is read by its place: `default(x, boolean=true)`.
      if (/^[A-Za-z_]\w*$/.test(this.peek() ?? '') && this.peek(1) === '=') {
        this.next();
        this.next();
      }
      args.push(this.expression());
      if (!this.take(',')) {
        this.expect(')');
        break;
      }
    }
    return args;
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

type Node =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'output'; readonly expression: Expression; readonly written: string; readonly index: number }
  | { readonly kind: 'if'; readonly branches: readonly { readonly test: Expression; readonly written: string; readonly body: readonly Node[] }[]; readonly otherwise: readonly Node[] }
  | { readonly kind: 'for'; readonly names: readonly string[]; readonly over: Expression; readonly written: string; readonly body: readonly Node[]; readonly otherwise: readonly Node[] }
  | { readonly kind: 'set'; readonly name: string; readonly value: Expression };

/** One tag or run of text, with the space trimmed where a `-` asks. */
type Piece = { readonly kind: 'text'; text: string } | { readonly kind: 'output' | 'statement'; readonly inner: string; readonly written: string };

const TAG = /\{#[\s\S]*?#\}|\{%-?([\s\S]*?)-?%\}|\{\{-?([\s\S]*?)-?\}\}/g;

const piecesOf = (text: string): Piece[] => {
  const pieces: Piece[] = [];
  let last = 0;
  let trimNext = false;
  for (const match of text.matchAll(TAG)) {
    const whole = match[0];
    let before = text.slice(last, match.index);
    if (trimNext) before = before.replace(/^\s+/, '');
    if (whole.startsWith('{%-') || whole.startsWith('{{-') || whole.startsWith('{#-')) before = before.replace(/\s+$/, '');
    pieces.push({ kind: 'text', text: before });
    trimNext = whole.endsWith('-%}') || whole.endsWith('-}}') || whole.endsWith('-#}');
    if (whole.startsWith('{%')) pieces.push({ kind: 'statement', inner: (match[1] as string).trim(), written: whole.replace(/\s+/g, ' ').trim() });
    else if (whole.startsWith('{{')) pieces.push({ kind: 'output', inner: match[2] as string, written: whole.replace(/\s+/g, ' ').trim() });
    last = (match.index ?? 0) + whole.length;
  }
  pieces.push({ kind: 'text', text: trimNext ? text.slice(last).replace(/^\s+/, '') : text.slice(last) });
  return pieces;
};

/** The statements of a text as a tree, each block closed by its end. */
const parseTemplate = (text: string): Node[] => {
  const pieces = piecesOf(text);
  let at = 0;
  let outputs = 0;
  const block = (ends: readonly string[]): { body: Node[]; end: string | undefined } => {
    const body: Node[] = [];
    while (at < pieces.length) {
      const piece = pieces[at] as Piece;
      at += 1;
      if (piece.kind === 'text') {
        if (piece.text !== '') body.push({ kind: 'text', text: piece.text });
        continue;
      }
      if (piece.kind === 'output') {
        body.push({ kind: 'output', expression: parseExpression(piece.inner), written: piece.written, index: outputs });
        outputs += 1;
        continue;
      }
      const [word = ''] = piece.inner.split(/\s+/, 1);
      const rest = piece.inner.slice(word.length).trim();
      if (ends.includes(word)) return { body, end: piece.inner };
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
        body.push({ kind: 'if', branches, otherwise });
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
        body.push({ kind: 'for', names: (match[1] as string).split(',').map((name) => name.trim()), over: parseExpression(match[2] as string), written: piece.written, body: inner.body, otherwise });
        continue;
      }
      if (word === 'set') {
        const match = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(rest);
        if (match === null) throw new NotRead('a set this does not read');
        body.push({ kind: 'set', name: match[1] as string, value: parseExpression(match[2] as string) });
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
  ['tojson', (value) => (holdsUnsettled(value) || value instanceof Pairs ? new Unknown('tojson') : json(value))],
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
}

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
      // The one call read: a mapping's `items()`, as a `for` iterates it.
      if (expression.of.kind === 'member' && expression.of.key.kind === 'literal' && expression.of.key.value === 'items' && expression.args.length === 0) {
        const of = evaluate(expression.of.of, scope);
        if (isRecord(of)) return new Pairs(Object.entries(of as Record<string, JinjaValue>));
        return new Unknown('items()');
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
}

/** What rendering a text works out besides its ways. */
interface Run {
  readonly lookup: Lookup;
  readonly file: number;
  /** Each output not rendered, by its place among the outputs, and its stand-in. */
  readonly kept: Map<number, string>;
  readonly unrendered: Map<string, string>;
  readonly undecided: string[];
}

const renderNodes = (nodes: readonly Node[], ways: readonly Way[], run: Run): Way[] => {
  let out = [...ways];
  for (const node of nodes) {
    out = out.flatMap((way) => renderNode(node, way, run));
    if (out.length > MOST_WAYS) throw new NotRead('too many ways');
  }
  return out;
};

const renderNode = (node: Node, way: Way, run: Run): Way[] => {
  const scope = { names: way.names, lookup: run.lookup };
  switch (node.kind) {
    case 'text':
      return [{ ...way, text: way.text + node.text }];
    case 'output': {
      const value = rendered(evaluate(node.expression, scope));
      if (value !== undefined) return [{ ...way, text: way.text + value }];
      let at = run.kept.get(node.index);
      if (at === undefined) {
        at = unrenderedAt(run.file, run.unrendered.size);
        run.kept.set(node.index, at);
        run.unrendered.set(at, node.written);
      }
      return [{ ...way, text: way.text + at }];
    }
    case 'set':
      return [{ ...way, names: new Map([...way.names, [node.name, evaluate(node.value, scope)]]) }];
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
  return { text: out, unrendered, ways: [out], undecided: [] };
};

/**
 * A text rendered as far as the files settle it: every way the conditions
 * they do not decide can go, each expression they do not settle kept by a
 * stand-in numbered under `file`, so the stand-ins of several files read
 * together stay apart. Where the text holds what is not run here, every
 * expression it settles rendered and every statement kept, as before (P261).
 */
export const renderJinja = (text: string, lookup: Lookup, file = 0): Rendering => {
  try {
    const nodes = parseTemplate(text);
    const run: Run = { lookup, file, kept: new Map(), unrendered: new Map(), undecided: [] };
    const ways = [...new Set(renderNodes(nodes, [{ text: '', names: new Map() }], run).map((way) => way.text))];
    return { text: ways[0] ?? '', unrendered: run.unrendered, ways, undecided: run.undecided };
  } catch (error) {
    if (error instanceof NotRead) return keptStatements(text, lookup, file);
    throw error;
  }
};
