import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NotLiteral,
  configValueAt,
  hasDependency,
  makeEntryId,
  makeHttpEntryKey,
  normalizeFilePath,
  reachMeta,
  readConfigLiteral,
  type EntryAdapter,
  type EntryNode,
  type ExtractContext,
} from '@flowatlas/core';
import { readVerbFile, routeAddressOfFile, type FsRouter } from './fs-routes.js';
import { scriptCommands } from './listen-ports.js';
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
 * The files Gatsby takes for functions under a root: `.js` and `.ts` only, and
 * not a declaration file, a test, nor anything under `__tests__` (its own glob).
 */
const isFunctionFile = (file: string, root: string): boolean =>
  file.startsWith(`${root}/`) && /\.(?:js|ts)$/.test(file) && !/\.d\.ts$/.test(file) && !/\.(?:spec|test)\.(?:js|ts)$/.test(file) && !/(?:^|\/)__tests__\//.test(file);

/** A function answers every verb from its default export, unless it compares the request's method to the ones it answers. */
const FUNCTION_VERBS: ReadonlyMap<string, string> = new Map([['default', 'ALL']]);
const NARROWED: ReadonlySet<string> = new Set(['default']);

/** Its handler is handed Express's request and response, as Gatsby wraps them. */
const REQUEST = readingOf(PAGES_API_REQUEST);

const GATSBY_CONFIGS = ['gatsby-config.ts', 'gatsby-config.js', 'gatsby-config.mjs', 'gatsby-config.cjs'];

/** A local plugin whose functions Gatsby serves: its directory, and the name its functions are served under. */
interface LocalPlugin {
  readonly dir: string;
  readonly name: string;
}

/**
 * The local plugins a site's `gatsby-config` lists (P329), as Gatsby resolves
 * them (`load-plugins/resolve-plugin`, `check-local-plugin`): an entry,
 * `'name'` or `{ resolve: 'name' }`, is local where `plugins/<name>` holds a
 * `package.json`, and is named by that file's `name`, or by the entry where it
 * gives none. `unread` says the list, or an entry of it, is not written as a
 * literal: a plugin it lists then is not known.
 */
const localPluginsOf = (repoDir: string): { readonly plugins: readonly LocalPlugin[]; readonly unread?: string } => {
  const config = readConfigLiteral(repoDir, GATSBY_CONFIGS);
  if (config === undefined) return { plugins: [] };
  const file = normalizeFilePath(config.file, repoDir);
  const listed = configValueAt(config.value, 'plugins');
  if (listed === undefined) return config.value instanceof NotLiteral ? { plugins: [], unread: file } : { plugins: [] };
  if (!Array.isArray(listed)) return { plugins: [], unread: file };
  const plugins: LocalPlugin[] = [];
  let unread: string | undefined;
  for (const entry of listed) {
    const resolve = typeof entry === 'string' ? entry : configValueAt(entry, 'resolve');
    if (typeof resolve !== 'string') {
      unread = file;
      continue;
    }
    const dir = `plugins/${resolve}`;
    let manifest: string;
    try {
      manifest = readFileSync(join(repoDir, dir, 'package.json'), 'utf8');
    } catch {
      continue;
    }
    let name: unknown;
    try {
      name = (JSON.parse(manifest) as { name?: unknown }).name;
    } catch {
      name = undefined;
    }
    plugins.push({ dir, name: typeof name === 'string' && name !== '' ? name : resolve });
  }
  return { plugins, ...(unread === undefined ? {} : { unread }) };
};

/**
 * The path prefix `gatsby serve --prefix-paths` serves the site's functions
 * under as well (P329): Gatsby's `serve` mounts them at `/api/*` on its
 * router at the configuration's `pathPrefix`, and on the application at the
 * root as well, and its functions strip the prefix before they match their
 * path (`PREFIX_TO_STRIP`). Only where a script serves with `--prefix-paths`,
 * or with `PREFIX_PATHS` set to `true` or `1`, as gatsby-cli defaults the flag;
 * `gatsby develop` mounts them at `/api/*` alone.
 */
const servedPrefixOf = (repoDir: string): string | undefined => {
  const prefixed = scriptCommands(repoDir, /\bgatsby\s+serve\b/).some(
    (each) => /(?:^|\s)--prefix-paths\b(?!=false)/.test(each.command) || /(?:^|\s)PREFIX_PATHS=['"]?(?:true|1)\b/.test(each.command),
  );
  if (!prefixed) return undefined;
  const written = configValueAt(readConfigLiteral(repoDir, GATSBY_CONFIGS)?.value, 'pathPrefix');
  if (typeof written !== 'string') return undefined;
  const trimmed = written.replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? undefined : `/${trimmed}`;
};

/**
 * A Gatsby site's functions, its ways in (P327, P329). The development server
 * and `gatsby serve` serve them beside the site's pages, at the ports
 * `gatsbyListens` reads; a site deployed elsewhere serves them where its host
 * does. A local plugin's own functions, `plugins/<dir>/src/api/<name>/**`,
 * are served at `/api/<name>/...`, as Gatsby's functions plugin globs each
 * plugin's `src/api/<plugin name>`; a function of the site's at the same
 * address wins over a plugin's (`unionBy` over the site's first). Served with
 * `--prefix-paths`, each is also served under the site's `pathPrefix`.
 */
export const gatsbyFunctionsAdapter: EntryAdapter = {
  name: ADAPTER,
  detect: (pkg) => hasDependency(pkg, 'gatsby'),
  extractEntries(ctx: ExtractContext): EntryNode[] {
    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    const { plugins, unread } = localPluginsOf(ctx.repoDir);
    const prefix = servedPrefixOf(ctx.repoDir);
    // The site's own functions first, then each plugin's, as Gatsby lists them.
    const routers: { readonly router: FsRouter; readonly under: string; readonly plugin?: string }[] = [
      { router: GATSBY_FUNCTIONS, under: GATSBY_FUNCTIONS.root },
      ...plugins.map((plugin) => ({
        router: { ...GATSBY_FUNCTIONS, root: `${plugin.dir}/src/api` },
        under: `${plugin.dir}/src/api/${plugin.name}`,
        plugin: plugin.name,
      })),
    ];
    const sources = [...repoSources(ctx)].map((sourceFile) => ({ sourceFile, file: normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir) }));
    if (unread !== undefined) {
      const unlisted = sources.filter(({ file }) => /^plugins\/[^/]+\/src\/api\//.test(file) && !routers.some((each) => file.startsWith(`${each.under}/`)));
      if (unlisted.length > 0) {
        ctx.builder.addUnresolved({
          file: unread,
          line: 1,
          reason: 'route-registry-unread',
          symbol: 'plugins',
          message: `The plugins ${unread} lists are not all written as names, so the functions of ${[...new Set(unlisted.map(({ file }) => file.split('/')[1]))].join(', ')} under plugins/ are not read as ways in.`,
          hint: "List each local plugin by its name, 'name' or { resolve: 'name' }, in the configuration's plugins.",
          adapter: ADAPTER,
        });
      }
    }
    for (const { router, under, plugin } of routers) {
      if (plugin !== undefined && !existsSync(join(ctx.repoDir, under))) continue;
      for (const { sourceFile, file } of sources) {
        if (!isFunctionFile(file, under)) continue;
        const address = routeAddressOfFile(file, router);
        if (address === null) continue;
        readVerbFile(ctx, sourceFile, {
          file,
          path: address.path,
          rawPath: address.rawPath,
          adapter: ADAPTER,
          verbs: FUNCTION_VERBS,
          narrowed: NARROWED,
          emit: (verb) => {
            const paths = prefix === undefined ? [verb.path] : [verb.path, `${prefix}${verb.path}`];
            for (const path of paths) {
              const key = makeHttpEntryKey(verb.method, path);
              const id = makeEntryId(ctx.repo, 'http', key);
              if (seen.has(id)) continue;
              seen.add(id);
              const label = `${verb.method} ${path}`;
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
                  path,
                  ...(verb.rawPath === undefined ? {} : { rawPath: path === verb.path ? verb.rawPath : `${prefix}${verb.rawPath}` }),
                  adapter: ADAPTER,
                  registration: 'gatsby/function',
                  ...(plugin === undefined ? {} : { plugin }),
                  ...(path === verb.path ? {} : { pathPrefix: prefix }),
                  middlewareRead: true,
                  handlerVia: verb.handlerVia,
                  ...(verb.bodyRead ? {} : { handlerBodyRead: false }),
                  ...(verb.wrapperUnread === undefined ? {} : { wrapperUnread: verb.wrapperUnread }),
                  ...reachMeta(verb.at),
                },
              });
            }
          },
        });
      }
    }
    return entries;
  },
};
