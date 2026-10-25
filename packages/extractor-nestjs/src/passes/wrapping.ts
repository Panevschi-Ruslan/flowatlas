import {
  ACCESS_META,
  addWrappingEdges,
  hasAnyDependency,
  soundsPublic,
  type AccessGuard,
  type AccessOptOut,
  type AccessWhere,
  type RouteAccess,
  makeSymbolId,
  packageOfFile,
  readPackageJson,
  stableKey,
  type AppliedWrapping,
  type GraphNode,
} from '@flowatlas/core';
import { Node } from 'ts-morph';
import type { WrappingLayer } from '../bootstrap.js';
import type { NestExtractContext } from '../context.js';
import type { ClassRole } from '../index-classes.js';
import { collectWrapping } from '../wrapping/collect.js';
import { FlagReaders, flagsOf, type MetadataFlag } from '../wrapping/opt-outs.js';
import type { EntryRecord, MiddlewareRoute, WrapperApplication } from '../wrapping/types.js';
import { definePass } from './types.js';

/** Order the framework runs the layers in. */
const LAYER_ORDER: readonly WrappingLayer[] = ['guard', 'interceptor', 'pipe'];

const ROLE_OF_LAYER: Record<WrappingLayer, ClassRole> = {
  middleware: 'middleware',
  guard: 'guard',
  interceptor: 'interceptor',
  pipe: 'pipe',
};

/**
 * A route pattern in `forRoutes` covers the path itself and everything under it,
 * which is what makes `forRoutes('orders')` cover `/orders/:id` too.
 */
export const pathMatches = (pattern: string, path: string | undefined): boolean => {
  if (path === undefined) return false;
  if (pattern === '/*' || pattern === '*' || pattern === '/') return true;
  const base = pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern;
  return path === base || path.startsWith(`${base}/`);
};

export const routeMatches = (route: MiddlewareRoute, entry: EntryRecord): boolean => {
  if (route.controller !== undefined) return entry.handlerClass === route.controller;
  if (
    route.method !== undefined &&
    route.method !== 'ALL' &&
    entry.httpMethod !== undefined &&
    entry.httpMethod !== 'ALL' &&
    entry.httpMethod !== route.method
  ) {
    return false;
  }
  return route.path === undefined ? true : pathMatches(route.path, entry.routePath ?? entry.path);
};

const middlewareApplies = (application: WrapperApplication, entry: EntryRecord): boolean => {
  if (entry.kind !== 'http') return false;
  const routes = application.routes;
  if (routes === undefined) return false;
  if (routes.exclude.some((route) => routeMatches(route, entry))) return false;
  return routes.include.some((route) => routeMatches(route, entry));
};

/**
 * The node a wrapper application points at.
 *
 * A wrapper built by a call gets its own node per distinct set of arguments,
 * because a guard configured one way and the same guard configured another are
 * two different checks at run time.
 */
const wrapperNode = (
  ctx: NestExtractContext,
  application: WrapperApplication,
): GraphNode | undefined => {
  const { ref, factoryArgs } = application.wrapper;
  const suffix =
    factoryArgs === undefined || factoryArgs.length === 0
      ? ''
      : `(${factoryArgs.map((value) => stableKey(value)).join(',')})`;
  const role = ROLE_OF_LAYER[application.layer];

  if (ref.kind === 'local') {
    const indexed = ctx.classes.get(ref.declaration);
    if (indexed === undefined) return undefined;
    const base = ctx.ensureClassNode(ref.declaration);
    if (suffix === '' || base === undefined) return base;
    return ctx.builder.addNode({
      ...base,
      id: `${base.id}${suffix}`,
      label: `${indexed.name}${suffix}`,
      meta: { ...base.meta, factoryArgs },
    });
  }

  if (ref.kind === 'external') {
    const base = ctx.ensureExternalClassNode({
      typeName: ref.typeName,
      package: ref.package,
      role,
      ...(suffix === '' ? {} : { meta: { factoryArgs } }),
    });
    if (suffix === '') return base;
    return ctx.builder.addNode({
      ...base,
      id: `${base.id}${suffix}`,
      label: `${ref.typeName}${suffix}`,
      meta: { ...base.meta, factoryArgs },
    });
  }

  // A function middleware has no class, but it still runs on the request.
  if (application.layer !== 'middleware') return undefined;
  return ctx.builder.addNode({
    id: makeSymbolId(ctx.repo, application.file, ref.text),
    type: 'middleware',
    label: ref.text,
    repo: ctx.repo,
    file: application.file,
    line: application.wrapper.line,
    kind: 'function',
  });
};

/**
 * Frameworks whose application has a bootstrap file in this sense at all.
 *
 * This reader opens an Express, a Fastify and a Koa repository as readily as a
 * NestJS one — which of them it is, is decided by the entry adapters and not
 * here. `bootstrap` is not a word any of the other three knows: there is no
 * file where global guards, global pipes and a global prefix are installed on
 * an application object, because those frameworks install such things wherever
 * the application is, and the entry adapters read them there.
 *
 * So the missing-bootstrap row is raised only where the setting it names would
 * do anything. Asked of the manifest rather than of `services[].type`, because
 * `extract` on a bare directory has no configured type to ask, and those are
 * exactly the repositories that were being told to set it.
 *
 * And asked of the service's **own** manifest, not of `ctx.pkg`. "Is this a Nest
 * application" is *what is this package*, which `readPackageJson` answers;
 * `ctx.pkg` is widened along the workspace to answer *what can the code here
 * import*, and every adapter is right to gate on that one. The two came apart
 * on a Next.js application whose shared DTO package declares `@nestjs/common`
 * for its decorators: the application can import Nest, it is not built on it,
 * and it was told to configure a Nest bootstrap it will never have (R143).
 */
const BOOTSTRAP_FRAMEWORK = ['@nestjs/core', '@nestjs/common'];

/** Whether the service being read says, in its own manifest, that it is built on Nest. */
const isNestApplication = (repoDir: string): boolean =>
  hasAnyDependency(readPackageJson(repoDir) ?? {}, BOOTSTRAP_FRAMEWORK);

/**
 * Where a check was put, in the words a reader asks with (P76).
 *
 * `useGlobalGuards` and `APP_GUARD` both cover every route of the application,
 * and both are `global`; the second is written in a module, which `via` says.
 * Middleware a module installs for some of its paths is `module`, a decorator
 * on the controller `controller`, and one on the handler `route`.
 */
const whereOf = (application: WrapperApplication): AccessWhere => {
  if (application.scope === 'global') return 'global';
  if (application.scope === 'class') return 'controller';
  if (application.scope === 'method') return 'route';
  return 'module';
};

const nameOfHolder = (application: WrapperApplication): string => {
  if (application.method !== undefined) {
    const owner = application.method.getParent();
    const ownerName = Node.isClassDeclaration(owner) ? owner.getName() : undefined;
    return `${ownerName === undefined ? '' : `${ownerName}.`}${application.method.getName()}`;
  }
  return application.owner?.getName() ?? '';
};

/** How a check was attached, in a phrase: `APP_GUARD in AuthModule`, `@UseGuards on OrdersController`. */
const viaOf = (application: WrapperApplication, bootstrapFile: string): string => {
  if (application.source === 'bootstrap') return `useGlobal${application.layer === 'guard' ? 'Guards' : application.layer === 'pipe' ? 'Pipes' : 'Interceptors'} in ${bootstrapFile}`;
  if (application.source === 'configure') return `consumer.apply in ${application.registeredIn ?? application.file}`;
  if (application.scope === 'global') return `${application.source} in ${application.registeredIn ?? application.file}`;
  // A decorator of the project's own that bundles the guard is named for what
  // was written on the class or the handler: `StaffOnly:UseGuards`.
  const [written] = application.source.split(':');
  return `@${written ?? application.source} on ${nameOfHolder(application)}`;
};

/**
 * What stands between a request and this entry, and what the handler opted out
 * of, as `meta.access` on the entry (P76).
 *
 * The chain is the one just drawn, minus what cannot refuse a request for who
 * is asking: interceptors and pipes. A check is switched off for the route
 * where a decorator on the handler or its class sets a flag the check itself
 * reads; the decorator and the reading are both in this repository, so this is
 * read rather than configured.
 */
const accessFor = (
  ctx: NestExtractContext,
  entry: EntryRecord,
  chain: ReadonlyArray<{ application: WrapperApplication; node: GraphNode }>,
  readers: FlagReaders,
): RouteAccess | undefined => {
  const flags: MetadataFlag[] = [
    ...(entry.handlerMethod === undefined ? [] : flagsOf(entry.handlerMethod, 'route', (node) => ctx.fileOf(node))),
    ...(entry.handlerClass === undefined ? [] : flagsOf(entry.handlerClass, 'controller', (node) => ctx.fileOf(node))),
  ];
  const readsFlag = (application: WrapperApplication, flag: MetadataFlag): boolean =>
    application.layer === 'guard' && application.wrapper.ref.kind === 'local' && readers.reads(application.wrapper.ref.declaration, flag);

  const bootstrapFile = ctx.bootstrap.file ?? 'main.ts';
  const guards: AccessGuard[] = [];
  for (const { application, node } of chain) {
    if (application.layer !== 'guard' && application.layer !== 'middleware') continue;
    const skippedBy = flags.find((flag) => readsFlag(application, flag))?.decorator;
    guards.push({
      id: node.id,
      name: node.label,
      layer: application.layer,
      where: whereOf(application),
      via: viaOf(application, bootstrapFile),
      file: application.file,
      ...(application.wrapper.line === undefined ? {} : { line: application.wrapper.line }),
      ...(skippedBy === undefined ? {} : { skippedBy }),
    });
  }

  const optOuts: AccessOptOut[] = flags.map((flag) => ({
    decorator: flag.decorator,
    key: flag.key,
    public: soundsPublic(flag.decorator, flag.key),
    skips: [...new Set(chain.filter(({ application }) => readsFlag(application, flag)).map(({ node }) => node.label))],
    where: flag.where,
    file: flag.file,
    line: flag.line,
  }));
  // One decorator may set two flags, or be written on both the handler and
  // the class; each is said once.
  const seen = new Set<string>();
  const distinct = optOuts.filter((item) => {
    const key = `${item.decorator}\u0000${item.key ?? ''}\u0000${item.where}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (guards.length === 0 && distinct.length === 0) return undefined;
  return { guards, ...(distinct.length === 0 ? {} : { optOuts: distinct }) };
};

/** Reads what the entry file said and settles every class's role. */
export const wrappingCollectPass = definePass('wrapping-collect', (ctx) => {
  if (!ctx.bootstrap.found && isNestApplication(ctx.repoDir)) {
    ctx.report({
      file: ctx.bootstrap.file ?? 'src/main.ts',
      line: 1,
      reason: 'bootstrap-not-found',
      hint: 'Set services[].bootstrap in the configuration, or pass --bootstrap, so globals can be read.',
      symbol: 'bootstrap',
    });
  }
  collectWrapping(ctx);
});

/**
 * Draws the chain of everything that runs before a handler.
 *
 * The order is the one the framework applies, kept in metadata, because an
 * answer to "why did this return 403" is the position in this chain and nothing
 * else. Runs last: middleware is matched against routes, so the entry points
 * have to exist first.
 */
export const wrappingEdgesPass = definePass('wrapping-edges', (ctx: NestExtractContext) => {
  const { globals, byClass, byMethod, middleware } = ctx.wrapping;
  const readers = new FlagReaders();

  for (const entry of ctx.entries) {
    // A route a worker answers before the application, or an update a bot
    // library dispatches itself, never passes through the application's guards.
    // Drawing them would say a route is protected by a check that never runs.
    if (entry.outsideApplication === true) continue;
    const applications: WrapperApplication[] = [];

    for (const application of middleware) {
      if (middlewareApplies(application, entry)) applications.push(application);
    }

    for (const layer of LAYER_ORDER) {
      const ofLayer = (list: readonly WrapperApplication[] | undefined): WrapperApplication[] =>
        (list ?? []).filter((application) => application.layer === layer);
      applications.push(...ofLayer(globals));
      if (entry.handlerClass !== undefined) applications.push(...ofLayer(byClass.get(entry.handlerClass)));
      if (entry.handlerMethod !== undefined) {
        applications.push(...ofLayer(byMethod.get(entry.handlerMethod)));
      }
    }

    // What a wrapper application becomes in the graph is decided in one place,
    // for every reader: the order, the repeated application, and the shape of
    // the edge itself (R109).
    const applied: Array<AppliedWrapping | undefined> = [];
    const chain: Array<{ application: WrapperApplication; node: GraphNode }> = [];
    for (const application of applications) {
      const node = wrapperNode(ctx, application);
      if (node === undefined) {
        applied.push(undefined);
        continue;
      }
      chain.push({ application, node });
      applied.push({
        nodeId: node.id,
        layer: application.layer,
        scope: application.scope,
        source: application.source,
        file: application.file,
        ...(application.wrapper.line === undefined ? {} : { line: application.wrapper.line }),
      });
    }
    addWrappingEdges(ctx.builder, entry.node.id, applied);

    if (entry.kind !== 'http') continue;
    const access = accessFor(ctx, entry, chain, readers);
    const node = access === undefined ? undefined : ctx.builder.getNode(entry.node.id);
    if (node !== undefined) node.meta = { ...node.meta, [ACCESS_META]: access };
  }
});

export { packageOfFile, Node };
