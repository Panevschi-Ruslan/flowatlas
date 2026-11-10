import { lineOf, makeSymbolId, methodBodies, moduleFunctions, NAVIGATES_META, normalizePath, type NamedFunction } from '@flowatlas/core';
import type { CallExpression, ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { AngularExtractContext, RouteEntry } from '../context.js';
import { definePass } from './types.js';

/** An address that leaves the application: a scheme, or a host written after `//`. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * The router's methods that name a screen: the two that navigate, and the two
 * that make the address a guard hands back to send the visitor elsewhere
 * (`createUrlTree([...])`, `parseUrl('...')`), which is a redirect (P288).
 */
const ROUTER_METHODS: ReadonlyMap<string, { readonly byUrl: boolean; readonly redirects: boolean }> = new Map([
  ['navigate', { byUrl: false, redirects: false }],
  ['navigateByUrl', { byUrl: true, redirects: false }],
  ['createUrlTree', { byUrl: false, redirects: true }],
  ['parseUrl', { byUrl: true, redirects: true }],
]);

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

/** Whether a declaration holds the router: typed `Router`, or given `inject(Router)`. */
const holdsRouter = (declaration: TsNode): boolean =>
  (Node.isParameterDeclaration(declaration) || Node.isPropertyDeclaration(declaration) || Node.isVariableDeclaration(declaration)) &&
  (isRouterName(declaration.getTypeNode()) || injectsRouter(declaration.getInitializer()));

/**
 * Whether a receiver is the application's router: a constructor parameter or a
 * property typed `Router`, one given `inject(Router)`, or `inject(Router)` itself.
 */
const isRouter = (receiver: TsNode): boolean => {
  if (injectsRouter(receiver)) return true;
  if (!Node.isPropertyAccessExpression(receiver) && !Node.isIdentifier(receiver)) return false;
  const symbol = Node.isPropertyAccessExpression(receiver) ? receiver.getNameNode().getSymbol() : receiver.getSymbol();
  return (symbol?.getDeclarations() ?? []).some(holdsRouter);
};

/** Whether a component holds the router under a name its template can call: `constructor(public router: Router)`. */
export const holdsRouterAs = (owner: ClassDeclaration, name: string): boolean => {
  const property = owner.getProperty(name);
  if (property !== undefined && holdsRouter(property)) return true;
  return owner.getConstructors().some((constructor) => constructor.getParameters().some((parameter) => parameter.getName() === name && holdsRouter(parameter)));
};

/** What a navigation names: an address with each value read at run time a parameter, relative, or code. */
export type Written = { readonly path: string } | { readonly relative: string } | { readonly code: string };

const literalOf = (node: TsNode): string | undefined =>
  Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralValue() : undefined;

/** `navigate(['/orders', id])` and `navigateByUrl('/orders')`, as the router joins them. */
const writtenOf = (method: string, argument: TsNode | undefined, extras: TsNode | undefined): Written => {
  if (argument === undefined) return { code: '' };
  let path: string | undefined;
  if (ROUTER_METHODS.get(method)?.byUrl === true) {
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

/** The pieces of an array or an argument list written as text, split at their own commas. */
const topLevel = (text: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at] as string;
    if (quote !== undefined) {
      if (char === '\\') at += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, at).trim());
      start = at + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last !== '') parts.push(last);
  return parts;
};

const QUOTED = /^(['"`])([^'"`]*)\1$/;

/** What a navigation written in a template names, read from its argument's text (P288). */
export const writtenOfText = (method: string, argument: string | undefined): Written => {
  const text = argument?.trim() ?? '';
  if (ROUTER_METHODS.get(method)?.byUrl === true) {
    const quoted = QUOTED.exec(text);
    return quoted === null ? { code: text } : { path: (quoted[2] as string).replace(/\$\{[^}]*\}/g, ':param') };
  }
  const array = /^\[([\s\S]*)\]$/.exec(text);
  const elements = array === null ? [] : topLevel(array[1] as string);
  if (elements.length === 0) return { code: text };
  const path = elements
    .map((element) => QUOTED.exec(element)?.[2] ?? ':param')
    .join('/')
    .replace(/\/{2,}/g, '/');
  return { path };
};

/** Where a navigation lands, and the row to write where it lands nowhere. */
export interface NavigationLanding {
  readonly from: string;
  readonly file: string;
  readonly line: number;
  /** Who navigates, for a row's symbol. */
  readonly symbol: string;
  readonly method: string;
  readonly written: Written;
  /** Puts the navigating node in the graph, once an edge hangs off it. */
  ensure(): void;
  /** The edge's type: a function `calls` the screen, a click `triggers` it. */
  readonly type: 'calls' | 'triggers';
}

/**
 * A navigation joined to the component the route at its address shows: an
 * edge, a note for an address out of the application, and a row where no
 * route answers or the address is relative or code (P276).
 */
export const landNavigation = (ctx: AngularExtractContext, landing: NavigationLanding): void => {
  const { from, file, line, symbol, method, written } = landing;
  const shape = ROUTER_METHODS.get(method);
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
  const answering = (path: string): RouteEntry[] => {
    const wanted = normalizePath(path.split(/[?#]/)[0] ?? path);
    return ctx.routes.filter((route) => route.path === wanted);
  };
  const routes = 'path' in written ? answering(written.path) : [];
  const shown = routes.find((route) => route.component !== undefined);
  const target = shown?.component === undefined ? undefined : ctx.classes.get(shown.component);
  if ('path' in written && target !== undefined && shown !== undefined) {
    landing.ensure();
    ctx.ensureClassNode(target.declaration);
    ctx.builder.addEdge({
      from,
      to: target.id,
      type: landing.type,
      confidence: 'static',
      file,
      line,
      meta: {
        [NAVIGATES_META]: written.path,
        route: shown.path,
        page: target.file,
        ...(shape?.byUrl === true ? { byUrl: true } : {}),
        ...(shape?.redirects === true ? { redirects: true } : {}),
      },
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
    hint: why === 'missing' ? 'Correct the address, or configure a route that answers it.' : 'Write the address from the root, as literals or an array of them.',
    meta: { cause: 'navigation-unresolved', why, navigates: shownText },
  });
};

/** The navigation a call makes on the router, when it makes one. */
const routerCall = (node: TsNode): { readonly method: string; readonly written: Written } | undefined => {
  if (!Node.isCallExpression(node)) return undefined;
  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.getName();
  if (!ROUTER_METHODS.has(method) || !isRouter(callee.getExpression())) return undefined;
  const [argument, extras] = (node as CallExpression).getArguments();
  return { method, written: writtenOf(method, argument, extras) };
};

/**
 * Where an Angular application's code navigates (P276): `navigate([...])` and
 * `navigateByUrl(...)` on the router, each a `calls` edge to the component
 * the route at that address shows - a navigation is a call of the screen it
 * lands on, as a front end's other routers' are (P265) - and a guard's
 * `createUrlTree([...])` / `parseUrl(...)`, the address it sends the visitor
 * to instead, an edge with `redirects` (P288). From a method of a class, and
 * from a function of a module - a functional guard, `inject(Router)` - which
 * is a node of its own (P288). A link written in a template (`routerLink`),
 * and a navigation written in a template's handler, are the template
 * reader's, as a click that triggers the screen. An address out of the
 * application is a note; one no route answers, one relative to the route the
 * component is shown at, and one written as code are rows.
 */
export const navigationsPass = definePass('navigations', (ctx: AngularExtractContext) => {
  for (const indexed of ctx.classes.all()) {
    const owner: ClassDeclaration = indexed.declaration;
    for (const { declaration: method, body } of methodBodies(owner)) {
      body.forEachDescendant((node) => {
        const call = routerCall(node);
        if (call === undefined) return;
        const from = ctx.methodIdOf(method);
        if (from === undefined) return;
        landNavigation(ctx, {
          from,
          file: ctx.fileOf(node),
          line: lineOf(node),
          symbol: `${indexed.name}.${method.getName()}`,
          ...call,
          ensure: () => {
            ctx.ensureMethodNode(method);
          },
          type: 'calls',
        });
      });
    }
  }

  // A function of a module: a functional guard, a helper that navigates (P288).
  for (const source of ctx.project.getSourceFiles()) {
    const path = source.getFilePath();
    if (path.includes('/node_modules/') || !ctx.reads(path) || !/\b(?:navigate|navigateByUrl|createUrlTree|parseUrl)\b/.test(source.getFullText())) continue;
    for (const fn of moduleFunctions(source)) {
      const file = ctx.fileOf(fn.declaration);
      const from = makeSymbolId(ctx.repo, file, fn.name);
      fn.body.forEachDescendant((node) => {
        const call = routerCall(node);
        if (call === undefined) return;
        landNavigation(ctx, { from, file, line: lineOf(node), symbol: fn.name, ...call, ensure: () => ensureFunctionNode(ctx, from, file, fn), type: 'calls' });
      });
    }
  }
});

/** The node of a function a module declares, which nothing else in this reader names. */
const ensureFunctionNode = (ctx: AngularExtractContext, id: string, file: string, fn: NamedFunction): void => {
  ctx.builder.addNode({ id, type: 'function', label: fn.name, repo: ctx.repo, file, line: fn.line });
};
