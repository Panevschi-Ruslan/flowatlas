import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  allDependencies,
  hasAnyDependency,
  makeEntryId,
  makeHttpEntryKey,
  normalizeFilePath,
  startLineOf,
  type EntryAdapter,
  type EntryNode,
  type ExtractContext,
} from '@flowatlas/core';
import {
  apiSchemaOf,
  besideFile,
  readGraphqlServer,
  readRoverConfig,
  routeAddress,
  schemaOf,
  supergraphComposition,
  tryParse,
  type GatewayMeta,
  type GatewayReading,
  type GatewayRouteMeta,
  type ResolvedField,
  type SchemaSummary,
  type UnreadDetail,
} from '@flowatlas/graphql';
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
 * into entries.
 *
 * Federated (P241): a subgraph's endpoint says so (`meta.graphql.subgraph`),
 * and its reference resolver is an entry like a field's, which an entity call
 * from another subgraph reaches. A gateway resolves nothing: its endpoint
 * carries the subgraphs it names and, where a supergraph wrote it down, the
 * composition, and the linker plans each request to it across the subgraphs.
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
  '@apollo/gateway',
];

/** The names rover's configuration of a supergraph is written under. */
const ROVER_FILES = /^supergraph(-config)?\.ya?ml$/;

const SKIPPED = new Set(['node_modules', 'dist', 'build', 'coverage']);

/** Every file under the repository whose name matches: the SDL a schema-first server loads, a rover configuration. */
const filesUnder = (dir: string, named: RegExp, depth = 0): string[] => {
  if (depth > 12) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .flatMap((entry) => {
      if (entry.isDirectory()) return SKIPPED.has(entry.name) || entry.name.startsWith('.') ? [] : filesUnder(join(dir, entry.name), named, depth + 1);
      return named.test(entry.name) ? [join(dir, entry.name)] : [];
    })
    .sort();
};

/** The line an offset into a text is on. */
const lineOfOffset = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;

/** The text of a file, or nothing where it cannot be read. */
const textOf = (path: string): string | undefined => {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  } catch {
    return undefined;
  }
};

/**
 * What a gateway's endpoint carries (P241): its subgraphs with their
 * addresses as a request's are written, and the composition where a
 * supergraph wrote it down. Rover's configuration names each subgraph's
 * routing URL and where its schema is; a schema in a file is read here, one
 * at the subgraph's own endpoint is the subgraph's source, read by the
 * linker, and one in the registry is said.
 */
const gatewayMetaOf = (reading: GatewayReading, ctx: ExtractContext): GatewayMeta => {
  const at = reading.at;
  const site = { file: fileOfNode(at, ctx), line: startLineOf(at) };
  if (reading.kind === 'unread') return { subgraphs: [], unread: { detail: reading.detail, why: reading.why } };
  if (reading.kind === 'subgraphs') {
    return { subgraphs: reading.subgraphs.map((route): GatewayRouteMeta => ({ name: route.name, ...('getSourceFile' in route.at ? { file: fileOfNode(route.at, ctx), line: startLineOf(route.at) } : route.at), ...routeAddress(route.address) })) };
  }
  if (reading.kind === 'supergraph') {
    const document = tryParse(reading.text);
    const from = reading.file === undefined ? undefined : normalizeFilePath(reading.file, ctx.repoDir);
    if (document === undefined) {
      return { subgraphs: [], unread: { detail: 'not-committed', why: `the supergraph${from === undefined ? '' : ` in ${from}`} is not GraphQL the tool can read` } };
    }
    const { composition, graphs } = supergraphComposition(document, reading.text);
    return {
      subgraphs: graphs.map((graph): GatewayRouteMeta => ({
        name: graph.name,
        ...(from === undefined ? site : { file: from, line: lineOfOffset(reading.text, graph.at) }),
        ...(graph.url === undefined ? { path: '', unread: '' } : routeAddress({ kind: 'literal', url: graph.url })),
      })),
      composition,
      ...(from === undefined ? {} : { from }),
      ...(reading.taken === true ? { taken: true as const } : {}),
    };
  }
  const text = textOf(reading.file) ?? '';
  const from = normalizeFilePath(reading.file, ctx.repoDir);
  const rover = readRoverConfig(text, from);
  return {
    subgraphs: rover.subgraphs.map((route): GatewayRouteMeta => {
      const schemaText = route.schemaFile === undefined ? undefined : textOf(besideFile(reading.file, route.schemaFile));
      const document = schemaText === undefined ? undefined : tryParse(schemaText);
      const schema: SchemaSummary | undefined = document === undefined ? undefined : schemaOf([document]);
      return {
        name: route.name,
        ...('getSourceFile' in route.at ? site : route.at),
        ...routeAddress(route.address),
        ...(schema === undefined ? {} : { schema }),
        ...(route.registry === undefined ? {} : { registry: route.registry }),
      };
    }),
    from,
  };
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

/** What to do about each thing a gateway cannot be read for (D9). */
const FEDERATION_UNREAD_HINTS: Readonly<Record<UnreadDetail, string>> = {
  managed:
    'The router is handed its supergraph by the registry when it starts. Commit the supergraph it serves (rover supergraph compose) and read it with supergraphSdl, or describe the router with document: { kind: "graphql", path: "<the supergraph>" }.',
  'built-at-start':
    'The supergraph is made by code that runs at start. Hand the gateway an IntrospectAndCompose with its subgraphs written out, or a supergraph file, so the composition can be read.',
  'not-committed':
    'Commit the supergraph the gateway reads, or the rover configuration it is composed from (supergraph.yaml), so the composition can be read.',
  registry:
    'Point the subgraph\'s schema at a file or at the subgraph\'s own endpoint in the rover configuration, or add the subgraph\'s repository to the project.',
};

export const graphqlResolversAdapter: EntryAdapter = {
  name: 'graphql-resolvers',
  detect: (pkg) => hasAnyDependency(pkg, GRAPHQL_SERVER_PACKAGES),

  extractEntries(ctx: ExtractContext): EntryNode[] {
    const sources = [...repoSources(ctx)];
    const reading = readGraphqlServer(sources, {
      schemaFiles: filesUnder(ctx.repoDir, /\.(graphql|gql)$/),
      dependencies: new Set(Object.keys(allDependencies(ctx.pkg))),
      repoDir: ctx.repoDir,
      roverFiles: filesUnder(ctx.repoDir, ROVER_FILES),
    });
    if (reading.fields.length === 0 && Object.keys(reading.schema.types).length === 0 && reading.gateway === undefined) return [];
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
          // Reached only through a selection under a field that returns its type (D4),
          // or, for a reference resolver, through an entity call from another subgraph (P241).
          ...(field.root ? {} : { field: true }),
          ...(field.reference === true ? { reference: true } : {}),
          ...(field.returns === undefined ? {} : { returns: field.returns }),
          ...(field.args === undefined ? {} : { args: field.args }),
          adapter: 'graphql-resolvers',
        },
      });
    }
    // The endpoint: a route like any other, which every request to the server reaches first.
    const at = reading.endpointAt ?? reading.fields[0]?.at ?? reading.gateway?.at;
    const endpointFile = at === undefined ? '' : fileOfNode(at, ctx);
    const endpointLine = at === undefined ? 1 : startLineOf(at);
    const gateway = reading.gateway === undefined ? undefined : gatewayMetaOf(reading.gateway, ctx);
    const endpointId = makeEntryId(ctx.repo, 'http', makeHttpEntryKey('POST', reading.endpoint));
    // Where the server listens, so a gateway's `http://localhost:4001/graphql` reaches it (P245).
    const listen = reading.listen.map((port) => ({ port: port.port, file: fileOfNode(port.at, ctx), line: startLineOf(port.at), ...(port.setting === undefined ? {} : { setting: port.setting }) }));
    // A subgraph says the types its code says the concrete type of, for an entity call for an interface (P252).
    const subgraph = reading.federation === undefined ? undefined : { federation: reading.federation, ...(reading.typeResolvers.length === 0 ? {} : { typeResolvers: reading.typeResolvers }) };
    // A gateway serves the composition: a supergraph's is known now, one composed at start once the linker has the subgraphs.
    const served =
      gateway !== undefined
        ? { endpoint: true, gateway, ...(gateway.composition === undefined ? {} : { schema: apiSchemaOf(gateway.composition) }), ...(listen.length === 0 ? {} : { listen }) }
        : { endpoint: true, schema: reading.schema, ...(subgraph === undefined ? {} : { subgraph }), ...(listen.length === 0 ? {} : { listen }) };
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
          graphql: served,
        },
      });
    }
    // What a gateway cannot be read for, said where it is made (D9). A
    // subgraph no gateway names is said by the linker, which sees them all.
    if (gateway?.unread !== undefined) {
      ctx.builder.addUnresolved({
        file: endpointFile,
        line: endpointLine,
        reason: 'graphql-federation-not-read',
        level: 'info',
        message: `${ctx.repo} is a federation gateway, and ${gateway.unread.why}; requests to it are joined to its endpoint and to no subgraph`,
        hint: FEDERATION_UNREAD_HINTS[gateway.unread.detail],
        symbol: endpointId,
        adapter: 'graphql-resolvers',
        meta: { detail: gateway.unread.detail },
      });
    }
    for (const route of gateway?.subgraphs ?? []) {
      if (route.registry === undefined) continue;
      ctx.builder.addUnresolved({
        file: route.file,
        line: route.line,
        reason: 'graphql-federation-not-read',
        level: 'info',
        message: `the schema of the subgraph ${route.name} is the registry's (${route.registry}), so what it declares is read only where its source is in the project`,
        hint: FEDERATION_UNREAD_HINTS.registry,
        symbol: endpointId,
        adapter: 'graphql-resolvers',
        meta: { detail: 'registry' },
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
