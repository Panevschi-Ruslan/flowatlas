import type { Unresolved } from '@flowatlas/core';
import { attributeOf } from '../hcl/ast.js';
import { referencesIn } from '../hcl/walk.js';
import { evaluate } from '../eval/evaluate.js';
import { asText, describe, type Because, type Instance, type Value } from '../eval/values.js';

/**
 * Asking a resource for its arguments, the way every reader of a resource type
 * asks: what one evaluates to, the text it is, why it is not text, and every
 * reference written inside it.
 */

/** Where an instance is declared from the repository's point of view. */
export const siteOf = (instance: Instance): { file: string; line: number } => {
  const at = instance.module.site ?? instance.block.pos;
  return { file: at.file, line: at.line };
};

export const argument = (instance: Instance, name: string): Value | undefined => instance.module.argument(instance, name);

export const textOf = (value: Value | undefined): string | undefined => (value === undefined ? undefined : asText(value));

/** Why a value is not a string, as a `Because`. */
export const whyNot = (value: Value | undefined, what: string): Because => {
  if (value === undefined) return { reason: 'absent', text: `${what} is not set` };
  if (value.kind === 'unknown') return value.because;
  if (value.kind === 'ref') return { reason: 'computed', text: `${what} is ${describe(value)}, known only once it has been created` };
  return { reason: 'not-a-string', text: `${what} is ${describe(value)}` };
};

/**
 * Every reference written inside an argument, each evaluated on its own.
 *
 * `"arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${aws_lambda_function.x.arn}/invocations"`
 * is a string nobody can finish, and it names a function as plainly as an
 * argument that is only the reference. Asking each reference separately is how
 * the function is still found.
 */
export const referencesOf = (instance: Instance, name: string): Value[] => {
  const attribute = attributeOf(instance.block.body, name);
  if (attribute === undefined) return [];
  const scope = instance.module.scopeOf(instance);
  return [...referencesIn(attribute.expression)].map((reference) => evaluate(reference, scope));
};

/** What stands in a text for a part of it nobody can know from the files. */
export const HOLE = '\u0001';

/**
 * An argument written as a string template, with every part that does not
 * evaluate standing as {@link HOLE}.
 *
 * `"arn:aws:sqs:${var.region}:${local.account}:library-returns"` names its
 * queue in the part that is written out, and the region and the account it
 * cannot read do not change which queue it is. A reader matches the text
 * against a spelling whose name group must not contain a hole, so a name is
 * only ever read out of what was written (I3). Anything but a template - a
 * reference, a call - has no text to give.
 */
export const textWithHoles = (instance: Instance, name: string): string | undefined => {
  const attribute = attributeOf(instance.block.body, name);
  if (attribute === undefined || attribute.expression.type !== 'template') return undefined;
  const scope = instance.module.scopeOf(instance);
  let out = '';
  for (const part of attribute.expression.parts) {
    if (part.kind === 'text') out += part.text;
    else if (part.kind === 'interpolation') out += textOf(evaluate(part.expression, scope)) ?? HOLE;
    else out += HOLE;
  }
  return out;
};

/** A nested block, or an argument written as an object in its place: the first of either. */
export const blockOrArgument = (instance: Instance, name: string): Value | undefined =>
  argument(instance, name) ?? instance.module.nested(instance, name)[0];

/** A key of an object value. */
export const entryOf = (value: Value | undefined, key: string): Value | undefined =>
  value?.kind === 'object' ? value.entries.get(key) : value?.kind === 'list' && value.items[0]?.kind === 'object' ? value.items[0].entries.get(key) : undefined;

/**
 * The row for something a reading needed a name for and could not read.
 *
 * One shape for every kind of declaration, so a reader sees the same advice
 * whether the name was a queue's, a rule's or a function's: a disputed variable
 * names the files and says how to choose, any other variable says what to set.
 */
export const unreadRow = (
  instance: Instance,
  reason: string,
  what: string,
  because: Because,
  level?: Unresolved['level'],
): Unresolved => ({
  ...siteOf(instance),
  reason,
  ...(level === undefined ? {} : { level }),
  message: `${what} is not read: ${because.text}`,
  hint:
    because.reason === 'variable-disputed'
      ? `var.${because.variable ?? '?'} is set differently by ${Object.keys(because.files ?? {}).join(' and ')}. Choose the environment to read under services[].infra.vars.`
      : because.reason === 'unplaced'
        ? 'It is read, and it is not a function, a workflow, a queue, a topic, a bus or a stream, so nothing is drawn past it. Nothing to fix unless it is one of those written in a form not recognised.'
        : because.variable === undefined
        ? 'Write it so the files settle it - a literal, or a reference to what the configuration declares.'
        : `Give var.${because.variable}${because.module ? ` of ${because.module}` : ''} a value the files settle: a default, or a variable file.`,
  symbol: instance.address,
  meta: {
    because: because.reason,
    ...(because.variable === undefined ? {} : { variable: because.variable }),
    ...(because.files === undefined ? {} : { files: because.files }),
  },
});
