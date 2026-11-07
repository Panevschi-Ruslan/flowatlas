import type { PathStep } from '@flowatlas/core';
import { intrinsicOf, isRecord, textOf, Unread } from '@flowatlas/serverless';

/**
 * What a template settles before any of its resources is read (P246): its
 * parameters, its mappings, its conditions, the branches of `Fn::If`, the
 * loops of `Fn::ForEach`, and the functions that only shuffle text
 * (`Fn::FindInMap`, `Fn::Select`, `Fn::Split`, `Fn::Join` of text).
 *
 * Each is decided where the files decide it and left otherwise: a parameter
 * with no value given anywhere is an {@link Unread} naming it, a condition
 * that reads one is unsettled, and a branch under an unsettled condition is an
 * `Unread` saying which. What names a resource - `Ref`, `Fn::GetAtt`, `Fn::Sub`
 * over one - is left in place for `Template`, which knows the resources.
 */

/** A property removed by `!Ref AWS::NoValue`, dropped from the mapping or list that holds it. */
const NO_VALUE = Symbol('no value');

/** A condition: decided, or the reason it is not. */
export type Decided = boolean | Unread;

/** Where a parameter's value came from, for a person. */
export type ParameterFrom = 'option' | 'file' | 'parent' | 'default';

export interface Parameter {
  readonly value: string | readonly string[] | Unread;
  readonly from?: ParameterFrom;
}

export interface ResolverContext {
  /** The template as read: `Parameters`, `Mappings`, `Conditions`. */
  readonly document: Record<string, unknown>;
  /** A value for each parameter given from outside the template, and where from. */
  readonly given: Readonly<Record<string, { readonly value: string | Unread; readonly from: ParameterFrom }>>;
  /** Pseudo parameters the deployment settles: `AWS::Region`, `AWS::StackName`. */
  readonly pseudo: Readonly<Record<string, string>>;
  /** Where the overrides of a parameter would be written, for a sentence about one with no value. */
  readonly configFile: string;
}

const LIST_TYPES = /^(CommaDelimitedList|List<)/;

export class Resolver {
  readonly parameters = new Map<string, Parameter>();
  readonly #conditions = new Map<string, Decided>();
  readonly #deciding = new Set<string>();

  constructor(readonly context: ResolverContext) {
    const declared = isRecord(context.document['Parameters']) ? context.document['Parameters'] : {};
    for (const [name, written] of Object.entries(declared)) {
      const declaration = isRecord(written) ? written : {};
      const list = LIST_TYPES.test(textOf(declaration['Type']) ?? '');
      const given = context.given[name];
      const fallback = declaration['Default'];
      const text = given?.value ?? (Array.isArray(fallback) ? fallback.map(String).join(',') : textOf(fallback));
      const from = given?.from ?? (text === undefined ? undefined : 'default');
      const value: Parameter['value'] =
        text === undefined
          ? new Unread(`the parameter ${name} has no value: it has no Default, and neither ${context.configFile} nor services[].infra.options sets it`, name)
          : text instanceof Unread
            ? text
            : list
              ? text.split(',').map((item) => item.trim())
              : text;
      this.parameters.set(name, { value, ...(from === undefined ? {} : { from }) });
    }
  }

  /** A condition by its name, decided once. */
  condition(name: string): Decided {
    const known = this.#conditions.get(name);
    if (known !== undefined) return known;
    const written = isRecord(this.context.document['Conditions']) ? this.context.document['Conditions'][name] : undefined;
    if (written === undefined || this.#deciding.has(name)) return new Unread(`the condition ${name} is not declared`);
    this.#deciding.add(name);
    const decided = this.#decide(written);
    this.#deciding.delete(name);
    const named = decided instanceof Unread ? new Unread(`the condition ${name} is not settled: ${decided.text}`, decided.variable) : decided;
    this.#conditions.set(name, named);
    return named;
  }

  #decide(value: unknown, depth = 0): Decided {
    if (depth > 32) return new Unread('the condition is nested too deeply to read');
    if (typeof value === 'boolean') return value;
    const intrinsic = intrinsicOf(value);
    if (intrinsic === undefined) return new Unread('it is not a condition');
    const [fn, argument] = intrinsic;
    const items = Array.isArray(argument) ? argument : [argument];
    if (fn === 'Condition' && typeof argument === 'string') return this.condition(argument);
    if (fn === 'Fn::Equals') {
      const [left, right] = items.map((item) => this.#conditionText(item));
      if (left instanceof Unread) return left;
      if (right instanceof Unread) return right;
      return left === right;
    }
    const decided = items.map((item) => this.#decide(item, depth + 1));
    const unsettled = decided.find((item): item is Unread => item instanceof Unread);
    if (fn === 'Fn::Not') return decided[0] instanceof Unread ? decided[0] : decided[0] === false;
    if (fn === 'Fn::And') return decided.includes(false) ? false : (unsettled ?? true);
    if (fn === 'Fn::Or') return decided.includes(true) ? true : (unsettled ?? false);
    return new Unread(`${fn} is not a condition`);
  }

  /** A value compared in a condition, as text: pseudo parameters too, since a condition is decided here or nowhere. */
  #conditionText(value: unknown): string | Unread {
    const intrinsic = intrinsicOf(value);
    if (intrinsic?.[0] === 'Ref' && typeof intrinsic[1] === 'string' && intrinsic[1].startsWith('AWS::')) {
      return this.context.pseudo[intrinsic[1]] ?? new Unread(`${intrinsic[1]} is known only once the stack is deployed`);
    }
    const resolved = this.resolve(value);
    if (Array.isArray(resolved)) return resolved.join(',');
    const text = textOf(resolved);
    if (text !== undefined) return text;
    return resolved instanceof Unread ? resolved : new Unread('a value it compares is known only once the stack is deployed');
  }

  /** The condition a resource is declared under, decided; `true` when it has none. */
  resourceCondition(resource: Record<string, unknown>): Decided {
    const name = textOf(resource['Condition']);
    return name === undefined ? true : this.condition(name);
  }

  /** A value with everything the template settles before its resources settled. */
  resolve(value: unknown, depth = 0): unknown {
    const resolved = this.#resolve(value, depth);
    return resolved === NO_VALUE ? undefined : resolved;
  }

  #resolve(value: unknown, depth: number): unknown {
    if (depth > 64 || value === null || typeof value !== 'object' || value instanceof Unread) return value;
    if (Array.isArray(value)) return value.map((item) => this.#resolve(item, depth + 1)).filter((item) => item !== NO_VALUE);
    const intrinsic = intrinsicOf(value);
    if (intrinsic === undefined) {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        const resolved = this.#resolve(item, depth + 1);
        if (resolved !== NO_VALUE) out[key] = resolved;
      }
      return out;
    }
    const [fn, argument] = intrinsic;
    const inner = (item: unknown): unknown => this.#resolve(item, depth + 1);
    switch (fn) {
      case 'Ref': {
        if (argument === 'AWS::NoValue') return NO_VALUE;
        const parameter = typeof argument === 'string' ? this.parameters.get(argument) : undefined;
        return parameter === undefined ? value : parameter.value;
      }
      case 'Fn::If': {
        const [name, whenTrue, whenFalse] = Array.isArray(argument) ? argument : [];
        if (typeof name !== 'string') return new Unread('Fn::If names no condition');
        const decided = this.condition(name);
        if (decided instanceof Unread) {
          const left = inner(whenTrue);
          // Both branches the same: the condition does not matter to the value.
          if (JSON.stringify(left) === JSON.stringify(inner(whenFalse)) && !(left instanceof Unread)) return left;
          return new Unread(`it depends on the condition ${name}, which the files do not settle`, decided.variable);
        }
        return inner(decided ? whenTrue : whenFalse);
      }
      case 'Fn::Sub':
        return this.#sub(argument, depth);
      case 'Fn::Join': {
        if (!Array.isArray(argument)) return value;
        const delimiter = inner(argument[0]);
        const parts = inner(argument[1]);
        if (Array.isArray(parts) && typeof delimiter === 'string' && parts.every((part) => typeof part === 'string')) return parts.join(delimiter);
        return { 'Fn::Join': [delimiter, parts] };
      }
      case 'Fn::Split': {
        const [delimiter, text] = Array.isArray(argument) ? argument.map(inner) : [];
        if (typeof delimiter === 'string' && typeof text === 'string') return text.split(delimiter);
        return text instanceof Unread ? text : { 'Fn::Split': [delimiter, text] };
      }
      case 'Fn::Select': {
        const [index, list] = Array.isArray(argument) ? argument.map(inner) : [];
        const at = typeof index === 'number' ? index : typeof index === 'string' && /^\d+$/.test(index) ? Number(index) : undefined;
        if (at !== undefined && Array.isArray(list) && at < list.length) return list[at];
        if (list instanceof Unread) return list;
        return new Unread('Fn::Select picks from a list known only once the stack is deployed');
      }
      case 'Fn::FindInMap': {
        const [map, top, second] = Array.isArray(argument) ? argument.map(inner) : [];
        const unread = [map, top, second].find((item): item is Unread => item instanceof Unread);
        if (unread !== undefined) return unread;
        const mappings = isRecord(this.context.document['Mappings']) ? this.context.document['Mappings'] : {};
        const found = typeof map === 'string' && typeof top === 'string' && typeof second === 'string' && isRecord(mappings[map]) && isRecord(mappings[map][top]) ? mappings[map][top][second] : undefined;
        return found === undefined ? new Unread(`Fn::FindInMap finds nothing at ${[map, top, second].map(String).join('.')}`) : inner(found);
      }
      case 'Fn::ToJsonString': {
        const resolved = inner(argument);
        return JSON.stringify(resolved, (_key, item: unknown) => (item instanceof Unread ? undefined : item));
      }
      case 'Fn::Length': {
        const resolved = inner(argument);
        return Array.isArray(resolved) ? resolved.length : new Unread('Fn::Length of a list known only once the stack is deployed');
      }
      case 'Fn::Transform': {
        // `AWS::Include` of a file in the repository is read by whoever reads
        // the value - an API's body, a definition; any other macro is not.
        const resolved = inner(argument);
        const location = isRecord(resolved) && isRecord(resolved['Parameters']) ? textOf(resolved['Parameters']['Location']) : undefined;
        if (isRecord(resolved) && resolved['Name'] === 'AWS::Include' && location !== undefined) return { 'Fn::Transform': resolved };
        const macro = isRecord(resolved) ? textOf(resolved['Name']) : undefined;
        return new Unread(`${macro === undefined ? 'a macro' : `the macro ${macro}`} writes this value when the stack is deployed`);
      }
      default:
        // Fn::GetAtt, Fn::ImportValue, Fn::GetAZs, Fn::Base64, Fn::Cidr: the
        // template's own reader says what each names, or that it is unread.
        return { [fn]: inner(argument) };
    }
  }

  /**
   * `Fn::Sub` with the parameters it names written in: as text where each has
   * a value, and where one has none, as a variable of the substitution that
   * carries why, so the text built from it says which parameter it waits on.
   */
  #sub(argument: unknown, depth: number): unknown {
    const [template, written] = Array.isArray(argument) ? [argument[0], argument[1]] : [argument, undefined];
    if (typeof template !== 'string') return new Unread('Fn::Sub is not given text');
    const variables: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(isRecord(written) ? written : {})) variables[name] = this.#resolve(item, depth + 1);
    const text = template.replace(/\$\{([^}!.]+)\}/g, (whole, name: string) => {
      if (name in variables) {
        const own = variables[name];
        if (typeof own !== 'string') return whole;
        delete variables[name];
        return own;
      }
      const parameter = this.parameters.get(name);
      if (parameter === undefined) return whole;
      if (typeof parameter.value === 'string') return parameter.value;
      variables[name] = parameter.value instanceof Unread ? parameter.value : new Unread(`the parameter ${name} is a list`, name);
      return whole;
    });
    if (Object.keys(variables).length === 0) return /\$\{[^}!]+\}/.test(text) ? { 'Fn::Sub': text } : text.replace(/\$\{!/g, '${');
    return { 'Fn::Sub': [text, variables] };
  }
}

/** A loop of `Fn::ForEach` the files do not settle the collection of. */
export interface Repeated {
  readonly loop: string;
  readonly path: readonly PathStep[];
  readonly because: Unread;
}

/** The resources of a template with every loop over a settled collection written out. */
export interface Expanded {
  readonly resources: Record<string, unknown>;
  /** Where each resource a loop made is written: the loop's body. */
  readonly paths: Map<string, readonly PathStep[]>;
  readonly repeated: Repeated[];
}

/** An identifier written into a key or a text, as `${Name}` and as `&{Name}` (only its letters and digits). */
const writeIn = (text: string, identifier: string, item: string): string =>
  text.split(`\${${identifier}}`).join(item).split(`&{${identifier}}`).join(item.replace(/[^A-Za-z0-9]/g, ''));

const substitute = (value: unknown, identifier: string, item: string): unknown => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((member) => substitute(member, identifier, item));
  if (!isRecord(value)) return value;
  const intrinsic = intrinsicOf(value);
  if (intrinsic?.[0] === 'Ref' && intrinsic[1] === identifier) return item;
  if (intrinsic?.[0] === 'Fn::Sub') {
    const [template, variables] = Array.isArray(intrinsic[1]) ? intrinsic[1] : [intrinsic[1], undefined];
    const text = typeof template === 'string' ? writeIn(template, identifier, item) : template;
    return { 'Fn::Sub': variables === undefined ? text : [text, substitute(variables, identifier, item)] };
  }
  return Object.fromEntries(Object.entries(value).map(([key, member]) => [writeIn(key, identifier, item), substitute(member, identifier, item)]));
};

/**
 * `Fn::ForEach::<Loop>: [Identifier, Collection, { '${Identifier}Queue': ... }]`
 * of the language extensions, written out once per element where the
 * collection is settled; a loop over a collection that is not is said, and
 * none of what it makes is read.
 */
export const expandLoops = (resources: unknown, resolver: Resolver, at: readonly PathStep[]): Expanded => {
  const out: Expanded = { resources: {}, paths: new Map(), repeated: [] };
  const walk = (map: Record<string, unknown>, path: readonly PathStep[], depth: number): void => {
    for (const [key, value] of Object.entries(map)) {
      if (!key.startsWith('Fn::ForEach::')) {
        out.resources[key] = value;
        if (path.length > at.length) out.paths.set(key, [...path, key]);
        continue;
      }
      const [identifier, collection, body] = Array.isArray(value) ? value : [];
      const items = resolver.resolve(collection);
      if (typeof identifier !== 'string' || !isRecord(body) || !Array.isArray(items) || !items.every((item) => typeof item === 'string') || depth > 4) {
        out.repeated.push({
          loop: key.slice('Fn::ForEach::'.length),
          path: [...path, key],
          because: items instanceof Unread ? items : new Unread('its collection is known only once the stack is deployed'),
        });
        continue;
      }
      for (const item of items as string[]) walk(substitute(body, identifier, item) as Record<string, unknown>, [...path, key, 2], depth + 1);
    }
  };
  if (isRecord(resources)) walk(resources, at, 0);
  return out;
};

