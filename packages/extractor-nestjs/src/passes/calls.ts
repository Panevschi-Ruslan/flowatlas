import {
  findMethod,
  forEachCall,
  lineOf,
  memberFunction,
  namedFunction,
  originOfValue,
  resolveReceiver,
  type NamedFunction,
} from '@flowatlas/core';
import type { ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import type { ClassRole } from '../index-classes.js';
import { definePass } from './types.js';

const WALKED: ReadonlySet<ClassRole> = new Set([
  'controller',
  'injectable',
  'guard',
  'interceptor',
  'pipe',
  'middleware',
  'plain',
]);

const MODULE_REF = new Set(['ModuleRef', 'LazyModuleLoader']);

/** The body being walked, and how what it reaches is recorded. */
interface Caller {
  /** Repo-relative path the calls are written in. */
  file: string;
  /** How the caller is named in a report: `OrdersService.create`, or `cancelOrder`. */
  label: string;
  id: string;
  /** The class the body belongs to, absent when it belongs to none. */
  owner?: ClassDeclaration;
  /** Creates the caller's own node, which nothing does until it has an edge. */
  ensure(): void;
}

/**
 * Draws the edges one body's calls stand for.
 *
 * Only a receiver the checker resolves to a class of this repository produces an
 * edge. A receiver from an installed package is a leaf that a later phase turns
 * into data or network access, so it is counted rather than reported; a receiver
 * nothing can pin down is reported rather than guessed.
 *
 * `onFunctionCall` is how the walk of a function follows a plain `send()` to the
 * function it names. A method's walk passes nothing, because following every
 * helper a method calls would make a node of every function in the repository,
 * which is a much larger change than the one this is part of.
 */
const walkCalls = (
  ctx: NestExtractContext,
  caller: Caller,
  body: TsNode,
  onFunctionCall?: (fn: NamedFunction, call: TsNode) => void,
): void => {
  forEachCall(body, (call) => {
    const callee = call.getExpression();

    if (!Node.isPropertyAccessExpression(callee)) {
      if (Node.isIdentifier(callee) && onFunctionCall !== undefined) {
        const origin = originOfValue(callee);
        if (origin.kind !== 'local') return;
        const fn = namedFunction(origin.declaration);
        if (fn !== undefined) onFunctionCall(fn, call);
        return;
      }
      if (Node.isElementAccessExpression(callee)) {
        ctx.report({
          file: caller.file,
          line: lineOf(call),
          reason: 'call-dynamic-receiver',
          level: 'info',
          hint: 'The method is chosen at run time; nothing static to point at.',
          symbol: `${caller.label} -> ${callee.getText()}`,
        });
      }
      return;
    }

    const receiverExpr = callee.getExpression();
    const calledName = callee.getName();

    // `commands.myOrders(ctx)` on `export const commands = { myOrders: … }` —
    // a module of functions spelled as an object, followed like a function
    // called by name.
    if (onFunctionCall !== undefined && Node.isIdentifier(receiverExpr)) {
      const origin = originOfValue(receiverExpr);
      const member =
        origin.kind === 'local' && Node.isVariableDeclaration(origin.declaration)
          ? memberFunction(origin.declaration.getNameNode(), calledName)
          : undefined;
      if (member !== undefined) {
        onFunctionCall(member, call);
        return;
      }
    }

    const receiver = resolveReceiver(receiverExpr, caller.owner, ctx.di);

    // A language built-in says nothing about the shape of the system, and an
    // injection that already failed was reported once at the constructor.
    if (receiver.kind === 'builtin' || receiver.diUnresolved === true) return;

    if (receiver.external !== undefined) {
      if (MODULE_REF.has(receiver.external.typeName)) {
        ctx.report({
          file: caller.file,
          line: lineOf(call),
          reason: 'call-module-ref',
          hint: 'Resolved through the container at run time; inject the class instead to make the edge visible.',
          symbol: `${caller.label} -> ${receiver.text}.${calledName}`,
        });
        return;
      }
      ctx.countExternalCall(receiver.external.package);
      return;
    }

    if (receiver.token !== undefined) {
      ctx.report({
        file: caller.file,
        line: lineOf(call),
        reason: 'call-through-token',
        hint: `Cannot follow a value provided for ${receiver.token}; provide it with useClass to make calls visible.`,
        symbol: `${caller.label} -> ${receiver.text}.${calledName}`,
      });
      return;
    }

    if (receiver.classDecl === undefined) {
      ctx.report({
        file: caller.file,
        line: lineOf(call),
        reason: 'call-dynamic-receiver',
        level: 'info',
        hint: 'The receiver has no single class type; inject a class to make the edge visible.',
        symbol: `${caller.label} -> ${receiver.text}.${calledName}`,
      });
      return;
    }

    const found = findMethod(receiver.classDecl, calledName);
    if (found.externalPackage !== undefined) {
      ctx.countExternalCall(found.externalPackage);
      return;
    }
    if (found.method === undefined) {
      ctx.report({
        file: caller.file,
        line: lineOf(call),
        reason: 'call-dynamic-receiver',
        // The compiler agreed the member exists, so it is a property holding a
        // function rather than a method: assigned from outside, with no one
        // declaration to point at.
        level: 'info',
        hint: `No method named ${calledName} is declared on ${receiver.classDecl.getName() ?? receiver.text} or its bases.`,
        symbol: `${caller.label} -> ${receiver.text}.${calledName}`,
      });
      return;
    }

    const toId = ctx.methodIdOf(found.method);
    if (toId === undefined) return;
    caller.ensure();
    ctx.ensureMethodNode(found.method);
    ctx.builder.addEdge({
      from: caller.id,
      to: toId,
      type: 'calls',
      confidence: 'static',
      file: caller.file,
      line: lineOf(call),
      ...(receiver.kind === 'super' ? { meta: { via: 'super' } } : {}),
    });
  });
};

/** Every method of every class whose role means its body is worth reading. */
const walkClasses = (ctx: NestExtractContext): void => {
  for (const indexed of ctx.classes.all()) {
    if (!WALKED.has(indexed.role)) continue;
    const owner: ClassDeclaration = indexed.declaration;

    for (const method of owner.getMethods()) {
      const body = method.getBody();
      if (body === undefined) continue;
      const id = ctx.methodIdOf(method);
      if (id === undefined) continue;
      let created = false;

      walkCalls(
        ctx,
        {
          file: indexed.file,
          label: `${indexed.name}.${method.getName()}`,
          id,
          owner,
          ensure: () => {
            if (created) return;
            ctx.ensureMethodNode(method);
            created = true;
          },
        },
        body,
      );
    }
  }
};

/**
 * The class `this` means inside a function, when it means one.
 *
 * Only an arrow keeps the `this` it was written under. A `function`, and a
 * method written in an object literal, are handed a `this` of the caller's
 * choosing, so walking out stops at the first of those; an arrow written in a
 * class member reads the class.
 */
const lexicalClassOf = (declaration: NamedFunction['declaration']): ClassDeclaration | undefined => {
  const start: TsNode = Node.isPropertyAssignment(declaration) || Node.isVariableDeclaration(declaration)
    ? (declaration.getInitializer() ?? declaration)
    : declaration;
  if (!Node.isArrowFunction(start)) return undefined;
  for (let at: TsNode | undefined = start.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isClassDeclaration(at)) return at;
    if (Node.isFunctionDeclaration(at) || Node.isFunctionExpression(at)) return undefined;
    if (Node.isMethodDeclaration(at) && !Node.isClassDeclaration(at.getParent())) return undefined;
  }
  return undefined;
};

/**
 * The functions an entry point names, and what they reach.
 *
 * A project that keeps its handlers in a table of `key -> function` has no class
 * between the button and the service it calls, so without this the flow stops at
 * the way in. The walk starts only at functions an adapter named as a handler
 * and spreads through the functions those call, which keeps the graph to what is
 * reachable from an entry point rather than to every function in the repository.
 */
const walkHandlerFunctions = (ctx: NestExtractContext): void => {
  const queue: NamedFunction[] = [];
  const visited = new Set<NamedFunction['declaration']>();
  // Two ways in may name the same handler, and it is still one body to read.
  for (const fn of ctx.handlerFunctions) {
    if (visited.has(fn.declaration)) continue;
    visited.add(fn.declaration);
    queue.push(fn);
  }

  for (let at = 0; at < queue.length; at += 1) {
    const fn = queue[at] as NamedFunction;
    const file = ctx.fileOf(fn.declaration);
    const id = ctx.functionIdOf(fn);

    // A function written in a class — a handler passed to a registration made in
    // a method — still reads `this` as that class, so its calls are followed
    // exactly as the method's own would be.
    const owner = lexicalClassOf(fn.declaration);
    walkCalls(
      ctx,
      {
        file,
        label: fn.name,
        id,
        ...(owner === undefined ? {} : { owner }),
        ensure: () => ctx.ensureFunctionNode(fn),
      },
      fn.body,
      (called, call) => {
        ctx.ensureFunctionNode(fn);
        ctx.ensureFunctionNode(called);
        ctx.builder.addEdge({
          from: id,
          to: ctx.functionIdOf(called),
          type: 'calls',
          confidence: 'static',
          file,
          line: lineOf(call),
        });
        if (visited.has(called.declaration)) return;
        visited.add(called.declaration);
        queue.push(called);
      },
    );
  }
};

/** Turns call sites into edges between the things that hold them. */
export const callsPass = definePass('calls', (ctx: NestExtractContext) => {
  walkClasses(ctx);
  walkHandlerFunctions(ctx);
});
