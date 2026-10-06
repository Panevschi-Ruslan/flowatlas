import { Node, SyntaxKind, VariableDeclarationKind, type Node as TsNode } from 'ts-morph';

/** How many wrappers and bindings are followed before the answer is no. */
const MOST_STEPS = 8;

const isProcessEnv = (node: TsNode): boolean =>
  Node.isPropertyAccessExpression(node) &&
  node.getName() === 'env' &&
  node.getExpression().getText() === 'process';

/**
 * What an expression evaluates to before the wrappers that leave it alone, with
 * every fallback met on the way collected into `fallbacks`.
 */
const unwrapped = (node: TsNode, fallbacks: TsNode[] = []): TsNode => {
  let current = node;
  for (let step = 0; step < MOST_STEPS; step += 1) {
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isTypeAssertion(current)
    ) {
      current = current.getExpression();
      continue;
    }
    // A fallback is what the variable is replaced with when it is unset; the
    // value the deployment sets is still the one on the left.
    if (Node.isBinaryExpression(current)) {
      const operator = current.getOperatorToken().getKind();
      if (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken) {
        fallbacks.push(current.getRight());
        current = current.getLeft();
        continue;
      }
    }
    return current;
  }
  return current;
};

/**
 * The variable a binding element takes out of `process.env`, when it does; a
 * default written on the element (`{ BUS = 'library' }`) is a fallback.
 */
const destructuredVariable = (declaration: TsNode, fallbacks: TsNode[]): string | undefined => {
  if (!Node.isBindingElement(declaration)) return undefined;
  const pattern = declaration.getParent();
  const variable = pattern?.getParent();
  if (variable === undefined || !Node.isVariableDeclaration(variable)) return undefined;
  const source = variable.getInitializer();
  if (source === undefined || !isProcessEnv(unwrapped(source))) return undefined;
  const fallback = declaration.getInitializer();
  if (fallback !== undefined) fallbacks.push(fallback);
  return declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
};

/** What a name, or a property of a record, was declared by. */
const declarationOf = (node: TsNode): TsNode | undefined =>
  Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)
    ? node.getSymbol()?.getDeclarations()[0]
    : undefined;

/** The expression a `const` or a property of a `const` record was given. */
const boundValue = (declaration: TsNode): TsNode | undefined => {
  if (Node.isVariableDeclaration(declaration)) {
    const kind = declaration.getVariableStatement()?.getDeclarationKind();
    return kind === VariableDeclarationKind.Const ? declaration.getInitializer() : undefined;
  }
  if (Node.isPropertyAssignment(declaration)) return declaration.getInitializer();
  return undefined;
};

/** An environment variable a value is read from, and what the code uses when it is unset. */
export interface EnvironmentRead {
  readonly variable: string;
  /**
   * The one fallback written beside the read - `process.env.X ?? 'default'`,
   * `|| DEFAULT`, a default in a destructuring - as written. None where there
   * are two, since which one stands in then depends on a second variable.
   */
  readonly otherwise?: TsNode;
}

const readOf = (variable: string, fallbacks: readonly TsNode[]): EnvironmentRead =>
  fallbacks.length === 1 ? { variable, otherwise: fallbacks[0] as TsNode } : { variable };

/**
 * Which environment variable an expression is the value of, when it is one.
 *
 * A function addressed to a queue or a topic is very often told which one by its
 * deployment rather than by its code: `QueueUrl: process.env.RETURNS_QUEUE_URL`.
 * The code names the variable and nothing else, and the value is set wherever
 * the function is deployed. That is a different fact from a name built at run
 * time, and it has a different remedy - the deployment says what the value is -
 * so it is told apart here, by the variable, rather than reported as a name
 * nobody could read.
 *
 * The shapes a variable is read in:
 *
 * - `process.env.NAME` and `process.env['NAME']`;
 * - the same with a fallback after it (`?? 'returns'`, `|| DEFAULT`), asserted
 *   (`!`, `as string`) or parenthesised - the variable decides the value where
 *   it is set, and the fallback where it is not;
 * - a `const` bound to any of those, a property of a `const` record holding
 *   one, and a name taken out of `process.env` by destructuring.
 *
 * Anything else is not the value of a variable, and the answer is nothing.
 */
export const environmentReadOf = (expression: TsNode): EnvironmentRead | undefined => {
  const fallbacks: TsNode[] = [];
  let current = expression;
  for (let step = 0; step < MOST_STEPS; step += 1) {
    const value = unwrapped(current, fallbacks);
    if (Node.isPropertyAccessExpression(value) && isProcessEnv(value.getExpression())) {
      return readOf(value.getName(), fallbacks);
    }
    if (Node.isElementAccessExpression(value) && isProcessEnv(value.getExpression())) {
      const key = value.getArgumentExpression();
      return key !== undefined && (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key))
        ? readOf(key.getLiteralValue(), fallbacks)
        : undefined;
    }
    const declaration = declarationOf(value);
    if (declaration === undefined) return undefined;
    const destructured = destructuredVariable(declaration, fallbacks);
    if (destructured !== undefined) return readOf(destructured, fallbacks);
    const bound = boundValue(declaration);
    if (bound === undefined) return undefined;
    current = bound;
  }
  return undefined;
};
