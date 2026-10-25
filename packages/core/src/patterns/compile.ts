import { z } from 'zod';
import {
  customBrokerSchema,
  dbTableAccessSchema,
  httpClientSchema,
  starterSchema,
  type CustomBrokerConfig,
  type DbTableAccess,
  type HttpClientConfig,
  type StarterConfig,
} from '../config.js';
import type { DescriptionCondition } from '../adapters/conditions.js';
import { httpVerbOf } from '../adapters/http-clients.js';
import type { NameLocator } from '../adapters/locator.js';
import { isParsed, parsePattern, type PatternNode } from './parse.js';
import type { PatternRule } from './schema.js';

/**
 * A pattern, compiled into the description the readers already read (P121).
 *
 * Pure: a rule in, a description or a refusal out. Each hole of the pattern
 * becomes the locator that reaches the same place in a call - a hole that is
 * an argument is `argument`, one inside an object argument `argument-property`
 * or `argument-path`, one in a call further up the chain `chain-call` or
 * `chain-root-argument`, the receiver itself `receiver` - and each literal a
 * condition the call must meet. The rule's fields then say which hole is
 * which: the channel, the payload, the address. What cannot be said that way
 * is refused with the part named, never compiled in part, because a pattern
 * read in part draws edges its author did not mean.
 */

/** Where a description compiled from a rule goes. */
export type CompiledDescriptor =
  | { readonly slot: 'broker'; readonly broker: CustomBrokerConfig }
  | { readonly slot: 'starter'; readonly starter: StarterConfig }
  | { readonly slot: 'table'; readonly table: DbTableAccess }
  | { readonly slot: 'http'; readonly client: HttpClientConfig };

/** Where each hole of a pattern is, as the locator that reaches it. */
export type HolePlaces = Readonly<Record<string, NameLocator>>;

export interface CompiledRule {
  readonly id: string;
  readonly kind: PatternRule['kind'];
  readonly descriptor: CompiledDescriptor;
  readonly holes: HolePlaces;
  readonly conditions: readonly DescriptionCondition[];
  /** `pattern:<id>`, as every node the description draws records it. */
  readonly describedBy: string;
}

/** A rule that cannot be compiled: the part that cannot be said, and why. */
export interface PatternRefusal {
  readonly part: string;
  readonly reason: string;
}

export type CompileResult = { readonly compiled: CompiledRule } | { readonly refused: PatternRefusal };

/** The value `meta.describedBy` and every description compiled from a rule carry. */
export const describedByOf = (id: string): string => `pattern:${id}`;

/** The rule's id back out of `pattern:<id>`, or undefined for anything else. */
export const ruleIdOf = (describedBy: unknown): string | undefined =>
  typeof describedBy === 'string' && describedBy.startsWith('pattern:') ? describedBy.slice('pattern:'.length) : undefined;

class Refused extends Error {
  constructor(
    readonly part: string,
    readonly reason: string,
  ) {
    super(`${part}: ${reason}`);
  }
}

const refuse = (part: string, reason: string): never => {
  throw new Refused(part, reason);
};

/** Where a place sits, relative to the call: an argument, a construction in one, the chain, the receiver's construction. */
type Base =
  | { readonly kind: 'argument'; readonly index: number }
  | { readonly kind: 'constructed'; readonly className: string; readonly index: number }
  | { readonly kind: 'chain'; readonly method: string; readonly index: number }
  | { readonly kind: 'chain-root'; readonly index: number }
  | { readonly kind: 'receiver-constructed'; readonly className: string; readonly index: number };

/** The locator for a place at a base, `path` keys in. */
const locatorAt = (base: Base, path: readonly string[], part: string): NameLocator => {
  switch (base.kind) {
    case 'argument':
      if (path.length === 0) return { kind: 'argument', index: base.index };
      if (path.length === 1 && path[0] !== '*') return { kind: 'argument-property', index: base.index, key: path[0] as string };
      return { kind: 'argument-path', index: base.index, path: [...path] };
    case 'constructed':
      return { kind: 'constructed-argument-path', class: base.className, path: [...path], index: base.index };
    case 'receiver-constructed':
      return { kind: 'receiver-constructed-path', class: base.className, path: [...path], index: base.index };
    case 'chain':
      if (path.length > 0) return refuse(part, `a hole inside an object handed to ${base.method}() further up the chain; only a whole argument there can be reached`);
      return { kind: 'chain-call', method: base.method, index: base.index };
    case 'chain-root':
      if (path.length > 0) return refuse(part, 'a hole inside an object handed to the call the chain starts from; only a whole argument there can be reached');
      return { kind: 'chain-root-argument', index: base.index };
  }
};

/** What a walk of a pattern found: where each hole is, and what each literal requires. */
interface Places {
  readonly holes: Map<string, NameLocator>;
  readonly conditions: DescriptionCondition[];
}

const describe = (base: Base, path: readonly string[], within: string): string => {
  const where =
    base.kind === 'argument'
      ? `argument ${base.index} of ${within}`
      : base.kind === 'constructed'
        ? `argument ${base.index} of new ${base.className}() in ${within}`
        : base.kind === 'receiver-constructed'
          ? `argument ${base.index} of new ${base.className}() the receiver is`
          : base.kind === 'chain'
            ? `argument ${base.index} of ${base.method}() in the chain`
            : `argument ${base.index} of the call the chain starts from`;
  return path.length === 0 ? where : `${path.join('.')} in ${where}`;
};

const addHole = (places: Places, name: string, locator: NameLocator, part: string): void => {
  if (places.holes.has(name)) refuse(part, `${name} is written twice; a hole names one place`);
  places.holes.set(name, locator);
};

/** Reads one value of a pattern into holes and conditions. */
const walkValue = (node: PatternNode, base: Base, path: readonly string[], within: string, places: Places): void => {
  const part = describe(base, path, within);
  switch (node.kind) {
    case 'any':
      return;
    case 'hole':
      addHole(places, node.name, locatorAt(base, path, part), part);
      return;
    case 'literal':
      if (path.includes('*')) refuse(part, 'a value required of every element of a list cannot be checked; write a hole or _ there');
      places.conditions.push({ at: locatorAt(base, path, part), equals: node.value });
      return;
    case 'object':
      for (const entry of node.entries) walkValue(entry.value, base, [...path, entry.key], within, places);
      return;
    case 'array':
      if (node.elements.length !== 1) refuse(part, 'a list in a pattern holds one element, which stands for each element');
      walkValue(node.elements[0] as PatternNode, base, [...path, '*'], within, places);
      return;
    case 'new': {
      if (base.kind !== 'argument' || path.length > 0) refuse(part, 'a construction is matched only as a whole argument of the call');
      if (node.className === undefined) refuse(part, `${node.text} is constructed from an expression; name the class`);
      const inner: Places = { holes: new Map(), conditions: [] };
      node.args.forEach((arg, index) =>
        walkValue(arg, { kind: 'constructed', className: node.className as string, index }, [], within, inner),
      );
      if (inner.holes.size === 0) {
        refuse(part, `new ${node.className}() holds no hole; a construction is matched only through a hole in what it is given`);
      }
      for (const [name, locator] of inner.holes) addHole(places, name, locator, part);
      places.conditions.push(...inner.conditions);
      return;
    }
    case 'run':
      return refuse(part, `${node.name} is a run of arguments and stands for no one place`);
    case 'function':
      return refuse(
        part,
        node.holes.length > 0
          ? `a hole inside a callback (${node.holes.join(', ')}) is not a place in the call; write $HANDLER for the function`
          : 'a function written in a pattern; write $HANDLER or _ for it',
      );
    case 'spread':
      return refuse(part, `a spread (${node.text}) says nothing about where anything is`);
    case 'name':
      return refuse(part, `${node.text} is a name, not a hole: write $${node.text.toUpperCase()} or _`);
    default:
      return refuse(part, `${(node as { text?: string }).text ?? 'it'} is not something a pattern matches: write a hole, _, a literal, an object, a list or new Class(...)`);
  }
};

/** The arguments of one call, read into holes; a run of arguments makes every later position unknown. */
const walkArguments = (
  args: readonly PatternNode[],
  baseOf: (index: number) => Base,
  within: string,
  places: Places,
): void => {
  let afterRun: string | undefined;
  args.forEach((arg, index) => {
    if (arg.kind === 'run') {
      afterRun = arg.name;
      return;
    }
    if (afterRun !== undefined && arg.kind !== 'any') {
      refuse(describe(baseOf(index), [], within), `it follows ${afterRun}, a run of arguments, so its position is not known`);
    }
    walkValue(arg, baseOf(index), [], within, places);
  });
};

/** Which call a pattern describes, read off its callee. */
type Target =
  | { readonly by: 'function'; readonly name: string }
  | { readonly by: 'method'; readonly method: string; readonly receiver: Receiver };

/** What the described call is made on. */
type Receiver =
  | { readonly kind: 'hole'; readonly name?: string }
  | { readonly kind: 'factory'; readonly name: string }
  | { readonly kind: 'chain' }
  | { readonly kind: 'constructed'; readonly className: string };

/** Reads the chain a call is made on, `$C.queue($Q).where(_)`, into chain-call places. */
const walkChain = (node: PatternNode, places: Places): 'hole' | 'function' => {
  if (node.kind === 'hole' || node.kind === 'any') return 'hole';
  if (node.kind !== 'call') return refuse('the receiver', `${'text' in node ? node.text : node.kind} is not a hole, a call or a construction`);
  const callee = node.callee;
  if (callee.kind === 'name') {
    walkArguments(node.args, (index) => ({ kind: 'chain-root', index }), `${callee.text}()`, places);
    return 'function';
  }
  if (callee.kind !== 'member') return refuse('the receiver', `${node.text} is not a chain of method calls`);
  walkArguments(node.args, (index) => ({ kind: 'chain', method: callee.name, index }), `${callee.name}()`, places);
  return walkChain(callee.object, places);
};

const targetOf = (root: PatternNode & { kind: 'call' }, places: Places): Target => {
  const callee = root.callee;
  if (callee.kind === 'name') return { by: 'function', name: callee.text };
  if (callee.kind === 'hole') return { by: 'function', name: callee.name };
  if (callee.kind !== 'member') return refuse('the call', `${root.text} is not a function or a method called by its name`);
  if (/^\$/.test(callee.name)) return refuse('the method', `${callee.name}: the method is written by its name, not as a hole`);
  const object = callee.object;
  if (object.kind === 'hole') {
    addHole(places, object.name, { kind: 'receiver' }, 'the receiver');
    return { by: 'method', method: callee.name, receiver: { kind: 'hole', name: object.name } };
  }
  if (object.kind === 'any') return { by: 'method', method: callee.name, receiver: { kind: 'hole' } };
  if (object.kind === 'new') {
    if (object.className === undefined) refuse('the receiver', `${object.text} is constructed from an expression; name the class`);
    const className = object.className as string;
    object.args.forEach((arg, index) => walkValue(arg, { kind: 'receiver-constructed', className, index }, [], `new ${className}()`, places));
    return { by: 'method', method: callee.name, receiver: { kind: 'constructed', className } };
  }
  if (object.kind === 'call') {
    // `useApi().send(...)`: a receiver made by a call of a function, handed nothing worth a hole.
    if (object.callee.kind === 'name' && object.args.every((arg) => arg.kind === 'any')) {
      return { by: 'method', method: callee.name, receiver: { kind: 'factory', name: object.callee.text } };
    }
    walkChain(object, places);
    return { by: 'method', method: callee.name, receiver: { kind: 'chain' } };
  }
  if (object.kind === 'name' || object.kind === 'member') {
    return refuse('the receiver', `${'text' in object ? object.text : ''} is written as a name; write a hole ($BUS) and say its type under on.receiverType`);
  }
  return refuse('the receiver', `${'text' in object ? object.text : object.kind} is not something a call is matched on`);
};

/** A field of the rule: a hole, a form of the receiver hole, or a value. */
type FieldValue = { readonly locator: NameLocator; readonly hole: string } | { readonly value: string };

const RECEIVER_FORMS: ReadonlyArray<readonly [RegExp, (match: RegExpMatchArray) => NameLocator]> = [
  [/^type$/, () => ({ kind: 'receiver-type' })],
  [/^constructor\((\d+)\)$/, (match) => ({ kind: 'base-constructor-argument', index: Number(match[1]) })],
  [
    /^decorator\(\s*([A-Za-z_$][\w$]*)\s*(?:,\s*(\d+)\s*)?\)$/,
    (match) => ({ kind: 'provider-decorator', decorator: match[1] as string, index: Number(match[2] ?? 0) }),
  ],
];

const fieldOf = (field: string, written: string | undefined, places: Places): FieldValue | undefined => {
  if (written === undefined) return undefined;
  if (!written.startsWith('$')) return { value: written };
  const [hole, form] = written.split(':', 2) as [string, string | undefined];
  const locator = places.holes.get(hole);
  if (locator === undefined) return refuse(field, `${hole} is not a hole of the pattern`);
  if (form === undefined) return { locator, hole };
  if (locator.kind !== 'receiver') return refuse(field, `${written}: only the receiver's hole has a :${form.split('(')[0]} form`);
  for (const [shape, make] of RECEIVER_FORMS) {
    const match = form.match(shape);
    if (match !== null) return { locator: make(match), hole };
  }
  return refuse(field, `${written}: the receiver's forms are :type, :constructor(N) and :decorator(Name, N)`);
};

const locatorOnly = (field: string, value: FieldValue | undefined): NameLocator | undefined => {
  if (value === undefined) return undefined;
  if ('value' in value) return refuse(field, `${value.value} is a value; ${field} is written as a hole of the pattern`);
  return value.locator;
};

const required = <T>(field: string, value: T | undefined, why: string): T => (value === undefined ? refuse(field, why) : value);

/** What a table call does, from the first word of its method's name. */
const OPS: ReadonlyArray<readonly ['read' | 'write' | 'delete', readonly string[]]> = [
  ['read', ['get', 'find', 'select', 'query', 'list', 'read', 'count', 'fetch', 'load', 'all', 'first', 'search', 'exists']],
  ['write', ['insert', 'create', 'update', 'upsert', 'save', 'put', 'set', 'add', 'write', 'patch', 'replace', 'increment']],
  ['delete', ['delete', 'remove', 'destroy', 'del', 'drop', 'purge']],
];

/** The operation a method's name says, by the word it starts with. */
export const opOfName = (name: string): 'read' | 'write' | 'delete' | undefined => {
  const first = (name.match(/^[a-z]+|^[A-Z][a-z]*/)?.[0] ?? name).toLowerCase();
  return OPS.find(([, words]) => words.includes(first))?.[0];
};

/** The receiver's type the rule names, or a construction's class standing for it. */
const receiverTypeOf = (rule: PatternRule, receiver: Receiver): string | readonly string[] | undefined =>
  rule.on.receiverType ?? (receiver.kind === 'constructed' ? receiver.className : undefined);

/** How a call is matched, as the fields every description shares. */
const matchedAs = (
  rule: PatternRule,
  target: Target,
): { function: string; module?: string } | { method: string; receiverType: string | string[] } => {
  if (target.by === 'function') {
    const name = target.name.startsWith('$') ? rule.on.function : target.name;
    if (name === undefined) return refuse('on.function', `the pattern calls ${target.name}; name the function under on.function`);
    if (rule.on.function !== undefined && rule.on.function !== name) {
      return refuse('on.function', `the pattern calls ${name} and on.function says ${rule.on.function}`);
    }
    return { function: name, ...(rule.on.module === undefined ? {} : { module: rule.on.module }) };
  }
  if (target.receiver.kind === 'factory') {
    return refuse('the receiver', `a receiver made by ${target.receiver.name}() is matched for http-request and table rules; name the type it returns under on.receiverType`);
  }
  const type = receiverTypeOf(rule, target.receiver);
  if (type === undefined) {
    // `$O.run(...)` on what a package exports, for a rule that names the package.
    if (rule.on.module !== undefined && target.receiver.kind === 'hole') return { function: target.method, module: rule.on.module };
    return refuse('on.receiverType', `the pattern calls ${target.method} on a receiver; say which type under on.receiverType`);
  }
  return { method: target.method, receiverType: typeof type === 'string' ? type : [...type] };
};

const withWhere = (conditions: readonly DescriptionCondition[]): { where?: DescriptionCondition[] } =>
  conditions.length === 0 ? {} : { where: [...conditions] };

/** Parses through a description's own schema, so a compiled one is held to what a written one is. */
const through = <S extends z.ZodType>(schema: S, value: unknown, part: string): z.infer<S> => {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  return refuse(part, `the description it compiles to is refused: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim());
};

type Compiler = (rule: PatternRule, target: Target, places: Places, decorator: boolean) => CompiledDescriptor;

const COMPILERS: Readonly<Record<PatternRule['kind'], Compiler>> = {
  publish: (rule, target, places) => {
    const channel = required('channel', fieldOf('channel', rule.channel, places), 'a publish names its channel: channel: $CHANNEL');
    const payload = locatorOnly('payload', fieldOf('payload', rule.payload, places));
    const producer = {
      ...matchedAs(rule, target),
      ...('value' in channel ? { address: [{ literal: channel.value }] } : { channel: [channel.locator] }),
      ...(payload === undefined ? {} : { payload: [payload] }),
      ...(rule.messageKind === undefined ? {} : { kind: rule.messageKind }),
      ...withWhere(places.conditions),
      describedBy: describedByOf(rule.id),
    };
    const broker = through(
      customBrokerSchema,
      { name: describedByOf(rule.id), ...(rule.channelKind === undefined ? {} : { channelKind: rule.channelKind }), producers: [producer] },
      'pattern',
    );
    return { slot: 'broker', broker };
  },
  subscribe: (rule, target, places) => {
    const matched = matchedAs(rule, target);
    if ('function' in matched) return refuse('the call', 'a subscription is a method called on a receiver; say its type under on.receiverType');
    const channel = locatorOnly('channel', required('channel', fieldOf('channel', rule.channel, places), 'a subscription names its channel: channel: $CHANNEL'));
    const handler = locatorOnly('handler', fieldOf('handler', rule.handler, places));
    if (handler !== undefined && handler.kind !== 'argument') return refuse('handler', 'the handler is a whole argument of the call');
    const subscriber = {
      receiverType: matched.receiverType,
      method: matched.method,
      channel: [channel],
      ...(handler === undefined || handler.kind !== 'argument' ? {} : { handlerArg: handler.index }),
      ...(rule.messageKind === undefined ? {} : { kind: rule.messageKind }),
      ...withWhere(places.conditions),
      describedBy: describedByOf(rule.id),
    };
    const broker = through(
      customBrokerSchema,
      { name: describedByOf(rule.id), ...(rule.channelKind === undefined ? {} : { channelKind: rule.channelKind }), subscribers: [subscriber] },
      'pattern',
    );
    return { slot: 'broker', broker };
  },
  'consume-decorator': (rule, target, places, decorator) => {
    if (!decorator || target.by !== 'function' || target.name.startsWith('$')) {
      return refuse('pattern', 'a handler\'s decorator is written as one: @OnEvent({ name: $CHANNEL })');
    }
    const channel = locatorOnly('channel', required('channel', fieldOf('channel', rule.channel, places), 'a handler names its channel: channel: $CHANNEL'));
    const consumer = {
      decorator: target.name,
      channel: [channel],
      ...(rule.messageKind === undefined ? {} : { kind: rule.messageKind }),
      ...withWhere(places.conditions),
      describedBy: describedByOf(rule.id),
    };
    const broker = through(
      customBrokerSchema,
      { name: describedByOf(rule.id), ...(rule.channelKind === undefined ? {} : { channelKind: rule.channelKind }), consumers: [consumer] },
      'pattern',
    );
    return { slot: 'broker', broker };
  },
  start: (rule, target, places) => {
    const name = locatorOnly('name', required('name', fieldOf('name', rule.name, places), 'a start names what it starts: name: $NAME'));
    const target_ = required('target', rule.target, 'a start says what it starts: target: workflow or target: invoke');
    const starter = through(
      starterSchema,
      {
        ...matchedAs(rule, target),
        target: target_,
        name: [name],
        ...(rule.names === undefined ? {} : { names: rule.names }),
        ...(rule.messageKind === undefined ? {} : { kind: rule.messageKind }),
        ...withWhere(places.conditions),
        describedBy: describedByOf(rule.id),
      },
      'pattern',
    );
    return { slot: 'starter', starter };
  },
  table: (rule, target, places) => {
    const written = required('table', fieldOf('table', rule.table, places), 'a table access names its table: table: $TABLE, or the table itself');
    const table =
      'value' in written
        ? written.value
        : written.locator.kind === 'argument'
          ? written.locator.index
          : refuse('table', 'the table is a whole argument of the call, or written as the table itself');
    const name = target.by === 'function' ? (target.name.startsWith('$') ? rule.on.function : target.name) : target.method;
    if (name === undefined) return refuse('on.function', `the pattern calls ${target.by === 'function' ? target.name : ''}; name the function under on.function`);
    const op = rule.op ?? opOfName(name);
    if (op === undefined) return refuse('op', `${name} does not say what it does to the table: write op: read, write or delete`);
    const factory =
      target.by === 'function' ? undefined : (rule.on.factory ?? (target.receiver.kind === 'factory' ? target.receiver.name : undefined));
    if (target.by === 'method' && factory === undefined) {
      return refuse('on.factory', `a table call on a receiver is matched through the function that made the client: write on.factory`);
    }
    const clientType = typeof rule.on.receiverType === 'string' ? rule.on.receiverType : undefined;
    const access = through(
      dbTableAccessSchema,
      {
        name,
        ...(rule.on.module === undefined ? {} : { package: rule.on.module }),
        ...(factory === undefined ? {} : { factory }),
        ...(clientType === undefined || factory === undefined ? {} : { clientType }),
        table,
        op,
        ...withWhere(places.conditions),
        describedBy: describedByOf(rule.id),
      },
      'pattern',
    );
    return { slot: 'table', table: access };
  },
  'http-request': (rule, target, places) => {
    const url = locatorOnly('url', required('url', fieldOf('url', rule.url, places), 'a request names its address: url: $URL'));
    const body = locatorOnly('body', fieldOf('body', rule.body, places));
    const verbField = fieldOf('verb', rule.verb, places);
    const named = target.by === 'function' ? target.name : target.method;
    if (verbField !== undefined && 'value' in verbField && httpVerbOf(verbField.value) === undefined) {
      return refuse('verb', `${verbField.value} is not an HTTP verb`);
    }
    if (verbField === undefined && httpVerbOf(named) === undefined) {
      return refuse('verb', `${named} is not named for a verb: write verb: $VERB for where the call writes it, or verb: POST`);
    }
    const matched: Record<string, unknown> =
      target.by === 'function'
        ? { function: target.name.startsWith('$') ? (rule.on.function ?? refuse('on.function', `name the function under on.function`)) : target.name }
        : target.receiver.kind === 'factory' || rule.on.factory !== undefined
          ? { factory: rule.on.factory ?? (target.receiver.kind === 'factory' ? target.receiver.name : ''), method: target.method }
          : (() => {
              const type = receiverTypeOf(rule, target.receiver);
              if (type === undefined) return refuse('on.receiverType', `the pattern calls ${target.method} on a receiver; say which type under on.receiverType`);
              return { receiverType: type, method: target.method };
            })();
    const client = through(
      httpClientSchema,
      {
        ...matched,
        ...(rule.on.module === undefined ? {} : { module: rule.on.module }),
        ...(verbField === undefined ? {} : 'value' in verbField ? { verb: httpVerbOf(verbField.value) } : { verbAt: [verbField.locator] }),
        url: [url],
        ...(body === undefined ? {} : { body: [body] }),
        ...withWhere(places.conditions),
        describedBy: describedByOf(rule.id),
      },
      'pattern',
    );
    return { slot: 'http', client };
  },
};

/**
 * Compiles one rule. Pure, and never partial: either every part of the
 * pattern and every field the rule names has a place in the description, or
 * the rule is refused with the first part that has none.
 */
export const compilePattern = (rule: PatternRule): CompileResult => {
  const parsed = parsePattern(rule.pattern);
  if (!isParsed(parsed)) return { refused: { part: 'pattern', reason: parsed.error } };
  try {
    const { root, decorator } = parsed;
    if (root.kind !== 'call') return { refused: { part: 'pattern', reason: 'a pattern is a call: name(...), $RECEIVER.method(...) or @Decorator(...)' } };
    if (decorator !== (rule.kind === 'consume-decorator')) {
      return {
        refused: {
          part: 'pattern',
          reason: decorator ? `a decorator is a consume-decorator rule, not ${rule.kind}` : 'a consume-decorator rule is written as the decorator: @Name(...)',
        },
      };
    }
    const places: Places = { holes: new Map(), conditions: [] };
    const target = targetOf(root, places);
    const within = target.by === 'function' ? `${target.name}()` : `${target.method}()`;
    walkArguments(root.args, (index) => ({ kind: 'argument', index }), within, places);
    const descriptor = COMPILERS[rule.kind](rule, target, places, decorator);
    return {
      compiled: {
        id: rule.id,
        kind: rule.kind,
        descriptor,
        holes: Object.fromEntries(places.holes),
        conditions: places.conditions,
        describedBy: describedByOf(rule.id),
      },
    };
  } catch (error) {
    if (error instanceof Refused) return { refused: { part: error.part, reason: error.reason } };
    throw error;
  }
};

/** Whether a compile gave a rule. */
export const isCompiled = (result: CompileResult): result is { readonly compiled: CompiledRule } => 'compiled' in result;
