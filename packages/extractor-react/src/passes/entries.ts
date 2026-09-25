import { isFunctionHandler, isInlineHandler, makeSymbolId, type EntryHandler } from '@flowatlas/core';
import type { CallExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { definePass } from './types.js';

/** The function an adapter named as the code behind a way in. */
const resolveHandler = (
  ctx: ReactExtractContext,
  handler: EntryHandler | undefined,
): IndexedFunction | undefined => {
  if (handler === undefined || isInlineHandler(handler) || !isFunctionHandler(handler)) {
    return undefined;
  }
  return ctx.functions.byId(makeSymbolId(ctx.repo, handler.file, handler.functionName));
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
 * function behind such an entry, made from a function of this repository, is an
 * edge to the way in. That edge is the whole of what a server action is —
 * a boundary between two processes with no address between them.
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

      const handler = resolveHandler(ctx, entry.handler);
      if (handler === undefined) continue;
      ctx.ensureFunctionNode(handler.fn);
      ctx.builder.addEdge({
        from: entry.id,
        to: handler.id,
        type: 'handles',
        confidence: 'static',
        file: handler.file,
        line: handler.line,
      });

      if (entry.meta?.['viaImport'] !== true) continue;
      for (const call of callSitesOf(handler)) {
        const caller = enclosingIndexed(ctx, call);
        if (caller === undefined || caller.id === handler.id) continue;
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
