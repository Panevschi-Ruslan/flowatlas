import { posix } from 'node:path';
import type { Expression } from '../hcl/ast.js';
import { HclSyntaxError, parseHclTemplate } from '../hcl/parse.js';
import type { Scope } from './evaluate.js';
import {
  asText,
  bool,
  describe,
  equal,
  failure,
  firstUnknown,
  fromJson,
  isError,
  list,
  NULL,
  num,
  object,
  str,
  toJson,
  unknown,
  type Value,
} from './values.js';

type Evaluate = (expression: Expression, scope: Scope) => Value;

/**
 * The functions that address things, and the few that shape what is addressed.
 *
 * What is here is what names a function, a route or a file in the Terraform
 * people actually write: string assembly, lookups in maps, reading a file or a
 * template beside the configuration, and the JSON a definition is usually
 * written in. Every other function evaluates to unknown, saying which function
 * it was, and nothing downstream is ever handed a guess about what it would
 * have returned. Hashes and timestamps are in that second group on purpose:
 * their value is not the address of anything.
 */
type Strict = (args: readonly Value[], scope: Scope) => Value;

const sortedKeys = (value: Extract<Value, { kind: 'object' }>): string[] => [...value.entries.keys()].sort();

const textArg = (value: Value | undefined): string | undefined => (value === undefined ? undefined : asText(value));

const listOf = (value: Value | undefined): readonly Value[] | undefined => (value?.kind === 'list' ? value.items : undefined);

/** `format`'s verbs, the ones a name is assembled with. */
const format = (pattern: string, args: readonly Value[]): Value => {
  let out = '';
  let next = 0;
  for (let at = 0; at < pattern.length; at += 1) {
    const c = pattern[at];
    if (c !== '%') {
      out += c;
      continue;
    }
    const verb = pattern[at + 1];
    at += 1;
    if (verb === '%') {
      out += '%';
      continue;
    }
    const arg = args[next];
    next += 1;
    if (arg === undefined) return failure('format has more verbs than arguments');
    if (verb === 's' || verb === 'v') {
      const text = asText(arg);
      if (text === undefined) return failure(`format %${verb} cannot write ${describe(arg)}`);
      out += text;
    } else if (verb === 'd') {
      if (arg.kind !== 'number') return failure('format %d needs a number');
      out += String(Math.trunc(arg.value));
    } else if (verb === 'q') {
      const text = asText(arg);
      if (text === undefined) return failure('format %q needs a string');
      out += JSON.stringify(text);
    } else if (verb === 't') {
      if (arg.kind !== 'bool') return failure('format %t needs true or false');
      out += String(arg.value);
    } else {
      return unknown('function', `format's %${verb ?? ''} verb is not evaluated here`);
    }
  }
  return str(out);
};

const flatten = (items: readonly Value[]): Value[] =>
  items.flatMap((item) => (item.kind === 'list' ? flatten(item.items) : [item]));

const distinct = (items: readonly Value[]): Value[] => {
  const out: Value[] = [];
  for (const item of items) if (!out.some((seen) => equal(seen, item) === true)) out.push(item);
  return out;
};

const STRICT: ReadonlyMap<string, Strict> = new Map<string, Strict>([
  ['format', ([pattern, ...rest]) => {
    const text = textArg(pattern);
    return text === undefined ? failure('format needs a pattern') : format(text, rest);
  }],
  ['join', ([separator, ...lists]) => {
    const sep = textArg(separator);
    if (sep === undefined) return failure('join needs a separator');
    const parts: string[] = [];
    for (const each of lists) {
      const items = listOf(each);
      if (items === undefined) return failure('join needs lists');
      for (const item of items) {
        const text = asText(item);
        if (text === undefined) return failure(`join cannot write ${describe(item)}`);
        parts.push(text);
      }
    }
    return str(parts.join(sep));
  }],
  ['split', ([separator, text]) => {
    const sep = textArg(separator);
    const value = textArg(text);
    if (sep === undefined || value === undefined) return failure('split needs two strings');
    return list((value === '' ? [] : value.split(sep)).map((part) => str(part)));
  }],
  ['replace', ([text, search, replacement]) => {
    const value = textArg(text);
    const find = textArg(search);
    const by = textArg(replacement);
    if (value === undefined || find === undefined || by === undefined) return failure('replace needs three strings');
    if (find.length > 1 && find.startsWith('/') && find.endsWith('/')) {
      try {
        return str(value.replace(new RegExp(find.slice(1, -1), 'g'), by.replace(/\$\{(\w+)\}/g, '$<$1>')));
      } catch {
        return unknown('function', 'replace with that regular expression is not evaluated here');
      }
    }
    return str(value.split(find).join(by));
  }],
  ['lower', ([text]) => (textArg(text) === undefined ? failure('lower needs a string') : str((textArg(text) as string).toLowerCase()))],
  ['upper', ([text]) => (textArg(text) === undefined ? failure('upper needs a string') : str((textArg(text) as string).toUpperCase()))],
  ['title', ([text]) => {
    const value = textArg(text);
    return value === undefined ? failure('title needs a string') : str(value.replace(/\b\p{L}/gu, (c) => c.toUpperCase()));
  }],
  ['trimprefix', ([text, prefix]) => {
    const value = textArg(text);
    const cut = textArg(prefix);
    if (value === undefined || cut === undefined) return failure('trimprefix needs two strings');
    return str(cut !== '' && value.startsWith(cut) ? value.slice(cut.length) : value);
  }],
  ['trimsuffix', ([text, suffix]) => {
    const value = textArg(text);
    const cut = textArg(suffix);
    if (value === undefined || cut === undefined) return failure('trimsuffix needs two strings');
    return str(cut !== '' && value.endsWith(cut) ? value.slice(0, -cut.length) : value);
  }],
  ['trimspace', ([text]) => (textArg(text) === undefined ? failure('trimspace needs a string') : str((textArg(text) as string).trim()))],
  ['trim', ([text, chars]) => {
    const value = textArg(text);
    const set = textArg(chars);
    if (value === undefined || set === undefined) return failure('trim needs two strings');
    let start = 0;
    let end = value.length;
    while (start < end && set.includes(value[start] as string)) start += 1;
    while (end > start && set.includes(value[end - 1] as string)) end -= 1;
    return str(value.slice(start, end));
  }],
  ['chomp', ([text]) => (textArg(text) === undefined ? failure('chomp needs a string') : str((textArg(text) as string).replace(/[\r\n]+$/, '')))],
  ['substr', ([text, offset, length]) => {
    const value = textArg(text);
    if (value === undefined || offset?.kind !== 'number' || length?.kind !== 'number') return failure('substr needs a string and two numbers');
    const from = offset.value < 0 ? value.length + offset.value : offset.value;
    return str(length.value < 0 ? value.slice(from) : value.slice(from, from + length.value));
  }],
  ['startswith', ([text, prefix]) => {
    const value = textArg(text);
    const p = textArg(prefix);
    return value === undefined || p === undefined ? failure('startswith needs two strings') : bool(value.startsWith(p));
  }],
  ['endswith', ([text, suffix]) => {
    const value = textArg(text);
    const s = textArg(suffix);
    return value === undefined || s === undefined ? failure('endswith needs two strings') : bool(value.endsWith(s));
  }],
  ['strcontains', ([text, part]) => {
    const value = textArg(text);
    const p = textArg(part);
    return value === undefined || p === undefined ? failure('strcontains needs two strings') : bool(value.includes(p));
  }],
  ['concat', (lists) => {
    const items: Value[] = [];
    for (const each of lists) {
      const inner = listOf(each);
      if (inner === undefined) return failure('concat needs lists');
      items.push(...inner);
    }
    return list(items);
  }],
  ['merge', (maps) => {
    const entries = new Map<string, Value>();
    for (const each of maps) {
      if (each.kind === 'null') continue;
      if (each.kind !== 'object') return failure('merge needs objects');
      for (const [key, value] of each.entries) entries.set(key, value);
    }
    return object(entries);
  }],
  ['lookup', ([map, key, fallback]) => {
    if (map?.kind === 'unknown') return map;
    if (key?.kind === 'unknown') return key;
    const name = textArg(key);
    if (map?.kind !== 'object' || name === undefined) return failure('lookup needs an object and a key');
    return map.entries.get(name) ?? fallback ?? failure(`no key ${JSON.stringify(name)}`);
  }],
  ['element', ([items, index]) => {
    const inner = listOf(items);
    if (inner === undefined || index?.kind !== 'number' || inner.length === 0) return failure('element needs a list and a number');
    return inner[((Math.trunc(index.value) % inner.length) + inner.length) % inner.length] as Value;
  }],
  ['length', ([value]) => {
    if (value?.kind === 'list') return num(value.items.length);
    if (value?.kind === 'object') return num(value.entries.size);
    const text = textArg(value);
    return text === undefined ? failure('length needs a list, an object or a string') : num([...text].length);
  }],
  ['keys', ([value]) => (value?.kind === 'object' ? list(sortedKeys(value).map((key) => str(key))) : failure('keys needs an object'))],
  ['values', ([value]) =>
    value?.kind === 'object' ? list(sortedKeys(value).map((key) => value.entries.get(key) as Value)) : failure('values needs an object')],
  ['contains', ([items, wanted]) => {
    const inner = listOf(items);
    if (inner === undefined || wanted === undefined) return failure('contains needs a list');
    for (const item of inner) {
      const same = equal(item, wanted);
      if (same === true) return bool(true);
      if (same === undefined) return unknown('computed', 'an element is known only once it has been created');
    }
    return bool(false);
  }],
  ['flatten', ([items]) => {
    const inner = listOf(items);
    return inner === undefined ? failure('flatten needs a list') : list(flatten(inner));
  }],
  ['distinct', ([items]) => {
    const inner = listOf(items);
    return inner === undefined ? failure('distinct needs a list') : list(distinct(inner));
  }],
  ['compact', ([items]) => {
    const inner = listOf(items);
    return inner === undefined ? failure('compact needs a list') : list(inner.filter((item) => item.kind !== 'null' && !(item.kind === 'string' && item.value === '')));
  }],
  ['coalesce', (args) => {
    for (const arg of args) {
      if (arg.kind === 'unknown') return arg;
      if (arg.kind === 'null' || (arg.kind === 'string' && arg.value === '')) continue;
      return arg;
    }
    return failure('coalesce found no value that is not null or empty');
  }],
  ['coalescelist', (args) => {
    for (const arg of args) {
      if (arg.kind === 'unknown') return arg;
      if (arg.kind === 'list' && arg.items.length > 0) return arg;
    }
    return failure('coalescelist found no list that is not empty');
  }],
  ['zipmap', ([keys, values]) => {
    const k = listOf(keys);
    const v = listOf(values);
    if (k === undefined || v === undefined || k.length !== v.length) return failure('zipmap needs two lists of one length');
    const entries = new Map<string, Value>();
    for (let index = 0; index < k.length; index += 1) {
      const name = asText(k[index] as Value);
      if (name === undefined) return failure('zipmap keys must be strings');
      entries.set(name, v[index] as Value);
    }
    return object(entries);
  }],
  ['tolist', ([value]) => (value?.kind === 'list' ? value : value?.kind === 'null' ? NULL : failure('tolist needs a list'))],
  ['toset', ([value]) => {
    if (value?.kind === 'null') return NULL;
    const inner = listOf(value);
    if (inner === undefined) return failure('toset needs a list');
    const unique = distinct(inner);
    const texts = unique.map(asText);
    if (texts.every((text) => text !== undefined) && unique.every((item) => item.kind === 'string')) {
      return list([...(texts as string[])].sort().map((text) => str(text)));
    }
    return list(unique);
  }],
  ['tomap', ([value]) => (value?.kind === 'object' || value?.kind === 'null' ? value : failure('tomap needs an object'))],
  ['tostring', ([value]) => {
    if (value?.kind === 'null') return NULL;
    const text = textArg(value);
    return text === undefined ? failure('tostring needs a primitive') : str(text);
  }],
  ['tonumber', ([value]) => {
    if (value?.kind === 'null') return NULL;
    if (value?.kind === 'number') return value;
    const text = textArg(value);
    return text === undefined || Number.isNaN(Number(text)) ? failure('tonumber needs a number') : num(Number(text));
  }],
  ['tobool', ([value]) => {
    if (value?.kind === 'null' || value?.kind === 'bool') return value;
    const text = textArg(value);
    return text === 'true' ? bool(true) : text === 'false' ? bool(false) : failure('tobool needs true or false');
  }],
  ['one', ([items]) => {
    const inner = listOf(items);
    if (inner === undefined) return failure('one needs a list');
    if (inner.length === 0) return NULL;
    return inner.length === 1 ? (inner[0] as Value) : failure('one needs a list of at most one element');
  }],
  ['reverse', ([items]) => {
    const inner = listOf(items);
    return inner === undefined ? failure('reverse needs a list') : list([...inner].reverse());
  }],
  ['slice', ([items, start, end]) => {
    const inner = listOf(items);
    if (inner === undefined || start?.kind !== 'number' || end?.kind !== 'number') return failure('slice needs a list and two numbers');
    return list(inner.slice(start.value, end.value));
  }],
  ['range', (args) => {
    const numbers = args.map((arg) => (arg.kind === 'number' ? arg.value : undefined));
    if (numbers.some((n) => n === undefined)) return failure('range needs numbers');
    const [a, b, c] = numbers as number[];
    const [start, end, step] = b === undefined ? [0, a ?? 0, 1] : [a ?? 0, b, c ?? 1];
    if (step === 0) return failure('range cannot step by zero');
    const out: Value[] = [];
    for (let at = start; step > 0 ? at < end : at > end; at += step) {
      out.push(num(at));
      if (out.length > 1024) return unknown('function', 'range is too long to be the address of anything');
    }
    return list(out);
  }],
  ['jsonencode', ([value]) => {
    if (value === undefined) return failure('jsonencode needs a value');
    const json = toJson(value);
    return json === undefined
      ? unknown('computed', 'the document holds values known only once the deployment has been created', {}, value)
      : str(JSON.stringify(json));
  }],
  ['jsondecode', ([text]) => {
    const value = textArg(text);
    if (value === undefined) return failure('jsondecode needs a string');
    try {
      return fromJson(JSON.parse(value));
    } catch {
      return failure('jsondecode was handed text that is not JSON');
    }
  }],
  ['base64encode', ([text]) => {
    const value = textArg(text);
    return value === undefined ? failure('base64encode needs a string') : str(Buffer.from(value, 'utf8').toString('base64'));
  }],
  ['base64decode', ([text]) => {
    const value = textArg(text);
    return value === undefined ? failure('base64decode needs a string') : str(Buffer.from(value, 'base64').toString('utf8'));
  }],
  ['urlencode', ([text]) => {
    const value = textArg(text);
    return value === undefined ? failure('urlencode needs a string') : str(encodeURIComponent(value));
  }],
  // Paths stay relative to the root module, which is what every other path here
  // is relative to; turning one absolute would only make it a path on this
  // machine, and nothing reads it any differently.
  ['abspath', ([path]) => (textArg(path) === undefined ? failure('abspath needs a path') : str(posix.normalize(textArg(path) as string)))],
  ['basename', ([path]) => (textArg(path) === undefined ? failure('basename needs a path') : str(posix.basename(textArg(path) as string)))],
  ['dirname', ([path]) => (textArg(path) === undefined ? failure('dirname needs a path') : str(posix.dirname(textArg(path) as string)))],
  ['file', ([path], scope) => {
    const name = textArg(path);
    if (name === undefined) return failure('file needs a path');
    const text = scope.module.readFile(name);
    return text === undefined ? failure(`no file at ${name}`) : str(text);
  }],
  ['fileexists', ([path], scope) => {
    const name = textArg(path);
    return name === undefined ? failure('fileexists needs a path') : bool(scope.module.readFile(name) !== undefined);
  }],
]);

/**
 * `templatefile`, which reads a file and evaluates it with only the variables
 * it is handed. A variable that is not known stays unknown in the result, and
 * says which.
 */
const templatefile = (args: readonly Value[], scope: Scope, evaluate: Evaluate): Value => {
  const [path, vars] = args;
  const name = textArg(path);
  if (name === undefined) return failure('templatefile needs a path');
  const text = scope.module.readFile(name);
  if (text === undefined) return failure(`no template at ${name}`);
  if (vars !== undefined && vars.kind !== 'object' && vars.kind !== 'null') return failure('templatefile needs an object of variables');
  let template: Expression;
  try {
    template = parseHclTemplate(text, name);
  } catch (error) {
    if (error instanceof HclSyntaxError) return failure(`the template ${name} does not parse: ${error.reason}`);
    throw error;
  }
  const names = vars?.kind === 'object' ? vars.entries : new Map<string, Value>();
  return evaluate(template, { module: scope.module, names, isolated: true });
};

/** Functions that decide for themselves which of their arguments to evaluate. */
const LAZY: ReadonlyMap<string, (args: readonly Expression[], scope: Scope, evaluate: Evaluate) => Value> = new Map([
  [
    'try',
    (args, scope, evaluate) => {
      let last: Value = failure('try was handed nothing');
      for (const arg of args) {
        last = evaluate(arg, scope);
        if (!isError(last)) return last;
      }
      return last;
    },
  ],
  // Marking a value secret, or no longer secret, changes nothing about what it
  // addresses, and a reference handed through either is still the reference.
  ['sensitive', (args, scope, evaluate) => (args[0] === undefined ? failure('sensitive needs a value') : evaluate(args[0], scope))],
  ['nonsensitive', (args, scope, evaluate) => (args[0] === undefined ? failure('nonsensitive needs a value') : evaluate(args[0], scope))],
  [
    'can',
    (args, scope, evaluate) => {
      const [only] = args;
      if (only === undefined) return failure('can needs an expression');
      const value = evaluate(only, scope);
      if (isError(value)) return bool(false);
      return value.kind === 'unknown' ? value : bool(true);
    },
  ],
]);

/** Evaluates one call. Unknown arguments make the result unknown, never a guess. */
export const callFunction = (
  call: Extract<Expression, { type: 'call' }>,
  scope: Scope,
  evaluate: Evaluate,
): Value => {
  const lazy = LAZY.get(call.name);
  if (lazy !== undefined) return lazy(call.args, scope, evaluate);

  let args = call.args.map((arg) => evaluate(arg, scope));
  if (call.expandFinal) {
    const last = args[args.length - 1];
    if (last?.kind === 'unknown') return last;
    if (last?.kind !== 'list') return failure('only a list can be expanded with ...', call.pos);
    args = [...args.slice(0, -1), ...last.items];
  }

  if (call.name === 'templatefile') {
    const blocked = firstUnknown(args.slice(0, 1));
    return blocked ?? templatefile(args, scope, evaluate);
  }
  const strict = STRICT.get(call.name);
  if (strict === undefined) {
    return unknown('function', `${call.name}() is not evaluated here`, { at: call.pos });
  }
  // jsonencode is the one function whose argument may hold what is not known
  // yet and still be worth carrying: the document around a reference is the
  // part a later reading wants.
  // `coalesce` and `lookup` look at their arguments one at a time, so an unknown
  // one they never reach does not decide their answer.
  if (call.name !== 'jsonencode' && call.name !== 'coalesce' && call.name !== 'lookup') {
    const blocked = args.find((arg) => arg.kind === 'unknown' || arg.kind === 'ref');
    if (blocked !== undefined) {
      if (blocked.kind === 'ref') return unknown('computed', `${describe(blocked)} is known only once it has been created`);
      return blocked;
    }
  }
  return strict(args, scope);
};
