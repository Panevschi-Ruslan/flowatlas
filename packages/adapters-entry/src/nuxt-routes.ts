import { join } from 'node:path';
import {
  hasAnyDependency,
  lineAndColumnAt,
  makeEntryId,
  makeHttpEntryKey,
  normalizeFilePath,
  normalizePath,
  type EntryAdapter,
  type EntryNode,
  type EntryWrapping,
  type ExtractContext,
  type PackageJson,
  type RequestReadingDescription,
  type Unresolved,
} from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import { keptByLayer, nuxtApplicationOf, nuxtConventions, nuxtLayerOf, sveltekitRoutesOf, withinLayer, type LayerClaim } from './framework-conventions.js';
import { moduleRouteOf, type NuxtModule } from './nuxt-modules.js';
import { routeAddressOfFile, routePathOfFile, type FsRouter } from './fs-routes.js';
import { readingOf } from './request-readings.js';
import { inlineHandlerOf, repoSources } from './shared.js';
import { listensByCall, nitroListens } from './listen-ports.js';

/**
 * Nuxt's addresses, as rows of the file-system routers (P233).
 *
 * The pages are screens at the address of their file: `pages/orders/[id].vue`
 * is `/orders/:id`, `index` the folder's own, `[...slug]` the rest of the
 * path, a `(group)` folder nothing. The server is Nitro's: a file under
 * `server/api` answers under `/api`, one under `server/routes` at the root,
 * and a method in the name - `orders.get.ts`, `[id].delete.ts` - is the only
 * verb it answers; with none it answers every one. Its handler is the
 * function handed to `defineEventHandler` as the file's default export.
 * Every file under `server/middleware` runs in front of every route.
 */
export const NUXT_PAGES: FsRouter = { root: 'pages', segments: ['group', 'param', 'catch-all'] };

/** SvelteKit's screens: a `+page.svelte` is shown at its folder's address, as its `+page.server` is served there. */
export const SVELTEKIT_PAGES: FsRouter = { root: 'src/routes', routeFiles: ['+page'], segments: ['group', 'mixed', 'param', 'catch-all'] };

/** SvelteKit's screens under the directory `kit.files.routes` names (P251). */
export const sveltekitPagesOf = (repoDir: string): FsRouter => {
  const root = sveltekitRoutesOf(repoDir);
  return root === SVELTEKIT_PAGES.root ? SVELTEKIT_PAGES : { ...SVELTEKIT_PAGES, root };
};
export const NITRO_API: FsRouter = { root: 'server/api', prefix: '/api', segments: ['group', 'param', 'catch-all'] };
export const NITRO_ROUTES: FsRouter = { root: 'server/routes', segments: ['group', 'param', 'catch-all'] };

const METHOD_SUFFIX = /\.(get|post|put|patch|delete|head|options)(?=\.[cm]?[jt]s$)/i;

/** Nitro's routers, under the directory a Nuxt application keeps its server in (P240). */
const nitroRouters = (serverDir: string): FsRouter[] =>
  serverDir === 'server'
    ? [NITRO_API, NITRO_ROUTES]
    : [NITRO_API, NITRO_ROUTES].map((router) => ({ ...router, root: router.root.replace(/^server/, serverDir) }));

/**
 * The address and verb a server file answers, its method suffix read off its
 * name. `serverDir` is where the server is, repo-relative: `server` unless a
 * Nuxt application keeps it elsewhere.
 */
export const nitroAddressOf = (file: string, serverDir = 'server'): { path: string; rawPath: string; method: string } | null => {
  const suffix = METHOD_SUFFIX.exec(file);
  const plain = suffix === null ? file : file.replace(METHOD_SUFFIX, '');
  for (const router of nitroRouters(serverDir)) {
    const address = routeAddressOfFile(plain, router);
    if (address !== null) return { ...address, method: suffix === null ? 'ALL' : (suffix[1] as string).toUpperCase() };
  }
  return null;
};

/**
 * The screens of every part of a Nuxt application (P243): a component file
 * under its part's pages directory - `pages/`, or what `dir.pages` names
 * (P251) - at the address of its file there, by file, and each page a module
 * of the repository adds (`extendPages`), at the rank of the part that
 * registers it. A page two parts give is the higher part's; the lower one
 * stays a component that is no screen, and is said as a note.
 */
export const nuxtPagesOf = (
  repoDir: string,
  pkg: PackageJson,
  files: readonly string[],
): { readonly routes: ReadonlyMap<string, string>; readonly rows: readonly Unresolved[] } => {
  const { layers, modules } = nuxtApplicationOf(repoDir, pkg);
  const claims: LayerClaim[] = [];
  for (const file of files) {
    const layer = nuxtLayerOf(layers, file);
    if (layer === undefined) continue;
    const pages = withinLayer(layer, layer.layout.dirs.pages);
    const within = withinLayer(layer, file);
    // Only a file under the part's own pages directory: another directory of that name is not one Nuxt routes.
    if (!within.startsWith(`${pages}/`)) continue;
    const router = { ...NUXT_PAGES, root: pages };
    // The router reads a script's name; a page's ending is the component format's.
    const path = routePathOfFile(within.replace(/\.vue$/, '.ts'), router);
    if (path !== null) claims.push({ key: normalizePath(path), label: path, file, layer, rank: layers.indexOf(layer) });
  }
  const known = new Set(files);
  for (const module of modules.modules) {
    for (const page of module.additions.pages) {
      if (known.has(page.file)) claims.push({ key: normalizePath(page.path), label: page.path, file: page.file, layer: module.layer, rank: module.rank });
    }
  }
  const { kept, rows } = keptByLayer(claims, 'shows');
  return { routes: new Map(kept.map((claim) => [claim.file, claim.label])), rows };
};

/** The functions that make a handler of the function they are handed. */
const HANDLER_FACTORIES = new Set(['defineEventHandler', 'eventHandler', 'defineCachedEventHandler', 'defineNitroPlugin']);

/** The function a server file's default export hands its factory: the handler. */
const defaultHandlerOf = (sourceFile: SourceFile): TsNode | undefined => {
  const exported = sourceFile.getExportAssignment((each) => !each.isExportEquals())?.getExpression();
  if (exported === undefined) return undefined;
  if (Node.isArrowFunction(exported) || Node.isFunctionExpression(exported)) return exported;
  if (!Node.isCallExpression(exported) || !HANDLER_FACTORIES.has(exported.getExpression().getText())) return undefined;
  const [first] = exported.getArguments();
  // `defineEventHandler({ handler, onRequest })`: the object form.
  if (first !== undefined && Node.isObjectLiteralExpression(first)) {
    const handler = first.getProperty('handler');
    if (handler !== undefined && Node.isPropertyAssignment(handler)) return handler.getInitializer();
    if (handler !== undefined && Node.isMethodDeclaration(handler)) return undefined;
  }
  return first;
};

/**
 * What a Nitro handler reads and answers (P29): the part a helper hands back
 * - `readBody(event)`, `getQuery(event)`, `getRouterParam(event, 'id')` - and
 * what it returns. The helpers are found by an import from `h3` or, as Nuxt
 * writes them, by name with no import at all.
 */
export const NITRO_REQUEST: RequestReadingDescription = {
  helpers: [
    { name: 'readBody', package: 'h3', global: true, part: 'body' },
    { name: 'readValidatedBody', package: 'h3', global: true, part: 'body', claim: false },
    { name: 'getQuery', package: 'h3', global: true, part: 'query' },
    { name: 'getValidatedQuery', package: 'h3', global: true, part: 'query', claim: false },
    { name: 'getRouterParam', package: 'h3', global: true, part: 'params' },
    { name: 'getRouterParams', package: 'h3', global: true, part: 'params' },
    { name: 'getHeaders', package: 'h3', global: true, part: 'headers' },
  ],
  answers: [{ by: 'return' }],
};

/** Every file under `server/middleware`, in name order, and each handler a module puts in front of every route (P251). */
const middlewareOf = (ctx: ExtractContext, modules: readonly NuxtModule[]): EntryWrapping[] => [
  ...[...repoSources(ctx)]
    .map((sourceFile) => ({ sourceFile, file: normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir) }))
    .filter(({ file }) => /(^|\/)server\/middleware\/[^/]+\.[cm]?[jt]s$/.test(file))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map(({ sourceFile, file }): EntryWrapping => {
      const handler = defaultHandlerOf(sourceFile);
      const at = handler === undefined ? 1 : lineAndColumnAt(sourceFile, handler.getStart()).line;
      return { label: file.split('/').pop()?.replace(/\.[cm]?[jt]s$/, '') ?? file, layer: 'middleware', scope: 'global', source: 'server/middleware', file, line: at, kind: 'file' };
    }),
  ...modules.flatMap((module) =>
    module.additions.handlers
      .filter((handler) => handler.middleware)
      .map((handler): EntryWrapping => {
        const sourceFile = ctx.project.getSourceFile(join(ctx.repoDir, handler.handler));
        const fn = sourceFile === undefined ? undefined : defaultHandlerOf(sourceFile);
        const at = sourceFile === undefined || fn === undefined ? 1 : lineAndColumnAt(sourceFile, fn.getStart()).line;
        const label = handler.handler.split('/').pop()?.replace(/\.[cm]?[jt]s$/, '') ?? handler.handler;
        return { label, layer: 'middleware', scope: 'global', source: 'module/addServerHandler', file: handler.handler, line: at, kind: 'file' };
      }),
  ),
];

export const nitroRoutesAdapter: EntryAdapter = {
  name: 'nitro-routes',
  detect: (pkg) => hasAnyDependency(pkg, ['nuxt', 'nitropack', 'h3']),
  // The dev server's port where the configuration or a script writes it, and
  // an h3 application's own `listen` (P250).
  listens: (ctx) => [...nitroListens(ctx), ...listensByCall(ctx)],
  // Nuxt's aliases and the names its files use unimported (P240).
  conventions: nuxtConventions,

  extractEntries(ctx: ExtractContext): EntryNode[] {
    const request = readingOf(NITRO_REQUEST);
    // Every part of a Nuxt application serves the routes of its server
    // (P243), and each module of the repository the routes it adds (P251);
    // Nitro on its own is one part, its server in `server/`.
    const application = hasAnyDependency(ctx.pkg, ['nuxt']) ? nuxtApplicationOf(ctx.repoDir, ctx.pkg) : undefined;
    const layers = application?.layers ?? [];
    const modules = application?.modules.modules ?? [];
    const wrapping = middlewareOf(ctx, modules);
    const entries: EntryNode[] = [];
    type Claim = LayerClaim & {
      sourceFile: SourceFile | undefined;
      address: { path: string; rawPath: string; method: string };
      /** Where a route a module adds is declared: the call (P251). */
      declared?: { line: number; handlerFile: string };
    };
    const claims: Claim[] = [];
    for (const sourceFile of repoSources(ctx)) {
      const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
      const layer = nuxtLayerOf(layers, file);
      const address = layer === undefined ? nitroAddressOf(file) : nitroAddressOf(withinLayer(layer, file), withinLayer(layer, layer.layout.serverDir));
      if (address === null) continue;
      const label = `${address.method} ${address.path}`;
      claims.push({ key: makeHttpEntryKey(address.method, address.path), label, file, layer, rank: layer === undefined ? 0 : layers.indexOf(layer), sourceFile, address });
    }
    for (const module of modules) {
      for (const handler of module.additions.handlers) {
        const route = moduleRouteOf(handler);
        if (route === undefined) continue;
        const address = { ...route, method: handler.method };
        claims.push({
          key: makeHttpEntryKey(address.method, address.path),
          label: `${address.method} ${address.path}`,
          file: handler.file,
          layer: module.layer,
          rank: module.rank,
          sourceFile: ctx.project.getSourceFile(join(ctx.repoDir, handler.handler)),
          address,
          declared: { line: handler.line, handlerFile: handler.handler },
        });
      }
    }
    // A route two parts serve is the higher one's, as Nuxt ranks its layers.
    const { kept, rows } = keptByLayer(claims, 'serves');
    for (const row of rows) ctx.builder.addUnresolved(row);
    for (const { sourceFile, file, address, label, key, declared } of kept) {
      const handlerNode = sourceFile === undefined ? undefined : defaultHandlerOf(sourceFile);
      const handler = inlineHandlerOf(handlerNode, label, ctx);
      if (handler === undefined) {
        const of = declared === undefined ? file : declared.handlerFile;
        ctx.builder.addUnresolved({
          file,
          line: declared?.line ?? 1,
          reason: 'fs-route-handler-not-read',
          level: 'action',
          message: `${declared === undefined ? file : `${file} adds a handler that`} serves ${label}, and the default export of ${of} is not a handler written in place`,
          hint: 'Export `defineEventHandler((event) => ...)` as the default, or describe the route.',
          symbol: label,
          adapter: 'nitro-routes',
        });
      }
      entries.push({
        id: makeEntryId(ctx.repo, 'http', key),
        kind: 'http',
        label,
        key,
        ...(handler === undefined ? {} : { handler }),
        file,
        line: declared?.line ?? handler?.line ?? 1,
        request,
        ...(wrapping.length === 0 ? {} : { wrapping }),
        meta: {
          method: address.method,
          path: address.path,
          rawPath: address.rawPath,
          adapter: 'nitro-routes',
          registration: declared === undefined ? 'server/file' : 'module/addServerHandler',
        },
      });
    }
    return entries;
  },
};
