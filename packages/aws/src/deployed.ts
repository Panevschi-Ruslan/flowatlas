import { nameInForms, type DeployedKind } from '@flowatlas/core';

/**
 * The longer spellings a deployed name is written inside: an ARN, and for a
 * queue its URL.
 *
 * Three readers meet a name written this way - code handing a `QueueUrl` to the
 * SDK, a state machine definition naming the function a step invokes, and
 * Terraform pointing a subscription at a topic - and each has to arrive at the
 * name the thing is deployed under, because that is the one name all three
 * share. So the spellings are stated once, here, as regular expressions whose
 * first group is the name: source text rather than `RegExp`, because a
 * description in configuration carries forms too and is written as text.
 *
 * A region or an account left open does not change which thing is named, so
 * either may be empty. A version or an alias after a function or a state
 * machine is not part of its name. An event bus is named by everything after
 * `event-bus/`, slashes included: a partner's bus is called that way.
 */
export const DEPLOYED_FORMS: { readonly [K in DeployedKind]: readonly string[] } = {
  function: ['^arn:[^:]+:lambda:[^:]*:[^:]*:function:([^:]+)(?::[^:]+)?$'],
  workflow: ['^arn:[^:]+:states:[^:]*:[^:]*:stateMachine:([^:]+)(?::[^:]+)?$'],
  // The regional endpoint, the legacy one and a local emulator's alike.
  queue: ['^https?://[^/]+/[^/]+/([^/?#]+)/?$', '^arn:[^:]+:sqs:[^:]*:[^:]*:([^:/]+)$'],
  topic: ['^arn:[^:]+:sns:[^:]*:[^:]*:([^:/]+)$'],
  bus: ['^arn:[^:]+:events:[^:]*:[^:]*:event-bus/(.+)$'],
  table: ['^arn:[^:]+:dynamodb:[^:]*:[^:]*:table/([^/]+)$'],
  stream: ['^arn:[^:]+:kinesis:[^:]*:[^:]*:stream/([^/]+)$'],
};

/**
 * The shorter spellings Lambda's `FunctionName` also accepts, each with the
 * function's name as its first group: a partial ARN (`function:name`, or with
 * the account before it) and a name with a version or alias after it. Kept
 * apart from {@link DEPLOYED_FORMS} because outside that one parameter a
 * `name:qualifier` is not a function at all, and `deployedNameIn` must not
 * read every such pair as one.
 */
export const FUNCTION_NAME_FORMS: readonly string[] = [
  '^(?:[^:]+:)?function:([^:]+)(?::[^:]+)?$',
  '^([^:]+):[^:]+$',
];

/** A table's stream of changes, which is named by the table it belongs to. */
export const TABLE_CHANGES_FORMS: readonly string[] = ['^arn:[^:]+:dynamodb:[^:]*:[^:]*:table/([^/]+)/stream/.+$'];

/** A deployed thing an ARN or a URL names. */
export interface DeployedName {
  readonly kind: DeployedKind;
  readonly name: string;
  /** The table's stream of changes rather than the table. */
  readonly changes?: boolean;
}

/** The spellings tried for any kind, the stream of a table before the table itself. */
const ANY_KIND: ReadonlyArray<readonly [kind: DeployedKind, forms: readonly string[], changes?: boolean]> = [
  ['table', TABLE_CHANGES_FORMS, true],
  ...(Object.entries(DEPLOYED_FORMS) as [DeployedKind, readonly string[]][]),
];

/** What an ARN or URL written out names, whatever kind of thing it is. */
export const deployedNameIn = (text: string): DeployedName | undefined => {
  for (const [kind, forms, changes] of ANY_KIND) {
    const name = nameInForms(text, forms);
    if (name !== undefined) return { kind, name, ...(changes === true ? { changes } : {}) };
  }
  return undefined;
};

/**
 * The ARN of a deployed thing by its name, the region and account left open:
 * how a reader writes a name where only an ARN will do - a placeholder a
 * deployment fills, a shorter spelling made whole - so that the forms above
 * read it back.
 */
const ARN_OF: { readonly [K in DeployedKind]: (name: string) => string } = {
  function: (name) => `arn:aws:lambda:::function:${name}`,
  workflow: (name) => `arn:aws:states:::stateMachine:${name}`,
  queue: (name) => `arn:aws:sqs:::${name}`,
  topic: (name) => `arn:aws:sns:::${name}`,
  bus: (name) => `arn:aws:events:::event-bus/${name}`,
  table: (name) => `arn:aws:dynamodb:::table/${name}`,
  stream: (name) => `arn:aws:kinesis:::stream/${name}`,
};

export const deployedArn = (kind: DeployedKind, name: string): string => ARN_OF[kind](name);
