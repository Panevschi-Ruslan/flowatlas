import type { Decorator, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { evaluateExpression, type StaticValue } from './static-value.js';

/**
 * Reading TypeScript decorators.
 *
 * Nothing here knows the name of a decorator or of the library that exports one.
 * A caller says which names it is looking for and which module they must come
 * from; matching on the name alone would pick up a local decorator that happens
 * to be spelled the same and produce a node that does not exist.
 */

/** The arguments of a decorator call, each evaluated on its own. */
export const decoratorArgs = (decorator: Decorator): StaticValue[] =>
  decorator.getArguments().map((argument: TsNode) => evaluateExpression(argument));

/** The identifier being applied, looking through a call and a namespace access. */
const decoratorIdentifier = (decorator: Decorator): TsNode | undefined => {
  const expression = decorator.getExpression();
  const applied = Node.isCallExpression(expression) ? expression.getExpression() : expression;
  if (Node.isPropertyAccessExpression(applied)) return applied.getNameNode();
  return Node.isIdentifier(applied) ? applied : undefined;
};

/**
 * Module a decorator was imported from, or undefined when that cannot be told.
 *
 * Undefined is not the same as "declared locally": it also covers a symbol the
 * checker could not follow, which is why the matcher below treats it as a maybe
 * rather than a no.
 */
export const decoratorModule = (decorator: Decorator): string | undefined => {
  const identifier = decoratorIdentifier(decorator);
  if (identifier === undefined) return undefined;
  const symbol = identifier.getSymbol();
  if (symbol === undefined) return undefined;
  for (const declaration of symbol.getDeclarations()) {
    if (Node.isImportSpecifier(declaration)) {
      return declaration.getImportDeclaration().getModuleSpecifierValue();
    }
    if (Node.isImportClause(declaration) || Node.isNamespaceImport(declaration)) {
      const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
      if (importDeclaration !== undefined && Node.isImportDeclaration(importDeclaration)) {
        return importDeclaration.getModuleSpecifierValue();
      }
    }
  }
  const filePath = symbol.getDeclarations()[0]?.getSourceFile().getFilePath();
  if (filePath !== undefined && filePath.includes('/node_modules/')) {
    const rest = filePath.split('/node_modules/').pop() ?? '';
    const parts = rest.split('/');
    const [first, second] = parts;
    if (first !== undefined) {
      return first.startsWith('@') && second !== undefined ? `${first}/${second}` : first;
    }
  }
  return undefined;
};

/** The name as written at the use site. */
export const decoratorName = (decorator: Decorator): string => {
  const identifier = decoratorIdentifier(decorator);
  return identifier !== undefined && Node.isIdentifier(identifier)
    ? identifier.getText()
    : decorator.getName();
};

/**
 * The name the decorator is exported under, when that can be told apart from
 * the name it is written as.
 *
 * An aliased import is still the same decorator, so matching considers both.
 * When the module cannot be resolved there is no reliable exported name, and
 * the written one is all there is.
 */
export const decoratorExportedName = (decorator: Decorator): string | undefined => {
  const identifier = decoratorIdentifier(decorator);
  if (identifier === undefined || !Node.isIdentifier(identifier)) return undefined;
  const aliased = identifier.getSymbol()?.getAliasedSymbol();
  const name = aliased?.getName();
  return name === undefined || name === 'unknown' ? undefined : name;
};

export interface DecoratorMatch {
  /** One name, or several when a family is being looked for. */
  names: readonly string[];
  /** Accept only decorators imported from one of these modules. */
  fromModules?: readonly string[];
}

const sourceMatches = (decorator: Decorator, fromModules?: readonly string[]): boolean => {
  if (fromModules === undefined || fromModules.length === 0) return true;
  const module = decoratorModule(decorator);
  // An unreadable source is given the benefit of the doubt: refusing here would
  // silently drop real routes whenever the checker cannot follow a re-export.
  if (module === undefined) return true;
  return fromModules.some((candidate) => module === candidate);
};

/** Every decorator on a node whose name and import source match. */
export const findDecorators = (
  node: { getDecorators(): Decorator[] },
  match: DecoratorMatch,
): Decorator[] =>
  node
    .getDecorators()
    .filter(
      (decorator) =>
        (match.names.includes(decoratorName(decorator)) ||
          match.names.includes(decoratorExportedName(decorator) ?? String())) &&
        sourceMatches(decorator, match.fromModules),
    );

/**
 * The first decorator on a node with this name, matched by import source too.
 *
 * Matching on the name alone would pick up a local decorator that happens to be
 * called the same thing, and produce an entry point that does not exist.
 */
export const getDecorator = (
  node: { getDecorators(): Decorator[] },
  name: string,
  fromModules?: readonly string[],
): Decorator | undefined => findDecorators(node, { names: [name], ...(fromModules ? { fromModules } : {}) })[0];

export const hasDecorator = (
  node: { getDecorators(): Decorator[] },
  name: string,
  fromModules?: readonly string[],
): boolean => getDecorator(node, name, fromModules) !== undefined;

/** The first argument of a decorator, when it is a string. */
export const firstStringArg = (decorator: Decorator): string | undefined => {
  const [first] = decoratorArgs(decorator);
  return first !== undefined && first.resolved && typeof first.value === 'string'
    ? first.value
    : undefined;
};

/** A decorator argument that is either one string or an array of strings. */
export const stringListArg = (value: StaticValue | undefined): string[] | undefined => {
  if (value === undefined || !value.resolved) return undefined;
  if (typeof value.value === 'string') return [value.value];
  if (Array.isArray(value.value) && value.value.every((item) => typeof item === 'string')) {
    return value.value as string[];
  }
  return undefined;
};

export type { Decorator };
