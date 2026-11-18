import type { ClassDeclaration, Node as TsNode, ParameterDeclaration, SourceFile, Symbol as TsSymbol } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { decoratorModule } from '../decorators.js';
import { returnedBy } from '../trace.js';

/**
 * The instances NestJS's injector makes, which no `new` in the program
 * writes (P342, P349).
 *
 * The injector makes one of each class a module lists as a provider -
 * `providers: [ApiClient]`, `{ provide: Reader, useClass: CatalogReader }` -
 * and hands each constructor parameter what the module provides for its
 * token: the `@Inject(token)` it is marked with, the class its type names,
 * or what `@Dependencies(...)` lists at its place (plain JavaScript), given
 * by `useValue`, by what `useFactory` returns, by the class `useClass` or a
 * listing by class names, or by what the token `useExisting` names is given.
 * The listing stands for the instance here, as a `new` does for one the
 * program makes. Read the same way by the request reader and by core's
 * search for a method's calls, so the two cannot disagree about which
 * instance a parameter holds.
 */

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isNonNullExpression(current) || Node.isSatisfiesExpression(current)) current = current.getExpression();
  return current;
};

/** The declaration a name stands for, past an import. */
const declarationOf = (name: TsNode): TsNode | undefined => {
  const symbol = name.getSymbol();
  return (symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol)?.getDeclarations()[0];
};

/** The class a name stands for, past an import. */
const classNamed = (name: TsNode): ClassDeclaration | undefined => {
  const target = unwrap(name);
  if (!Node.isIdentifier(target)) return undefined;
  const declaration = declarationOf(target);
  return declaration !== undefined && Node.isClassDeclaration(declaration) ? declaration : undefined;
};

/** A module's provider, as it is listed. */
interface Provider {
  /** What a parameter asks for it by: a class's name or a token. */
  readonly token: TsNode;
  /** The listing that stands for the instance the injector makes, where it makes one of a class. */
  readonly made?: TsNode;
  /** The values it is given otherwise: `useValue`, what `useFactory` returns. */
  readonly values: readonly TsNode[];
  /** The token whose provider gives it its value (`useExisting`). */
  readonly existing?: TsNode;
}

/** How many names, spreads and calls a `providers:` list is followed through to the entries it holds. */
const MOST_LIST_STEPS = 6;

/** How many `useExisting` tokens one parameter is followed through. */
const MOST_EXISTING = 4;

/**
 * The entries a `providers:` list holds (P349): the elements of a list
 * written in place, each spread followed to the list it spreads, a name to
 * the list its `const` holds (past an import), and a call to the lists the
 * function it calls returns. Nothing for a value none of these says.
 */
const entriesOf = (written: TsNode, depth: number, seen: Set<TsNode>): TsNode[] => {
  if (depth > MOST_LIST_STEPS) return [];
  const target = unwrap(written);
  if (seen.has(target)) return [];
  seen.add(target);
  if (Node.isArrayLiteralExpression(target)) {
    return target.getElements().flatMap((element) => (Node.isSpreadElement(element) ? entriesOf(element.getExpression(), depth + 1, seen) : [element]));
  }
  if (Node.isIdentifier(target)) {
    const declaration = declarationOf(target);
    const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
    return initializer === undefined ? [] : entriesOf(initializer, depth + 1, seen);
  }
  if (Node.isCallExpression(target)) {
    const callee = unwrap(target.getExpression());
    let fn: TsNode | undefined = Node.isArrowFunction(callee) || Node.isFunctionExpression(callee) ? callee : undefined;
    if (fn === undefined && (Node.isIdentifier(callee) || Node.isPropertyAccessExpression(callee))) {
      const declaration = declarationOf(Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee);
      const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
      fn = initializer === undefined ? declaration : unwrap(initializer);
    }
    const returned = fn === undefined || fn.getSourceFile().isDeclarationFile() ? undefined : returnedBy(fn);
    return (returned ?? []).flatMap((each) => entriesOf(each, depth + 1, seen));
  }
  return [];
};

/** The providers each file lists, found once per file. */
const PROVIDERS = new WeakMap<SourceFile, Provider[]>();

/** What a provider object's key is given: written out, or by a name of the same spelling. */
const keyOf = (object: TsNode, name: string): TsNode | undefined => {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const member = object.getProperty(name);
  if (member !== undefined && Node.isPropertyAssignment(member)) return member.getInitializer();
  return member !== undefined && Node.isShorthandPropertyAssignment(member) ? member.getNameNode() : undefined;
};

/** The provider one entry of a list is: a class listed by name, or an object naming a token. */
const providerOf = (element: TsNode, depth = 0): Provider | undefined => {
  const entry = unwrap(element);
  if (Node.isIdentifier(entry)) {
    // `const apiProvider = { provide: 'API', useValue: api }` listed by its name.
    const declaration = declarationOf(entry);
    const held = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
    if (held !== undefined && depth < MOST_LIST_STEPS) return providerOf(held, depth + 1);
    return { token: entry, made: entry, values: [] };
  }
  if (!Node.isObjectLiteralExpression(entry)) return undefined;
  const token = keyOf(entry, 'provide');
  if (token === undefined) return undefined;
  const useClass = keyOf(entry, 'useClass');
  const useValue = keyOf(entry, 'useValue');
  const useFactory = keyOf(entry, 'useFactory');
  const existing = keyOf(entry, 'useExisting');
  const factory = useFactory === undefined ? undefined : unwrap(useFactory);
  const returned = factory === undefined ? [] : (returnedBy(factory) ?? []);
  return {
    token,
    ...(useClass === undefined ? {} : { made: useClass }),
    values: [...(useValue === undefined ? [] : [useValue]), ...returned],
    ...(existing === undefined ? {} : { existing }),
  };
};

/** The providers listed in one file: each entry of each `providers:` list, however the list is built. */
const providersIn = (file: SourceFile): Provider[] => {
  const known = PROVIDERS.get(file);
  if (known !== undefined) return known;
  const found: Provider[] = [];
  if (file.getFullText().includes('providers')) {
    for (const property of [...file.getDescendantsOfKind(SyntaxKind.PropertyAssignment), ...file.getDescendantsOfKind(SyntaxKind.ShorthandPropertyAssignment)]) {
      if (property.getName() !== 'providers') continue;
      const written = Node.isPropertyAssignment(property) ? property.getInitializer() : property.getNameNode();
      if (written === undefined) continue;
      for (const entry of entriesOf(written, 0, new Set())) {
        const provider = providerOf(entry);
        if (provider !== undefined) found.push(provider);
      }
    }
  }
  PROVIDERS.set(file, found);
  return found;
};

/** Every provider the program's own files list. */
const providersOf = (from: TsNode): Provider[] =>
  from
    .getProject()
    .getSourceFiles()
    .flatMap((file) => (file.isDeclarationFile() || file.isInNodeModules() ? [] : providersIn(file)));

/**
 * The class a node stands for the instance of, where it is listed as a
 * provider the injector makes an instance of (P342, P349): an entry naming a
 * class in a `providers:` list - in place, spread in, held by a `const` or
 * returned by a function - or a `useClass`. Nothing for any other node.
 */
export const classOfListing = (node: TsNode): ClassDeclaration | undefined => {
  if (!Node.isIdentifier(node)) return undefined;
  const parent = node.getParent();
  if (parent === undefined) return undefined;
  if (Node.isPropertyAssignment(parent)) {
    if (parent.getName() !== 'useClass' || parent.getInitializer() !== node) return undefined;
  } else if (!Node.isArrayLiteralExpression(parent)) return undefined;
  return providersOf(node).some((each) => each.made === node) ? classNamed(node) : undefined;
};

/** Each class's listings as a provider, found once. */
const LISTINGS = new WeakMap<ClassDeclaration, TsNode[]>();

/** Each listing of a class as a provider the injector makes an instance of (P342). */
export const providerListingsOf = (cls: ClassDeclaration): TsNode[] => {
  const known = LISTINGS.get(cls);
  if (known !== undefined) return known;
  const found = providersOf(cls).flatMap((each) => (each.made !== undefined && classNamed(each.made) === cls ? [each.made] : []));
  LISTINGS.set(cls, found);
  return found;
};

/** What a token stands for: its symbol past an import, or the text it spells. */
const tokenOf = (node: TsNode): TsSymbol | string | undefined => {
  const target = unwrap(node);
  if (Node.isStringLiteral(target) || Node.isNoSubstitutionTemplateLiteral(target)) return target.getLiteralText();
  const name = Node.isPropertyAccessExpression(target) ? target.getNameNode() : target;
  if (!Node.isIdentifier(name)) return undefined;
  const symbol = name.getSymbol();
  return symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol;
};

/**
 * The token a constructor parameter asks the injector by: its
 * `@Inject(token)`, the class its type names, or - in plain JavaScript,
 * where a parameter has neither - what the class's `@Dependencies(...)` or
 * `@Inject(...)` lists at its place (P349).
 */
const askedBy = (parameter: ParameterDeclaration): TsNode | undefined => {
  const inject = parameter.getDecorators().find((each) => each.getName() === 'Inject');
  if (inject !== undefined) return inject.getArguments()[0];
  const written = parameter.getTypeNode();
  if (written !== undefined && Node.isTypeReference(written)) return written.getTypeName();
  const constructor = parameter.getParent();
  const cls = Node.isConstructorDeclaration(constructor) ? constructor.getParent() : undefined;
  if (cls === undefined || !Node.isClassDeclaration(cls)) return undefined;
  const listed = cls.getDecorators().find((each) => each.getName() === 'Dependencies');
  const index = constructor !== undefined && Node.isConstructorDeclaration(constructor) ? constructor.getParameters().indexOf(parameter) : -1;
  const argument = listed?.getArguments()[index];
  return argument === undefined || Node.isSpreadElement(argument) ? undefined : argument;
};

/** Whether the injector makes a class's instances: one a module lists, or a decorator of a package marks. */
export const injectorMakes = (cls: ClassDeclaration): boolean =>
  cls.getDecorators().some((each) => {
    const module = decoratorModule(each);
    return module !== undefined && !module.startsWith('.') && !module.startsWith('/');
  }) || providerListingsOf(cls).length > 0;

/** What each constructor parameter met is injected with, found once. */
const INJECTED = new WeakMap<ParameterDeclaration, TsNode[]>();

/**
 * What the injector hands a constructor's parameter (P342, P349): what each
 * provider of the token it asks by gives - a value, what a factory returns,
 * the listing that stands for the instance it makes, or what the token a
 * `useExisting` names is given. Nothing where the class is not one the
 * injector makes or no provider is read.
 */
export const injectedInto = (parameter: ParameterDeclaration): TsNode[] => {
  const known = INJECTED.get(parameter);
  if (known !== undefined) return known;
  const found = injectedAt(parameter);
  INJECTED.set(parameter, found);
  return found;
};

/** What the injector hands a constructor's parameter, worked out. */
const injectedAt = (parameter: ParameterDeclaration): TsNode[] => {
  const constructor = parameter.getParent();
  const cls = Node.isConstructorDeclaration(constructor) ? constructor.getParent() : undefined;
  if (cls === undefined || !Node.isClassDeclaration(cls) || !injectorMakes(cls)) return [];
  const asked = askedBy(parameter);
  const token = asked === undefined ? undefined : tokenOf(asked);
  return token === undefined ? [] : givenFor(parameter, token, new Set());
};

/** What every provider of a token gives, a `useExisting` followed to what its token is given. */
const givenFor = (from: TsNode, token: TsSymbol | string, seen: Set<TsSymbol | string>): TsNode[] => {
  if (seen.has(token) || seen.size >= MOST_EXISTING) return [];
  seen.add(token);
  return providersOf(from).flatMap((each) => {
    if (tokenOf(each.token) !== token) return [];
    const existing = each.existing === undefined ? undefined : tokenOf(each.existing);
    return [...(each.made === undefined ? [] : [each.made]), ...each.values, ...(existing === undefined ? [] : givenFor(from, existing, seen))];
  });
};
