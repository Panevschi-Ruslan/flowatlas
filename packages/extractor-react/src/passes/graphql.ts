import { forEachCall, makeLeafId, normalizeFilePath, siteOf } from '@flowatlas/core';
import { callAddressOf, clientAddressOf, documentOf, GRAPHQL_META, graphqlCallOf, operationMeta, operationsOf, pageClientIn, type GraphqlCall } from '@flowatlas/graphql';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import type { CallExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import { handedOutward, isHandedParameter } from '../util/forward.js';
import type { IndexedFunction } from '../index-functions.js';
import { analyzeApiUrl, analyzeClientBase, type ApiUrl } from '../util/url.js';
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

/**
 * The address a client is made with. A client whose whole address is a
 * setting (`createClient({ url: import.meta.env.VITE_GQL_URL })`) is sent to
 * the endpoint that setting holds (P275): rooted at the key, at the library's
 * `/graphql`, where the address is not read - so a value the setting is
 * given, or a configuration naming the key, decides which service answers.
 */
const clientAddress = (node: TsNode, sharedPackages: readonly string[] | undefined): ApiUrl => {
  const read = analyzeApiUrl(node, { sharedPackages: sharedPackages ?? [] });
  if (read.path !== null || read.baseUrlEnv !== null || read.host !== null) return read;
  const base = analyzeClientBase(node, { sharedPackages: sharedPackages ?? [] });
  if (base.baseUrlEnv === null || (base.path !== null && base.path !== '' && base.path !== '/')) return read;
  return { ...base, url: `\${${base.baseUrlEnv}}${DEFAULT_ENDPOINT}`, path: DEFAULT_ENDPOINT };
};

export const graphqlPass = definePass('graphql', (ctx: ReactExtractContext) => {
  const clients = clientsOf(ctx);
  // A call read once, and every function it is written in drawn to it.
  const drawn = new Map<CallExpression, string>();

  /**
   * One operation, recorded where it is decided: at the call that sends it,
   * or - where a helper of the repository's is handed the document - at the
   * caller that hands it (`placed`), the id carrying where the client is
   * called, as a request followed out of a wrapper does.
   */
  const record = (call: CallExpression, found: GraphqlCall, ownerId: string, placed?: { readonly site: CallExpression; readonly through: string }): string => {
    const site = placed?.site ?? call;
    const file = ctx.fileOf(site);
    const at = siteOf(site);
    const leaf = makeLeafId('ui_api_call', ctx.repo, file, at.line, at.column);
    const network = siteOf(call);
    const id = placed === undefined ? leaf : `${leaf}@${network.line}:${network.column}`;
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
        symbol: placed?.through ?? call.getExpression().getText(),
      });
    }

    // A `fetch` the request pass drew is that request; it carries the operation now.
    const existing = ctx.builder.getNode(id);
    if (existing !== undefined && placed === undefined) {
      if (graphql !== undefined) existing.meta = { ...existing.meta, [GRAPHQL_META]: graphql };
      return id;
    }
    // The client it is sent with: the address it names, the client it names, or the page's (P266).
    const chosen = callAddressOf(withHandedClient(found), clients.sources(), clients.page);
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
    const address: ApiUrl | undefined = chosen.kind === 'address' && chosen.node !== undefined ? clientAddress(chosen.node, ctx.config.sharedPackages) : undefined;
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
        ...(placed === undefined ? {} : { through: placed.through }),
        ...(graphql === undefined ? {} : { [GRAPHQL_META]: graphql }),
      },
    });
    ctx.builder.addEdge({ from: ownerId, to: id, type: 'calls', confidence: 'static', file, line: at.line });
    return id;
  };

  /**
   * A client a helper is handed (`({ client }) => client.query(...)`), read
   * at the helper's callers (P275): the one they all hand, where every one
   * hands a client made with the same address; the call's own otherwise.
   */
  const withHandedClient = (found: GraphqlCall): GraphqlCall => {
    const client = found.client;
    if (client === undefined || !isHandedParameter(ctx, client.node)) return found;
    const sources = clients.sources();
    const handed = handedOutward(ctx, client.node, (value) => clientAddressOf(value, sources).kind !== 'unread') ?? [];
    const values = handed.map((each) => each.value);
    const [first] = values;
    if (first === undefined || values.some((value) => value === undefined)) return found;
    const answers = (values as TsNode[]).map((value) => clientAddressOf(value, sources));
    const said = new Set(answers.map((answer) => (answer.kind === 'address' ? answer.node.getText() : answer.kind)));
    if (said.size !== 1 || answers[0]?.kind === 'unread') return found;
    return { ...found, client: { node: first, named: true } };
  };

  // A caller handing one helper its document, recorded once whichever of the helper's calls reached it.
  const placedAt = new Map<CallExpression, Set<string>>();

  /**
   * A call whose document is a parameter of the helper it is written in, or
   * a member of one (P275): `runMutation(doc, vars)` calling
   * `client.mutation(doc, vars)`, `runQuery({ query })` calling
   * `createRequest(args.query)`. Each caller is the operation it hands, and
   * one handing a document this cannot read is said where it is written.
   * False where nothing is handed in from outside, or - for a call that is
   * an operation only if what it is handed is a document - where no caller
   * hands one.
   */
  const followedOut = (call: CallExpression, found: GraphqlCall, owner: IndexedFunction, strong: boolean): boolean => {
    if (found.document === undefined || documentOf(found.document).kind === 'read') return false;
    const handed = handedOutward(ctx, found.document, (value) => documentOf(value).kind === 'read');
    if (handed === undefined || handed.length === 0) return false;
    const readings = handed.map((each) => ({ each, reading: each.value === undefined ? undefined : documentOf(each.value) }));
    if (!readings.some(({ reading }) => reading?.kind === 'read')) return !strong;
    for (const { each, reading } of readings) {
      const site = each.calls[each.calls.length - 1] ?? each.call;
      const known = placedAt.get(site) ?? new Set<string>();
      if (known.has(each.through)) continue;
      known.add(each.through);
      placedAt.set(site, known);
      if (reading?.kind === 'read' || reading?.kind === 'invalid') {
        // A caller outside any function this reads is drawn from the helper the client is called in.
        const from = each.caller ?? owner;
        ctx.ensureFunctionNode(from.fn);
        record(call, { ...found, document: each.value }, from.id, { site, through: each.through });
        continue;
      }
      const line = siteOf(site).line;
      ctx.report({
        file: ctx.fileOf(site),
        line,
        reason: 'graphql-document-dynamic',
        level: 'action',
        message: reading === undefined ? `${each.through} is handed no document here this could point at` : reading.why,
        hint: `Hand ${each.through} a document written as a gql template, a .graphql file or a codegen document, so the fields it asks for can be joined.`,
        symbol: each.through,
      });
    }
    return true;
  };

  for (const indexed of ctx.functions.all()) {
    if (indexed.file.startsWith('../')) continue;
    forEachCall(indexed.fn.body, (node) => {
      if (!Node.isCallExpression(node)) return;
      const known = drawn.get(node);
      if (known === '') return;
      if (known !== undefined) {
        ctx.ensureFunctionNode(indexed.fn);
        ctx.builder.addEdge({ from: indexed.id, to: known, type: 'calls', confidence: 'static', file: indexed.file, line: siteOf(node).line });
        return;
      }
      const found = graphqlCallOf(node);
      if (found !== undefined) {
        if (followedOut(node, found, indexed, true)) {
          drawn.set(node, '');
          return;
        }
        ctx.ensureFunctionNode(indexed.fn);
        drawn.set(node, record(node, found, indexed.id));
        return;
      }
      // A method that sends an operation only if it is handed a document: one its helper's callers hand.
      const handed = graphqlCallOf(node, (expression) => isHandedParameter(ctx, expression));
      if (handed !== undefined && followedOut(node, handed, indexed, false)) drawn.set(node, '');
    });
  }
});

