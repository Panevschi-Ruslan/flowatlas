import { memberFunction, namedFunction, objectMemberFunction, originOfValue, type NamedFunction } from '@flowatlas/core';
import type { Identifier, Node as TsNode, PropertyAccessExpression } from 'ts-morph';
import { Node } from 'ts-morph';

/**
 * The two ways a call names a function of this repository rather than a method,
 * written once for every walk that follows one.
 */

/** `send()`: the function a bare name stands for, when it is one written here. */
export const functionNamedBy = (name: Identifier): NamedFunction | undefined => {
  const origin = originOfValue(name);
  return origin.kind === 'local' ? namedFunction(origin.declaration) : undefined;
};

/**
 * `commands.myOrders()` on `export const commands = { myOrders: … }`: a module of
 * functions spelled as an object, which names one of them as surely as a call by
 * name does. And `functions.notify()` on `import * as functions`, the module
 * itself, whose member is the function it declares (R175).
 */
export const memberFunctionCalled = (access: PropertyAccessExpression): NamedFunction | undefined => {
  const receiver = access.getExpression();
  // `this.getPrice()` in a method of an object written whole is a call of the
  // object's own member, which the checker names (P276).
  if (Node.isThisExpression(receiver)) return thisMember(access);
  if (!Node.isIdentifier(receiver)) return undefined;
  const member = originOfValue(access);
  const declared = member.kind === 'local' ? namedFunction(member.declaration) : undefined;
  if (declared !== undefined) return declared;
  // `OrdersGateway.listOrders(id)` on `export default OrdersGateway()`, where the
  // factory hands back an object of functions written whole: the checker
  // says the member is the function written in the literal (P276).
  const inObject = member.kind === 'local' && onlyDeclaration(access) ? objectMemberFunction(member.declaration) : undefined;
  if (inObject !== undefined) return inObject;
  const origin = originOfValue(receiver);
  if (origin.kind !== 'local' || !Node.isVariableDeclaration(origin.declaration)) return undefined;
  return memberFunction(origin.declaration.getNameNode(), access.getName());
};

/**
 * Whether a member is declared in one place only: a value that may be either of
 * two objects (`a ?? b`, a union of two literals) runs whichever it holds, and
 * landing on the first would be a guess.
 */
const onlyDeclaration = (access: PropertyAccessExpression): boolean => {
  const symbol = access.getNameNode().getSymbol();
  return (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations().length === 1;
};

/** `this.member` written in a method of an object literal, when the member is a function of that same object. */
const thisMember = (access: PropertyAccessExpression): NamedFunction | undefined => {
  // `this` is the object a method is written in, past the arrows between: an
  // arrow keeps the `this` it was written under, a method or a `function` is
  // handed its own. Read off the syntax, since the checker types `this` in an
  // object literal only where `noImplicitThis` asks it to.
  let fn: TsNode | undefined = access.getFirstAncestor((node) => Node.isMethodDeclaration(node) || Node.isFunctionExpression(node) || Node.isFunctionDeclaration(node) || Node.isClassDeclaration(node));
  if (fn !== undefined && Node.isFunctionExpression(fn)) fn = fn.getParent();
  const literal = fn?.getParent();
  if (fn === undefined || literal === undefined || !Node.isObjectLiteralExpression(literal)) return undefined;
  const property = literal.getProperty(access.getName());
  return property === undefined ? undefined : objectMemberFunction(property);
};
