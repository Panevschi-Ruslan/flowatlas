import { evaluateExpression } from '@flowatlas/core';
import type { Decorator, Expression, ObjectLiteralExpression } from 'ts-morph';
import { Node } from 'ts-morph';

/**
 * The object a decorator is configured with.
 *
 * Every decorator this extractor reads takes one, and everything it needs is a
 * property of it, so this is where reading one starts.
 */
export const metadataOf = (decorator: Decorator | undefined): ObjectLiteralExpression | undefined => {
  const [argument] = decorator?.getArguments() ?? [];
  return argument !== undefined && Node.isObjectLiteralExpression(argument) ? argument : undefined;
};

/** The expression a property was given, whatever shape it has. */
export const propertyOf = (
  literal: ObjectLiteralExpression | undefined,
  name: string,
): Expression | undefined => {
  const property = literal?.getProperty(name);
  if (property === undefined || !Node.isPropertyAssignment(property)) return undefined;
  return property.getInitializer();
};

/** A property that is a string constant, or undefined when it is not one. */
export const stringProperty = (
  literal: ObjectLiteralExpression | undefined,
  name: string,
): string | undefined => {
  const initializer = propertyOf(literal, name);
  if (initializer === undefined) return undefined;
  const value = evaluateExpression(initializer);
  return value.resolved && typeof value.value === 'string' ? value.value : undefined;
};

/** A property that is a boolean constant, or undefined when it is not one. */
export const booleanProperty = (
  literal: ObjectLiteralExpression | undefined,
  name: string,
): boolean | undefined => {
  const initializer = propertyOf(literal, name);
  if (initializer === undefined) return undefined;
  const value = evaluateExpression(initializer);
  return value.resolved && typeof value.value === 'boolean' ? value.value : undefined;
};

/**
 * The elements of a property written as an array literal.
 *
 * The elements are handed back as they were written rather than evaluated: what
 * these arrays hold is class references, and a class is not a value this reads.
 */
export const arrayProperty = (
  literal: ObjectLiteralExpression | undefined,
  name: string,
): Expression[] => {
  const initializer = propertyOf(literal, name);
  return initializer !== undefined && Node.isArrayLiteralExpression(initializer)
    ? initializer.getElements()
    : [];
};
