import { join } from 'node:path';
import {
  addEntryWrapping,
  functionAt,
  inlineFunction,
  isFunctionHandler,
  isInlineHandler,
  makeSymbolId,
  extendReading,
  readRequest,
  routeOf,
  routeShapeEdge,
  recordStatedSignatures,
  type EntryHandler,
  type EntryNode,
} from '@flowatlas/core';
import type { CallExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { definePass } from './types.js';

/**
 * The function an adapter named as the code behind a way in.
 *
 * Two of the three shapes an adapter can report are answered here, and the
 * third belongs to the other reader: a method of a class is a NestJS handler,
 * and nothing a browser reading knows about has one.
 *
 * A function written in the registration itself is answered the way the server
 * reader answers it, with the position the adapter carried, because the two
 * readers are looking at the same repositories. A Next.js directory is read by
 * both halves and the server half already draws this edge, so on that reading
 * this adds nothing; a repository read as a browser alone had no other half to
 * cover for it, and an inline action there was a boundary with nothing behind
 * it (R61).
 *
 * What such a function itself calls is drawn by the half that walks calls, and
 * on a browser-only reading that walk has already run by the time the ways in
 * are read — the order the passes are in exists so that an edge to a screen
 * lands on a screen. So the node and the `handles` edge are here and the calls
 * out of an inline handler are the server half's, which is the only half a
 * repository with server actions in it has ever been read by.
 */
const resolveHandler = (
  ctx: ReactExtractContext,
  handler: EntryHandler | undefined,
): IndexedFunction | undefined => {
  if (handler === undefined) return undefined;
  if (isInlineHandler(handler)) {
    const sourceFile = ctx.project.getSourceFile(join(ctx.repoDir, handler.file));
    const written =
      sourceFile === undefined ? undefined : functionAt(sourceFile, handler.line, handler.column);
    if (written === undefined) return undefined;
    return ctx.functions.adopt(inlineFunction(written, handler.label));
  }
  if (!isFunctionHandler(handler)) return undefined;
  return ctx.functions.byId(makeSymbolId(ctx.repo, handler.file, handler.functionName));
};

/**
 * What a route's handler reads from its request and answers it with, where the
 * adapter described where its framework puts them (P29). The same reading the
 * server half does, so a route read by both halves carries one shape.
 */
const requestOf = (
  ctx: ReactExtractContext,
  entry: EntryNode,
  handler: IndexedFunction,
): ReturnType<typeof routeShapeEdge> | undefined => {
  if (entry.request === undefined) return undefined;
  const reading = extendReading(entry.request, ctx.config.adapters.entry.request);
  const shape = readRequest(handler.fn.declaration, reading, (type, site) => ctx.types.collectType(type, site), routeOf(entry));
  return shape === undefined ? undefined : routeShapeEdge(shape);
};

/** Every call to a function of this repository, found by name. */
const callSitesOf = (indexed: IndexedFunction): CallExpression[] => {
  const declaration = indexed.fn.declaration;
  const nameNode = Node.isFunctionDeclaration(declaration) || Node.isVariableDeclaration(declaration)
    ? declaration.getNameNode()
    : undefined;
  if (nameNode === undefined || !Node.isIdentifier(nameNode)) return [];

  const sites: CallExpression[] = [];
  const seen = new Set<string>();
  for (const reference of nameNode.findReferencesAsNodes()) {
    const parent = reference.getParent();
    if (parent === undefined) continue;
    const call = Node.isPropertyAccessExpression(parent) ? parent.getParent() : parent;
    if (call === undefined || !Node.isCallExpression(call)) continue;
    const key = `${call.getSourceFile().getFilePath()}:${call.getStart()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sites.push(call);
  }
  return sites;
};

/** The indexed function a call is written inside, when this repository declares it. */
const enclosingIndexed = (
  ctx: ReactExtractContext,
  call: CallExpression,
): IndexedFunction | undefined => {
  for (let at = call.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isSourceFile(at)) return undefined;
    const indexed =
      Node.isFunctionDeclaration(at) || Node.isVariableDeclaration(at) || Node.isPropertyAssignment(at)
        ? ctx.functions.get(at)
        : undefined;
    if (indexed !== undefined) return indexed;
  }
  return undefined;
};

/**
 * Turns what the entry adapters found into nodes and edges.
 *
 * The same bookkeeping the server reader does, over the same adapter contract,
 * because the contract is what the contract is for: a repository that is a
 * browser and a server at once is read once, and the half of it that declares
 * ways in is described by an adapter that knows nothing about this extractor.
 *
 * One thing is done here that the server reader has no need of. An entry marked
 * `viaImport` is reached by importing it rather than by asking for an address,
 * so nothing anywhere will ever join a caller to it by matching a string. The
 * import is the evidence, and this is the pass that has it: every call to the
 * name such an entry is exported under, made from a function of this
 * repository, is an edge to the way in. That edge is the whole of what a
 * server action is — a boundary between two processes with no address between
 * them.
 */
export const entriesPass = definePass('entries', (ctx: ReactExtractContext) => {
  for (const adapter of ctx.adapters.entry) {
    for (const entry of adapter.extractEntries(ctx)) {
      ctx.builder.addNode({
        id: entry.id,
        type: 'entry',
        label: entry.label,
        repo: ctx.repo,
        file: entry.file,
        ...(entry.line === undefined ? {} : { line: entry.line }),
        kind: entry.kind,
        ...(entry.meta === undefined ? {} : { meta: { ...entry.meta, adapter: adapter.name } }),
      });

      if (entry.wrapping !== undefined) {
        addEntryWrapping(ctx.builder, ctx.repo, entry.id, entry.wrapping);
      }
      // A way in that is not a function says what it takes where it is declared (P35).
      if (entry.signature !== undefined) recordStatedSignatures(ctx.builder, ctx.types, [[entry.id, entry.signature]]);

      const handler = resolveHandler(ctx, entry.handler);
      if (handler !== undefined) {
        ctx.ensureFunctionNode(handler.fn);
        ctx.builder.addEdge({
          from: entry.id,
          to: handler.id,
          type: 'handles',
          confidence: 'static',
          file: handler.file,
          line: handler.line,
          ...requestOf(ctx, entry, handler),
        });
      }

      if (entry.meta?.['viaImport'] !== true) continue;
      // What a caller writes is the export, which is not always the handler.
      // An action built by a library is exported under one name and hands its
      // work to another — an arrow written in the call, or a function declared
      // beside it — and it is the export that every caller imports and calls.
      // The two coincide only for an action declared outright, which is why
      // reading the handler's call sites found the callers of the declared
      // actions and none of the built ones (R61).
      //
      // The export is found by where it is declared rather than by a name,
      // because the entry's file and line are where the adapter read it and
      // the index recorded the same position for the same declaration. That
      // also keeps the callers drawable when the code behind the boundary
      // could not be named at all: the boundary is real and who crosses it is
      // the question being asked.
      const exported = ctx.functions.at(entry.file, entry.line);
      if (exported === undefined) continue;
      for (const call of callSitesOf(exported)) {
        const caller = enclosingIndexed(ctx, call);
        if (caller === undefined || caller.id === exported.id) continue;
        ctx.ensureFunctionNode(caller.fn);
        ctx.builder.addEdge({
          from: caller.id,
          to: entry.id,
          type: 'calls',
          confidence: 'static',
          file: caller.file,
          line: call.getStartLineNumber(),
        });
      }
    }
  }
});
