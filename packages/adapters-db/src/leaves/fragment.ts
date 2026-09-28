import { Node, type CallExpression, type Node as TsNode } from 'ts-morph';

/**
 * Whether `child` is where `parent` keeps a value it hands on unchanged: an
 * element of a list, a property's value, a spread, one arm of a condition, or
 * the same expression parenthesised or retyped.
 */
const carries = (parent: TsNode, child: TsNode): boolean => {
  if (
    Node.isParenthesizedExpression(parent) ||
    Node.isAsExpression(parent) ||
    Node.isSatisfiesExpression(parent) ||
    Node.isNonNullExpression(parent) ||
    Node.isTypeAssertion(parent) ||
    Node.isSpreadElement(parent) ||
    Node.isArrayLiteralExpression(parent) ||
    Node.isObjectLiteralExpression(parent)
  ) {
    return true;
  }
  if (Node.isPropertyAssignment(parent)) return parent.getInitializer() === child;
  if (Node.isConditionalExpression(parent)) return parent.getCondition() !== child;
  return false;
};

/**
 * The call a value is handed to as an argument, where it is handed on unchanged.
 *
 * `builder.where(knex.raw('…'))` and `builder.update({ at: knex.raw('now()') })`
 * both hand the inner call to `where` and `update`: the first as the argument,
 * the second as a property of it. Walking up through the containers a value is
 * carried in is what makes those the same answer. Anything else on the way up -
 * an `await`, a `return`, a variable, the receiver of another call - means the
 * value is used where it is written, and there is no host.
 */
export const hostCallOf = (call: CallExpression): CallExpression | undefined => {
  let child: TsNode = call;
  let parent = call.getParent();
  while (parent !== undefined && carries(parent, child)) {
    child = parent;
    parent = parent.getParent();
  }
  if (parent === undefined || !Node.isCallExpression(parent)) return undefined;
  return parent.getArguments().includes(child) ? parent : undefined;
};
