import {
  causeMeta,
  findMethod,
  forEachCall,
  lineOf,
  methodBodies,
  resolveReceiver,
  tableDispatchOf,
  tableDispatchOfName,
  tableTargetOf,
  tableUnreadHint,
  type ClassMethod,
  type TableDispatch,
} from '@flowatlas/core';
import type { ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import { definePass } from './types.js';

/** How many tables inside the functions a table holds are followed before the walk stops. */
const TABLE_DEPTH = 3;

/** The body of the function of this repository a name calls, past an import: a declaration, or a `const` holding one. */
const repoFunctionBody = (name: TsNode): TsNode | undefined => {
  const symbol = name.getSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration === undefined || declaration.getSourceFile().isDeclarationFile() || declaration.getSourceFile().isInNodeModules()) return undefined;
  const fn = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
  if (fn === undefined) return undefined;
  if (Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) return fn.getBody();
  return undefined;
};

/**
 * Turns call sites into edges between methods.
 *
 * The same rule as on the server: only a receiver the checker resolves to a
 * class of this repository produces an edge. A receiver from an installed
 * package is the framework doing its own work and is counted rather than
 * reported; a receiver nothing can pin down is reported rather than guessed.
 * This is the middle of the chain the whole phase exists for — the component
 * method that a button reaches, and the service method that makes the request.
 *
 * A call through an element of a table the class writes out (P398, every form
 * since P399) is a call of what each element's member runs: a method, the
 * calls of a function declared or imported, or the calls of a function
 * written in the element, each read as the caller's own; elements not read
 * keep a row with the count.
 */
export const callsPass = definePass('calls', (ctx) => {
  for (const indexed of ctx.classes.all()) {
    if (indexed.role === 'module') continue;
    const owner: ClassDeclaration = indexed.declaration;

    for (const { declaration: method, body } of methodBodies(owner)) {
      const fromId = ctx.methodIdOf(method);
      if (fromId === undefined) continue;
      let fromCreated = false;

      const edgeTo = (target: ClassMethod, call: TsNode, meta?: Record<string, string>): void => {
        const toId = ctx.methodIdOf(target);
        if (toId === undefined) return;
        if (!fromCreated) {
          ctx.ensureMethodNode(method);
          fromCreated = true;
        }
        ctx.ensureMethodNode(target);
        ctx.builder.addEdge({
          from: fromId,
          to: toId,
          type: 'calls',
          confidence: 'static',
          file: indexed.file,
          line: lineOf(call),
          ...(meta === undefined ? {} : { meta }),
        });
      };

      /** Each element's member, as the caller's own call (`at` is the call through the table the edges are drawn at). */
      const followTable = (dispatch: TableDispatch, at: TsNode, depth: number): void => {
        let unreadValues = 0;
        for (const row of dispatch.rows) {
          const target = tableTargetOf(row.value);
          const meta = { via: 'table', ...(row.selectedBy === undefined ? {} : { selectedBy: row.selectedBy }) };
          if (target === undefined) {
            unreadValues += 1;
            continue;
          }
          if (target.kind === 'method') {
            if (ctx.methodIdOf(target.method) === undefined) unreadValues += 1;
            else edgeTo(target.method, at, meta);
            continue;
          }
          // A function, declared or written in the element, runs as part of this call: its calls are the caller's.
          const fnBody = target.kind === 'function' ? target.fn.body : target.fn.getBody();
          if (fnBody === undefined) continue;
          const thisClass = target.kind === 'inline' ? target.owner : undefined;
          forEachCall(fnBody, (inner) => draw(inner, thisClass, meta, at, depth + 1));
        }
        if (dispatch.unread + unreadValues === 0) return;
        ctx.report({
          file: indexed.file,
          line: lineOf(at),
          reason: 'call-dynamic-receiver',
          level: 'info',
          hint: tableUnreadHint(dispatch, unreadValues),
          symbol: `${indexed.name}.${method.getName()} -> ${(at as TsNode & { getExpression(): TsNode }).getExpression().getText()}`,
          ...causeMeta({ cause: 'table-rows-unread' }),
        });
      };

      /**
       * One call, as an edge: `thisClass` is the class `this` means where it
       * is written (none in a function that is not an arrow in the class),
       * `meta` what every edge drawn for it carries, `at` where they are drawn.
       */
      const draw = (call: TsNode & { getExpression(): TsNode }, thisClass: ClassDeclaration | undefined, meta: Record<string, string> | undefined, at: TsNode, depth: number): void => {
        const callee = call.getExpression();

        // `action.run()` where `action` is an element of a table written out,
        // and `const { run } = action; run()`: a call of each element's member.
        if (depth < TABLE_DEPTH) {
          const dispatch = Node.isIdentifier(callee)
            ? tableDispatchOfName(callee, call)
            : Node.isPropertyAccessExpression(callee)
              ? tableDispatchOf(callee.getExpression(), callee.getName(), call)
              : undefined;
          if (dispatch !== undefined) {
            followTable(dispatch, depth === 0 ? call : at, depth);
            return;
          }
        }
        // Inside what an element of a table runs, a function of the repository called by name runs too: its calls
        // are the caller's (the reading draws no node for a function, only for a method).
        if (Node.isIdentifier(callee) && depth > 0 && depth < TABLE_DEPTH) {
          const fnBody = repoFunctionBody(callee);
          if (fnBody !== undefined) forEachCall(fnBody, (inner) => draw(inner, undefined, meta, at, depth + 1));
          return;
        }
        if (!Node.isPropertyAccessExpression(callee)) return;

        const calledName = callee.getName();
        const receiverExpr = callee.getExpression();
        // `this` in a function that is not an arrow in the class means nothing the reading knows.
        if (thisClass === undefined && Node.isThisExpression(receiverExpr)) return;
        const receiver = resolveReceiver(receiverExpr, thisClass ?? owner, ctx.di);
        if (receiver.kind === 'builtin' || receiver.diUnresolved === true) return;

        if (receiver.external !== undefined) {
          ctx.countExternalCall(receiver.external.package);
          return;
        }
        if (receiver.classDecl === undefined) return;

        const found = findMethod(receiver.classDecl, calledName);
        if (found.externalPackage !== undefined) {
          ctx.countExternalCall(found.externalPackage);
          return;
        }
        if (found.method === undefined) return;
        const via = receiver.kind === 'super' ? { via: 'super' } : undefined;
        edgeTo(found.method, at, meta === undefined && via === undefined ? undefined : { ...via, ...meta });
      };

      forEachCall(body, (call) => draw(call, owner, undefined, call, 0));
    }
  }
});
