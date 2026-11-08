import { join } from 'node:path';
import {
  configValueAt,
  hasAnyDependency,
  lineAndColumnAt,
  makeEntryId,
  makeEntryReference,
  makeHttpEntryKey,
  makeTaskEntryKey,
  NotLiteral,
  readConfigLiteral,
  REACHES_META,
  normalizeFilePath,
  normalizePath,
  type EntryAdapter,
  type EntryNode,
  type EntryWrapping,
  type ExtractContext,
  type PackageJson,
  type RequestReadingDescription,
  type Unresolved,
  type WrappingLayer,
} from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import {
  keptByLayer,
  nuxtApplicationOf,
  nuxtConventions,
  nuxtLayerOf,
  settingRow,
  sveltekitRoutesOf,
  withinLayer,
  type LayerClaim,
  type NuxtLayer,
} from './framework-conventions.js';
import { moduleRouteOf, type NuxtModule } from './nuxt-modules.js';
import { routeAddressOfFile, routePathOfFile, type FsRouter } from './fs-routes.js';
import { readingOf } from './request-readings.js';
import { inlineHandlerOf, repoSources } from './shared.js';
import { listensByCall, nitroListens } from './listen-ports.js';
import { nitroProxies } from './proxy-config.js';

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

/** The directories modules add to the server's (`addServerScanDir`, P255), each with the module. */
const scanDirsOf = (modules: readonly NuxtModule[]): Array<{ dir: string; module: NuxtModule }> =>
  modules.flatMap((module) => module.additions.serverScanDirs.map((dir) => ({ dir, module })));

/**
 * Every file under `server/middleware`, and under the `middleware/` of each
 * directory a module adds to the server's (P255), in name order, and each
 * handler a module puts in front of every route (P251).
 */
const middlewareOf = (ctx: ExtractContext, modules: readonly NuxtModule[]): EntryWrapping[] => [
  ...[...repoSources(ctx)]
    .map((sourceFile) => ({ sourceFile, file: normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir) }))
    .filter(
      ({ file }) =>
        /(^|\/)server\/middleware\/[^/]+\.[cm]?[jt]s$/.test(file) ||
        scanDirsOf(modules).some(({ dir }) => file.startsWith(`${dir}/middleware/`) && /^[^/]+\.[cm]?[jt]s$/.test(file.slice(dir.length + 12))),
    )
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

/** A directory read as a server is (P258): a part's server, or one a module adds, with the part it ranks with. */
interface ServerRoot {
  /** Repo-relative. */
  readonly dir: string;
  readonly layer: NuxtLayer | undefined;
  readonly rank: number;
  /** How its files are registered, for an entry's `meta.registration`. */
  readonly registration: string;
}

/** Every directory a server is read from: each part's, Nitro's own `server/` without Nuxt, and each a module adds (P255). */
const serverRootsOf = (layers: readonly NuxtLayer[], modules: readonly NuxtModule[]): ServerRoot[] => [
  ...(layers.length === 0
    ? [{ dir: 'server', layer: undefined, rank: 0, registration: 'server' }]
    : layers.map((layer, rank) => ({ dir: layer.layout.serverDir, layer, rank, registration: 'server' }))),
  ...scanDirsOf(modules).map(({ dir, module }) => ({ dir, layer: module.layer, rank: module.rank, registration: 'module/addServerScanDir' })),
];

/** The root a file is under, and its path below it. */
const underRoot = (roots: readonly ServerRoot[], file: string, sub: string): { root: ServerRoot; rest: string } | undefined => {
  for (const root of roots) {
    const base = root.dir === '' || root.dir === '.' ? `${sub}/` : `${root.dir}/${sub}/`;
    if (file.startsWith(base)) return { root, rest: file.slice(base.length) };
  }
  return undefined;
};

const SCRIPT = /\.[cm]?[jt]s$/;

/**
 * The hooks of Nitro's application a plugin hooks into that run with every
 * request (P258): `request` in front of every handler, as a middleware is;
 * `beforeResponse` and `afterResponse` around it, as an interceptor is.
 */
const PLUGIN_HOOKS: ReadonlyMap<string, WrappingLayer> = new Map([
  ['request', 'middleware'],
  ['beforeResponse', 'interceptor'],
  ['afterResponse', 'interceptor'],
]);

/**
 * What every server plugin hooks into with each request (P258), in the order
 * Nitro runs the plugins: each a module adds (`addServerPlugin`), then each
 * file of a server's `plugins/` - the parts', then those of a directory a
 * module adds - each `nitroApp.hooks.hook('request', fn)` it makes. In front:
 * the `request` hooks; behind the handler: `beforeResponse` and
 * `afterResponse`.
 */
const pluginHooksOf = (ctx: ExtractContext, roots: readonly ServerRoot[], modules: readonly NuxtModule[]): { before: EntryWrapping[]; after: EntryWrapping[] } => {
  const files: Array<{ file: string; source: string }> = [
    ...modules.flatMap((module) => module.additions.serverPlugins.map((plugin) => ({ file: plugin.file, source: 'module/addServerPlugin' }))),
    ...[...repoSources(ctx)]
      .map((sourceFile) => {
        const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
        const found = underRoot(roots, file, 'plugins');
        return { file, at: found === undefined || !SCRIPT.test(found.rest) || found.rest.includes('/') ? -1 : roots.indexOf(found.root) };
      })
      .filter(({ at }) => at !== -1)
      // Each directory's in turn, the parts' before those modules add, each in the order of its files.
      .sort((a, b) => a.at - b.at || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
      .map(({ file }) => ({ file, source: 'server/plugins' })),
  ];
  const before: EntryWrapping[] = [];
  const after: EntryWrapping[] = [];
  const seen = new Set<string>();
  for (const { file, source } of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    const sourceFile = ctx.project.getSourceFile(join(ctx.repoDir, file));
    if (sourceFile === undefined || !sourceFile.getFullText().includes('hook')) continue;
    const name = file.split('/').pop()?.replace(SCRIPT, '') ?? file;
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node) || !/\.hooks\.hook$/.test(node.getExpression().getText())) return;
      const [hookNode, fn] = node.getArguments();
      const hook = hookNode !== undefined && (Node.isStringLiteral(hookNode) || Node.isNoSubstitutionTemplateLiteral(hookNode)) ? hookNode.getLiteralValue() : undefined;
      const layer = hook === undefined ? undefined : PLUGIN_HOOKS.get(hook);
      if (layer === undefined || fn === undefined) return;
      const wrapping: EntryWrapping = { label: `${name} ${hook}`, layer, scope: 'global', source, file, line: lineAndColumnAt(sourceFile, fn.getStart()).line, kind: 'hook' };
      (hook === 'request' ? before : after).push(wrapping);
    });
  }
  return { before, after };
};

/** The function `defineTask({ run })` runs: the default export's `run`. */
const taskRunOf = (sourceFile: SourceFile): TsNode | undefined => {
  const exported = sourceFile.getExportAssignment((each) => !each.isExportEquals())?.getExpression();
  if (exported === undefined || !Node.isCallExpression(exported) || !/(?:^|\.)defineTask$/.test(exported.getExpression().getText())) return undefined;
  const [first] = exported.getArguments();
  if (first === undefined || !Node.isObjectLiteralExpression(first)) return undefined;
  const run = first.getProperty('run');
  if (run !== undefined && Node.isMethodDeclaration(run)) return run;
  return run !== undefined && Node.isPropertyAssignment(run) ? run.getInitializer() : undefined;
};

/**
 * Nitro's tasks (P258): each file of a server's `tasks/` is a task named by
 * its path below it, `/` read as `:` (`tasks/db/migrate.ts` is `db:migrate`),
 * a way in of its own whose handler is what `defineTask({ run })` runs. A
 * task two parts give is the higher part's.
 */
const taskEntriesOf = (ctx: ExtractContext, roots: readonly ServerRoot[]): EntryNode[] => {
  type TaskClaim = LayerClaim & { sourceFile: SourceFile; name: string; registration: string };
  const claims: TaskClaim[] = [];
  for (const sourceFile of repoSources(ctx)) {
    const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
    const found = underRoot(roots, file, 'tasks');
    if (found === undefined || !SCRIPT.test(found.rest) || /\.d\.[cm]?ts$/.test(found.rest)) continue;
    const name = found.rest.replace(SCRIPT, '').split('/').join(':');
    claims.push({ key: name, label: `the task ${name}`, file, layer: found.root.layer, rank: found.root.rank, sourceFile, name, registration: `${found.root.registration}/tasks` });
  }
  const { kept, rows } = keptByLayer(claims, 'serves');
  for (const row of rows) ctx.builder.addUnresolved(row);
  return kept.map(({ sourceFile, file, name, registration }) => {
    const label = `task ${name}`;
    const handler = inlineHandlerOf(taskRunOf(sourceFile), label, ctx);
    if (handler === undefined) {
      ctx.builder.addUnresolved({
        file,
        line: 1,
        reason: 'fs-route-handler-not-read',
        level: 'action',
        message: `${file} is the task ${name}, and its default export is not \`defineTask({ run })\` written in place`,
        hint: 'Export `defineTask({ meta, run(event) { ... } })` as the default.',
        symbol: label,
        adapter: 'nitro-routes',
      });
    }
    const key = makeTaskEntryKey(name);
    return {
      id: makeEntryId(ctx.repo, 'task', key),
      kind: 'task',
      label,
      key,
      ...(handler === undefined ? {} : { handler }),
      file,
      line: handler?.line ?? 1,
      meta: { task: name, adapter: 'nitro-routes', registration: registration === 'server/tasks' ? 'server/tasks' : 'module/addServerScanDir' },
    };
  });
};

const NUXT_CONFIG_FILES = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs', 'nuxt.config.mts', 'nuxt.config.cjs'];
const NITRO_CONFIG_FILES = ['nitro.config.ts', 'nitro.config.js', 'nitro.config.mjs', 'nitro.config.mts'];

/**
 * Nitro's `scheduledTasks` (P258): each cron expression a way in of the
 * `cron` kind that runs the tasks it lists, joined to each by its name. Read
 * from `nitro.scheduledTasks` of Nuxt's configuration, or `scheduledTasks`
 * of Nitro's; written as code, a row.
 */
const scheduleEntriesOf = (ctx: ExtractContext, nuxt: boolean): EntryNode[] => {
  const config = readConfigLiteral(ctx.repoDir, nuxt ? NUXT_CONFIG_FILES : NITRO_CONFIG_FILES);
  if (config === undefined) return [];
  const setting = nuxt ? 'nitro.scheduledTasks' : 'scheduledTasks';
  const written = configValueAt(config.value, setting);
  const configFile = normalizeFilePath(config.file, ctx.repoDir);
  if (written === undefined) return [];
  if (written instanceof NotLiteral || typeof written !== 'object' || written === null || Array.isArray(written)) {
    ctx.builder.addUnresolved(settingRow(configFile, 'nitro-routes', nuxt ? 'Nuxt' : 'Nitro', setting, 'no schedule'));
    return [];
  }
  const entries: EntryNode[] = [];
  for (const [cron, listed] of Object.entries(written as Record<string, unknown>)) {
    const tasks = typeof listed === 'string' ? [listed] : Array.isArray(listed) && listed.every((each) => typeof each === 'string') ? (listed as string[]) : undefined;
    if (tasks === undefined) {
      ctx.builder.addUnresolved(settingRow(configFile, 'nitro-routes', nuxt ? 'Nuxt' : 'Nitro', `${setting}['${cron}']`, 'no task for it'));
      continue;
    }
    const key = `scheduledTasks ${cron}`;
    entries.push({
      id: makeEntryId(ctx.repo, 'cron', key),
      kind: 'cron',
      label: `cron ${cron}`,
      key,
      file: configFile,
      line: 1,
      meta: { schedule: cron, adapter: 'nitro-routes', registration: 'nitro/scheduledTasks', [REACHES_META]: tasks.map((task) => makeEntryReference('task', makeTaskEntryKey(task))) },
    });
  }
  return entries;
};

export const nitroRoutesAdapter: EntryAdapter = {
  name: 'nitro-routes',
  detect: (pkg) => hasAnyDependency(pkg, ['nuxt', 'nitropack', 'h3']),
  // The dev server's port where the configuration or a script writes it, and
  // an h3 application's own `listen` (P250).
  listens: (ctx) => [...nitroListens(ctx), ...listensByCall(ctx)],
  // `devProxy` and the route rules that proxy (P257).
  proxies: nitroProxies,
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
    const roots = serverRootsOf(layers, modules);
    // A plugin's `request` hooks run before any handler of the server, its middleware's included (P258).
    const hooks = pluginHooksOf(ctx, roots, modules);
    const wrapping = [...hooks.before, ...middlewareOf(ctx, modules), ...hooks.after];
    const entries: EntryNode[] = [];
    type Claim = LayerClaim & {
      sourceFile: SourceFile | undefined;
      address: { path: string; rawPath: string; method: string };
      /** Where a route a module adds is declared: the call (P251). */
      declared?: { line: number; handlerFile: string };
      /** A file of a directory a module adds to the server's (P255). */
      scanned?: boolean;
    };
    const claims: Claim[] = [];
    const scanDirs = scanDirsOf(modules);
    for (const sourceFile of repoSources(ctx)) {
      const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
      const layer = nuxtLayerOf(layers, file);
      const address = layer === undefined ? nitroAddressOf(file) : nitroAddressOf(withinLayer(layer, file), withinLayer(layer, layer.layout.serverDir));
      if (address !== null) {
        const label = `${address.method} ${address.path}`;
        claims.push({ key: makeHttpEntryKey(address.method, address.path), label, file, layer, rank: layer === undefined ? 0 : layers.indexOf(layer), sourceFile, address });
        continue;
      }
      // A directory a module adds is read as `server/` is, at the rank of the part that registers it.
      const scanned = scanDirs.find(({ dir }) => file.startsWith(`${dir}/`));
      // Read from inside it, as a part's own server is: a directory beside the application climbs out with `..`.
      const there = scanned === undefined ? null : nitroAddressOf(`server/${file.slice(scanned.dir.length + 1)}`);
      if (scanned === undefined || there === null) continue;
      const label = `${there.method} ${there.path}`;
      claims.push({ key: makeHttpEntryKey(there.method, there.path), label, file, layer: scanned.module.layer, rank: scanned.module.rank, sourceFile, address: there, scanned: true });
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
    for (const { sourceFile, file, address, label, key, declared, scanned } of kept) {
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
          registration: declared !== undefined ? 'module/addServerHandler' : scanned === true ? 'module/addServerScanDir' : 'server/file',
        },
      });
    }
    // Tasks and what runs them on a schedule (P258).
    entries.push(...taskEntriesOf(ctx, roots), ...scheduleEntriesOf(ctx, application !== undefined));
    return entries;
  },
};
