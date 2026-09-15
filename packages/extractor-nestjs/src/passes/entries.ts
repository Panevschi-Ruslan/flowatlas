import { join } from 'node:path';
import {
  functionAt,
  inlineFunction,
  isFunctionHandler,
  isInlineHandler,
  makeSymbolId,
  type EntryHandler,
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
    return { id: ctx.functionIdOf(fn) };
  }

  if (isFunctionHandler(handler)) {
    const fn = ctx.functionAt(handler.file, handler.functionName);
    if (fn === undefined) return {};
    ctx.ensureFunctionNode(fn);
    ctx.handlerFunctions.push(fn);
    return { id: ctx.functionIdOf(fn) };
  }

  const indexed = ctx.classes.byId(makeSymbolId(ctx.repo, handler.file, handler.className));
  if (indexed === undefined) return {};
  const owner = indexed.declaration as ClassDeclaration;
  const method = owner.getMethod(handler.methodName);
  if (method === undefined) return { owner };
  ctx.ensureMethodNode(method);
  const id = ctx.methodIdOf(method);
  return { ...(id === undefined ? {} : { id }), owner, method };
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

      const node = ctx.builder.addNode({
        id: entry.id,
        type: 'entry',
        label: entry.label,
        repo: ctx.repo,
        file: entry.file,
        ...(entry.line === undefined ? {} : { line: entry.line }),
        kind: entry.kind,
        ...(entry.meta === undefined ? {} : { meta: { ...entry.meta, adapter: adapter.name } }),
      });

      if (handler.id !== undefined && entry.handler !== undefined) {
        ctx.builder.addEdge({
          from: entry.id,
          to: handler.id,
          type: 'handles',
          confidence: 'static',
          file: entry.handler.file,
          ...(entry.handler.line === undefined ? {} : { line: entry.handler.line }),
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
