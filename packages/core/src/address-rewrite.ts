import type { Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { isSomewhere, underBase, type ReadAddress } from './under-base.js';

/**
 * A function that rewrites every request's address before it goes out, read
 * the same way by every front-end reader (P239, P244).
 *
 * Two readers meet this shape: one where the framework's client is rewritten
 * by a class or a function the injector runs, one where an installed client
 * runs a function the repository hands it (a request interceptor, a hook run
 * before each request). What the two must never disagree about is which
 * conditions leave a rewrite certain and how a base is taken out of
 * `base + address`, so both are said here, below both (I12).
 */

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isNonNullExpression(current)) {
    current = current.getExpression();
  }
  return current;
};

/**
 * Whether a condition only asks whether the address is already absolute:
 * `url.startsWith('http')`, `url.includes('://')`, `/^https?:/.test(url)`,
 * alone, negated or joined. Such a guard changes nothing a reader records,
 * because an absolute address is never put under a base anyway
 * ({@link underBase}).
 */
export const asksAbsolute = (condition: TsNode, isAddress: (node: TsNode) => boolean): boolean => {
  const target = unwrap(condition);
  if (Node.isPrefixUnaryExpression(target) && target.getOperatorToken() === SyntaxKind.ExclamationToken) {
    return asksAbsolute(target.getOperand(), isAddress);
  }
  if (Node.isBinaryExpression(target)) {
    const operator = target.getOperatorToken().getKind();
    if (operator === SyntaxKind.BarBarToken || operator === SyntaxKind.AmpersandAmpersandToken) {
      return asksAbsolute(target.getLeft(), isAddress) && asksAbsolute(target.getRight(), isAddress);
    }
    return false;
  }
  if (!Node.isCallExpression(target)) return false;
  const callee = target.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const [argument] = target.getArguments();
  if (argument === undefined) return false;
  if (['startsWith', 'includes'].includes(callee.getName()) && isAddress(callee.getExpression())) {
    return (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) && /^(https?:?(\/\/)?|:\/\/|\/\/)$/.test(argument.getLiteralText());
  }
  if (callee.getName() === 'test' && isAddress(argument)) {
    const pattern = unwrap(callee.getExpression());
    return Node.isRegularExpressionLiteral(pattern) && /http|:\\?\/\\?\//.test(pattern.getText());
  }
  return false;
};

/**
 * The conditions a node sits behind inside a function: the branches around it
 * and the guards written before it in the same block, which decide whether it
 * is reached at all.
 */
export const conditionsAround = (node: TsNode, fn: TsNode): TsNode[] => {
  const conditions: TsNode[] = [];
  let child: TsNode = node;
  for (let at = node.getParent(); at !== undefined && at !== fn; child = at, at = at.getParent()) {
    if (Node.isIfStatement(at) && child !== at.getExpression()) conditions.push(at.getExpression());
    if (Node.isConditionalExpression(at) && child !== at.getCondition()) conditions.push(at.getCondition());
    if (Node.isBinaryExpression(at) && child === at.getRight()) {
      const operator = at.getOperatorToken().getKind();
      if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken || operator === SyntaxKind.QuestionQuestionToken) {
        conditions.push(at.getLeft());
      }
    }
    if (Node.isBlock(at)) {
      for (const statement of at.getStatements()) {
        if (statement === child) break;
        if (Node.isIfStatement(statement)) conditions.push(statement.getExpression());
      }
    }
  }
  return conditions;
};

/** A base written as text, read as an address. */
export const literalAddress = (text: string): ReadAddress => ({ url: text, path: text, baseUrlEnv: null, host: null, via: 'literal', guessed: false });

/**
 * The base a rewrite of the address puts in front of it: `base + address`, or
 * `` `${base}${address}` `` with any text between the two. `isAddress` says
 * which expression is the address the request already had, and `read` reads a
 * base the way the asking reader reads every other one.
 */
export const prefixOfRewrite = (
  written: TsNode,
  isAddress: (node: TsNode) => boolean,
  read: (node: TsNode) => ReadAddress,
): ReadAddress | undefined => {
  const value = unwrap(written);
  if (Node.isBinaryExpression(value) && value.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
    if (!isAddress(value.getRight())) return undefined;
    const base = read(value.getLeft());
    return isSomewhere(base) ? base : undefined;
  }
  if (!Node.isTemplateExpression(value)) return undefined;
  const spans = value.getTemplateSpans();
  const last = spans[spans.length - 1];
  if (last === undefined || !isAddress(last.getExpression()) || last.getLiteral().getLiteralText() !== '') return undefined;
  const head = value.getHead().getLiteralText();
  const before = spans.slice(0, -1);
  if (before.length === 0) return head === '' ? undefined : literalAddress(head);
  if (before.length > 1 || head !== '') return undefined;
  const [span] = before;
  if (span === undefined) return undefined;
  const base = read(span.getExpression());
  if (!isSomewhere(base)) return undefined;
  const tail = span.getLiteral().getLiteralText();
  return tail === '' || tail === '/' ? base : underBase(base, literalAddress(tail.startsWith('/') ? tail : `/${tail}`));
};
