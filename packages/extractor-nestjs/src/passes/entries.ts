import { join } from 'node:path';
import {
  addEntryWrapping,
  envelopePath,
  functionAt,
  inlineFunction,
  isFunctionHandler,
  isInlineHandler,
  makeSymbolId,
  messageTypeAt,
  extendReading,
  readRequest,
  READS_META,
  routeOf,
  routeShapeEdge,
  recordStatedSignatures,
  type EntryHandler,
  type EntryNode,
  type NamedFunction,
  type TypeRef,
} from '@flowatlas/core';
import type { ClassDeclaration, MethodDeclaration } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import { definePass } from './types.js';

const stripPrefix = (path: string, prefix: string | undefined): string => {
  if (prefix === undefined || prefix === '') return path;
  const normalised = prefix.startsWith('/') ? prefix : `/${prefix}`;
  if (path === normalised) return '/';
  return path.startsWith(`${normalised}/`) ? path.slice(normalised.length) : path;
};

/** What the handler an adapter named turned out to be. */
interface ResolvedHandler {
  /** Node the `handles` edge points at. */
  id?: string;
  /** Declarations the wrapping pass matches guards and pipes against. */
  owner?: ClassDeclaration;
  method?: MethodDeclaration;
  /** The function itself, when the handler is one rather than a method. */
  fn?: NamedFunction;
}

/**
 * Finds the code an adapter said answers an entry point.
 *
 * Three answers are possible and all three are ordinary: a method, a function
 * that belongs to no class, and nothing at all — a registration that passes a
 * function written in place has no name to point at, and the way in is real
 * either way.
 */
const resolveHandler = (
  ctx: NestExtractContext,
  handler: EntryHandler | undefined,
): ResolvedHandler => {
  if (handler === undefined) return {};

  if (isInlineHandler(handler)) {
    const sourceFile = ctx.project.getSourceFile(join(ctx.repoDir, handler.file));
    const written = sourceFile === undefined ? undefined : functionAt(sourceFile, handler.line, handler.column);
    if (written === undefined) return {};
    const fn = inlineFunction(written, handler.label);
    ctx.ensureFunctionNode(fn);
    ctx.handlerFunctions.push(fn);
    return { id: ctx.functionIdOf(fn), fn };
  }

  if (isFunctionHandler(handler)) {
    const fn = ctx.functionAt(handler.file, handler.functionName);
    if (fn === undefined) return {};
    ctx.ensureFunctionNode(fn);
    ctx.handlerFunctions.push(fn);
    return { id: ctx.functionIdOf(fn), fn };
  }

  const indexed = ctx.classes.byId(makeSymbolId(ctx.repo, handler.file, handler.className));
  if (indexed === undefined) return {};
  const owner = indexed.declaration as ClassDeclaration;
  // Narrow on purpose (R29). A route, a message pattern and a cron in NestJS
  // are all registered by a decorator on a *method*: the framework reads the
  // metadata off the prototype, and a decorator on a property registers
  // nothing at all. An adapter that hands over the name of a field has
  // recorded something the framework will not call.
  const method = owner.getMethod(handler.methodName);
  if (method === undefined) return { owner };
  ctx.ensureMethodNode(method);
  const id = ctx.methodIdOf(method);
  return { ...(id === undefined ? {} : { id }), owner, method };
};

/** Type references that say nothing about a shape, which are not worth recording. */
const SAYS_NOTHING = new Set(['any', 'unknown', 'object']);

/**
 * What the handler takes from each wrapping the adapter said a message may come
 * in, by the path to the message: the declared type there, or what it parses
 * the text there into (R172). `undefined` when nothing was asked or there is no
 * function to read, which is a different answer from a function that was read
 * and takes nothing from any of them - an empty record.
 */
const readsOf = (
  ctx: NestExtractContext,
  entry: EntryNode,
  fn: NamedFunction | undefined,
): Record<string, TypeRef> | undefined => {
  const site = fn?.body.getParent();
  if (entry.reads === undefined || site === undefined) return undefined;
  const reads: Record<string, TypeRef> = {};
  for (const envelope of entry.reads) {
    const type = messageTypeAt(site, envelope);
    const ref = type === undefined ? undefined : ctx.types.collectType(type, site);
    if (ref !== undefined && !SAYS_NOTHING.has(ref)) reads[envelopePath(envelope.at)] = ref;
  }
  return reads;
};

/**
 * What a route's handler reads from its request and answers it with, where the
 * adapter described where its framework puts them (P29), as the `handles` edge
 * carries it. Nothing for a handler that is not a function written here.
 */
const requestOf = (
  ctx: NestExtractContext,
  entry: EntryNode,
  handler: ResolvedHandler,
): ReturnType<typeof routeShapeEdge> | undefined => {
  const declaration = handler.method ?? handler.fn?.declaration;
  if (entry.request === undefined || declaration === undefined) return undefined;
  const reading = extendReading(entry.request, ctx.config.adapters.entry.request);
  const shape = readRequest(declaration, reading, (type, site) => ctx.types.collectType(type, site), routeOf(entry));
  return shape === undefined ? undefined : routeShapeEdge(shape);
};

/**
 * Turns what the entry adapters found into nodes and edges.
 *
 * The adapters describe entry points; making the node, the handler node and the
 * edge between them happens once, here, so that a new kind of entry point is a
 * new adapter and nothing else. Nothing in this pass looks at the kind.
 */
export const entriesPass = definePass('entries', (ctx: NestExtractContext) => {
  for (const adapter of ctx.adapters.entry) {
    for (const entry of adapter.extractEntries(ctx)) {
      const handler = resolveHandler(ctx, entry.handler);
      const reads = readsOf(ctx, entry, handler.fn);

      const node = ctx.builder.addNode({
        id: entry.id,
        type: 'entry',
        label: entry.label,
        repo: ctx.repo,
        file: entry.file,
        ...(entry.line === undefined ? {} : { line: entry.line }),
        kind: entry.kind,
        ...(entry.meta === undefined
          ? {}
          : {
              meta: {
                ...entry.meta,
                ...(reads === undefined ? {} : { [READS_META]: reads }),
                adapter: adapter.name,
              },
            }),
      });

      // Drawn here rather than in the adapter, and drawn from the same
      // description whatever read it, so that a chain a registration named and
      // a chain a decorator declared are one shape in the graph (R109).
      if (entry.wrapping !== undefined) {
        addEntryWrapping(ctx.builder, ctx.repo, entry.id, entry.wrapping);
      }
      // A way in that is not a function says what it takes where it is declared (P35).
      if (entry.signature !== undefined) recordStatedSignatures(ctx.builder, ctx.types, [[entry.id, entry.signature]]);

      if (handler.id !== undefined && entry.handler !== undefined) {
        ctx.builder.addEdge({
          from: entry.id,
          to: handler.id,
          type: 'handles',
          confidence: entry.handlerConfidence ?? 'static',
          file: entry.handler.file,
          ...(entry.handler.line === undefined ? {} : { line: entry.handler.line }),
          ...requestOf(ctx, entry, handler),
        });
      }

      const path = typeof entry.meta?.['path'] === 'string' ? (entry.meta['path'] as string) : undefined;
      const globalPrefix =
        typeof entry.meta?.['globalPrefix'] === 'string'
          ? (entry.meta['globalPrefix'] as string)
          : undefined;

      ctx.entries.push({
        node,
        kind: entry.kind,
        ...(adapter.outsideApplication === true ? { outsideApplication: true } : {}),
        ...(path === undefined ? {} : { path, routePath: stripPrefix(path, globalPrefix) }),
        ...(typeof entry.meta?.['method'] === 'string'
          ? { httpMethod: entry.meta['method'] as string }
          : {}),
        ...(handler.owner === undefined ? {} : { handlerClass: handler.owner }),
        ...(handler.method === undefined ? {} : { handlerMethod: handler.method }),
      });
    }
  }
});
