import { Node, type CallExpression, type Node as TsNode } from 'ts-morph';
import type { HttpClientConfig } from '../config.js';
import { resolveTypeOrigin } from '../origin.js';
import { callsHelper } from '../request.js';
import { evaluateExpression } from '../static-value.js';
import { statedOrigin } from '../stated-origin.js';
import { conditionsHold } from './conditions.js';
import { locatedExpressions } from './locator.js';

/**
 * Requests sent through a client of the project's own, as configuration
 * describes them (`adapters.http.clients`, P121).
 *
 * One matcher for every reader: the server reader's request pass and both
 * browser readers ask it the same question of a call - is this one of the
 * described clients, and where are its verb, its address and its body - and
 * each draws the answer the way it draws every other request. The reading of
 * an address stays the reader's own, because each already has one, and a
 * second here would be the one that stopped agreeing.
 */

/** The verbs a method may be named after, by the name. */
const VERB_NAMES: ReadonlyMap<string, string> = new Map([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['del', 'DELETE'],
  ['head', 'HEAD'],
  ['options', 'OPTIONS'],
]);

/** A word that is an HTTP verb, in its canonical spelling; undefined for any other word. */
export const httpVerbOf = (word: string): string | undefined => VERB_NAMES.get(word.toLowerCase());

/**
 * How a call is known to be the described client's: `checked` where the
 * checker resolved the receiver's type or the function, `stated` where only
 * the source's own statement of it was read - an annotation or a construction
 * naming a class nobody installed.
 */
export type DescribedEvidence = 'checked' | 'stated';

/** One described client a call matched, and what of it was read there. */
export interface DescribedRequest {
  readonly client: HttpClientConfig;
  readonly evidence: DescribedEvidence;
  /** Where the address is written, when the call writes it where the description says. */
  readonly url: TsNode | undefined;
  /** Where the body is written, when the description says and the call writes it. */
  readonly body: TsNode | undefined;
  /** The verb, read; null where it is written and cannot be read, or nowhere a verb is said. */
  readonly verb: string | null;
}

const listOf = (value: string | readonly string[] | undefined): readonly string[] =>
  value === undefined ? [] : typeof value === 'string' ? [value] : value;

/** The call a value was made by: itself, or what a `const` was initialised with. */
const madeByCall = (value: TsNode): CallExpression | undefined => {
  let at: TsNode = value;
  for (let step = 0; step < 4; step += 1) {
    if (Node.isParenthesizedExpression(at) || Node.isAwaitExpression(at) || Node.isNonNullExpression(at)) {
      at = at.getExpression();
      continue;
    }
    if (Node.isCallExpression(at)) return at;
    if (!Node.isIdentifier(at)) return undefined;
    const declaration = at.getSymbol()?.getDeclarations()[0];
    const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
    if (initializer === undefined) return undefined;
    at = initializer;
  }
  return undefined;
};

/** How a receiver is the one a description names, if it is. */
const receiverEvidence = (receiver: TsNode, client: HttpClientConfig): DescribedEvidence | undefined => {
  if (client.factory !== undefined) {
    const made = madeByCall(receiver);
    return made !== undefined && callsHelper(made, { name: client.factory, package: client.module }) ? 'checked' : undefined;
  }
  const types = listOf(client.receiverType);
  if (types.length === 0) return undefined;
  const origin = resolveTypeOrigin(receiver);
  if (origin !== null) return types.includes(origin.typeName) ? 'checked' : undefined;
  const stated = statedOrigin(receiver);
  return stated !== undefined && types.includes(stated.typeName) ? 'stated' : undefined;
};

/** How a call is the described client's, if it is. */
const evidenceOf = (call: CallExpression, client: HttpClientConfig): DescribedEvidence | undefined => {
  const callee = call.getExpression();
  if (client.function !== undefined) {
    return callsHelper(call, { name: client.function, package: client.module }) ? 'checked' : undefined;
  }
  if (!Node.isPropertyAccessExpression(callee) || !listOf(client.method).includes(callee.getName())) return undefined;
  return receiverEvidence(callee.getExpression(), client);
};

/** The verb a call sends, as its description says to read it. */
const verbOf = (call: CallExpression, client: HttpClientConfig): string | null => {
  if (client.verb !== undefined) return httpVerbOf(client.verb) ?? client.verb.toUpperCase();
  if (client.verbAt !== undefined) {
    const [written] = locatedExpressions(call, client.verbAt);
    if (written === undefined) return null;
    const value = evaluateExpression(written);
    return value.resolved && typeof value.value === 'string' ? (httpVerbOf(value.value) ?? null) : null;
  }
  const callee = call.getExpression();
  const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : client.function ?? '';
  return httpVerbOf(name) ?? null;
};

/** What one described client reads at a call it matched. */
const readAt = (call: CallExpression, client: HttpClientConfig, evidence: DescribedEvidence): DescribedRequest => ({
  client,
  evidence,
  url: locatedExpressions(call, client.url)[0],
  body: client.body === undefined ? undefined : locatedExpressions(call, client.body)[0],
  verb: verbOf(call, client),
});

/**
 * Every described client a call is, in the order configuration lists them.
 *
 * All of them rather than the first, because two that match one call is a
 * fact the reader reports: a description written by hand wins over a
 * compiled pattern, and two patterns on one call are ambiguous and neither is
 * read (P121). A description whose conditions the call does not meet is not
 * matched at all.
 */
export const describedRequestsAt = (
  call: CallExpression,
  clients: readonly HttpClientConfig[],
): DescribedRequest[] =>
  clients.flatMap((client) => {
    const evidence = evidenceOf(call, client);
    if (evidence === undefined || !conditionsHold(call, client.where)) return [];
    return [readAt(call, client, evidence)];
  });
