import { dirname, relative, resolve, sep } from 'node:path';
import {
  hasAnyDependency,
  normalizeFilePath,
  normalizePath,
  type EntryAdapter,
  type EntryNode,
  type ExtractContext,
} from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import { fsEntries, REMIX_NARROWED, REMIX_REQUEST, REMIX_ROUTES, REMIX_VERBS } from './described-fs-routes.js';
import { readVerbFile, routeAddressOfFile } from './fs-routes.js';
import { readingOf } from './request-readings.js';
import { repoSources, unwrapValue } from './shared.js';

/**
 * React Router v7's route config: `app/routes.ts` default-exports the routes as
 * a list of calls, each naming the module that answers it (P43).
 *
 * ```ts
 * export default [
 *   index('routes/home.tsx'),
 *   route('orders/:id', 'routes/order.tsx', [route('edit', 'routes/edit.tsx')]),
 *   layout('routes/auth.tsx', [route('login', 'routes/login.tsx')]),
 *   ...prefix('api', [route('orders', 'routes/api/orders.ts')]),
 * ] satisfies RouteConfig;
 * ```
 *
 * The address is in the config rather than in the file's name, so this reads
 * the config and hands every module it names to the same verb reading Remix's
 * flat routes get: a `loader` is a GET, an `action` the verbs it branches on.
 * `flatRoutes()` from `@react-router/fs-routes`, wherever a list stands, is the
 * directory it names read by that flat convention, under the address it sits
 * at (P48).
 */

/** One route the config declares: the module that answers it, and its address. */
export interface ConfiguredRoute {
  /** The module as the config names it, relative to the config's directory. */
  readonly module: string;
  /** The address with its params named as written: `/orders/:id`. */
  readonly rawPath: string;
  /** The config's line that declares it. */
  readonly line: number;
}

/**
 * The routes the flat convention finds in a directory of the app, by its name
 * relative to the app (`routes` when `flatRoutes()` is handed none), each at an
 * address from `/`. Handed in, so reading the config stays apart from the files.
 */
export type FlatRoutes = (rootDirectory: string) => ReadonlyArray<Omit<ConfiguredRoute, 'line'>>;

const NO_FLAT_ROUTES: FlatRoutes = () => [];

/** The directory a `flatRoutes({ rootDirectory })` call reads, or nothing for one that is not this call. */
const flatRootOf = (node: TsNode | undefined): string | undefined => {
  const value = node === undefined ? undefined : unwrapValue(node);
  if (value === undefined || !Node.isCallExpression(value)) return undefined;
  if (value.getExpression().getText() !== 'flatRoutes') return undefined;
  const options = value.getArguments()[0];
  const literal = options === undefined ? undefined : unwrapValue(options);
  if (literal === undefined || !Node.isObjectLiteralExpression(literal)) return 'routes';
  const root = literal.getProperty('rootDirectory');
  return (Node.isPropertyAssignment(root) ? literalOf(root.getInitializer()) : undefined) ?? 'routes';
};

/** A path under its parent's, joined the way the router joins them. */
const under = (parent: string, path: string | undefined): string => {
  const parts = [...parent.split('/'), ...(path ?? '').split('/')].filter((part) => part !== '');
  return `/${parts.join('/')}`;
};

const literalOf = (node: TsNode | undefined): string | undefined => {
  const value = node === undefined ? undefined : unwrapValue(node);
  return value !== undefined && (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value))
    ? value.getLiteralText()
    : undefined;
};

/** The children a call was handed: its last argument, when that is a list or a `flatRoutes()`. */
const childrenOf = (args: readonly TsNode[]): TsNode | undefined => {
  const last = args.at(-1);
  if (last === undefined) return undefined;
  return Node.isArrayLiteralExpression(unwrapValue(last)) || flatRootOf(last) !== undefined ? last : undefined;
};

/** What one helper call declares: a module at an address, and children under one. */
interface Declared {
  readonly module?: string | undefined;
  readonly path: string;
  readonly children?: TsNode | undefined;
}

/**
 * The four helpers, each a reading of its arguments. `route(path, file,
 * children?)` adds a segment and a module; `index(file)` is a module at its
 * parent's address; `layout(file, children)` a module that adds no segment;
 * `prefix(path, children)` a segment with no module.
 */
type HelperReading = (args: readonly TsNode[], parent: string) => Declared | undefined;

const HELPERS: ReadonlyMap<string, HelperReading> = new Map<string, HelperReading>([
  [
    'route',
    (args, parent) => {
      const path = literalOf(args[0]);
      return path === undefined
        ? undefined
        : { module: literalOf(args[1]), path: under(parent, path), children: childrenOf(args.slice(2)) };
    },
  ],
  ['index', (args, parent) => ({ module: literalOf(args[0]), path: parent })],
  [
    'layout',
    (args, parent) => ({
      module: literalOf(args[0]),
      path: parent,
      children: childrenOf(args.slice(1)),
    }),
  ],
  [
    'prefix',
    (args, parent) => {
      const path = literalOf(args[0]);
      return path === undefined ? undefined : { path: under(parent, path), children: childrenOf(args.slice(1)) };
    },
  ],
]);

/** How deep a config's nesting is followed. */
const NESTING_DEPTH = 16;

/** The routes a `flatRoutes()` call stands for, under the address it sits at. */
const flatRoutesAt = (call: TsNode, root: string, parent: string, flat: FlatRoutes): ConfiguredRoute[] =>
  flat(root).map((route) => ({ ...route, rawPath: under(parent, route.rawPath), line: call.getStartLineNumber() }));

/** The routes one list of the config declares, its nested lists included. */
const routesIn = (list: TsNode | undefined, parent: string, depth: number, flat: FlatRoutes): ConfiguredRoute[] => {
  const value = list === undefined ? undefined : unwrapValue(list);
  if (value === undefined || depth > NESTING_DEPTH) return [];
  const literal = Node.isSatisfiesExpression(value) ? unwrapValue(value.getExpression()) : value;
  const root = flatRootOf(literal);
  if (root !== undefined) return flatRoutesAt(literal, root, parent, flat);
  if (!Node.isArrayLiteralExpression(literal)) return [];
  return literal.getElements().flatMap((element) => {
    // `...prefix('api', [...])` and `...(await flatRoutes())` are spread into the list they stand in.
    const written = unwrapValue(Node.isSpreadElement(element) ? element.getExpression() : element);
    if (!Node.isCallExpression(written)) return [];
    const flatRoot = flatRootOf(written);
    if (flatRoot !== undefined) return flatRoutesAt(written, flatRoot, parent, flat);
    const callee = written.getExpression();
    const helper = Node.isIdentifier(callee) ? HELPERS.get(callee.getText()) : undefined;
    const declared = helper?.(written.getArguments(), parent);
    if (declared === undefined) return [];
    const own =
      declared.module === undefined
        ? []
        : [{ module: declared.module, rawPath: declared.path, line: written.getStartLineNumber() }];
    return [...own, ...routesIn(declared.children, declared.path, depth + 1, flat)];
  });
};

/**
 * Every route the config's default export declares; `flat` finds the ones a
 * `flatRoutes()` in it stands for.
 */
export const configuredRoutes = (config: SourceFile, flat: FlatRoutes = NO_FLAT_ROUTES): ConfiguredRoute[] => {
  const exported = config.getExportAssignment((assignment) => !assignment.isExportEquals());
  return routesIn(exported?.getExpression(), '/', 0, flat);
};

/**
 * The flat routes of one app directory: each source file under the directory
 * named, placed by Remix's flat convention, its module relative to the app.
 */
const flatRoutesOf = (ctx: ExtractContext, appDir: string): FlatRoutes => (rootDirectory) => {
  const directory = resolve(appDir, rootDirectory);
  const router = { ...REMIX_ROUTES, root: normalizeFilePath(directory, ctx.repoDir) };
  return [...repoSources(ctx)].flatMap((source) => {
    const path = source.getFilePath();
    if (!resolve(path).startsWith(`${directory}${sep}`)) return [];
    const address = routeAddressOfFile(normalizeFilePath(path, ctx.repoDir), router);
    return address === null ? [] : [{ module: relative(appDir, path), rawPath: address.rawPath }];
  });
};

/** Where React Router v7 keeps its route config. */
const ROUTE_CONFIG = /(?:^|\/)app\/routes\.[cm]?[jt]s$/;

const REGISTRATION = 'routes.ts/route-config';

/** A module the config names that is not in the project: an address with nothing behind it. */
const reportMissingModule = (ctx: ExtractContext, file: string, route: ConfiguredRoute): void => {
  ctx.builder.addUnresolved({
    file,
    line: route.line,
    reason: 'route-module-not-found',
    message: `The route config serves ${route.rawPath} from ${route.module}, which is not a source file of this project, so the route's ways in were not read.`,
    hint: 'Name the module by its path relative to app/, as the file is spelled on disk, or add the file.',
    symbol: route.module,
    adapter: 'react-router-routes',
  });
};

export const reactRouterRoutesAdapter: EntryAdapter = {
  name: 'react-router-routes',
  detect: (pkg) => hasAnyDependency(pkg, ['@react-router/dev']),

  extractEntries(ctx: ExtractContext): EntryNode[] {
    const collected = fsEntries(ctx, 'react-router-routes', readingOf(REMIX_REQUEST));
    for (const config of repoSources(ctx)) {
      if (!ROUTE_CONFIG.test(normalizeFilePath(config.getFilePath(), ctx.repoDir))) continue;
      const appDir = dirname(config.getFilePath());
      const configFile = normalizeFilePath(config.getFilePath(), ctx.repoDir);
      for (const route of configuredRoutes(config, flatRoutesOf(ctx, appDir))) {
        const sourceFile = ctx.project.getSourceFile(resolve(appDir, route.module));
        if (sourceFile === undefined) {
          reportMissingModule(ctx, configFile, route);
          continue;
        }
        const path = normalizePath(route.rawPath);
        const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
        readVerbFile(ctx, sourceFile, {
          file,
          path,
          rawPath: route.rawPath,
          adapter: 'react-router-routes',
          emit: (verb) => collected.add(verb, undefined, REGISTRATION, undefined, { file }),
          verbs: REMIX_VERBS,
          narrowed: REMIX_NARROWED,
          pagesServed: true,
        });
      }
    }
    return collected.entries();
  },
};
