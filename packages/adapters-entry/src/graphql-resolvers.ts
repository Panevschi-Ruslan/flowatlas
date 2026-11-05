import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  allDependencies,
  hasAnyDependency,
  makeEntryId,
  makeHttpEntryKey,
  startLineOf,
  type EntryAdapter,
  type EntryNode,
  type ExtractContext,
} from '@flowatlas/core';
import { readGraphqlServer, type ResolvedField } from '@flowatlas/graphql';
import { Node } from 'ts-morph';
import { fileOfNode, handlerOf, handlerOfFunction, inlineHandlerOf, repoSources } from './shared.js';

/**
 * A GraphQL server's ways in (P232).
 *
 * Every field a resolver answers is an entry of kind `graphql`, keyed by its
 * type and name: `Query.orders` is a way in, `Order.customer` one a request
 * reaches only through a selection under it (`meta.field`). The endpoint the
 * server answers at is an ordinary route, `POST /graphql`, carrying the
 * schema: a client's request joins to it as any request joins to a route, by
 * the service its address names, and the linker then joins the fields the
 * request selects to this service's entries, and to no other's (D3).
 *
 * What the server is made with is read by `@flowatlas/graphql`; this turns it
 * into entries. A subgraph of a federated graph is said once, since what an
 * entity resolved across subgraphs reaches is not read.
 */
export const GRAPHQL_SERVER_PACKAGES = [
  '@nestjs/graphql',
  'type-graphql',
  '@apollo/server',
  'apollo-server',
  'apollo-server-express',
  'graphql-yoga',
  'mercurius',
  'graphql-http',
  '@graphql-tools/schema',
  '@apollo/subgraph',
];

const SKIPPED = new Set(['node_modules', 'dist', 'build', 'coverage']);

/** Every `.graphql` / `.gql` file under the repository: the SDL a schema-first server loads. */
const schemaFilesUnder = (dir: string, depth = 0): string[] => {
  if (depth > 12) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .flatMap((entry) => {
      if (entry.isDirectory()) return SKIPPED.has(entry.name) || entry.name.startsWith('.') ? [] : schemaFilesUnder(join(dir, entry.name), depth + 1);
      return /\.(graphql|gql)$/.test(entry.name) ? [join(dir, entry.name)] : [];
    })
    .sort();
};

/** The handler an entry points at, as the reader that walks it names it. */
const handlerFor = (ctx: ExtractContext, field: ResolvedField, label: string): EntryNode['handler'] => {
  if (field.handler.kind === 'method') return handlerOf(field.handler.method, ctx);
  const fn = field.handler.fn;
  if (Node.isFunctionDeclaration(fn) && fn.getName() !== undefined && fn.getBody() !== undefined) {
    return handlerOfFunction({ name: fn.getName() as string, declaration: fn, body: fn.getBody() as Node, line: startLineOf(fn) }, ctx);
  }
  if (Node.isVariableDeclaration(fn)) {
    const value = fn.getInitializer();
    if (value !== undefined && (Node.isArrowFunction(value) || Node.isFunctionExpression(value))) return handlerOfFunction({ name: fn.getName(), declaration: fn, body: value.getBody(), line: startLineOf(fn) }, ctx);
  }
  return inlineHandlerOf(fn, label, ctx);
};

export const graphqlResolversAdapter: EntryAdapter = {
  name: 'graphql-resolvers',
  detect: (pkg) => hasAnyDependency(pkg, GRAPHQL_SERVER_PACKAGES),

  extractEntries(ctx: ExtractContext): EntryNode[] {
    const sources = [...repoSources(ctx)];
    const reading = readGraphqlServer(sources, { schemaFiles: schemaFilesUnder(ctx.repoDir), dependencies: new Set(Object.keys(allDependencies(ctx.pkg))) });
    if (reading.fields.length === 0 && Object.keys(reading.schema.types).length === 0) return [];
    const entries: EntryNode[] = [];
    const seen = new Map<string, string>();
    for (const field of reading.fields) {
      const key = `${field.type}.${field.field}`;
      const file = fileOfNode(field.at, ctx);
      const line = startLineOf(field.at);
      const handler = handlerFor(ctx, field, key);
      const first = seen.get(key);
      if (first !== undefined && first !== `${file}:${line}`) {
        ctx.builder.addUnresolved({
          file,
          line,
          reason: 'graphql-field-resolved-twice',
          level: 'action',
          message: `${key} is resolved here and at ${first}; the server runs one of them`,
          hint: 'Two resolvers answer one field. Remove one, or move it to the field it was meant for.',
          symbol: key,
          adapter: 'graphql-resolvers',
        });
      }
      seen.set(key, first ?? `${file}:${line}`);
      entries.push({
        id: makeEntryId(ctx.repo, 'graphql', key),
        kind: 'graphql',
        label: key,
        key,
        ...(handler === undefined ? {} : { handler }),
        file,
        line,
        meta: {
          type: field.type,
          name: field.field,
          // Reached only through a selection under a field that returns its type (D4).
          ...(field.root ? {} : { field: true }),
          ...(field.returns === undefined ? {} : { returns: field.returns }),
          ...(field.args === undefined ? {} : { args: field.args }),
          adapter: 'graphql-resolvers',
        },
      });
    }
    // The endpoint: a route like any other, which every request to the server reaches first.
    const at = reading.endpointAt ?? reading.fields[0]?.at;
    const endpointFile = at === undefined ? '' : fileOfNode(at, ctx);
    const endpointLine = at === undefined ? 1 : startLineOf(at);
    // POST: what every client sends; a GET the server also answers is no way in anything here uses.
    for (const method of ['POST']) {
      const key = makeHttpEntryKey(method, reading.endpoint);
      entries.push({
        id: makeEntryId(ctx.repo, 'http', key),
        kind: 'http',
        label: `${method} ${reading.endpoint}`,
        key,
        file: endpointFile,
        line: endpointLine,
        meta: {
          method,
          path: reading.endpoint,
          adapter: 'graphql-resolvers',
          registration: 'graphql/endpoint',
          handlerVia: 'graphql',
          graphql: { endpoint: true, schema: reading.schema },
        },
      });
    }
    if (reading.federated) {
      ctx.builder.addUnresolved({
        file: endpointFile,
        line: endpointLine,
        reason: 'graphql-federation-not-read',
        level: 'info',
        message: `${ctx.repo} is one subgraph of a federated graph; its own fields are joined, and what an entity resolved in another subgraph reaches is not`,
        hint: 'A request to the router reaches the subgraph that answers each field; that plan is not read yet, so the joins stop at this subgraph.',
        symbol: ctx.repo,
        adapter: 'graphql-resolvers',
      });
    }
    for (const unread of reading.unread) {
      ctx.builder.addUnresolved({
        file: fileOfNode(unread.at, ctx),
        line: startLineOf(unread.at),
        reason: 'graphql-document-dynamic',
        level: 'action',
        message: `the type definitions here could not be read: ${unread.why}`,
        hint: 'Write the schema as a gql template or a .graphql file, so its types can be read.',
        symbol: ctx.repo,
        adapter: 'graphql-resolvers',
      });
    }
    return entries;
  },
};
