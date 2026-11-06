import { applicationOfFile } from '@flowatlas/core';
import { readProcedureCalls } from '@flowatlas/adapters-entry';
import type { ReactExtractContext } from '../context.js';
import { analyzeApiUrl } from '../util/url.js';
import { definePass } from './types.js';

/**
 * Procedures a client asks for by name, in a browser (R95, P58).
 *
 * The reading is the entry adapters' (`readProcedureCalls`), shared with the
 * server's request pass since P242: this hands it every function this reader
 * indexed, the browser's request node, and the browser's way of reading an
 * address, so a link's `${import.meta.env.VITE_API_URL}/rpc` is read as any
 * request's base is here.
 */
export const proceduresPass = definePass('procedures', (ctx: ReactExtractContext) => {
  readProcedureCalls(
    [...ctx.functions.all()].map((indexed) => ({
      body: indexed.fn.body,
      id: indexed.id,
      file: indexed.file,
      ensure: () => {
        ctx.ensureFunctionNode(indexed.fn);
      },
    })),
    {
      repo: ctx.repo,
      pkg: ctx.pkg,
      builder: ctx.builder,
      type: 'ui_api_call',
      sources: () => ctx.project.getSourceFiles().filter((file) => !file.getFilePath().includes('/node_modules/')),
      fileOf: (node) => ctx.fileOf(node),
      addressOf: (url) => analyzeApiUrl(url, { sharedPackages: ctx.config.sharedPackages }),
      report: (row) => ctx.report(row),
      applicationOf: (file) => applicationOfFile(ctx.meta, file),
    },
  );
});
