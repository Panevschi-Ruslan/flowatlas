import { declarationOf } from '@flowatlas/core';
import { Node, type Node as TsNode } from 'ts-morph';
import type { ClientCallback } from '../descriptors/index.js';

/**
 * The call a value was handed to a callback by, when a record says it hands one
 * a client (R157).
 *
 * `tx` in `prisma.$transaction(async (tx) => …)` is a parameter nothing
 * annotates. This walks from the name to its declaration, from the parameter to
 * the function it belongs to, and from the function to the call it is an
 * argument of, and asks one question: is this call, at these two positions, one
 * `records` describes? Where it is, the answer is the expression the call was
 * made on - `prisma` - together with the record, so the caller can read that
 * expression as it reads any client and require it to be the record's library.
 * Nothing is inferred from the name `tx`.
 */
export const handedBackBy = (
  value: TsNode,
  records: readonly ClientCallback[],
): { holder: TsNode; record: ClientCallback } | undefined => {
  if (records.length === 0 || !Node.isIdentifier(value)) return undefined;
  const parameter = declarationOf(value);
  if (!Node.isParameterDeclaration(parameter) || parameter.getTypeNode() !== undefined) return undefined;
  const fn = parameter.getParent();
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return undefined;
  const call = fn.getParent();
  if (!Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const position = call.getArguments().indexOf(fn);
  const index = fn.getParameters().indexOf(parameter);
  const record = records.find(
    (candidate) =>
      candidate.method === callee.getName() &&
      candidate.callback === position &&
      candidate.parameter === index,
  );
  return record === undefined ? undefined : { holder: callee.getExpression(), record };
};
