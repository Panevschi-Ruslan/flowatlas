import { Node, SyntaxKind, type CallExpression, type Node as TsNode, type ParameterDeclaration } from 'ts-morph';
import { HTTP_METHODS } from './ids.js';
import { evaluateExpression } from './static-value.js';
import { argumentAlong } from './trace.js';

/**
 * The branches a call inside a helper is taken under, where they test what a
 * caller hands the helper (P401).
 *
 * `forward(http, method, url)` that sends `method === 'GET' ? http.get(url) :
 * method === 'DELETE' ? http.delete(url) : http.post(url, body)` writes three
 * requests, each with the address its callers hand in, and each caller takes
 * one of them. Credited to every caller alike, the first branch's verb stood
 * for all of them: `forward(http, 'POST', '/notes/1/export')` read as a GET,
 * and the route it asks for, which answers POST, was called missing. Read at
 * each caller, the branch is taken, not taken, or not known there, and a
 * request is credited only to callers that take it.
 */

/** One test a call sits under, and which way it must come out for the call to run. */
export interface BranchTest {
  test: TsNode;
  /** True where the call runs when the test holds, false where it runs when it does not. */
  holds: boolean;
}

/** What a branch comes to at one caller: taken, not taken, or not known there. */
export type Taken = true | false | 'unread';

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  for (;;) {
    if (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isNonNullExpression(current) || Node.isSatisfiesExpression(current)) {
      current = current.getExpression();
    } else return current;
  }
};

/** The parameter of `fn` a name in its body stands for, written directly. */
const parameterNamed = (node: TsNode, fn: TsNode): ParameterDeclaration | undefined => {
  const name = unwrap(node);
  if (!Node.isIdentifier(name)) return undefined;
  const declaration = name.getSymbol()?.getDeclarations()[0];
  return declaration !== undefined && Node.isParameterDeclaration(declaration) && declaration.getParent() === fn ? declaration : undefined;
};

/** Whether a test reads a parameter of `fn` anywhere: only those are judged at a caller. */
const readsParameter = (test: TsNode, fn: TsNode): boolean =>
  parameterNamed(test, fn) !== undefined || test.getDescendants().some((each) => parameterNamed(each, fn) !== undefined);

/**
 * The tests a call sits under between it and the function it is written in:
 * a conditional's branch, an `if`'s or `else`'s, the right of `&&` and `||`,
 * a `case` of a `switch`. Only tests that read a parameter of that function;
 * outermost first.
 */
export const branchTestsOf = (call: CallExpression): BranchTest[] => {
  let fn: TsNode | undefined;
  let at: TsNode = call;
  const found: BranchTest[] = [];
  for (let parent = at.getParent(); parent !== undefined; at = parent, parent = parent.getParent()) {
    if (Node.isFunctionDeclaration(parent) || Node.isFunctionExpression(parent) || Node.isArrowFunction(parent) || Node.isMethodDeclaration(parent)) {
      fn = parent;
      break;
    }
    if (Node.isConditionalExpression(parent)) {
      if (parent.getWhenTrue() === at) found.push({ test: parent.getCondition(), holds: true });
      else if (parent.getWhenFalse() === at) found.push({ test: parent.getCondition(), holds: false });
    } else if (Node.isIfStatement(parent)) {
      if (parent.getThenStatement() === at) found.push({ test: parent.getExpression(), holds: true });
      else if (parent.getElseStatement() === at) found.push({ test: parent.getExpression(), holds: false });
    } else if (Node.isBinaryExpression(parent) && parent.getRight() === at) {
      const operator = parent.getOperatorToken().getKind();
      if (operator === SyntaxKind.AmpersandAmpersandToken) found.push({ test: parent.getLeft(), holds: true });
      else if (operator === SyntaxKind.BarBarToken) found.push({ test: parent.getLeft(), holds: false });
    } else if (Node.isCaseClause(parent)) {
      const block = parent.getParent();
      const statement = block?.getParent();
      if (statement !== undefined && Node.isSwitchStatement(statement)) found.push({ test: parent, holds: true });
    }
  }
  const holder = fn;
  if (holder === undefined) return [];
  /** What a test reads: a `case` reads the value its switch tests. */
  const read = (test: TsNode): TsNode => {
    if (!Node.isCaseClause(test)) return test;
    const statement = test.getParent()?.getParent();
    return statement !== undefined && Node.isSwitchStatement(statement) ? statement.getExpression() : test;
  };
  return found.filter((each) => readsParameter(read(each.test), holder)).reverse();
};

/** Whether a test compares with a verb (`method === 'GET'`, `case 'DELETE':`): a branch that chooses the request's verb. */
export const testsAVerb = (tests: readonly BranchTest[]): boolean =>
  tests.some(({ test }) => {
    const spelled = (node: TsNode): boolean =>
      (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) && (HTTP_METHODS as readonly string[]).includes(node.getLiteralValue().toUpperCase());
    return spelled(test) || test.getDescendants().some(spelled);
  });

/** A value written outright: a string, a number, a boolean, `null`; undefined where it is not one. */
const constantOf = (node: TsNode): { value: unknown } | undefined => {
  const read = evaluateExpression(unwrap(node));
  return read.resolved ? { value: read.value } : undefined;
};

/** And, or and not over taken, not taken and not known. */
const not = (value: Taken): Taken => (value === 'unread' ? 'unread' : !value);
const and = (a: Taken, b: Taken): Taken => (a === false || b === false ? false : a === 'unread' || b === 'unread' ? 'unread' : true);
const or = (a: Taken, b: Taken): Taken => (a === true || b === true ? true : a === 'unread' || b === 'unread' ? 'unread' : false);

/**
 * What a test comes to with the parameters of `fn` bound as one caller binds
 * them, along the calls a request was followed out through.
 */
const evaluate = (test: TsNode, fn: TsNode, hops: readonly CallExpression[]): Taken => {
  const node = unwrap(test);
  /** The value of an operand: a parameter as the caller hands it, or a constant written here. */
  const valueOf = (operand: TsNode): { value: unknown } | undefined => {
    const parameter = parameterNamed(operand, fn);
    if (parameter === undefined) return constantOf(operand);
    const handed = argumentAlong(parameter, hops);
    return handed === undefined || handed === null ? undefined : constantOf(handed);
  };
  if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.ExclamationToken) return not(evaluate(node.getOperand(), fn, hops));
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (operator === SyntaxKind.AmpersandAmpersandToken) return and(evaluate(node.getLeft(), fn, hops), evaluate(node.getRight(), fn, hops));
    if (operator === SyntaxKind.BarBarToken) return or(evaluate(node.getLeft(), fn, hops), evaluate(node.getRight(), fn, hops));
    const equal = operator === SyntaxKind.EqualsEqualsEqualsToken || operator === SyntaxKind.EqualsEqualsToken;
    const unequal = operator === SyntaxKind.ExclamationEqualsEqualsToken || operator === SyntaxKind.ExclamationEqualsToken;
    if (!equal && !unequal) return 'unread';
    const [left, right] = [valueOf(node.getLeft()), valueOf(node.getRight())];
    if (left === undefined || right === undefined) return 'unread';
    const same = typeof left.value === 'string' && typeof right.value === 'string' ? left.value.toUpperCase() === right.value.toUpperCase() : left.value === right.value;
    return equal ? same : !same;
  }
  return 'unread';
};

/** What a `case` comes to: the switch's value against the case's, or against none where it is the default. */
const evaluateCase = (clause: TsNode, fn: TsNode, hops: readonly CallExpression[]): Taken => {
  if (!Node.isCaseClause(clause)) return 'unread';
  const statement = clause.getParentOrThrow().getParentOrThrow();
  if (!Node.isSwitchStatement(statement)) return 'unread';
  const parameter = parameterNamed(statement.getExpression(), fn);
  if (parameter === undefined) return 'unread';
  const handed = argumentAlong(parameter, hops);
  const value = handed === undefined || handed === null ? undefined : constantOf(handed);
  const wanted = constantOf(clause.getExpression());
  if (value === undefined || wanted === undefined) return 'unread';
  return typeof value.value === 'string' && typeof wanted.value === 'string' ? value.value.toUpperCase() === wanted.value.toUpperCase() : value.value === wanted.value;
};

/**
 * Whether one caller takes the branch a call sits under: every test it is
 * under comes out the way the call needs, at that caller, read along the calls
 * the request was followed out through. `true` where there are no tests.
 */
export const takenAlong = (call: CallExpression, tests: readonly BranchTest[], hops: readonly CallExpression[]): Taken => {
  let fn: TsNode | undefined;
  for (let parent = call.getParent(); parent !== undefined; parent = parent.getParent()) {
    if (Node.isFunctionDeclaration(parent) || Node.isFunctionExpression(parent) || Node.isArrowFunction(parent) || Node.isMethodDeclaration(parent)) {
      fn = parent;
      break;
    }
  }
  if (fn === undefined) return true;
  let taken: Taken = true;
  for (const { test, holds } of tests) {
    const value = Node.isCaseClause(test) ? evaluateCase(test, fn, hops) : evaluate(test, fn, hops);
    taken = and(taken, holds ? value : not(value));
    if (taken === false) return false;
  }
  return taken;
};
