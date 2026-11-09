import { forEachCall, makeLeafId, normalizeFilePath, siteOf } from '@flowatlas/core';
import { callAddressOf, documentOf, GRAPHQL_META, graphqlCallOf, operationMeta, operationsOf, pageClientIn, type GraphqlCall } from '@flowatlas/graphql';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import type { CallExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import { analyzeApiUrl, type ApiUrl } from '../util/url.js';
import { definePass } from './types.js';

/**
 * The GraphQL operations a browser sends (P232).
 *
 * A request like any other - `POST` to the endpoint its client is made with,
 * joined to a service by the address as every request is - carrying under
 * `meta.graphql` the operation it sends: the root fields, what is selected
 * under each, the variables, the line of the document. The linker joins those
 * fields to the resolvers of the service the request reached. A `fetch` the
 * request pass has already drawn gets the operation added to its node.
 *
 * A document this cannot read is a row, never a guess at what it asks.
 */

/** The repository's files, and the address the client the page is wrapped in is made with, read once per repository (P266). */
const clientsOf = (ctx: ReactExtractContext): { sources: () => SourceFile[]; page: () => TsNode | undefined } => {
  let sources: SourceFile[] | undefined;
  let page: TsNode | undefined | null = null;
  const files = (): SourceFile[] => (sources ??= ctx.project.getSourceFiles().filter((file) => !file.getFilePath().includes('/node_modules/')));
  return {
    sources: files,
    page: () => {
      if (page === null) page = pageClientIn(files());
      return page;
    },
  };
};

const DEFAULT_ENDPOINT = '/graphql';

export const graphqlPass = definePass('graphql', (ctx: ReactExtractContext) => {
  const clients = clientsOf(ctx);
  // A call read once, and every function it is written in drawn to it.
  const drawn = new Map<CallExpression, string>();

  const record = (call: CallExpression, found: GraphqlCall, ownerId: string): string => {
    const file = ctx.fileOf(call);
    const at = siteOf(call);
    const id = makeLeafId('ui_api_call', ctx.repo, file, at.line, at.column);
    const reading = documentOf(found.document);
    let graphql: Record<string, unknown> | undefined;
    if (reading.kind === 'read') {
      const [operation] = operationsOf(reading.document, reading.fragments);
      if (operation === undefined) {
        ctx.report({ file, line: at.line, reason: 'graphql-document-dynamic', level: 'action', message: 'the document holds no operation', hint: 'Hand the call a document with a query, a mutation or a subscription.', symbol: call.getExpression().getText() });
      } else {
        graphql = { ...operationMeta(operation, reading, (path) => normalizeFilePath(path, ctx.repoDir), found.library, found.transport) };
        if (operation.missingFragments.length > 0 || reading.unread > 0) {
          ctx.report({
            file,
            line: at.line,
            reason: 'graphql-fragment-not-read',
            level: 'info',
            message: `the operation spreads ${operation.missingFragments.length === 0 ? 'a fragment' : operation.missingFragments.join(', ')} this could not read, so the fields it selects are not compared`,
            hint: 'Write the fragment in a gql template the document interpolates, or in the document itself.',
            symbol: operation.name ?? call.getExpression().getText(),
          });
        }
      }
    } else {
      ctx.report({
        file,
        line: at.line,
        reason: reading.kind === 'invalid' ? 'graphql-document-not-parsed' : 'graphql-document-dynamic',
        level: 'action',
        message: reading.why,
        hint: reading.kind === 'invalid' ? 'The document is not valid GraphQL; the server would refuse it too.' : 'Write the document as a gql template or a .graphql file, so the fields it asks for can be joined.',
        symbol: call.getExpression().getText(),
      });
    }

    // A `fetch` the request pass drew is that request; it carries the operation now.
    const existing = ctx.builder.getNode(id);
    if (existing !== undefined) {
      if (graphql !== undefined) existing.meta = { ...existing.meta, [GRAPHQL_META]: graphql };
      return id;
    }
    // The client it is sent with: the address it names, the client it names, or the page's (P266).
    const chosen = callAddressOf(found, clients.sources(), clients.page);
    if (chosen.kind === 'unread') {
      ctx.report({
        file,
        line: at.line,
        reason: 'graphql-client-unread',
        level: 'action',
        message: `the operation is sent with a client this could not follow to its address: ${chosen.why}`,
        hint: 'Make the client with its uri written where it is made, or hand it down through a context provider whose value is one, so the endpoint the operation reaches can be read.',
        symbol: call.getExpression().getText(),
      });
    }
    const address: ApiUrl | undefined = chosen.kind === 'address' && chosen.node !== undefined ? analyzeApiUrl(chosen.node, { sharedPackages: ctx.config.sharedPackages }) : undefined;
    const path = chosen.kind === 'unread' ? null : (address?.path ?? DEFAULT_ENDPOINT);
    ctx.builder.addNode({
      id,
      type: 'ui_api_call',
      label: `${graphql === undefined ? 'POST' : `${graphql['operation'] as string}${graphql['name'] === undefined ? '' : ` ${graphql['name'] as string}`}`} ${path ?? '?'}`,
      repo: ctx.repo,
      file,
      line: at.line,
      kind: 'http',
      meta: {
        method: 'POST',
        url: address?.url ?? path,
        path,
        baseUrlEnv: address?.baseUrlEnv ?? null,
        responseType: null,
        bodyType: null,
        package: found.library,
        client: found.library,
        via: address?.via ?? 'literal',
        ...(address?.host === null || address?.host === undefined ? {} : { host: address.host }),
        ...(graphql === undefined ? {} : { [GRAPHQL_META]: graphql }),
      },
    });
    ctx.builder.addEdge({ from: ownerId, to: id, type: 'calls', confidence: 'static', file, line: at.line });
    return id;
  };

  for (const indexed of ctx.functions.all()) {
    if (indexed.file.startsWith('../')) continue;
    forEachCall(indexed.fn.body, (node) => {
      if (!Node.isCallExpression(node)) return;
      const known = drawn.get(node);
      if (known !== undefined) {
        ctx.ensureFunctionNode(indexed.fn);
        ctx.builder.addEdge({ from: indexed.id, to: known, type: 'calls', confidence: 'static', file: indexed.file, line: siteOf(node).line });
        return;
      }
      const found = graphqlCallOf(node);
      if (found === undefined) return;
      ctx.ensureFunctionNode(indexed.fn);
      drawn.set(node, record(node, found, indexed.id));
    });
  }
});

