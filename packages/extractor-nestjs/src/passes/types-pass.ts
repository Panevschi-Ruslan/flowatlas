import { methodsOfClass, recordSignatures, type TypeRef } from '@flowatlas/core';
import type { Node as TsNode, ParameterDeclaration } from 'ts-morph';
import { Node } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import { NEST_COMMON } from '../index-classes.js';
import { findDecorators, firstStringArg } from '@flowatlas/core';
import { definePass } from './types.js';

/**
 * Parameter annotations that say which part of a request a value comes from.
 *
 * A `Map`, so the lookup by a decorator's name is safe by construction and not
 * only by the filter in front of it (R130).
 */
const REQUEST_PARTS: ReadonlyMap<string, string> = new Map([
  ['Body', 'body'],
  ['Query', 'query'],
  ['Param', 'params'],
  ['Headers', 'headers'],
]);

/**
 * What each part of a request is shaped like.
 *
 * `@Body() dto: CreateOrderDto` says the whole body is that type, while
 * `@Body('name') name: string` says one property of it is. Both are recorded, so
 * that comparing a caller against a route later has something to compare.
 */
const requestShape = (
  method: TsNode,
  collect: (parameter: ParameterDeclaration) => TypeRef,
): Record<string, TypeRef> => {
  const parts: Record<string, Array<{ key?: string; ref: TypeRef }>> = {};
  // Only a method written as a method has parameters a decorator can sit on.
  if (!Node.isMethodDeclaration(method)) return {};

  for (const parameter of method.getParameters()) {
    for (const decorator of findDecorators(parameter, {
      names: [...REQUEST_PARTS.keys()],
      fromModules: NEST_COMMON,
    })) {
      const part = REQUEST_PARTS.get(decorator.getName());
      if (part === undefined) continue;
      const key = firstStringArg(decorator);
      const ref = collect(parameter);
      (parts[part] ??= []).push(key === undefined ? { ref } : { key, ref });
    }
  }

  const out: Record<string, TypeRef> = {};
  for (const [part, entries] of Object.entries(parts)) {
    const whole = entries.find((entry) => entry.key === undefined);
    if (whole !== undefined) {
      out[part] = whole.ref;
      continue;
    }
    out[part] = `{${entries.map((entry) => `${entry.key}:${entry.ref}`).join(';')}}`;
  }
  return out;
};

/** Every method of every class this reader indexed, however written, by its node's id. */
function* methodsOf(ctx: NestExtractContext): Generator<readonly [string, TsNode]> {
  for (const indexed of ctx.classes.all()) {
    for (const method of methodsOfClass(indexed.declaration)) {
      const id = ctx.methodIdOf(method);
      if (id !== undefined) yield [id, method];
    }
  }
}

/** Every function this reader made a node of, by that node's id. */
function* functionsOf(ctx: NestExtractContext): Generator<readonly [string, TsNode]> {
  for (const [id, fn] of ctx.drawnFunctions) yield [id, fn.declaration];
}

/**
 * Fills the type registry, records on each method and function what it takes
 * and gives back by name, and points the edges into them at the registry.
 *
 * Types are never written into an edge: an edge carries references, and the
 * structures live in the registry once. That is what keeps a graph small enough
 * to hand to a reader with a budget. A controller method answers a request with
 * what it returns, so its route's edge carries that too, and says which part of
 * the request each parameter is; a function handed a request and a response
 * answers through the response, so its route's edge carries nothing it
 * returns.
 */
export const typesPass = definePass('types', (ctx: NestExtractContext) => {
  const methods = recordSignatures(ctx.builder, ctx.types, methodsOf(ctx), ['calls', 'handles']);
  recordSignatures(ctx.builder, ctx.types, functionsOf(ctx));

  const requestShapes = new Map<string, Record<string, TypeRef>>();
  for (const [id, declaration] of methodsOf(ctx)) {
    if (!methods.has(id) || requestShapes.has(id)) continue;
    const shape = requestShape(declaration, (parameter) =>
      ctx.types.collectType(parameter.getType(), parameter),
    );
    if (Object.keys(shape).length > 0) requestShapes.set(id, shape);
  }
  for (const edge of ctx.builder.edges) {
    if (edge.type !== 'handles') continue;
    const shape = requestShapes.get(edge.to);
    if (shape !== undefined) ctx.builder.addEdge({ ...edge, meta: { ...edge.meta, ...shape } });
  }
});
