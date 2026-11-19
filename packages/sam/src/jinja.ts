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
 * And the rest of what templates commonly write (P289): `loop.cycle(...)`,
 * `loop.revindex`, `previtem` / `nextitem`; several names set at once
 * (`{% set a, b = x, y %}`) and tuples; what a macro is handed past its
 * parameters as `varargs` and `kwargs`; `range` and `dict`; the methods of a
 * text (`lower()`, `split()`, `replace()`, `format()`, ...) and of a mapping
 * (`get()`, `keys()`, `values()`); and the filters `first`, `last`, `list`,
 * `unique`, `sort`, `reverse`, `float`, `abs`, `round`, `min`, `max`, `sum`,
 * `map`, `items`, `dictsort`, `format`, `indent`, `safe`, `escape`, `center`.
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
 * a default is what is written where the files give nothing (P261). No
 * reader renders with Jinja's default undefined, so none is offered (P309).
 *
 * What a template's objects share is shared as Jinja shares it (P306): a
 * namespace set inside a macro's body, a set block, a filter block or a
 * recursive `loop(...)` is set for what follows the call, and
 * `loop.changed(...)` compares what it is handed with what the loop's call
 * before it was handed, two calls in one item each with the one before.
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

type JinjaValue = string | number | boolean | null | readonly JinjaValue[] | { readonly [key: string]: JinjaValue } | Undefined | Unknown | Pairs | Macro | Builtin | Namespace;

/**
 * What `namespace(...)` makes (P299): a record whose attributes `{% set ns.x =
 * ... %}` changes, the change seen past the loop or block it is made in, as
 * Jinja keeps it. What it is made with is its own; what is set since is kept
 * on the way, under {@link NAMESPACE} and its number, so each way a condition
 * goes keeps what it set.
 */
class Namespace {
  constructor(
    readonly id: number,
    readonly initial: Readonly<Record<string, JinjaValue>>,
  ) {}
}

/**
 * The names of what a template's objects share past the scope they are
 * changed in (P306): a namespace's attributes, and what a loop's
 * `loop.changed` was last handed. Kept on the way, so each way a condition
 * goes keeps its own, and handed back past loops, blocks, macros and files.
 */
const SHARED = '__jinja_shared_';

/** The name a namespace's attributes set since it was made are kept under on a way, its number after it (P299). */
const NAMESPACE = `${SHARED}namespace_`;

/** The name what a loop's `loop.changed` was last handed is kept under on a way, the loop's number after it (P306). */
const CHANGED = `${SHARED}changed_`;

/** How many loops have been run, each numbered apart (P306). */
let loops = 0;

/** How many namespaces have been made, each numbered apart. */
let namespaces = 0;

/** The pairs `groupby` gives (P299): each a list of its grouper and its items, read by place and as `.grouper` and `.list`. */
const GROUPS = new WeakSet<object>();

/** What a rendering changed of what is shared (P306): each shared name the inner names hold otherwise than the outer. */
const sharedChanges = (inner: ReadonlyMap<string, JinjaValue>, outer: ReadonlyMap<string, JinjaValue>): ReadonlyMap<string, JinjaValue> => new Map([...inner].filter(([name, value]) => name.startsWith(SHARED) && outer.get(name) !== value));

/** The names a rendering inside a loop, a block, a macro or a file it names hands back: the outer ones, with what is shared as it now is (P299, P306). */
const handedBack = (inner: ReadonlyMap<string, JinjaValue>, outer: ReadonlyMap<string, JinjaValue>): ReadonlyMap<string, JinjaValue> => {
  const changed = sharedChanges(inner, outer);
  return changed.size === 0 ? outer : new Map([...outer, ...changed]);
};

/** Names with others over them; the same names where there are none. */
const overlaid = (names: ReadonlyMap<string, JinjaValue>, changes: ReadonlyMap<string, JinjaValue>): ReadonlyMap<string, JinjaValue> => (changes.size === 0 ? names : new Map([...names, ...changes]));

/** A function Jinja gives a template (P289): `loop.cycle`, `range`, `dict`, a method of a text, a list or a mapping; called with what it is handed. */
class Builtin {
  constructor(
    readonly name: string,
    /** Called with the scope it is called in (P306): what it changes of what is shared is written to the scope's `changes`. */
    readonly call: (positional: readonly JinjaValue[], named: ReadonlyMap<string, JinjaValue>, scope: Scope) => JinjaValue,
  ) {}
}

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
  /** The names its file binds once rendered to the end, for a macro imported from it (P299): what it reads of them at call time. */
  late: ReadonlyMap<string, JinjaValue> | undefined;

  constructor(
    readonly name: string,
    readonly parameters: readonly Parameter[],
    readonly body: readonly Node[],
    readonly closure: ReadonlyMap<string, JinjaValue>,
    readonly lookup: Lookup,
    /** The rendering of the file it is defined in (P299): called from there, it reads that file's names as they are at the call. */
    readonly home: object = {},
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
  | { readonly kind: 'filter'; readonly of: Expression; readonly name: string; readonly args: readonly Expression[]; readonly named?: readonly (readonly [string, Expression])[] }
  | { readonly kind: 'list'; readonly items: readonly Expression[] }
  | { readonly kind: 'dict'; readonly entries: readonly (readonly [Expression, Expression])[] }
  | { readonly kind: 'unary'; readonly operator: 'not' | '-'; readonly of: Expression }
  | { readonly kind: 'binary'; readonly operator: string; readonly left: Expression; readonly right: Expression }
  | { readonly kind: 'test'; readonly of: Expression; readonly name: string; readonly negated: boolean; readonly args: readonly Expression[] }
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
        const name = this.next();
        // A test's argument (P299): in parentheses, `divisibleby(3)`, or one value after it, `equalto 3`.
        const args = this.take('(') ? this.arguments().map((each) => each.value) : startsArgument(this.peek()) ? [this.postfix()] : [];
        left = { kind: 'test', of: left, name, negated, args };
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
        // A filter's keyword argument is read by its place, `default(x, boolean=true)`, and by its name (P289): `map(attribute='name')`.
        const args = this.take('(') ? this.arguments() : [];
        const named = args.flatMap((each): (readonly [string, Expression])[] => (each.name === undefined ? [] : [[each.name, each.value]]));
        of = { kind: 'filter', of, name, args: args.map((each) => each.value), ...(named.length === 0 ? {} : { named }) };
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
      if (this.take(')')) return { kind: 'list', items: [] };
      const inner = this.expression();
      if (this.peek() !== ',') {
        this.expect(')');
        return inner;
      }
      // A tuple, read as the list it is iterated and unpacked as (P289).
      const items = [inner];
      while (this.take(',')) {
        if (this.peek() === ')') break;
        items.push(this.expression());
      }
      this.expect(')');
      return { kind: 'list', items };
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

/** Words that end a test rather than hand it a value. */
const NOT_AN_ARGUMENT = new Set(['and', 'or', 'if', 'else', 'not', 'in', 'is', 'recursive']);

/** Whether a token starts the one value a test is handed without parentheses (P299). */
function startsArgument(token: string | undefined): boolean {
  if (token === undefined) return false;
  if (/^['"\d]/.test(token) || token === '[' || token === '{') return true;
  return /^[A-Za-z_]\w*$/.test(token) && !NOT_AN_ARGUMENT.has(token);
}

/** An expression, or several written with commas between them as a tuple without its parentheses (P289). */
const parseTuple = (text: string): Expression => {
  const parser = new ExpressionParser(tokensOf(text));
  const first = parser.expression();
  if (parser.done) return first;
  const items = [first];
  while (parser.take(',')) {
    if (parser.done) break;
    items.push(parser.expression());
  }
  if (!parser.done) throw new NotRead('more after an expression');
  return { kind: 'list', items };
};

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
  // P299: `if` filters the items before they are counted; `recursive` lets the body call `loop(...)`.
  | { readonly kind: 'for'; readonly names: readonly string[]; readonly over: Expression; readonly filter?: Expression; readonly recursive: boolean; readonly written: string; readonly body: readonly Node[]; readonly otherwise: readonly Node[] }
  | { readonly kind: 'set'; readonly name: string; readonly value: Expression }
  // P299: an attribute of a namespace set, `{% set ns.found = true %}`.
  | { readonly kind: 'set-attribute'; readonly name: string; readonly attribute: string; readonly value: Expression; readonly written: string }
  // P289: several names set at once, unpacking what the value holds.
  | { readonly kind: 'set-many'; readonly names: readonly string[]; readonly value: Expression; readonly written: string }
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
        // What it loops over, then the filter of its items and `recursive` (P299), as Jinja reads a loop's head.
        const head = new ExpressionParser(tokensOf(match[2] as string));
        const over = head.or();
        const filter = head.take('if') ? head.or() : undefined;
        const recursive = head.take('recursive');
        if (!head.done) throw new NotRead('a for this does not read');
        const inner = block(['else', 'endfor']);
        if (inner.end === undefined) throw new NotRead('a for never ends');
        let otherwise: readonly Node[] = [];
        if (inner.end === 'else') {
          const last = block(['endfor']);
          if (last.end === undefined) throw new NotRead('a for never ends');
          otherwise = last.body;
        }
        body.push(place({ kind: 'for', names: (match[1] as string).split(',').map((name) => name.trim()), over, ...(filter === undefined ? {} : { filter }), recursive, written: piece.written, body: inner.body, otherwise }));
        continue;
      }
      if (word === 'set') {
        // Several names set at once, from a tuple or a list (P289): `{% set host, port = 'db', 5432 %}`.
        const many = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*,?\s*=\s*([\s\S]+)$/.exec(rest);
        if (many !== null) {
          body.push(place({ kind: 'set-many', names: (many[1] as string).split(',').map((name) => name.trim()), value: parseTuple(many[2] as string), written: piece.written }));
          continue;
        }
        const attribute = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(rest);
        if (attribute !== null) {
          body.push(place({ kind: 'set-attribute', name: attribute[1] as string, attribute: attribute[2] as string, value: parseExpression(attribute[3] as string), written: piece.written }));
          continue;
        }
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
type Filter = (value: JinjaValue, args: readonly JinjaValue[], named: ReadonlyMap<string, JinjaValue>) => JinjaValue;

const FILTERS: ReadonlyMap<string, Filter> = new Map<string, Filter>([
  ['default', (value, [fallback = '', boolean]) => (value instanceof Undefined || (boolean === true && truth(value) === false) ? fallback : value)],
  ['d', (value, args, named) => (FILTERS.get('default') as Filter)(value, args, named)],
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
  ['tojson', (value) => (holdsUnsettled(value) || value instanceof Pairs || value instanceof Macro || value instanceof Builtin ? new Unknown('tojson') : json(value))],
  // P289: the rest of Jinja's common filters, on values the files settle.
  ['count', (value, args, named) => (FILTERS.get('length') as Filter)(value, args, named)],
  ['first', (value) => (Array.isArray(value) ? ((value as JinjaValue[])[0] ?? new Undefined('first')) : typeof value === 'string' ? (value[0] ?? new Undefined('first')) : new Unknown('first'))],
  ['last', (value) => (Array.isArray(value) ? ((value as JinjaValue[]).at(-1) ?? new Undefined('last')) : typeof value === 'string' ? (value.at(-1) ?? new Undefined('last')) : new Unknown('last'))],
  ['list', (value) => listOf(value) ?? new Unknown('list')],
  ['reverse', (value) => (typeof value === 'string' ? [...value].reverse().join('') : (listOf(value)?.slice().reverse() ?? new Unknown('reverse')))],
  ['unique', (value) => {
    const items = listOf(value);
    return items === undefined ? new Unknown('unique') : items.filter((item, index) => items.findIndex((other) => same(other, item)) === index);
  }],
  ['sort', (value, [reverse = false], named) => {
    const items = listOf(value);
    if (items === undefined || !items.every((item) => typeof item === 'string' || typeof item === 'number')) return new Unknown('sort');
    const sorted = [...(items as (string | number)[])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return truth(named.get('reverse') ?? reverse) === true ? sorted.reverse() : sorted;
  }],
  ['float', (value, [fallback = 0]) => (isUnsettled(value) ? new Unknown('float') : typeof value === 'number' ? value : typeof value === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value) ? Number(value) : fallback)],
  ['abs', (value) => (typeof value === 'number' ? Math.abs(value) : new Unknown('abs'))],
  ['round', (value, [precision = 0]) => (typeof value === 'number' && typeof precision === 'number' ? Math.round(value * 10 ** precision) / 10 ** precision : new Unknown('round'))],
  ['min', (value) => extreme(value, (a, b) => a < b)],
  ['max', (value) => extreme(value, (a, b) => a > b)],
  ['sum', (value) => {
    const items = listOf(value);
    return items !== undefined && items.every((item) => typeof item === 'number') ? (items as number[]).reduce((a, b) => a + b, 0) : new Unknown('sum');
  }],
  ['map', (value, args, named) => {
    const items = listOf(value);
    if (items === undefined) return new Unknown('map');
    const attribute = named.get('attribute');
    if (typeof attribute === 'string') return items.map((item) => attributeOf(item, attribute, named.get('default')));
    const [name] = args;
    const filter = typeof name === 'string' ? FILTERS.get(name) : undefined;
    return filter === undefined ? new Unknown('map') : items.map((item) => filter(item, args.slice(1), new Map()));
  }],
  ['items', (value) => (isRecord(value) ? Object.entries(value as Record<string, JinjaValue>).map(([key, item]) => [key, item]) : new Unknown('items'))],
  ['dictsort', (value) => (isRecord(value) ? Object.keys(value).sort().map((key) => [key, (value as Record<string, JinjaValue>)[key] as JinjaValue]) : new Unknown('dictsort'))],
  ['format', (value, args) => {
    if (typeof value !== 'string') return new Unknown('format');
    let index = 0;
    let missing = false;
    const out = value.replace(/%[sd%]/g, (spec) => {
      if (spec === '%%') return '%';
      const text = rendered(args[index++] as JinjaValue);
      if (text === undefined) missing = true;
      return text ?? '';
    });
    return missing ? new Unknown('format') : out;
  }],
  ['indent', (value, [width = 4, first = false]) => (typeof width === 'number' ? textual(value, (text) => text.split('\n').map((line, index) => (index === 0 && first !== true) || line === '' ? line : ' '.repeat(width) + line).join('\n')) : new Unknown('indent'))],
  ['safe', (value) => value],
  ['escape', (value) => textual(value, (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&#34;').replace(/'/g, '&#39;'))],
  ['e', (value, args, named) => (FILTERS.get('escape') as Filter)(value, args, named)],
  ['center', (value, [width = 80]) => (typeof width === 'number' ? textual(value, (text) => {
    const pad = Math.max(0, width - text.length);
    return ' '.repeat(Math.floor(pad / 2)) + text + ' '.repeat(pad - Math.floor(pad / 2));
  }) : new Unknown('center'))],
  // P299: the items a test keeps or drops, of themselves or of an attribute of each, and items grouped by an attribute.
  ['select', selected(true, false)],
  ['reject', selected(false, false)],
  ['selectattr', selected(true, true)],
  ['rejectattr', selected(false, true)],
  ['groupby', (value, [attribute, fallback], named) => {
    const items = listOf(value);
    const by = named.get('attribute') ?? attribute;
    if (items === undefined || (typeof by !== 'string' && typeof by !== 'number')) return new Unknown('groupby');
    const otherwise = named.get('default') ?? fallback;
    const sensitive = truth(named.get('case_sensitive') ?? false) === true;
    const groups = new Map<string | number | boolean | null, { grouper: JinjaValue; list: JinjaValue[] }>();
    for (const item of items) {
      const grouper = attributeOf(item, String(by), otherwise);
      if (!(typeof grouper === 'string' || typeof grouper === 'number' || typeof grouper === 'boolean' || grouper === null)) return new Unknown('groupby');
      // Grouped and sorted without case by default, the grouper written as the group's first item writes it.
      const key = typeof grouper === 'string' && !sensitive ? grouper.toLowerCase() : grouper;
      const group = groups.get(key) ?? { grouper, list: [] };
      group.list.push(item);
      groups.set(key, group);
    }
    const keys = [...groups.keys()];
    if (!(keys.every((key) => typeof key === 'string') || keys.every((key) => typeof key === 'number' || typeof key === 'boolean'))) return new Unknown('groupby');
    const order = (key: string | number | boolean | null): string | number => (typeof key === 'string' ? key : Number(key));
    keys.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
    return keys.map((key) => {
      const { grouper, list } = groups.get(key) as { grouper: JinjaValue; list: JinjaValue[] };
      const pair: JinjaValue[] = [grouper, list];
      GROUPS.add(pair);
      return pair;
    });
  }],
]);

/**
 * `select` and `reject`, `selectattr` and `rejectattr` (P299): the items -
 * or each item's attribute - the test named passes, or fails; with no test
 * named, the ones that are true. A test not settled for any item leaves the
 * list not known; an attribute an item the files give does not have is
 * undefined, as Jinja reads it.
 */
function selected(keep: boolean, byAttribute: boolean): Filter {
  return (value, args) => {
    const items = listOf(value);
    const [attribute, ...afterAttribute] = args;
    if (items === undefined || (byAttribute && typeof attribute !== 'string')) return new Unknown(keep ? 'select' : 'reject');
    const [test, ...handed] = byAttribute ? afterAttribute : args;
    if (test !== undefined && typeof test !== 'string') return new Unknown(keep ? 'select' : 'reject');
    const out: JinjaValue[] = [];
    for (const item of items) {
      const subject = byAttribute ? attributeOf(item, attribute as string, undefined) : item;
      const missing = subject instanceof Undefined && !isUnsettled(item);
      const answer = test === undefined ? (missing ? false : truth(subject)) : testOf(test, subject, handed);
      if (answer === undefined) return new Unknown(keep ? 'select' : 'reject');
      if (answer === keep) out.push(item);
    }
    return out;
  };
}

/** Two values compared as Jinja's operators and tests compare them; `undefined` where they are not compared. */
function compared(operator: string, left: JinjaValue, right: JinjaValue): boolean | undefined {
  if (isUnsettled(left) || isUnsettled(right)) return undefined;
  switch (operator) {
    case '==':
      return same(left, right);
    case '!=':
      return !same(left, right);
    case '<':
    case '>':
    case '<=':
    case '>=': {
      if (!((typeof left === 'number' && typeof right === 'number') || (typeof left === 'string' && typeof right === 'string'))) return undefined;
      const a = left as number | string;
      const b = right as number | string;
      return operator === '<' ? a < b : operator === '>' ? a > b : operator === '<=' ? a <= b : a >= b;
    }
    case 'in':
      if (typeof right === 'string' && typeof left === 'string') return right.includes(left);
      if (Array.isArray(right)) return (right as JinjaValue[]).some((item) => same(item, left));
      if (isRecord(right) && typeof left === 'string') return left in right;
      return undefined;
    default:
      return undefined;
  }
}

/** The tests that compare a value with the one they are handed, by every name Jinja gives them. */
const COMPARING = new Map([
  ['==', '=='], ['eq', '=='], ['equalto', '=='],
  ['!=', '!='], ['ne', '!='],
  ['<', '<'], ['lt', '<'], ['lessthan', '<'],
  ['<=', '<='], ['le', '<='],
  ['>', '>'], ['gt', '>'], ['greaterthan', '>'],
  ['>=', '>='], ['ge', '>='],
  ['in', 'in'],
]);

/**
 * A Jinja test of a value (P299, the first five P273): its answer, `undefined`
 * where the files do not settle it. A test this does not know is not read.
 */
function testOf(name: string, value: JinjaValue, args: readonly JinjaValue[]): boolean | undefined {
  if (name === 'defined') return value instanceof Unknown ? undefined : !(value instanceof Undefined);
  if (name === 'undefined') return value instanceof Unknown ? undefined : value instanceof Undefined;
  if (isUnsettled(value) || args.some(isUnsettled)) return undefined;
  const comparing = COMPARING.get(name);
  if (comparing !== undefined) return args.length === 0 ? undefined : compared(comparing, value, args[0] as JinjaValue);
  switch (name) {
    case 'none':
      return value === null;
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'float':
      return typeof value === 'number' && !Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'true':
      return value === true;
    case 'false':
      return value === false;
    case 'mapping':
      return isRecord(value) || value instanceof Namespace;
    case 'sequence':
    case 'iterable':
      return Array.isArray(value) || typeof value === 'string' || isRecord(value) || value instanceof Pairs;
    case 'callable':
      return value instanceof Macro || value instanceof Builtin;
    case 'lower':
      return typeof value === 'string' ? value === value.toLowerCase() : undefined;
    case 'upper':
      return typeof value === 'string' ? value === value.toUpperCase() : undefined;
    case 'odd':
    case 'even':
      return typeof value === 'number' && Number.isInteger(value) ? (Math.abs(value) % 2 === 1) === (name === 'odd') : undefined;
    case 'divisibleby': {
      const [by] = args;
      return typeof value === 'number' && typeof by === 'number' && by !== 0 ? value % by === 0 : undefined;
    }
    case 'sameas': {
      const [other] = args;
      // Python's `is`: the same value, for the values written plainly.
      return other === undefined ? undefined : value === other || (value === null && other === null);
    }
    default:
      throw new NotRead(`the test ${name} is not run here`);
  }
}

/** The items of a list, a text's characters or a mapping's keys, as Jinja iterates them; `undefined` where it is none of these. */
function listOf(value: JinjaValue): JinjaValue[] | undefined {
  if (Array.isArray(value)) return [...(value as JinjaValue[])];
  if (typeof value === 'string') return [...value];
  if (isRecord(value)) return Object.keys(value);
  if (value instanceof Pairs) return value.pairs.map(([key, item]) => [key, item]);
  return undefined;
}

/** The least or the greatest of a list of numbers or texts. */
function extreme(value: JinjaValue, before: (a: string | number, b: string | number) => boolean): JinjaValue {
  const items = listOf(value);
  if (items === undefined || items.length === 0 || !(items.every((item) => typeof item === 'number') || items.every((item) => typeof item === 'string'))) return new Unknown('min or max');
  return (items as (string | number)[]).reduce((best, item) => (before(item, best) ? item : best));
}

/** A member of a value by a dotted name, as `map(attribute=...)` reads one. */
function attributeOf(item: JinjaValue, attribute: string, fallback: JinjaValue | undefined): JinjaValue {
  let at: JinjaValue = item;
  for (const key of attribute.split('.')) {
    if (isRecord(at)) at = (at as Record<string, JinjaValue>)[key] ?? new Undefined(key);
    else if (Array.isArray(at) && /^\d+$/.test(key)) at = (at as JinjaValue[])[Number(key)] ?? new Undefined(key);
    else return isUnsettled(at) ? at : new Undefined(key);
  }
  return at instanceof Undefined && fallback !== undefined ? fallback : at;
}

/** The functions Jinja gives every template (P289): `range` and `dict`. */
const GLOBALS: ReadonlyMap<string, Builtin> = new Map([
  [
    'range',
    new Builtin('range', (args) => {
      if (!args.every((arg) => typeof arg === 'number')) return new Unknown('range');
      const [a, b, step = 1] = args as number[];
      const [from, to] = b === undefined ? [0, a ?? 0] : [a ?? 0, b];
      if (step === 0 || Math.abs((to - from) / step) > 256) return new Unknown('range');
      const out: number[] = [];
      for (let at = from; step > 0 ? at < to : at > to; at += step) out.push(at);
      return out;
    }),
  ],
  ['dict', new Builtin('dict', (args, named) => (args.length === 0 ? Object.fromEntries(named) : isRecord(args[0]) ? { ...(args[0] as Record<string, JinjaValue>), ...Object.fromEntries(named) } : new Unknown('dict')))],
  // P299: a record whose attributes a loop can set and the text after it read.
  ['namespace', new Builtin('namespace', (args, named) => (args.length === 0 || isRecord(args[0]) ? new Namespace((namespaces += 1), { ...((args[0] ?? {}) as Record<string, JinjaValue>), ...Object.fromEntries(named) }) : new Unknown('namespace')))],
]);

/** A method of a text, a list or a mapping (P289), as Python gives a template one; `undefined` where it is not one read here. */
const methodOf = (of: JinjaValue, name: string): Builtin | undefined => {
  if (typeof of === 'string') {
    const text = (change: (args: readonly JinjaValue[]) => JinjaValue): Builtin => new Builtin(name, (args) => (args.some(isUnsettled) ? new Unknown(name) : change(args)));
    switch (name) {
      case 'lower':
        return text(() => of.toLowerCase());
      case 'upper':
        return text(() => of.toUpperCase());
      case 'strip':
      case 'lstrip':
      case 'rstrip':
        return text(([chars]) => {
          const set = typeof chars === 'string' ? chars : undefined;
          const trims = (character: string): boolean => (set === undefined ? /\s/.test(character) : set.includes(character));
          let start = 0;
          let end = of.length;
          if (name !== 'rstrip') while (start < end && trims(of[start] as string)) start += 1;
          if (name !== 'lstrip') while (end > start && trims(of[end - 1] as string)) end -= 1;
          return of.slice(start, end);
        });
      case 'replace':
        return text(([from, to]) => (typeof from === 'string' && typeof to === 'string' ? of.split(from).join(to) : new Unknown(name)));
      case 'split':
        return text(([separator, most]) => {
          const parts = typeof separator === 'string' ? of.split(separator) : of.trim().split(/\s+/).filter((part) => part !== '');
          if (typeof most !== 'number' || most < 0 || parts.length <= most + 1) return parts;
          return [...parts.slice(0, most), parts.slice(most).join(typeof separator === 'string' ? separator : ' ')];
        });
      case 'startswith':
        return text(([prefix]) => (typeof prefix === 'string' ? of.startsWith(prefix) : new Unknown(name)));
      case 'endswith':
        return text(([suffix]) => (typeof suffix === 'string' ? of.endsWith(suffix) : new Unknown(name)));
      case 'title':
      case 'capitalize':
        return text(() => (FILTERS.get(name) as Filter)(of, [], new Map()));
      case 'join':
        return text(([items]) => (FILTERS.get('join') as Filter)(items as JinjaValue, [of], new Map()));
      case 'format':
        return new Builtin(name, (args, named) => {
          let index = 0;
          let missing = false;
          const out = of.replace(/\{\{|\}\}|\{([A-Za-z_]\w*|\d*)\}/g, (whole, key: string | undefined) => {
            if (whole === '{{') return '{';
            if (whole === '}}') return '}';
            const value = key === undefined || key === '' ? args[index++] : /^\d+$/.test(key) ? args[Number(key)] : named.get(key);
            const written = value === undefined ? undefined : rendered(value);
            if (written === undefined) missing = true;
            return written ?? '';
          });
          return missing ? new Unknown(name) : out;
        });
      default:
        return undefined;
    }
  }
  if (isRecord(of)) {
    const record = of as Record<string, JinjaValue>;
    switch (name) {
      case 'get':
        return new Builtin(name, ([key, fallback = null]) => (typeof key === 'string' ? (record[key] ?? fallback) : new Unknown(name)));
      case 'keys':
        return new Builtin(name, () => Object.keys(record));
      case 'values':
        return new Builtin(name, () => Object.values(record));
      default:
        return undefined;
    }
  }
  return undefined;
};

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
  /**
   * What the expression changes of what is shared as it is evaluated (P306):
   * a namespace a macro or a recursive `loop(...)` it calls sets, what
   * `loop.changed` is handed - read by what is evaluated after it, and kept
   * on the way the statement goes on with.
   */
  readonly changes?: Map<string, JinjaValue>;
}

/** A shared name as an expression sees it: as it changed while the expression is evaluated, else as the way holds it (P306). */
const sharedNow = (scope: Scope, name: string): JinjaValue | undefined => (scope.changes?.has(name) === true ? scope.changes.get(name) : scope.names.get(name));

/** The names a scope sees, with what its expression has changed so far over them (P306). */
const namesNow = (scope: Scope): ReadonlyMap<string, JinjaValue> => overlaid(scope.names, scope.changes ?? new Map());

/** A rendering of a macro's body or of a recursive loop: its text, and what it changed of what is shared (P306). */
interface Rendered {
  readonly text: string;
  readonly shared: ReadonlyMap<string, JinjaValue>;
}

/** What several ways hold of a shared name: the same, else what they agree on of a namespace's attributes, the rest not known (P306). */
const agreed = (name: string, values: readonly (JinjaValue | undefined)[]): JinjaValue | undefined => {
  const [first] = values;
  if (values.every((value) => value === first || (value !== undefined && first !== undefined && same(value, first)))) return first;
  if (!values.every((value) => value === undefined || isRecord(value))) return new Unknown(name);
  const records = values.map((value) => (value ?? {}) as Readonly<Record<string, JinjaValue>>);
  const keys = new Set(records.flatMap((record) => Object.keys(record)));
  return Object.fromEntries([...keys].map((key) => [key, agreed(key, records.map((record) => record[key])) ?? new Unknown(key)]));
};

/**
 * What a macro or a recursive loop an expression calls renders, as the
 * expression's value (P306): its text where every way renders it alike, and
 * what it changed of what is shared written to the scope's changes - where
 * the ways change it differently, what they agree on.
 */
const handedOver = (renderings: readonly Rendered[], scope: Scope, written: string): JinjaValue => {
  const names = new Set(renderings.flatMap((each) => [...each.shared.keys()]));
  for (const name of names) {
    const before = sharedNow(scope, name);
    const value = agreed(name, renderings.map((each) => (each.shared.has(name) ? each.shared.get(name) : before)));
    if (value !== undefined) scope.changes?.set(name, value);
  }
  const texts = [...new Set(renderings.map((each) => each.text))];
  return texts.length === 1 ? (texts[0] as string) : new Unknown(written);
};

/** Renderings with the same text and the same changes, once (P306). */
const distinct = (renderings: readonly Rendered[]): Rendered[] => {
  const sameShared = (a: ReadonlyMap<string, JinjaValue>, b: ReadonlyMap<string, JinjaValue>): boolean =>
    a.size === b.size && [...a].every(([name, value]) => b.has(name) && (b.get(name) === value || same(b.get(name) as JinjaValue, value)));
  const out: Rendered[] = [];
  for (const each of renderings) if (!out.some((other) => other.text === each.text && sameShared(other.shared, each.shared))) out.push(each);
  return out;
};

/** A call of a macro: the macro, and what it is handed. */
interface MacroCall {
  readonly macro: Macro;
  readonly positional: readonly JinjaValue[];
  readonly named: ReadonlyMap<string, JinjaValue>;
  /** The names bound where it is called (P299). */
  readonly from: ReadonlyMap<string, JinjaValue>;
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
  return { macro: callee, positional, named, from: namesNow(scope) };
};

/**
 * What a macro renders, every way its conditions go, each once (P273): its
 * body with its parameters bound - what the call hands, else the default
 * written, else undefined, as Jinja binds them - over the names bound where
 * it was defined, itself, and the caller a call block hands it.
 */
/** The names a macro's body reads of `varargs` and `kwargs` (P289), read once per body. */
const READS = new WeakMap<readonly Node[], ReadonlySet<string>>();

const readsOf = (body: readonly Node[]): ReadonlySet<string> => {
  let found = READS.get(body);
  if (found === undefined) {
    const text = JSON.stringify(body, (_key, value: unknown) => (value instanceof Macro || value instanceof Builtin || value instanceof Pairs ? undefined : value));
    found = new Set(['varargs', 'kwargs'].filter((name) => text.includes(`"kind":"name","name":"${name}"`)));
    READS.set(body, found);
  }
  return found;
};

const renderMacro = (call: MacroCall, run: Run, caller?: Macro): Rendered[] => {
  const { macro, positional, named } = call;
  if (run.depth.value >= MOST_DEPTH) throw new NotRead('macros call each other deeper than is followed');
  // What a macro is handed past its parameters is `varargs` and `kwargs`, where its body reads them (P289).
  const takes = readsOf(macro.body);
  const extra = positional.slice(macro.parameters.length);
  const extraNamed = [...named.entries()].filter(([name]) => !macro.parameters.some((each) => each.name === name));
  if (extra.length > 0 && !takes.has('varargs')) throw new NotRead(`${macro.name} is handed more than it takes`);
  for (const [name] of extraNamed) if (!takes.has('kwargs')) throw new NotRead(`${macro.name} takes no ${name}`);
  const names = new Map(macro.closure);
  // A name its file binds after it, or binds anew, is read as it is when the macro is called (P299), as Jinja looks
  // a macro's free names up then: the end of the file imported, or the names where it is called in its own file -
  // but not what a loop, a with or a macro around the call binds.
  for (const [name, value] of macro.late ?? []) names.set(name, value);
  if (macro.home === run.home) for (const [name, value] of call.from) if (!run.locals.has(name)) names.set(name, value);
  // What is shared is as it is where the macro is called, wherever the macro is defined (P306): a namespace is one object.
  for (const [name, value] of call.from) if (name.startsWith(SHARED)) names.set(name, value);
  names.set('varargs', extra);
  names.set('kwargs', Object.fromEntries(extraNamed));
  names.set(macro.name, macro);
  const inner: Run = { ...run, lookup: macro.lookup, home: macro.home, locals: new Set([...macro.parameters.map((each) => each.name), 'varargs', 'kwargs', 'caller']) };
  macro.parameters.forEach((parameter, index) => {
    const value = index < positional.length ? (positional[index] as JinjaValue) : named.has(parameter.name) ? (named.get(parameter.name) as JinjaValue) : parameter.fallback === undefined ? new Undefined(parameter.name) : evaluate(parameter.fallback, { names, lookup: macro.lookup, run: inner });
    names.set(parameter.name, value);
  });
  if (caller !== undefined) names.set('caller', caller);
  run.depth.value += 1;
  try {
    // What its body changes of what is shared is handed back to the caller (P306).
    return distinct(renderNodes(macro.body, [{ text: '', names, lines: [] }], inner).map((way) => ({ text: way.text, shared: sharedChanges(way.names, call.from) })));
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
      if (bound !== undefined) return bound;
      const given = fromFiles(scope.lookup(expression.name, []), expression.name);
      // A function Jinja gives every template, where the files give nothing by its name (P289).
      return given instanceof Undefined ? (GLOBALS.get(expression.name) ?? given) : given;
    }
    case 'member': {
      const of = evaluate(expression.of, scope);
      const key = evaluate(expression.key, scope);
      if (of instanceof Unknown || isUnsettled(key)) return new Unknown('a member');
      if (of instanceof Undefined) return new Undefined(of.written);
      // A namespace's attribute: what was set on this way since it was made, else what it was made with (P299).
      if (of instanceof Namespace && typeof key === 'string') {
        const since = sharedNow(scope, NAMESPACE + of.id) as Readonly<Record<string, JinjaValue>> | undefined;
        return since?.[key] ?? of.initial[key] ?? new Undefined(key);
      }
      // A group `groupby` gives, by its names (P299).
      if (Array.isArray(of) && GROUPS.has(of) && (key === 'grouper' || key === 'list')) return (of as JinjaValue[])[key === 'grouper' ? 0 : 1] as JinjaValue;
      // A method of a text or a mapping, where the mapping holds nothing by its name (P289).
      if (expression.key.kind === 'literal' && typeof key === 'string' && !(isRecord(of) && key in of)) {
        const method = methodOf(of, key);
        if (method !== undefined) return method;
      }
      if (Array.isArray(of) && typeof key === 'number') return (of as JinjaValue[]).at(key) ?? new Undefined(String(key));
      // `parts.0`, as Jinja reads a digit after a dot: the item at that place (P289).
      if (Array.isArray(of) && typeof key === 'string' && /^\d+$/.test(key)) return (of as JinjaValue[])[Number(key)] ?? new Undefined(key);
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
      if (called !== undefined) return handedOver(renderMacro(called, scope.run as Run), scope, `${called.macro.name}()`);
      // A function Jinja gives, or a method of a value (P289).
      if (expression.of.kind === 'name' || expression.of.kind === 'member') {
        const written = evaluate(expression.of, scope);
        // A recursive loop's record is called to loop again (P299).
        const callee = isRecord(written) && written['__call__'] instanceof Builtin ? written['__call__'] : written;
        if (callee instanceof Builtin) {
          const positional: JinjaValue[] = [];
          const named = new Map<string, JinjaValue>();
          for (const arg of expression.args) {
            const value = evaluate(arg.value, scope);
            if (arg.name === undefined) positional.push(value);
            else named.set(arg.name, value);
          }
          return callee.call(positional, named, scope);
        }
        if (callee instanceof Unknown) return new Unknown(`${callee.written}()`);
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
      const named = new Map((expression.named ?? []).map(([name, arg]) => [name, evaluate(arg, scope)] as const));
      const out = filter(value, args, named);
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
      const answer = testOf(expression.name, of, expression.args.map((arg) => evaluate(arg, scope)));
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
        case '!=':
        case '<':
        case '>':
        case '<=':
        case '>=':
        case 'in':
          return compared(expression.operator, left, right) ?? new Unknown(expression.operator);
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
  /** The rendering of the file whose nodes are rendered, and the names a loop, a with or a macro around them binds (P299). */
  readonly home: object;
  readonly locals: ReadonlySet<string>;
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
  return renderNodes(first, [{ ...way, names }], run).map((done) => ({ ...done, names: handedBack(done.names, way.names) }));
};

/** A file another names, rendered with the names bound and the lookup, or none of them (P273). */
const renderLoaded = (loaded: Loaded, start: Way, withContext: boolean, run: Run): Way[] => {
  if (run.depth.value >= MOST_DEPTH) throw new NotRead('files include each other deeper than is followed');
  run.depth.value += 1;
  try {
    return renderTemplate(loaded.nodes, [withContext ? start : { ...start, names: new Map() }], withContext ? { ...run, home: loaded, locals: new Set() } : { ...run, lookup: NOTHING, blocks: new Map(), home: loaded, locals: new Set() });
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
  // A macro of the file reads its names as the file ends them (P299): where every way ends a name alike.
  const late = new Map<string, JinjaValue>();
  for (const name of new Set(ways.flatMap((each) => [...each.names.keys()]))) {
    const values = ways.map((each) => each.names.get(name));
    const [first] = values;
    if (first !== undefined && values.every((value) => value === first || (value !== undefined && !(value instanceof Macro) && same(value, first)))) late.set(name, first);
  }
  for (const value of Object.values(out)) if (value instanceof Macro && value.home === loaded) value.late = late;
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

/** A text rendered on its own from a way: each text, and the way's names with what it changed of what is shared (P306). */
const renderApart = (body: readonly Node[], way: Way, run: Run): Array<{ readonly text: string; readonly names: ReadonlyMap<string, JinjaValue> }> =>
  renderNodes(body, [{ text: '', names: way.names, lines: [] }], run).map((done) => ({ text: done.text, names: handedBack(done.names, way.names) }));

const renderNode = (node: Node, way: Way, outer: Run): Way[] => {
  // What a node of the file rendered writes through another file or a macro is said at its line (P273).
  const run: Run = node.line === undefined ? outer : { ...outer, anchor: node.line };
  // What the node's expressions change of what is shared, kept on the way it goes on with (P306).
  const changes = new Map<string, JinjaValue>();
  const scope: Scope = { names: way.names, lookup: run.lookup, run, changes };
  /** The way with what the expressions evaluated so far changed; `names` the names it goes on from. */
  const settled = (names: ReadonlyMap<string, JinjaValue> = way.names): Way => ({ ...way, names: overlaid(names, changes) });
  const here = (): number => run.anchor ?? 1;
  switch (node.kind) {
    case 'text':
      return [appended(way, node.text, (line) => (node.line === undefined ? here() : node.line + line))];
    case 'output': {
      // A macro called where its text is written is written every way it renders (P273).
      const called = macroCalled(node.expression, scope);
      // What the macro changes of what is shared is the caller's after it (P306).
      if (called !== undefined) return renderMacro(called, run).map((done) => appended(settled(overlaid(way.names, done.shared)), done.text, here));
      const value = evaluate(node.expression, scope);
      return [written(settled(), value, node, node.written, run)];
    }
    case 'set': {
      const value = evaluate(node.value, scope);
      return [{ ...way, names: new Map([...settled().names, [node.name, value]]) }];
    }
    case 'set-attribute': {
      // Only a namespace's attributes are set, as Jinja allows (P299); kept on the way, and handed back past loops, blocks and macros.
      const target = evaluate({ kind: 'name', name: node.name }, scope);
      if (!(target instanceof Namespace)) throw new NotRead(`${node.written} sets an attribute of what is not a namespace`);
      const value = evaluate(node.value, scope);
      const key = NAMESPACE + target.id;
      const since = (sharedNow(scope, key) ?? {}) as Readonly<Record<string, JinjaValue>>;
      return [{ ...way, names: new Map([...settled().names, [key, { ...since, [node.attribute]: value }]]) }];
    }
    case 'set-many': {
      const value = evaluate(node.value, scope);
      const items = Array.isArray(value) ? (value as JinjaValue[]) : undefined;
      if (items === undefined || items.length !== node.names.length) {
        // A value the files do not give leaves every name not known; one that holds another number of items is not read.
        if (!isUnsettled(value)) throw new NotRead(`${node.written} unpacks what it does not hold`);
        return [{ ...way, names: new Map([...settled().names, ...node.names.map((name): [string, JinjaValue] => [name, new Unknown(name)])]) }];
      }
      return [{ ...way, names: new Map([...settled().names, ...node.names.map((name, at): [string, JinjaValue] => [name, items[at] as JinjaValue])]) }];
    }
    case 'set-block':
      // What the block's body changes of what is shared stays changed (P306).
      return renderApart(node.body, way, run).map((done) => {
        const value = evaluate(node.filtered, { ...scope, names: new Map([...done.names, [HELD, done.text]]) });
        return { ...way, names: new Map([...settled(done.names).names, [node.name, value]]) };
      });
    case 'filter-block':
      return renderApart(node.body, way, run).map((done) => {
        const value = evaluate(node.filtered, { ...scope, names: new Map([...done.names, [HELD, done.text]]) });
        return written(settled(done.names), value, node, node.written, run);
      });
    case 'with': {
      const values = node.assignments.map(([name, value]): [string, JinjaValue] => [name, evaluate(value, scope)]);
      const start = settled();
      return renderNodes(node.body, [{ ...start, names: new Map([...start.names, ...values]) }], { ...run, locals: new Set([...run.locals, ...node.assignments.map(([name]) => name)]) }).map((done) => ({ ...done, names: handedBack(done.names, start.names) }));
    }
    case 'macro':
      return [{ ...way, names: new Map([...way.names, [node.name, new Macro(node.name, node.parameters, node.body, way.names, run.lookup, run.home)]]) }];
    case 'call-block': {
      const called = macroCalled(node.call, scope);
      if (called === undefined) throw new NotRead(`${node.written} calls no macro the files define`);
      const caller = new Macro('caller', node.parameters, node.body, way.names, run.lookup);
      return renderMacro(called, run, caller).map((done) => appended(settled(overlaid(way.names, done.shared)), done.text, here));
    }
    case 'include': {
      const loaded = loadNamed(node.name, node.written, scope, run);
      if (loaded === undefined) {
        if (node.missing) return [way];
        throw new NotRead(`${node.written} names a file that is not in the repository`);
      }
      // What the included file binds stays in it.
      return renderLoaded(loaded, way, node.withContext, run).map((done) => ({ ...done, names: handedBack(done.names, way.names) }));
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
        // What a test changes of what is shared - `loop.changed`, a macro setting a namespace - is kept past it (P306).
        const test = truth(evaluate(branch.test, scope));
        if (test === true) return renderNodes(branch.body, [settled()], run);
        if (test === false) continue;
        // Not decided by what the files give: this branch, and every way the rest can go (P264).
        if (!run.undecided.includes(branch.written)) run.undecided.push(branch.written);
        const rest: Node = { kind: 'if', branches: node.branches.slice(index + 1), otherwise: node.otherwise };
        return [...renderNodes(branch.body, [settled()], run), ...renderNode(rest, settled(), run)];
      }
      return renderNodes(node.otherwise, [settled()], run);
    }
    case 'for': {
      const value = evaluate(node.over, scope);
      return loopOver(node, value, settled(), run, 0);
    }
  }
};

/**
 * A loop over what it is handed, at a depth (P273, P289, P299): each item the
 * loop's `if` keeps bound to its names, with the loop's record - where it is,
 * what is beside it, `cycle`, `changed`, and for a recursive loop `loop(...)`,
 * the same loop over what it is handed one deeper, its text written there.
 * What the body binds stays in the body, as Jinja scopes a loop, save what it
 * sets on a namespace.
 */
const loopOver = (node: Extract<Node, { kind: 'for' }>, over: JinjaValue, way: Way, outer: Run, depth: number): Way[] => {
  if (!(over instanceof Pairs) && !Array.isArray(over) && !isRecord(over) && typeof over !== 'string') throw new NotRead(`${node.written} loops over what the files do not give`);
  const all: JinjaValue[] = over instanceof Pairs ? over.pairs.map(([key, value]) => [key, value]) : Array.isArray(over) ? [...(over as JinjaValue[])] : isRecord(over) ? Object.keys(over) : [...over];
  const bind = (item: JinjaValue): Map<string, JinjaValue> => {
    const bound = new Map<string, JinjaValue>();
    const [only] = node.names;
    if (node.names.length === 1 && only !== undefined) bound.set(only, item);
    else if (Array.isArray(item) && item.length === node.names.length) node.names.forEach((name, at) => bound.set(name, (item as JinjaValue[])[at] as JinjaValue));
    else throw new NotRead(`${node.written} unpacks what it does not hold`);
    return bound;
  };
  // The items the loop's `if` keeps, before they are counted (P299).
  const filter = node.filter;
  const items =
    filter === undefined
      ? all
      : all.filter((item) => {
          const kept = truth(evaluate(filter, { names: new Map([...way.names, ...bind(item)]), lookup: outer.lookup, run: outer }));
          if (kept === undefined) throw new NotRead(`${node.written} keeps items by what the files do not decide`);
          return kept;
        });
  if (items.length === 0) return renderNodes(node.otherwise, [way], outer);
  const run: Run = { ...outer, locals: new Set([...outer.locals, ...node.names, 'loop']) };
  /**
   * What `loop.changed(...)` was last handed in this loop (P299, P306): kept on
   * the way under the loop's own name, so every call - two in one item too -
   * is compared with the call before it, as Jinja keeps one value per loop.
   */
  const handed = CHANGED + (loops += 1);
  const changed = new Builtin('changed', (args, _named, scope) => {
    const now = args.some(holdsUnsettled) ? new Unknown('loop.changed') : json(args);
    const last = sharedNow(scope, handed);
    scope.changes?.set(handed, now);
    if (now instanceof Unknown || last instanceof Unknown) return new Unknown('loop.changed');
    return last !== now;
  });
  /**
   * A recursive loop's `loop(...)` (P299): the same loop over what it is
   * handed, one deeper, from the names the loop started with and what is
   * shared as it is at the call; what it changes of that is the caller's (P306).
   */
  const again = new Builtin('loop', ([inner], _named, scope) => {
    if (inner instanceof Undefined) return '';
    if (inner === undefined || isUnsettled(inner)) return new Unknown('loop()');
    if (run.depth.value >= MOST_DEPTH) throw new NotRead(`${node.written} recurses deeper than is followed`);
    const from = namesNow(scope);
    const start = new Map(way.names);
    for (const [name, value] of from) if (name.startsWith(SHARED)) start.set(name, value);
    run.depth.value += 1;
    try {
      return handedOver(distinct(loopOver(node, inner, { text: '', names: start, lines: [] }, outer, depth + 1).map((done) => ({ text: done.text, shared: sharedChanges(done.names, from) }))), scope, 'loop()');
    } finally {
      run.depth.value -= 1;
    }
  });
  let ways: Way[] = [way];
  items.forEach((item, index) => {
    const bound = bind(item);
    // The loop's own record (P289).
    bound.set('loop', {
      index: index + 1,
      index0: index,
      revindex: items.length - index,
      revindex0: items.length - index - 1,
      first: index === 0,
      last: index === items.length - 1,
      length: items.length,
      depth: depth + 1,
      depth0: depth,
      ...(index > 0 ? { previtem: items[index - 1] as JinjaValue } : {}),
      ...(index < items.length - 1 ? { nextitem: items[index + 1] as JinjaValue } : {}),
      cycle: new Builtin('cycle', (args) => (args.length === 0 ? new Unknown('cycle') : (args[index % args.length] as JinjaValue))),
      changed,
      ...(node.recursive ? { __call__: again } : {}),
    });
    ways = ways.flatMap((at) => renderNodes(node.body, [{ ...at, names: new Map([...at.names, ...bound]) }], run).map((done) => ({ ...done, names: handedBack(done.names, at.names) })));
  });
  // What `loop.changed` was last handed ends with the loop (P306), and is not handed past it.
  return ways.map((done) => {
    if (!done.names.has(handed)) return done;
    const names = new Map(done.names);
    names.delete(handed);
    return { ...done, names };
  });
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
    const run: Run = { lookup, file, kept: new Map(), unrendered: new Map(), undecided: [], load: options.load, templates: new Map(), loaded: new Set(), blocks: new Map(), depth: { value: 0 }, home: nodes, locals: new Set() };
    const all = renderTemplate(nodes, [{ text: '', names: new Map(), lines: [] }], run);
    const ways = [...new Set(all.map((way) => way.text))];
    return { text: ways[0] ?? '', unrendered: run.unrendered, ways, undecided: run.undecided, loaded: [...run.loaded].sort(), lines: settledLines(all[0]?.lines ?? []) };
  } catch (error) {
    if (error instanceof NotRead) return keptStatements(text, lookup, file);
    throw error;
  }
};
