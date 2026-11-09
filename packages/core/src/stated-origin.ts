import { packageOfSpecifier } from './adapters/manifest.js';
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
 *     import { QueueClient } from '@acme/queue-client';
 *     const queue = new QueueClient({});
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

/** The containers whose element type is their last type argument, read as written. */
const KEYED_CONTAINERS: ReadonlySet<string> = new Set(['Record', 'Map', 'ReadonlyMap', 'Partial', 'Readonly']);
const LISTS: ReadonlySet<string> = new Set(['Array', 'ReadonlyArray']);

/**
 * The type a container's annotation says each of its entries is.
 *
 * `Record<QueueName, Queue>`, `Map<string, Queue>`, `Queue[]`, `{ [name:
 * string]: Queue }`: a registry of a library's clients keyed by what each one
 * is for. A `Partial` or a `Readonly` of one is the same registry.
 */
const entryOf = (statement: TsNode | undefined, depth = 0): TsNode | undefined => {
  if (statement === undefined || depth > 2) return undefined;
  if (Node.isArrayTypeNode(statement)) return statement.getElementTypeNode();
  if (Node.isTypeLiteral(statement)) {
    const [index] = statement.getIndexSignatures();
    return index?.getReturnTypeNode();
  }
  if (!Node.isTypeReference(statement)) return undefined;
  const name = statement.getTypeName().getText();
  const args = statement.getTypeArguments();
  if (name === 'Partial' || name === 'Readonly') return entryOf(args[0], depth + 1);
  if (KEYED_CONTAINERS.has(name)) return args.at(-1);
  if (LISTS.has(name)) return args[0];
  return undefined;
};

/** The declaration a name or `this.name` stands for, past an import. */
const declaredAs = (node: TsNode): TsNode | undefined => {
  const symbol = node.getSymbol();
  return (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
};

/**
 * A registry and the key a value is looked up in it by: `this.queues[name]`
 * or `this.queues.get(name)`.
 */
export const registryOf = (receiver: TsNode): { registry: TsNode; key: TsNode } | undefined => {
  if (Node.isElementAccessExpression(receiver)) {
    const key = receiver.getArgumentExpression();
    return key === undefined ? undefined : { registry: receiver.getExpression(), key };
  }
  if (!Node.isCallExpression(receiver)) return undefined;
  const callee = receiver.getExpression();
  const [key, ...rest] = receiver.getArguments();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'get' || key === undefined || rest.length > 0) return undefined;
  return { registry: callee.getExpression(), key };
};

/** The entry of a registry a receiver is, as the registry's annotation states it. */
const registryEntryOf = (receiver: TsNode): TsNode | undefined => {
  const registry = registryOf(receiver)?.registry;
  if (registry === undefined) return undefined;
  if (!Node.isIdentifier(registry) && !Node.isPropertyAccessExpression(registry)) return undefined;
  const declaration = declaredAs(registry);
  if (declaration === undefined) return undefined;
  if (!Node.isVariableDeclaration(declaration) && !Node.isPropertyDeclaration(declaration) && !Node.isParameterDeclaration(declaration)) {
    return undefined;
  }
  const annotation = declaration.getTypeNode();
  if (annotation !== undefined) return entryOf(annotation);
  // `new Map<string, Queue>()`, or a value asserted to be one, says the same
  // with no annotation.
  const initial = declaration.getInitializer();
  if (initial !== undefined && Node.isAsExpression(initial)) return entryOf(initial.getTypeNode());
  if (initial === undefined || !Node.isNewExpression(initial)) return undefined;
  const name = initial.getExpression().getText();
  const args = initial.getTypeArguments();
  return KEYED_CONTAINERS.has(name) ? args.at(-1) : LISTS.has(name) ? args[0] : undefined;
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
    // An entry of a registry of clients is the class the registry says it
    // holds: `this.queues[name].add(…)` on `queues: Record<QueueName, Queue>`
    // is a call on a `Queue` whether or not the package is installed (P267).
    if (Node.isElementAccessExpression(current) || Node.isCallExpression(current)) return registryEntryOf(current);
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
  // `import { QueueClient as Queue }` constructs `new Queue()`: the class is the
  // one the package exports, and that is the name it is described by. Written
  // after a namespace - `new kit.Queue()` - the last name is the class.
  const written = names.last === names.root.getText();
  return { package: pkg, typeName: written ? (imported.exported ?? names.last) : names.last };
};
