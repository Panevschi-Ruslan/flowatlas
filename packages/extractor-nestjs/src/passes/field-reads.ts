import { resolve, sep } from 'node:path';
import {
  FIELDS_READ_META,
  FIELDS_UNREAD_META,
  functionLikeOf,
  makeSymbolId,
  readFields,
  type FieldRead,
  type FieldStart,
  type FunctionLike,
  type GraphNode,
} from '@flowatlas/core';
import { Node, type ClassDeclaration, type Node as TsNode, type ParameterDeclaration, type Type } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import { definePass } from './types.js';

/**
 * Which fields of what it is handed each way in's code reads (P368).
 *
 * Read for the handler of every HTTP route and of every consumer that is not
 * chosen by another one's dispatch (its reads are its chooser's, under the
 * type chosen), and for every guard, interceptor, pipe and middleware a route
 * runs first. Each is written on its node as `fieldsRead`, empty where it
 * reads nothing of the body or the message, with `fieldsUnread` naming each
 * use the reading could not follow.
 */

/** Decorators that hand a parameter the body or the message; with a string, one field of it. */
const BODY_DECORATORS: ReadonlySet<string> = new Set(['Body', 'Payload', 'MessageBody', 'EventPayload']);

/** Decorators that hand a parameter the request itself. */
const REQUEST_DECORATORS: ReadonlySet<string> = new Set(['Req', 'Request']);

/** The method a class in front of a route runs, by its layer, and what its first parameter is. */
const LAYER_METHODS: ReadonlyMap<string, { method: string; state: FieldStart['state'] }> = new Map([
  ['guard', { method: 'canActivate', state: { kind: 'context' } }],
  ['interceptor', { method: 'intercept', state: { kind: 'context' } }],
  ['middleware', { method: 'use', state: { kind: 'request' } }],
  ['pipe', { method: 'transform', state: { kind: 'payload', prefix: [] } }],
]);

/** What a decorated parameter is handed, and the field a decorator names. */
const startOf = (parameter: ParameterDeclaration, index: number): { start?: FieldStart; field?: string } | undefined => {
  for (const decorator of parameter.getDecorators()) {
    const name = decorator.getName();
    if (REQUEST_DECORATORS.has(name)) return { start: { param: index, state: { kind: 'request' } } };
    if (!BODY_DECORATORS.has(name)) continue;
    const [first] = decorator.getArguments();
    const field = first !== undefined && Node.isStringLiteral(first) ? first.getLiteralValue() : undefined;
    return field === undefined
      ? { start: { param: index, state: { kind: 'payload', prefix: [] } } }
      : { start: { param: index, state: { kind: 'payload', prefix: [field] } }, field };
  }
  return undefined;
};

/** Whether a parameter's type can be a message: anything but a plain value - a string, a number, a flag. */
const mayHoldMessage = (type: Type): boolean =>
  type.isAny() ||
  type.isUnknown() ||
  type.isObject() ||
  type.isIntersection() ||
  type.isTypeParameter() ||
  (type.isUnion() && type.getUnionTypes().some(mayHoldMessage));

/**
 * Where a handler is handed the body or the message: the parameters its
 * decorators name, else the first, as the request (a route) or the message
 * (a consumer). A handler whose parameters are all decorated for something
 * else reads nothing of the body.
 */
const startsOf = (fn: FunctionLike, route: boolean): { starts: FieldStart[]; picked: Array<{ field: string; line: number }> } => {
  const parameters = fn.getParameters();
  const starts: FieldStart[] = [];
  const picked: Array<{ field: string; line: number }> = [];
  let decorated = false;
  parameters.forEach((parameter, index) => {
    if (parameter.getDecorators().length > 0) decorated = true;
    const found = startOf(parameter, index);
    if (found?.start !== undefined) starts.push(found.start);
    if (found?.field !== undefined) picked.push({ field: found.field, line: parameter.getStartLineNumber() });
  });
  if (!decorated && parameters.length > 0) {
    // A consumer's message is its first parameter that can hold one (P404): `dispatch(venueId: string, raw: unknown)`
    // is handed the message second, and a string first reads nothing of it.
    const held = route ? 0 : parameters.findIndex((parameter) => mayHoldMessage(parameter.getType()));
    starts.push({ param: Math.max(held, 0), state: route ? { kind: 'request' } : { kind: 'payload', prefix: [] } });
  }
  return { starts, picked };
};

export const fieldReadsPass = definePass('field-reads', (ctx) => {
  const { builder, repo, repoDir } = ctx;
  const root = resolve(repoDir);
  const isOwn = (declaration: TsNode): boolean => {
    const file = declaration.getSourceFile();
    const path = file.getFilePath();
    return !file.isDeclarationFile() && !path.includes(`${sep}node_modules${sep}`) && !path.includes('/node_modules/') && resolve(path).startsWith(root);
  };
  const idOf = (fn: FunctionLike): string | undefined => {
    if (Node.isMethodDeclaration(fn)) {
      const owner = fn.getParent();
      const own = ctx.methodIdOf(fn);
      if (own !== undefined) return own;
      if (Node.isClassDeclaration(owner) && owner.getName() !== undefined) return makeSymbolId(repo, ctx.fileOf(fn), owner.getName()!, fn.getName());
      return undefined;
    }
    if (Node.isFunctionDeclaration(fn)) {
      const name = fn.getName();
      return name === undefined ? undefined : makeSymbolId(repo, ctx.fileOf(fn), name);
    }
    const holder = fn.getParent();
    if (holder !== undefined && (Node.isVariableDeclaration(holder) || Node.isPropertyDeclaration(holder) || Node.isPropertyAssignment(holder))) {
      const name = holder.getName();
      const owner = holder.getParent();
      if (Node.isPropertyDeclaration(holder) && Node.isClassDeclaration(owner) && owner.getName() !== undefined) {
        return makeSymbolId(repo, ctx.fileOf(fn), owner.getName()!, name);
      }
      return /^[A-Za-z_$][\w$]*$/.test(name) ? makeSymbolId(repo, ctx.fileOf(fn), name) : undefined;
    }
    return undefined;
  };

  /** A member of a class, written as a method or as a property holding a function. */
  const memberOf = (declaration: ClassDeclaration, name: string): FunctionLike | undefined => {
    const method = declaration.getMethods().find((each) => each.getName() === name && each.getBody() !== undefined);
    if (method !== undefined) return method;
    const property = declaration.getProperty(name);
    return property === undefined ? undefined : functionLikeOf(property);
  };

  /** The function a node is, by its id: a function drawn by this reader, or a member of an indexed class. */
  const functionOf = (node: GraphNode): FunctionLike | undefined => {
    const drawn = ctx.drawnFunctions.get(node.id);
    if (drawn !== undefined) return functionLikeOf(drawn.declaration);
    const dot = node.id.lastIndexOf('.');
    const colon = node.id.lastIndexOf(':');
    if (dot <= colon) {
      const named = node.file === undefined ? undefined : ctx.functionAt(node.file, node.id.slice(colon + 1), node.line);
      return named === undefined ? undefined : functionLikeOf(named.declaration);
    }
    const owner = ctx.classes.byId(node.id.slice(0, dot));
    return owner === undefined ? undefined : memberOf(owner.declaration, node.id.slice(dot + 1));
  };

  const write = (node: GraphNode, fn: FunctionLike, starts: readonly FieldStart[], picked: ReadonlyArray<{ field: string; line: number }>): void => {
    const found = readFields(fn, starts, { idOf, isOwn, rootId: node.id });
    const reads: FieldRead[] = [...picked.map((row) => ({ field: row.field, line: row.line })), ...found.reads];
    const unread = [...found.unread, ...(found.cut === undefined ? [] : [{ line: fn.getStartLineNumber(), why: `cut: ${found.cut}` }])];
    node.meta = {
      ...node.meta,
      [FIELDS_READ_META]: reads,
      ...(unread.length === 0 ? {} : { [FIELDS_UNREAD_META]: unread }),
    };
  };

  const done = new Set<string>();
  // The handlers, of a route or of a consumer that chooses for itself.
  const handled = new Map<string, boolean>();
  for (const edge of builder.edges) {
    if (edge.type !== 'handles') continue;
    const from = builder.getNode(edge.from);
    if (from === undefined) continue;
    const route = from.type === 'entry' && from.kind === 'http';
    const consumer = from.type === 'consumer' && typeof from.meta?.['selectedBy'] !== 'string';
    if (!route && !consumer) continue;
    handled.set(edge.to, (handled.get(edge.to) ?? false) || route);
  }
  for (const [id, route] of handled) {
    const node = builder.getNode(id);
    const fn = node === undefined ? undefined : functionOf(node);
    if (node === undefined || fn === undefined || fn.getBody() === undefined) continue;
    const { starts, picked } = startsOf(fn, route);
    write(node, fn, starts, picked);
    done.add(id);
  }

  // What runs in front of a route: a class's method by its layer, or a function.
  for (const edge of builder.edges) {
    if (edge.type !== 'guarded_by' || done.has(edge.to)) continue;
    done.add(edge.to);
    const node = builder.getNode(edge.to);
    const layer = LAYER_METHODS.get(String(edge.meta?.['layer'] ?? node?.type ?? ''));
    if (node === undefined || layer === undefined) continue;
    const owner = ctx.classes.byId(node.id);
    const fn = owner !== undefined ? memberOf(owner.declaration, layer.method) : functionOf(node);
    if (fn === undefined || fn.getBody() === undefined) continue;
    write(node, fn, fn.getParameters().length === 0 ? [] : [{ param: 0, state: layer.state }], []);
  }
});
