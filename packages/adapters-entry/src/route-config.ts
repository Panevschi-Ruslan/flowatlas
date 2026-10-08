import { dirname, resolve } from 'node:path';
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
import { fsEntries, REMIX_NARROWED, REMIX_REQUEST, REMIX_VERBS } from './described-fs-routes.js';
import { readVerbFile } from './fs-routes.js';
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
 */

/** One route the config declares: the module that answers it, and its address. */
export interface ConfiguredRoute {
  /** The module as the config names it, relative to the config's directory. */
  readonly module: string;
  /** The address with its params named as written: `/orders/:id`. */
  readonly rawPath: string;
}

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

/** The children a call was handed: its last argument, when that is a list. */
const childrenOf = (args: readonly TsNode[]): TsNode | undefined => {
  const last = args.at(-1);
  return last !== undefined && Node.isArrayLiteralExpression(unwrapValue(last)) ? last : undefined;
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

/** The routes one list of the config declares, its nested lists included. */
const routesIn = (list: TsNode | undefined, parent: string, depth: number): ConfiguredRoute[] => {
  const value = list === undefined ? undefined : unwrapValue(list);
  if (value === undefined || depth > NESTING_DEPTH) return [];
  const literal = Node.isSatisfiesExpression(value) ? unwrapValue(value.getExpression()) : value;
  if (!Node.isArrayLiteralExpression(literal)) return [];
  return literal.getElements().flatMap((element) => {
    // `...prefix('api', [...])` is spread into the list it stands in.
    const written = unwrapValue(Node.isSpreadElement(element) ? element.getExpression() : element);
    if (!Node.isCallExpression(written)) return [];
    const callee = written.getExpression();
    const helper = Node.isIdentifier(callee) ? HELPERS.get(callee.getText()) : undefined;
    const declared = helper?.(written.getArguments(), parent);
    if (declared === undefined) return [];
    const own = declared.module === undefined ? [] : [{ module: declared.module, rawPath: declared.path }];
    return [...own, ...routesIn(declared.children, declared.path, depth + 1)];
  });
};

/** Every route the config's default export declares. */
export const configuredRoutes = (config: SourceFile): ConfiguredRoute[] => {
  const exported = config.getExportAssignment((assignment) => !assignment.isExportEquals());
  return routesIn(exported?.getExpression(), '/', 0);
};

/** Where React Router v7 keeps its route config. */
const ROUTE_CONFIG = /(?:^|\/)app\/routes\.[cm]?[jt]s$/;

const REGISTRATION = 'routes.ts/route-config';

export const reactRouterRoutesAdapter: EntryAdapter = {
  name: 'react-router-routes',
  detect: (pkg) => hasAnyDependency(pkg, ['@react-router/dev']),

  extractEntries(ctx: ExtractContext): EntryNode[] {
    const collected = fsEntries(ctx, 'react-router-routes', readingOf(REMIX_REQUEST));
    for (const config of repoSources(ctx)) {
      if (!ROUTE_CONFIG.test(normalizeFilePath(config.getFilePath(), ctx.repoDir))) continue;
      const appDir = dirname(config.getFilePath());
      for (const route of configuredRoutes(config)) {
        const sourceFile = ctx.project.getSourceFile(resolve(appDir, route.module));
        if (sourceFile === undefined) continue;
        const path = normalizePath(route.rawPath);
        readVerbFile(ctx, sourceFile, {
          file: normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir),
          path,
          rawPath: route.rawPath,
          adapter: 'react-router-routes',
          emit: (verb) => collected.add(verb, undefined, REGISTRATION),
          verbs: REMIX_VERBS,
          narrowed: REMIX_NARROWED,
          pagesServed: true,
        });
      }
    }
    return collected.entries;
  },
};
