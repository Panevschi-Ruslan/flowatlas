import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  ConfigPath,
  NotLiteral,
  configValueAt,
  hasDependency,
  makeEntryId,
  makeHttpEntryKey,
  normalizeFilePath,
  reachMeta,
  readConfigLiteral,
  toPosixPath,
  type EntryAdapter,
  type EntryNode,
  type ExtractContext,
} from '@flowatlas/core';
import { readVerbFile, routeAddressOfFile, type FsRouter } from './fs-routes.js';
import { packageFinder } from './installed-packages.js';
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

/**
 * A plugin whose functions Gatsby serves: its directory - repository-relative,
 * or absolute where it is installed - and the name its functions are served
 * under; the package, where it is one installed under `node_modules` (P335).
 */
interface GatsbyPlugin {
  readonly dir: string;
  readonly name: string;
  readonly installed?: string;
}

/** A package's `name` in a directory's `package.json`. */
const manifestName = (dir: string): string | undefined => {
  try {
    const name = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown }).name;
    return typeof name === 'string' && name !== '' ? name : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The directory `require.resolve` of an absolute path gives Gatsby a plugin
 * from (P335): a file's directory, or - for a directory - that of the file
 * its `package.json`'s `main`, or its `index.js`, is.
 */
const resolvedDir = (path: string): string | undefined => {
  if (!existsSync(path)) {
    const withJs = ['.js', '.cjs', '.mjs', '.ts'].map((extension) => `${path}${extension}`).find((each) => existsSync(each));
    return withJs === undefined ? undefined : dirname(withJs);
  }
  if (!statSync(path).isDirectory()) return dirname(path);
  let main: unknown;
  try {
    main = (JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as { main?: unknown }).main;
  } catch {
    main = undefined;
  }
  return typeof main === 'string' ? dirname(join(path, main)) : path;
};

/** What the plugins of a site's configuration resolve to, and what of them is not read. */
interface GatsbyPlugins {
  readonly plugins: readonly GatsbyPlugin[];
  /** The configuration's file, where its list, or an entry of it, is not written as a literal or a path. */
  readonly unread?: string;
  /** The plugins listed by a name that is neither a local plugin nor a package installed in the repository. */
  readonly notInstalled: readonly string[];
  readonly file?: string;
}

/**
 * The plugins a site's `gatsby-config` lists (P329, P335), as Gatsby resolves
 * them (`load-plugins/resolve-plugin`, `check-local-plugin`): an entry,
 * `'name'` or `{ resolve: 'name' }`, is local where `plugins/<name>` holds a
 * `package.json`, and is named by that file's `name`, or by the entry where it
 * gives none; else it is the package Node resolves from the site - a package
 * of the workspace, or one installed under `node_modules` - named by its
 * `name`. A path - written as one, built from the configuration's own
 * directory (`path.resolve(__dirname, 'plugins/x')`), or
 * `require.resolve('./plugins/x')` - is the directory of what it resolves to.
 * `unread` says the list, or an entry of it, is not written as a literal: a
 * plugin it lists then is not known.
 */
const pluginsOf = (repoDir: string): GatsbyPlugins => {
  const config = readConfigLiteral(repoDir, GATSBY_CONFIGS);
  if (config === undefined) return { plugins: [], notInstalled: [] };
  const file = normalizeFilePath(config.file, repoDir);
  const configDir = dirname(config.file);
  const listed = configValueAt(config.value, 'plugins');
  if (listed === undefined) return config.value instanceof NotLiteral ? { plugins: [], unread: file, notInstalled: [], file } : { plugins: [], notInstalled: [], file };
  if (!Array.isArray(listed)) return { plugins: [], unread: file, notInstalled: [], file };
  const plugins: GatsbyPlugin[] = [];
  const notInstalled: string[] = [];
  const packageDirOf = packageFinder(repoDir);
  let unread: string | undefined;
  const placed = (absolute: string, name: string | undefined): void => {
    const real = toPosixPath(absolute);
    const pluginName = name ?? manifestName(absolute);
    if (pluginName === undefined) return;
    const installed = real.includes('/node_modules/');
    plugins.push({ dir: installed ? real : normalizeFilePath(real, repoDir), name: pluginName, ...(installed ? { installed: pluginName } : {}) });
  };
  for (const entry of listed) {
    const resolve = typeof entry === 'string' || entry instanceof ConfigPath || entry instanceof NotLiteral ? entry : configValueAt(entry, 'resolve');
    // `require.resolve('./plugins/x')`, or of a package's name.
    const required = resolve instanceof NotLiteral ? /^require\.resolve\(\s*(['"`])([^'"`]+)\1\s*\)$/.exec(resolve.text.trim())?.[2] : undefined;
    if (resolve instanceof ConfigPath || (required !== undefined && /^[.]{0,2}\//.test(required))) {
      const dir = resolvedDir(resolve instanceof ConfigPath ? resolve.path : join(configDir, required as string));
      if (dir === undefined) unread = file;
      else placed(dir, undefined);
      continue;
    }
    const written = required ?? resolve;
    if (typeof written !== 'string') {
      unread = file;
      continue;
    }
    // A path that is there is no local plugin's name: Gatsby resolves `<path>/package.json` from the site.
    if (/^[.]{0,2}\//.test(written)) {
      const at = join(repoDir, written);
      if (existsSync(join(at, 'package.json'))) placed(at, undefined);
      else unread = file;
      continue;
    }
    const local = `plugins/${written}`;
    if (existsSync(join(repoDir, local, 'package.json'))) {
      plugins.push({ dir: local, name: manifestName(join(repoDir, local)) ?? written });
      continue;
    }
    const pkg = packageDirOf(written);
    if (pkg === undefined) notInstalled.push(written);
    else placed(pkg.dir, typeof pkg.manifest['name'] === 'string' ? (pkg.manifest['name'] as string) : undefined);
  }
  return { plugins, notInstalled, file, ...(unread === undefined ? {} : { unread }) };
};

/** The function files under an installed plugin's `src/api/<name>`, repository-relative where they are below it, as Gatsby globs them. */
const installedFunctionFiles = (dir: string, name: string): string[] => {
  const root = join(dir, 'src', 'api', name);
  const found: string[] = [];
  const walk = (at: string, depth: number): void => {
    if (depth > 12) return;
    let names: string[];
    try {
      names = readdirSync(at);
    } catch {
      return;
    }
    for (const each of names.sort()) {
      const path = join(at, each);
      if (statSync(path).isDirectory()) walk(path, depth + 1);
      else found.push(toPosixPath(path));
    }
  };
  walk(root, 0);
  return found;
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
 * `--prefix-paths`, each is also served under the site's `pathPrefix`. A
 * plugin listed by a path, or resolved as a package of the workspace, is read
 * the same way (P335); one installed under `node_modules` serves its
 * functions as ways in whose code is the package's (`handlerVia: 'package'`),
 * and one listed by a name installed nowhere in the repository is said.
 */
export const gatsbyFunctionsAdapter: EntryAdapter = {
  name: ADAPTER,
  detect: (pkg) => hasDependency(pkg, 'gatsby'),
  extractEntries(ctx: ExtractContext): EntryNode[] {
    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    const { plugins, unread, notInstalled, file: configFile } = pluginsOf(ctx.repoDir);
    const prefix = servedPrefixOf(ctx.repoDir);
    const absoluteOf = (dir: string): string => toPosixPath(isAbsolute(dir) ? dir : join(ctx.repoDir, dir)).replace(/\/$/, '');
    // The site's own functions first, then each plugin's, as Gatsby lists them.
    const routers: { readonly root: string; readonly under: string; readonly plugin?: GatsbyPlugin }[] = [
      { root: absoluteOf(''), under: GATSBY_FUNCTIONS.root },
      ...plugins.map((plugin) => ({ root: absoluteOf(plugin.dir), under: `src/api/${plugin.name}`, plugin })),
    ];
    const sources = [...repoSources(ctx)].map((sourceFile) => ({
      sourceFile,
      file: normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir),
      absolute: toPosixPath(sourceFile.getFilePath()),
    }));
    if (unread !== undefined) {
      const unlisted = sources.filter(
        ({ file, absolute }) => /^plugins\/[^/]+\/src\/api\//.test(file) && !routers.some((each) => absolute.startsWith(`${each.root}/${each.under}/`)),
      );
      if (unlisted.length > 0) {
        ctx.builder.addUnresolved({
          file: unread,
          line: 1,
          reason: 'route-registry-unread',
          symbol: 'plugins',
          message: `The plugins ${unread} lists are not all written as names or paths, so the functions of ${[...new Set(unlisted.map(({ file }) => file.split('/')[1]))].join(', ')} under plugins/ are not read as ways in.`,
          hint: "List each plugin by its name, 'name' or { resolve: 'name' }, or by a path built from the configuration's directory, in the configuration's plugins.",
          adapter: ADAPTER,
        });
      }
    }
    if (notInstalled.length > 0 && configFile !== undefined) {
      ctx.builder.addUnresolved({
        file: configFile,
        line: 1,
        reason: 'route-registry-unread',
        level: 'info',
        symbol: notInstalled.join(', '),
        message: `${configFile} lists ${notInstalled.join(', ')}, neither a local plugin nor a package installed in the repository, so the functions a plugin may serve at /api/<its name>/... are not read for ${notInstalled.length === 1 ? 'it' : 'them'}.`,
        hint: 'Install the dependencies where the map is built to have an installed plugin\'s functions read.',
        adapter: ADAPTER,
      });
    }
    const pathsOf = (path: string): string[] => (prefix === undefined ? [path] : [path, `${prefix}${path}`]);
    for (const { root, under, plugin } of routers) {
      if (plugin?.installed !== undefined) {
        // An installed plugin's functions: its ways in, its code the package's (P335).
        for (const absolute of installedFunctionFiles(root, plugin.name)) {
          const relative = absolute.slice(root.length + 1);
          if (!isFunctionFile(relative, under)) continue;
          const address = routeAddressOfFile(relative, GATSBY_FUNCTIONS);
          if (address === null) continue;
          for (const path of pathsOf(address.path)) {
            const key = makeHttpEntryKey('ALL', path);
            const id = makeEntryId(ctx.repo, 'http', key);
            if (seen.has(id)) continue;
            seen.add(id);
            entries.push({
              id,
              kind: 'http',
              label: `ALL ${path}`,
              key,
              request: REQUEST,
              file: configFile ?? 'package.json',
              line: 1,
              meta: {
                method: 'ALL',
                path,
                adapter: ADAPTER,
                registration: 'gatsby/function',
                plugin: plugin.name,
                package: plugin.installed,
                declaredIn: normalizeFilePath(absolute, ctx.repoDir),
                ...(path === address.path ? {} : { pathPrefix: prefix }),
                middlewareRead: false,
                handlerVia: 'package',
              },
            });
          }
        }
        continue;
      }
      for (const { sourceFile, file, absolute } of sources) {
        if (!absolute.startsWith(`${root}/`)) continue;
        const relative = absolute.slice(root.length + 1);
        if (!isFunctionFile(relative, under)) continue;
        const address = routeAddressOfFile(relative, GATSBY_FUNCTIONS);
        if (address === null) continue;
        readVerbFile(ctx, sourceFile, {
          file,
          path: address.path,
          rawPath: address.rawPath,
          adapter: ADAPTER,
          verbs: FUNCTION_VERBS,
          narrowed: NARROWED,
          emit: (verb) => {
            for (const path of pathsOf(verb.path)) {
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
                  ...(plugin === undefined ? {} : { plugin: plugin.name }),
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
