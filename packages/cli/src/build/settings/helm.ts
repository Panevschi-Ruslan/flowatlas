import { stringify } from 'yaml';

/**
 * A chart's templates rendered with the values it is installed with (P260).
 *
 * A chart's `templates/service.yaml` writes `port: {{ .Values.service.port }}`
 * and its `values.yaml` says `service: { port: 80 }`: the manifest the cluster
 * is given routes port 80, and nothing else in the file says so. This is the
 * part of the template language a chart writes its manifests in that a
 * manifest's facts depend on, read without the tool that installs it: value
 * lookups (`.Values`, `.Release`, `.Chart`), pipelines through the common
 * functions (`default`, `quote`, `toYaml | nindent`, `printf`, `include`),
 * variables, and the control structures (`if` / `else if` / `else`, `with`,
 * `range`, `define`, `template`).
 *
 * What the files do not say stays unknown, never guessed: a value the cluster
 * answers (`.Capabilities`, `lookup`), a function this reader does not know,
 * a template rendered from a string (`tpl`). An unknown value written into
 * the manifest is a mark the manifest reader takes as nothing written
 * (`UNREAD_MARK`); a condition that is unknown is rendered both ways, every
 * way it can go, and the caller compares what each way says (`renderings`).
 */

/** What an unknown value is written as, so the manifest reader takes the scalar holding it as unread. */
export const UNREAD_MARK = '__flowatlas_unread__';

/** A value nothing the reader has says. */
const UNKNOWN: unique symbol = Symbol('unknown');
type Value = unknown;

const isUnknown = (value: Value): value is typeof UNKNOWN => value === UNKNOWN;
const isRecord = (value: Value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A condition rendered once each way, by where it is written. */
class Undecided extends Error {
  constructor(readonly at: number) {
    super('undecided');
  }
}

/** A template the reader cannot render at all. */
class Unrenderable extends Error {}

// ---------------------------------------------------------------- the text

type Node =
  | { kind: 'text'; text: string; at: number }
  | { kind: 'action'; pipe: Pipe; at: number }
  | { kind: 'if'; branches: Array<{ cond: Pipe; body: Node[]; at: number }>; otherwise?: Node[]; at: number }
  | { kind: 'with'; pipe: Pipe; body: Node[]; otherwise?: Node[]; at: number }
  | { kind: 'range'; pipe: Pipe; vars: string[]; body: Node[]; otherwise?: Node[]; at: number }
  | { kind: 'template'; name: string; pipe?: Pipe; at: number };

type Term =
  | { kind: 'literal'; value: Value }
  | { kind: 'field'; base: 'dot' | 'root' | string; path: string[] }
  | { kind: 'call'; name: string }
  | { kind: 'group'; pipe: Pipe; path: string[] };

interface Command {
  readonly terms: Term[];
}

interface Pipe {
  readonly declare?: { readonly names: string[]; readonly assign: boolean };
  readonly commands: Command[];
}

interface Token {
  readonly kind: 'text' | 'action';
  text: string;
  at: number;
  readonly trimLeft?: boolean;
  readonly trimRight?: boolean;
}

/** The text split into its literal parts and its actions, trim markers applied. */
const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('{{', index);
    if (open < 0) {
      tokens.push({ kind: 'text', text: source.slice(index), at: index });
      break;
    }
    if (open > index) tokens.push({ kind: 'text', text: source.slice(index, open), at: index });
    let close = open + 2;
    let quote: string | undefined;
    for (; close < source.length; close += 1) {
      const char = source[close];
      if (quote !== undefined) {
        if (char === '\\' && quote === '"') close += 1;
        else if (char === quote) quote = undefined;
        continue;
      }
      if (char === '"' || char === '`') quote = char;
      else if (char === '}' && source[close + 1] === '}') break;
    }
    if (close >= source.length) throw new Unrenderable('an action is not closed');
    let body = source.slice(open + 2, close);
    const trimLeft = /^-\s/.test(body) || body === '-';
    const trimRight = /\s-$/.test(body);
    if (trimLeft) body = body.slice(1);
    if (trimRight) body = body.slice(0, -1);
    tokens.push({ kind: 'action', text: body.trim(), at: open, trimLeft, trimRight });
    index = close + 2;
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as Token;
    if (token.kind !== 'action') continue;
    const before = tokens[i - 1];
    const after = tokens[i + 1];
    if (token.trimLeft === true && before?.kind === 'text') before.text = before.text.replace(/\s+$/, '');
    if (token.trimRight === true && after?.kind === 'text') {
      const kept = after.text.replace(/^\s+/, '');
      after.at += after.text.length - kept.length;
      after.text = kept;
    }
  }
  return tokens.filter((token) => token.kind === 'action' || token.text !== '');
};

/** The words of an action: strings, parentheses and pipes kept whole. */
const wordsOf = (text: string): string[] => {
  const out: string[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] as string;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '"' || char === '`') {
      let end = index + 1;
      while (end < text.length && text[end] !== char) end += char === '"' && text[end] === '\\' ? 2 : 1;
      out.push(text.slice(index, end + 1));
      index = end + 1;
      continue;
    }
    if (char === '(' || char === ')' || char === '|' || char === ',') {
      out.push(char);
      index += 1;
      continue;
    }
    if (text.startsWith(':=', index)) {
      out.push(':=');
      index += 2;
      continue;
    }
    let end = index;
    while (end < text.length && !/[\s()|,"`]/.test(text[end] as string) && !text.startsWith(':=', end)) end += 1;
    // `)` followed by a field, `(.Values).port`, is read as the group's field.
    out.push(text.slice(index, end));
    index = end;
  }
  return out;
};

const unquote = (word: string): string => {
  if (word.startsWith('`')) return word.slice(1, -1);
  try {
    return JSON.parse(word) as string;
  } catch {
    return word.slice(1, -1);
  }
};

const fieldPath = (word: string): string[] => word.split('.').filter((part) => part !== '');

/** A pipeline of words, from `from` up to a closing parenthesis or the end. */
const parsePipe = (words: string[], from = 0): { pipe: Pipe; next: number } => {
  let index = from;
  let declare: Pipe['declare'];
  const names: string[] = [];
  let probe = index;
  while (probe < words.length && /^\$\w*$/.test(words[probe] as string)) {
    names.push(words[probe] as string);
    probe += 1;
    if (words[probe] === ',') probe += 1;
    else break;
  }
  if (names.length > 0 && (words[probe] === ':=' || words[probe] === '=')) {
    declare = { names, assign: words[probe] === '=' };
    index = probe + 1;
  }
  const commands: Command[] = [];
  let terms: Term[] = [];
  while (index < words.length) {
    const word = words[index] as string;
    if (word === ')') break;
    if (word === '|') {
      commands.push({ terms });
      terms = [];
      index += 1;
      continue;
    }
    if (word === '(') {
      const inner = parsePipe(words, index + 1);
      index = inner.next + 1;
      const after = words[index];
      const path = after !== undefined && after.startsWith('.') ? fieldPath(after) : [];
      if (path.length > 0) index += 1;
      terms.push({ kind: 'group', pipe: inner.pipe, path });
      continue;
    }
    terms.push(termOf(word));
    index += 1;
  }
  commands.push({ terms });
  return { pipe: { ...(declare === undefined ? {} : { declare }), commands: commands.filter((command) => command.terms.length > 0) }, next: index };
};

const termOf = (word: string): Term => {
  if (word.startsWith('"') || word.startsWith('`')) return { kind: 'literal', value: unquote(word) };
  if (/^-?\d+(?:\.\d+)?$/.test(word)) return { kind: 'literal', value: Number(word) };
  if (word === 'true' || word === 'false') return { kind: 'literal', value: word === 'true' };
  if (word === 'nil') return { kind: 'literal', value: null };
  if (word === '.') return { kind: 'field', base: 'dot', path: [] };
  if (word.startsWith('.')) return { kind: 'field', base: 'dot', path: fieldPath(word) };
  if (word === '$') return { kind: 'field', base: 'root', path: [] };
  if (word.startsWith('$.')) return { kind: 'field', base: 'root', path: fieldPath(word.slice(1)) };
  if (word.startsWith('$')) {
    const [name, ...path] = word.split('.');
    return { kind: 'field', base: name as string, path: path.filter((part) => part !== '') };
  }
  return { kind: 'call', name: word };
};

const pipeOf = (text: string): Pipe => parsePipe(wordsOf(text)).pipe;

/** The tree of a template, and the templates it defines. */
const parse = (tokens: readonly Token[], defines: Map<string, Node[]>): Node[] => {
  let index = 0;
  const block = (ends: readonly string[]): { nodes: Node[]; end: string } => {
    const nodes: Node[] = [];
    while (index < tokens.length) {
      const token = tokens[index] as Token;
      index += 1;
      if (token.kind === 'text') {
        nodes.push({ kind: 'text', text: token.text, at: token.at });
        continue;
      }
      const text = token.text;
      if (text.startsWith('/*')) continue;
      const keyword = /^(\w+)\b\s*(.*)$/s.exec(text);
      const word = keyword?.[1];
      const rest = keyword?.[2] ?? '';
      if (word !== undefined && ends.includes(word)) return { nodes, end: text };
      if (word === 'if') {
        const branches: Array<{ cond: Pipe; body: Node[]; at: number }> = [];
        let cond = pipeOf(rest);
        let at = token.at;
        let otherwise: Node[] | undefined;
        for (;;) {
          const inner = block(['else', 'end']);
          branches.push({ cond, body: inner.nodes, at });
          if (inner.end === 'end') break;
          const elseIf = /^else\s+if\s+(.*)$/s.exec(inner.end);
          if (elseIf !== null) {
            cond = pipeOf(elseIf[1] as string);
            at = (tokens[index - 1] as Token).at;
            continue;
          }
          otherwise = block(['end']).nodes;
          break;
        }
        nodes.push({ kind: 'if', branches, ...(otherwise === undefined ? {} : { otherwise }), at: token.at });
        continue;
      }
      if (word === 'with' || word === 'range') {
        const inner = block(['else', 'end']);
        const otherwise = inner.end === 'end' ? undefined : block(['end']).nodes;
        const pipe = pipeOf(rest);
        if (word === 'with') nodes.push({ kind: 'with', pipe, body: inner.nodes, ...(otherwise === undefined ? {} : { otherwise }), at: token.at });
        else nodes.push({ kind: 'range', pipe, vars: pipe.declare?.names ?? [], body: inner.nodes, ...(otherwise === undefined ? {} : { otherwise }), at: token.at });
        continue;
      }
      if (word === 'define' || word === 'block') {
        const named = /^("[^"]*"|`[^`]*`)\s*(.*)$/s.exec(rest);
        if (named === null) throw new Unrenderable(`a ${word} is not named`);
        const body = block(['end']).nodes;
        const name = unquote(named[1] as string);
        defines.set(name, body);
        if (word === 'block') nodes.push({ kind: 'template', name, pipe: pipeOf(named[2] as string), at: token.at });
        continue;
      }
      if (word === 'template') {
        const named = /^("[^"]*"|`[^`]*`)\s*(.*)$/s.exec(rest);
        if (named === null) throw new Unrenderable('a template is not named');
        const pipeText = (named[2] as string).trim();
        nodes.push({ kind: 'template', name: unquote(named[1] as string), ...(pipeText === '' ? {} : { pipe: pipeOf(pipeText) }), at: token.at });
        continue;
      }
      if (word === 'end' || word === 'else') throw new Unrenderable(`an ${word} closes nothing`);
      nodes.push({ kind: 'action', pipe: pipeOf(text), at: token.at });
    }
    if (ends.length > 0) throw new Unrenderable('a block is not closed');
    return { nodes, end: '' };
  };
  return block([]).nodes;
};

// ---------------------------------------------------------------- the values

const truthy = (value: Value): boolean => {
  if (value === undefined || value === null || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
};

const fieldOf = (value: Value, path: readonly string[]): Value => {
  let at = value;
  for (const key of path) {
    if (isUnknown(at)) return UNKNOWN;
    if (!isRecord(at)) return undefined;
    at = at[key];
  }
  return at;
};

const printed = (value: Value): string => {
  if (isUnknown(value)) return UNREAD_MARK;
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // A map or a list printed as the language prints one is no manifest's value.
  return UNREAD_MARK;
};

const yamlOf = (value: Value): Value => {
  if (isUnknown(value)) return UNKNOWN;
  if (value === undefined || value === null) return '';
  const text = stringify(value).replace(/\n$/, '');
  return text.includes(UNREAD_MARK) ? UNKNOWN : text;
};

const indented = (text: string, spaces: number): string =>
  text
    .split('\n')
    .map((line) => `${' '.repeat(spaces)}${line}`)
    .join('\n');

const printf = (format: string, args: readonly Value[]): Value => {
  let index = 0;
  let unknown = false;
  const out = format.replace(/%([-+# 0]*\d*(?:\.\d+)?)([svdqtf%])/g, (_whole, _flags, verb: string) => {
    if (verb === '%') return '%';
    const value = args[index];
    index += 1;
    if (isUnknown(value)) unknown = true;
    if (verb === 'q') return JSON.stringify(printed(value));
    return printed(value);
  });
  return unknown ? UNKNOWN : out;
};

/** The functions a pipeline may call, each given its arguments with the piped value last. */
type Fn = (args: Value[], render: Renderer) => Value;

/** Functions whose answer the reader's files cannot give. */
const ASKED_OF_THE_CLUSTER = new Set(['lookup', 'tpl', 'randAlphaNum', 'randAlpha', 'randNumeric', 'uuidv4', 'now', 'date', 'b64enc', 'b64dec', 'sha256sum', 'sha1sum', 'genCA', 'genSelfSignedCert', 'genPrivateKey', 'semverCompare', 'fail']);

const known = (args: readonly Value[]): boolean => !args.some(isUnknown);

const strict = (fn: (args: Value[]) => Value): Fn => (args) => (known(args) ? fn(args) : UNKNOWN);

const text = (value: Value): string => printed(value);

const FUNCTIONS: Readonly<Record<string, Fn>> = {
  default: (args) => {
    const [fallback, given] = args;
    if (args.length < 2) return fallback;
    if (isUnknown(given)) return UNKNOWN;
    return truthy(given) ? given : fallback;
  },
  required: (args) => args[args.length - 1],
  coalesce: (args) => {
    for (const each of args) {
      if (isUnknown(each)) return UNKNOWN;
      if (truthy(each)) return each;
    }
    return undefined;
  },
  ternary: (args) => {
    const [yes, no, cond] = args;
    return isUnknown(cond) ? (yes === no ? yes : UNKNOWN) : truthy(cond) ? yes : no;
  },
  empty: strict(([value]) => !truthy(value)),
  not: strict(([value]) => !truthy(value)),
  and: (args) => {
    let last: Value = true;
    for (const each of args) {
      if (isUnknown(each)) return args.some((other) => !isUnknown(other) && !truthy(other)) ? args.find((other) => !isUnknown(other) && !truthy(other)) : UNKNOWN;
      if (!truthy(each)) return each;
      last = each;
    }
    return last;
  },
  or: (args) => {
    for (const each of args) {
      if (isUnknown(each)) return args.find((other) => !isUnknown(other) && truthy(other)) ?? UNKNOWN;
      if (truthy(each)) return each;
    }
    return args[args.length - 1];
  },
  eq: strict(([first, ...rest]) => rest.some((each) => each === first)),
  ne: strict(([a, b]) => a !== b),
  lt: strict(([a, b]) => Number(a) < Number(b)),
  le: strict(([a, b]) => Number(a) <= Number(b)),
  gt: strict(([a, b]) => Number(a) > Number(b)),
  ge: strict(([a, b]) => Number(a) >= Number(b)),
  quote: strict((args) => args.map((each) => JSON.stringify(text(each))).join(' ')),
  squote: strict((args) => args.map((each) => `'${text(each)}'`).join(' ')),
  upper: strict(([value]) => text(value).toUpperCase()),
  lower: strict(([value]) => text(value).toLowerCase()),
  title: strict(([value]) => text(value).replace(/\b\w/g, (char) => char.toUpperCase())),
  trim: strict(([value]) => text(value).trim()),
  trimSuffix: strict(([suffix, value]) => (text(value).endsWith(text(suffix)) ? text(value).slice(0, text(value).length - text(suffix).length) : text(value))),
  trimPrefix: strict(([prefix, value]) => (text(value).startsWith(text(prefix)) ? text(value).slice(text(prefix).length) : text(value))),
  trunc: strict(([length, value]) => text(value).slice(0, Number(length))),
  replace: strict(([from, to, value]) => text(value).split(text(from)).join(text(to))),
  contains: strict(([part, value]) => text(value).includes(text(part))),
  hasPrefix: strict(([part, value]) => text(value).startsWith(text(part))),
  hasSuffix: strict(([part, value]) => text(value).endsWith(text(part))),
  cat: strict((args) => args.filter((each) => each !== undefined && each !== null).map(text).join(' ')),
  print: strict((args) => args.map(text).join('')),
  printf: (args) => (isUnknown(args[0]) ? UNKNOWN : printf(text(args[0]), args.slice(1))),
  toString: strict(([value]) => text(value)),
  int: strict(([value]) => Math.trunc(Number(value)) || 0),
  int64: strict(([value]) => Math.trunc(Number(value)) || 0),
  atoi: strict(([value]) => Math.trunc(Number(value)) || 0),
  float64: strict(([value]) => Number(value) || 0),
  toYaml: ([value]) => yamlOf(value),
  toJson: strict(([value]) => JSON.stringify(value ?? null)),
  // An unknown value indented is still a line of its own, read as nothing written.
  nindent: ([spaces, value]) => (isUnknown(spaces) ? UNKNOWN : `\n${indented(text(value), Number(spaces))}`),
  indent: ([spaces, value]) => (isUnknown(spaces) ? UNKNOWN : indented(text(value), Number(spaces))),
  list: (args) => [...args],
  dict: (args) => {
    const out: Record<string, unknown> = {};
    for (let index = 0; index + 1 < args.length; index += 2) {
      if (isUnknown(args[index])) return UNKNOWN;
      out[text(args[index])] = args[index + 1];
    }
    return out;
  },
  get: strict(([map, key]) => (isRecord(map) ? map[text(key)] : undefined)),
  hasKey: strict(([map, key]) => isRecord(map) && Object.hasOwn(map, text(key))),
  index: strict(([collection, ...keys]) => {
    let at: Value = collection;
    for (const key of keys) at = Array.isArray(at) ? at[Number(key)] : isRecord(at) ? at[text(key)] : undefined;
    return at;
  }),
  first: strict(([list]) => (Array.isArray(list) ? list[0] : undefined)),
  last: strict(([list]) => (Array.isArray(list) ? list[list.length - 1] : undefined)),
  len: strict(([value]) => (Array.isArray(value) ? value.length : isRecord(value) ? Object.keys(value).length : text(value).length)),
  join: strict(([separator, list]) => (Array.isArray(list) ? list.map(text).join(text(separator)) : text(list))),
  kindIs: strict(([kind, value]) => {
    const actual = Array.isArray(value) ? 'slice' : isRecord(value) ? 'map' : typeof value === 'string' ? 'string' : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float64') : typeof value === 'boolean' ? 'bool' : 'invalid';
    return actual === text(kind) || (text(kind) === 'int64' && actual === 'int');
  }),
  include: (args, render) => {
    const [name, context] = args;
    if (isUnknown(name)) return UNKNOWN;
    return render.include(text(name), context);
  },
};

/** What a rendering is given to evaluate. */
interface Scope {
  readonly dot: Value;
  readonly vars: Map<string, Value>;
}

interface Renderer {
  include(name: string, context: Value): Value;
}

/** An output line, and the line of the template it came from. */
interface Out {
  text: string;
  /** For each line of the output, the template's line it was written on. */
  readonly lines: number[];
}

class Rendering implements Renderer {
  private depth = 0;
  private readonly starts: number[] = [0];

  constructor(
    source: string,
    private readonly defines: ReadonlyMap<string, Node[]>,
    private readonly root: Value,
    private readonly choices: ReadonlyMap<number, boolean>,
  ) {
    for (let index = 0; index < source.length; index += 1) if (source[index] === '\n') this.starts.push(index + 1);
  }

  /** The template's line of an offset. */
  lineOf(at: number): number {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((this.starts[middle] as number) <= at) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  }

  render(nodes: readonly Node[]): Out {
    const out: Out = { text: '', lines: [] };
    this.nodes(nodes, { dot: this.root, vars: new Map([['$', this.root]]) }, out);
    return out;
  }

  include(name: string, context: Value): Value {
    const body = this.defines.get(name);
    if (body === undefined || this.depth > 20) return UNKNOWN;
    this.depth += 1;
    const out: Out = { text: '', lines: [] };
    try {
      this.nodes(body, { dot: context, vars: new Map([['$', this.root]]) }, out);
    } finally {
      this.depth -= 1;
    }
    return out.text.includes(UNREAD_MARK) && out.text.trim() === UNREAD_MARK ? UNKNOWN : out.text;
  }

  private emit(out: Out, written: string, line: number, literal: boolean): void {
    if (out.lines.length === 0) out.lines.push(line);
    let at = line;
    for (const char of written) {
      out.text += char;
      if (char === '\n') {
        if (literal) at += 1;
        out.lines.push(at);
      }
    }
  }

  private decide(value: Value, at: number): boolean {
    if (!isUnknown(value)) return truthy(value);
    const chosen = this.choices.get(at);
    if (chosen === undefined) throw new Undecided(at);
    return chosen;
  }

  private nodes(nodes: readonly Node[], scope: Scope, out: Out): void {
    for (const node of nodes) {
      switch (node.kind) {
        case 'text':
          this.emit(out, node.text, this.lineOf(node.at), true);
          break;
        case 'action': {
          const value = this.pipe(node.pipe, scope);
          if (node.pipe.declare === undefined) this.emit(out, printed(value), this.lineOf(node.at), false);
          break;
        }
        case 'if': {
          let done = false;
          for (const branch of node.branches) {
            if (this.decide(this.pipe(branch.cond, scope), branch.at)) {
              this.nodes(branch.body, { dot: scope.dot, vars: new Map(scope.vars) }, out);
              done = true;
              break;
            }
          }
          if (!done && node.otherwise !== undefined) this.nodes(node.otherwise, { dot: scope.dot, vars: new Map(scope.vars) }, out);
          break;
        }
        case 'with': {
          const value = this.pipe(node.pipe, scope);
          if (this.decide(value, node.at)) this.nodes(node.body, { dot: value, vars: new Map(scope.vars) }, out);
          else if (node.otherwise !== undefined) this.nodes(node.otherwise, { dot: scope.dot, vars: new Map(scope.vars) }, out);
          break;
        }
        case 'range': {
          const value = this.pipe({ commands: node.pipe.commands }, scope);
          // What a list the files do not give holds, no rendering can say.
          if (isUnknown(value)) throw new Unrenderable('it ranges over a value the files do not give');
          const items: Array<[Value, Value]> = Array.isArray(value)
            ? value.map((each, index) => [index, each])
            : isRecord(value)
              ? Object.keys(value)
                  .sort()
                  .map((key) => [key, value[key]])
              : typeof value === 'number'
                ? Array.from({ length: value }, (_, index) => [index, index])
                : [];
          if (items.length === 0 && node.otherwise !== undefined) this.nodes(node.otherwise, scope, out);
          for (const [key, item] of items) {
            const vars = new Map(scope.vars);
            if (node.vars.length === 1) vars.set(node.vars[0] as string, item);
            if (node.vars.length === 2) {
              vars.set(node.vars[0] as string, key);
              vars.set(node.vars[1] as string, item);
            }
            this.nodes(node.body, { dot: item, vars }, out);
          }
          break;
        }
        case 'template': {
          const context = node.pipe === undefined ? undefined : this.pipe(node.pipe, scope);
          this.emit(out, printed(this.include(node.name, context)), this.lineOf(node.at), false);
          break;
        }
      }
    }
  }

  private pipe(pipe: Pipe, scope: Scope): Value {
    let value: Value;
    let piped = false;
    for (const command of pipe.commands) {
      value = this.command(command, scope, piped ? [value] : []);
      piped = true;
    }
    if (pipe.declare !== undefined) for (const name of pipe.declare.names) scope.vars.set(name, value);
    return value;
  }

  private term(term: Term, scope: Scope): Value {
    switch (term.kind) {
      case 'literal':
        return term.value;
      case 'field': {
        const base = term.base === 'dot' ? scope.dot : term.base === 'root' ? this.root : scope.vars.has(term.base) ? scope.vars.get(term.base) : undefined;
        return fieldOf(base, term.path);
      }
      case 'group':
        return fieldOf(this.pipe(term.pipe, { dot: scope.dot, vars: scope.vars }), term.path);
      case 'call':
        return this.call(term.name, []);
    }
  }

  private call(name: string, args: Value[]): Value {
    if (ASKED_OF_THE_CLUSTER.has(name)) return UNKNOWN;
    const fn = FUNCTIONS[name];
    return fn === undefined ? UNKNOWN : fn(args, this);
  }

  private command(command: Command, scope: Scope, piped: Value[]): Value {
    const [head, ...rest] = command.terms;
    if (head === undefined) return undefined;
    if (head.kind !== 'call') return rest.length === 0 && piped.length === 0 ? this.term(head, scope) : UNKNOWN;
    return this.call(head.name, [...rest.map((term) => this.term(term, scope)), ...piped]);
  }
}

// ---------------------------------------------------------------- the readings

/** One way a template renders: its text, and the template's line of each line of it. */
export interface Rendered {
  readonly text: string;
  readonly lines: readonly number[];
}

/** Every way a template renders, or why it renders no way. */
export type Renderings = { readonly kind: 'rendered'; readonly ways: readonly Rendered[]; readonly undecided: readonly number[] } | { readonly kind: 'unread'; readonly why: string };

/** How many ways a template is rendered before it is said to have too many. */
const WAYS = 16;

/** What a template is rendered with: the values, the release and the chart. */
export interface ChartContext {
  readonly values: Record<string, unknown>;
  readonly release: { readonly name?: string; readonly namespace?: string };
  readonly chart: { readonly name?: string; readonly version?: string; readonly appVersion?: string };
}

const rootOf = (context: ChartContext): Record<string, unknown> => ({
  Values: context.values,
  Release: {
    Name: context.release.name ?? UNKNOWN,
    Namespace: context.release.namespace ?? UNKNOWN,
    Service: 'Helm',
    IsInstall: true,
    IsUpgrade: false,
    Revision: 1,
  },
  Chart: { Name: context.chart.name ?? UNKNOWN, Version: context.chart.version ?? UNKNOWN, AppVersion: context.chart.appVersion ?? UNKNOWN },
  Capabilities: UNKNOWN,
  Template: { Name: UNKNOWN, BasePath: UNKNOWN },
  Files: UNKNOWN,
});

/** The templates a chart's helper files define, by name. */
export const definesOf = (helpers: readonly string[]): Map<string, Node[]> => {
  const defines = new Map<string, Node[]>();
  for (const source of helpers) {
    try {
      parse(tokenize(source), defines);
    } catch {
      // A helper file not read defines nothing; what includes it is unknown.
    }
  }
  return defines;
};

/**
 * Every way a template renders with a chart's context: one where every
 * condition is decided by the values, one per way the conditions nothing
 * decides can go otherwise, up to a bound.
 */
export const renderings = (source: string, context: ChartContext, helpers: ReadonlyMap<string, Node[]> = new Map()): Renderings => renderingsOver(source, rootOf(context), helpers);

/** A value of a root the files do not give: a field rendered through it is unknown, a condition on it undecided. */
export const UNKNOWN_VALUE: unknown = UNKNOWN;

/**
 * Every way a template renders over a root of its own (P263): a helmfile's
 * `.Environment`, `.Values` and `.StateValues` rather than a chart's. A field
 * of the root that is `UNKNOWN_VALUE` is one nothing in the files gives.
 */
export const renderingsOver = (source: string, root: Record<string, unknown>, helpers: ReadonlyMap<string, Node[]> = new Map()): Renderings => {
  const defines = new Map(helpers);
  let tree: Node[];
  try {
    tree = parse(tokenize(source), defines);
  } catch (error) {
    return { kind: 'unread', why: error instanceof Error ? error.message : 'it is not read' };
  }
  const ways: Rendered[] = [];
  const undecided = new Set<number>();
  const pending: Array<Map<number, boolean>> = [new Map()];
  let tried = 0;
  while (pending.length > 0) {
    const choices = pending.shift() as Map<number, boolean>;
    tried += 1;
    if (tried > WAYS * 2) return { kind: 'unread', why: `its conditions go more than ${WAYS} ways nothing in the files decides` };
    const rendering = new Rendering(source, defines, root, choices);
    try {
      const out = rendering.render(tree);
      ways.push({ text: out.text, lines: out.lines });
    } catch (error) {
      if (error instanceof Undecided) {
        undecided.add(rendering.lineOf(error.at));
        pending.push(new Map([...choices, [error.at, true]]), new Map([...choices, [error.at, false]]));
        continue;
      }
      return { kind: 'unread', why: error instanceof Error ? error.message : 'it is not read' };
    }
    if (ways.length > WAYS) return { kind: 'unread', why: `its conditions go more than ${WAYS} ways nothing in the files decides` };
  }
  return { kind: 'rendered', ways, undecided: [...undecided].sort((a, b) => a - b) };
};

/** Values written over values, maps merged key by key and anything else replaced, as an install does. */
export const mergedValues = (base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const under = out[key];
    out[key] = isRecord(under) && isRecord(value) ? mergedValues(under, value) : value;
  }
  return out;
};

/** A `--set a.b=c` value, as the install reads it: a number, a boolean, `null`, or a string. */
export const setValue = (values: Record<string, unknown>, assignment: string): Record<string, unknown> => {
  const equals = assignment.indexOf('=');
  if (equals <= 0) return values;
  const path = assignment.slice(0, equals).split('.');
  // A list index or an escaped dot is a spelling this reader leaves alone.
  if (path.some((part) => part === '' || /[[\]\\]/.test(part))) return values;
  const raw = assignment.slice(equals + 1);
  const value: unknown = /^-?\d+$/.test(raw) ? Number(raw) : raw === 'true' || raw === 'false' ? raw === 'true' : raw === 'null' ? null : raw;
  let nested: unknown = value;
  for (const key of [...path].reverse()) nested = { [key]: nested };
  return mergedValues(values, nested as Record<string, unknown>);
};
