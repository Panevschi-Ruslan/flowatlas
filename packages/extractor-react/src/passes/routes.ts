import { normalizePath } from '@flowatlas/core';
import { APP_PAGES, routePathOfFile } from '@flowatlas/adapters-entry';
import type { JsxAttributeLike, Node as TsNode, ObjectLiteralExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { definePass } from './types.js';

/** The value written for a key of an object, when the object writes one. */
const valueOf = (object: ObjectLiteralExpression, key: string): TsNode | undefined => {
  const property = object.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property)
    ? property.getInitializer()
    : undefined;
};

/** The value written for a named attribute of an element. */
const attributeOf = (
  attributes: readonly JsxAttributeLike[],
  names: readonly string[],
): TsNode | undefined => {
  for (const attribute of attributes) {
    if (!Node.isJsxAttribute(attribute)) continue;
    if (!names.includes(attribute.getNameNode().getText())) continue;
    return attribute.getInitializer();
  }
  return undefined;
};

/** The string an expression is, when it is one written in place. */
const stringOf = (value: TsNode | undefined): string | undefined => {
  if (value === undefined) return undefined;
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) {
    return value.getLiteralValue();
  }
  if (Node.isJsxExpression(value)) return stringOf(value.getExpression());
  return undefined;
};

/** Whether this is the function its file hands out as the default export. */
const isDefaultExport = (indexed: IndexedFunction): boolean => {
  const [declaration] = indexed.fn.declaration
    .getSourceFile()
    .getExportedDeclarations()
    .get('default') ?? [];
  return declaration === indexed.fn.declaration;
};

/**
 * What a screen is, which is the one question React answers three ways.
 *
 * Angular has a routed component and a configuration that names it. React has
 * whatever the router in use says, and the two that matter are unrelated to
 * each other: a table of objects or `<Route>` elements handed to a router
 * library, and a file in the right place under `app/`. A repository may have
 * neither, and then a component is a component and nothing says which of them
 * a browser can arrive at directly — which is a fact about the repository and
 * is recorded as one rather than guessed around.
 *
 * What is recorded is a `route` on the component, not an edge: the address of a
 * screen is not a boundary anything crosses, it is how a person names the
 * screen. `impact` already ends at the component; this is so that the answer
 * can say which screen that is.
 */
export const routesPass = definePass('routes', (ctx: ReactExtractContext) => {
  const routed = new Map<string, Set<string>>();

  const claim = (indexed: IndexedFunction | undefined, path: string): void => {
    if (indexed === undefined || indexed.role !== 'component') return;
    const paths = routed.get(indexed.id);
    // A component shown at two addresses keeps both, sorted, so the answer does
    // not depend on which file happened to be read first.
    if (paths === undefined) routed.set(indexed.id, new Set([path]));
    else paths.add(path);
  };

  /** The component an entry shows, when it names one declared here. */
  const shownBy = (value: TsNode | undefined): IndexedFunction | undefined => {
    if (value === undefined) return undefined;
    const inner = Node.isJsxExpression(value) ? value.getExpression() : value;
    if (inner === undefined) return undefined;
    const named = Node.isJsxSelfClosingElement(inner)
      ? inner.getTagNameNode()
      : Node.isJsxElement(inner)
        ? inner.getOpeningElement().getTagNameNode()
        : inner;
    if (!Node.isIdentifier(named)) return undefined;
    const symbol = named.getSymbol();
    if (symbol === undefined) return undefined;
    for (const declaration of (symbol.getAliasedSymbol() ?? symbol).getDeclarations()) {
      const indexed = ctx.functions.get(declaration as never);
      if (indexed !== undefined) return indexed;
    }
    return undefined;
  };

  for (const sourceFile of ctx.project.getSourceFiles()) {
    if (sourceFile.getFilePath().includes('/node_modules/')) continue;

    sourceFile.forEachDescendant((node) => {
      // The table form: `{ path: '/orders', element: <Orders /> }`, or the same
      // with `Component`, which the same library also accepts.
      if (Node.isObjectLiteralExpression(node)) {
        const path = stringOf(valueOf(node, 'path'));
        if (path === undefined) return;
        claim(shownBy(valueOf(node, 'element') ?? valueOf(node, 'Component')), normalizePath(path));
        return;
      }
      // The element form: `<Route path="/orders" element={<Orders />} />`.
      const attributes = Node.isJsxSelfClosingElement(node)
        ? node.getAttributes()
        : Node.isJsxOpeningElement(node)
          ? node.getAttributes()
          : undefined;
      if (attributes === undefined) return;
      const tag = Node.isJsxSelfClosingElement(node) ? node.getTagNameNode() : (node as never as { getTagNameNode(): TsNode }).getTagNameNode();
      if (tag.getText() !== 'Route') return;
      const path = stringOf(attributeOf(attributes, ['path']));
      if (path === undefined) return;
      claim(shownBy(attributeOf(attributes, ['element', 'Component'])), normalizePath(path));
    });
  }

  // The file-system form, which names no component at all: the default export
  // of a file in the right place *is* the screen, and the address is where the
  // file is. Only the default export, because everything else in that file is
  // a part of the screen rather than the screen.
  for (const indexed of ctx.functions.all()) {
    if (indexed.role !== 'component') continue;
    const path = routePathOfFile(indexed.file, APP_PAGES);
    if (path !== null && isDefaultExport(indexed)) claim(indexed, path);
  }

  for (const [id, paths] of routed) {
    const indexed = ctx.functions.byId(id);
    if (indexed !== undefined) {
      ctx.ensureFunctionNode(indexed.fn, { route: [...paths].sort().join(' ') });
    }
  }
});
