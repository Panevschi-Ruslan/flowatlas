import { posix } from 'node:path';
import type { DefinitionPosition, DeployedDefinition } from '@flowatlas/core';
import type { Expression, Position, Step, TemplatePart } from '../hcl/ast.js';
import { HclSyntaxError, parseHclTemplate, templateText } from '../hcl/parse.js';
import { evaluate, iterate, withNames, type Scope } from '../eval/evaluate.js';
import { asText, describe, NULL, str, unknown, type Because, type Value } from '../eval/values.js';
import { HOLE } from './arguments.js';

/**
 * A document a resource is handed: a state machine's definition (P22), an API's
 * OpenAPI body (R174).
 *
 * Both are found by looking at how they are written rather than at what they
 * evaluate to, because what they evaluate to is usually nothing: a template
 * handed a function's ARN is a string nobody can finish until the function
 * exists. So every value a document holds that is not text is left in it as a
 * placeholder, and the reader of the document asks the placeholders what each
 * one stands for. What a placeholder means - an ARN a step invokes, the
 * function an integration names - is the reader's business, not this module's.
 */

/** Why a value is not a string, in words for a row. */
export const whyNot = (value: Value | undefined, what: string): Because => {
  if (value === undefined) return { reason: 'absent', text: `${what} is not set` };
  if (value.kind === 'unknown') return { ...value.because, text: `${what} is not known: ${value.because.text}` };
  if (value.kind === 'ref') return { reason: 'computed', text: `${what} is ${describe(value)}, known only once it has been created` };
  return { reason: 'not-a-string', text: `${what} is ${describe(value)}` };
};

// ----------------------------------------------------------- placeholders

/**
 * The placeholders a document is handed over with, and what each stands for.
 *
 * A key is the expression as written - `check_borrower_arn`,
 * `aws_lambda_function.notify.arn` - so a row about a member that uses one
 * quotes what its author wrote. Braces and quotes are left out of it, because it
 * has to sit inside a JSON string and inside `${...}` both.
 */
export class Placeholders {
  readonly #values = new Map<string, Value>();

  /** Leaves a value in the text as a placeholder, and returns the placeholder. */
  put(key: string, value: Value): string {
    const clean = key.replace(/["{}\\]/g, '');
    this.#values.set(clean, value);
    return `\${${clean}}`;
  }

  /** What one placeholder stands for. */
  value(key: string): Value | undefined {
    return this.#values.get(key);
  }

  /** Each placeholder of this reading in a text, with where it starts and ends. */
  #within(text: string): { key: string; from: number; to: number }[] {
    return [...text.matchAll(/\$\{([^}]*)\}/g)]
      .filter((match) => this.#values.has(match[1] as string))
      .map((match) => ({ key: match[1] as string, from: match.index, to: match.index + match[0].length }));
  }

  /**
   * A member of the document as a value: what its placeholder stands for when
   * it is one and nothing else, the text when it holds none, and unknown when it
   * is text around one - which is a string nobody can finish yet.
   */
  valueIn(text: string): Value {
    const found = this.#within(text);
    const [only] = found;
    if (only === undefined) return str(text);
    if (found.length === 1 && only.from === 0 && only.to === text.length) return this.#values.get(only.key) as Value;
    const filled = this.textIn(text);
    return unknown('computed', `${JSON.stringify(filled.replaceAll(HOLE, '…'))} holds values known only once the deployment has been created`);
  }

  /** The text of a member, each placeholder that stands for text filled in and every other one a {@link HOLE}. */
  textIn(text: string): string {
    let out = '';
    let at = 0;
    for (const { key, from, to } of this.#within(text)) {
      out += text.slice(at, from) + (asText(this.#values.get(key) as Value) ?? HOLE);
      at = to;
    }
    return out + text.slice(at);
  }

  /** What every placeholder in a member stands for, each on its own. */
  referencesIn(text: string): Value[] {
    return this.#within(text).map(({ key }) => this.#values.get(key) as Value);
  }
}

const stepText = (step: Step): string => {
  if (step.kind === 'attr') return `.${step.name}`;
  return `[${spell(step.key)}]`;
};

/** An expression as its author wrote it, near enough to recognise. */
const spell = (expression: Expression): string => {
  switch (expression.type) {
    case 'variable':
      return expression.name;
    case 'parens':
      return spell(expression.inner);
    case 'literal':
      return String(expression.value);
    case 'traversal':
      return `${spell(expression.source)}${expression.steps.map(stepText).join('')}`;
    case 'splat':
      return `${spell(expression.source)}[*]${expression.steps.map(stepText).join('')}`;
    case 'call':
      return `${expression.name}(${expression.args.map(spell).join(', ')})`;
    case 'template':
      return templateText(expression) ?? `…@${expression.pos.line}:${expression.pos.column}`;
    default:
      return `…@${expression.pos.line}:${expression.pos.column}`;
  }
};

// ---------------------------------------------------------------- origins

/**
 * Where a value is written, followed through every variable and local that
 * only hands it on: `definition = var.definition` in a module is whatever the
 * call wrote for `definition`, in the scope the call was written in.
 */
const origin = (expression: Expression, scope: Scope, depth = 0): { expression: Expression; scope: Scope } => {
  if (depth > 32) return { expression, scope };
  if (expression.type === 'parens') return origin(expression.inner, scope, depth + 1);
  // `"${var.definition}"` is the value of the interpolation, whatever its type.
  const [only] = expression.type === 'template' ? expression.parts : [];
  if (expression.type === 'template' && expression.parts.length === 1 && only?.kind === 'interpolation') {
    return origin(only.expression, scope, depth + 1);
  }
  if (expression.type !== 'traversal' || expression.source.type !== 'variable' || scope.isolated === true) {
    return { expression, scope };
  }
  const kind = expression.source.name;
  const [step, ...rest] = expression.steps;
  if ((kind !== 'var' && kind !== 'local') || step?.kind !== 'attr' || rest.length > 0) return { expression, scope };
  const written = scope.module.written(kind, step.name);
  return written === undefined ? { expression, scope } : origin(written.expression, written.scope, depth + 1);
};

// -------------------------------------------------------------- templates

/**
 * A template rendered as text, with every interpolation that is not text left
 * in it as a placeholder.
 *
 * A directive is rendered as Terraform renders it, where its condition or its
 * collection is known; where it is not, nobody can say which text the
 * definition holds, and the definition is not read.
 */
const render = (parts: readonly TemplatePart[], scope: Scope, placeholders: Placeholders): string | Because => {
  let out = '';
  for (const part of parts) {
    if (part.kind === 'text') {
      out += part.text;
    } else if (part.kind === 'interpolation') {
      out += splice(part.expression, scope, placeholders);
    } else if (part.kind === 'if') {
      const condition = evaluate(part.condition, scope);
      if (condition.kind !== 'bool') return whyNot(condition, `the condition ${spell(part.condition)}`);
      const inner = render(condition.value ? part.then : part.otherwise, scope, placeholders);
      if (typeof inner !== 'string') return inner;
      out += inner;
    } else {
      const pairs = iterate(evaluate(part.collection, scope));
      if (!Array.isArray(pairs)) return whyNot(pairs, `the collection ${spell(part.collection)}`);
      for (const [key, value] of pairs) {
        const names = new Map<string, Value>([[part.valueName, value]]);
        if (part.keyName !== undefined) names.set(part.keyName, key);
        const inner = render(part.body, withNames(scope, names), placeholders);
        if (typeof inner !== 'string') return inner;
        out += inner;
      }
    }
  }
  return out;
};

/** One interpolation, as text where it is text and as a placeholder where it is not. */
const splice = (expression: Expression, scope: Scope, placeholders: Placeholders): string => {
  const value = evaluate(expression, scope);
  const text = asText(value);
  if (text !== undefined) return text;
  // `${jsonencode(aws_lambda_function.x.arn)}` writes the reference as a JSON
  // string, quotes and all, so the placeholder goes between quotes.
  const [inner] = expression.type === 'call' && expression.name === 'jsonencode' ? expression.args : [];
  if (inner !== undefined) return `"${placeholders.put(spell(inner), evaluate(inner, scope))}"`;
  return placeholders.put(spell(expression), value);
};

// -------------------------------------------------------------- documents

const keyOf = (path: readonly (string | number)[]): string => JSON.stringify(path);

/**
 * A value built with the expression language, as plain JSON with a placeholder
 * wherever a member is not known yet, and the place of every member written as
 * an object or a list in place.
 */
const documentOf = (
  written: Expression,
  outer: Scope,
  placeholders: Placeholders,
  path: readonly (string | number)[],
  positions: Map<string, Position>,
): unknown => {
  const { expression, scope } = origin(written, outer);
  // `"${module.loans.lambda_function_arn}:live"` is a string with a placeholder
  // in it, not a placeholder for the whole string.
  if (expression.type === 'template') {
    const rendered = render(expression.parts, scope, placeholders);
    if (typeof rendered === 'string') return rendered;
  }
  if (expression.type === 'object') {
    const out: Record<string, unknown> = {};
    for (const item of expression.items) {
      const key = item.key.type === 'variable' ? item.key.name : asText(evaluate(item.key, scope));
      if (key === undefined) continue;
      const inner = [...path, key];
      positions.set(keyOf(inner), item.key.pos);
      out[key] = documentOf(item.value, scope, placeholders, inner, positions);
    }
    return out;
  }
  if (expression.type === 'tuple') {
    return expression.items.map((item, index) => {
      const inner = [...path, index];
      positions.set(keyOf(inner), item.pos);
      return documentOf(item, scope, placeholders, inner, positions);
    });
  }
  return jsonOf(evaluate(expression, scope), spell(written), placeholders);
};

const jsonOf = (value: Value, key: string, placeholders: Placeholders): unknown => {
  switch (value.kind) {
    case 'string':
    case 'number':
    case 'bool':
      return value.value;
    case 'null':
      return null;
    case 'list':
      return value.items.map((item, index) => jsonOf(item, `${key}[${index}]`, placeholders));
    case 'object':
      return Object.fromEntries(
        [...value.entries.keys()].sort().map((name) => [name, jsonOf(value.entries.get(name) as Value, `${key}.${name}`, placeholders)]),
      );
    default:
      return placeholders.put(key, value);
  }
};

// ------------------------------------------------------------ definitions

/** The definition, or why it could not be read, and how it was written. */
export type Read = { readonly definition: DeployedDefinition; readonly via: string } | { readonly because: Because };

type Reader = (call: Extract<Expression, { type: 'call' }>, scope: Scope, placeholders: Placeholders) => Read;

/** A path as a function of the configuration reads it, from the root module's directory. */
const repoPath = (scope: Scope, path: string): string => {
  const rootDir = (scope.module.root ?? scope.module).dir;
  return posix.normalize(posix.join(rootDir === '' ? '.' : rootDir, path)).replace(/^\.\//, '');
};

/** The format a file is written in, by its name: YAML when it says so, JSON otherwise. */
const formatOf = (path: string): 'json' | 'yaml' => (/\.ya?ml(?:\.(?:tftpl|tpl))?$/.test(path) ? 'yaml' : 'json');

/** The path a function is handed, read. */
const pathArgument = (call: Extract<Expression, { type: 'call' }>, scope: Scope): string | Because => {
  const [first] = call.args;
  const value = first === undefined ? undefined : evaluate(first, scope);
  const path = value === undefined ? undefined : asText(value);
  return path ?? whyNot(value, `the path handed to ${call.name}()`);
};

/** `file("loan-approval.asl.json")`: the file, as it is. */
const fromFile: Reader = (call, scope) => {
  const path = pathArgument(call, scope);
  if (typeof path !== 'string') return { because: path };
  const text = scope.module.readFile(path);
  if (text === undefined) return { because: { reason: 'missing', text: `there is no file at ${repoPath(scope, path)}` } };
  return { definition: { kind: 'text', file: repoPath(scope, path), text, format: formatOf(path), firstLine: 1 }, via: 'file' };
};

/**
 * `templatefile("loan-approval.asl.json", { ... })`: the template rendered with
 * the variables it is handed, each one that is not text left as a placeholder.
 */
const fromTemplateFile: Reader = (call, scope, placeholders) => {
  const path = pathArgument(call, scope);
  if (typeof path !== 'string') return { because: path };
  const [, varsArgument] = call.args;
  const vars = varsArgument === undefined ? NULL : evaluate(varsArgument, scope);
  if (vars.kind !== 'object' && vars.kind !== 'null') return { because: whyNot(vars, 'the variables handed to templatefile()') };
  const file = repoPath(scope, path);
  const text = scope.module.readFile(path);
  if (text === undefined) return { because: { reason: 'missing', text: `there is no template at ${file}` } };
  let template: Expression;
  try {
    template = parseHclTemplate(text, file);
  } catch (error) {
    if (!(error instanceof HclSyntaxError)) throw error;
    return { because: { reason: 'template-unparsed', text: `the template ${file} does not parse at line ${error.line}: ${error.reason}` } };
  }
  const names = vars.kind === 'object' ? vars.entries : new Map<string, Value>();
  const parts = template.type === 'template' ? template.parts : [];
  const rendered = render(parts, { module: scope.module, names, isolated: true }, placeholders);
  if (typeof rendered !== 'string') return { because: rendered };
  return { definition: { kind: 'text', file, text: rendered, format: formatOf(path), firstLine: 1 }, via: 'templatefile' };
};

/** Functions that only turn text into a value, which a document read as text already is. */
const DECODERS: ReadonlyMap<string, 'json' | 'yaml'> = new Map([
  ['jsondecode', 'json'],
  ['yamldecode', 'yaml'],
]);

/**
 * `jsonencode({ ... })`: the value, built in place, with the place of every
 * state where the object is written out. `jsonencode(yamldecode(file(...)))` is
 * the file, read in the format the decoder names.
 */
const fromJsonencode: Reader = (call, scope, placeholders) => {
  const [argument] = call.args;
  if (argument === undefined) return { because: { reason: 'absent', text: 'jsonencode() is handed nothing' } };
  const { expression, scope: inner } = origin(argument, scope);
  const [decoded] = expression.type === 'call' && DECODERS.has(expression.name) ? expression.args : [];
  if (expression.type === 'call' && decoded !== undefined) {
    const read = definitionAt(decoded, inner, placeholders);
    if ('because' in read || read.definition.kind !== 'text') return read;
    const format = DECODERS.get(expression.name) as 'json' | 'yaml';
    return { definition: { ...read.definition, format }, via: `${read.via} through ${expression.name}` };
  }
  const positions = new Map<string, Position>();
  const value = documentOf(argument, scope, placeholders, [], positions);
  const file = call.pos.file;
  const at = (path: readonly (string | number)[]): DefinitionPosition => {
    // The nearest member written in this file, and the call itself above them all.
    for (let length = path.length; length >= 0; length -= 1) {
      const found = positions.get(keyOf(path.slice(0, length)));
      if (found !== undefined && found.file === file) return { line: found.line, column: found.column };
    }
    return { line: call.pos.line, column: call.pos.column };
  };
  return { definition: { kind: 'value', file, value, at }, via: 'jsonencode' };
};

const READERS: ReadonlyMap<string, Reader> = new Map([
  ['file', fromFile],
  ['templatefile', fromTemplateFile],
  ['jsonencode', fromJsonencode],
]);

/**
 * A document written in place: a heredoc, or a quoted string. The text starts on
 * the line after a heredoc's marker, and on the string's own line otherwise.
 */
const fromTemplate = (expression: Extract<Expression, { type: 'template' }>, scope: Scope, placeholders: Placeholders): Read => {
  const rendered = render(expression.parts, scope, placeholders);
  if (typeof rendered !== 'string') return { because: rendered };
  const firstLine = expression.heredoc === true ? expression.pos.line + 1 : expression.pos.line;
  return {
    definition: { kind: 'text', file: expression.pos.file, text: rendered, format: 'json', firstLine },
    via: expression.heredoc === true ? 'heredoc' : 'string',
  };
};

/** Anything else: the value, when it is a string of JSON, placed where it is written. */
const fromEvaluated = (expression: Expression, scope: Scope): Read => {
  const value = evaluate(expression, scope);
  const text = asText(value);
  if (text === undefined) return { because: whyNot(value, `the definition ${spell(expression)}`) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { because: { reason: 'not-json', text: `the definition ${spell(expression)} is a string that is not JSON` } };
  }
  const at = (): DefinitionPosition => ({ line: expression.pos.line, column: expression.pos.column });
  return { definition: { kind: 'value', file: expression.pos.file, value: parsed, at }, via: 'value' };
};

/** The definition an expression writes, by how it writes it. */
export const definitionAt = (written: Expression, outer: Scope, placeholders: Placeholders): Read => {
  const { expression, scope } = origin(written, outer);
  if (expression.type === 'call') {
    const reader = READERS.get(expression.name);
    if (reader !== undefined) return reader(expression, scope, placeholders);
  }
  if (expression.type === 'template') return fromTemplate(expression, scope, placeholders);
  return fromEvaluated(expression, scope);
};

