import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, normalize } from 'node:path';
import { importedName, parameterKey, stackOutputKey, type PathStep } from '@flowatlas/core';
import { readServiceFile, UnreadMember } from './document.js';

/**
 * The Serverless Framework's variables, resolved where the files settle them.
 *
 * A service file is written with `${...}` everywhere: `${self:service}`,
 * `${opt:stage, 'dev'}`, `${file(./config.yml):tableName}`,
 * `${ssm:/orders/queue-url}`. Each is resolved here, innermost first, to the
 * value the framework would give it - from the file itself, from the options a
 * deployment is run with (`services[].infra.options`, never guessed), from a
 * `.env` file where the service loads one, from another file - or left
 * {@link Unread} with a sentence saying which variable and why. A value read
 * from the deployed account (`ssm`, `cf`, `s3`) is never read: the files do
 * not hold it. An output of another stack (`cf`) and a parameter another
 * deployment writes (`ssm`) are {@link Imported}: their value is the
 * publisher's to say, which the linker asks where the publisher is read.
 *
 * A string that holds an unread variable among written text keeps the text it
 * could read, with a {@link HOLE} where the variable was: an ARN whose account
 * is unread still names its queue, because the account does not change which
 * queue it is.
 */

/** Where a variable's value could not be read, inside a string that was otherwise read. */
export const HOLE = '\u0001';

/** A value the files do not settle, and why. */
export class Unread {
  constructor(
    /** One sentence. */
    readonly text: string,
    /** The variable it depends on, as written: `opt:stage`, `ssm:/orders/url`. */
    readonly variable?: string,
    /** The string as far as it was read, with a {@link HOLE} where it was not. */
    readonly partial?: string,
    /**
     * The values other deployments publish written inside the string, by
     * their keys, and the string with each value's stand-in (`importedName`)
     * in its place (P253, P259): an ARN whose name is an import names the
     * imported thing, by the stand-in the linker finishes, and one whose name
     * is built of several, or of an import and text, is the name the linker
     * writes once every part of it is joined.
     */
    readonly embeds?: { readonly keys: readonly string[]; readonly text: string },
  ) {}
}

/**
 * A value another stack publishes, by the key it is read under (P249): an
 * output by its export name, or by its stack's name and its own.
 *
 * It is an {@link Unread}, because the files of this repository do not hold
 * it, so every place that does not look for one says so as before; the places
 * that do name what it is by its key's stand-in, which the linker finishes
 * where the publisher is read.
 */
export class Imported extends Unread {
  constructor(
    /** `export:<name>`, `stack:<stack>#<output>` or `parameter:<name>`. */
    readonly key: string,
    text: string,
    variable?: string,
  ) {
    super(text, variable);
  }
}

/**
 * The value of a parameter of a template the files give none, written as the
 * whole of a value (P268): unread like any value the files do not hold, and
 * still one value, the same wherever the parameter is written. A resource
 * named by it is named by the parameter's declaration (`address`), and a
 * value of the environment that is the parameter names that resource, as a
 * resource with no name of its own is named by its own declaration (P57).
 */
export class ParameterValue extends Unread {
  constructor(
    text: string,
    parameter: string,
    /** Where the parameter is declared: `Parameters.<name>`, under the template's scope. */
    readonly address: string,
  ) {
    super(text, parameter);
  }
}

/** A value as it is when it is only part of another: a parameter's value no longer stands for the parameter. */
export const partOf = (value: Unread): Unread => (value instanceof ParameterValue ? new Unread(value.text, value.variable) : value);

/** Where a value another deployment publishes is written inside a string being built, until it is known what the string is. */
export const EMBEDDED = '\u0004';

/** Where the mark of one such value ends: the mark holds its position among the values written in. */
const EMBEDDED_END = '\u0005';

/** Every mark of a value written in, with its position. */
const EMBEDDED_MARKS = /\u0004(\d+)\u0005/g;

/** The mark of the `index`th value another deployment publishes written into a string being built (P259). */
export const embeddedAt = (index: number): string => `${EMBEDDED}${index}${EMBEDDED_END}`;

/** A string with a {@link HOLE} where each value another deployment publishes is written in. */
export const withoutEmbedded = (built: string): string => built.replace(EMBEDDED_MARKS, HOLE);

/**
 * A string built with values other deployments publish inside it, each at
 * its {@link embeddedAt} mark: the import itself where it is the whole
 * string, else an `Unread` that says so and carries the string with each
 * import's stand-in in its place (P253, P259). With no import in it, the
 * string, or why it is not read.
 */
export const embedding = (built: string, imported: readonly Imported[], because: Unread | undefined): Unread | string => {
  const [first] = imported;
  if (first === undefined || !built.includes(EMBEDDED)) return because === undefined ? built : new Unread(because.text, because.variable, built);
  if (built === embeddedAt(0)) return first;
  const unread = because ?? first;
  const keys = [...new Set(imported.map((value) => value.key))];
  const text = built.replace(EMBEDDED_MARKS, (_whole, index: string) => importedName((imported[Number(index)] ?? first).key));
  return new Unread(unread.text, unread.variable, withoutEmbedded(built), { keys, text });
};

/** Where the stage a service is deployed to was found. */
export type StageFrom = 'option' | 'file' | 'default';

export interface VariableContext {
  /** The service file as written. */
  readonly document: unknown;
  /** Absolute directory of the service file. */
  readonly dir: string;
  /** What a deployment is run with: `{ stage: 'prod', region: 'eu-west-1' }`. */
  readonly options: Readonly<Record<string, string>>;
  /** Absolute paths of every file a variable loaded, filled as they are. */
  readonly loaded: Set<string>;
  /**
   * The parameters a composition of services hands this one, which come
   * before the file's own `params` (P249).
   */
  readonly params?: Readonly<Record<string, unknown>>;
}

/** The framework's own stage and region, when neither the options nor the file names one. */
export const DEFAULT_STAGE = 'dev';
export const DEFAULT_REGION = 'us-east-1';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Unread) && !(value instanceof UnreadMember);

const keyOf = (path: readonly PathStep[]): string => JSON.stringify(path);

/** The member of a value at a dotted address, or `undefined`. */
const memberAt = (value: unknown, address: readonly string[]): unknown => {
  let at = value;
  for (const step of address) {
    if (Array.isArray(at) && /^\d+$/.test(step)) at = at[Number(step)];
    else if (isRecord(at)) at = at[step];
    else return undefined;
  }
  return at;
};

/** The pieces of a variable, split at the commas that are not inside quotes or brackets. */
const alternativesOf = (written: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let index = 0; index < written.length; index += 1) {
    const char = written[index] as string;
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      out.push(written.slice(start, index).trim());
      start = index + 1;
    }
  }
  out.push(written.slice(start).trim());
  return out;
};

/**
 * Whether the inside of a `${...}` is one of the framework's variables. A
 * CloudFormation substitution - `${AWS::Region}`, `${OrdersQueue.Arn}` - is not,
 * and is left as written for the template's own reader.
 */
const VARIABLE = /^(?:[A-Za-z][\w-]*(?:\([^)]*\))?:(?!:)|file\(|strToBool\(|'|")/;

/** What a variable that found nothing was asking for, for a person. */
const describeMissing = (written: string): string => {
  const colon = written.indexOf(':');
  const source = colon < 0 ? written : written.slice(0, colon);
  const address = colon < 0 ? '' : written.slice(colon + 1).trim();
  switch (source) {
    case 'opt':
      return `the option --${address} (services[].infra.options.${address})`;
    case 'env':
      return `the environment variable ${address}`;
    case 'param':
      return `the parameter ${address}`;
    case 'self':
      return `${address} of the service file`;
    default:
      return `\${${written}}`;
  }
};

/** A `.env` file's assignments, as written. */
const readDotenv = (path: string): Record<string, string> => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][\w.]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (match === null) continue;
    const value = match[2] as string;
    out[match[1] as string] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value.replace(/\s+#.*$/, '');
  }
  return out;
};

export class Variables {
  readonly #context: VariableContext;
  readonly #resolved = new Map<string, unknown>();
  readonly #resolving = new Set<string>();
  #stage: { value: string | Unread; from: StageFrom } | undefined;
  #dotenv: Record<string, string> | undefined;

  constructor(context: VariableContext) {
    this.#context = context;
  }

  /** The stage the service is deployed to, and where that was found. */
  get stage(): { value: string | Unread; from: StageFrom } {
    if (this.#stage !== undefined) return this.#stage;
    const option = this.#context.options['stage'];
    if (option !== undefined) return (this.#stage = { value: option, from: 'option' });
    // Asked while the stage is being read: whatever `provider.stage` says, it
    // cannot say it by naming the stage.
    this.#stage = { value: new Unread('the stage is defined in terms of itself', 'sls:stage'), from: 'file' };
    const written = this.at(['provider', 'stage']);
    this.#stage =
      written === undefined || written === null
        ? { value: DEFAULT_STAGE, from: 'default' }
        : typeof written === 'string' || written instanceof Unread
          ? { value: written, from: 'file' }
          : { value: new Unread('provider.stage is not text'), from: 'file' };
    return this.#stage;
  }

  /** The value at a path of the document, every variable in it resolved. */
  at(path: readonly PathStep[]): unknown {
    const key = keyOf(path);
    if (this.#resolved.has(key)) return this.#resolved.get(key);
    if (this.#resolving.has(key)) return new Unread(`${path.join('.') || 'the file'} refers to itself`, `self:${path.join('.')}`);
    this.#resolving.add(key);
    const value = this.resolve(memberAt(this.#context.document, path.map(String)));
    this.#resolving.delete(key);
    this.#resolved.set(key, value);
    return value;
  }

  /** A value with every variable in it resolved. */
  resolve(value: unknown, depth = 0): unknown {
    if (depth > 32) return new Unread('the value is nested too deeply to read');
    if (typeof value === 'string') return this.#string(value);
    if (value instanceof UnreadMember) return new Unread(`${value.text} is not written out`);
    if (Array.isArray(value)) return value.map((item) => this.resolve(item, depth + 1));
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.resolve(item, depth + 1)]));
    return value;
  }

  /** A string, its variables resolved innermost first. */
  #string(written: string): unknown {
    if (!written.includes('${')) return written;
    const kept: string[] = [];
    let text = written;
    let unread: Unread | undefined;
    // The imports written into the string, kept apart until the string is built (P253, P259).
    const imported: Imported[] = [];
    for (let guard = 0; guard < 64; guard += 1) {
      const match = /\$\{([^${}]*)\}/.exec(text);
      if (match === null) break;
      const inside = match[1] as string;
      const whole = match.index === 0 && match[0].length === text.length;
      if (!VARIABLE.test(inside.trim())) {
        // Not the framework's: kept as written, out of the way of the search.
        kept.push(match[0]);
        text = `${text.slice(0, match.index)}\u0002${kept.length - 1}\u0003${text.slice(match.index + match[0].length)}`;
        continue;
      }
      const value = this.#variable(inside);
      if (whole && kept.length === 0) return value;
      let piece: string;
      if (value instanceof Imported) {
        piece = embeddedAt(imported.length);
        imported.push(value);
      } else if (value instanceof Unread) {
        unread ??= value;
        piece = value.partial ?? HOLE;
      } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        piece = String(value);
      } else {
        unread ??= new Unread(`\${${inside}} is not text, and is written inside text`, inside);
        piece = HOLE;
      }
      text = `${text.slice(0, match.index)}${piece}${text.slice(match.index + match[0].length)}`;
    }
    const restored = text.replace(/\u0002(\d+)\u0003/g, (_whole, index: string) => kept[Number(index)] as string);
    return embedding(restored, imported, unread);
  }

  /** One `${...}`: its alternatives in order, the first that has a value. */
  #variable(inside: string): unknown {
    const alternatives = alternativesOf(inside);
    for (const alternative of alternatives) {
      const value = this.#source(alternative);
      // A value the deployed account holds may well exist: a fallback after it
      // would be a guess at whether it does, so an unread value is the answer.
      if (value instanceof Unread) return value;
      if (value !== undefined && value !== null) return value;
    }
    const first = alternatives[0] ?? inside;
    return new Unread(`${describeMissing(first)} is not given, and nothing in the files falls back from it`, first);
  }

  /** What one alternative of a variable stands for: a value, nothing, or why it is not read. */
  #source(written: string): unknown {
    const quoted = /^(['"])(.*)\1$/.exec(written);
    if (quoted !== null) return quoted[2];
    if (/^-?\d+(?:\.\d+)?$/.test(written)) return Number(written);
    if (written === 'null') return null;
    if (written === 'true' || written === 'false') return written === 'true';
    const call = /^(\w+)\((.*)\)(?::(.*))?$/.exec(written);
    if (call !== null) return this.#call(call[1] as string, (call[2] as string).trim(), call[3]?.trim(), written);
    const colon = written.indexOf(':');
    if (colon < 0) return new Unread(`\${${written}} is not a variable the framework reads`, written);
    const source = written.slice(0, colon);
    const address = written.slice(colon + 1).trim();
    switch (source) {
      case 'self':
        return address === '' ? this.at([]) : this.at(address.split('.'));
      case 'opt':
        return this.#context.options[address];
      case 'sls':
        if (address === 'stage') return this.stage.value;
        return new Unread(`sls:${address} is known only when the framework runs`, written);
      case 'env':
        return this.#env(address);
      case 'param': {
        const given = this.#context.params?.[address];
        if (given !== undefined) return given;
        const stage = this.stage.value;
        const own = typeof stage === 'string' ? this.at(['params', stage, address]) : undefined;
        return own ?? this.at(['params', 'default', address]);
      }
      case 'cf':
        return outputOf(address, written);
      case 'ssm':
        return parameterOf(address, written);
      case 'aws':
        if (address === 'region') return this.at(['provider', 'region']) ?? this.#context.options['region'] ?? DEFAULT_REGION;
        return new Unread(`aws:${address} is the deployed account's, which the files do not say`, written);
      default:
        return new Unread(`${source}: values are read from the deployed account or a service, which the files do not hold`, written);
    }
  }

  #call(name: string, argument: string, address: string | undefined, written: string): unknown {
    if (name === 'strToBool') {
      const value = this.#string(argument.replace(/^(['"])(.*)\1$/, '$2'));
      return typeof value === 'string' ? ['true', '1'].includes(value.trim().toLowerCase()) : value;
    }
    // `${cf(eu-west-1):orders-prod.QueueUrl}`: the same output, read in another region.
    if (name === 'cf' && address !== undefined) return outputOf(address, written);
    // `${ssm(eu-west-1):/orders/url}`, `${ssm(raw):/orders/url}`: the same parameter.
    if (name === 'ssm' && address !== undefined) return parameterOf(address, written);
    if (name !== 'file') return new Unread(`${name}() is not a variable source this reads`, written);
    const relative = argument.replace(/^(['"])(.*)\1$/, '$2');
    const path = isAbsolute(relative) ? relative : normalize(join(this.#context.dir, relative));
    if (!['.yml', '.yaml', '.json'].includes(extname(path))) {
      return new Unread(`${relative} is code, run when the framework loads it`, written);
    }
    if (!existsSync(path)) return new Unread(`${relative} is not there`, written);
    this.#context.loaded.add(path);
    let value: unknown;
    try {
      value = new Variables({ ...this.#context, document: readServiceFile(path).value }).at([]);
    } catch {
      return new Unread(`${relative} could not be read`, written);
    }
    return address === undefined || address === '' ? value : memberAt(value, address.split('.'));
  }

  /** An environment variable, from the `.env` files a service loads. */
  #env(name: string): string | undefined {
    if (this.#dotenv === undefined) {
      const document = isRecord(this.#context.document) ? this.#context.document : {};
      const version = String(document['frameworkVersion'] ?? '');
      const loads = document['useDotenv'] === true || /^[\^~>=\s]*4/.test(version);
      this.#dotenv = {};
      if (loads) {
        const stage = this.#context.options['stage'];
        for (const file of [...(stage === undefined ? [] : [`.env.${stage}`]), '.env']) {
          const path = join(this.#context.dir, file);
          if (!existsSync(path)) continue;
          this.#context.loaded.add(path);
          this.#dotenv = { ...readDotenv(path), ...this.#dotenv };
        }
      }
    }
    return this.#dotenv[name];
  }
}

/** `${cf:<stack>.<output>}`: an output of a deployed stack, by the stack's name and its own (P249). */
const outputOf = (address: string, written: string): Unread => {
  const dot = address.indexOf('.');
  const stack = dot < 0 ? '' : address.slice(0, dot);
  const output = dot < 0 ? '' : address.slice(dot + 1);
  if (stack === '' || output === '' || /[${}\u0001]/.test(address)) return new Unread(`\${${written}} names no stack and output the files settle`, written);
  return new Imported(stackOutputKey(stack, output), `the value is the output ${output} of the stack ${stack}, which another deployment publishes`, written);
};

/**
 * `${ssm:/orders/queue-url}`: a parameter of the account, which another
 * deployment writes (P253). A `~true` after the name asks for it decrypted,
 * and a `~split` for a list; neither changes which parameter it is.
 */
const parameterOf = (address: string, written: string): Unread => {
  const name = address.replace(/~(?:true|false|split)$/, '').trim();
  if (name === '' || /[${}\u0001]/.test(name)) return new Unread(`\${${written}} names no parameter the files settle`, written);
  return new Imported(parameterKey(name), `the value is the parameter ${name}, which another deployment writes`, written);
};

/** The text a resolved value is, when it is text with nothing unread in it. */
export const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;

/** Why a value is not text, in one sentence. */
export const whyNotText = (value: unknown, what: string): Unread => {
  if (value instanceof Unread) return new Unread(`${what}: ${value.text}`, value.variable, value.partial);
  if (value === undefined || value === null) return new Unread(`${what} is not set`);
  return new Unread(`${what} is not text`);
};

export { isRecord };
