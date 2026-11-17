import {
  hasDependency,
  makeEntryId,
  makeHttpEntryKey,
  normalizeFilePath,
  reachMeta,
  type EntryAdapter,
  type EntryNode,
  type ExtractContext,
} from '@flowatlas/core';
import { readVerbFile, routeAddressOfFile, type FsRouter } from './fs-routes.js';
import { PAGES_API_REQUEST, readingOf } from './request-readings.js';
import { handlerOfFunction, inlineHandlerOf, repoSources } from './shared.js';

const ADAPTER = 'gatsby-functions';

/**
 * Gatsby Functions (P327): every `.js` or `.ts` file under `src/api` is one,
 * served under `/api` at its path, `index` standing for its directory;
 * `[id]` is a parameter and `[...rest]` (or `[...]`) the rest of the path.
 * Gatsby reads nothing else as a segment: an underscore or a group in
 * brackets is a literal part of the address.
 */
export const GATSBY_FUNCTIONS: FsRouter = {
  root: 'src/api',
  prefix: '/api',
  segments: ['param', 'catch-all'],
};

/**
 * The files Gatsby takes for functions: `.js` and `.ts` only, and not a
 * declaration file, a test, nor anything under `__tests__` (its own glob).
 */
const isFunctionFile = (file: string): boolean =>
  /^src\/api\/.+\.(?:js|ts)$/.test(file) && !/\.d\.ts$/.test(file) && !/\.(?:spec|test)\.(?:js|ts)$/.test(file) && !/(?:^|\/)__tests__\//.test(file);

/** A function answers every verb from its default export, unless it compares the request's method to the ones it answers. */
const FUNCTION_VERBS: ReadonlyMap<string, string> = new Map([['default', 'ALL']]);
const NARROWED: ReadonlySet<string> = new Set(['default']);

/** Its handler is handed Express's request and response, as Gatsby wraps them. */
const REQUEST = readingOf(PAGES_API_REQUEST);

/**
 * A Gatsby site's functions, its ways in (P327). The development server and
 * `gatsby serve` serve them beside the site's pages, at the ports
 * `gatsbyListens` reads; a site deployed elsewhere serves them where its host
 * does.
 */
export const gatsbyFunctionsAdapter: EntryAdapter = {
  name: ADAPTER,
  detect: (pkg) => hasDependency(pkg, 'gatsby'),
  extractEntries(ctx: ExtractContext): EntryNode[] {
    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    for (const sourceFile of repoSources(ctx)) {
      const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
      if (!isFunctionFile(file)) continue;
      const address = routeAddressOfFile(file, GATSBY_FUNCTIONS);
      if (address === null) continue;
      readVerbFile(ctx, sourceFile, {
        file,
        path: address.path,
        rawPath: address.rawPath,
        adapter: ADAPTER,
        verbs: FUNCTION_VERBS,
        narrowed: NARROWED,
        emit: (verb) => {
          const key = makeHttpEntryKey(verb.method, verb.path);
          const id = makeEntryId(ctx.repo, 'http', key);
          if (seen.has(id)) return;
          seen.add(id);
          const label = `${verb.method} ${verb.path}`;
          const handler = verb.handler !== undefined ? handlerOfFunction(verb.handler, ctx) : inlineHandlerOf(verb.inline, label, ctx);
          entries.push({
            id,
            kind: 'http',
            label,
            key,
            ...(handler === undefined ? {} : { handler }),
            ...(verb.wrapperUnread === undefined ? {} : { handlerConfidence: 'heuristic' as const }),
            request: REQUEST,
            file: verb.at.reached.file,
            line: verb.at.reached.line,
            ...(verb.wrapping === undefined || verb.wrapping.length === 0 ? {} : { wrapping: verb.wrapping }),
            meta: {
              method: verb.method,
              path: verb.path,
              ...(verb.rawPath === undefined ? {} : { rawPath: verb.rawPath }),
              adapter: ADAPTER,
              registration: 'gatsby/function',
              middlewareRead: true,
              handlerVia: verb.handlerVia,
              ...(verb.bodyRead ? {} : { handlerBodyRead: false }),
              ...(verb.wrapperUnread === undefined ? {} : { wrapperUnread: verb.wrapperUnread }),
              ...reachMeta(verb.at),
            },
          });
        },
      });
    }
    return entries;
  },
};
