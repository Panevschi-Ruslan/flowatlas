import type { ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import { packageOfFile } from '../nodes.js';

/** What an expression or a type naming a class turned out to be. */
export type ClassRef =
  | { readonly kind: 'local'; readonly declaration: ClassDeclaration }
  | { readonly kind: 'external'; readonly typeName: string; readonly package: string }
  | { readonly kind: 'unknown'; readonly text: string };

const classFromDeclarations = (declarations: readonly TsNode[]): ClassDeclaration | undefined => {
  for (const declaration of declarations) {
    if (Node.isClassDeclaration(declaration)) return declaration;
  }
  return undefined;
};

const refOf = (declaration: ClassDeclaration, fallback: string): ClassRef => {
  const pkg = packageOfFile(declaration.getSourceFile().getFilePath());
  return pkg === undefined
    ? { kind: 'local', declaration }
    : { kind: 'external', typeName: declaration.getName() ?? fallback, package: pkg };
};

/**
 * Resolves an expression that names a class to the declaration itself.
 *
 * Goes through the checker rather than matching names, so a class is only
 * claimed when the compiler agrees which one it is. An expression written behind
 * a wrapper is the caller's problem: unwrapping is framework knowledge and
 * belongs where that framework is understood.
 */
export const resolveClassOfExpression = (expr: TsNode): ClassRef => {
  const text = expr.getText();
  if (!Node.isIdentifier(expr) && !Node.isPropertyAccessExpression(expr)) {
    return { kind: 'unknown', text };
  }
  const symbol = expr.getSymbol();
  if (symbol === undefined) return { kind: 'unknown', text };
  const aliased = symbol.getAliasedSymbol() ?? symbol;
  const declaration = classFromDeclarations(aliased.getDeclarations());
  return declaration === undefined ? { kind: 'unknown', text } : refOf(declaration, text);
};

/** Resolves a type to the class that declares it, for constructor parameters. */
export const resolveClassOfType = (node: TsNode): ClassRef => {
  const symbol = node.getType().getSymbol();
  if (symbol === undefined) return { kind: 'unknown', text: node.getText() };
  const declaration = classFromDeclarations(symbol.getDeclarations());
  if (declaration === undefined) return { kind: 'unknown', text: node.getText() };
  return refOf(declaration, node.getText());
};
