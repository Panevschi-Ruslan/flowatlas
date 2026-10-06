import type { Block, Position } from '../hcl/ast.js';
import type { Scope } from './evaluate.js';

/**
 * What an expression evaluates to.
 *
 * The part of the expression language that addresses things is evaluated, and
 * nothing else is guessed at: a value nobody can know from the files alone is
 * `unknown`, with the reason it is unknown, and never a string assembled from
 * the parts that did evaluate. Joining two services on half a name is the
 * failure this tool exists to prevent (I3), and an evaluator that "did its best"
 * would be how that happened.
 *
 * Two kinds exist that an ordinary evaluator would not have. A `ref` is an
 * attribute of a resource that only the provider knows after it is created - an
 * ARN, an id - and it is kept as the reference itself, because "the invoke ARN
 * of that function" is exactly the fact an integration states, and resolving it
 * to a string would throw the fact away. An `instance` is a resource as a value,
 * before any attribute of it is asked for.
 *
 * `via` records the resource argument a value was read from, so a reader that
 * cares where a path came from (`filename = data.archive_file.x.output_path`)
 * can still ask after the value has been computed.
 */
export type Value =
  | { readonly kind: 'string'; readonly value: string; readonly via?: Via }
  | { readonly kind: 'number'; readonly value: number; readonly via?: Via }
  | { readonly kind: 'bool'; readonly value: boolean; readonly via?: Via }
  | { readonly kind: 'null'; readonly via?: Via }
  | { readonly kind: 'list'; readonly items: readonly Value[]; readonly via?: Via }
  | { readonly kind: 'object'; readonly entries: ReadonlyMap<string, Value>; readonly via?: Via }
  | { readonly kind: 'ref'; readonly target: Instance; readonly attribute: readonly (string | number)[] }
  | { readonly kind: 'instance'; readonly instance: Instance }
  | { readonly kind: 'module'; readonly module: ModuleInstance }
  | { readonly kind: 'unknown'; readonly because: Because; readonly partial?: Value };

/** Where a value was read from: one argument of one resource. */
export interface Via {
  readonly target: Instance;
  readonly attribute: string;
}

/**
 * Why a value is not known, in words that can be put in front of a person.
 *
 * `error` marks a value that is not merely unknown but could not exist - an
 * index into a string, a key a map does not have - which is the distinction
 * `try()` and `can()` turn on.
 */
export interface Because {
  /** A stable kebab-case word. */
  readonly reason: string;
  /** One sentence. */
  readonly text: string;
  readonly at?: Position;
  readonly error?: boolean;
  /** The input variable the value depends on, when that is the cause. */
  readonly variable?: string;
  /** The module the variable belongs to, `""` for a root module. */
  readonly module?: string;
  /** Variable files and what each says, when they disagree. */
  readonly files?: Readonly<Record<string, string>>;
}

/** One instance of a resource or data block, in one module instance. */
export interface Instance {
  readonly mode: 'managed' | 'data';
  readonly type: string;
  readonly name: string;
  /** `count.index` or `each.key`; `undefined` when the block is not repeated. */
  readonly key?: string | number;
  /** The block is repeated over something not known here, so its key is not either. */
  readonly keyUnknown?: Because;
  readonly block: Block;
  readonly module: ModuleInstance;
  /** `module.loans.aws_lambda_function.this["a"]`. */
  readonly address: string;
  /** What `each.value` is for this instance. */
  readonly eachValue?: Value;
}

/**
 * One instance of a module: the root, a local directory, or a described module.
 *
 * Defined here rather than beside the loader because values point at it, and
 * the loader is what fills it in.
 */
export interface ModuleInstance {
  /** `""` for a root module, `module.x` or `module.x["k"]` below it. */
  readonly address: string;
  /** Repo-relative directory, or the calling directory for a described module. */
  readonly dir: string;
  /** The root module this one is read under. */
  readonly root: ModuleInstance | undefined;
  /** Where `path.module` points, relative to the root module's directory. */
  readonly pathModule: string;
  /**
   * For a module described rather than read, the call that created it: what it
   * declares has no file of its own, so it is reported where it was called.
   */
  readonly site?: Position;
  variable(name: string): Value;
  local(name: string): Value;
  output(name: string): Value;
  /** The names of the outputs it declares. */
  outputNames(): readonly string[];
  /** Where an output is declared. */
  outputAt(name: string): Position | undefined;
  /** The scope the arguments of one of its instances are evaluated in. */
  scopeOf(instance: Instance): Scope;
  /** A resource or data block group: one instance value, a list, or an object. */
  group(mode: 'managed' | 'data', type: string, name: string): Value | undefined;
  /** A module call: one module value, a list, or an object. */
  call(name: string): Value | undefined;
  /** Every resource and data instance declared directly in this module. */
  instances(): readonly Instance[];
  /** Every module instance called directly from this one. */
  children(): readonly ModuleInstance[];
  /** Evaluates an argument of one of this module's instances. */
  argument(instance: Instance, name: string): Value | undefined;
  /** Reads a nested block or an object-valued argument of an instance. */
  nested(instance: Instance, name: string): readonly Value[];
  /** Reads a file relative to the root module's directory. */
  readFile(path: string): string | undefined;
}

export const str = (value: string, via?: Via): Value => (via === undefined ? { kind: 'string', value } : { kind: 'string', value, via });
export const num = (value: number): Value => ({ kind: 'number', value });
export const bool = (value: boolean): Value => ({ kind: 'bool', value });
export const NULL: Value = { kind: 'null' };
export const list = (items: readonly Value[]): Value => ({ kind: 'list', items });
export const object = (entries: ReadonlyMap<string, Value>): Value => ({ kind: 'object', entries });

export const unknown = (reason: string, text: string, extra: Partial<Because> = {}, partial?: Value): Value => ({
  kind: 'unknown',
  because: { reason, text, ...extra },
  ...(partial === undefined ? {} : { partial }),
});

/** A value that could not exist, as opposed to one that is merely not known. */
export const failure = (text: string, at?: Position): Value =>
  unknown('evaluation-error', text, { error: true, ...(at === undefined ? {} : { at }) });

export const isUnknown = (value: Value): value is Extract<Value, { kind: 'unknown' }> => value.kind === 'unknown';

export const isError = (value: Value): boolean => value.kind === 'unknown' && value.because.error === true;

/** The first unknown among some values, which is what an operation on them is. */
export const firstUnknown = (values: readonly Value[]): Value | undefined => values.find(isUnknown);

/** A string, when the value is one or can be written as one in a template. */
export const asText = (value: Value): string | undefined => {
  if (value.kind === 'string') return value.value;
  if (value.kind === 'number') return String(value.value);
  if (value.kind === 'bool') return String(value.value);
  return undefined;
};

/** What a value is, as a short phrase for messages. */
export const describe = (value: Value): string => {
  switch (value.kind) {
    case 'string':
      return JSON.stringify(value.value);
    case 'number':
    case 'bool':
      return String(value.value);
    case 'null':
      return 'null';
    case 'list':
      return `a list of ${value.items.length}`;
    case 'object':
      return 'an object';
    case 'ref':
      return `${value.target.address}.${value.attribute.join('.')}`;
    case 'instance':
      return value.instance.address;
    case 'module':
      return value.module.address;
    case 'unknown':
      return 'an unknown value';
  }
};

/** Deep equality of two known values; `undefined` when either is not known. */
export const equal = (a: Value, b: Value): boolean | undefined => {
  if (a.kind === 'unknown' || b.kind === 'unknown') return undefined;
  if (a.kind === 'ref' || b.kind === 'ref') {
    if (a.kind !== 'ref' || b.kind !== 'ref') return undefined;
    return a.target === b.target && a.attribute.join('.') === b.attribute.join('.') ? true : undefined;
  }
  if (a.kind === 'instance' && b.kind === 'instance') return a.instance === b.instance;
  if (a.kind !== b.kind) {
    // Terraform converts a number to a string for comparison only in templates;
    // `==` between different types is false.
    return false;
  }
  switch (a.kind) {
    case 'string':
    case 'number':
    case 'bool':
      return a.value === (b as typeof a).value;
    case 'null':
      return true;
    case 'list': {
      const other = b as typeof a;
      if (a.items.length !== other.items.length) return false;
      let all: boolean | undefined = true;
      a.items.forEach((item, index) => {
        const same = equal(item, other.items[index] as Value);
        if (same === false) all = false;
        else if (same === undefined && all === true) all = undefined;
      });
      return all;
    }
    case 'object': {
      const other = b as typeof a;
      if (a.entries.size !== other.entries.size) return false;
      let all: boolean | undefined = true;
      for (const [key, item] of a.entries) {
        const there = other.entries.get(key);
        if (there === undefined) return false;
        const same = equal(item, there);
        if (same === false) return false;
        if (same === undefined) all = undefined;
      }
      return all;
    }
    default:
      return undefined;
  }
};

/** A value with no reference left in it, as plain JSON, or `undefined` when it holds one. */
export const toJson = (value: Value): unknown => {
  switch (value.kind) {
    case 'string':
    case 'number':
    case 'bool':
      return value.value;
    case 'null':
      return null;
    case 'list': {
      const out: unknown[] = [];
      for (const item of value.items) {
        const json = toJson(item);
        if (json === undefined) return undefined;
        out.push(json);
      }
      return out;
    }
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const key of [...value.entries.keys()].sort()) {
        const json = toJson(value.entries.get(key) as Value);
        if (json === undefined) return undefined;
        out[key] = json;
      }
      return out;
    }
    default:
      return undefined;
  }
};

/** Plain JSON as a value. */
export const fromJson = (json: unknown): Value => {
  if (json === null || json === undefined) return NULL;
  if (typeof json === 'string') return str(json);
  if (typeof json === 'number') return num(json);
  if (typeof json === 'boolean') return bool(json);
  if (Array.isArray(json)) return list(json.map(fromJson));
  if (typeof json === 'object') {
    return object(new Map(Object.entries(json as Record<string, unknown>).map(([key, item]) => [key, fromJson(item)])));
  }
  return NULL;
};
