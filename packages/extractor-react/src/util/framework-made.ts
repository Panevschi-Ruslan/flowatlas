import { decoratorModule, elementsOfTag, returnedBy } from '@flowatlas/core';
import type { ArrayLiteralExpression, ClassDeclaration, Node as TsNode, ParameterDeclaration, SourceFile, Symbol as TsSymbol } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/**
 * Instances a framework makes, which no `new` in the program writes (P342).
 *
 * A renderer makes a component's instance for each element written with it
 * as its tag - `<Feed client={api} />` - handing it the attributes as its
 * props, the first argument of its constructor or of the function it is.
 * NestJS's injector makes one of each class a module lists as a provider -
 * `providers: [ApiClient]`, `{ provide: Reader, useClass: CatalogReader }` -
 * handing each constructor parameter what the module provides for its token:
 * the `@Inject(token)` it is marked with or the class its type names, given
 * by `useValue`, by what `useFactory` returns, or by the class `useClass` or
 * a listing by class names. The element and the listing stand for the
 * instance here, as a `new` does for one the program makes.
 */

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isNonNullExpression(current) || Node.isSatisfiesExpression(current)) current = current.getExpression();
  return current;
};

/** Whether a node is an element written with a tag: the instance a renderer makes of the component it names (P342). */
export const isTagInstance = (node: TsNode): boolean => Node.isJsxSelfClosingElement(node) || Node.isJsxOpeningElement(node);

/** The attributes an element is written with: the props it hands its component (P342). */
export const attributesOf = (element: TsNode): TsNode | undefined => element.getFirstChildByKind(SyntaxKind.JsxAttributes);

/**
 * What the attributes an element is written with hand one prop (P342): the
 * value of each attribute of its name, `true` for one written bare.
 * Nothing where none names it - a spread may, and is not read here.
 */
export const attributeValues = (attributes: TsNode, member: string): TsNode[] | undefined => {
  const values: TsNode[] = [];
  for (const each of attributes.getChildrenOfKind(SyntaxKind.JsxAttribute)) {
    if (each.getNameNode().getText() !== member) continue;
    const initializer = each.getInitializer();
    const value = initializer !== undefined && Node.isJsxExpression(initializer) ? initializer.getExpression() : initializer;
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values.length === 0 ? undefined : values;
};

/** The class a name stands for, past an import. */
const classNamed = (name: TsNode): ClassDeclaration | undefined => {
  const target = unwrap(name);
  if (!Node.isIdentifier(target)) return undefined;
  const symbol = target.getSymbol();
  const declaration = (symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol)?.getDeclarations()[0];
  return declaration !== undefined && Node.isClassDeclaration(declaration) ? declaration : undefined;
};

/** A module's provider, as it is listed (P342). */
interface Provider {
  /** What a parameter asks for it by: a class's name or a token. */
  readonly token: TsNode;
  /** The listing that stands for the instance the injector makes, where it makes one of a class. */
  readonly made?: TsNode;
  /** The values it is given otherwise: `useValue`, what `useFactory` returns. Nothing read for `useExisting`. */
  readonly values: readonly TsNode[];
}

/** The providers each file lists, found once per file. */
const PROVIDERS = new WeakMap<SourceFile, Provider[]>();

/** The lists a `providers:` entry writes: in place, or a `const` holding one. */
const listsOf = (written: TsNode): ArrayLiteralExpression[] => {
  const target = unwrap(written);
  if (Node.isArrayLiteralExpression(target)) return [target];
  if (!Node.isIdentifier(target)) return [];
  const symbol = target.getSymbol();
  const declaration = (symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol)?.getDeclarations()[0];
  const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
  const list = initializer === undefined ? undefined : unwrap(initializer);
  return list !== undefined && Node.isArrayLiteralExpression(list) ? [list] : [];
};

/** The providers listed in one file: each entry of each `providers:` list. */
const providersIn = (file: SourceFile): Provider[] => {
  const known = PROVIDERS.get(file);
  if (known !== undefined) return known;
  const found: Provider[] = [];
  if (file.getFullText().includes('providers')) {
    for (const property of file.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
      const initializer = property.getInitializer();
      if (property.getName() !== 'providers' || initializer === undefined) continue;
      for (const list of listsOf(initializer)) {
        for (const element of list.getElements()) {
          const entry = unwrap(element);
          if (Node.isIdentifier(entry)) {
            found.push({ token: entry, made: entry, values: [] });
            continue;
          }
          if (!Node.isObjectLiteralExpression(entry)) continue;
          const key = (name: string): TsNode | undefined => {
            const member = entry.getProperty(name);
            return member !== undefined && Node.isPropertyAssignment(member) ? member.getInitializer() : undefined;
          };
          const token = key('provide');
          if (token === undefined) continue;
          const useClass = key('useClass');
          const useValue = key('useValue');
          const useFactory = key('useFactory');
          const factory = useFactory === undefined ? undefined : unwrap(useFactory);
          const returned = factory === undefined ? [] : (returnedBy(factory) ?? []);
          found.push({ token, ...(useClass === undefined ? {} : { made: useClass }), values: [...(useValue === undefined ? [] : [useValue]), ...returned] });
        }
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

/** Whether a node is listed as a provider the injector makes an instance of: an entry naming a class, or a `useClass` (P342). */
const isListing = (node: TsNode): boolean => {
  if (!Node.isIdentifier(node)) return false;
  const parent = node.getParent();
  if (parent === undefined) return false;
  if (Node.isPropertyAssignment(parent)) return parent.getName() === 'useClass' && parent.getInitializer() === node;
  if (!Node.isArrayLiteralExpression(parent)) return false;
  // Written in a `providers:` list, or in a `const` list one names.
  const holder = parent.getParent();
  if (holder !== undefined && Node.isPropertyAssignment(holder)) return holder.getName() === 'providers';
  return holder !== undefined && Node.isVariableDeclaration(holder) && providersOf(node).some((each) => each.made === node);
};

/**
 * The class of an instance a framework makes (P342): the component an
 * element is written with as its tag, or the class a provider listing makes.
 */
export const classMadeByFramework = (node: TsNode): ClassDeclaration | undefined => {
  if (isTagInstance(node)) return classNamed((node as TsNode & { getTagNameNode(): TsNode }).getTagNameNode());
  return isListing(node) ? classNamed(node) : undefined;
};

/** Each listing of a class as a provider the injector makes an instance of (P342). */
export const providerListingsOf = (cls: ClassDeclaration): TsNode[] => {
  const known = LISTINGS.get(cls);
  if (known !== undefined) return known;
  const found = providersOf(cls).flatMap((each) => (each.made !== undefined && classNamed(each.made) === cls ? [each.made] : []));
  LISTINGS.set(cls, found);
  return found;
};

/** Each class's listings as a provider, found once. */
const LISTINGS = new WeakMap<ClassDeclaration, TsNode[]>();

/** What each constructor parameter met is injected with, found once. */
const INJECTED = new WeakMap<ParameterDeclaration, TsNode[]>();

/**
 * The instances a framework makes of a class (P342): each element written
 * with it as its tag, each listing of it as a provider.
 */
export const frameworkMade = (cls: ClassDeclaration): TsNode[] => [...elementsOfTag(cls).flatMap((attributes) => attributes.getParent() ?? []), ...providerListingsOf(cls)];

/** What a token stands for: its symbol past an import, or the text it spells. */
const tokenOf = (node: TsNode): TsSymbol | string | undefined => {
  const target = unwrap(node);
  if (Node.isStringLiteral(target) || Node.isNoSubstitutionTemplateLiteral(target)) return target.getLiteralText();
  const name = Node.isPropertyAccessExpression(target) ? target.getNameNode() : target;
  if (!Node.isIdentifier(name)) return undefined;
  const symbol = name.getSymbol();
  return symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol;
};

/** The token a constructor parameter asks the injector by: its `@Inject(token)`, or the class its type names. */
const askedBy = (parameter: ParameterDeclaration): TsNode | undefined => {
  const inject = parameter.getDecorators().find((each) => each.getName() === 'Inject');
  if (inject !== undefined) return inject.getArguments()[0];
  const written = parameter.getTypeNode();
  return written !== undefined && Node.isTypeReference(written) ? written.getTypeName() : undefined;
};

/** Whether the injector makes a class's instances: one a module lists, or a decorator of a package marks. */
const injected = (cls: ClassDeclaration): boolean =>
  cls.getDecorators().some((each) => {
    const module = decoratorModule(each);
    return module !== undefined && !module.startsWith('.') && !module.startsWith('/');
  }) || providerListingsOf(cls).length > 0;

/**
 * What the injector hands a constructor's parameter (P342): what each
 * provider of the token it asks by gives - a value, what a factory
 * returns, or the listing that stands for the instance it makes. Nothing
 * where the class is not one the injector makes or no provider is read.
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
  if (cls === undefined || !Node.isClassDeclaration(cls) || !injected(cls)) return [];
  const asked = askedBy(parameter);
  const token = asked === undefined ? undefined : tokenOf(asked);
  if (token === undefined) return [];
  return providersOf(parameter).flatMap((each) => (tokenOf(each.token) === token ? [...(each.made === undefined ? [] : [each.made]), ...each.values] : []));
};

/**
 * The attributes each element written with a component as its tag hands
 * its props (P342): for the first parameter of a function component - a
 * function, or one a `const` holds, wrapped or not (`memo(...)`) - or of a
 * class component's constructor.
 */
export const propsHandedTo = (parameter: ParameterDeclaration): TsNode[] => {
  const fn = parameter.getParent();
  if (!Node.isParametered(fn) || fn.getParameters()[0] !== parameter) return [];
  if (Node.isConstructorDeclaration(fn)) return elementsOfTag(fn.getParentOrThrow());
  if (Node.isFunctionDeclaration(fn)) return elementsOfTag(fn);
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return [];
  let holder = fn.getParent();
  // `memo(function Feed(props) {...})`, `forwardRef((props, ref) => ...)`: what the wrapper is held by.
  if (holder !== undefined && Node.isCallExpression(holder) && holder.getArguments()[0] === fn) holder = holder.getParent();
  return holder !== undefined && Node.isVariableDeclaration(holder) ? elementsOfTag(holder) : [];
};
