import { makeSymbolId, packageOfFile, stableKey, type GraphNode } from '@flowatlas/core';
import { Node } from 'ts-morph';
import type { WrappingLayer } from '../bootstrap.js';
import type { NestExtractContext } from '../context.js';
import type { ClassRole } from '../index-classes.js';
import { collectWrapping } from '../wrapping/collect.js';
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

/** Reads what the entry file said and settles every class's role. */
export const wrappingCollectPass = definePass('wrapping-collect', (ctx) => {
  if (!ctx.bootstrap.found) {
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

  for (const entry of ctx.entries) {
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

    // The same wrapper can be attached more than once, for instance globally
    // and again on one handler, and it really does run twice. An edge is
    // identified by its endpoints, so every application it stands for is listed
    // on it rather than lost.
    const perTarget = new Map<string, { application: WrapperApplication; orders: Array<{ order: number; scope: string; source: string }> }>();

    applications.forEach((application, order) => {
      const node = wrapperNode(ctx, application);
      if (node === undefined) return;
      const seen = perTarget.get(node.id);
      const applied = { order, scope: application.scope, source: application.source };
      if (seen === undefined) perTarget.set(node.id, { application, orders: [applied] });
      else seen.orders.push(applied);
    });

    for (const [nodeId, { application, orders }] of perTarget) {
      const first = orders[0];
      if (first === undefined) continue;
      ctx.builder.addEdge({
        from: entry.node.id,
        to: nodeId,
        type: 'guarded_by',
        confidence: 'static',
        file: application.file,
        line: application.wrapper.line,
        meta: {
          order: first.order,
          scope: first.scope,
          layer: application.layer,
          source: first.source,
          ...(orders.length > 1 ? { applications: orders } : {}),
        },
      });
    }
  }
});

export { packageOfFile, Node };
