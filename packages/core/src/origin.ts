import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ClassDeclaration, Node as TsNode, Type } from 'ts-morph';
import { Node, SymbolFlags } from 'ts-morph';

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
 * Names the checker gives a type that was written without one.
 *
 * An object type written inline — the `& { $client: Client }` a driver bolts
 * onto its own client — is declared under `__type`, and an anonymous object is
 * never the thing a package is known by.
 */
const ANONYMOUS_TYPE_NAMES = new Set(['__type', '__object']);

const symbolOf = (type: Type) => type.getSymbol() ?? type.getAliasSymbol();

const isNamedType = (type: Type): boolean => {
  const name = symbolOf(type)?.getName();
  return name !== undefined && !ANONYMOUS_TYPE_NAMES.has(name);
};

const isPackagedType = (type: Type): boolean => {
  const declaration = symbolOf(type)?.getDeclarations()[0];
  if (declaration === undefined) return false;
  const filePath = declaration.getSourceFile().getFilePath();
  return packageOfPath(filePath) !== null || packageNameOf(filePath) !== null;
};

/**
 * What makes one member of an intersection a better answer than another,
 * most telling first.
 *
 * Being *named* comes first because the anonymous half of `Client & { extra }`
 * is the bolt-on and never the client. Being declared in a *package* comes
 * second because that is the member a descriptor can be found for; it is a
 * weaker signal on its own, since a local wrapper type is still the receiver's
 * real type when nothing else names it.
 */
const MEMBER_TRAITS: readonly ((type: Type) => boolean)[] = [isNamedType, isPackagedType];

const traitScoreOf = (type: Type): number =>
  MEMBER_TRAITS.reduce(
    (score, hasTrait, at) =>
      hasTrait(type) ? score + 2 ** (MEMBER_TRAITS.length - 1 - at) : score,
    0,
  );

/**
 * The member of an intersection that answers for the whole of it.
 *
 * An intersection has no symbol of its own, so a receiver typed as one had no
 * origin at all: no package, no descriptor, no table, and every query through
 * it fell back to reading the receiver's name. That is not an exotic shape. It
 * is how a modern database client is handed out — `Database<Schema> & { client }`
 * — so the whole of a repository's data access could be unreadable for it.
 *
 * More than one member can answer, so which one does is decided here by
 * `MEMBER_TRAITS` rather than left to the order the members happen to be
 * written in. Order breaks a tie only between members alike in every trait,
 * where there is nothing left to prefer; any other reading would make the
 * answer depend on which half of the intersection the author typed first.
 */
const bestOfIntersection = (type: Type): Type => {
  if (!type.isIntersection()) return type;
  // An intersection given a name of its own is already answerable, and the name
  // is the better answer: an alias is declared somewhere, and where it is
  // declared is the honest origin. A framework's read-only cookie store is
  // written that way, and reducing it to a member threw its package away.
  // Only an intersection written out in place has nothing to ask of itself,
  // and that is the one a driver hands back from its constructor.
  if (symbolOf(type) !== undefined) return type;
  const members = type.getIntersectionTypes();
  const [first] = members;
  if (first === undefined) return type;
  let best = first;
  let bestScore = traitScoreOf(first);
  for (const member of members.slice(1)) {
    const score = traitScoreOf(member);
    if (score > bestScore) {
      best = member;
      bestScore = score;
    }
  }
  return best;
};

/**
 * The type that can actually be asked where it came from.
 *
 * Both a union and an intersection are compounds the checker gives no symbol
 * of their own, and asking either one directly answers nothing. Unions are
 * reduced first because an intersection is a perfectly ordinary member of one:
 * `(Database & { client }) | undefined` is what an optional receiver is.
 */
const resolvableType = (type: Type): Type => bestOfIntersection(firstObjectOfUnion(type));

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
  const resolved = resolvableType(unwrapDelivery(node.getType()));
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
 * a declaration that promises nothing says less than the value does. A rest
 * parameter is read as the element it collects rather than as the array it
 * gathers them into, so `...args: any[]` promises nothing either.
 */
export const declaredParameterType = (
  call: TsNode,
  index: number,
  checker: { getResolvedSignature(node: never): { getParameters(): TsSymbolLike[] } | undefined },
): Type | undefined => {
  try {
    const signature = checker.getResolvedSignature(call as never);
    const parameters = signature?.getParameters() ?? [];
    const parameter = parameterFor(parameters, index);
    if (parameter === undefined) return undefined;
    const declared = parameter.getTypeAtLocation(call);
    const type = isRestParameter(parameter) ? declared.getArrayElementType() : declared;
    if (type === undefined || type.isAny() || type.isUnknown()) return undefined;
    return type;
  } catch {
    return undefined;
  }
};

interface TsSymbolLike {
  getTypeAtLocation(node: TsNode): Type;
  getValueDeclaration?(): TsNode | undefined;
}

/**
 * Whether this parameter collects the rest of the arguments.
 *
 * Worth asking because a rest parameter's declared type is the array the callee
 * will be handed, and never the thing one call site passes. `...args: any[]` is
 * not `any`, so the guard above let it through and answered with the array —
 * throwing away the only argument that had a shape. That is a fact about every
 * signature ending in a rest parameter, not about any one library.
 */
const isRestParameter = (parameter: TsSymbolLike): boolean => {
  const declaration = parameter.getValueDeclaration?.();
  return (
    declaration !== undefined &&
    Node.isParameterDeclaration(declaration) &&
    declaration.isRestParameter()
  );
};

/**
 * The parameter an argument at this position is passed to.
 *
 * Past the end of the declared list there is still a parameter when the last
 * one collects: `emit(event, ...args)` called with three arguments passes the
 * third to `args` just as it passed the second. Anything else past the end is
 * a call the compiler would reject, and reading the last parameter for it would
 * answer with a contract the argument was never measured against.
 */
const parameterFor = (
  parameters: readonly TsSymbolLike[],
  index: number,
): TsSymbolLike | undefined => {
  const direct = parameters[index];
  if (direct !== undefined) return direct;
  const last = parameters[parameters.length - 1];
  return last !== undefined && isRestParameter(last) ? last : undefined;
};

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

/**
 * A value of the language itself: a primitive, or a closed set of them.
 *
 * Asked before the declaration, because a name given to such a set is still
 * such a set. `state: OrderState` where `OrderState` is `'a' | 'b'` has an alias
 * symbol declared in the repository, so reading the declaration first called it
 * a local type, found no class behind it, and reported every `state.slice(...)`
 * as a receiver nothing could be followed through — with a hint to inject a
 * class. Naming the set is the spelling this tool recommends (R42), so it must
 * not be the spelling that produces the rows.
 */
const isLanguageValue = (type: Type): boolean => {
  if (type.isUnion()) return type.getUnionTypes().every(isLanguageValue);
  return (
    type.isString() ||
    type.isStringLiteral() ||
    type.isNumber() ||
    type.isNumberLiteral() ||
    type.isBoolean() ||
    type.isBooleanLiteral() ||
    type.isUndefined() ||
    type.isNull()
  );
};

/** Where the type of an expression comes from. */
export const originOfType = (node: TsNode): Origin => {
  const declared = node.getType();
  if (isLanguageValue(declared)) return { kind: 'builtin', typeName: declared.getText() };
  // The same question as in `resolveTypeOrigin`, reaching the same early return
  // from the other side: an intersection carries no symbol, so without this the
  // fallback below called a receiver typed as one a builtin named by the whole
  // text of the intersection — a value of the language, which it plainly is not.
  const type = bestOfIntersection(declared);
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
 * The keys an object written at a call site puts on the wire, when one is.
 *
 * Deliberately the names and not the shape. The declared type of the parameter
 * is the better source for what each field *is* — an empty array literal types
 * as `never[]`, and taking the literal's own type whole turned four boundaries
 * that agreed into four that disagreed. What the declared type cannot say is
 * which keys are there at all, and that is the whole of R34: `Partial<T>`
 * permits every key of `T` and a call that writes three of them writes three.
 *
 * Read off the literal's own properties, one at a time. A spread contributes
 * the keys it certainly carries, and refuses the whole literal when it may
 * carry fewer — `{ ...patch }` with `patch: Partial<T>` writes none of `T`
 * necessarily, and its *type* claims all of them. Several objects, where
 * several callers each write one, answer with their keys together: a key no
 * caller writes is a key nothing sends.
 */
export const writtenKeysOf = (written: readonly TsNode[]): string[] | undefined => {
  if (written.length === 0) return undefined;
  const keys = new Set<string>();
  for (const node of written) {
    const literal = writtenObjectLiteral(node);
    if (literal === undefined || !Node.isObjectLiteralExpression(literal)) return undefined;
    try {
      for (const property of literal.getProperties()) {
        if (Node.isSpreadAssignment(property)) {
          const spread = spreadKeysOf(property);
          if (spread === undefined) return undefined;
          for (const key of spread) keys.add(key);
          continue;
        }
        const name = property.getSymbol()?.getName();
        if (name === undefined || name === '') return undefined;
        keys.add(name);
      }
    } catch {
      return undefined;
    }
  }
  return [...keys].sort();
};

/**
 * The keys a spread certainly contributes, or nothing when it may contribute
 * fewer than it could.
 *
 * `{ ...topping }` where every field of `topping` is required does put them all
 * on the wire. `{ ...patch }` where `patch` is a `Partial<T>` puts none of them
 * there necessarily, and reading the type's properties said it put all of them
 * — permission reported as act, which is the whole of R34 reappearing inside
 * the fix for it. A spread that cannot be pinned down refuses the entire
 * literal rather than contributing a guess to it.
 */
const spreadKeysOf = (property: TsNode): string[] | undefined => {
  if (!Node.isSpreadAssignment(property)) return undefined;
  const type = property.getExpression().getType();
  // A union spreads different keys depending on which arm it is, and nothing
  // here says which. `a ? { b } : {}` is the ordinary way to write one.
  if (type.isUnion()) return undefined;
  const keys: string[] = [];
  for (const each of type.getProperties()) {
    if (each.hasFlags(SymbolFlags.Optional)) return undefined;
    keys.push(each.getName());
  }
  return keys;
};

/**
 * Where the shape a call sends was read from, which is how far it can be trusted.
 *
 * `literal`  — an object written at the call site. This is what is sent.
 * `literals` — one object per caller of the method that makes the request.
 *              These are what any of them may send: a key none of them writes
 *              is not sent, and a key one of them writes is not always sent.
 * `value`   — the type of a value built elsewhere and passed by name.
 * `type`    — the declared type of the parameter. This is what is *permitted*,
 *             which is a weaker claim, and a finding built on it may not be
 *             phrased as though somebody had written the key down (R34).
 */
export type BodyRead = 'literal' | 'literals' | 'value' | 'type';

/**
 * The object written at a call site, when the argument is one.
 *
 * A parameter's declared type says what a call is *permitted* to send;
 * an object literal written in place says what it *does* send. `Partial<T>`
 * permits every key of `T` and puts none of them on the wire, and reading the
 * permission as the act reported four boundaries as sending keys no call there
 * ever writes (R34). Where both are in hand, the literal is the better
 * evidence, and it is the evidence ts-morph already has at the node.
 *
 * Unwraps the things written around a literal that do not change what is sent:
 * parentheses, `as T`, `satisfies T` and `!`. An assertion is the author saying
 * what they believe the shape is; the literal is the shape.
 *
 * A spread — `{ ...topping, extra: 1 }` — is deliberately still a literal here.
 * It genuinely does put the spread object's keys on the wire, and the type of
 * the literal says so.
 */
export const writtenObjectLiteral = (node: TsNode | undefined): TsNode | undefined => {
  let value = node;
  for (;;) {
    if (value === undefined) return undefined;
    if (Node.isObjectLiteralExpression(value)) return value;
    if (
      Node.isParenthesizedExpression(value) ||
      Node.isAsExpression(value) ||
      Node.isSatisfiesExpression(value) ||
      Node.isNonNullExpression(value)
    ) {
      value = value.getExpression();
      continue;
    }
    return undefined;
  }
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
