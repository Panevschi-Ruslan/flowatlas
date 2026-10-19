import { deref, parameterBehind } from '@flowatlas/core';
import type { CallExpression, Node as TsNode, ParameterDeclaration } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/** `JSON.stringify(order)` sends `order`: the serialisation is not what the body is. */
const unserialised = (value: TsNode): TsNode => {
  if (!Node.isCallExpression(value)) return value;
  const callee = value.getExpression();
  const serialises =
    Node.isPropertyAccessExpression(callee) &&
    callee.getName() === 'stringify' &&
    callee.getExpression().getText() === 'JSON';
  return serialises ? (value.getArguments()[0] ?? value) : value;
};

/** The value an object literal writes for `body`, by name or as a shorthand. */
const bodyProperty = (settings: TsNode): TsNode | undefined => {
  if (!Node.isObjectLiteralExpression(settings)) return undefined;
  const property = settings.getProperty('body');
  if (Node.isPropertyAssignment(property)) return property.getInitializer();
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  return undefined;
};

/**
 * `init.body = JSON.stringify(body)` in the function that makes the request:
 * the settings written first and the body set on them afterwards, the
 * commonest way a wrapper leaves the body off a `GET`. Read only where exactly
 * one value is ever assigned; two would be two bodies, and nothing here says
 * which one a caller sends.
 */
const bodyAssignedTo = (settings: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(settings)) return undefined;
  const symbol = settings.getSymbol();
  const scope = settings.getFirstAncestor((node) => Node.isFunctionLikeDeclaration(node));
  if (symbol === undefined || scope === undefined) return undefined;
  const assigned: TsNode[] = [];
  for (const binary of scope.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (binary.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = binary.getLeft();
    if (!Node.isPropertyAccessExpression(left) || left.getName() !== 'body') continue;
    const holder = left.getExpression();
    if (Node.isIdentifier(holder) && holder.getSymbol() === symbol) assigned.push(binary.getRight());
  }
  return assigned.length === 1 ? assigned[0] : undefined;
};

/**
 * The value a request's own settings send as its body, looked through
 * `JSON.stringify` (P128): `fetch(url, { method, body })`, the settings one
 * `const` away, or the body set on the settings variable after it is written.
 * `settings` is what the request was handed as its settings - the second
 * argument of `fetch`, or the `init` of a `new Request(url, init)`.
 */
export const bodyWrittenIn = (settings: TsNode | undefined): TsNode | undefined => {
  if (settings === undefined) return undefined;
  const written = bodyProperty(deref(settings)) ?? bodyAssignedTo(settings);
  return written === undefined ? undefined : unserialised(written);
};

/**
 * The parameter of the wrapper a request's body comes from, when it comes
 * from one: `req(method, path, body)` into `fetch(url, { method, body:
 * JSON.stringify(body) })`. The body is then only real at the callers, read
 * along the same calls as the address and the verb.
 */
export const bodyParameterOf = (call: CallExpression, init: TsNode | undefined): ParameterDeclaration | undefined => {
  const body = bodyWrittenIn(init ?? call.getArguments()[1]);
  return body === undefined ? undefined : parameterBehind(body);
};
