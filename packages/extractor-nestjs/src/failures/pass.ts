import {
  FAILS_META,
  forEachCall,
  hasAnyDependency,
  readPackageJson,
  lineOf,
  settleFailures,
  type EdgeType,
  type Failure,
  type GraphEdge,
  type GraphNode,
} from '@flowatlas/core';
import { Node, type Decorator, type MethodDeclaration } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import { functionNamedBy, memberFunctionCalled } from '../passes/called-function.js';
import { definePass } from '../passes/types.js';
import { scopesOf, type Scope } from '../scopes.js';
import { GUARD_REFUSAL, knownRefusal, NEST_PACKAGES, type Refusal } from './statuses.js';
import { classNamed, throwsIn } from './throws.js';

/** The edges control goes along from a way in to the code that can fail. */
const WALKED: ReadonlySet<EdgeType> = new Set<EdgeType>(['handles', 'calls', 'guarded_by']);

/** How many nodes one way in is walked through before the walk stops. */
const MAX_REACHED = 2000;

/** The decorators that hand a parameter's value through pipes. */
const PARAMETER_DECORATORS: ReadonlySet<string> = new Set(['Param', 'Query', 'Body', 'Headers']);

/** Everything a node and the edges out of it say, read once for every way in. */
interface Reading {
  /** What each body throws, by the id of its node. */
  throws: Map<string, Failure[]>;
  /** The bodies of each class, by the class id, for a check written here. */
  methodsOf: Map<string, string[]>;
  /** Where control goes next from each node. */
  next: Map<string, string[]>;
  /** Checks a parameter of a handler runs, by the handler's id. */
  parameterPipes: Map<string, Failure[]>;
  /** The edge that puts each check in front of what it guards, by both ends. */
  checks: Map<string, GraphEdge>;
}

const checkKey = (from: string, to: string): string => `${from}\u0000${to}`;

const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
};

const throwsOf = (scope: Scope): Failure[] =>
  throwsIn(scope.body).map((thrown) => ({
    ...(thrown.status === undefined ? {} : { status: thrown.status }),
    exception: thrown.exception,
    at: scope.id,
    file: scope.file,
    line: thrown.line,
    source: 'throw',
  }));

/** Calls from one body to a function of this service the graph may not draw. */
const functionHops = (scopes: readonly Scope[]): Map<string, string[]> => {
  const byDeclaration = new Map<unknown, Scope>();
  for (const scope of scopes) if (scope.fn !== undefined) byDeclaration.set(scope.fn.declaration, scope);
  const hops = new Map<string, string[]>();
  for (const scope of scopes) {
    forEachCall(scope.body, (call) => {
      const callee = call.getExpression();
      const fn = Node.isIdentifier(callee)
        ? functionNamedBy(callee)
        : Node.isPropertyAccessExpression(callee)
          ? memberFunctionCalled(callee)
          : undefined;
      const to = fn === undefined ? undefined : byDeclaration.get(fn.declaration);
      if (to !== undefined && to !== scope) push(hops, scope.id, to.id);
    });
  }
  return hops;
};

/** The name a check is known by: its class, without the arguments a factory was given. */
const checkName = (node: GraphNode): string => node.label.replace(/\(.*$/, '');

const packageOf = (node: GraphNode): string | undefined =>
  typeof node.meta?.['package'] === 'string' ? (node.meta['package'] as string) : undefined;

const refusalAt = (refusal: Refusal, node: GraphNode, edge: GraphEdge, source: Failure['source']): Failure => {
  const file = edge.file ?? node.file;
  const line = edge.line ?? node.line;
  return {
    status: refusal.status,
    exception: refusal.exception,
    at: node.id,
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
    source,
  };
};

/**
 * What a check in front of a way in refuses a request with.
 *
 * A guard that says no is a 403 whatever it is, unless it is one of the
 * installed ones known to answer otherwise; a pipe says nothing of its own
 * unless it is one of the framework's. What a check written here throws is
 * read from its body like any other.
 */
const checkFailures = (node: GraphNode, edge: GraphEdge, reading: Reading): Failure[] => {
  const own = (reading.methodsOf.get(node.id) ?? []).flatMap((id) => reading.throws.get(id) ?? []);
  const known = knownRefusal(packageOf(node), checkName(node));
  if (node.type === 'guard') return [refusalAt(known ?? GUARD_REFUSAL, node, edge, 'guard'), ...own];
  if (node.type === 'pipe') return known === undefined ? own : [refusalAt(known, node, edge, 'pipe'), ...own];
  return own;
};

/** `ParseIntPipe` or `new ParseIntPipe(...)` handed to `@Param`, as a check. */
const parameterPipe = (
  ctx: NestExtractContext,
  handler: string,
  argument: Node,
  reading: Pick<Reading, 'methodsOf' | 'throws'>,
): Failure[] => {
  const written = Node.isNewExpression(argument) ? argument.getExpression() : argument;
  if (!Node.isIdentifier(written)) return [];
  const named = classNamed(written);
  if (named.declaration !== undefined) {
    const id = ctx.classIdOf(named.declaration);
    return id === undefined ? [] : (reading.methodsOf.get(id) ?? []).flatMap((method) => reading.throws.get(method) ?? []);
  }
  const known = knownRefusal(named.module, named.name);
  if (known === undefined) return [];
  return [
    {
      status: known.status,
      exception: known.exception,
      at: handler,
      file: ctx.fileOf(argument),
      line: lineOf(argument),
      source: 'pipe',
    },
  ];
};

const parameterPipes = (
  ctx: NestExtractContext,
  handler: string,
  method: MethodDeclaration,
  reading: Pick<Reading, 'methodsOf' | 'throws'>,
): Failure[] =>
  method
    .getParameters()
    .flatMap((parameter) => parameter.getDecorators())
    .filter((decorator: Decorator) => PARAMETER_DECORATORS.has(decorator.getName()))
    .flatMap((decorator) => decorator.getArguments().flatMap((argument) => parameterPipe(ctx, handler, argument, reading)));

const read = (ctx: NestExtractContext): Reading => {
  const scopes = [...scopesOf(ctx)];
  const throws = new Map<string, Failure[]>();
  const methodsOf = new Map<string, string[]>();
  for (const scope of scopes) {
    const found = throwsOf(scope);
    if (found.length > 0) throws.set(scope.id, found);
    if (scope.owner !== undefined) {
      const owner = ctx.classIdOf(scope.owner);
      if (owner !== undefined) push(methodsOf, owner, scope.id);
    }
  }

  const next = functionHops(scopes);
  const checks = new Map<string, GraphEdge>();
  for (const edge of ctx.builder.edges) {
    if (!WALKED.has(edge.type)) continue;
    push(next, edge.from, edge.to);
    if (edge.type === 'guarded_by') checks.set(checkKey(edge.from, edge.to), edge);
  }

  const pipes = new Map<string, Failure[]>();
  const partial = { methodsOf, throws };
  for (const entry of ctx.entries) {
    if (entry.handlerMethod === undefined) continue;
    const id = ctx.methodIdOf(entry.handlerMethod);
    if (id === undefined) continue;
    const found = parameterPipes(ctx, id, entry.handlerMethod, partial);
    if (found.length > 0) pipes.set(id, found);
  }
  return { throws, methodsOf, next, parameterPipes: pipes, checks };
};

/** Every failure of the code one way in reaches, walking this service only. */
const failuresFrom = (ctx: NestExtractContext, entry: GraphNode, reading: Reading): Failure[] => {
  const found: Failure[] = [];
  const seen = new Set<string>([entry.id]);
  const queue = [entry.id];
  for (let at = 0; at < queue.length && seen.size < MAX_REACHED; at += 1) {
    const id = queue[at] as string;
    found.push(...(reading.throws.get(id) ?? []), ...(reading.parameterPipes.get(id) ?? []));
    for (const to of reading.next.get(id) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      const node = ctx.builder.getNode(to);
      if (node !== undefined && (node.type === 'guard' || node.type === 'pipe' || node.type === 'interceptor' || node.type === 'middleware')) {
        const edge = reading.checks.get(checkKey(id, to));
        if (edge !== undefined) found.push(...checkFailures(node, edge, reading));
        continue;
      }
      queue.push(to);
    }
  }
  return settleFailures(found);
};

/**
 * What each way in can fail with (P68), written on the entry as `meta.fails`.
 *
 * Only for a service built on the framework, by its own manifest (as R143
 * asks): the statuses are what the framework answers a throw with, and a
 * function deployed on its own answers an uncaught error some other way.
 *
 * Runs last, once every reader that draws a call or a check has had its turn,
 * because what a way in reaches is what the failures are read along.
 */
export const failuresPass = definePass('failures', (ctx: NestExtractContext) => {
  if (!hasAnyDependency(readPackageJson(ctx.repoDir) ?? {}, NEST_PACKAGES)) return;
  const reading = read(ctx);
  for (const record of ctx.entries) {
    const found = failuresFrom(ctx, record.node, reading);
    // The same exception reaches a bot or a message handler too, and there is
    // no status line for it to set there.
    const fails = record.kind === 'http' ? found : settleFailures(found.map(({ status: _status, ...rest }) => rest));
    if (fails.length === 0) continue;
    const node = ctx.builder.getNode(record.node.id);
    if (node !== undefined) node.meta = { ...node.meta, [FAILS_META]: fails };
  }
});
