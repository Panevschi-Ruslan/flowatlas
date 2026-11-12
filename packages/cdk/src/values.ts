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
  | Unread;

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

  constructor(entries: Iterable<readonly [string, Value]> = []) {
    this.entries = new Map(entries);
  }

  get(name: string): Value {
    return this.entries.get(name);
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
export const textOf = (value: Value): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;

/** A member of an object value, or `undefined`. */
export const memberOf = (value: Value, name: string): Value => (value instanceof ObjectValue ? value.get(name) : undefined);

/** Why a value is not the text it should be, in one sentence. */
export const whyNotText = (value: Value, what: string): string => {
  if (value instanceof Unread) return `${what} is not read: ${value.text}`;
  if (value === undefined) return `${what} is not set`;
  if (value instanceof Construct || value instanceof Attribute) return `${what} is a value known only once deployed`;
  return `${what} is not text`;
};
