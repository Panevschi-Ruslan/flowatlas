import { importedName } from '@flowatlas/core';
import type { Node as TsNode, ClassDeclaration, ClassExpression } from 'ts-morph';

/**
 * What the interpreter of a CDK app holds in its hands (P57).
 *
 * Plain values are JavaScript's own - strings, numbers, booleans, `null`,
 * `undefined`, arrays - so a template literal or a `+` is the language's own
 * arithmetic. Everything else is one of the classes below: an object literal,
 * a construct the app creates, an attribute of one (`queue.queueUrl`), a name
 * the CDK exports (`lambda.Function`, `Duration.minutes`), a value one of the
 * CDK's helpers built (`Code.fromAsset(...)`, `new SqsEventSource(queue)`), a
 * function or a class of the app, and - for anything the files do not settle
 * - an {@link Unread} that says why. Nothing is ever a guess: a value that is
 * not one of these is unread.
 */

export type Value =
  | string
  | number
  | boolean
  | null
  | undefined
  | Value[]
  | ObjectValue
  | Construct
  | Attribute
  | CdkRef
  | Built
  | FunctionValue
  | ClassValue
  | NodeHandle
  | Chosen
  | Unread;

/**
 * A value of the app's context that `cdk deploy -c <key>=...` may set (P298):
 * `cdk.json`'s, or the fallback the app writes beside it, where the
 * deployment's configured options do not fix it. It lives only while it is
 * held - in a name, a parameter, a function's answer, or a record (which keeps
 * the plain value and remembers the key, `ObjectValue.chosen`) - and is the
 * plain value wherever it is used.
 */
export class Chosen {
  constructor(
    readonly key: string,
    readonly value: string | number | undefined,
  ) {}
}

/** A value as it is used: a context value its plain value. */
export const settle = (value: Value): Value => (value instanceof Chosen ? value.value : value);

/**
 * A context value no file sets, as what it is where it is handed on (P332):
 * not nothing, but a value the deployment gives when the app is synthesized
 * (`cdk synth -c <key>=...`) or leaves out - which only the run says.
 */
export const unsetContext = (key: string): Unread =>
  new Unread(`the context value ${key}, which no file sets: the deployment gives it when the app is synthesized (-c ${key}=...) or leaves it out`, 'context');

/**
 * A value as it is handed to what is not the app's own - a method or a
 * construct of the library, a function of Node's (P332): a context value its
 * plain value, and one no file sets a value not read rather than nothing,
 * so what it is handed to reads as chosen when the app is run.
 */
export const handedOn = (value: Value): Value => (value instanceof Chosen && value.value === undefined ? unsetContext(value.key) : value instanceof ObjectValue ? handedRecord(value) : settle(value));

/**
 * The keys of a record whose context value P298 keeps as chosen when no file
 * sets it - the stage an API is deployed to and the region of a stack's
 * `env` - read where the record is used as the default with the key
 * remembered, so they are left as they are (P336).
 */
const CHOSEN_KEYS: ReadonlySet<string> = new Set(['stageName', 'region']);

/** How many records within records are followed for an unset context value. */
const MOST_NESTED_RECORDS = 8;

/**
 * A record as it is handed to what is not the app's own (P336): each entry
 * a context value no file sets gave, at any depth, a value not read with the
 * reason `context` - `new sqs.Queue(this, 'Q', { queueName: ctx })` names a
 * queue the run chooses, not one generated - but a stage and a region,
 * which keep P298's memory. The record itself where it holds none.
 */
const handedRecord = (record: ObjectValue, depth = 0): ObjectValue => {
  if (depth > MOST_NESTED_RECORDS) return record;
  let copy: ObjectValue | undefined;
  for (const [name, value] of record.entries) {
    const key = record.chosen.get(name);
    const handed = key !== undefined && value === undefined && !CHOSEN_KEYS.has(name) ? unsetContext(key) : value instanceof ObjectValue ? handedRecord(value, depth + 1) : value;
    if (handed === value) continue;
    copy ??= copyOf(record);
    copy.entries.set(name, handed);
    copy.chosen.delete(name);
  }
  return copy ?? record;
};

/** A record with the same entries and the same context keys remembered. */
const copyOf = (record: ObjectValue): ObjectValue => {
  const copy = new ObjectValue(record.entries);
  for (const [name, key] of record.chosen) copy.chosen.set(name, key);
  return copy;
};

/** A value the files do not settle, and why, in one sentence. */
export class Unread {
  constructor(
    readonly text: string,
    readonly reason: string,
    /** The environment variable it is, when it is one: a `??` after it falls back. */
    readonly environment?: string,
  ) {}
}

/**
 * A value another stack exports, by the key it is read under (P249):
 * `Fn.importValue('<name>')`; or a parameter of the account another
 * deployment writes (P253): `StringParameter.valueForStringParameter(this,
 * '<name>')`. Unread here, because no file of this repository holds it; what
 * it names is the publisher's to say, which the linker asks where the
 * publisher is read - unless the app publishes it itself, when it is what the
 * app publishes.
 */
export class Imported extends Unread {
  constructor(
    /** `export:<name>` or `parameter:<name>`. */
    readonly key: string,
    text: string,
    /** How it is written, for a person: `Fn.importValue("orders-queue")`. */
    readonly written: string,
  ) {
    super(text, 'imported');
  }
}

/** What stands in a text for a part of it known only once the stack is deployed. */
export const HOLE = '\u0001';

/**
 * A text built with values other stacks export, or parameters other
 * deployments write, written into it (P261): `` `${Fn.importValue('prefix')}-audit` ``,
 * `Fn.sub` and `Fn.join` with imports among their parts. Unread as text;
 * `built` is the text with each import's stand-in (`importedName`) in place
 * and a {@link HOLE} where a part is known only once deployed, so an ARN or a
 * name built of imports and text is read the way the linker finishes it.
 */
export class Embedded extends Unread {
  constructor(
    readonly built: string,
    /** The keys of the values written in, each once. */
    readonly keys: readonly string[],
    /** Where it is built. */
    readonly site: Site,
    /** How it is written, shortened, for a person. */
    readonly written: string,
  ) {
    super(`${written} holds values other deployments publish`, 'imported');
  }
}

/**
 * Parts of a text, in order, as one text with the values other deployments
 * publish written in (P261): an {@link Embedded} where at least one part is
 * such a value, every other part not text a {@link HOLE}; `undefined` where
 * none is, so the text is read as it always was.
 */
export const embedding = (parts: readonly Value[], site: Site, written: string): Embedded | undefined => {
  if (!parts.some((part) => part instanceof Imported || part instanceof Embedded)) return undefined;
  let built = '';
  const keys: string[] = [];
  for (const part of parts) {
    if (part instanceof Imported) {
      built += importedName(part.key);
      keys.push(part.key);
    } else if (part instanceof Embedded) {
      built += part.built;
      keys.push(...part.keys);
    } else {
      built += typeof part === 'string' || typeof part === 'number' || typeof part === 'boolean' ? String(part) : HOLE;
    }
  }
  return new Embedded(built, [...new Set(keys)], site, written);
};

/** What `Stack.exportValue` declares: an output exported under a name, and nothing else (P253). */
export const EXPORT_VALUE = 'core.ExportValue';

/** An object literal, its members in the order written. */
export class ObjectValue {
  readonly entries: Map<string, Value>;
  /** The entries a context value the deployment may set gave, by the context key (P298). */
  readonly chosen = new Map<string, string>();

  constructor(entries: Iterable<readonly [string, Value]> = []) {
    this.entries = new Map(entries);
  }

  /** Sets an entry, remembering where a context value gave it (P298). */
  put(name: string, value: Value): void {
    if (value instanceof Chosen) this.chosen.set(name, value.key);
    else this.chosen.delete(name);
    this.entries.set(name, settle(value));
  }

  get(name: string): Value {
    return this.entries.get(name);
  }

  /** An entry as it is handed on (P332): one a context value no file sets gave, that value not read. */
  handed(name: string): Value {
    const key = this.chosen.get(name);
    const value = this.entries.get(name);
    return key !== undefined && value === undefined ? unsetContext(key) : value;
  }
}

/** Where something is written, repo-relative. */
export interface Site {
  readonly file: string;
  readonly line: number;
}

/**
 * A construct the app creates, at its place in the construct tree: a function,
 * a queue, a stack of the app's own. What its methods add - an event source, a
 * route, a target - is kept in `added`, by the method's name.
 */
export class Construct {
  /** Members a construct of the app's own sets on itself: `this.queue = ...`. */
  readonly fields = new Map<string, Value>();
  /** What was added to it after it was made, by the method that added it. */
  readonly added = new Map<string, Added[]>();
  /** Constructs made from it on demand - a REST API's root resource - by name. */
  readonly children = new Map<string, Construct>();

  constructor(
    /** `aws-lambda.Function`, `aws-sqs.Queue`; `app:<Class>` for the app's own. */
    readonly type: string,
    /** Its path in the tree: `OrdersStack/PlaceOrder`. */
    readonly path: string,
    readonly site: Site,
    readonly props: ObjectValue | undefined,
    readonly args: readonly Value[],
    /** The condition it is declared under, when the files do not settle it. */
    readonly conditional: string | undefined,
    /** The collection it is declared once per element of, when the files do not settle it. */
    readonly repeated: string | undefined,
    /** The name it was looked up by, for a construct imported rather than created: `Function.fromFunctionName`. */
    readonly imported?: { readonly name?: string; readonly arn?: string; readonly unread?: Unread },
  ) {}

  /** The last part of its path: the id it was given. */
  get id(): string {
    return this.path.slice(this.path.lastIndexOf('/') + 1);
  }

  add(method: string, args: readonly Value[], site: Site, conditional?: string): void {
    const list = this.added.get(method) ?? [];
    list.push({ args, site, ...(conditional === undefined ? {} : { conditional }) });
    this.added.set(method, list);
  }

  addedBy(method: string): readonly Added[] {
    return this.added.get(method) ?? [];
  }
}

/** One call of a construct's method: what it was handed, where, and under what condition. */
export interface Added {
  readonly args: readonly Value[];
  readonly site: Site;
  readonly conditional?: string;
}

/** An attribute of a construct: `queue.queueUrl`, `table.tableStreamArn`, `url.url`. */
export class Attribute {
  constructor(
    readonly construct: Construct,
    readonly name: string,
  ) {}
}

/** A name the CDK exports, and the members followed below it: `aws-lambda` `Runtime.NODEJS_20_X`. */
export class CdkRef {
  constructor(
    /** The module, without its package: `aws-lambda`, `core` for the library's root. */
    readonly module: string,
    readonly path: readonly string[],
  ) {}

  /** `aws-lambda.Function`, `core.Duration.minutes`. */
  get key(): string {
    return [this.module, ...this.path].join('.');
  }

  member(name: string): CdkRef {
    // `cdk.aws_lambda` is the module `aws-lambda`, written through the library's root.
    if (this.module === 'core' && this.path.length === 0 && /^aws_/.test(name)) return new CdkRef(name.replace(/_/g, '-'), []);
    return new CdkRef(this.module, [...this.path, name]);
  }
}

/**
 * A value one of the CDK's classes or helpers built that is not a construct:
 * an integration, an event source, a target, a duration, an asset. `what` is
 * the key of what built it, and `args` what it was handed.
 */
export class Built {
  /** What its own methods did to it after it was built: a chain's next state. */
  readonly state = new Map<string, Value>();

  constructor(
    readonly what: string,
    readonly args: readonly Value[],
    readonly site: Site,
  ) {}
}

/** A function of the app, with the scope it was written in. */
export class FunctionValue {
  constructor(
    readonly node: TsNode,
    readonly scope: Scope,
  ) {}
}

/** A class of the app: a stack or a construct of its own, or a helper class. */
export class ClassValue {
  constructor(readonly node: ClassDeclaration | ClassExpression) {}
}

/** A construct's `node`, which answers `tryGetContext`. */
export class NodeHandle {
  constructor(readonly of: Construct | undefined) {}
}

/** Names bound while a body runs, inside the scope of what encloses it. */
export class Scope {
  readonly #names = new Map<string, Value>();

  constructor(readonly parent?: Scope) {}

  has(name: string): boolean {
    return this.#names.has(name) || (this.parent?.has(name) ?? false);
  }

  get(name: string): Value {
    if (this.#names.has(name)) return this.#names.get(name);
    return this.parent?.get(name);
  }

  set(name: string, value: Value): void {
    this.#names.set(name, value);
  }

  /** Assigns to the scope that holds the name, or this one. */
  assign(name: string, value: Value): void {
    if (this.#names.has(name) || this.parent === undefined || !this.parent.has(name)) this.#names.set(name, value);
    else this.parent.assign(name, value);
  }
}

/** Whether a value is settled plain data: no construct, no reference, nothing unread. */
export const isPlain = (value: Value): boolean => {
  if (value === null || value === undefined || typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.every(isPlain);
  if (value instanceof ObjectValue) return [...value.entries.values()].every(isPlain);
  return false;
};

/** A settled value as plain JSON, or `undefined` where some part is not plain. */
export const toJson = (value: Value): unknown => {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return isPlain(value) ? value.map(toJson) : undefined;
  if (value instanceof ObjectValue) return isPlain(value) ? Object.fromEntries([...value.entries].map(([key, item]) => [key, toJson(item)])) : undefined;
  return undefined;
};

/** The text a value is, when it is text or a number. */
export const textOf = (value: Value): string | undefined => {
  const plain = settle(value);
  return typeof plain === 'string' ? plain : typeof plain === 'number' ? String(plain) : undefined;
};

/** A member of an object value, or `undefined`. */
export const memberOf = (value: Value, name: string): Value => (value instanceof ObjectValue ? value.get(name) : undefined);

/** Why a value is not the text it should be, in one sentence. */
export const whyNotText = (value: Value, what: string): string => {
  if (value instanceof Unread) return `${what} is not read: ${value.text}`;
  if (value === undefined) return `${what} is not set`;
  if (value instanceof Construct || value instanceof Attribute) return `${what} is a value known only once deployed`;
  return `${what} is not text`;
};

/** The attributes of a construct that stand for the principal it acts as: `fn.role`, `fn.grantPrincipal` (P299). */
export const PRINCIPAL_ATTRIBUTES: ReadonlySet<string> = new Set(['role', 'grantPrincipal']);

/**
 * The constructs a grantee stands for (P299): a construct, a construct's role
 * or principal, and each member of a `CompositePrincipal`, with those added to
 * it by `addPrincipals`.
 */
export const principalHolders = (grantee: Value, seen = new Set<Value>()): Construct[] => {
  if (seen.has(grantee)) return [];
  seen.add(grantee);
  if (grantee instanceof Construct) return [grantee];
  if (grantee instanceof Attribute && PRINCIPAL_ATTRIBUTES.has(grantee.name)) return [grantee.construct];
  if (grantee instanceof Built && grantee.what === 'aws-iam.CompositePrincipal') {
    const added = grantee.state.get('principals');
    return [...grantee.args, ...(Array.isArray(added) ? added : [])].flatMap((member) => principalHolders(member, seen));
  }
  return [];
};
