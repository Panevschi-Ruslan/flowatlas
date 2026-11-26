import { applicationOfFile, methodBodies } from '@flowatlas/core';
import { readProcedureCalls, type ProcedureCallHolder } from '@flowatlas/adapters-entry';
import type { AngularExtractContext } from '../context.js';
import { analyzeApiUrl } from '../util/url.js';
import { definePass } from './types.js';

/**
 * Procedures an Angular application asks for by name (P247): a tRPC or oRPC
 * client made at the top of a module - `createTRPCClient({ links })` - or
 * provided for a token and injected, `inject(TRPC)`, and called from a
 * component's or a service's method.
 *
 * The reading is the entry adapters' (`readProcedureCalls`), the one the
 * React reader and the server's request pass share since P242: this hands it
 * every method body of the classes this reader indexed, the browser's
 * request node, and this reader's way of reading an address, so a link's
 * `${environment.apiUrl}/trpc` is read as any request's base is here.
 */
export const proceduresPass = definePass('procedures', (ctx: AngularExtractContext) => {
  const holders: ProcedureCallHolder[] = [];
  for (const indexed of ctx.classes.all()) {
    if (indexed.role === 'module') continue;
    for (const { declaration: method, body } of methodBodies(indexed.declaration)) {
      const id = ctx.methodIdOf(method);
      if (id === undefined) continue;
      holders.push({
        body,
        id,
        file: indexed.file,
        ensure: () => {
          ctx.ensureMethodNode(method);
        },
      });
    }
  }
  readProcedureCalls(holders, {
    repo: ctx.repo,
    pkg: ctx.pkg,
    builder: ctx.builder,
    type: 'ui_api_call',
    sources: () => ctx.project.getSourceFiles().filter((file) => !file.getFilePath().includes('/node_modules/')),
    fileOf: (node) => ctx.fileOf(node),
    addressOf: (url) => analyzeApiUrl(url, ctx.config.sharedPackages),
    types: ctx.types,
    report: (row) => ctx.report(row),
    applicationOf: (file) => applicationOfFile(ctx.meta, file),
  });
});
