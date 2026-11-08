import { startLineOf } from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { definePass } from './types.js';

/**
 * The child components a component's markup renders (P255), in JSX.
 *
 * `<CartBadge />` runs `CartBadge`, so what that component's body and its
 * buttons reach is part of the screen that renders it: a `calls` edge from
 * the component that writes the tag to the one it names, at the tag,
 * `static`, as the single-file components' markup is read (`sfc/children`).
 * The tag is resolved by the checker, as a call is: through imports, and
 * through `memo`, `forwardRef` and `lazy(() => import(...))`, which hand the
 * component on. A tag for a component of a package is that package's, and
 * draws nothing; one that names nothing at all is a row.
 *
 * A component a router shows at an address (`<Route element={<Orders />}>`,
 * `{ path, element }`) is a screen of its own (`routes.ts`), not a child of
 * the component that holds the router.
 */

/** The functions that hand a component on: `memo(Row)`, `forwardRef(Field)`. */
const WRAPPERS = new Set(['memo', 'forwardRef', 'observer']);

/** The attributes and properties a router reads a screen from. */
const ROUTED = new Set(['element', 'Component', 'component']);

const declarationsOf = (node: TsNode): TsNode[] => {
  const symbol = node.getSymbol();
  if (symbol === undefined) return [];
  return (symbol.getAliasedSymbol() ?? symbol).getDeclarations();
};

/** The component of this repository a tag's name stands for, through the functions that hand one on. */
const componentNamed = (ctx: ReactExtractContext, name: TsNode, depth = 0): IndexedFunction | undefined => {
  if (depth > 4) return undefined;
  for (const declaration of declarationsOf(name)) {
    const indexed = ctx.functions.get(declaration as never);
    if (indexed !== undefined && indexed.role === 'component') return indexed;
    if (!Node.isVariableDeclaration(declaration)) continue;
    const value = declaration.getInitializer();
    if (value === undefined || !Node.isCallExpression(value)) continue;
    const callee = value.getExpression();
    const called = Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
    const [first] = value.getArguments();
    if (WRAPPERS.has(called) && first !== undefined && Node.isIdentifier(first)) return componentNamed(ctx, first, depth + 1);
    // `lazy(() => import('./Orders'))`: the module's default export.
    if (called === 'lazy' && first !== undefined && (Node.isArrowFunction(first) || Node.isFunctionExpression(first))) {
      const body = first.getBody();
      const imported = Node.isCallExpression(body) && body.getExpression().getText() === 'import' ? body.getArguments()[0] : undefined;
      const specifier = imported !== undefined && Node.isStringLiteral(imported) ? imported : undefined;
      const target = specifier?.getSymbol()?.getExports().find((symbol) => symbol.getName() === 'default');
      for (const exported of (target?.getAliasedSymbol() ?? target)?.getDeclarations() ?? []) {
        const found = ctx.functions.get(exported as never);
        if (found !== undefined && found.role === 'component') return found;
      }
    }
  }
  return undefined;
};

/** Whether an element is one a router shows at an address: an `element` of a `<Route>`, or of a route object with a `path`. */
const isRouted = (element: TsNode, body: TsNode): boolean => {
  for (let at = element.getParent(); at !== undefined && at !== body; at = at.getParent()) {
    if (Node.isJsxAttribute(at) && ROUTED.has(at.getNameNode().getText())) {
      const owner = at.getParent()?.getParent();
      const tag = owner !== undefined && (Node.isJsxSelfClosingElement(owner) || Node.isJsxOpeningElement(owner)) ? owner.getTagNameNode().getText() : undefined;
      if (tag === 'Route') return true;
    }
    if (Node.isPropertyAssignment(at) && ROUTED.has(at.getName())) {
      const object = at.getParent();
      if (Node.isObjectLiteralExpression(object) && object.getProperty('path') !== undefined) return true;
    }
  }
  return false;
};

export const childrenPass = definePass('children', (ctx: ReactExtractContext) => {
  for (const indexed of [...ctx.functions.all()]) {
    if (indexed.role !== 'component') continue;
    const body = indexed.fn.body;
    const drawn = new Set<string>();
    body.forEachDescendant((node) => {
      if (!Node.isJsxSelfClosingElement(node) && !Node.isJsxOpeningElement(node)) return;
      const tag = node.getTagNameNode();
      // `<div>`, `<my-element>`: an element, not a component.
      if (!/^[A-Z]/.test(tag.getText()) && !Node.isPropertyAccessExpression(tag)) return;
      if (isRouted(node, body)) return;
      const named = Node.isPropertyAccessExpression(tag) ? tag.getNameNode() : tag;
      if (named.getSymbol() === undefined) {
        ctx.report({
          file: indexed.file,
          line: startLineOf(node),
          reason: 'component-unresolved',
          level: 'info',
          symbol: `${indexed.name} <${tag.getText()}>`,
          message: `<${tag.getText()}> in ${indexed.file} names nothing the file declares or imports, so what it renders is not joined`,
          hint: 'Import the component, or correct its name.',
          meta: { cause: 'component-unresolved', why: 'missing', tag: tag.getText() },
        });
        return;
      }
      const child = componentNamed(ctx, named);
      if (child === undefined || child.id === indexed.id || drawn.has(child.id)) return;
      drawn.add(child.id);
      ctx.ensureFunctionNode(indexed.fn);
      ctx.ensureFunctionNode(child.fn);
      ctx.builder.addEdge({
        from: indexed.id,
        to: child.id,
        type: 'calls',
        confidence: 'static',
        file: indexed.file,
        line: startLineOf(node),
        meta: { renders: tag.getText() },
      });
    });
  }
});
