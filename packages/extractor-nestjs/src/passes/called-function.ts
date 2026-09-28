import { memberFunction, namedFunction, originOfValue, type NamedFunction } from '@flowatlas/core';
import type { Identifier, PropertyAccessExpression } from 'ts-morph';
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
 * name does.
 */
export const memberFunctionCalled = (access: PropertyAccessExpression): NamedFunction | undefined => {
  const receiver = access.getExpression();
  if (!Node.isIdentifier(receiver)) return undefined;
  const origin = originOfValue(receiver);
  if (origin.kind !== 'local' || !Node.isVariableDeclaration(origin.declaration)) return undefined;
  return memberFunction(origin.declaration.getNameNode(), access.getName());
};
