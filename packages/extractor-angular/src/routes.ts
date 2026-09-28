import {
  declarationOf,
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
  ObjectLiteralExpression,
  SourceFile,
  Node as TsNode,
} from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { AngularExtractContext, RouteEntry } from './context.js';

/**
 * Calls that hand the router the configuration a whole application starts from.
 *
 * Kept apart from `forChild` on purpose. A `forChild` array is a piece of a
 * configuration mounted somewhere by a `loadChildren` above it, and reading it
 * as though it were a root puts every route in it at the top of the tree. So the
 * roots are read first and the children are reached through the loaders that
 * mount them; only an array no loader ever reached is read on its own, at the
 * root, which is the best that can be said about it (R104).
 */
const ROOT_CALLS = new Set(['forRoot', 'provideRouter', 'provideRoutes']);

/** The call that hands the router a piece of a configuration mounted elsewhere. */
const CHILD_CALLS = new Set(['forChild']);

/**
 * The properties a route configuration is written with.
 *
 * A description of the shape rather than a parser for it. `Routes` is a type
 * annotation, and an annotation is optional in the language: a video platform writes 21
 * of its 31 route files as `export default [ … ]` with no annotation anywhere,
 * and asking for one found none of them (R104). What identifies a route array is
 * what a route array holds, and that is written down here once.
 *
 * Both halves matter. Every key of every object must be one of these, which is
 * what keeps an array of anything else that happens to carry a `path` - a
 * breadcrumb, a menu, a test case - from being read as a route table. And at
 * least one object must carry one of the {@link ROUTE_MARKS}, so an array of
 * bare `{ data: … }` objects is not one either.
 */
const ROUTE_KEYS = new Set([
  'path',
  'pathMatch',
  'matcher',
  'component',
  'loadComponent',
  'loadChildren',
  'children',
  'redirectTo',
  'outlet',
  'canActivate',
  'canActivateChild',
  'canDeactivate',
  'canLoad',
  'canMatch',
  'resolve',
  'runGuardsAndResolvers',
  'providers',
  'injector',
  'data',
  'title',
  'info',
]);

/** The properties nothing but a route has, one of which a route array must show. */
const ROUTE_MARKS = new Set([
  'path',
  'matcher',
  'component',
  'loadComponent',
  'loadChildren',
  'children',
  'redirectTo',
  'outlet',
  'pathMatch',
]);

/**
 * How far a configuration is followed.
 *
 * Deeper than the six a nesting of `children` ever needs, because a loader and a
 * spread each cost a step too: `/admin/settings/plugins/list-installed` on
 * A video platform is a root, a `loadChildren`, a `children`, a spread, another
 * `children` and a leaf. What the limit is really for is a configuration that
 * loads itself, where the prefix grows on every turn and nothing else would stop.
 */
const MAX_DEPTH = 12;

/** Everything wrapped around an expression that does not change what it names. */
const bare = (expr: Expression): Expression => {
  let current = expr;
  for (;;) {
    if (Node.isParenthesizedExpression(current) || Node.isAwaitExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isAsExpression(current) || Node.isSatisfiesExpression(current)) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
};

/**
 * The literal a name eventually holds, of the kind asked for.
 *
 * A configuration is rarely written where it is used: it is a `const` in the
 * same file, a name imported from another, a barrel re-export, or the default
 * export of a lazily loaded module. Following it goes through
 * {@link declarationOf}, which resolves the alias, because the declaration an
 * imported name has where it is read is the import and not the array - and
 * asking the import for an initializer was why `children: moderationRoutes`
 * came back empty whenever the two were in different files.
 */
const literalBehind = <T extends TsNode>(
  expr: Expression | undefined,
  is: (node: TsNode) => node is T,
  depth = 0,
): T | undefined => {
  if (expr === undefined || depth > 6) return undefined;
  const node = bare(expr);
  if (is(node)) return node;
  const declaration = declarationOf(node);
  if (declaration === undefined) return undefined;
  if (Node.isVariableDeclaration(declaration)) {
    return literalBehind(declaration.getInitializer(), is, depth + 1);
  }
  if (Node.isExportAssignment(declaration)) {
    return literalBehind(declaration.getExpression(), is, depth + 1);
  }
  return undefined;
};

const arrayBehind = (expr: Expression | undefined): ArrayLiteralExpression | undefined =>
  literalBehind(expr, Node.isArrayLiteralExpression);

const objectBehind = (expr: Expression | undefined): ObjectLiteralExpression | undefined =>
  literalBehind(expr, Node.isObjectLiteralExpression);

/** The name a property was written with, quotes and all taken off. */
const nameOf = (text: string): string => text.replace(/^['"]|['"]$/g, '');

/**
 * The expression a route gives a property, through the spreads it was built from.
 *
 * `{ ...commonConfig, component: AdminShell }` is one route written in two
 * places, and asking the literal for its own `path` finds nothing there. The
 * properties are read in the order written and the last answer wins, which is
 * what the language does: a spread after a property overrides it, and a property
 * after a spread overrides the spread.
 */
const routeProperty = (
  literal: ObjectLiteralExpression,
  name: string,
  depth = 0,
): Expression | undefined => {
  if (depth > 6) return undefined;
  let found: Expression | undefined;
  for (const property of literal.getProperties()) {
    if (Node.isPropertyAssignment(property) && nameOf(property.getName()) === name) {
      found = property.getInitializer() ?? found;
      continue;
    }
    if (!Node.isSpreadAssignment(property)) continue;
    const spread = objectBehind(property.getExpression());
    if (spread === undefined) continue;
    const inherited = routeProperty(spread, name, depth + 1);
    if (inherited !== undefined) found = inherited;
  }
  return found;
};

/** A spread this route was built from that could not be followed to an object. */
const unreadSpread = (literal: ObjectLiteralExpression): Expression | undefined => {
  for (const property of literal.getProperties()) {
    if (!Node.isSpreadAssignment(property)) continue;
    const expression = property.getExpression();
    if (objectBehind(expression) === undefined) return expression;
  }
  return undefined;
};

/** Every property name a route object carries, spreads followed. */
const keysOf = (literal: ObjectLiteralExpression, depth = 0): string[] => {
  if (depth > 6) return [];
  const keys: string[] = [];
  for (const property of literal.getProperties()) {
    if (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)) {
      keys.push(nameOf(property.getName()));
      continue;
    }
    if (!Node.isSpreadAssignment(property)) return [];
    const spread = objectBehind(property.getExpression());
    if (spread === undefined) continue;
    keys.push(...keysOf(spread, depth + 1));
  }
  return keys;
};

/**
 * Whether an array holds route configurations, judged by what is in it.
 *
 * This is the whole of recognising a route file without a type annotation, so it
 * is deliberately strict: every key of every object written in the array must be
 * one Angular's `Route` has, and at least one object must carry a key nothing
 * but a route does. A shape that fails either test is left alone rather than
 * read as a route table, because a route invented here becomes a link resolved
 * to the wrong screen, which is worse than a link resolved to none.
 */
const looksLikeRoutes = (array: ArrayLiteralExpression): boolean => {
  let objects = 0;
  let marked = false;
  for (const element of array.getElements()) {
    const node = bare(element);
    if (!Node.isObjectLiteralExpression(node)) continue;
    objects += 1;
    const keys = keysOf(node);
    if (keys.length === 0) return false;
    for (const key of keys) {
      if (!ROUTE_KEYS.has(key)) return false;
      if (ROUTE_MARKS.has(key)) marked = true;
    }
  }
  return objects > 0 && marked;
};

/**
 * The expression a one-expression function hands back, however it is written.
 */
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

/** What a module exports under a name, followed through whatever re-exported it. */
const exportedBy = (call: CallExpression, name: string): TsNode | undefined => {
  const [module] = call.getType().getTypeArguments();
  const symbol = module?.getProperty(name);
  if (symbol === undefined) return undefined;
  return (symbol.getAliasedSymbol() ?? symbol).getDeclarations()[0];
};

/**
 * What a lazy loader loads, when both halves of the answer were written down.
 *
 * `() => import('./x').then((m) => m.X)` says which module and which of its
 * exports, so the checker can be asked the same question it is asked about
 * `component: X`. Two other spellings say the same thing and are read the same
 * way: a property read of an awaited import, and a bare import of a module whose
 * default export is the answer.
 *
 * Anything else comes back undefined. A specifier assembled at run time names no
 * module, and a `then` body that is not a single property read names no export;
 * either way there is nothing here that was read, and a guess would arrive at
 * the reader as a `static` edge.
 *
 * One reading for both loaders. `loadComponent` wants a class out of it and
 * `loadChildren` wants an array, and which of the two a module exports is not a
 * question about how the loader was written - so the writing is read once, here,
 * and each caller says what it wanted to find.
 */
const loaded = (loader: Expression): TsNode | undefined => {
  const returned = returnedBy(loader);
  if (returned === undefined) return undefined;
  const body = bare(returned);

  // `import('./x')`, where the module's default export is the answer.
  const whole = importedModule(body);
  if (whole !== undefined) return exportedBy(whole, 'default');

  // `(await import('./x')).X`
  if (Node.isPropertyAccessExpression(body)) {
    const module = importedModule(body.getExpression());
    return module === undefined ? undefined : exportedBy(module, body.getName());
  }
  if (!Node.isCallExpression(body)) return undefined;

  // `import('./x').then((m) => m.X)`
  const callee = body.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'then') return undefined;
  const module = importedModule(callee.getExpression());
  if (module === undefined) return undefined;
  const picked = returnedBy(body.getArguments()[0]);
  if (picked === undefined) return undefined;
  const access = bare(picked);
  return Node.isPropertyAccessExpression(access)
    ? exportedBy(module, access.getName())
    : undefined;
};

/** Same answer `resolveClassOfExpression` gives, for a class already in hand. */
const refOfClass = (declaration: ClassDeclaration): ClassRef => {
  const pkg = packageOfFile(declaration.getSourceFile().getFilePath());
  return pkg === undefined
    ? { kind: 'local', declaration }
    : { kind: 'external', typeName: declaration.getName() ?? 'default', package: pkg };
};

/** The screen a route loads rather than names, when the loader was written down. */
const lazyComponent = (loader: Expression): ClassRef => {
  const target = loaded(loader);
  return target !== undefined && Node.isClassDeclaration(target)
    ? refOfClass(target)
    : { kind: 'unknown', text: loader.getText() };
};

/**
 * The arrays a `loadChildren` mounts, when the module it names was written down.
 *
 * Two shapes, and the second is the older one. A module that exports its routes
 * is the array itself; a module that is an `NgModule` hands them to
 * `RouterModule.forChild` in its own file, and that call is where the array is.
 * Both are read, because both are a configuration written in the source, and
 * neither was read at all until now: `loadChildren` was left alone on the
 * grounds that which screens a lazy array holds is the bundler's answer. It is
 * not - the specifier is written down, the file is in the project, and refusing
 * to open it cost every link under a lazy prefix its screen (R104).
 */
const loadedRoutes = (loader: Expression): ArrayLiteralExpression[] => {
  const target = loaded(loader);
  if (target === undefined) return [];
  if (Node.isVariableDeclaration(target)) {
    const array = arrayBehind(target.getInitializer());
    return array === undefined ? [] : [array];
  }
  if (Node.isExportAssignment(target)) {
    const array = arrayBehind(target.getExpression());
    return array === undefined ? [] : [array];
  }
  if (!Node.isClassDeclaration(target)) return [];

  const out: ArrayLiteralExpression[] = [];
  target.getSourceFile().forEachDescendant((node: TsNode) => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !CHILD_CALLS.has(callee.getName())) return;
    const array = arrayBehind(node.getArguments()[0] as Expression | undefined);
    if (array !== undefined) out.push(array);
  });
  return out;
};

/** Every array a file offers as a configuration on its own, loader or no loader. */
const declaredRouteArrays = (sourceFile: SourceFile): ArrayLiteralExpression[] => {
  const out: ArrayLiteralExpression[] = [];
  const add = (array: ArrayLiteralExpression | undefined, annotated: boolean): void => {
    if (array === undefined) return;
    if (annotated || looksLikeRoutes(array)) out.push(array);
  };

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const annotation = declaration.getTypeNode()?.getText() ?? '';
    add(arrayBehind(declaration.getInitializer()), /\bRoutes\b/.test(annotation));
  }
  for (const assignment of sourceFile.getExportAssignments()) {
    if (assignment.isExportEquals()) continue;
    add(arrayBehind(assignment.getExpression()), false);
  }

  sourceFile.forEachDescendant((node: TsNode) => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !CHILD_CALLS.has(callee.getName())) return;
    add(arrayBehind(node.getArguments()[0] as Expression | undefined), true);
  });
  return out;
};

/**
 * Every route the repository configures.
 *
 * Read so that a link in a template can be answered with the screen it opens.
 * Roots first, following every loader and every spread from there, so each array
 * is read under the prefix the router mounts it at; then whatever no root ever
 * reached, read at the root, because a configuration nobody could be shown to
 * mount is still a configuration and the paths in it are still the best guess
 * anybody has.
 */
export const collectRoutes = (ctx: AngularExtractContext): RouteEntry[] => {
  const out: RouteEntry[] = [];
  const walked = new Map<ArrayLiteralExpression, Set<string>>();

  const unread = (node: TsNode, symbol: string, what: string): void => {
    ctx.report({
      file: ctx.fileOf(node),
      line: lineOf(node),
      reason: 'route-config-unread',
      hint: `${what} Nothing behind it answers a link.`,
      symbol,
    });
  };

  /** One route object, and everything it mounts under itself. */
  const one = (element: ObjectLiteralExpression, prefix: string, depth: number): void => {
    const missing = unreadSpread(element);
    if (missing !== undefined) {
      unread(
        missing,
        `${prefix}/…`,
        'This route is spread from a name that does not lead to an object written here, so what it configures was not read.',
      );
    }

    const written = routeProperty(element, 'path');
    const value = written === undefined ? undefined : evaluateExpression(written);
    if (written !== undefined && value?.resolved !== true) {
      ctx.report({
        file: ctx.fileOf(written),
        line: lineOf(written),
        reason: 'route-path-dynamic',
        hint: 'The path is built at run time, so no link can be matched against it.',
        symbol: written.getText().slice(0, 80),
      });
    }
    const segment = value?.resolved === true && typeof value.value === 'string' ? value.value : '';
    const path = normalizePath(`${prefix}/${segment}`);

    // A route names its screen or loads it, and both are read. A route that
    // does both is read the way the router reads it: the loader is never run
    // when a component is already there, so it is never looked at here either.
    const component = routeProperty(element, 'component');
    const loader = component === undefined ? routeProperty(element, 'loadComponent') : undefined;
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

    const children = routeProperty(element, 'children');
    if (children !== undefined) {
      const array = arrayBehind(children);
      if (array === undefined) {
        unread(children, path, 'The children of this route are not an array written here.');
      } else {
        take(array, path, depth + 1);
      }
    }

    const lazy = routeProperty(element, 'loadChildren');
    if (lazy === undefined) return;
    const arrays = loadedRoutes(lazy);
    if (arrays.length === 0) {
      unread(
        lazy,
        path,
        'The routes this loads were not read: the module it names exports neither an array written here nor a class that hands one to forChild.',
      );
      return;
    }
    for (const array of arrays) take(array, path, depth + 1);
  };

  /** One array of route configurations, mounted under a prefix. */
  const walk = (array: ArrayLiteralExpression, prefix: string, depth: number): void => {
    for (const element of array.getElements()) {
      const node = bare(element);
      if (Node.isObjectLiteralExpression(node)) {
        one(node, prefix, depth);
        continue;
      }
      // `children: [ …, ...pluginsRoutes ]` is how a configuration assembled
      // from several files is written, and skipping the element dropped every
      // route in it. It is spliced in where it stands, under the same prefix.
      if (Node.isSpreadElement(node)) {
        const spread = arrayBehind(node.getExpression());
        if (spread === undefined) {
          unread(node, prefix, 'This part of the configuration is spread from a name that does not lead to an array written here.');
          continue;
        }
        take(spread, prefix, depth + 1);
        continue;
      }
      unread(node, prefix, 'This element of the configuration is not a route written here.');
    }
  };

  /**
   * Read an array under a prefix, once.
   *
   * Once per prefix rather than once outright: the same array genuinely is two
   * sets of routes when two loaders mount it in two places, and both sets answer
   * links. What must not happen twice is the same array under the same prefix,
   * which is a configuration that loads itself.
   */
  const take = (array: ArrayLiteralExpression | undefined, prefix: string, depth: number): void => {
    if (array === undefined || depth > MAX_DEPTH) return;
    const prefixes = walked.get(array) ?? new Set<string>();
    if (prefixes.has(prefix)) return;
    prefixes.add(prefix);
    walked.set(array, prefixes);
    walk(array, prefix, depth);
  };

  // Only the files this reader is entitled to: a route configuration in a
  // package Angular is not supplied to is somebody else's router (R159).
  const sources = ctx.project
    .getSourceFiles()
    .filter((sourceFile) => ctx.reads(sourceFile.getFilePath()));

  for (const sourceFile of sources) {
    sourceFile.forEachDescendant((node: TsNode) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      const name = Node.isPropertyAccessExpression(callee)
        ? callee.getName()
        : Node.isIdentifier(callee)
          ? callee.getText()
          : '';
      if (!ROOT_CALLS.has(name)) return;
      take(arrayBehind(node.getArguments()[0] as Expression | undefined), '', 0);
    });
  }

  for (const sourceFile of sources) {
    for (const array of declaredRouteArrays(sourceFile)) {
      if (walked.has(array)) continue;
      take(array, '', 0);
    }
  }

  return out;
};
