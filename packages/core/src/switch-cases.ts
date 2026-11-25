import { Node, SyntaxKind, type Node as TsNode, type SwitchStatement } from 'ts-morph';

/**
 * Whether code that reads a field switches over its value, and what the
 * switch does with a value none of its cases names (P402): a message type or
 * an answer's status that gains a value meets the switch's `default`, or
 * falls through every case and is dropped.
 *
 * - `default`: a `default` branch handles what no case names;
 * - `none`: no `default`, so a value no case names does nothing;
 * - `never`: a `default` that only proves no value is left (`const x: never =
 *   v`, `assertNever(v)`, `v satisfies never`): the switch is written to
 *   cover every value, and one more value is not handled.
 */
export type SwitchDefault = 'default' | 'none' | 'never';

/** A switch over a field's value: what it does past its cases, the values its cases name, and its line. */
export interface SwitchedOver {
  has: SwitchDefault;
  /** The values the cases name, as written (`'PAID'`, `2`), where each is a literal or a constant the checker types as one. */
  cases: string[];
  line: number;
}

const isWrapper = (node: TsNode): boolean =>
  Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node) || Node.isSatisfiesExpression(node) || Node.isTypeAssertion(node) || Node.isAwaitExpression(node);

/** A case's value as text, where it is one value: a literal, or a constant whose type is one literal. */
const caseValue = (expression: TsNode): string | undefined => {
  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) return `'${expression.getLiteralValue()}'`;
  if (Node.isNumericLiteral(expression)) return String(expression.getLiteralValue());
  try {
    const type = expression.getType();
    if (type.isStringLiteral()) return `'${String(type.getLiteralValue())}'`;
    if (type.isNumberLiteral()) return String(type.getLiteralValue());
  } catch {
    return undefined;
  }
  return undefined;
};

/** Whether a statement only proves the switched value is `never`. */
const provesNever = (statement: TsNode): boolean => {
  if (Node.isVariableStatement(statement)) {
    return statement.getDeclarations().some((declaration) => declaration.getTypeNode()?.getKind() === SyntaxKind.NeverKeyword);
  }
  const expression = Node.isExpressionStatement(statement) || Node.isReturnStatement(statement) || Node.isThrowStatement(statement) ? statement.getExpression() : undefined;
  if (expression === undefined) return false;
  let at: TsNode = expression;
  if (Node.isSatisfiesExpression(at) || Node.isAsExpression(at)) return at.getTypeNode()?.getKind() === SyntaxKind.NeverKeyword;
  if (Node.isNewExpression(at)) {
    const [first] = at.getArguments();
    if (first === undefined) return false;
    at = first;
  }
  if (!Node.isCallExpression(at)) return false;
  // `assertNever(v)`, `exhaustive(v)`: a function whose parameter is typed `never`.
  for (const declaration of at.getExpression().getSymbol()?.getDeclarations() ?? []) {
    const parameters = Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration) ? declaration.getParameters() : undefined;
    if (parameters?.[0]?.getTypeNode()?.getKind() === SyntaxKind.NeverKeyword) return true;
    if (Node.isVariableDeclaration(declaration)) {
      const value = declaration.getInitializer();
      if (value !== undefined && (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) && value.getParameters()[0]?.getTypeNode()?.getKind() === SyntaxKind.NeverKeyword) return true;
    }
  }
  return false;
};

/** What one switch does past its cases. */
export const switchOf = (statement: SwitchStatement): SwitchedOver => {
  const clauses = statement.getCaseBlock().getClauses();
  const cases: string[] = [];
  let has: SwitchDefault = 'none';
  for (const clause of clauses) {
    if (Node.isCaseClause(clause)) {
      const value = caseValue(clause.getExpression());
      if (value !== undefined && !cases.includes(value)) cases.push(value);
      continue;
    }
    const statements = clause.getStatements().flatMap((each) => (Node.isBlock(each) ? each.getStatements() : [each]));
    has = statements.some(provesNever) ? 'never' : 'default';
  }
  return { has, cases, line: statement.getStartLineNumber() };
};

/** The function a node is written in, or its file. */
const scopeOf = (node: TsNode): TsNode =>
  node.getFirstAncestor((at) => Node.isMethodDeclaration(at) || Node.isFunctionDeclaration(at) || Node.isArrowFunction(at) || Node.isFunctionExpression(at) || Node.isGetAccessorDeclaration(at)) ??
  node.getSourceFile();

/**
 * The switch over the value at `node`: written on it (`switch (msg.status)`),
 * or on a `const` that holds it (`const s = msg.status; switch (s)`).
 */
export const switchedOver = (node: TsNode): SwitchedOver | undefined => {
  let at = node;
  let parent = at.getParent();
  while (parent !== undefined && isWrapper(parent)) {
    at = parent;
    parent = at.getParent();
  }
  if (parent === undefined) return undefined;
  if (Node.isSwitchStatement(parent) && parent.getExpression() === at) return switchOf(parent);
  if (!Node.isVariableDeclaration(parent) || parent.getInitializer() !== at) return undefined;
  const name = parent.getNameNode();
  if (!Node.isIdentifier(name) || parent.getVariableStatement()?.getDeclarationKind() !== 'const') return undefined;
  const symbol = name.getSymbol();
  if (symbol === undefined) return undefined;
  for (const statement of scopeOf(parent).getDescendantsOfKind(SyntaxKind.SwitchStatement)) {
    let expression: TsNode = statement.getExpression();
    while (isWrapper(expression)) expression = (expression as TsNode & { getExpression(): TsNode }).getExpression();
    if (Node.isIdentifier(expression) && expression.getSymbol() === symbol) return switchOf(statement);
  }
  return undefined;
};
