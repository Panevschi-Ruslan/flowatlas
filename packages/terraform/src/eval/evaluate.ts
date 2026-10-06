import type { Expression, Step, TemplatePart } from '../hcl/ast.js';
import { callFunction } from './functions.js';
import {
  asText,
  bool,
  describe,
  equal,
  failure,
  isError,
  list,
  NULL,
  num,
  object,
  str,
  unknown,
  type Instance,
  type ModuleInstance,
  type Value,
} from './values.js';

/**
 * Where an expression is evaluated: the module it is written in, and the names a
 * repeated block or a `for` expression has bound.
 */
export interface Scope {
  readonly module: ModuleInstance;
  /** `each.key` and `each.value` for a block repeated with `for_each`. */
  readonly each?: { readonly key: Value; readonly value: Value };
  /** `count.index` for a block repeated with `count`. */
  readonly count?: Value;
  /** Names a `for` expression, a dynamic block or a template file's variables bind. */
  readonly names?: ReadonlyMap<string, Value>;
  /**
   * A template file sees only the variables it was handed, never the module
   * around the call, which is what `templatefile()` promises.
   */
  readonly isolated?: boolean;
}

/** The same scope with more names bound. */
export const withNames = (scope: Scope, names: ReadonlyMap<string, Value>): Scope => ({
  ...scope,
  names: new Map([...(scope.names ?? new Map<string, Value>()), ...names]),
});

/** Keys of an object in the order Terraform iterates them: lexical. */
export const orderedKeys = (entries: ReadonlyMap<string, Value>): string[] => [...entries.keys()].sort();

const computed = (value: Extract<Value, { kind: 'ref' }>): Value =>
  unknown('computed', `${describe(value)} is known only once it has been created`);

/** A value as it appears in a template, or the unknown it stands for. */
const templated = (value: Value, at: Expression): string | Value => {
  if (value.kind === 'unknown') return value;
  if (value.kind === 'ref') return computed(value);
  const text = asText(value);
  if (text !== undefined) return text;
  if (value.kind === 'null') return failure('a template cannot hold null', at.pos);
  return failure(`a template cannot hold ${describe(value)}`, at.pos);
};

const renderParts = (parts: readonly TemplatePart[], scope: Scope): string | Value => {
  let out = '';
  for (const part of parts) {
    if (part.kind === 'text') {
      out += part.text;
      continue;
    }
    if (part.kind === 'interpolation') {
      const piece = templated(evaluate(part.expression, scope), part.expression);
      if (typeof piece !== 'string') return piece;
      out += piece;
      continue;
    }
    if (part.kind === 'if') {
      const condition = evaluate(part.condition, scope);
      if (condition.kind === 'unknown') return condition;
      if (condition.kind !== 'bool') return failure('a template condition must be true or false', part.condition.pos);
      const piece = renderParts(condition.value ? part.then : part.otherwise, scope);
      if (typeof piece !== 'string') return piece;
      out += piece;
      continue;
    }
    const collection = evaluate(part.collection, scope);
    const pairs = iterate(collection);
    if (!Array.isArray(pairs)) return pairs;
    for (const [key, value] of pairs) {
      const names = new Map<string, Value>([[part.valueName, value]]);
      if (part.keyName !== undefined) names.set(part.keyName, key);
      const piece = renderParts(part.body, withNames(scope, names));
      if (typeof piece !== 'string') return piece;
      out += piece;
    }
  }
  return out;
};

/** The key and the value of every element, in Terraform's order. */
export const iterate = (collection: Value): Array<[Value, Value]> | Value => {
  if (collection.kind === 'unknown') return collection;
  if (collection.kind === 'list') return collection.items.map((item, index) => [num(index), item]);
  if (collection.kind === 'object') {
    return orderedKeys(collection.entries).map((key) => [str(key), collection.entries.get(key) as Value]);
  }
  if (collection.kind === 'ref') return computed(collection);
  return failure(`cannot iterate over ${describe(collection)}`);
};

/** An attribute of a value. */
export const attributeOfValue = (value: Value, name: string): Value => {
  switch (value.kind) {
    case 'object':
      return value.entries.get(name) ?? failure(`no attribute ${JSON.stringify(name)}`);
    case 'instance':
      return attributeOfInstance(value.instance, name);
    case 'module':
      return value.module.output(name);
    case 'ref':
      return { kind: 'ref', target: value.target, attribute: [...value.attribute, name] };
    case 'unknown':
      return value;
    default:
      return failure(`${describe(value)} has no attribute ${JSON.stringify(name)}`);
  }
};

/**
 * An attribute of a resource.
 *
 * An argument written in its block is evaluated, because the argument is the
 * value. A nested block of that name is read as its arguments. Anything else is
 * an attribute only the provider knows - an ARN, an id - and stays a reference.
 */
export const attributeOfInstance = (instance: Instance, name: string): Value => {
  const argument = instance.module.argument(instance, name);
  if (argument !== undefined) return argument;
  const nested = instance.module.nested(instance, name);
  if (nested.length === 1) return nested[0] as Value;
  if (nested.length > 1) return list(nested);
  return { kind: 'ref', target: instance, attribute: [name] };
};

/** An element of a value, by number or by key. */
export const indexOfValue = (value: Value, key: Value): Value => {
  if (value.kind === 'instance' && value.instance.keyUnknown !== undefined) return value;
  if (value.kind === 'unknown') return value;
  if (key.kind === 'unknown') return key;
  if (value.kind === 'ref') {
    const step = key.kind === 'number' ? key.value : asText(key);
    if (step === undefined) return failure(`cannot index with ${describe(key)}`);
    return { kind: 'ref', target: value.target, attribute: [...value.attribute, step] };
  }
  if (value.kind === 'list') {
    const index = key.kind === 'number' ? key.value : Number(asText(key));
    const item = Number.isInteger(index) ? value.items[index] : undefined;
    return item ?? failure(`no element ${String(index)} in ${describe(value)}`);
  }
  if (value.kind === 'object') {
    const text = asText(key);
    if (text === undefined) return failure(`cannot index an object with ${describe(key)}`);
    return value.entries.get(text) ?? failure(`no key ${JSON.stringify(text)}`);
  }
  if (value.kind === 'instance' || value.kind === 'module') {
    return failure(`${describe(value)} is not repeated, so it cannot be indexed`);
  }
  return failure(`cannot index ${describe(value)}`);
};

const applySteps = (value: Value, steps: readonly Step[], scope: Scope): Value => {
  let current = value;
  for (const step of steps) {
    if (step.kind === 'attr') current = attributeOfValue(current, step.name);
    else current = indexOfValue(current, evaluate(step.key, scope));
  }
  return current;
};

const attrName = (step: Step | undefined): string | undefined => (step?.kind === 'attr' ? step.name : undefined);

/** A name at the start of a traversal, and the steps it consumed. */
const resolveRoot = (name: string, steps: readonly Step[], scope: Scope): { value: Value; used: number } => {
  const bound = scope.names?.get(name);
  if (bound !== undefined) return { value: bound, used: 0 };
  if (scope.isolated === true) {
    return { value: failure(`${name} is not one of the variables handed to the template`), used: 0 };
  }
  const { module } = scope;
  const first = attrName(steps[0]);
  switch (name) {
    case 'var':
      return first === undefined
        ? { value: failure('var must be followed by a name'), used: 0 }
        : { value: module.variable(first), used: 1 };
    case 'local':
      return first === undefined
        ? { value: failure('local must be followed by a name'), used: 0 }
        : { value: module.local(first), used: 1 };
    case 'path':
      if (first === 'module') return { value: str(module.pathModule), used: 1 };
      if (first === 'root' || first === 'cwd') return { value: str('.'), used: 1 };
      return { value: failure(`path.${first ?? ''} is not a path`), used: 1 };
    case 'each':
      if (scope.each === undefined) return { value: failure('each is used outside a block repeated with for_each'), used: 0 };
      if (first === 'key') return { value: scope.each.key, used: 1 };
      if (first === 'value') return { value: scope.each.value, used: 1 };
      return { value: failure('each has only key and value'), used: 0 };
    case 'count':
      if (scope.count === undefined) return { value: failure('count is used outside a block repeated with count'), used: 0 };
      return { value: scope.count, used: first === 'index' ? 1 : 0 };
    case 'module': {
      if (first === undefined) return { value: failure('module must be followed by a name'), used: 0 };
      return {
        value: module.call(first) ?? failure(`no module call named ${JSON.stringify(first)}`),
        used: 1,
      };
    }
    case 'data': {
      const type = first;
      const label = attrName(steps[1]);
      if (type === undefined || label === undefined) return { value: failure('data must be followed by a type and a name'), used: 0 };
      return {
        value: module.group('data', type, label) ?? failure(`no data block data.${type}.${label}`),
        used: 2,
      };
    }
    case 'terraform':
      return {
        value: unknown('workspace', 'terraform.workspace is chosen when the deployment is run, not in the files'),
        used: first === undefined ? 0 : 1,
      };
    case 'self':
      return { value: unknown('self', 'self is known only once the resource exists'), used: 0 };
    default: {
      if (first === undefined) return { value: failure(`${name} is not a name this module defines`), used: 0 };
      return {
        value: module.group('managed', name, first) ?? failure(`no resource ${name}.${first}`),
        used: 1,
      };
    }
  }
};

const arithmetic = (operator: string, left: Value, right: Value, at: Expression): Value => {
  const asNumber = (value: Value): number | undefined => {
    if (value.kind === 'number') return value.value;
    if (value.kind === 'string' && value.value.trim() !== '' && !Number.isNaN(Number(value.value))) return Number(value.value);
    return undefined;
  };
  const a = asNumber(left);
  const b = asNumber(right);
  if (a === undefined || b === undefined) return failure(`${operator} needs two numbers`, at.pos);
  switch (operator) {
    case '+':
      return num(a + b);
    case '-':
      return num(a - b);
    case '*':
      return num(a * b);
    case '/':
      return b === 0 ? failure('division by zero', at.pos) : num(a / b);
    case '%':
      return b === 0 ? failure('division by zero', at.pos) : num(a % b);
    case '<':
      return bool(a < b);
    case '>':
      return bool(a > b);
    case '<=':
      return bool(a <= b);
    default:
      return bool(a >= b);
  }
};

const forExpression = (expression: Extract<Expression, { type: 'for' }>, scope: Scope): Value => {
  const pairs = iterate(evaluate(expression.collection, scope));
  if (!Array.isArray(pairs)) return pairs;
  const items: Value[] = [];
  const entries = new Map<string, Value>();
  const groups = new Map<string, Value[]>();
  for (const [key, value] of pairs) {
    const names = new Map<string, Value>([[expression.valueName, value]]);
    if (expression.keyName !== undefined) names.set(expression.keyName, key);
    const inner = withNames(scope, names);
    if (expression.condition !== undefined) {
      const keep = evaluate(expression.condition, inner);
      if (keep.kind === 'unknown') return keep;
      if (keep.kind !== 'bool') return failure('a for condition must be true or false', expression.condition.pos);
      if (!keep.value) continue;
    }
    const element = evaluate(expression.value, inner);
    if (expression.result === 'tuple') {
      items.push(element);
      continue;
    }
    const keyValue = evaluate(expression.key as Expression, inner);
    if (keyValue.kind === 'unknown') return keyValue;
    const text = asText(keyValue);
    if (text === undefined) return failure('an object key must be a string', expression.pos);
    if (expression.group) {
      groups.set(text, [...(groups.get(text) ?? []), element]);
      continue;
    }
    if (entries.has(text)) return failure(`two elements have the key ${JSON.stringify(text)}`, expression.pos);
    entries.set(text, element);
  }
  if (expression.result === 'tuple') return list(items);
  if (expression.group) return object(new Map([...groups].map(([key, values]) => [key, list(values)])));
  return object(entries);
};

/**
 * Evaluates one expression.
 *
 * Never throws for something the files simply do not settle: that is an
 * `unknown`, with a reason, and the caller decides what a person is told.
 */
export const evaluate = (expression: Expression, scope: Scope): Value => {
  switch (expression.type) {
    case 'literal':
      if (expression.value === null) return NULL;
      if (typeof expression.value === 'string') return str(expression.value);
      if (typeof expression.value === 'number') return num(expression.value);
      return bool(expression.value);
    case 'template': {
      const [only] = expression.parts;
      // A template that is one interpolation and nothing else is the value of
      // that interpolation, whatever its type: `"${aws_lambda_function.x.arn}"`
      // is the reference, not a string.
      if (expression.parts.length === 1 && only?.kind === 'interpolation') return evaluate(only.expression, scope);
      const rendered = renderParts(expression.parts, scope);
      return typeof rendered === 'string' ? str(rendered) : rendered;
    }
    case 'tuple':
      return list(expression.items.map((item) => evaluate(item, scope)));
    case 'object': {
      const entries = new Map<string, Value>();
      for (const item of expression.items) {
        const key = item.key.type === 'variable' ? str(item.key.name) : evaluate(item.key, scope);
        if (key.kind === 'unknown') return key;
        const text = asText(key);
        if (text === undefined) return failure('an object key must be a string', item.key.pos);
        entries.set(text, evaluate(item.value, scope));
      }
      return object(entries);
    }
    case 'variable':
      return resolveBare(expression.name, scope);
    case 'traversal': {
      if (expression.source.type === 'variable') {
        const { value, used } = resolveRoot(expression.source.name, expression.steps, scope);
        return applySteps(value, expression.steps.slice(used), scope);
      }
      return applySteps(evaluate(expression.source, scope), expression.steps, scope);
    }
    case 'splat': {
      const source = evaluate(expression.source, scope);
      if (source.kind === 'unknown') return source;
      if (source.kind === 'null') return list([]);
      const elements = source.kind === 'list' ? source.items : [source];
      return list(elements.map((element) => applySteps(element, expression.steps, scope)));
    }
    case 'call':
      return callFunction(expression, scope, evaluate);
    case 'conditional': {
      const condition = evaluate(expression.condition, scope);
      if (condition.kind === 'unknown') return condition;
      if (condition.kind !== 'bool') return failure('a condition must be true or false', expression.condition.pos);
      return evaluate(condition.value ? expression.then : expression.otherwise, scope);
    }
    case 'unary': {
      const operand = evaluate(expression.operand, scope);
      if (operand.kind === 'unknown') return operand;
      if (expression.operator === '!') {
        return operand.kind === 'bool' ? bool(!operand.value) : failure('! needs true or false', expression.pos);
      }
      return operand.kind === 'number' ? num(-operand.value) : failure('- needs a number', expression.pos);
    }
    case 'binary': {
      const { operator } = expression;
      const left = evaluate(expression.left, scope);
      if (operator === '&&' || operator === '||') {
        if (left.kind === 'bool' && left.value === (operator === '||')) return left;
        const right = evaluate(expression.right, scope);
        if (left.kind === 'unknown') return right.kind === 'bool' && right.value === (operator === '||') ? right : left;
        if (right.kind === 'unknown') return right;
        if (left.kind !== 'bool' || right.kind !== 'bool') return failure(`${operator} needs true or false`, expression.pos);
        return bool(operator === '&&' ? left.value && right.value : left.value || right.value);
      }
      const right = evaluate(expression.right, scope);
      if (isError(left)) return left;
      if (isError(right)) return right;
      if (operator === '==' || operator === '!=') {
        const same = equal(left, right);
        if (same === undefined) return left.kind === 'unknown' ? left : right.kind === 'unknown' ? right : unknown('computed', 'one side is known only once it has been created');
        return bool(operator === '==' ? same : !same);
      }
      if (left.kind === 'unknown') return left;
      if (right.kind === 'unknown') return right;
      return arithmetic(operator, left, right, expression);
    }
    case 'for':
      return forExpression(expression, scope);
    case 'parens':
      return evaluate(expression.inner, scope);
  }
};

/** A name on its own: a bound name, or a whole object like `each`. */
const resolveBare = (name: string, scope: Scope): Value => {
  const bound = scope.names?.get(name);
  if (bound !== undefined) return bound;
  if (name === 'each' && scope.each !== undefined && scope.isolated !== true) {
    return object(new Map([['key', scope.each.key], ['value', scope.each.value]]));
  }
  if (name === 'count' && scope.count !== undefined && scope.isolated !== true) {
    return object(new Map([['index', scope.count]]));
  }
  return failure(`${name} is not a name that means anything here`);
};
