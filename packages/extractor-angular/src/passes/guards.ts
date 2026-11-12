import {
  declarationOf,
  findMethod,
  forEachCall,
  inlineFunction,
  lineOf,
  makeSymbolId,
  namedFunction,
  packageOfFile,
  resolveClassOfExpression,
  type NamedFunction,
} from '@flowatlas/core';
import type { ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { AngularExtractContext, RouteGuard } from '../context.js';
import { ensureFunctionNode, landNavigation, routerCall } from './navigations.js';
import { definePass } from './types.js';

/** What a guard listed in a route is: a method of a class of the repository, or a function. */
type GuardTarget =
  | { readonly kind: 'method'; readonly id: string; ensure(): void }
  | { readonly kind: 'function'; readonly id: string; readonly fn: NamedFunction; readonly file: string; readonly made?: true }
  | { readonly kind: 'package' }
  | { readonly kind: 'unread'; readonly why: string };

const bare = (node: TsNode): TsNode => {
  let value = node;
  while (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isSatisfiesExpression(value) || Node.isNonNullExpression(value)) value = value.getExpression();
  return value;
};

const inPackage = (node: TsNode): boolean => packageOfFile(node.getSourceFile().getFilePath()) !== undefined || node.getSourceFile().getFilePath().includes('/node_modules/');

/** The method of a guard class the router calls for a guard of this kind. */
const methodOf = (ctx: AngularExtractContext, declaration: ClassDeclaration, kind: RouteGuard['kind']): GuardTarget => {
  const found = findMethod(declaration, kind);
  if (found.externalPackage !== undefined) return { kind: 'package' };
  const method = found.method;
  const id = method === undefined ? undefined : ctx.methodIdOf(method);
  if (method === undefined || id === undefined) return { kind: 'unread', why: `the class ${declaration.getName() ?? 'listed'} has no ${kind} method this reading found` };
  return { kind: 'method', id, ensure: () => void ctx.ensureMethodNode(method) };
};

/** The function a declaration is, as a node of its module: the one id the navigations reader gives it too. */
const functionOf = (ctx: AngularExtractContext, declaration: TsNode, made: boolean): GuardTarget | undefined => {
  const fn = namedFunction(declaration);
  if (fn === undefined) return undefined;
  const file = ctx.fileOf(fn.declaration);
  return { kind: 'function', id: makeSymbolId(ctx.repo, file, fn.name), fn, file, ...(made ? { made: true as const } : {}) };
};

/**
 * What a route's guard names (P291): a class of the repository whose method
 * of the guard's kind the router calls, a function of a module - a
 * functional guard (`requireAuth`, `authGuard: CanActivateFn`), a factory
 * whose call hands one back (`roleGuard('admin')`, the factory standing for
 * what it makes) - or a function written in place in the configuration.
 */
const guardTarget = (ctx: AngularExtractContext, guard: RouteGuard, depth = 0): GuardTarget => {
  const value = bare(guard.value);
  if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) {
    const fn = inlineFunction(value, guard.kind);
    const file = ctx.fileOf(value);
    return { kind: 'function', id: makeSymbolId(ctx.repo, file, fn.name), fn, file };
  }
  const made = Node.isCallExpression(value);
  const named = Node.isCallExpression(value) ? bare(value.getExpression()) : value;
  if (!Node.isIdentifier(named) && !Node.isPropertyAccessExpression(named)) return { kind: 'unread', why: 'it is written as code, not a name of a guard' };
  const declaration = declarationOf(named);
  if (declaration === undefined) {
    // A class the checker resolves through its type, where the name is not declared in the repository.
    const ref = made ? undefined : resolveClassOfExpression(named as never);
    if (ref?.kind === 'local') return methodOf(ctx, ref.declaration, guard.kind);
    if (ref?.kind === 'external') return { kind: 'package' };
    return { kind: 'unread', why: `${named.getText()} names nothing this reading resolves` };
  }
  if (inPackage(declaration)) return { kind: 'package' };
  if (!made && Node.isClassDeclaration(declaration)) return methodOf(ctx, declaration, guard.kind);
  const fn = functionOf(ctx, declaration, made);
  if (fn !== undefined) return fn;
  // `const guards = { auth: authGuard }` and the like: a name holding another name.
  if (!made && depth < 4 && Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    if (initializer !== undefined) return guardTarget(ctx, { kind: guard.kind, value: initializer }, depth + 1);
  }
  return { kind: 'unread', why: `${named.getText()} is not a function or a class this reading reads` };
};

/** The class `inject(X)` asks for, where `X` is a class written in the repository. */
const injectedClass = (node: TsNode): ClassDeclaration | undefined => {
  const value = bare(node);
  if (!Node.isCallExpression(value) || value.getExpression().getText() !== 'inject') return undefined;
  const [token] = value.getArguments();
  const ref = token === undefined ? undefined : resolveClassOfExpression(token as never);
  return ref?.kind === 'local' ? ref.declaration : undefined;
};

/** The class a receiver in a function is: `inject(X)`, or a name a `const` gives it to. */
const receiverClass = (receiver: TsNode): ClassDeclaration | undefined => {
  const value = bare(receiver);
  const injected = injectedClass(value);
  if (injected !== undefined) return injected;
  if (!Node.isIdentifier(value)) return undefined;
  const declaration = value.getSymbol()?.getDeclarations()[0];
  const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
  return initializer === undefined ? undefined : injectedClass(initializer);
};

/**
 * A functional guard's own work (P291): a call of a method of a service it
 * asks for with `inject(X)` is a `calls` edge from the guard to the method,
 * and a navigation it makes on the router a landing, as a module function's
 * is; so the chain goes on past the guard to what it checks.
 */
const drawFunctionBody = (ctx: AngularExtractContext, target: Extract<GuardTarget, { kind: 'function' }>, ensure: () => void): void => {
  forEachCall(target.fn.body, (call) => {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const owner = receiverClass(callee.getExpression());
    if (owner === undefined) return;
    const found = findMethod(owner, callee.getName());
    if (found.externalPackage !== undefined) {
      ctx.countExternalCall(found.externalPackage);
      return;
    }
    const to = found.method === undefined ? undefined : ctx.methodIdOf(found.method);
    if (found.method === undefined || to === undefined) return;
    ensure();
    ctx.ensureMethodNode(found.method);
    ctx.builder.addEdge({ from: target.id, to, type: 'calls', confidence: 'static', file: target.file, line: lineOf(call) });
  });
};

/**
 * The guards and resolvers in front of each screen (P291): for each route
 * that shows a component of the repository, every guard and resolver the
 * router runs before it shows the route - its own, and those of the routes it
 * is nested in - is a `calls` edge from the screen with `meta.guard` its kind
 * and `meta.order` its place, as a page's route middleware is (P255). A
 * navigation lands on the screen, so a flow from it goes through what the
 * router runs first, whether the guard navigates or not. A guard written in
 * place is a function node of its own, named by its kind and line; one a
 * package exports is the package's; one written as code is a row.
 */
export const guardsPass = definePass('guards', (ctx: AngularExtractContext) => {
  const drawnBodies = new Set<string>();
  for (const route of ctx.routes) {
    if (route.component === undefined || route.guards === undefined) continue;
    const screen = ctx.classes.get(route.component);
    if (screen === undefined) continue;
    let order = 0;
    for (const guard of route.guards) {
      const target = guardTarget(ctx, guard);
      if (target.kind === 'package') continue;
      if (target.kind === 'unread') {
        ctx.report({
          file: ctx.fileOf(guard.value),
          line: lineOf(guard.value),
          reason: 'route-config-unread',
          symbol: `${route.path} ${guard.kind}`,
          hint: `What this ${guard.kind} runs was not read: ${target.why}, so the screen's way in does not go through it. List a guard class, or a function of a module, by its name.`,
        });
        continue;
      }
      ctx.ensureClassNode(screen.declaration);
      const ensure = (): void => {
        if (target.kind === 'method') target.ensure();
        else ensureFunctionNode(ctx, target.id, target.file, target.fn);
      };
      ensure();
      ctx.builder.addEdge({
        from: screen.id,
        to: target.id,
        type: 'calls',
        confidence: 'static',
        file: ctx.fileOf(guard.value),
        line: lineOf(guard.value),
        meta: { guard: guard.kind, route: route.path, order: order++, ...(target.kind === 'function' && target.made === true ? { factory: true } : {}) },
      });
      if (target.kind !== 'function' || drawnBodies.has(target.id)) continue;
      drawnBodies.add(target.id);
      drawFunctionBody(ctx, target, ensure);
      // A guard written in place is no module function, so its navigations are read here (P288 reads the module's).
      if (Node.isArrowFunction(target.fn.declaration) || Node.isFunctionExpression(target.fn.declaration)) {
        target.fn.body.forEachDescendant((node) => {
          const call = routerCall(node);
          if (call === undefined) return;
          landNavigation(ctx, { from: target.id, file: target.file, line: lineOf(node), symbol: target.fn.name, ...call, ensure, type: 'calls' });
        });
        const own = routerCall(target.fn.body);
        if (own !== undefined) landNavigation(ctx, { from: target.id, file: target.file, line: lineOf(target.fn.body), symbol: target.fn.name, ...own, ensure, type: 'calls' });
      }
    }
  }
});
