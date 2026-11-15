import { forEachCall, isLibFile, lineOf, packageOfPath } from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { receiverValues } from '../util/receiver-values.js';
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

/**
 * The constructors whose instance a call's receiver is, where the compiler
 * does not say (P310): `this` in a prototype's member is an instance of its
 * constructor, and any other receiver is what it is given - `new Store()`,
 * handed in by each caller, kept in a field - as a request's receiver is read
 * (P301).
 */
const constructorsOf = (ctx: ReactExtractContext, receiver: TsNode, heldBy: (receiver: TsNode) => TsNode[]): TsNode[] => {
  if (receiver.getKind() === SyntaxKind.ThisKeyword) {
    for (let at = receiver.getParent(); at !== undefined; at = at.getParent()) {
      // A constructor's own body: `this` is the instance it makes.
      if (Node.isFunctionDeclaration(at)) return [at];
      if (Node.isFunctionExpression(at) || Node.isMethodDeclaration(at)) {
        const holder = at.getParent();
        const member = ctx.functions.scriptMember(at) ?? (holder === undefined ? undefined : ctx.functions.scriptMember(holder));
        return member === undefined ? [] : [...ctx.functions.ownersOf(member.id)];
      }
    }
    return [];
  }
  return heldBy(receiver).flatMap((value) => {
    if (!Node.isNewExpression(value)) return [];
    const made = value.getExpression();
    return Node.isIdentifier(made) ? declarationsOf(made) : [];
  });
};

/** The functions of this repository a call names, when it names any: the one its name is declared by, or a prototype's member of each instance it is called on (P310). */
const calledFunctions = (
  ctx: ReactExtractContext,
  callee: TsNode,
  heldBy: (receiver: TsNode) => TsNode[],
): IndexedFunction[] => {
  const named = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
  if (!Node.isIdentifier(named)) return [];
  for (const declaration of declarationsOf(named)) {
    const indexed = ctx.functions.get(declaration as never);
    if (indexed !== undefined) return [indexed];
  }
  if (!Node.isPropertyAccessExpression(callee) || !ctx.functions.hasPrototypeMembers) return [];
  const found = new Set<IndexedFunction>();
  for (const owner of constructorsOf(ctx, callee.getExpression(), heldBy)) {
    const member = ctx.functions.member(owner, callee.getName());
    if (member !== undefined) found.add(member);
  }
  return [...found];
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
  // An instance a call is made on, read once per receiver (P310).
  const heldBy = receiverValues((value) => Node.isNewExpression(value));
  for (const indexed of ctx.functions.all()) {
    let created = false;

    forEachCall(indexed.fn.body, (call) => {
      const callee = call.getExpression();
      const called = calledFunctions(ctx, callee, heldBy);
      if (called.length === 0) {
        const pkg = externalPackage(callee);
        if (pkg !== null) ctx.countExternalCall(pkg);
        return;
      }
      for (const each of called) {
        // A function that calls itself says nothing about the shape of the
        // system, and a self-edge is read as a cycle by everything downstream.
        if (each.id === indexed.id) continue;

        if (!created) {
          ctx.ensureFunctionNode(indexed.fn);
          created = true;
        }
        ctx.ensureFunctionNode(each.fn);
        ctx.builder.addEdge({
          from: indexed.id,
          to: each.id,
          type: 'calls',
          confidence: 'static',
          file: indexed.file,
          line: lineOf(call),
        });
      }
    });
  }
});
