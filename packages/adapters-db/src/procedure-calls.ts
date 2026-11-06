import { applicationOfFile, describedCallKey, makeLeafId, withdrawDescribedCalls } from '@flowatlas/core';
import { readProcedureCalls } from '@flowatlas/adapters-entry';
import { definePass, scopesOf, type NestExtractContext, type NestExtractorPass } from '@flowatlas/extractor-nestjs';
import { analyzeUrl } from './leaves/url.js';

/**
 * The procedures a server asks another service for (P242): a worker's
 * `createORPCClient(new RPCLink({ url: `${process.env.ORDERS_URL}/rpc` }))` and
 * `orders.orders.place(input)`, a service's `createTRPCClient({ links: [
 * httpBatchLink({ url }) ] })` and `billing.invoices.create.mutate(input)`.
 *
 * The same reader as the browser's (`readProcedureCalls`), over the bodies
 * every server pass walks, with the server's own way of reading an address:
 * a setting is `process.env.X` or a configuration service's `get('X')` here,
 * which the leaves pass reads for every request. Each call is an `http_out`
 * of kind `rpc`, so the linker joins it to the procedure of the service its
 * link's address names, by the rules any request between services is joined
 * by.
 *
 * A repository read by both halves at once has had its calls read by the
 * browser half already, which goes first; a site it recorded is left alone,
 * so no call is two requests.
 */
export const procedureCallsPass: NestExtractorPass = definePass('procedure-calls', (ctx: NestExtractContext) => {
  const read = readProcedureCalls(scopesOf(ctx), {
    repo: ctx.repo,
    pkg: ctx.pkg,
    builder: ctx.builder,
    type: 'http_out',
    sources: () => ctx.project.getSourceFiles().filter((file) => !file.getFilePath().includes('/node_modules/')),
    fileOf: (node) => ctx.fileOf(node),
    addressOf: (url) => {
      const info = analyzeUrl(url, { whole: true });
      return {
        path: info.path,
        baseUrlEnv: info.baseUrlEnv,
        host: info.host,
        ...(info.baseUrlDefault === undefined ? {} : { baseUrlDefault: info.baseUrlDefault }),
      };
    },
    report: (row) => ctx.report(row),
    applicationOf: (file) => applicationOfFile(ctx.meta, file),
    readAlready: (file, line, column) => ctx.builder.getNode(makeLeafId('ui_api_call', ctx.repo, file, line, column)) !== undefined,
  });
  // A proxy's type is `any` wherever the other service's tree is not
  // installed, and the calls reader says it could not follow the receiver.
  // Read here, the call is followed: the row goes (R173).
  withdrawDescribedCalls(ctx.builder, new Set(read.map(({ file, line, call }) => describedCallKey(file, line, call))));
});
