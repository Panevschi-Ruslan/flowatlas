import { findMethod, forEachCall, lineOf, resolveReceiver } from '@flowatlas/core';
import type { ClassDeclaration } from 'ts-morph';
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

    for (const method of owner.getMethods()) {
      const body = method.getBody();
      if (body === undefined) continue;
      const fromId = ctx.methodIdOf(method);
      if (fromId === undefined) continue;
      let fromCreated = false;

      forEachCall(body, (call) => {
        const callee = call.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) return;

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
