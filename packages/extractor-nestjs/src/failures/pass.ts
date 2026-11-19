import {
  FAILS_META,
  forEachCall,
  hasAnyDependency,
  readServiceManifest,
  lineOf,
  settleFailures,
  type EdgeType,
  type Failure,
  type GraphEdge,
  type GraphNode,
} from '@flowatlas/core';
import { Node, type ClassDeclaration, type Decorator, type MethodDeclaration, type ParameterDeclaration } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import { functionNamedBy, memberFunctionCalled } from '../passes/called-function.js';
import { definePass } from '../passes/types.js';
import { scopesOf, type Scope } from '../scopes.js';
import type { EntryRecord } from '../wrapping/types.js';
import { filtersFor, readFilters, throughFilters, type FilterInFront, type Site } from './filters.js';
import { guardRefusals } from './guards.js';
import {
  interceptorsFor,
  outsideOf,
  raisedByInterceptors,
  readInterceptors,
  throughInterceptors,
  type InterceptorInFront,
} from './interceptors.js';
import {
  DECLARED_ERRORS,
  ERROR_FACTORY_FRAMEWORKS,
  GUARD_REFUSAL,
  HTTP_EXCEPTION,
  INPUT_REFUSALS,
  knownRefusal,
  NEST_PACKAGES,
  PROCEDURE_PACKAGES,
  type Refusal,
} from './statuses.js';
import { classNamed, throwsIn } from './throws.js';

/** The edges control goes along from a way in to the code that can fail. */
const WALKED: ReadonlySet<EdgeType> = new Set<EdgeType>(['handles', 'calls', 'guarded_by']);

/** How many nodes one way in is walked through before the walk stops. */
const MAX_REACHED = 2000;

/** The decorators that hand a parameter's value through pipes. */
const PARAMETER_DECORATORS: ReadonlySet<string> = new Set(['Param', 'Query', 'Body', 'Headers']);

/** The parts of a request a class-typed parameter is validated from (P87). */
const VALIDATED_PARTS: ReadonlySet<string> = new Set(['Body', 'Query', 'Param']);

/**
 * Parameter decorators of the framework's whose value no pipe in front of the
 * route ever sees. Every other decorated parameter - a request part, an upload,
 * a decorator of the project's own - is handed through them.
 */
const NOT_PIPED: ReadonlySet<string> = new Set(['Req', 'Request', 'Res', 'Response', 'Next', 'Headers', 'Ip', 'Session', 'HostParam']);

/** Classes the framework's validation leaves alone however they are written. */
const NOT_VALIDATED: ReadonlySet<string> = new Set(['Date', 'Buffer']);

/** Everything a node and the edges out of it say, read once for every way in. */
interface Reading {
  /** What each body throws, by the id of its node. */
  throws: Map<string, Site[]>;
  /** The bodies of each class, by the class id, for a check written here. */
  methodsOf: Map<string, string[]>;
  /** Each class written here, by its id, for a guard whose answers are read (P87). */
  classes: Map<string, ClassDeclaration>;
  /** Where control goes next from each node. */
  next: Map<string, string[]>;
  /** Checks a parameter of a handler runs, by the handler's id. */
  parameterPipes: Map<string, Site[]>;
  /** The edge that puts each check in front of what it guards, by both ends. */
  checks: Map<string, GraphEdge>;
}

const checkKey = (from: string, to: string): string => `${from}\u0000${to}`;

const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
};

const throwsOf = (scope: Scope, leaveOut: ReadonlySet<Node>): Site[] =>
  throwsIn(scope.body, leaveOut, scope.leaveOut).map((thrown) => ({
    failure: {
      ...(thrown.status === undefined ? {} : { status: thrown.status }),
      exception: thrown.exception,
      at: scope.id,
      file: scope.file,
      line: thrown.line,
      source: 'throw',
      ...(thrown.assumed === true ? { assumed: true } : {}),
      ...(thrown.declared === undefined ? {} : { declared: thrown.declared }),
      ...(thrown.via === undefined ? {} : { via: thrown.via }),
      ...(thrown.family === undefined ? {} : { family: thrown.family }),
    },
    lineage: thrown.lineage,
    ...(thrown.own === undefined ? {} : { own: thrown.own }),
    ...(thrown.choices === undefined
      ? {}
      : {
          choices: thrown.choices.map((choice) => ({
            exception: choice.exception,
            ...(choice.status === undefined ? {} : { status: choice.status }),
            ...(choice.assumed === true ? { assumed: true as const } : {}),
            lineage: choice.lineage,
            ...(choice.own === undefined ? {} : { own: choice.own }),
          })),
        }),
  }));

/** A refusal the framework throws for a check: one of its own exceptions, carrying its status. */
const refusalSite = (failure: Failure): Site => ({
  failure,
  lineage: [failure.exception, HTTP_EXCEPTION, 'Error'],
  ...(failure.status === undefined ? {} : { own: failure.status }),
});

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
    }, scope.leaveOut);
  }
  return hops;
};

/** The name a check is known by: its class, without the arguments a factory was given. */
const checkName = (node: GraphNode): string => node.label.replace(/\(.*$/, '');

const packageOf = (node: GraphNode): string | undefined =>
  typeof node.meta?.['package'] === 'string' ? (node.meta['package'] as string) : undefined;

const refusalAt = (refusal: Refusal, node: GraphNode, edge: GraphEdge, source: Failure['source']): Site => {
  const file = edge.file ?? node.file;
  const line = edge.line ?? node.line;
  return refusalSite({
    status: refusal.status,
    exception: refusal.exception,
    at: node.id,
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
    source,
  });
};

/** A parameter handed to the handler from one of these parts of the request. */
const decoratedFrom = (parameter: ParameterDeclaration, names: (name: string) => boolean): boolean =>
  parameter.getDecorators().some((decorator) => names(decorator.getName()));

/** A declared type the framework's validation can see: a class, not a primitive, a list, an interface or a literal. */
const isDto = (parameter: ParameterDeclaration): boolean => {
  const type = parameter.getType().getNonNullableType();
  if (type.isArray() || type.isAny() || type.isUnknown()) return false;
  const symbol = type.getSymbol();
  if (symbol === undefined || NOT_VALIDATED.has(symbol.getName())) return false;
  return symbol.getDeclarations().some((declaration) => Node.isClassDeclaration(declaration));
};

/**
 * Whether a handler takes a value the framework's validation runs on (P87): a
 * `@Body`, `@Query` or `@Param`, with a property key or without, whose declared
 * type is a class. Validation runs on a class instance; a primitive, an
 * interface or a type literal gives it nothing to validate.
 */
export const validatesDto = (method: MethodDeclaration): boolean =>
  method.getParameters().some((parameter) => decoratedFrom(parameter, (name) => VALIDATED_PARTS.has(name)) && isDto(parameter));

/** Whether a handler takes anything a pipe in front of it is handed. */
const takesPiped = (method: MethodDeclaration): boolean =>
  method.getParameters().some((parameter) => decoratedFrom(parameter, (name) => !NOT_PIPED.has(name)));

/**
 * Which handlers a pipe in front of the route has anything to refuse on, by
 * the pipe's name. Any other pipe runs on every value handed through pipes,
 * and a handler that takes none never runs it.
 */
const PIPE_RUNS_ON: ReadonlyMap<string, (method: MethodDeclaration) => boolean> = new Map([['ValidationPipe', validatesDto]]);

/** The class a check node stands for, built with arguments or not. */
const classOfCheck = (node: GraphNode, reading: Reading): ClassDeclaration | undefined =>
  reading.classes.get(node.id) ?? reading.classes.get(node.id.replace(/\(.*$/, ''));

/** The ids of a check's bodies, built with arguments or not. */
const methodsOfCheck = (node: GraphNode, reading: Reading): string[] =>
  reading.methodsOf.get(node.id) ?? reading.methodsOf.get(node.id.replace(/\(.*$/, '')) ?? [];

/**
 * What a check in front of a way in refuses a request with.
 *
 * A guard of an installed package says no with a 403, unless it is one known
 * to answer otherwise; one written here says no only where its `canActivate`
 * can answer anything but `true` (P87). A pipe runs only on what the handler
 * takes, and the framework's validation only on a class; it says nothing of
 * its own unless it is one of the framework's. What a check written here
 * throws is read from its body like any other.
 */
const checkFailures = (node: GraphNode, edge: GraphEdge, reading: Reading, entry: EntryRecord): Site[] => {
  const name = checkName(node);
  const handler = entry.handlerMethod;
  if (node.type === 'pipe' && handler !== undefined && !(PIPE_RUNS_ON.get(name) ?? takesPiped)(handler)) return [];
  const own = methodsOfCheck(node, reading).flatMap((id) => reading.throws.get(id) ?? []);
  const known = knownRefusal(packageOf(node), name);
  if (node.type === 'guard') {
    const declaration = known === undefined ? classOfCheck(node, reading) : undefined;
    const refusals = declaration === undefined ? [known ?? GUARD_REFUSAL] : guardRefusals(declaration);
    return [...refusals.map((refusal) => refusalAt(refusal, node, edge, 'guard')), ...own];
  }
  if (node.type === 'pipe') return known === undefined ? own : [refusalAt(known, node, edge, 'pipe'), ...own];
  // A middleware that is a function rather than a class is its own body: what
  // it throws is read there (P58), as a procedure's `.use(fn)` is drawn.
  return own.length > 0 ? own : (reading.throws.get(node.id) ?? []);
};

/** `ParseIntPipe` or `new ParseIntPipe(...)` handed to `@Param`, as a check. */
const parameterPipe = (
  ctx: NestExtractContext,
  handler: string,
  argument: Node,
  reading: Pick<Reading, 'methodsOf' | 'throws'>,
): Site[] => {
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
    refusalSite({
      status: known.status,
      exception: known.exception,
      at: handler,
      file: ctx.fileOf(argument),
      line: lineOf(argument),
      source: 'pipe',
    }),
  ];
};

const parameterPipes = (
  ctx: NestExtractContext,
  handler: string,
  method: MethodDeclaration,
  reading: Pick<Reading, 'methodsOf' | 'throws'>,
): Site[] =>
  method
    .getParameters()
    .flatMap((parameter) => parameter.getDecorators())
    .filter((decorator: Decorator) => PARAMETER_DECORATORS.has(decorator.getName()))
    .flatMap((decorator) => decorator.getArguments().flatMap((argument) => parameterPipe(ctx, handler, argument, reading)));

const read = (ctx: NestExtractContext, leaveOut: ReadonlySet<Node>): Reading => {
  const scopes = [...scopesOf(ctx)];
  const throws = new Map<string, Site[]>();
  const methodsOf = new Map<string, string[]>();
  const classes = new Map<string, ClassDeclaration>();
  for (const indexed of ctx.classes.all()) {
    const id = ctx.classIdOf(indexed.declaration);
    if (id !== undefined) classes.set(id, indexed.declaration);
  }
  for (const scope of scopes) {
    const found = throwsOf(scope, leaveOut);
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

  const pipes = new Map<string, Site[]>();
  const partial = { methodsOf, throws };
  for (const entry of ctx.entries) {
    if (entry.handlerMethod === undefined) continue;
    const id = ctx.methodIdOf(entry.handlerMethod);
    if (id === undefined) continue;
    const found = parameterPipes(ctx, id, entry.handlerMethod, partial);
    if (found.length > 0) pipes.set(id, found);
  }
  return { throws, methodsOf, classes, next, parameterPipes: pipes, checks };
};

/**
 * Every failure of the code one way in reaches, walking this service only,
 * each answered through the interceptors around it (P207) and then the
 * filters in front of it.
 *
 * Where a failure is raised decides which interceptors it passes: a guard's
 * or a middleware's before every one of them, so through none; one of the
 * handler, the code it calls or a pipe inside all of them; one an interceptor
 * throws itself through those outside it.
 */
const failuresFrom = (
  ctx: NestExtractContext,
  record: EntryRecord,
  reading: Reading,
  filters: readonly FilterInFront[],
  interceptors: readonly InterceptorInFront[],
): Failure[] => {
  const entry = record.node;
  const inside: Site[] = [];
  const before: Site[] = [];
  const fromInterceptors: Site[] = [];
  const seen = new Set<string>([entry.id]);
  const queue = [entry.id];
  for (let at = 0; at < queue.length && seen.size < MAX_REACHED; at += 1) {
    const id = queue[at] as string;
    inside.push(...(reading.throws.get(id) ?? []), ...(reading.parameterPipes.get(id) ?? []));
    for (const to of reading.next.get(id) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      const node = ctx.builder.getNode(to);
      if (node !== undefined && (node.type === 'guard' || node.type === 'pipe' || node.type === 'interceptor' || node.type === 'middleware')) {
        const edge = reading.checks.get(checkKey(id, to));
        if (edge === undefined) continue;
        const sites = checkFailures(node, edge, reading, record);
        if (node.type === 'pipe') inside.push(...sites);
        else if (node.type === 'interceptor') {
          const outside = outsideOf(interceptors, classOfCheck(node, reading));
          fromInterceptors.push(...sites.flatMap((site) => throughInterceptors(site, interceptors, outside)));
        } else before.push(...sites);
        continue;
      }
      queue.push(to);
    }
  }
  const answered = [
    ...before,
    ...inside.flatMap((site) => throughInterceptors(site, interceptors)),
    ...fromInterceptors,
    ...raisedByInterceptors(interceptors),
  ];
  return settleFailures(answered.map((site) => throughFilters(site, filters)));
};

/** A failure with no status line to set: on a bot or a message handler. */
const withoutStatus = ({ status: _status, assumed: _assumed, declared: _declared, chosenFrom, ...rest }: Failure): Failure => ({
  ...rest,
  ...(chosenFrom === undefined ? {} : { chosenFrom: [...new Set(chosenFrom.map((choice) => choice.exception))].sort().map((exception) => ({ exception })) }),
});

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
  const manifest = readServiceManifest(ctx.repoDir) ?? {};
  const every = hasAnyDependency(manifest, [...NEST_PACKAGES, ...ERROR_FACTORY_FRAMEWORKS]);
  // A service with procedures and none of those has its procedures read and
  // nothing else: theirs is the framework that answers a throw (P58).
  const procedures = hasAnyDependency(manifest, PROCEDURE_PACKAGES);
  if (!every && !procedures) return;
  const interceptors = readInterceptors(ctx);
  const reading = read(ctx, interceptors.mappingThrows);
  const filters = readFilters(ctx);
  for (const record of ctx.entries) {
    const procedure = isProcedure(record.node);
    if (!every && !procedure) continue;
    // A procedure is answered over HTTP however its way in is keyed, so its
    // failures keep their statuses.
    const http = record.kind === 'http' || procedure;
    // Interceptors and filters both answer a request: on a bot or a message
    // handler neither is read, as before.
    const found = failuresFrom(
      ctx,
      record,
      reading,
      http ? filtersFor(filters, record) : [],
      http ? interceptorsFor(interceptors, record) : [],
    );
    // The same exception reaches a bot or a message handler too, and there is
    // no status line for it to set there.
    const node = ctx.builder.getNode(record.node.id);
    const declared = procedure ? declaredStatuses(node ?? record.node) : undefined;
    const settled = procedure ? settleFailures([...found.map((failure) => asDeclared(failure, declared)), ...inputRefusal(record.node)]) : found;
    if (node !== undefined && declared !== undefined && declared.size > 0) {
      node.meta = { ...node.meta, errors: [...declared].map(([code, status]) => ({ code, status })) };
    }
    const fails = http ? settled : settleFailures(settled.map(withoutStatus));
    if (fails.length === 0) continue;
    if (node !== undefined) node.meta = { ...node.meta, [FAILS_META]: fails };
  }
});

/**
 * Whether a way in is a procedure, or the route of one (P58), by what its
 * entry says: a path and an ending, or the procedure a route answers for.
 */
const isProcedure = (node: GraphNode): boolean =>
  (typeof node.meta?.['key'] === 'string' && typeof node.meta?.['call'] === 'string') ||
  typeof node.meta?.['procedure'] === 'string';

/**
 * The status of every failure a procedure declares, by code (P58): the one its
 * declaration writes, or the one the framework answers the code with.
 */
const declaredStatuses = (node: GraphNode): Map<string, number> => {
  const statuses = new Map<string, number>();
  const errors = node.meta?.['errors'];
  if (!Array.isArray(errors)) return statuses;
  for (const error of errors as Array<{ code?: unknown; status?: unknown }>) {
    if (typeof error.code !== 'string') continue;
    statuses.set(
      error.code,
      typeof error.status === 'number' ? error.status : (DECLARED_ERRORS.statuses.get(error.code) ?? DECLARED_ERRORS.fallback),
    );
  }
  return statuses;
};

/** A declared failure thrown, at the status its procedure declares for it (P58). */
const asDeclared = (failure: Failure, declared: ReadonlyMap<string, number> | undefined): Failure => {
  const prefix = `${DECLARED_ERRORS.parameter}.`;
  if (declared === undefined || !failure.exception.startsWith(prefix)) return failure;
  const status = declared.get(failure.exception.slice(prefix.length));
  if (status === undefined) return failure;
  const { assumed: _assumed, ...rest } = failure;
  return { ...rest, status };
};

/**
 * What a procedure with an input schema refuses a request with before its
 * handler runs (P58), where the reader of its framework is known here.
 */
const inputRefusal = (node: GraphNode): Failure[] => {
  const refusal = INPUT_REFUSALS.get(String(node.meta?.['adapter'] ?? ''));
  const at = node.meta?.['inputAt'];
  if (refusal === undefined || typeof node.meta?.['input'] !== 'string') return [];
  const [file, line] = typeof at === 'string' ? [at.slice(0, at.lastIndexOf(':')), Number(at.slice(at.lastIndexOf(':') + 1))] : [node.file, node.line];
  return [
    {
      status: refusal.status,
      exception: refusal.exception,
      at: node.id,
      ...(file === undefined ? {} : { file }),
      ...(line === undefined || Number.isNaN(line) ? {} : { line }),
      source: 'pipe',
    },
  ];
};
