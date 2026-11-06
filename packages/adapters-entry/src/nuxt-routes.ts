import {
  hasAnyDependency,
  lineAndColumnAt,
  makeEntryId,
  makeHttpEntryKey,
  normalizeFilePath,
  type EntryAdapter,
  type EntryNode,
  type EntryWrapping,
  type ExtractContext,
  type RequestReadingDescription,
} from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import { nuxtConventions, nuxtLayoutOf } from './framework-conventions.js';
import { routeAddressOfFile, type FsRouter } from './fs-routes.js';
import { readingOf } from './request-readings.js';
import { inlineHandlerOf, repoSources } from './shared.js';

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

/** Every file under `server/middleware`, in name order, as the wrapping of every route. */
const middlewareOf = (ctx: ExtractContext): EntryWrapping[] =>
  [...repoSources(ctx)]
    .map((sourceFile) => ({ sourceFile, file: normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir) }))
    .filter(({ file }) => /(^|\/)server\/middleware\/[^/]+\.[cm]?[jt]s$/.test(file))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map(({ sourceFile, file }) => {
      const handler = defaultHandlerOf(sourceFile);
      const at = handler === undefined ? 1 : lineAndColumnAt(sourceFile, handler.getStart()).line;
      return { label: file.split('/').pop()?.replace(/\.[cm]?[jt]s$/, '') ?? file, layer: 'middleware', scope: 'global', source: 'server/middleware', file, line: at, kind: 'file' };
    });

export const nitroRoutesAdapter: EntryAdapter = {
  name: 'nitro-routes',
  detect: (pkg) => hasAnyDependency(pkg, ['nuxt', 'nitropack', 'h3']),
  // Nuxt's aliases and the names its files use unimported (P240).
  conventions: nuxtConventions,

  extractEntries(ctx: ExtractContext): EntryNode[] {
    const request = readingOf(NITRO_REQUEST);
    const wrapping = middlewareOf(ctx);
    const entries: EntryNode[] = [];
    const serverDir = hasAnyDependency(ctx.pkg, ['nuxt']) ? nuxtLayoutOf(ctx.repoDir, ctx.pkg).serverDir : 'server';
    for (const sourceFile of repoSources(ctx)) {
      const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
      const address = nitroAddressOf(file, serverDir);
      if (address === null) continue;
      const handlerNode = defaultHandlerOf(sourceFile);
      const label = `${address.method} ${address.path}`;
      const handler = inlineHandlerOf(handlerNode, label, ctx);
      const key = makeHttpEntryKey(address.method, address.path);
      if (handler === undefined) {
        ctx.builder.addUnresolved({
          file,
          line: 1,
          reason: 'fs-route-handler-not-read',
          level: 'action',
          message: `${file} serves ${label}, and its default export is not a handler written in place`,
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
        line: handler?.line ?? 1,
        request,
        ...(wrapping.length === 0 ? {} : { wrapping }),
        meta: { method: address.method, path: address.path, rawPath: address.rawPath, adapter: 'nitro-routes', registration: 'server/file' },
      });
    }
    return entries;
  },
};
