import {
  decoratorArgs,
  decoratorName,
  evaluateExpression,
  findDecorators,
  lineOf,
  normalizePath,
} from '@flowatlas/core';
import type { CallExpression, ClassDeclaration, Decorator, MethodDeclaration, Node as TsNode } from 'ts-morph';
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

/** The arguments a wrapper is built with, when every one of them can be read. */
const factoryArgsOf = (args: readonly TsNode[]): { factoryArgs?: unknown[] } => {
  const values = args.map((item) => evaluateExpression(item));
  if (values.length === 0 || !values.every((value) => value.resolved)) return {};
  return { factoryArgs: values.map((value) => (value.resolved ? value.value : undefined)) };
};

const wrapperFrom = (expr: TsNode): { ref: ClassRef; factoryArgs?: unknown[] } | undefined => {
  if (Node.isCallExpression(expr)) {
    const ref = resolveCallableRef(expr.getExpression());
    if (ref.kind === 'unknown') return undefined;
    return { ref, ...factoryArgsOf(expr.getArguments()) };
  }
  // `new ValidationPipe({ whitelist: true })` configures the instance exactly as
  // a factory call does, and the bootstrap reader already keeps its arguments;
  // dropping them here left a decorator-attached pipe unreadable to the checks
  // that depend on how it is configured.
  if (Node.isNewExpression(expr)) {
    const ref = resolveClassExpression(expr.getExpression());
    return ref.kind === 'unknown' ? undefined : { ref, ...factoryArgsOf(expr.getArguments() ?? []) };
  }
  const ref = resolveClassExpression(expr);
  return ref.kind === 'unknown' ? undefined : { ref };
};

/**
 * The wrapper decorators a decorator of the project's own stands for.
 *
 * `export const ServiceAuth = (name) => applyDecorators(SetMetadata(KEY, name),
 * UseGuards(ServiceAuthGuard))` puts a guard on every route that carries it, and
 * reading only `@UseGuards` written out reported those routes as unguarded. Only
 * a function of this repository whose single answer is an `applyDecorators(...)`
 * call is followed, and only one level deep; anything else stands for nothing.
 */
const composedWrappers = (decorator: Decorator): Array<{ name: string; args: TsNode[] }> => {
  const expression = decorator.getExpression();
  const applied = Node.isCallExpression(expression) ? expression.getExpression() : expression;
  if (!Node.isIdentifier(applied)) return [];
  const symbol = applied.getSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration === undefined) return [];
  const sourceFile = declaration.getSourceFile();
  if (sourceFile.isInNodeModules() || sourceFile.isDeclarationFile()) return [];

  let fn: TsNode | undefined;
  if (Node.isFunctionDeclaration(declaration)) fn = declaration;
  else if (Node.isVariableDeclaration(declaration)) fn = declaration.getInitializer();
  if (fn === undefined || !(Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) {
    return [];
  }
  const body = fn.getBody();
  let answer: TsNode | undefined;
  if (body !== undefined && Node.isBlock(body)) {
    const returns = body.getStatements().filter((statement) => Node.isReturnStatement(statement));
    answer = returns.length === 1 && Node.isReturnStatement(returns[0]) ? returns[0].getExpression() : undefined;
  } else {
    answer = body;
  }
  while (answer !== undefined && (Node.isParenthesizedExpression(answer) || Node.isAsExpression(answer))) {
    answer = answer.getExpression();
  }
  if (answer === undefined || !Node.isCallExpression(answer)) return [];
  const callee = answer.getExpression();
  if (!Node.isIdentifier(callee) || callee.getText() !== 'applyDecorators') return [];

  const out: Array<{ name: string; args: TsNode[] }> = [];
  for (const argument of answer.getArguments()) {
    if (!Node.isCallExpression(argument)) continue;
    const inner = argument.getExpression();
    if (!Node.isIdentifier(inner) || !Object.hasOwn(DECORATOR_LAYERS, inner.getText())) continue;
    out.push({ name: inner.getText(), args: argument.getArguments() });
  }
  return out;
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
    const apply = (name: string, layer: WrappingLayer, argument: TsNode, at: TsNode, source: string): void => {
      const wrapper = wrapperFrom(argument);
      if (wrapper === undefined) {
        ctx.report({
          file: ctx.fileOf(holder),
          line: lineOf(at),
          reason: 'global-wrapper-dynamic',
          hint: `${name} was given something that does not name a class.`,
          symbol: argument.getText(),
        });
        return;
      }
      noteRole(ctx, wrapper.ref, layer);
      found.push({
        layer,
        scope,
        wrapper: {
          ref: wrapper.ref,
          ...(wrapper.factoryArgs === undefined ? {} : { factoryArgs: wrapper.factoryArgs }),
          line: lineOf(at),
          text: argument.getText(),
        },
        source,
        file: ctx.fileOf(holder),
        ...(scope === 'class' ? { owner: holder as ClassDeclaration } : {}),
        ...(scope === 'method' ? { method: holder as MethodDeclaration } : {}),
      });
    };
    for (const [name, layer] of Object.entries(DECORATOR_LAYERS)) {
      for (const decorator of findDecorators(holder, { names: [name], fromModules: NEST_COMMON })) {
        for (const argument of decorator.getArguments()) apply(name, layer, argument, argument, name);
      }
    }
    // A decorator of the project's own that bundles `UseGuards(...)` with
    // metadata through `applyDecorators` attaches the same guard as writing it
    // out. Followed one level, and the line is the one the decorator is written
    // on, since that is where the route takes it on.
    for (const decorator of holder.getDecorators()) {
      for (const inner of composedWrappers(decorator)) {
        const layer = DECORATOR_LAYERS[inner.name];
        if (layer === undefined) continue;
        for (const argument of inner.args) {
          apply(inner.name, layer, argument, decorator, `${decoratorName(decorator)}:${inner.name}`);
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
