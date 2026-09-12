import {
  decoratorArgs,
  evaluateExpression,
  findDecorators,
  lineOf,
  normalizePath,
} from '@flowatlas/core';
import type { CallExpression, ClassDeclaration, MethodDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { WrappingLayer } from '../bootstrap.js';
import type { NestExtractContext } from '../context.js';
import type { ClassRole } from '../index-classes.js';
import { NEST_COMMON } from '../index-classes.js';
import { resolveCallableRef, resolveClassExpression, type ClassRef } from '../util/resolve-class.js';
import type {
  MiddlewareRoute,
  MiddlewareRoutes,
  WrapperApplication,
  WrappingCollection,
} from './types.js';

/** Decorator that attaches a wrapper, and the layer it belongs to. */
const DECORATOR_LAYERS: Record<string, WrappingLayer> = {
  UseGuards: 'guard',
  UseInterceptors: 'interceptor',
  UsePipes: 'pipe',
};

/** Provider token that registers a wrapper for the whole application. */
const TOKEN_LAYERS: Record<string, WrappingLayer> = {
  APP_GUARD: 'guard',
  APP_INTERCEPTOR: 'interceptor',
  APP_PIPE: 'pipe',
};

const ROLE_OF_LAYER: Record<WrappingLayer, ClassRole> = {
  middleware: 'middleware',
  guard: 'guard',
  interceptor: 'interceptor',
  pipe: 'pipe',
};

const HTTP_METHOD_NAMES = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'ALL',
  'OPTIONS',
  'HEAD',
  'SEARCH',
] as const;

/** `RequestMethod.GET` is an enum whose value is a number; the name is what we want. */
const requestMethodName = (expr: TsNode): string | undefined => {
  if (Node.isPropertyAccessExpression(expr)) {
    const name = expr.getName();
    if ((HTTP_METHOD_NAMES as readonly string[]).includes(name)) return name;
  }
  const value = evaluateExpression(expr);
  if (value.resolved && typeof value.value === 'number') {
    return HTTP_METHOD_NAMES[value.value];
  }
  return undefined;
};

/** One argument of `forRoutes` or `exclude`. */
const readRoute = (expr: TsNode): MiddlewareRoute | undefined => {
  const value = evaluateExpression(expr);
  if (value.resolved && typeof value.value === 'string') {
    return { path: normalizePath(value.value) };
  }
  if (Node.isObjectLiteralExpression(expr)) {
    const route: MiddlewareRoute = {};
    const pathProperty = expr.getProperty('path');
    if (pathProperty !== undefined && Node.isPropertyAssignment(pathProperty)) {
      const initializer = pathProperty.getInitializer();
      const pathValue = initializer === undefined ? undefined : evaluateExpression(initializer);
      if (pathValue?.resolved !== true || typeof pathValue.value !== 'string') return undefined;
      route.path = normalizePath(pathValue.value);
    }
    const methodProperty = expr.getProperty('method');
    if (methodProperty !== undefined && Node.isPropertyAssignment(methodProperty)) {
      const initializer = methodProperty.getInitializer();
      if (initializer !== undefined) {
        const method = requestMethodName(initializer);
        if (method !== undefined) route.method = method;
      }
    }
    return route;
  }
  const ref = resolveClassExpression(expr);
  if (ref.kind === 'local') return { controller: ref.declaration };
  return undefined;
};

/** Walks a `consumer.apply(...).exclude(...).forRoutes(...)` chain. */
const readConsumerChain = (
  call: CallExpression,
): { applied: TsNode[]; routes: MiddlewareRoutes } | undefined => {
  const routes: MiddlewareRoutes = { include: [], exclude: [], dynamic: false };
  let applied: TsNode[] | undefined;

  let current: TsNode = call;
  const chain: CallExpression[] = [];
  while (Node.isCallExpression(current)) {
    chain.push(current);
    const callee = current.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) break;
    current = callee.getExpression();
  }

  for (const link of chain) {
    const callee = link.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const name = callee.getName();
    if (name === 'apply') {
      applied = link.getArguments();
      continue;
    }
    const target = name === 'forRoutes' ? routes.include : name === 'exclude' ? routes.exclude : undefined;
    if (target === undefined) continue;
    for (const argument of link.getArguments()) {
      const route = readRoute(argument);
      if (route === undefined) {
        routes.dynamic = true;
        continue;
      }
      target.push(route);
    }
  }

  return applied === undefined ? undefined : { applied, routes };
};

const wrapperFrom = (expr: TsNode): { ref: ClassRef; factoryArgs?: unknown[] } | undefined => {
  if (Node.isCallExpression(expr)) {
    const ref = resolveCallableRef(expr.getExpression());
    if (ref.kind === 'unknown') return undefined;
    const values = expr.getArguments().map((item) => evaluateExpression(item));
    const factoryArgs = values.every((value) => value.resolved)
      ? values.map((value) => (value.resolved ? value.value : undefined))
      : undefined;
    return { ref, ...(factoryArgs !== undefined && factoryArgs.length > 0 ? { factoryArgs } : {}) };
  }
  if (Node.isNewExpression(expr)) {
    const ref = resolveClassExpression(expr.getExpression());
    return ref.kind === 'unknown' ? undefined : { ref };
  }
  const ref = resolveClassExpression(expr);
  return ref.kind === 'unknown' ? undefined : { ref };
};

const noteRole = (ctx: NestExtractContext, ref: ClassRef, layer: WrappingLayer): void => {
  if (ref.kind !== 'local') return;
  const indexed = ctx.classes.get(ref.declaration);
  if (indexed === undefined) return;
  // A class used as a wrapper is one, whatever else it looks like. Deciding this
  // before any node exists keeps a guard from being created as a plain provider
  // by whichever pass happens to reach it first.
  if (indexed.role === 'controller' || indexed.role === 'module') return;
  ctx.classes.setRole(ref.declaration, ROLE_OF_LAYER[layer]);
};

/**
 * Finds every wrapper the application installs, wherever it was written.
 *
 * Runs before nodes are created so that roles can be settled first, and long
 * before the edges are drawn, because matching middleware to routes needs the
 * entry points that a later pass discovers.
 */
export const collectWrapping = (ctx: NestExtractContext): WrappingCollection => {
  const collection = ctx.wrapping;

  // Registered while the modules load, so before anything the entry file does.
  for (const info of ctx.modules.all()) {
    for (const provider of info.providers) {
      const layer = TOKEN_LAYERS[provider.token];
      if (layer === undefined) continue;
      const ref: ClassRef | undefined =
        provider.declaration === undefined
          ? undefined
          : { kind: 'local', declaration: provider.declaration };
      if (ref === undefined) {
        ctx.report({
          file: provider.file,
          line: provider.line,
          reason: 'global-wrapper-dynamic',
          hint: `${provider.token} is not registered with a class from this repository.`,
          symbol: provider.token,
        });
        continue;
      }
      noteRole(ctx, ref, layer);
      collection.globals.push({
        layer,
        scope: 'global',
        wrapper: { ref, line: provider.line, text: provider.token },
        source: provider.token,
        file: provider.file,
      });
    }
  }

  // Installed on the application instance after the modules are up.
  for (const global of ctx.bootstrap.globals) {
    noteRole(ctx, global.wrapper.ref, global.layer);
    collection.globals.push({
      layer: global.layer,
      scope: 'global',
      wrapper: global.wrapper,
      source: 'bootstrap',
      file: ctx.bootstrap.file ?? 'main.ts',
    });
  }
  for (const dynamicGlobal of ctx.bootstrap.dynamicGlobals) {
    ctx.report({
      file: ctx.bootstrap.file ?? 'main.ts',
      line: dynamicGlobal.line,
      reason: 'global-wrapper-dynamic',
      hint: 'Name a class, or pass app.get(Class); an expression cannot be followed.',
      symbol: dynamicGlobal.text,
    });
  }

  const readDecorators = (
    holder: ClassDeclaration | MethodDeclaration,
    scope: 'class' | 'method',
  ): WrapperApplication[] => {
    const found: WrapperApplication[] = [];
    for (const [name, layer] of Object.entries(DECORATOR_LAYERS)) {
      for (const decorator of findDecorators(holder, { names: [name], fromModules: NEST_COMMON })) {
        for (const argument of decorator.getArguments()) {
          const wrapper = wrapperFrom(argument);
          if (wrapper === undefined) {
            ctx.report({
              file: ctx.fileOf(holder),
              line: lineOf(argument),
              reason: 'global-wrapper-dynamic',
              hint: `${name} was given something that does not name a class.`,
              symbol: argument.getText(),
            });
            continue;
          }
          noteRole(ctx, wrapper.ref, layer);
          found.push({
            layer,
            scope,
            wrapper: {
              ref: wrapper.ref,
              ...(wrapper.factoryArgs === undefined ? {} : { factoryArgs: wrapper.factoryArgs }),
              line: lineOf(argument),
              text: argument.getText(),
            },
            source: name,
            file: ctx.fileOf(holder),
            ...(scope === 'class' ? { owner: holder as ClassDeclaration } : {}),
            ...(scope === 'method' ? { method: holder as MethodDeclaration } : {}),
          });
        }
      }
    }
    return found;
  };

  for (const indexed of ctx.classes.all()) {
    const classApplications = readDecorators(indexed.declaration, 'class');
    if (classApplications.length > 0) {
      collection.byClass.set(indexed.declaration, classApplications);
    }
    for (const method of indexed.declaration.getMethods()) {
      const methodApplications = readDecorators(method, 'method');
      if (methodApplications.length > 0) collection.byMethod.set(method, methodApplications);
    }

    // Module middleware, declared in configure(consumer).
    if (indexed.role !== 'module') continue;
    const configure = indexed.declaration.getMethod('configure');
    const body = configure?.getBody();
    if (body === undefined) continue;
    body.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) return;
      if (callee.getName() !== 'forRoutes' && callee.getName() !== 'exclude') return;
      // Only the outermost link of a chain is read, so a chain is read once.
      const parent = node.getParent();
      if (parent !== undefined && Node.isPropertyAccessExpression(parent)) return;
      const chain = readConsumerChain(node);
      if (chain === undefined) return;

      if (chain.routes.dynamic) {
        ctx.report({
          file: indexed.file,
          line: lineOf(node),
          reason: 'middleware-route-dynamic',
          hint: 'Use a literal path or a controller class in forRoutes.',
          symbol: `${indexed.name}.configure`,
        });
      }

      for (const applied of chain.applied) {
        const wrapper = wrapperFrom(applied);
        if (wrapper === undefined) {
          // A function middleware still runs; it just has no class to point at.
          const name = applied.getText();
          collection.middleware.push({
            layer: 'middleware',
            scope: 'route',
            wrapper: { ref: { kind: 'unknown', text: name }, line: lineOf(applied), text: name },
            source: 'configure',
            routes: chain.routes,
            file: indexed.file,
          });
          continue;
        }
        noteRole(ctx, wrapper.ref, 'middleware');
        collection.middleware.push({
          layer: 'middleware',
          scope: 'route',
          wrapper: {
            ref: wrapper.ref,
            ...(wrapper.factoryArgs === undefined ? {} : { factoryArgs: wrapper.factoryArgs }),
            line: lineOf(applied),
            text: applied.getText(),
          },
          source: 'configure',
          routes: chain.routes,
          file: indexed.file,
        });
      }
    });
  }

  return collection;
};

export { decoratorArgs };
