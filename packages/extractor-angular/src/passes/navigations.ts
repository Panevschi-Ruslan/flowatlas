import { lineOf, methodBodies, NAVIGATES_META, normalizePath } from '@flowatlas/core';
import type { CallExpression, ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { AngularExtractContext, RouteEntry } from '../context.js';
import { definePass } from './types.js';

/** An address that leaves the application: a scheme, or a host written after `//`. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** Whether a name is Angular's `Router`, imported from the router's module. */
const isRouterName = (name: TsNode | undefined): boolean => {
  if (name === undefined) return false;
  const identifier = Node.isTypeReference(name) ? name.getTypeName() : name;
  if (!Node.isIdentifier(identifier)) return false;
  return (identifier.getSymbol()?.getDeclarations() ?? []).some(
    (declaration) =>
      Node.isImportSpecifier(declaration) &&
      declaration.getName() === 'Router' &&
      declaration.getImportDeclaration().getModuleSpecifierValue() === '@angular/router',
  );
};

/** Whether a value is `inject(Router)`. */
const injectsRouter = (value: TsNode | undefined): boolean =>
  value !== undefined && Node.isCallExpression(value) && value.getExpression().getText() === 'inject' && isRouterName(value.getArguments()[0]);

/**
 * Whether a receiver is the application's router: a constructor parameter or a
 * property typed `Router`, one given `inject(Router)`, or `inject(Router)` itself.
 */
const isRouter = (receiver: TsNode): boolean => {
  if (injectsRouter(receiver)) return true;
  if (!Node.isPropertyAccessExpression(receiver) && !Node.isIdentifier(receiver)) return false;
  const symbol = Node.isPropertyAccessExpression(receiver) ? receiver.getNameNode().getSymbol() : receiver.getSymbol();
  return (symbol?.getDeclarations() ?? []).some((declaration) => {
    if (Node.isParameterDeclaration(declaration) || Node.isPropertyDeclaration(declaration) || Node.isVariableDeclaration(declaration)) {
      return isRouterName(declaration.getTypeNode()) || injectsRouter(declaration.getInitializer());
    }
    return false;
  });
};

/** What a navigation names: an address with each value read at run time a parameter, relative, or code. */
type Written = { readonly path: string } | { readonly relative: string } | { readonly code: string };

const literalOf = (node: TsNode): string | undefined =>
  Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralValue() : undefined;

/** `navigate(['/orders', id])` and `navigateByUrl('/orders')`, as the router joins them. */
const writtenOf = (method: string, argument: TsNode | undefined, extras: TsNode | undefined): Written => {
  if (argument === undefined) return { code: '' };
  let path: string | undefined;
  if (method === 'navigateByUrl') {
    path = literalOf(argument);
    if (path === undefined && Node.isTemplateExpression(argument)) {
      path = argument.getHead().getLiteralText() + argument.getTemplateSpans().map((span) => `:param${span.getLiteral().getLiteralText()}`).join('');
    }
  } else if (Node.isArrayLiteralExpression(argument) && argument.getElements().length > 0) {
    path = argument
      .getElements()
      .map((element) => literalOf(element) ?? ':param')
      .join('/')
      .replace(/\/{2,}/g, '/');
  }
  if (path === undefined) return { code: argument.getText().replace(/\s+/g, ' ').slice(0, 60) };
  // `{ relativeTo: this.route }`: under the route the component is shown at, which is not read here.
  const relative = extras !== undefined && Node.isObjectLiteralExpression(extras) && extras.getProperty('relativeTo') !== undefined && !path.startsWith('/');
  return relative ? { relative: path } : { path };
};

/**
 * Where an Angular application's code navigates (P276): `navigate([...])` and
 * `navigateByUrl(...)` on the router, from a method of a class, each a `calls`
 * edge to the component the route at that address shows - a navigation is a
 * call of the screen it lands on, as a front end's other routers' are (P265).
 * A link written in a template (`routerLink`) is the template reader's, as a
 * click that triggers the screen. An address out of the application is a note;
 * one no route answers, one relative to the route the component is shown at,
 * and one written as code are rows, as they are for the other routers.
 */
export const navigationsPass = definePass('navigations', (ctx: AngularExtractContext) => {
  const answering = (path: string): RouteEntry[] => {
    const wanted = normalizePath(path.split(/[?#]/)[0] ?? path);
    return ctx.routes.filter((route) => route.path === wanted);
  };
  for (const indexed of ctx.classes.all()) {
    const owner: ClassDeclaration = indexed.declaration;
    for (const { declaration: method, body } of methodBodies(owner)) {
      body.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return;
        const callee = node.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) return;
        const name = callee.getName();
        if (name !== 'navigate' && name !== 'navigateByUrl') return;
        if (!isRouter(callee.getExpression())) return;
        const from = ctx.methodIdOf(method);
        if (from === undefined) return;
        const [argument, extras] = (node as CallExpression).getArguments();
        const written = writtenOf(name, argument, extras);
        const file = ctx.fileOf(node);
        const line = lineOf(node);
        const symbol = `${indexed.name}.${method.getName()}`;
        if ('path' in written && EXTERNAL.test(written.path)) {
          ctx.report({
            file,
            line,
            reason: 'navigation-external',
            level: 'info',
            symbol: `${symbol} navigates to ${written.path}`,
            message: `${file} navigates to ${written.path}, outside the application, so no screen of it is joined`,
            hint: 'Nothing to do: an address with a host leaves the application.',
            meta: { cause: 'navigation-external', navigates: written.path },
          });
          return;
        }
        const routes = 'path' in written ? answering(written.path) : [];
        const shown = routes.find((route) => route.component !== undefined);
        const target = shown?.component === undefined ? undefined : ctx.classes.get(shown.component);
        if ('path' in written && target !== undefined && shown !== undefined) {
          ctx.ensureMethodNode(method);
          ctx.ensureClassNode(target.declaration);
          ctx.builder.addEdge({
            from,
            to: target.id,
            type: 'calls',
            confidence: 'static',
            file,
            line,
            meta: { [NAVIGATES_META]: written.path, route: shown.path, page: target.file, ...(name === 'navigateByUrl' ? { byUrl: true } : {}) },
          });
          return;
        }
        // A route that answers and shows nothing this reading could read is the route reader's row already.
        if (routes.length > 0) return;
        const why = 'path' in written ? 'missing' : 'dynamic';
        const shownText = 'path' in written ? written.path : 'relative' in written ? written.relative : written.code;
        ctx.report({
          file,
          line,
          reason: 'navigation-unresolved',
          level: why === 'missing' ? 'action' : 'info',
          symbol: `${symbol} navigates to ${shownText}`,
          message:
            why === 'missing'
              ? `${file} navigates to ${shownText}, which no configured route answers, so the navigation joins nothing`
              : 'relative' in written
                ? `${file} navigates to ${shownText} relative to the route the component is shown at, which is not read, so which screen it shows is not said`
                : `${file} navigates to an address written as code (${shownText}), so which screen it shows is not read`,
          hint:
            why === 'missing'
              ? 'Correct the address, or configure a route that answers it.'
              : 'Write the address from the root, as literals or an array of them.',
          meta: { cause: 'navigation-unresolved', why, navigates: shownText },
        });
      });
    }
  }
});
