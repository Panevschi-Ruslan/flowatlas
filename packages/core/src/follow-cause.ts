/**
 * Why a step could not be followed, read off the code (P75).
 *
 * A call whose receiver has no class, a type the checker gave up on and an
 * injection with nothing to point at all end in the same row: "could not
 * follow". What a reader needs next is the one fact that row never said - why.
 * A package nobody installed is fixed by an install; a callback whose parameter
 * nobody typed is fixed by an annotation; a method picked by `obj[key]()` is
 * not fixed at all. Those are different jobs, and a list that does not tell
 * them apart is a list nobody works through.
 *
 * Every answer is a short cause code and, where the code points into one, the
 * package or module it points at. Nothing here guesses by name: each cause is a
 * fact the checker or the syntax states.
 */
import type { ClassDeclaration, ImportDeclaration, Node as TsNode, SourceFile, Type } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { packageOfSpecifier } from './adapters/manifest.js';
import { packageOfPath } from './origin.js';

/** A cause code, and the package or module it points into when it points into one. */
export interface FollowCause {
  readonly cause: string;
  readonly package?: string;
}

/** How far a chain of names is followed before the answer is "untyped". */
const DEPTH = 6;

const isRelative = (specifier: string): boolean => specifier.startsWith('.') || specifier.startsWith('/');

/** The package a bare specifier names; a built-in module of the runtime is answered by its type declarations. */
const packageNamed = (specifier: string): string =>
  specifier.startsWith('node:') ? '@types/node' : (packageOfSpecifier(specifier) ?? specifier);

/** Whether a bare specifier is one of the project's own path aliases rather than a package. */
const isPathAlias = (specifier: string, sourceFile: SourceFile): boolean => {
  const paths = sourceFile.getProject().getCompilerOptions().paths ?? {};
  return Object.keys(paths).some((pattern) => {
    const star = pattern.indexOf('*');
    return star < 0 ? specifier === pattern : specifier.startsWith(pattern.slice(0, star));
  });
};

/**
 * Why an import resolves to nothing, or undefined when it resolves.
 *
 * A module the checker answers - a file, a package, an ambient declaration -
 * has a symbol at its specifier; one it cannot has none. A relative path or a
 * path alias that answers nothing is the project's own wiring; any other bare
 * name is a package that is not installed.
 */
const unresolvedImport = (declaration: ImportDeclaration): FollowCause | undefined => {
  if (declaration.getModuleSpecifier().getSymbol() !== undefined) return undefined;
  if (declaration.getModuleSpecifierSourceFile() !== undefined) return undefined;
  const specifier = declaration.getModuleSpecifierValue();
  // A path written into an installed package's directory is that package,
  // however many `../` it starts with.
  const intoPackage = packageOfPath(specifier.startsWith('/') ? specifier : `/${specifier}`);
  if (intoPackage !== null) return { cause: 'module-not-installed', package: intoPackage };
  if (isRelative(specifier) || isPathAlias(specifier, declaration.getSourceFile())) {
    return { cause: 'import-unresolved', package: specifier };
  }
  return { cause: 'module-not-installed', package: packageNamed(specifier) };
};

/**
 * The globals the runtime declares through its type declarations rather than
 * through the language's: with those not installed, each is a name nothing
 * declares, and installing them is the whole fix.
 */
const RUNTIME_GLOBALS: ReadonlySet<string> = new Set([
  'Buffer',
  'URL',
  'URLSearchParams',
  '__dirname',
  '__filename',
  'clearInterval',
  'clearTimeout',
  'console',
  'exports',
  'global',
  'module',
  'process',
  'require',
  'setImmediate',
  'setInterval',
  'setTimeout',
  'structuredClone',
  'TextDecoder',
  'TextEncoder',
]);

/** A name with no declaration: a runtime global whose types are missing, or nothing at all. */
const undeclared = (name: string): FollowCause =>
  RUNTIME_GLOBALS.has(name) ? { cause: 'module-not-installed', package: '@types/node' } : { cause: 'name-undeclared' };

/** The import a declaration belongs to, when it is one of an import's names. */
const importOf = (declaration: TsNode): ImportDeclaration | undefined =>
  Node.isImportSpecifier(declaration) || Node.isImportClause(declaration) || Node.isNamespaceImport(declaration)
    ? declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
    : undefined;

/**
 * Why a name brought in by an import could not be read, or undefined when the
 * import is not why.
 *
 * The module may resolve and still not export the name: an index that stopped
 * re-exporting it leaves every use of it typed as nothing at all.
 */
const importCauseOf = (name: TsNode, depth = 0): FollowCause | undefined => {
  const symbol = name.getSymbol();
  if (symbol === undefined) return undeclared(name.getText());
  for (const declaration of symbol.getDeclarations()) {
    const imported = importOf(declaration);
    if (imported === undefined) continue;
    const missing = unresolvedImport(imported);
    if (missing !== undefined) return missing;
    if (Node.isNamespaceImport(declaration)) return undefined;
    const target = symbol.getAliasedSymbol();
    const exported = target?.getDeclarations()[0];
    if (exported === undefined) {
      const specifier = imported.getModuleSpecifierValue();
      return { cause: 're-export-missing', ...(isRelative(specifier) ? {} : { package: packageNamed(specifier) }) };
    }
    // The module resolves and exports the name: why it holds nothing is in
    // the module, where the name is declared - `export default logger`, made
    // by a call into a package nobody installed, is answered there.
    return causeOfDeclaration(exported, depth + 1);
  }
  return undefined;
};

/**
 * Why a name written in a file could not be read, looked up by the name alone.
 *
 * What the checker hands over for a type it could not resolve is its text and
 * nothing else; the import that brought the name in is still in the file, and
 * it is the import that says why.
 */
const causeOfName = (sourceFile: SourceFile, name: string): FollowCause | undefined => {
  for (const declaration of sourceFile.getImportDeclarations()) {
    const names = [
      declaration.getDefaultImport(),
      declaration.getNamespaceImport(),
      ...declaration.getNamedImports().map((named) => named.getAliasNode() ?? named.getNameNode()),
    ];
    const found = names.find((node) => node !== undefined && node.getText() === name);
    if (found === undefined) continue;
    return unresolvedImport(declaration) ?? importCauseOf(found);
  }
  return undefined;
};

/** The leftmost name of `a.b.C`, which is the one an import brings in. */
const leftmostName = (name: TsNode): TsNode => {
  let at = name;
  while (Node.isQualifiedName(at)) at = at.getLeft();
  return at;
};

const isAnyLike = (type: Type): boolean => type.isAny() || type.isUnknown();

/** A declaration file of the language itself, whose `any` nobody in the project wrote. */
const isLibFile = (filePath: string): boolean => /\/lib\.[^/]*\.d\.ts$/.test(filePath);

/**
 * Why a written type gives nothing to follow, or undefined when nothing in how
 * it is written says.
 */
export const causeOfTypeNode = (node: TsNode, depth = 0): FollowCause | undefined => {
  if (depth > DEPTH) return undefined;
  const kind = node.getKind();
  if (kind === SyntaxKind.AnyKeyword) {
    const writtenIn = node.getSourceFile().getFilePath();
    if (isLibFile(writtenIn)) return { cause: 'language-any' };
    // An `any` a package declares is the package's, and installing a newer
    // one, or its types, is how it goes.
    const pkg = packageOfPath(writtenIn);
    return pkg === null ? { cause: 'any-typed' } : { cause: 'any-typed', package: pkg };
  }
  if (kind === SyntaxKind.UnknownKeyword) return { cause: 'unknown-typed' };
  if (Node.isParenthesizedTypeNode(node)) return causeOfTypeNode(node.getTypeNode(), depth + 1);
  if (Node.isArrayTypeNode(node)) return causeOfTypeNode(node.getElementTypeNode(), depth + 1);
  if (Node.isUnionTypeNode(node) || Node.isIntersectionTypeNode(node)) {
    for (const member of node.getTypeNodes()) {
      const found = causeOfTypeNode(member, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!Node.isTypeReference(node)) return undefined;
  const name = node.getTypeName();
  const imported = importCauseOf(leftmostName(name), depth + 1);
  if (imported !== undefined) return imported;
  const declaration = (name.getSymbol()?.getAliasedSymbol() ?? name.getSymbol())?.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  const declaredIn = declaration.getSourceFile().getFilePath();
  if (isLibFile(declaredIn)) return isAnyLike(node.getType()) ? { cause: 'language-any' } : undefined;
  const pkg = packageOfPath(declaredIn);
  if (pkg !== null && isAnyLike(node.getType())) return { cause: 'any-typed', package: pkg };
  if (Node.isTypeAliasDeclaration(declaration)) {
    const aliased = declaration.getTypeNode();
    return aliased === undefined ? undefined : causeOfTypeNode(aliased, depth + 1);
  }
  return undefined;
};

/** A function written in place as the argument of a call: a callback. */
const isCallbackOf = (fn: TsNode): boolean => {
  const parent = fn.getParent();
  return (
    (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) &&
    parent !== undefined &&
    (Node.isCallExpression(parent) || Node.isNewExpression(parent)) &&
    parent.getArguments().includes(fn)
  );
};

/** Why a declared name holds nothing to follow. */
const causeOfDeclaration = (declaration: TsNode, depth: number): FollowCause | undefined => {
  if (depth > DEPTH) return undefined;
  const imported = importOf(declaration);
  if (imported !== undefined) {
    const name = Node.isImportSpecifier(declaration)
      ? (declaration.getAliasNode() ?? declaration.getNameNode())
      : Node.isImportClause(declaration)
        ? declaration.getDefaultImport()
        : undefined;
    return unresolvedImport(imported) ?? (name === undefined ? undefined : importCauseOf(name, depth + 1));
  }
  if (Node.isExportAssignment(declaration)) return whyAny(declaration.getExpression(), depth + 1);
  if (Node.isExportSpecifier(declaration)) {
    const local = declaration.getLocalTargetDeclarations()[0];
    return local === undefined ? undefined : causeOfDeclaration(local, depth + 1);
  }
  if (Node.isBindingElement(declaration)) {
    // `{ orders }` takes its type from what is destructured, so that is asked.
    const holder = declaration.getFirstAncestor(
      (node) => Node.isVariableDeclaration(node) || Node.isParameterDeclaration(node),
    );
    return holder === undefined ? undefined : causeOfDeclaration(holder, depth + 1);
  }
  if (Node.isParameterDeclaration(declaration)) {
    const written = declaration.getTypeNode();
    if (written !== undefined) return causeOfTypeNode(written, depth + 1) ?? { cause: 'untyped-value' };
    const initializer = declaration.getInitializer();
    if (initializer !== undefined) return whyAny(initializer, depth + 1);
    return { cause: isCallbackOf(declaration.getParent()) ? 'callback-param' : 'untyped-parameter' };
  }
  if (
    Node.isVariableDeclaration(declaration) ||
    Node.isPropertyDeclaration(declaration) ||
    Node.isPropertySignature(declaration)
  ) {
    const written = declaration.getTypeNode();
    if (written !== undefined) return causeOfTypeNode(written, depth + 1) ?? { cause: 'untyped-value' };
    const initializer = Node.isPropertySignature(declaration) ? undefined : declaration.getInitializer();
    return initializer === undefined ? { cause: 'untyped-value' } : whyAny(initializer, depth + 1);
  }
  if (Node.isPropertyAssignment(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer === undefined ? undefined : whyAny(initializer, depth + 1);
  }
  if (Node.isShorthandPropertyAssignment(declaration)) {
    return whyAny(declaration.getNameNode(), depth + 1);
  }
  return undefined;
};

/** The written return type of whatever a call calls, when it writes one. */
const returnTypeNodeOf = (callee: TsNode): TsNode | undefined => {
  const declaration = callee.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  if (
    Node.isFunctionDeclaration(declaration) ||
    Node.isMethodDeclaration(declaration) ||
    Node.isMethodSignature(declaration) ||
    Node.isArrowFunction(declaration) ||
    Node.isFunctionExpression(declaration)
  ) {
    return declaration.getReturnTypeNode();
  }
  return undefined;
};

/**
 * Why an expression the checker typed as nothing is typed as nothing.
 *
 * Walked back the way the value came: a name to its declaration, a member to
 * what it is a member of, a call to what it calls. The first link that says
 * why is the answer.
 */
const whyAny = (expr: TsNode, depth: number): FollowCause | undefined => {
  if (depth > DEPTH) return undefined;
  if (
    Node.isParenthesizedExpression(expr) ||
    Node.isNonNullExpression(expr) ||
    Node.isAwaitExpression(expr)
  ) {
    return whyAny(expr.getExpression(), depth + 1);
  }
  if (Node.isAsExpression(expr) || Node.isTypeAssertion(expr)) {
    const written = expr.getTypeNode();
    return (written === undefined ? undefined : causeOfTypeNode(written, depth + 1)) ?? whyAny(expr.getExpression(), depth + 1);
  }
  if (Node.isElementAccessExpression(expr)) return { cause: 'dynamic-member' };
  if (Node.isBinaryExpression(expr)) {
    // `items || []`, `a ?? b`: whichever side is typed by nothing is why.
    return whyAny(expr.getLeft(), depth + 1) ?? whyAny(expr.getRight(), depth + 1);
  }
  if (Node.isConditionalExpression(expr)) {
    return whyAny(expr.getWhenTrue(), depth + 1) ?? whyAny(expr.getWhenFalse(), depth + 1);
  }
  if (Node.isIdentifier(expr)) {
    const symbol = expr.getSymbol();
    if (symbol === undefined) return undeclared(expr.getText());
    const declaration = symbol.getDeclarations()[0];
    return declaration === undefined ? undeclared(expr.getText()) : causeOfDeclaration(declaration, depth + 1);
  }
  if (Node.isPropertyAccessExpression(expr)) {
    const held = expr.getExpression();
    if (!Node.isThisExpression(held) && isAnyLike(held.getType())) return whyAny(held, depth + 1);
    const declaration = expr.getNameNode().getSymbol()?.getDeclarations()[0];
    if (declaration === undefined) return undefined;
    // A constructor parameter that is also a property is declared as the parameter.
    return causeOfDeclaration(declaration, depth + 1);
  }
  if (Node.isCallExpression(expr)) {
    const callee = expr.getExpression();
    if (isAnyLike(callee.getType())) return whyAny(callee, depth + 1);
    const written = returnTypeNodeOf(callee);
    return written === undefined ? undefined : causeOfTypeNode(written, depth + 1);
  }
  if (Node.isNewExpression(expr)) return whyAny(expr.getExpression(), depth + 1);
  return undefined;
};

/** What a declared type that is not a class is, as a cause. */
const causeOfShape = (type: Type): FollowCause => {
  if (type.isUnion()) return { cause: 'union-receiver' };
  if (type.isTypeParameter()) return { cause: 'generic-receiver' };
  const declaration = (type.getSymbol() ?? type.getAliasSymbol())?.getDeclarations()[0];
  if (declaration === undefined) return { cause: 'other-type' };
  if (Node.isInterfaceDeclaration(declaration) || Node.isTypeAliasDeclaration(declaration) || Node.isTypeLiteral(declaration)) {
    return { cause: 'interface-type' };
  }
  if (Node.isObjectLiteralExpression(declaration) || Node.isVariableDeclaration(declaration)) {
    return { cause: 'object-literal' };
  }
  if (
    Node.isArrowFunction(declaration) ||
    Node.isFunctionDeclaration(declaration) ||
    Node.isFunctionExpression(declaration) ||
    Node.isFunctionTypeNode(declaration) ||
    Node.isMethodSignature(declaration) ||
    Node.isMethodDeclaration(declaration)
  ) {
    return { cause: 'function-value' };
  }
  if (Node.isSourceFile(declaration) || Node.isModuleDeclaration(declaration)) return { cause: 'module-namespace' };
  if (Node.isEnumDeclaration(declaration)) return { cause: 'other-type' };
  return { cause: 'other-type' };
};

/**
 * Why the receiver of a call names no class to follow.
 *
 * Asked only once the resolver has said there is none, so every answer is one
 * of the ways that happens; the last of them, when nothing says more, is that
 * the value has no type anybody wrote.
 */
export const whyNoClass = (expr: TsNode, owner?: ClassDeclaration): FollowCause => {
  try {
    return whyNoClassOf(expr, owner);
  } catch {
    // A question the checker throws on is not worth losing the row over.
    return { cause: 'other-type' };
  }
};

const whyNoClassOf = (expr: TsNode, owner?: ClassDeclaration): FollowCause => {
  if (Node.isThisExpression(expr)) return { cause: owner === undefined ? 'this-outside-class' : 'other-type' };
  if (Node.isSuperExpression(expr)) return { cause: 'no-base-class' };
  if (Node.isElementAccessExpression(expr)) return { cause: 'dynamic-member' };
  const type = expr.getType();
  if (isAnyLike(type)) {
    return whyAny(expr, 0) ?? { cause: type.isUnknown() ? 'unknown-typed' : 'untyped-value' };
  }
  return causeOfShape(type);
};

/**
 * Why a value has no type to read, or undefined when it has one.
 *
 * For a reader that classifies a value by its type and fell back on its name:
 * the fallback is only worth explaining when the type was missing.
 */
export const whyUntyped = (expr: TsNode): FollowCause | undefined =>
  isAnyLike(expr.getType()) ? whyNoClass(expr) : undefined;

/** The leading name of a type's text: `Repo` of `Repo<X>`, `ns` of `ns.Type`. */
const LEADING_NAME = /^[A-Za-z_$][\w$]*/;

/**
 * Why the checker could not resolve a type met at a site.
 *
 * The site is where the type was asked for - a parameter, a property, a
 * method - and `text` what the checker printed for it. The import of the name
 * the text leads with comes first, because that is what decides it on a
 * repository nobody installed; the site's own written type after.
 */
export const causeOfUnresolvedType = (site: TsNode, text: string): FollowCause | undefined => {
  const name = LEADING_NAME.exec(text)?.[0];
  if (name !== undefined && name !== 'any') {
    const byName = causeOfName(site.getSourceFile(), name);
    if (byName !== undefined) return byName;
  }
  const written = (site as { getTypeNode?: () => TsNode | undefined }).getTypeNode?.();
  if (written !== undefined) {
    const byType = causeOfTypeNode(written);
    if (byType !== undefined) return byType;
  }
  return causeOfDeclaration(site, 0);
};

/** The parameter's declared type, read for why an injection names no class. */
export const causeOfParameterType = (parameter: TsNode): FollowCause | undefined => {
  const written = (parameter as { getTypeNode?: () => TsNode | undefined }).getTypeNode?.();
  if (written === undefined) return { cause: 'untyped-parameter' };
  return causeOfTypeNode(written);
};
