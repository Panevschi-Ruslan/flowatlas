import { describedCallKey, withdrawDescribedCalls } from '@flowatlas/core';
import { readGrpcCalls } from '@flowatlas/adapters-entry';
import { definePass, scopesOf, type NestExtractContext, type NestExtractorPass } from '@flowatlas/extractor-nestjs';
import { analyzeUrl } from './leaves/url.js';

/**
 * The gRPC methods a server calls on another service (P274): a generated
 * client's `new CartServiceClient(process.env.CART_ADDR, credentials)` and
 * `client.getCart(request, callback)`, a NestJS `getService('CartService')`
 * and `cart.getCart(request)`.
 *
 * Read over the bodies every server pass walks, the address with the
 * server's own reading of a setting, as `procedureCallsPass` reads a
 * procedure client's link. Each call is an `http_out` of kind `rpc` keyed as
 * the server's way in is, so the linker joins it to the method of the
 * service its address names. A receiver the calls reader could not type -
 * the generated module not committed, `module-not-installed` - is followed
 * here, and its row goes.
 */
export const grpcCallsPass: NestExtractorPass = definePass('grpc-calls', (ctx: NestExtractContext) => {
  const read = readGrpcCalls(scopesOf(ctx), {
    repo: ctx.repo,
    repoDir: ctx.repoDir,
    pkg: ctx.pkg,
    builder: ctx.builder,
    project: ctx.project,
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
    types: ctx.types,
  });
  withdrawDescribedCalls(ctx.builder, new Set(read.map(({ file, line, call }) => describedCallKey(file, line, call))), ['call-dynamic-receiver']);
});
