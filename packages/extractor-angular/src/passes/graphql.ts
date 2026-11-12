import { forEachCall, makeLeafId, methodBodies, normalizeFilePath, siteOf } from '@flowatlas/core';
import {
  clientEndpointIn,
  documentOf,
  GRAPHQL_META,
  graphqlCallOf,
  operationMeta,
  operationsOf,
  SERVICE_SENDS,
  serviceDocumentOf,
  type GraphqlCall,
} from '@flowatlas/graphql';
import type { CallExpression, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { AngularExtractContext } from '../context.js';
import { analyzeApiUrl, type ApiUrl } from '../util/url.js';
import { definePass } from './types.js';

/**
 * The GraphQL operations an Angular application sends through apollo-angular
 * (P232): `this.apollo.query({ query })`, `watchQuery`, `mutate`, and a
 * `Query` service's `fetch()` or `watch()`, whose document is the service's
 * own. Each is a request to the endpoint its client is made with, carrying
 * the operation under `meta.graphql`, as the other front end's are.
 */

/** The document a call on a `Query` service sends: `this.ordersGQL.watch()`. */
const serviceCallOf = (call: CallExpression): GraphqlCall | undefined => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || !SERVICE_SENDS.has(callee.getName())) return undefined;
  for (const declaration of callee.getExpression().getType().getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isClassDeclaration(declaration)) continue;
    const document = serviceDocumentOf(declaration);
    if (document !== undefined) return { library: 'apollo-angular', document, ...(callee.getName() === 'subscribe' ? { transport: 'ws' as const } : {}) };
  }
  return undefined;
};

export const graphqlPass = definePass('graphql', (ctx: AngularExtractContext) => {
  let endpoint: ApiUrl | undefined | null = null;
  const clientEndpoint = (): ApiUrl | undefined => {
    if (endpoint !== null) return endpoint;
    const written = clientEndpointIn(ctx.project.getSourceFiles().filter((file) => !file.getFilePath().includes('/node_modules/')));
    endpoint = written === undefined ? undefined : analyzeApiUrl(written, ctx.config.sharedPackages);
    return endpoint;
  };

  const record = (call: CallExpression, found: GraphqlCall, methodId: string, file: string): void => {
    const at = siteOf(call);
    const id = makeLeafId('ui_api_call', ctx.repo, file, at.line, at.column);
    const reading = documentOf(found.document);
    const operation = reading.kind === 'read' ? operationsOf(reading.document, reading.fragments)[0] : undefined;
    const graphql = reading.kind === 'read' && operation !== undefined ? operationMeta(operation, reading, (path) => normalizeFilePath(path, ctx.repoDir), found.library, found.transport) : undefined;
    if (reading.kind !== 'read') {
      ctx.report({
        file,
        line: at.line,
        reason: reading.kind === 'invalid' ? 'graphql-document-not-parsed' : 'graphql-document-dynamic',
        level: 'action',
        message: reading.why,
        hint: 'Write the document as a gql template or a .graphql file, so the fields it asks for can be joined.',
        symbol: call.getExpression().getText(),
      });
    }
    const existing = ctx.builder.getNode(id);
    if (existing !== undefined) {
      if (graphql !== undefined) existing.meta = { ...existing.meta, [GRAPHQL_META]: graphql };
      return;
    }
    const address = found.endpoint === undefined ? clientEndpoint() : analyzeApiUrl(found.endpoint, ctx.config.sharedPackages);
    const path = address?.path ?? '/graphql';
    ctx.builder.addNode({
      id,
      type: 'ui_api_call',
      label: `${graphql === undefined ? 'POST' : `${graphql.operation}${graphql.name === undefined ? '' : ` ${graphql.name}`}`} ${path}`,
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
    ctx.builder.addEdge({ from: methodId, to: id, type: 'calls', confidence: 'static', file, line: at.line });
  };

  for (const indexed of ctx.classes.all()) {
    if (indexed.role === 'module') continue;
    for (const { declaration: method, body } of methodBodies(indexed.declaration)) {
      const methodId = ctx.methodIdOf(method);
      if (methodId === undefined) continue;
      forEachCall(body, (site: TsNode) => {
        if (!Node.isCallExpression(site)) return;
        const found = graphqlCallOf(site) ?? serviceCallOf(site);
        if (found === undefined) return;
        ctx.ensureMethodNode(method);
        record(site, found, methodId, indexed.file);
      });
    }
  }
});
