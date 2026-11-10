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

/** `scheme://host` and what follows it, in a base written as text. */
const ABSOLUTE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)/i;

/**
 * A base written as text, read as an address: `/api/v1` is a path, and
 * `https://api.example.test/api` a host with a path after it (P280). Read as
 * a path whole, the second put the scheme and the host in front of every
 * route it was asked for, `/https:/api.example.test/api/orders`, and joined
 * nothing.
 */
export const literalAddress = (text: string): ReadAddress => {
  const absolute = ABSOLUTE.exec(text);
  if (absolute === null) return { url: text, path: text, baseUrlEnv: null, host: null, via: 'literal', guessed: false };
  return { url: text, path: absolute[3] === '' ? '/' : (absolute[3] ?? '/'), baseUrlEnv: null, host: (absolute[2] ?? '').toLowerCase(), via: 'literal', guessed: false };
};

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

/**
 * What a condition about the address a request writes says of one address:
 * `true` or `false`, or `undefined` where the part it asks about is a hole
 * nobody read (P280).
 */
export type AddressTest = (written: string) => boolean | undefined;

/** The holes an address is written with: a span nobody read, a parameter. */
const HOLE = /\$\{…\}|:param\b/;

/** The text an address writes before its first hole, and after its last. */
const readEnds = (written: string): { head: string; tail: string; whole: boolean } => {
  const pieces = written.split(HOLE);
  return { head: pieces[0] ?? '', tail: pieces[pieces.length - 1] ?? '', whole: !HOLE.test(written) };
};

const textOf = (node: TsNode | undefined): string | undefined => {
  if (node === undefined) return undefined;
  const target = unwrap(node);
  return Node.isStringLiteral(target) || Node.isNoSubstitutionTemplateLiteral(target) ? target.getLiteralText() : undefined;
};

const STRING_TESTS: Readonly<Record<string, (written: string, text: string) => boolean | undefined>> = {
  startsWith: (written, text) => {
    const { head, whole } = readEnds(written);
    if (whole || head.length >= text.length) return written.startsWith(text);
    return text.startsWith(head) ? undefined : false;
  },
  endsWith: (written, text) => {
    const { tail, whole } = readEnds(written);
    if (whole || tail.length >= text.length) return written.endsWith(text);
    return text.endsWith(tail) ? undefined : false;
  },
  includes: (written, text) => (written.split(HOLE).some((piece) => piece.includes(text)) ? true : HOLE.test(written) ? undefined : false),
};

/** A test turned round. */
const not = (test: AddressTest): AddressTest => (written) => {
  const answer = test(written);
  return answer === undefined ? undefined : !answer;
};

/** Tests joined: every one holds (`all`), or any one does. */
const joined = (tests: readonly AddressTest[], all: boolean): AddressTest => (written) => {
  const answers = tests.map((test) => test(written));
  if (answers.includes(!all)) return !all;
  return answers.includes(undefined) ? undefined : all;
};

/**
 * A condition read as a test of the address a request writes (P280):
 * `url.startsWith('/api')`, `url.endsWith('.json')`, `url.includes('/assets/')`,
 * `/^\/api\//.test(url)`, `url === '/login'`, negated or joined with `&&` and
 * `||`. `undefined` where any part of it asks about something else - a
 * header, a flag, the time - since what that is for a request is not read.
 */
export const addressTestOf = (condition: TsNode, isAddress: (node: TsNode) => boolean): AddressTest | undefined => {
  const target = unwrap(condition);
  if (Node.isPrefixUnaryExpression(target) && target.getOperatorToken() === SyntaxKind.ExclamationToken) {
    const inner = addressTestOf(target.getOperand(), isAddress);
    return inner === undefined ? undefined : not(inner);
  }
  if (Node.isBinaryExpression(target)) {
    const operator = target.getOperatorToken().getKind();
    if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
      const left = addressTestOf(target.getLeft(), isAddress);
      const right = addressTestOf(target.getRight(), isAddress);
      if (left === undefined || right === undefined) return undefined;
      return joined([left, right], operator === SyntaxKind.AmpersandAmpersandToken);
    }
    const equal = [SyntaxKind.EqualsEqualsToken, SyntaxKind.EqualsEqualsEqualsToken].includes(operator);
    const unequal = [SyntaxKind.ExclamationEqualsToken, SyntaxKind.ExclamationEqualsEqualsToken].includes(operator);
    if (!equal && !unequal) return undefined;
    const text = isAddress(target.getLeft()) ? textOf(target.getRight()) : isAddress(target.getRight()) ? textOf(target.getLeft()) : undefined;
    if (text === undefined) return undefined;
    return (written) => {
      const { head, tail, whole } = readEnds(written);
      // An address whose read ends cannot be the text's is not it, holes or not.
      if (!whole) return text.startsWith(head) && text.endsWith(tail) ? undefined : !equal;
      return (written === text) === equal;
    };
  }
  if (!Node.isCallExpression(target)) return undefined;
  const callee = target.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const [argument] = target.getArguments();
  const test = STRING_TESTS[callee.getName()];
  if (test !== undefined && isAddress(callee.getExpression())) {
    const text = textOf(argument);
    return text === undefined ? undefined : (written) => test(written, text);
  }
  if (callee.getName() === 'test' && argument !== undefined && isAddress(argument)) {
    const pattern = unwrap(callee.getExpression());
    if (!Node.isRegularExpressionLiteral(pattern)) return undefined;
    const literal = /^\/(.*)\/([a-z]*)$/s.exec(pattern.getLiteralText());
    if (literal === null) return undefined;
    let compiled: RegExp;
    try {
      compiled = new RegExp(literal[1] ?? '', (literal[2] ?? '').replace(/[gy]/g, ''));
    } catch {
      return undefined;
    }
    return (written) => (HOLE.test(written) ? undefined : compiled.test(written));
  }
  return undefined;
};

/** Whether a statement always leaves where it is: `return`, `throw`, or a block ending in one. */
const leaves = (statement: TsNode): boolean => {
  if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement)) return true;
  if (Node.isBlock(statement)) {
    const last = statement.getStatements().at(-1);
    return last !== undefined && leaves(last);
  }
  return false;
};

/** A condition a node sits behind, and whether it holds where the node is reached. */
export interface Guard {
  readonly condition: TsNode;
  /** `undefined` where the shape does not say: a guard before the node that does not leave. */
  readonly holds: boolean | undefined;
}

/**
 * The conditions a node sits behind inside a function, each with whether it
 * holds where the node is reached (P280): `true` inside `if (c)`, `false`
 * in its `else` and after `if (c) return`. The same conditions
 * {@link conditionsAround} finds, with the side each is on.
 */
export const guardsAround = (node: TsNode, fn: TsNode): Guard[] => {
  const guards: Guard[] = [];
  let child: TsNode = node;
  for (let at = node.getParent(); at !== undefined && at !== fn; child = at, at = at.getParent()) {
    if (Node.isIfStatement(at) && child !== at.getExpression()) guards.push({ condition: at.getExpression(), holds: child === at.getThenStatement() });
    if (Node.isConditionalExpression(at) && child !== at.getCondition()) guards.push({ condition: at.getCondition(), holds: child === at.getWhenTrue() });
    if (Node.isBinaryExpression(at) && child === at.getRight()) {
      const operator = at.getOperatorToken().getKind();
      if (operator === SyntaxKind.AmpersandAmpersandToken) guards.push({ condition: at.getLeft(), holds: true });
      if (operator === SyntaxKind.BarBarToken) guards.push({ condition: at.getLeft(), holds: false });
      if (operator === SyntaxKind.QuestionQuestionToken) guards.push({ condition: at.getLeft(), holds: undefined });
    }
    if (Node.isBlock(at)) {
      for (const statement of at.getStatements()) {
        if (statement === child) break;
        if (Node.isIfStatement(statement)) {
          const exits = statement.getElseStatement() === undefined && leaves(statement.getThenStatement());
          guards.push({ condition: statement.getExpression(), holds: exits ? false : undefined });
        }
      }
    }
  }
  return guards;
};

/**
 * The test a rewrite's conditions put to a request's address, where every one
 * of them asks only about the address's form (P280): the rewrite is applied to
 * the requests whose written address passes, `if (req.url.startsWith('/api'))`
 * or after `if (req.url.startsWith('/assets')) return next(req)`. `null` where
 * no condition is left once whether the address is absolute and the ones
 * `ignore` names are set aside; `undefined` where one asks about anything else,
 * or the shape does not say which side of it the rewrite is on.
 */
export const rewriteTestOf = (
  at: TsNode,
  fn: TsNode,
  isAddress: (node: TsNode) => boolean,
  ignore: (condition: TsNode) => boolean = () => false,
): AddressTest | null | undefined => {
  const guards = guardsAround(at, fn).filter(({ condition }) => !asksAbsolute(condition, isAddress) && !ignore(condition));
  if (guards.length === 0) return null;
  const tests: AddressTest[] = [];
  for (const { condition, holds } of guards) {
    const test = holds === undefined ? undefined : addressTestOf(condition, isAddress);
    if (test === undefined) return undefined;
    tests.push(holds ? test : not(test));
  }
  return joined(tests, true);
};
