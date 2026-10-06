import { DEPLOYED_FORMS, deployedArn } from '@flowatlas/aws';
import { nameWithin, type DeployedWorkflow, type Unresolved } from '@flowatlas/core';
import { attributeOf } from '../hcl/ast.js';
import { asText, type Because, type Instance, type Value } from '../eval/values.js';
import { definitionAt, Placeholders, whyNot, type Read } from './documents.js';

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
      fill: (placeholder) => {
        const value = placeholders.value(placeholder);
        return value === undefined ? undefined : addressOf(value);
      },
      meta: {
        declaredAs: instance.address,
        ...('because' in read ? {} : { definitionFrom: read.via }),
        ...(type === undefined ? {} : { type }),
      },
    },
    rows,
  };
};
