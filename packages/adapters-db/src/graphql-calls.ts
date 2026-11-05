import { forEachCall, makeLeafId, normalizeFilePath } from '@flowatlas/core';
import { definePass, scopesOf, type NestExtractContext, type NestExtractorPass } from '@flowatlas/extractor-nestjs';
import { clientEndpointIn, documentOf, GRAPHQL_META, graphqlCallOf, operationMeta, operationsOf } from '@flowatlas/graphql';
import type { CallExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import { analyzeUrl } from './leaves/url.js';

/**
 * The GraphQL operations a server sends another service (P232):
 * graphql-request's `request(url, document)` and `GraphQLClient#request`,
 * Apollo Client in a server, `fetch` with a body holding `query`. Each is an
 * `http_out` to the endpoint it names, with the operation it sends under
 * `meta.graphql`, so the linker joins it to the other service's endpoint by
 * the same rules as any request and then to the fields it selects.
 */
export const graphqlCallsPass: NestExtractorPass = definePass('graphql-calls', (ctx: NestExtractContext) => {
  const sources = ctx.project.getSourceFiles().filter((file) => !file.getFilePath().includes('/node_modules/'));
  let made: ReturnType<typeof clientEndpointIn> | null = null;
  const clientEndpoint = () => (made === null ? (made = clientEndpointIn(sources)) : made);

  for (const scope of scopesOf(ctx)) {
    forEachCall(scope.body, (node) => {
      if (!Node.isCallExpression(node)) return;
      const call = node as CallExpression;
      const found = graphqlCallOf(call);
      if (found === undefined) return;
      const site = ctx.project.getSourceFile(call.getSourceFile().getFilePath())?.getLineAndColumnAtPos(call.getStart());
      if (site === undefined) return;
      const id = makeLeafId('http_out', ctx.repo, scope.file, site.line, site.column);
      const reading = documentOf(found.document);
      const operation = reading.kind === 'read' ? operationsOf(reading.document, reading.fragments)[0] : undefined;
      const graphql = reading.kind === 'read' && operation !== undefined ? operationMeta(operation, reading, (path) => normalizeFilePath(path, ctx.repoDir), found.library, found.transport) : undefined;
      if (reading.kind !== 'read') {
        ctx.builder.addUnresolved({
          file: scope.file,
          line: site.line,
          reason: reading.kind === 'invalid' ? 'graphql-document-not-parsed' : 'graphql-document-dynamic',
          level: 'action',
          message: reading.why,
          hint: 'Write the document as a gql template or a .graphql file, so the fields it asks for can be joined.',
          symbol: call.getExpression().getText().slice(0, 60),
        });
      }
      // A `fetch` the leaves pass drew is that request; it carries the operation now.
      const existing = ctx.builder.getNode(id);
      if (existing !== undefined) {
        if (graphql !== undefined) existing.meta = { ...existing.meta, [GRAPHQL_META]: graphql };
        return;
      }
      const written = found.endpoint ?? clientEndpoint();
      const info = written === undefined ? undefined : analyzeUrl(written);
      const path = info?.path ?? '/graphql';
      scope.ensure();
      ctx.builder.addNode({
        id,
        type: 'http_out',
        label: `${graphql === undefined ? 'POST' : `${graphql.operation}${graphql.name === undefined ? '' : ` ${graphql.name}`}`} ${path}`,
        repo: ctx.repo,
        file: scope.file,
        line: site.line,
        meta: {
          method: 'POST',
          url: info?.url ?? path,
          path,
          baseUrlEnv: info?.baseUrlEnv ?? null,
          ...(info?.baseUrlDefault === undefined ? {} : { baseUrlDefault: info.baseUrlDefault }),
          ...(info?.host === null || info?.host === undefined ? {} : { host: info.host }),
          responseType: null,
          bodyType: null,
          client: found.library,
          ...(graphql === undefined ? {} : { [GRAPHQL_META]: graphql }),
        },
      });
      ctx.builder.addEdge({ from: scope.id, to: id, type: 'calls', confidence: 'static', file: scope.file, line: site.line });
    });
  }
});
