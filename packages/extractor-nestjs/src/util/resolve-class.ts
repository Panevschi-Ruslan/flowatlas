import { resolveClassOfExpression, originOfValue, type ClassRef } from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';

const DYNAMIC_MODULE_METHODS = new Set([
  'forRoot',
  'forRootAsync',
  'forFeature',
  'forFeatureAsync',
  'register',
  'registerAsync',
  'forChild',
]);

/**
 * Looks through the wrappers a class reference is usually written behind.
 *
 * `forwardRef(() => X)` exists to break a cycle, `X.forRoot(...)` to configure a
 * module; both still name X, and the graph cares about X.
 */
export const unwrapClassExpression = (expr: TsNode): TsNode => {
  let current = expr;
  for (let guard = 0; guard < 8; guard += 1) {
    if (Node.isParenthesizedExpression(current) || Node.isAsExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isCallExpression(current)) {
      const callee = current.getExpression();
      if (Node.isIdentifier(callee) && callee.getText() === 'forwardRef') {
        const [argument] = current.getArguments();
        if (argument !== undefined && Node.isArrowFunction(argument)) {
          const body = argument.getBody();
          current = body;
          continue;
        }
      }
      if (
        Node.isPropertyAccessExpression(callee) &&
        DYNAMIC_MODULE_METHODS.has(callee.getName())
      ) {
        current = callee.getExpression();
        continue;
      }
    }
    return current;
  }
  return current;
};

/** True when the reference is configured rather than plain, e.g. `X.forRoot()`. */
export const isDynamicModuleExpression = (expr: TsNode): boolean => {
  const node = Node.isParenthesizedExpression(expr) ? expr.getExpression() : expr;
  if (!Node.isCallExpression(node)) return false;
  const callee = node.getExpression();
  return Node.isPropertyAccessExpression(callee) && DYNAMIC_MODULE_METHODS.has(callee.getName());
};

/** Resolves an expression that names a class, through the wrappers above. */
export const resolveClassExpression = (expr: TsNode): ClassRef =>
  resolveClassOfExpression(unwrapClassExpression(expr));

/**
 * Resolves what a call names, when the callee may be a factory rather than a class.
 *
 * Some wrappers are produced by a function that builds a class on the fly. The
 * function is what identifies it, so its name and package stand in for the class
 * that does not exist as a declaration anywhere.
 */
export const resolveCallableRef = (callee: TsNode): ClassRef => {
  const direct = resolveClassExpression(callee);
  if (direct.kind !== 'unknown') return direct;
  const origin = originOfValue(unwrapClassExpression(callee));
  if (origin.kind === 'external') {
    return { kind: 'external', typeName: origin.typeName, package: origin.package };
  }
  return direct;
};

export type { ClassRef };
