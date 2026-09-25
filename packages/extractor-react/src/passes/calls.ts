import { forEachCall, isLibFile, lineOf, packageOfPath } from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { definePass } from './types.js';

/**
 * Every declaration a name could stand for, with imports followed.
 *
 * A React repository reaches another module's function by importing it, and an
 * import is an alias rather than the thing itself. Without following the alias
 * every call across a file boundary — which is all of the interesting ones —
 * resolves to the import statement and nothing else.
 */
const declarationsOf = (node: TsNode): TsNode[] => {
  const symbol = node.getSymbol();
  if (symbol === undefined) return [];
  const aliased = symbol.getAliasedSymbol();
  return (aliased ?? symbol).getDeclarations();
};

/** The function of this repository a call names, when it names one. */
const calledFunction = (
  ctx: ReactExtractContext,
  callee: TsNode,
): IndexedFunction | undefined => {
  const named = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
  if (!Node.isIdentifier(named)) return undefined;
  for (const declaration of declarationsOf(named)) {
    const indexed = ctx.functions.get(declaration as never);
    if (indexed !== undefined) return indexed;
  }
  return undefined;
};

/**
 * The package a name came from, when it came from one.
 *
 * The language's own library is not one, although it is installed like one:
 * `JSON.stringify` and `Response.json` are declared in a file under the
 * compiler's own package, and counting those as calls into a dependency would
 * put the compiler at the top of every repository's list of what it talks to.
 */
const externalPackage = (callee: TsNode): string | null => {
  const named = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
  if (!Node.isIdentifier(named)) return null;
  for (const declaration of declarationsOf(named)) {
    const path = declaration.getSourceFile().getFilePath();
    if (isLibFile(path)) return null;
    const pkg = packageOfPath(path);
    if (pkg !== null) return pkg;
  }
  return null;
};

/**
 * Turns call sites into edges between functions.
 *
 * This is the middle of the chain the whole reader exists for, and it is where
 * React differs most from the other front end. There, a component reaches a
 * request through a service it injects, so the walk back to a screen is a walk
 * over a class graph the container describes. Here a custom hook is an ordinary
 * function that other hooks and components call, so the same walk is a walk
 * over plain calls and nothing else — which is at once simpler and less
 * certain, since nothing declares that a function is meant to be reached this
 * way.
 *
 * Unlike the server reader, the walk starts from every function rather than
 * from the ones an entry point named. There is no entry point in a browser: the
 * screen is the way in, and a screen is reached by the router or by other
 * markup, never by a call. Starting only from what is called would leave every
 * screen out of the graph.
 */
export const callsPass = definePass('calls', (ctx: ReactExtractContext) => {
  for (const indexed of ctx.functions.all()) {
    let created = false;

    forEachCall(indexed.fn.body, (call) => {
      const callee = call.getExpression();
      const called = calledFunction(ctx, callee);
      if (called === undefined) {
        const pkg = externalPackage(callee);
        if (pkg !== null) ctx.countExternalCall(pkg);
        return;
      }
      // A function that calls itself says nothing about the shape of the
      // system, and a self-edge is read as a cycle by everything downstream.
      if (called.id === indexed.id) return;

      if (!created) {
        ctx.ensureFunctionNode(indexed.fn);
        created = true;
      }
      ctx.ensureFunctionNode(called.fn);
      ctx.builder.addEdge({
        from: indexed.id,
        to: called.id,
        type: 'calls',
        confidence: 'static',
        file: indexed.file,
        line: lineOf(call),
      });
    });
  }
});
