import { Node, SyntaxKind, type Node as TsNode } from 'ts-morph';

/**
 * Whether code that reads a field checks first that the field is there
 * (P395): the client handling its absence, so a field the server never
 * returns is a value it already copes without, not a screen that breaks.
 *
 * A presence check is a use of the value that tells "there" from "not there":
 * optional chaining past it (`row.changes?.added`), a fallback (`v.distance
 * ?? ''`, `||`), a test (`if (d)`, `d ? … : …`, `!d`, `d && …`, `while (d)`),
 * a comparison with `null` or `undefined` (`m == null`, `typeof m ===
 * 'undefined'`), or the key asked of its holder (`'distance' in v`). The
 * value is the field's own or a part of it holding the field: a read of
 * `changes.added` inside `if (changes)` is checked. A local that holds the
 * field (`const m = v.distance`) is the field: a check on the local anywhere
 * in the function checks the field, and so does a check written anywhere in
 * the functions around the read on the same expression (`if
 * (row.changes) { … row.changes.added … }`, an early return).
 *
 * The value the request answered with itself (`profile?.name`, the state
 * still empty) is not the field: only the parts at a field's path or under it
 * count.
 */

/** Wrappers that leave a value as it was, climbed to the use. */
const isWrapper = (node: TsNode): boolean =>
  Node.isParenthesizedExpression(node) ||
  Node.isAsExpression(node) ||
  Node.isTypeAssertion(node) ||
  Node.isSatisfiesExpression(node) ||
  Node.isAwaitExpression(node) ||
  Node.isNonNullExpression(node);

const FALLBACK_OPERATORS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.QuestionQuestionToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.QuestionQuestionEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
]);

const EQUALITY_OPERATORS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
]);

/** `null`, `undefined`, `void 0`. */
const isNothing = (node: TsNode): boolean =>
  node.getKind() === SyntaxKind.NullKeyword ||
  (Node.isIdentifier(node) && node.getText() === 'undefined') ||
  Node.isVoidExpression(node);

/** Whether the value at `node` is used to tell whether it is there. */
export const checksPresence = (node: TsNode): boolean => {
  let at = node;
  let parent = at.getParent();
  while (parent !== undefined && isWrapper(parent)) {
    at = parent;
    parent = at.getParent();
  }
  if (parent === undefined) return false;
  if ((Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent) || Node.isCallExpression(parent)) && parent.getExpression() === at) {
    return parent.hasQuestionDotToken();
  }
  if (Node.isBinaryExpression(parent)) {
    const operator = parent.getOperatorToken().getKind();
    if (FALLBACK_OPERATORS.has(operator)) return parent.getLeft() === at;
    if (EQUALITY_OPERATORS.has(operator)) return isNothing(parent.getLeft() === at ? parent.getRight() : parent.getLeft());
    return false;
  }
  if (Node.isTypeOfExpression(parent)) {
    const compared = parent.getParent();
    if (compared === undefined || !Node.isBinaryExpression(compared) || !EQUALITY_OPERATORS.has(compared.getOperatorToken().getKind())) return false;
    const other = compared.getLeft() === parent ? compared.getRight() : compared.getLeft();
    return (Node.isStringLiteral(other) || Node.isNoSubstitutionTemplateLiteral(other)) && other.getLiteralValue() === 'undefined';
  }
  if (Node.isPrefixUnaryExpression(parent)) return parent.getOperatorToken() === SyntaxKind.ExclamationToken;
  if (Node.isIfStatement(parent) || Node.isWhileStatement(parent) || Node.isDoStatement(parent)) return parent.getExpression() === at;
  if (Node.isConditionalExpression(parent)) return parent.getCondition() === at;
  return false;
};

/** An expression as a dotted path, `?.` and `!` taken off: `row.changes`, `this.order.total`; undefined for anything else. */
export const pathText = (node: TsNode): string | undefined => {
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isThisExpression(node)) return 'this';
  if (Node.isParenthesizedExpression(node) || Node.isNonNullExpression(node) || Node.isAsExpression(node) || Node.isSatisfiesExpression(node)) {
    return pathText(node.getExpression());
  }
  if (Node.isPropertyAccessExpression(node)) {
    const inner = pathText(node.getExpression());
    return inner === undefined ? undefined : `${inner}.${node.getName()}`;
  }
  if (Node.isElementAccessExpression(node)) {
    const key = node.getArgumentExpression();
    if (key === undefined || !(Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key))) return undefined;
    const inner = pathText(node.getExpression());
    return inner === undefined ? undefined : `${inner}.${key.getLiteralValue()}`;
  }
  return undefined;
};

/** The paths a function's code checks the presence of, its own body and every function inside it; computed once. */
const checkedIn = new WeakMap<TsNode, ReadonlySet<string>>();

const checkedPaths = (body: TsNode): ReadonlySet<string> => {
  const known = checkedIn.get(body);
  if (known !== undefined) return known;
  const paths = new Set<string>();
  body.forEachDescendant((node) => {
    if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.InKeyword) {
      const key = node.getLeft();
      const holder = pathText(node.getRight());
      if ((Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) && holder !== undefined) paths.add(`${holder}.${key.getLiteralValue()}`);
      return;
    }
    if (!(Node.isIdentifier(node) || Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node))) return;
    // A name that is a member's, `changes` in `row.changes`, is read as the access above it.
    const parent = node.getParent();
    if (Node.isIdentifier(node) && parent !== undefined && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) return;
    if (!checksPresence(node)) return;
    const text = pathText(node);
    if (text !== undefined) paths.add(text);
  });
  checkedIn.set(body, paths);
  return paths;
};

/** The outermost function around a node, where every check on its paths is written. */
const outermostFunction = (node: TsNode): TsNode | undefined => {
  let found: TsNode | undefined;
  for (let at = node.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isMethodDeclaration(at) || Node.isFunctionDeclaration(at) || Node.isArrowFunction(at) || Node.isFunctionExpression(at) || Node.isGetAccessorDeclaration(at)) {
      found = at;
    }
    if (Node.isClassDeclaration(at) || Node.isSourceFile(at)) break;
  }
  return found;
};

/** The local a value is held in, where it is a `const`'s or a `let`'s initializer: `const m = v.distance`. */
const heldIn = (node: TsNode): string | undefined => {
  let at = node;
  let parent = at.getParent();
  while (parent !== undefined && isWrapper(parent)) {
    at = parent;
    parent = at.getParent();
  }
  if (parent === undefined || !Node.isVariableDeclaration(parent) || parent.getInitializer() !== at) return undefined;
  const name = parent.getNameNode();
  return Node.isIdentifier(name) ? name.getText() : undefined;
};

/** One step in from a value to what it was read off: `row.changes` from `row.changes.added`, an element from its list. */
const innerOf = (node: TsNode): { inner: TsNode; field: boolean } | undefined => {
  if (Node.isParenthesizedExpression(node) || Node.isNonNullExpression(node) || Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isAwaitExpression(node)) {
    return { inner: node.getExpression(), field: false };
  }
  // A fallback hands the value on, `v.address ?? ''`: the field is its left side.
  if (Node.isBinaryExpression(node) && FALLBACK_OPERATORS.has(node.getOperatorToken().getKind())) return { inner: node.getLeft(), field: false };
  if (Node.isPropertyAccessExpression(node)) return { inner: node.getExpression(), field: true };
  if (Node.isElementAccessExpression(node)) {
    const key = node.getArgumentExpression();
    // An element of a list keeps the path; a key written out is a field.
    const field = key !== undefined && (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key));
    return { inner: node.getExpression(), field };
  }
  return undefined;
};

/**
 * Whether the read of a field whose value is `value`, at a path `depth`
 * fields deep under the answer, is checked for presence: the value or a part
 * of the path above it, down to the first field, used as a check where it is
 * written or checked anywhere in the functions around it, directly or through
 * a local holding it.
 */
export const presenceChecked = (value: TsNode, depth: number): boolean => {
  const scope = outermostFunction(value);
  const checked = scope === undefined ? new Set<string>() : checkedPaths(scope);
  const isChecked = (node: TsNode): boolean => {
    if (checksPresence(node)) return true;
    const text = pathText(node);
    if (text !== undefined && checked.has(text)) return true;
    const local = heldIn(node);
    return local !== undefined && checked.has(local);
  };
  // A field destructured into a local of its name, `const { distance } = v`: the local is the field.
  if (Node.isBindingElement(value)) {
    const name = value.getNameNode();
    return Node.isIdentifier(name) && checked.has(name.getText());
  }
  let at: TsNode = value;
  let left = depth;
  while (left > 0) {
    if (isChecked(at)) return true;
    const step = innerOf(at);
    if (step === undefined) return false;
    if (step.field) left -= 1;
    at = step.inner;
  }
  return false;
};

/** What code does where a field it checks for is absent, where the check leaves the function (P405). */
export type AbsenceExit = 'returns' | 'throws';

/** Whether a condition is true where the value at `path` is absent: `!p`, `p == null`, `p === undefined`, either side of `||`. */
const testsAbsence = (condition: TsNode, paths: ReadonlySet<string>): boolean => {
  let node = condition;
  while (Node.isParenthesizedExpression(node)) node = node.getExpression();
  if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.ExclamationToken) {
    const text = pathText(node.getOperand());
    return text !== undefined && paths.has(text);
  }
  if (!Node.isBinaryExpression(node)) return false;
  const operator = node.getOperatorToken().getKind();
  if (operator === SyntaxKind.BarBarToken) return testsAbsence(node.getLeft(), paths) || testsAbsence(node.getRight(), paths);
  if (operator !== SyntaxKind.EqualsEqualsToken && operator !== SyntaxKind.EqualsEqualsEqualsToken) return false;
  const [left, right] = [node.getLeft(), node.getRight()];
  const text = isNothing(right) ? pathText(left) : isNothing(left) ? pathText(right) : undefined;
  return text !== undefined && paths.has(text);
};

/** How a statement leaves, where it always does: a `return` or a `throw`, alone or last in a block. */
const leavesBy = (statement: TsNode): AbsenceExit | undefined => {
  if (Node.isReturnStatement(statement)) return 'returns';
  if (Node.isThrowStatement(statement)) return 'throws';
  if (Node.isBlock(statement)) {
    const last = statement.getStatements().at(-1);
    return last === undefined ? undefined : leavesBy(last);
  }
  return undefined;
};

/**
 * What the code does where the field read at `value` (a path `depth` fields
 * deep) is absent, where an `if` testing its absence - the field itself or a
 * part of the path above it - leaves the function before the read, or is the
 * read (P405): `if (!evt.roomId) return;` makes a message without `roomId`
 * end the handler early, not fail it. Undefined where no such check is
 * written (a fallback, `?.`, or a check that does not leave).
 */
export const absenceExit = (value: TsNode, depth: number): AbsenceExit | undefined => {
  const scope = outermostFunction(value);
  if (scope === undefined) return undefined;
  const paths = new Set<string>();
  let at: TsNode = value;
  let left = depth;
  while (left > 0) {
    const text = pathText(at);
    if (text !== undefined) paths.add(text);
    const step = innerOf(at);
    if (step === undefined) break;
    at = step.inner;
    if (step.field) left -= 1;
  }
  if (paths.size === 0) return undefined;
  for (const check of scope.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    if (check.getElseStatement() !== undefined) continue;
    // The check stands in a block around the read: one in another branch guards nothing here.
    const block = check.getParent();
    if (block === undefined || block.getStart() > value.getStart() || value.getEnd() > block.getEnd()) continue;
    const condition = check.getExpression();
    const before = check.getEnd() <= value.getStart() || (condition.getStart() <= value.getStart() && value.getEnd() <= condition.getEnd());
    if (!before || !testsAbsence(condition, paths)) continue;
    const exit = leavesBy(check.getThenStatement());
    if (exit !== undefined) return exit;
  }
  return undefined;
};
