import type { TypeRef } from '@flowatlas/core';
import type { MethodDeclaration, ParameterDeclaration } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import { NEST_COMMON } from '../index-classes.js';
import { findDecorators, firstStringArg } from '@flowatlas/core';
import { definePass } from './types.js';

/** Parameter annotations that say which part of a request a value comes from. */
const REQUEST_PARTS: Record<string, string> = {
  Body: 'body',
  Query: 'query',
  Param: 'params',
  Headers: 'headers',
};

interface Signature {
  params: TypeRef[];
  returns: TypeRef;
}

/**
 * What each part of a request is shaped like.
 *
 * `@Body() dto: CreateOrderDto` says the whole body is that type, while
 * `@Body('name') name: string` says one property of it is. Both are recorded, so
 * that comparing a caller against a route later has something to compare.
 */
const requestShape = (
  method: MethodDeclaration,
  collect: (parameter: ParameterDeclaration) => TypeRef,
): Record<string, TypeRef> => {
  const parts: Record<string, Array<{ key?: string; ref: TypeRef }>> = {};

  for (const parameter of method.getParameters()) {
    for (const decorator of findDecorators(parameter, {
      names: Object.keys(REQUEST_PARTS),
      fromModules: NEST_COMMON,
    })) {
      const part = REQUEST_PARTS[decorator.getName()];
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

/**
 * Fills the type registry and points the edges at it.
 *
 * Types are never written into an edge: an edge carries references, and the
 * structures live in the registry once. That is what keeps a graph small enough
 * to hand to a reader with a budget.
 */
export const typesPass = definePass('types', (ctx: NestExtractContext) => {
  const collector = ctx.types;
  const signatures = new Map<string, Signature>();
  const requestShapes = new Map<string, Record<string, TypeRef>>();

  for (const indexed of ctx.classes.all()) {
    for (const method of indexed.declaration.getMethods()) {
      const id = ctx.methodIdOf(method);
      if (id === undefined) continue;
      if (!ctx.builder.has(id)) continue;

      signatures.set(id, collector.collectSignature(method));
      const shape = requestShape(method, (parameter) =>
        collector.collectType(parameter.getType(), parameter),
      );
      if (Object.keys(shape).length > 0) requestShapes.set(id, shape);
    }
  }

  // An edge describes what reaches the method it points at, so the signature
  // that matters is the target's.
  for (const edge of ctx.builder.edges) {
    if (edge.type !== 'calls' && edge.type !== 'handles') continue;
    const signature = signatures.get(edge.to);
    if (signature === undefined) continue;
    const shape = edge.type === 'handles' ? requestShapes.get(edge.to) : undefined;
    ctx.builder.addEdge({
      ...edge,
      params: signature.params,
      returns: signature.returns,
      ...(shape === undefined ? {} : { meta: { ...edge.meta, ...shape } }),
    });
  }
});
