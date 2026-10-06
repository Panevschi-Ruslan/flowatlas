import { posix } from 'node:path';
import { DEPLOYED_FORMS, deployedArn } from '@flowatlas/aws';
import { nameWithin, type DefinitionPosition, type DeployedDefinition, type DeployedWorkflow, type Unresolved } from '@flowatlas/core';
import { attributeOf, type Expression, type Position, type Step, type TemplatePart } from '../hcl/ast.js';
import { HclSyntaxError, parseHclTemplate, templateText } from '../hcl/parse.js';
import { evaluate, iterate, withNames, type Scope } from '../eval/evaluate.js';
import { asText, describe, NULL, type Because, type Instance, type Value } from '../eval/values.js';

/**
 * State machines, read out of a configuration (P22).
 *
 * Each `aws_sfn_state_machine` - written directly, through a local module, or
 * through a described one - is a workflow under the name it is deployed with,
 * and its definition is handed over in the one shape a reader of definitions
 * takes: text in a format, or a value with a place for every member. The
 * definition is found by looking at how it is written rather than at what it
 * evaluates to, because what it evaluates to is usually nothing: a template
 * handed a function's ARN is a string nobody can finish until the function
 * exists.
 *
 * So every reference a definition holds is left in it as a placeholder, and the
 * workflow answers for each placeholder with the value the definition holds
 * once the deployment fills it in. A function the configuration creates is
 * named by its ARN with the region and the account left out, which is the part
 * of an ARN this reading has; a reference to anything the files do not settle
 * is answered for with nothing, and the step that uses it says so.
 */

/** Where an instance is declared, from the repository's point of view. */
const siteOf = (instance: Instance): { file: string; line: number } => {
  const at = instance.module.site ?? instance.block.pos;
  return { file: at.file, line: at.line };
};

const argument = (instance: Instance, name: string): Value | undefined => instance.module.argument(instance, name);

/** Why a value is not a string, in words for a row. */
const whyNot = (value: Value | undefined, what: string): Because => {
  if (value === undefined) return { reason: 'absent', text: `${what} is not set` };
  if (value.kind === 'unknown') return { ...value.because, text: `${what} is not known: ${value.because.text}` };
  if (value.kind === 'ref') return { reason: 'computed', text: `${what} is ${describe(value)}, known only once it has been created` };
  return { reason: 'not-a-string', text: `${what} is ${describe(value)}` };
};

// ------------------------------------------------------------------- names

/**
 * What a definition holds in place of each kind of resource it names: the
 * argument the resource is named by, and how a definition spells the name.
 *
 * One row per kind a step can reach. A function and another workflow are what
 * the linker joins on; the queue, the topic, the bus and the table are what a
 * step records about where it sends or what it writes.
 */
interface Spelling {
  readonly namedBy: string;
  readonly spell: (name: string, instance: Instance) => string | undefined;
}

const SPELLINGS: ReadonlyMap<string, Spelling> = new Map<string, Spelling>([
  ['aws_lambda_function', { namedBy: 'function_name', spell: (name) => deployedArn('function', name) }],
  [
    'aws_lambda_alias',
    {
      namedBy: 'name',
      // An alias is the function it points at, qualified.
      spell: (alias, instance) => {
        const target = argument(instance, 'function_name');
        const written = target === undefined ? undefined : (asText(target) ?? addressOf(target));
        const name = written === undefined ? undefined : nameWithin(written, DEPLOYED_FORMS.function);
        return name === undefined ? undefined : deployedArn('function', `${name}:${alias}`);
      },
    },
  ],
  ['aws_sfn_state_machine', { namedBy: 'name', spell: (name) => deployedArn('workflow', name) }],
  ['aws_sqs_queue', { namedBy: 'name', spell: (name) => deployedArn('queue', name) }],
  ['aws_sns_topic', { namedBy: 'name', spell: (name) => deployedArn('topic', name) }],
  ['aws_dynamodb_table', { namedBy: 'name', spell: (name) => deployedArn('table', name) }],
  ['aws_cloudwatch_event_bus', { namedBy: 'name', spell: (name) => deployedArn('bus', name) }],
]);

/** Attributes of a resource that address it, rather than describe it. */
const ADDRESSING = new Set(['arn', 'id', 'url', 'qualified_arn']);

/**
 * The name a resource is deployed under, when the files settle it: a function's
 * `function_name`, anything else's `name`. Created or looked up by a data
 * block, both are named by the same argument.
 */
export const deployedNameOf = (instance: Instance): string | undefined => {
  const spelling = SPELLINGS.get(instance.type);
  if (spelling === undefined) return undefined;
  const value = argument(instance, spelling.namedBy);
  return value === undefined ? undefined : asText(value);
};

/**
 * What a value is once deployed, as a definition would hold it: a string as it
 * is, and a reference to something the configuration names as that thing's
 * ARN. `undefined` for anything else, which is what nobody can know before the
 * deployment exists.
 */
export const addressOf = (value: Value): string | undefined => {
  const text = asText(value);
  if (text !== undefined) return text;
  if (value.kind !== 'ref' || value.attribute.length !== 1) return undefined;
  const [attribute] = value.attribute;
  if (typeof attribute !== 'string' || !ADDRESSING.has(attribute)) return undefined;
  const spelling = SPELLINGS.get(value.target.type);
  const name = deployedNameOf(value.target);
  return spelling === undefined || name === undefined ? undefined : spelling.spell(name, value.target);
};

// ----------------------------------------------------------- placeholders

/**
 * The placeholders a definition is handed over with, and what each stands for.
 *
 * A key is the expression as written - `check_borrower_arn`,
 * `aws_lambda_function.notify.arn` - so a row about a step that uses one quotes
 * what its author wrote. Braces and quotes are left out of it, because it has to
 * sit inside a JSON string and inside `${...}` both.
 */
class Placeholders {
  readonly #values = new Map<string, Value>();

  /** Leaves a value in the text as a placeholder, and returns the placeholder. */
  put(key: string, value: Value): string {
    const clean = key.replace(/["{}\\]/g, '');
    this.#values.set(clean, value);
    return `\${${clean}}`;
  }

  fill(key: string): string | undefined {
    const value = this.#values.get(key);
    return value === undefined ? undefined : addressOf(value);
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
type Read = { readonly definition: DeployedDefinition; readonly via: string } | { readonly because: Because };

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
const definitionAt = (written: Expression, outer: Scope, placeholders: Placeholders): Read => {
  const { expression, scope } = origin(written, outer);
  if (expression.type === 'call') {
    const reader = READERS.get(expression.name);
    if (reader !== undefined) return reader(expression, scope, placeholders);
  }
  if (expression.type === 'template') return fromTemplate(expression, scope, placeholders);
  return fromEvaluated(expression, scope);
};

// ----------------------------------------------------------------- reading

const nameRow = (instance: Instance, value: Value | undefined): Unresolved => {
  const because = whyNot(value, 'name');
  const variable = because.variable;
  return {
    ...siteOf(instance),
    reason: 'workflow-name-unread',
    message: `the name of ${instance.address} is not read: ${because.text}`,
    hint:
      instance.keyUnknown !== undefined
        ? `${instance.address} is one state machine per element of something not known here. Give the collection a value the files settle.`
        : variable === undefined
          ? 'Nothing can start a workflow whose name is not read. Write the name so the files settle it. Its steps are still drawn.'
          : because.files === undefined
            ? `Give var.${variable}${because.module ? ` of ${because.module}` : ''} a value the files settle: a default, or a variable file. Its steps are still drawn.`
            : `The variable files set var.${variable} differently; choose one under services[].infra.vars. Its steps are still drawn.`,
    symbol: instance.address,
    meta: { because: because.reason, ...(variable === undefined ? {} : { variable }) },
  };
};

const definitionRow = (instance: Instance, because: Because): Unresolved => ({
  ...siteOf(instance),
  reason: 'workflow-definition-not-loaded',
  message: `the definition of ${instance.address} is not read: ${because.text}`,
  hint:
    because.variable === undefined
      ? 'Nothing of this workflow is drawn. A definition is read when it is written with file(), templatefile(), jsonencode() or a heredoc, with a path the files settle.'
      : `Give var.${because.variable} a value the files settle. Nothing of this workflow is drawn until then.`,
  symbol: instance.address,
  meta: { because: because.reason },
});

/** One state machine, as the workflow it deploys and the rows its reading raised. */
export const readStateMachineInstance = (instance: Instance): { workflow: DeployedWorkflow; rows: Unresolved[] } => {
  const rows: Unresolved[] = [];
  const nameValue = argument(instance, 'name');
  const name = nameValue === undefined ? undefined : asText(nameValue);
  if (name === undefined) rows.push(nameRow(instance, nameValue));

  const placeholders = new Placeholders();
  const attribute = attributeOf(instance.block.body, 'definition');
  const read: Read =
    attribute === undefined
      ? { because: { reason: 'absent', text: 'definition is not set' } }
      : definitionAt(attribute.expression, instance.module.scopeOf(instance), placeholders);
  if ('because' in read) rows.push(definitionRow(instance, read.because));

  const typeValue = argument(instance, 'type');
  const type = typeValue === undefined ? undefined : asText(typeValue);
  return {
    workflow: {
      ...siteOf(instance),
      ...(name === undefined ? {} : { name }),
      address: instance.address,
      ...('because' in read ? {} : { definition: read.definition }),
      fill: (placeholder) => placeholders.fill(placeholder),
      meta: {
        declaredAs: instance.address,
        ...('because' in read ? {} : { definitionFrom: read.via }),
        ...(type === undefined ? {} : { type }),
      },
    },
    rows,
  };
};
