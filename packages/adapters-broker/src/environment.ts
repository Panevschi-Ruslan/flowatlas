import { Node, SyntaxKind, VariableDeclarationKind, type Node as TsNode } from 'ts-morph';

/** How many wrappers and bindings are followed before the answer is no. */
const MOST_STEPS = 8;

const isProcessEnv = (node: TsNode): boolean =>
  Node.isPropertyAccessExpression(node) &&
  node.getName() === 'env' &&
  node.getExpression().getText() === 'process';

/** What an expression evaluates to before the wrappers that leave it alone. */
const unwrapped = (node: TsNode): TsNode => {
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
        current = current.getLeft();
        continue;
      }
    }
    return current;
  }
  return current;
};

/** The variable a binding element takes out of `process.env`, when it does. */
const destructuredVariable = (declaration: TsNode): string | undefined => {
  if (!Node.isBindingElement(declaration)) return undefined;
  const pattern = declaration.getParent();
  const variable = pattern?.getParent();
  if (variable === undefined || !Node.isVariableDeclaration(variable)) return undefined;
  const source = variable.getInitializer();
  if (source === undefined || !isProcessEnv(unwrapped(source))) return undefined;
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
 * - the same with a fallback after it (`?? ''`, `|| ''`), asserted (`!`,
 *   `as string`) or parenthesised - the variable still decides the value;
 * - a `const` bound to any of those, a property of a `const` record holding
 *   one, and a name taken out of `process.env` by destructuring.
 *
 * Anything else is not the value of a variable, and the answer is nothing.
 */
export const environmentVariableOf = (expression: TsNode): string | undefined => {
  let current = expression;
  for (let step = 0; step < MOST_STEPS; step += 1) {
    const value = unwrapped(current);
    if (Node.isPropertyAccessExpression(value) && isProcessEnv(value.getExpression())) {
      return value.getName();
    }
    if (Node.isElementAccessExpression(value) && isProcessEnv(value.getExpression())) {
      const key = value.getArgumentExpression();
      return key !== undefined && (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key))
        ? key.getLiteralValue()
        : undefined;
    }
    const declaration = declarationOf(value);
    if (declaration === undefined) return undefined;
    const destructured = destructuredVariable(declaration);
    if (destructured !== undefined) return destructured;
    const bound = boundValue(declaration);
    if (bound === undefined) return undefined;
    current = bound;
  }
  return undefined;
};
