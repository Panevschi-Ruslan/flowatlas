import {
  evaluateExpression,
  lineOf,
  normalizePath,
  packageOfFile,
  resolveClassOfExpression,
  type ClassRef,
} from '@flowatlas/core';
import type {
  ArrayLiteralExpression,
  CallExpression,
  ClassDeclaration,
  Expression,
  Node as TsNode,
} from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { AngularExtractContext, RouteEntry } from './context.js';
import { propertyOf } from './util/metadata.js';

/** Calls that hand the router its configuration. */
const ROUTER_CALLS = new Set(['forRoot', 'forChild', 'provideRouter']);

/** Follows a name to the array it was given, since a configuration is rarely inline. */
const arrayBehind = (expr: Expression | undefined): ArrayLiteralExpression | undefined => {
  if (expr === undefined) return undefined;
  if (Node.isArrayLiteralExpression(expr)) return expr;
  if (!Node.isIdentifier(expr)) return undefined;
  const declaration = expr.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  const initializer = declaration.getInitializer();
  return initializer !== undefined && Node.isArrayLiteralExpression(initializer)
    ? initializer
    : undefined;
};

/** The expression a one-expression function hands back, however it is written. */
const returnedBy = (expr: TsNode | undefined): Expression | undefined => {
  if (expr === undefined) return undefined;
  if (!Node.isArrowFunction(expr) && !Node.isFunctionExpression(expr)) return undefined;
  const body = expr.getBody();
  if (!Node.isBlock(body)) return Node.isExpression(body) ? body : undefined;
  const [statement, ...rest] = body.getStatements();
  if (rest.length > 0 || statement === undefined || !Node.isReturnStatement(statement)) {
    return undefined;
  }
  return statement.getExpression();
};

/** Everything wrapped around an expression that does not change what it names. */
const bare = (expr: Expression): Expression => {
  let current = expr;
  for (;;) {
    if (Node.isParenthesizedExpression(current) || Node.isAwaitExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isAsExpression(current)) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
};

/**
 * The `import(…)` an expression is, when its specifier was written down.
 *
 * A specifier put together at run time names no module the compiler has seen, so
 * asking it which class comes out would be asking about nothing.
 */
const importedModule = (expr: Expression): CallExpression | undefined => {
  const call = bare(expr);
  if (!Node.isCallExpression(call)) return undefined;
  if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) return undefined;
  const [specifier] = call.getArguments();
  if (specifier === undefined) return undefined;
  const value = evaluateExpression(specifier);
  return value.resolved && typeof value.value === 'string' ? call : undefined;
};

/** The class a module exports as its default, for a loader that takes no export by name. */
const defaultExportOf = (call: CallExpression): ClassDeclaration | undefined => {
  const [module] = call.getType().getTypeArguments();
  const symbol = module?.getProperty('default');
  if (symbol === undefined) return undefined;
  for (const declaration of (symbol.getAliasedSymbol() ?? symbol).getDeclarations()) {
    if (Node.isClassDeclaration(declaration)) return declaration;
  }
  return undefined;
};

/** Same answer `resolveClassOfExpression` gives, for a class already in hand. */
const refOfClass = (declaration: ClassDeclaration): ClassRef => {
  const pkg = packageOfFile(declaration.getSourceFile().getFilePath());
  return pkg === undefined
    ? { kind: 'local', declaration }
    : { kind: 'external', typeName: declaration.getName() ?? 'default', package: pkg };
};

/**
 * The screen a route loads rather than names.
 *
 * `loadComponent: () => import('./x').then((m) => m.X)` writes down both halves
 * of the answer — which module, and which of its exports — so the checker can be
 * asked the same question it is asked about `component: X`, and the edge that
 * follows is as much a reading as the eager one. Two other spellings say the
 * same thing and are followed the same way: a property read of an awaited
 * import, and a bare import of a module whose default export is the screen.
 *
 * Anything else comes back unknown. A specifier assembled at run time names no
 * module, and a `then` body that is not a single property read names no export;
 * either way there is nothing here that was read, and a guess would arrive at
 * the reader as a `static` edge.
 */
const lazyComponent = (loader: Expression): ClassRef => {
  const text = loader.getText();
  const unknown: ClassRef = { kind: 'unknown', text };
  const returned = returnedBy(loader);
  if (returned === undefined) return unknown;
  const body = bare(returned);

  // `(await import('./x')).X`
  if (Node.isPropertyAccessExpression(body)) {
    return importedModule(body.getExpression()) === undefined
      ? unknown
      : resolveClassOfExpression(body);
  }
  if (!Node.isCallExpression(body)) return unknown;

  // `import('./x')`, where the module's default export is the screen.
  const whole = importedModule(body);
  if (whole !== undefined) {
    const declaration = defaultExportOf(whole);
    return declaration === undefined ? unknown : refOfClass(declaration);
  }

  // `import('./x').then((m) => m.X)`
  const callee = body.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'then') return unknown;
  if (importedModule(callee.getExpression()) === undefined) return unknown;
  const picked = returnedBy(body.getArguments()[0]);
  return picked === undefined ? unknown : resolveClassOfExpression(bare(picked));
};

const walk = (
  ctx: AngularExtractContext,
  array: ArrayLiteralExpression,
  prefix: string,
  out: RouteEntry[],
  depth: number,
): void => {
  if (depth > 6) return;
  for (const element of array.getElements()) {
    if (!Node.isObjectLiteralExpression(element)) continue;
    const written = propertyOf(element, 'path');
    const value = written === undefined ? undefined : evaluateExpression(written);
    const segment = value?.resolved === true && typeof value.value === 'string' ? value.value : '';
    const path = normalizePath(`${prefix}/${segment}`);

    // A route names its screen or loads it, and both are read. A route that
    // does both is read the way the router reads it: the loader is never run
    // when a component is already there, so it is never looked at here either.
    const component = propertyOf(element, 'component');
    const loader = component === undefined ? propertyOf(element, 'loadComponent') : undefined;
    const ref =
      component !== undefined
        ? resolveClassOfExpression(component)
        : loader === undefined
          ? undefined
          : lazyComponent(loader);

    if (loader !== undefined && ref?.kind === 'unknown') {
      ctx.report({
        file: ctx.fileOf(loader),
        line: lineOf(loader),
        reason: 'route-loader-unread',
        hint: "Which screen this route loads was not read, so no link to it reaches one. A loader written as () => import('./x').then((m) => m.X) is followed; a specifier built at run time is not.",
        symbol: path,
      });
    }

    out.push({
      path,
      ...(ref?.kind === 'local' ? { component: ref.declaration } : {}),
    });

    const children = arrayBehind(propertyOf(element, 'children'));
    if (children !== undefined) walk(ctx, children, path, out, depth + 1);
  }
};

/**
 * Every route the repository configures.
 *
 * Read so that a link in a template can be answered with the screen it opens.
 * Only a configuration written out in the source is read: a route behind
 * `loadChildren` names an array of routes rather than a screen, and which
 * screens that array holds is the bundler's answer, not one written here.
 */
export const collectRoutes = (ctx: AngularExtractContext): RouteEntry[] => {
  const out: RouteEntry[] = [];
  const seen = new Set<ArrayLiteralExpression>();

  const take = (array: ArrayLiteralExpression | undefined): void => {
    if (array === undefined || seen.has(array)) return;
    seen.add(array);
    walk(ctx, array, '', out, 0);
  };

  for (const sourceFile of ctx.project.getSourceFiles()) {
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const annotation = declaration.getTypeNode()?.getText() ?? '';
      if (/\bRoutes\b/.test(annotation)) take(arrayBehind(declaration.getInitializer()));
    }
    sourceFile.forEachDescendant((node: TsNode) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      const name = Node.isPropertyAccessExpression(callee)
        ? callee.getName()
        : Node.isIdentifier(callee)
          ? callee.getText()
          : '';
      if (!ROUTER_CALLS.has(name)) return;
      take(arrayBehind(node.getArguments()[0] as Expression | undefined));
    });
  }

  return out;
};
