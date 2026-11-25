import {
  findMethod,
  forEachCall,
  lineOf,
  methodBodies,
  resolveReceiver,
  tableDispatchOf,
  tableTargetOf,
  type ClassMethod,
} from '@flowatlas/core';
import type { ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import { definePass } from './types.js';

/**
 * Turns call sites into edges between methods.
 *
 * The same rule as on the server: only a receiver the checker resolves to a
 * class of this repository produces an edge. A receiver from an installed
 * package is the framework doing its own work and is counted rather than
 * reported; a receiver nothing can pin down is reported rather than guessed.
 * This is the middle of the chain the whole phase exists for — the component
 * method that a button reaches, and the service method that makes the request.
 */
export const callsPass = definePass('calls', (ctx) => {
  for (const indexed of ctx.classes.all()) {
    if (indexed.role === 'module') continue;
    const owner: ClassDeclaration = indexed.declaration;

    for (const { declaration: method, body } of methodBodies(owner)) {
      const fromId = ctx.methodIdOf(method);
      if (fromId === undefined) continue;
      let fromCreated = false;

      const edgeTo = (target: ClassMethod, call: TsNode, meta: Record<string, string>): void => {
        const toId = ctx.methodIdOf(target);
        if (toId === undefined) return;
        if (!fromCreated) {
          ctx.ensureMethodNode(method);
          fromCreated = true;
        }
        ctx.ensureMethodNode(target);
        ctx.builder.addEdge({ from: fromId, to: toId, type: 'calls', confidence: 'static', file: indexed.file, line: lineOf(call), meta });
      };

      forEachCall(body, (call) => {
        const callee = call.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) return;

        // `action.run()` where `action` is an element of a table the class
        // writes out: a call of each element's method (P398).
        const dispatch = tableDispatchOf(callee.getExpression(), callee.getName(), call);
        if (dispatch !== undefined) {
          for (const row of dispatch.rows) {
            const target = tableTargetOf(row.value);
            const meta = { via: 'table', ...(row.selectedBy === undefined ? {} : { selectedBy: row.selectedBy }) };
            if (target?.kind === 'method') edgeTo(target.method, call, meta);
            if (target?.kind !== 'inline' || target.owner === undefined) continue;
            const inlineOwner = target.owner;
            forEachCall(target.fn.getBody() ?? target.fn, (inner) => {
              const innerCallee = inner.getExpression();
              if (!Node.isPropertyAccessExpression(innerCallee) || !Node.isThisExpression(innerCallee.getExpression())) return;
              const found = findMethod(inlineOwner, innerCallee.getName()).method;
              if (found !== undefined) edgeTo(found, call, meta);
            });
          }
          return;
        }

        const calledName = callee.getName();
        const receiver = resolveReceiver(callee.getExpression(), owner, ctx.di);
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

        const toId = ctx.methodIdOf(found.method);
        if (toId === undefined) return;
        if (!fromCreated) {
          ctx.ensureMethodNode(method);
          fromCreated = true;
        }
        ctx.ensureMethodNode(found.method);
        ctx.builder.addEdge({
          from: fromId,
          to: toId,
          type: 'calls',
          confidence: 'static',
          file: indexed.file,
          line: lineOf(call),
          ...(receiver.kind === 'super' ? { meta: { via: 'super' } } : {}),
        });
      });
    }
  }
});
