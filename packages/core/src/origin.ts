import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ClassDeclaration, Node as TsNode, Type } from 'ts-morph';
import { Node } from 'ts-morph';

/**
 * Where the type of a value was declared.
 *
 * This is the whole basis for telling a data access apart from an ordinary call.
 * A receiver named `orderRepo` proves nothing; a receiver whose type is declared
 * in a database package proves a great deal. Names are never the signal.
 */
export interface TypeOrigin {
  /**
   * Package that declares the type, or null when this repository does.
   * A repository base class named in the configuration reads as `local:<Base>`.
   */
  package: string | null;
  typeName: string;
  /** Arguments of the declared type, e.g. the entity of a repository. */
  typeArgs: Type[];
  isLocal: boolean;
  declaration?: TsNode;
}

export interface ResolveOriginOptions {
  /**
   * Classes declared in this repository that stand for a data layer.
   *
   * A project with its own repository base has no database package to point at,
   * so this is how it is named without the core learning anything about it.
   */
  localBaseClasses?: readonly string[];
}

/** Wrappers that describe delivery rather than the thing delivered. */
const ASYNC_WRAPPERS = new Set(['Promise', 'Observable']);

const LIB_FILE = /\/lib\.[^/]*\.d\.ts$/;

/**
 * The package a file belongs to.
 *
 * The last `node_modules` segment wins, which is what makes a nested store
 * layout resolve to the package itself rather than to the directory the store
 * keeps its copies in.
 */
export const packageOfPath = (filePath: string): string | null => {
  const marker = '/node_modules/';
  const at = filePath.lastIndexOf(marker);
  if (at < 0) return null;
  const parts = filePath.slice(at + marker.length).split('/');
  const [first, second] = parts;
  if (first === undefined) return null;
  return first.startsWith('@') && second !== undefined ? `${first}/${second}` : first;
};

const manifestCache = new Map<string, string | null>();

/**
 * The package a file belongs to, by the nearest manifest above it.
 *
 * Going by the path alone is wrong wherever a package is reached through a link
 * rather than a copy, which is how a workspace resolves its own packages: the
 * file then has no `node_modules` in its path at all.
 */
export const packageNameOf = (filePath: string): string | null => {
  let dir = dirname(filePath);
  for (let up = 0; up < 12; up += 1) {
    const cached = manifestCache.get(dir);
    if (cached !== undefined) return cached;
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      let name: string | null = null;
      try {
        name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name ?? null;
      } catch {
        name = null;
      }
      manifestCache.set(dir, name);
      return name;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
};

/** Unwraps a type that only describes when a value arrives. */
export const unwrapDelivery = (type: Type): Type => {
  let current = type;
  for (let depth = 0; depth < 8; depth += 1) {
    const name = current.getSymbol()?.getName() ?? current.getAliasSymbol()?.getName();
    if (name === undefined || !ASYNC_WRAPPERS.has(name)) return current;
    const [argument] = current.getTypeArguments();
    if (argument === undefined) return current;
    current = argument;
  }
  return current;
};

const firstObjectOfUnion = (type: Type): Type => {
  if (!type.isUnion()) return type;
  const objects = type.getUnionTypes().filter((member) => member.isObject() && !member.isNull());
  return objects[0] ?? type;
};

/**
 * The first base class declared in a package.
 *
 * Wrapping a library's client in a class of one's own is the ordinary way to put
 * it in a container, and the wrapper is still that client. Without this, the
 * wrapper looks like local code and every call through it loses its origin.
 */
const packagedBaseOf = (
  declaration: ClassDeclaration,
): { pkg: string; typeName: string; typeArgs: Type[] } | undefined => {
  let current: ClassDeclaration | undefined = declaration;
  for (let depth = 0; current !== undefined && depth < 8; depth += 1) {
    const base: ClassDeclaration | undefined = current.getBaseClass();
    if (base === undefined) return undefined;
    const pkg = packageOfPath(base.getSourceFile().getFilePath());
    if (pkg !== null) {
      const clause = current.getExtends();
      return {
        pkg,
        typeName: base.getName() ?? pkg,
        typeArgs: clause === undefined ? [] : clause.getTypeArguments().map((a) => a.getType()),
      };
    }
    current = base;
  }
  return undefined;
};

/**
 * Finds the class named in the configuration, starting at this one.
 *
 * The type arguments returned are the ones handed to a base, because that is
 * where a repository names the thing it stores. A class named in its own right
 * returns none, leaving the caller to use the receiver's.
 */
const localBaseOf = (
  declaration: ClassDeclaration,
  names: ReadonlySet<string>,
): { base: string; typeArgs: Type[] } | undefined => {
  let current: ClassDeclaration | undefined = declaration;
  for (let depth = 0; current !== undefined && depth < 8; depth += 1) {
    // A class named in the configuration is a data layer whether it is the base
    // of a hierarchy or stands on its own. Its own type arguments are left to
    // the caller, which already has them from the receiver.
    const ownName = current.getName();
    if (ownName !== undefined && names.has(ownName)) return { base: ownName, typeArgs: [] };
    const extendsClause = current.getExtends();
    if (extendsClause === undefined) return undefined;
    const baseName = extendsClause.getExpression().getText().split('<')[0]?.trim() ?? '';
    if (names.has(baseName)) {
      return {
        base: baseName,
        typeArgs: extendsClause.getTypeArguments().map((argument) => argument.getType()),
      };
    }
    current = current.getBaseClass();
  }
  return undefined;
};

/**
 * Resolves what an expression's type is and where it came from.
 *
 * Returns null only when the checker will not commit to a type at all, which is
 * itself worth reporting: it usually means the repository's dependencies are not
 * installed.
 */
export const resolveTypeOrigin = (
  node: TsNode,
  options: ResolveOriginOptions = {},
): TypeOrigin | null => {
  const resolved = firstObjectOfUnion(unwrapDelivery(node.getType()));
  const symbol = resolved.getSymbol() ?? resolved.getAliasSymbol();
  if (symbol === undefined) return null;

  const declaration = symbol.getDeclarations()[0];
  if (declaration === undefined) return null;

  const filePath = declaration.getSourceFile().getFilePath();
  const typeName = symbol.getName();
  const typeArgs = resolved.getTypeArguments();

  if (LIB_FILE.test(filePath)) {
    return { package: null, typeName, typeArgs, isLocal: false, declaration };
  }

  const pkg = packageOfPath(filePath);
  if (pkg !== null) {
    return { package: pkg, typeName, typeArgs, isLocal: false, declaration };
  }

  const bases = new Set(options.localBaseClasses ?? []);
  if (bases.size > 0 && Node.isClassDeclaration(declaration)) {
    const found = localBaseOf(declaration, bases);
    if (found !== undefined) {
      return {
        package: `local:${found.base}`,
        typeName,
        typeArgs: found.typeArgs.length > 0 ? found.typeArgs : typeArgs,
        isLocal: true,
        declaration,
      };
    }
  }

  // A class of one's own wrapping a library's is still that library.
  if (Node.isClassDeclaration(declaration)) {
    const packaged = packagedBaseOf(declaration);
    if (packaged !== undefined) {
      return {
        package: packaged.pkg,
        typeName: packaged.typeName,
        typeArgs: packaged.typeArgs.length > 0 ? packaged.typeArgs : typeArgs,
        isLocal: false,
        declaration,
      };
    }
  }

  return { package: null, typeName, typeArgs, isLocal: true, declaration };
};

/** Name of the entity a data layer is parameterised by, if it names one. */
export const entityNameOf = (origin: TypeOrigin): string | null => {
  const [first] = origin.typeArgs;
  if (first === undefined) return null;
  const resolved = firstObjectOfUnion(first);
  // Inside a generic data layer the argument is still the parameter itself, and
  // `T` is not the name of anything stored.
  if (resolved.isTypeParameter()) return null;
  const name = resolved.getSymbol()?.getName() ?? resolved.getAliasSymbol()?.getName();
  if (name === undefined || name === '__type') return null;
  return name;
};

/** Suffixes a persistence layer adds to the name of the thing being stored. */
const WRAPPER_SUFFIXES = ['Document', 'Entity', 'Schema', 'Model'] as const;

/**
 * The stored thing's own name.
 *
 * A persisted model is often declared as `OrderDocument` while the data it
 * stands for is an order, and the name of the data is what a reader is looking
 * for. The original is kept alongside so nothing is lost.
 */
export const stripWrapperSuffix = (name: string): string => {
  for (const suffix of WRAPPER_SUFFIXES) {
    if (name.length > suffix.length && name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
};

/**
 * The type a call's parameter is declared as, rather than the type of whatever
 * was passed.
 *
 * For a comparison across a service boundary the declared type is the contract:
 * it is what both sides agreed to. The shape of one argument is only ever one
 * instance of that contract, and the compiler already checks it locally.
 *
 * Returns undefined when the parameter is declared as `unknown` or `any`, since
 * a declaration that promises nothing says less than the value does.
 */
export const declaredParameterType = (
  call: TsNode,
  index: number,
  checker: { getResolvedSignature(node: never): { getParameters(): TsSymbolLike[] } | undefined },
): Type | undefined => {
  try {
    const signature = checker.getResolvedSignature(call as never);
    const parameter = signature?.getParameters()[index];
    if (parameter === undefined) return undefined;
    const type = parameter.getTypeAtLocation(call);
    if (type.isAny() || type.isUnknown()) return undefined;
    return type;
  } catch {
    return undefined;
  }
};

interface TsSymbolLike {
  getTypeAtLocation(node: TsNode): Type;
}

/**
 * Where a type or value was declared.
 *
 * `builtin` is the language's own library. It is neither a dependency worth
 * counting nor a failure worth reporting: calling `Array.reduce` says nothing
 * about the shape of the system.
 */
export type Origin =
  | { readonly kind: 'local'; readonly declaration: TsNode }
  | { readonly kind: 'external'; readonly package: string; readonly typeName: string }
  | { readonly kind: 'builtin'; readonly typeName: string }
  | { readonly kind: 'unknown' };

const nameOfDeclaration = (declaration: TsNode, fallback: string): string => {
  if (
    Node.isClassDeclaration(declaration) ||
    Node.isInterfaceDeclaration(declaration) ||
    Node.isFunctionDeclaration(declaration) ||
    Node.isTypeAliasDeclaration(declaration) ||
    Node.isVariableDeclaration(declaration)
  ) {
    return declaration.getName() ?? fallback;
  }
  return fallback;
};

const originOfDeclaration = (declaration: TsNode, fallback: string): Origin => {
  const filePath = declaration.getSourceFile().getFilePath();
  if (LIB_FILE.test(filePath)) {
    return { kind: 'builtin', typeName: nameOfDeclaration(declaration, fallback) };
  }
  const pkg = packageOfPath(filePath);
  if (pkg !== null) {
    return { kind: 'external', package: pkg, typeName: nameOfDeclaration(declaration, fallback) };
  }
  return { kind: 'local', declaration };
};

/** Where the type of an expression comes from. */
export const originOfType = (node: TsNode): Origin => {
  const type = node.getType();
  const symbol = type.getSymbol() ?? type.getAliasSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (declaration === undefined) {
    // Primitives and unions of them have no declaration of their own.
    return type.isAny() || type.isUnknown()
      ? { kind: 'unknown' }
      : { kind: 'builtin', typeName: type.getText() };
  }
  return originOfDeclaration(declaration, node.getText());
};

/** Where the value an expression names comes from, following imports. */
export const originOfValue = (node: TsNode): Origin => {
  if (!Node.isIdentifier(node) && !Node.isPropertyAccessExpression(node)) return { kind: 'unknown' };
  const symbol = node.getSymbol();
  if (symbol === undefined) return { kind: 'unknown' };
  const declaration = (symbol.getAliasedSymbol() ?? symbol).getDeclarations()[0];
  if (declaration === undefined) return { kind: 'unknown' };
  return originOfDeclaration(declaration, node.getText());
};

/**
 * Narrows a declared union to the one member an argument actually is.
 *
 * A bus that accepts every event it can carry declares a union, which is the
 * honest contract for the bus but says almost nothing about one call site. The
 * literal being passed usually carries a discriminant that identifies exactly
 * one member, and that member is what this particular publisher sends. Knowing
 * it is the difference between a useful comparison across a service boundary
 * and a vacuous one.
 *
 * The discriminant is read from the call site when the value is written there,
 * and from the value's own type when it was built earlier and passed by name.
 * Falls back to the union whenever neither settles the question.
 */
export const narrowUnionByLiteral = (declared: Type, argument: TsNode): Type => {
  if (!declared.isUnion()) return declared;
  const members = declared.getUnionTypes();
  if (members.length < 2) return declared;

  const pick = (key: string, value: string): Type | undefined => {
    const matching = members.filter((member) => {
      const declaredProperty = member.getProperty(key);
      if (declaredProperty === undefined) return false;
      const type = declaredProperty.getTypeAtLocation(argument);
      return type.isStringLiteral() && type.getLiteralValue() === value;
    });
    return matching.length === 1 ? matching[0] : undefined;
  };

  // Written out at the call site: read the discriminant straight off it.
  if (Node.isObjectLiteralExpression(argument)) {
    for (const property of argument.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const initializer = property.getInitializer();
      if (initializer === undefined || !Node.isStringLiteral(initializer)) continue;
      const found = pick(property.getName().replace(/^['"]|['"]$/g, ''), initializer.getLiteralValue());
      if (found !== undefined) return found;
    }
  }

  // Built earlier and passed by name: the value's own type still carries it.
  for (const property of argument.getType().getProperties()) {
    const type = property.getTypeAtLocation(argument);
    if (!type.isStringLiteral()) continue;
    const value = type.getLiteralValue();
    if (typeof value !== 'string') continue;
    const found = pick(property.getName(), value);
    if (found !== undefined) return found;
  }

  return declared;
};
