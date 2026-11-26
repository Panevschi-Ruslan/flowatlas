import { classOfListing, componentHeldBy, elementsOfTag, providerListingsOf } from '@flowatlas/core';
import type { ClassDeclaration, Node as TsNode, ParameterDeclaration } from 'ts-morph';
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
 * instance here, as a `new` does for one the program makes. The providers
 * are read in core (`di/injected.ts`), where the search for a method's calls
 * reads them too (P349).
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
 * What a spread attribute hands one prop (P349): the values it carries for
 * it, `[]` where what it spreads holds no such member, or nothing where what
 * it spreads is not read.
 */
export type SpreadReader = (spread: TsNode, member: string) => TsNode[] | undefined;

/**
 * What the attributes an element is written with hand one prop, in the
 * order they are written (P342, P349): the value of an attribute of its
 * name, which one written after it replaces; what each spread after it may
 * carry - `<Feed {...props} client={api} />` hands `api`, `<Feed
 * client={api} {...props} />` `api` or what `props` carries. A spread
 * `spread` does not read stands in the values as itself: a value not read,
 * said where it is met. `bare` where an attribute is written with no value.
 */
export const attributeReading = (attributes: TsNode, member: string, spread?: SpreadReader): { values: TsNode[]; bare: boolean } => {
  let values: TsNode[] = [];
  const written = [...attributes.getChildrenOfKind(SyntaxKind.JsxAttribute), ...attributes.getChildrenOfKind(SyntaxKind.JsxSpreadAttribute)].sort((a, b) => a.getStart() - b.getStart());
  for (const each of written) {
    if (Node.isJsxSpreadAttribute(each)) {
      const carried = spread?.(each, member);
      if (carried === undefined) values.push(each);
      else values.push(...carried);
      continue;
    }
    if (each.getNameNode().getText() !== member) continue;
    const initializer = each.getInitializer();
    const value = initializer !== undefined && Node.isJsxExpression(initializer) ? initializer.getExpression() : initializer;
    if (value === undefined) return { values: [], bare: true };
    values = [value];
  }
  return { values, bare: false };
};

/**
 * What the attributes an element is written with hand one prop (P342): see
 * {@link attributeReading}. Nothing where none hands it, or one is written
 * bare.
 */
export const attributeValues = (attributes: TsNode, member: string, spread?: SpreadReader): TsNode[] | undefined => {
  const { values, bare } = attributeReading(attributes, member, spread);
  return bare || values.length === 0 ? undefined : values;
};

/** The class a name stands for, past an import. */
const classNamed = (name: TsNode): ClassDeclaration | undefined => {
  const target = unwrap(name);
  if (!Node.isIdentifier(target)) return undefined;
  const symbol = target.getSymbol();
  const declaration = (symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol)?.getDeclarations()[0];
  return declaration !== undefined && Node.isClassDeclaration(declaration) ? declaration : undefined;
};

/**
 * The class of an instance a framework makes (P342): the component an
 * element is written with as its tag, or the class a provider listing makes.
 */
export const classMadeByFramework = (node: TsNode): ClassDeclaration | undefined => {
  if (isTagInstance(node)) return classNamed((node as TsNode & { getTagNameNode(): TsNode }).getTagNameNode());
  return classOfListing(node);
};

/** What the injector hands a constructor's parameter: read in core, beside the call-site search that reads it too (P349). */
export { injectedInto } from '@flowatlas/core';

/**
 * The instances a framework makes of a class (P342): each element written
 * with it as its tag, each listing of it as a provider.
 */
export const frameworkMade = (cls: ClassDeclaration): TsNode[] => [...elementsOfTag(cls).flatMap((attributes) => attributes.getParent() ?? []), ...providerListingsOf(cls)];

/**
 * The attributes each element written with a component as its tag hands
 * its props (P342): for the first parameter of a function component - a
 * function, or one a `const` holds, wrapped or not (`memo(...)`, nested
 * `memo(forwardRef(...))`) - or of a
 * class component's constructor.
 */
export const propsHandedTo = (parameter: ParameterDeclaration): TsNode[] => {
  const fn = parameter.getParent();
  if (!Node.isParametered(fn) || fn.getParameters()[0] !== parameter) return [];
  if (Node.isConstructorDeclaration(fn)) return elementsOfTag(fn.getParentOrThrow());
  if (Node.isFunctionDeclaration(fn)) return elementsOfTag(fn);
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return [];
  // `memo(function Feed(props) {...})`, `memo(forwardRef((props, ref) => ...))`: what the wrappers are held by (P349).
  const holder = componentHeldBy(fn);
  return holder === undefined ? [] : elementsOfTag(holder);
};
