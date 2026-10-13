import { packageOfSpecifier } from '@flowatlas/core';
import { Node, SyntaxKind, type Node as TsNode } from 'ts-morph';

/**
 * Which package and which class the source says a receiver is, when the checker
 * cannot say.
 *
 * A fresh clone has no `node_modules`, so a client constructed from a library is
 * `any` to the checker and no publishing call on it was read: the reader asks
 * the receiver's type which package declared it, and nothing answers. The two
 * facts it needs are written in the repository whether or not anything is
 * installed:
 *
 *     import { SQSClient } from '@aws-sdk/client-sqs';
 *     const sqs = new SQSClient({});
 *
 * The construction names the class and the import names the package. This
 * reads them, the way the data layer reads an annotated receiver and the entry
 * side reads an application's maker (R122, R142), and for the same reason: the
 * statement is there in every state of the repository.
 *
 * It is the checker's fallback and never its rival - asked only where the
 * checker resolved no type at all - and what it finds is what the author
 * wrote rather than what a compiler checked, which the caller records by
 * drawing what follows from it as `heuristic`.
 */
export interface StatedOrigin {
  readonly package: string;
  readonly typeName: string;
}

/** How many bindings are followed back to the statement of a type. */
const MOST_STEPS = 6;

/** The expression a value's initialiser states its class with, when it constructs one. */
const constructedBy = (initializer: TsNode | undefined): TsNode | undefined => {
  if (initializer === undefined) return undefined;
  if (Node.isParenthesizedExpression(initializer)) return constructedBy(initializer.getExpression());
  if (Node.isAsExpression(initializer)) return initializer.getTypeNode();
  if (Node.isNewExpression(initializer)) return initializer.getExpression();
  if (Node.isBinaryExpression(initializer)) {
    const operator = initializer.getOperatorToken().getKind();
    if (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken) {
      return constructedBy(initializer.getRight());
    }
  }
  return undefined;
};

/**
 * Where a declaration states the class of what it holds: its annotation, or the
 * construction it was initialised with.
 */
const statedBy = (declaration: TsNode): TsNode | undefined => {
  if (Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration)) {
    return declaration.getTypeNode() ?? constructedBy(declaration.getInitializer());
  }
  if (Node.isParameterDeclaration(declaration) || Node.isPropertySignature(declaration)) {
    return declaration.getTypeNode();
  }
  return undefined;
};

/** The written name of a class, as its last name and the binding it starts from. */
const namesOf = (statement: TsNode): { last: string; root: TsNode } | undefined => {
  const name = Node.isTypeReference(statement) ? statement.getTypeName() : statement;
  if (Node.isIdentifier(name)) return { last: name.getText(), root: name };
  if (Node.isPropertyAccessExpression(name)) {
    const root = namesOf(name.getExpression());
    return root === undefined ? undefined : { last: name.getName(), root: root.root };
  }
  if (Node.isQualifiedName(name)) {
    const root = namesOf(name.getLeft());
    return root === undefined ? undefined : { last: name.getRight().getText(), root: root.root };
  }
  return undefined;
};

/** The module a `require('…')` call names. */
const requiredModule = (node: TsNode | undefined): string | undefined => {
  if (node === undefined || !Node.isCallExpression(node)) return undefined;
  if (node.getExpression().getText() !== 'require') return undefined;
  const [specifier] = node.getArguments();
  return specifier !== undefined && Node.isStringLiteral(specifier) ? specifier.getLiteralValue() : undefined;
};

/**
 * The module a binding was imported from, and the name it has there.
 *
 * A named import is known in its module by the name before any `as`; a default
 * or a namespace import is the module itself, and the class is the last name
 * written after it, so `exported` is left to the caller.
 */
export const importOf = (binding: TsNode): { module: string; exported?: string } | undefined => {
  const declaration = binding.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  if (Node.isImportSpecifier(declaration)) {
    return {
      module: declaration.getImportDeclaration().getModuleSpecifierValue(),
      exported: declaration.getName(),
    };
  }
  if (Node.isImportClause(declaration) || Node.isNamespaceImport(declaration)) {
    const statement = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    return statement === undefined ? undefined : { module: statement.getModuleSpecifierValue() };
  }
  if (Node.isImportEqualsDeclaration(declaration)) {
    const reference = declaration.getModuleReference();
    return Node.isExternalModuleReference(reference)
      ? { module: reference.getExpressionOrThrow().getText().replace(/^['"]|['"]$/g, '') }
      : undefined;
  }
  if (Node.isVariableDeclaration(declaration)) {
    const module = requiredModule(declaration.getInitializer());
    return module === undefined ? undefined : { module };
  }
  if (Node.isBindingElement(declaration)) {
    const variable = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    const module = requiredModule(variable?.getInitializer());
    return module === undefined
      ? undefined
      : { module, exported: declaration.getPropertyNameNode()?.getText() ?? declaration.getName() };
  }
  return undefined;
};

/** The node that states a receiver's class: its construction, or what declared it. */
const statementOf = (receiver: TsNode): TsNode | undefined => {
  let current = receiver;
  for (let step = 0; step < MOST_STEPS; step += 1) {
    if (Node.isParenthesizedExpression(current) || Node.isNonNullExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isNewExpression(current)) return current.getExpression();
    if (!Node.isIdentifier(current) && !Node.isPropertyAccessExpression(current)) return undefined;
    // A client constructed in one module of the repository and imported into
    // another is declared where it was constructed, and that module is the
    // repository's own, so the checker follows the import with nothing installed.
    const symbol = current.getSymbol();
    const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
    return declaration === undefined ? undefined : statedBy(declaration);
  }
  return undefined;
};

export const statedOrigin = (receiver: TsNode): StatedOrigin | undefined => {
  const statement = statementOf(receiver);
  if (statement === undefined) return undefined;
  const names = namesOf(statement);
  if (names === undefined) return undefined;
  const imported = importOf(names.root);
  if (imported === undefined) return undefined;
  const pkg = packageOfSpecifier(imported.module);
  if (pkg === undefined) return undefined;
  // `import { SQSClient as Queue }` constructs `new Queue()`: the class is the
  // one the package exports, and that is the name it is described by. Written
  // after a namespace - `new AWS.SQS()` - the last name is the class.
  const written = names.last === names.root.getText();
  return { package: pkg, typeName: written ? (imported.exported ?? names.last) : names.last };
};
