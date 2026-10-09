import { methodNamedOn, packageOfSpecifier, resolveTypeOrigin, type ClassMethod, type TypeOrigin } from '@flowatlas/core';
import type { CallExpression, ClassDeclaration, Node as TsNode, Type } from 'ts-morph';
import { Node } from 'ts-morph';
import { importOf, statedOrigin } from './stated-origin.js';

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
 * Whether the method a call names is one the pattern names.
 *
 * A description may hold one spelling or several, because one verb of a
 * transport is not always one name: two clients of the same transport, or two
 * major versions of one, spell the same subscription differently and a
 * description that knows one of them reads the other as nothing (R135). The
 * shorthand is a single name and means what it always meant; the question is
 * asked here so that every reader of a pattern asks it the same way.
 */
export const methodMatches = (name: string, method: string | readonly string[]): boolean =>
  typeof method === 'string' ? method === name : method.includes(name);

/**
 * Whether the value a call is made on is the one a pattern names.
 *
 * A library is identified by the package that declares it; a bus a project wrote
 * itself has no package, so the type as written at the call site is all there is.
 * A pattern naming neither matches nothing, which is why the last answer is no
 * rather than yes: a method name alone is not evidence of anything.
 */
export const receiverMatches = (
  origin: Pick<TypeOrigin, 'package' | 'typeName'> | null,
  pattern: { receiverType?: string | readonly string[]; receiverPackages?: readonly string[] },
): boolean => {
  if (pattern.receiverType === undefined && pattern.receiverPackages === undefined) return false;
  if (origin === null) return false;
  // Both, where a pattern names both: a library declares many classes, and the
  // same method name on two of them is two different calls.
  const typeMatches =
    pattern.receiverType === undefined ||
    (typeof pattern.receiverType === 'string' ? [pattern.receiverType] : pattern.receiverType).includes(
      origin.typeName,
    );
  const packageMatches =
    pattern.receiverPackages === undefined ||
    (origin.package != null && pattern.receiverPackages.includes(origin.package));
  return typeMatches && packageMatches;
};

/**
 * How a receiver is known to be the one a pattern names, if it is.
 *
 * `checked` where the checker resolved its type, `stated` where it resolved
 * nothing and the source says what the receiver is constructed from - the case
 * of every client of a library a fresh clone has not installed. A receiver the
 * checker did resolve, to something else, is not asked a second time: the
 * source's statement is a fallback for silence, not a second opinion.
 */
export type ReceiverEvidence = 'checked' | 'stated';

export const receiverEvidence = (
  receiver: TsNode,
  pattern: { receiverType?: string | readonly string[]; receiverPackages?: readonly string[] },
): ReceiverEvidence | undefined => {
  const origin = resolveTypeOrigin(receiver);
  if (origin !== null) return receiverMatches(origin, pattern) ? 'checked' : undefined;
  return receiverMatches(statedOrigin(receiver) ?? null, pattern) ? 'stated' : undefined;
};

/**
 * How a call of a function by its name is known to be the one a pattern names.
 *
 * By the name the function is declared with, so an import that renames it is
 * still it: `checked` where the name leads to a declaration, `stated` where it
 * leads to an import nothing resolves - a helper package that is not
 * installed, named by the import alone.
 */
export const functionEvidence = (callee: TsNode, name: string): ReceiverEvidence | undefined => {
  if (!Node.isIdentifier(callee)) return undefined;
  const symbol = callee.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  const declared =
    declaration !== undefined && Node.isImportSpecifier(declaration) ? declaration.getName() : callee.getText();
  if (declared !== name) return undefined;
  const target = symbol?.getAliasedSymbol() ?? symbol;
  return (target?.getDeclarations().length ?? 0) > 0 ? 'checked' : 'stated';
};

/**
 * How a call of a function a package exports is known to be the one a pattern
 * names, if it is.
 *
 * `run(...)` imported under that name, or `orchestrator.run(...)` on anything
 * imported from the package - a namespace, a default, an object it exports.
 * The import statement says which package a binding is from whether or not
 * the package is installed, and the description says what its function does;
 * nothing is inferred from a type, so the answer is `checked`.
 */
export const moduleFunctionEvidence = (callee: TsNode, module: string, name: string): ReceiverEvidence | undefined => {
  const binding = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee;
  if (!Node.isIdentifier(binding)) return undefined;
  const imported = importOf(binding);
  if (imported === undefined) return undefined;
  if (imported.module !== module && packageOfSpecifier(imported.module) !== module) return undefined;
  const called = Node.isPropertyAccessExpression(callee) ? callee.getName() : imported.exported;
  return called === name ? 'checked' : undefined;
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
 * The type the answer to a request arrives as, where the request was made.
 *
 * Two places, and the call says which: a request that hands over a callback is
 * answered through it, so the answer is what the callback is given; any other
 * request is answered by what the call returns — `client.send<Order>(…)` is an
 * `Observable<Order>`, which the reader unwraps like any other delivery. A
 * callback declaring no parameter reads no answer, and says so by giving none.
 */
export const replyAt = (call: CallExpression, acknowledged: boolean): Type | undefined => {
  if (!acknowledged) return call.getReturnType();
  const last = call.getArguments().at(-1);
  const [signature] = last?.getType().getCallSignatures() ?? [];
  return signature?.getParameters()[0]?.getTypeAtLocation(call);
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
