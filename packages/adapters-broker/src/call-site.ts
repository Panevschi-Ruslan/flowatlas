import { methodNamedOn, resolveTypeOrigin, type ClassMethod, type TypeOrigin } from '@flowatlas/core';
import type { ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';

/**
 * Reading one publishing or subscribing call site.
 *
 * These three questions are asked wherever a transport is read, and a transport
 * whose two ends live in different repositories is read from two extractors: a
 * gateway publishing in a service and a browser publishing to it are the same
 * call shape and deserve the same answer. Keeping the questions here is what
 * lets the second reader be a description rather than a second implementation.
 */

/**
 * Whether the value a call is made on is the one a pattern names.
 *
 * A library is identified by the package that declares it; a bus a project wrote
 * itself has no package, so the type as written at the call site is all there is.
 * A pattern naming neither matches nothing, which is why the last answer is no
 * rather than yes: a method name alone is not evidence of anything.
 */
export const receiverMatches = (
  origin: TypeOrigin | null,
  pattern: { receiverType?: string | readonly string[]; receiverPackages?: readonly string[] },
): boolean => {
  if (pattern.receiverType !== undefined) {
    const names =
      typeof pattern.receiverType === 'string' ? [pattern.receiverType] : pattern.receiverType;
    return origin !== null && names.includes(origin.typeName);
  }
  if (pattern.receiverPackages !== undefined) {
    return origin?.package != null && pattern.receiverPackages.includes(origin.package);
  }
  return false;
};

/** The same question asked of the expression rather than of its resolved origin. */
export const receiverIsFrom = (
  receiver: TsNode,
  pattern: { receiverType?: string | readonly string[]; receiverPackages?: readonly string[] },
): boolean => receiverMatches(resolveTypeOrigin(receiver), pattern);

/**
 * Whether a publishing call hands over somewhere to send the answer.
 *
 * A socket's `emit` takes an optional last argument, and passing one changes
 * what the call is: a publish expects nothing back, while a publish with a
 * callback is a request waiting for a reply and belongs on the graph as one.
 * Only the last argument counts, because every earlier one is payload — a
 * payload that happens to hold a function is still payload.
 *
 * A callback written at the call site is the usual shape; one passed by name is
 * asked of the checker instead, because `emit(name, body, this.onReply)` is the
 * same request and only the spelling differs.
 */
export const hasAcknowledgement = (args: readonly TsNode[]): boolean => {
  const last = args[args.length - 1];
  if (last === undefined) return false;
  if (Node.isArrowFunction(last) || Node.isFunctionExpression(last)) return true;
  return last.getType().getCallSignatures().length > 0;
};

/**
 * The method a listener ultimately runs.
 *
 * A handler that does exactly one thing is really an alias for that thing, and
 * pointing the chain at it is what a reader wants. A handler that does several
 * is its own step, and saying so beats picking one of them.
 */
export const targetOfHandler = (
  handler: TsNode,
  owner: ClassDeclaration,
): ClassMethod | undefined => {
  const body =
    Node.isArrowFunction(handler) || Node.isFunctionExpression(handler)
      ? handler.getBody()
      : undefined;
  if (body === undefined) return undefined;
  const called: ClassMethod[] = [];
  // A concise arrow body is the call itself, not a descendant of one.
  const visit = (node: TsNode): void => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    if (!Node.isThisExpression(callee.getExpression())) return;
    // A consumer that delegates to `this.handle()`, where `handle` may be a
    // field holding an arrow — which is how a handler keeps its `this` (R29).
    const found = methodNamedOn(owner, callee.getName());
    if (found !== undefined) called.push(found);
  };
  visit(body);
  body.forEachDescendant(visit);
  const unique = [...new Set(called)];
  return unique.length === 1 ? unique[0] : undefined;
};
