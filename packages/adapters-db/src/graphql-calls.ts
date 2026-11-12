import { forEachCall, makeLeafId, normalizeFilePath, rootSettingAddress } from '@flowatlas/core';
import { definePass, scopesOf, type NestExtractContext, type NestExtractorPass } from '@flowatlas/extractor-nestjs';
import { callAddressOf, documentOf, GRAPHQL_META, graphqlCallOf, operationMeta, operationsOf, pageClientIn } from '@flowatlas/graphql';
import type { CallExpression, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import { analyzeUrl, routePathOf, type UrlInfo } from './leaves/url.js';

/**
 * The GraphQL operations a server sends another service (P232):
 * graphql-request's `request(url, document)` and `GraphQLClient#request`,
 * Apollo Client in a server, `fetch` with a body holding `query`. Each is an
 * `http_out` to the endpoint it names, with the operation it sends under
 * `meta.graphql`, so the linker joins it to the other service's endpoint by
 * the same rules as any request and then to the fields it selects.
 */
/** `process.env.X` and `import.meta.env.X`: the setting a read names. */
const environmentKey = (node: TsNode): string | null =>
  Node.isPropertyAccessExpression(node) && /^(?:globalThis\.)?(?:process|import\.meta)\.env$/.test(node.getExpression().getText()) ? node.getName() : null;

/**
 * The setting an address a codegen SDK's requester sends to is rooted at,
 * followed through the names and branches it is held in (P281):
 * `let API_URL = typeof process !== 'undefined' ? process.env.API_URL ?? FALLBACK : FALLBACK`.
 */
const settingRooted = (node: TsNode): UrlInfo | undefined => {
  const rooted = rootSettingAddress(node, { readSetting: environmentKey });
  if (rooted === null) return undefined;
  return { url: `\${${rooted.key}}${rooted.prefix}`, path: routePathOf(rooted.prefix), baseUrlEnv: rooted.key, host: null };
};

export const graphqlCallsPass: NestExtractorPass = definePass('graphql-calls', (ctx: NestExtractContext) => {
  const sources = ctx.project.getSourceFiles().filter((file) => !file.getFilePath().includes('/node_modules/'));
  let made: ReturnType<typeof pageClientIn> | null = null;
  const clientEndpoint = () => (made === null ? (made = pageClientIn(sources)) : made);

  for (const scope of scopesOf(ctx)) {
    forEachCall(scope.body, (node) => {
      if (!Node.isCallExpression(node)) return;
      const call = node as CallExpression;
      const found = graphqlCallOf(call);
      if (found === undefined) return;
      const site = ctx.project.getSourceFile(call.getSourceFile().getFilePath())?.getLineAndColumnAtPos(call.getStart());
      if (site === undefined) return;
      const id = makeLeafId('http_out', ctx.repo, scope.file, site.line, site.column);
      const reading = found.reading ?? documentOf(found.document);
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
      // The client it is sent with: the address it names, the client it names, or the application's (P266).
      const chosen = callAddressOf(found, sources, clientEndpoint);
      if (chosen.kind === 'unread') {
        ctx.builder.addUnresolved({
          file: scope.file,
          line: site.line,
          reason: 'graphql-client-unread',
          level: 'action',
          message: `the operation is sent with a client this could not follow to its address: ${chosen.why}`,
          hint: 'Make the client with its uri written where it is made, so the endpoint the operation reaches can be read.',
          symbol: call.getExpression().getText().slice(0, 60),
        });
      }
      const written = chosen.kind === 'address' ? chosen.node : undefined;
      // A codegen SDK's address is the one its requester sends to, whole (P281), not a client's base.
      const sent = found.library === 'codegen-sdk';
      const read = written === undefined ? undefined : analyzeUrl(written, { whole: sent });
      const info = sent && written !== undefined && read?.path === null ? (settingRooted(written) ?? read) : read;
      const path = chosen.kind === 'unread' ? null : (info?.path ?? (sent ? null : '/graphql'));
      scope.ensure();
      ctx.builder.addNode({
        id,
        type: 'http_out',
        label: `${graphql === undefined ? 'POST' : `${graphql.operation}${graphql.name === undefined ? '' : ` ${graphql.name}`}`} ${path ?? '?'}`,
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
    }, scope.leaveOut);
  }
});
