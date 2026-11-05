import { DECLARED_CONFIDENCE, makeEntryId, makeHttpEntryKey, makeSymbolId, SCHEMA_VERSION, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { GraphqlSyntaxError, parseDocument, schemaOf, type Document, type SchemaField, type SchemaSummary, type SchemaType } from '@flowatlas/graphql';
import { DECLARED_BY, DocumentError, type ReadDocumentOptions, type ReadDocumentResult } from '../document/declared.js';

/**
 * A GraphQL service declared by its schema, in place of its source (P232):
 * the SDL a server is built from, or the JSON an introspection query answers.
 *
 * Its root fields are its ways in, the entries a server read from source
 * would have - `Query.products`, `Mutation.placeOrder` - declared by the
 * document and named at their line of it, and the endpoint carries the
 * schema, so a request joins it and the fields it selects as they would join
 * the server itself. A field of another type has no resolver anyone wrote
 * down, so it is not an entry.
 */

/** An introspection type reference as GraphQL writes it. */
const typeOfRef = (ref: unknown): string => {
  const value = ref as { kind?: string; name?: string | null; ofType?: unknown } | null;
  if (value === null || value === undefined) return 'Unknown';
  if (value.kind === 'NON_NULL') return `${typeOfRef(value.ofType)}!`;
  if (value.kind === 'LIST') return `[${typeOfRef(value.ofType)}]`;
  return value.name ?? 'Unknown';
};

const KINDS: Readonly<Record<string, SchemaType['kind']>> = { OBJECT: 'object', INTERFACE: 'interface', INPUT_OBJECT: 'input', ENUM: 'enum', UNION: 'union', SCALAR: 'scalar' };

/** The schema an introspection result describes. */
const fromIntrospection = (raw: Record<string, unknown>, documentPath: string): SchemaSummary => {
  const schema = ((raw['data'] as Record<string, unknown> | undefined)?.['__schema'] ?? raw['__schema']) as Record<string, unknown> | undefined;
  if (schema === undefined || !Array.isArray(schema['types'])) throw new DocumentError(`${documentPath} is neither SDL nor the answer to an introspection query`);
  const name = (key: string): string | undefined => (schema[key] as { name?: string } | null | undefined)?.name ?? undefined;
  const types: Record<string, SchemaType> = {};
  for (const type of schema['types'] as Array<Record<string, unknown>>) {
    const typeName = String(type['name'] ?? '');
    if (typeName.startsWith('__')) continue;
    const fields = [...((type['fields'] as unknown[] | null) ?? []), ...((type['inputFields'] as unknown[] | null) ?? [])] as Array<Record<string, unknown>>;
    const kind = KINDS[String(type['kind'])] ?? 'object';
    types[typeName] = {
      kind,
      ...(fields.length === 0
        ? {}
        : {
            fields: Object.fromEntries(
              fields.map((field): [string, SchemaField] => {
                const args = (field['args'] as Array<Record<string, unknown>> | undefined) ?? [];
                return [
                  String(field['name']),
                  {
                    type: typeOfRef(field['type']),
                    ...(args.length === 0 ? {} : { args: Object.fromEntries(args.map((arg) => [String(arg['name']), { type: typeOfRef(arg['type']), required: typeOfRef(arg['type']).endsWith('!') && arg['defaultValue'] == null }])) }),
                  },
                ];
              }),
            ),
          }),
    };
  }
  const query = name('queryType') ?? 'Query';
  const mutation = name('mutationType');
  const subscription = name('subscriptionType');
  return { roots: { query, ...(mutation === undefined ? {} : { mutation }), ...(subscription === undefined ? {} : { subscription }) }, types };
};

/** The line each field of each type is declared on, in SDL. */
const linesOf = (document: Document, text: string): Map<string, number> => {
  const lines = new Map<string, number>();
  const lineAt = (offset: number): number => text.slice(0, offset).split('\n').length;
  for (const definition of document.definitions) {
    if (definition.kind !== 'type') continue;
    for (const field of definition.fields) lines.set(`${definition.name}.${field.name}`, lineAt(field.at));
  }
  return lines;
};

export const readGraphqlDocument = (raw: unknown, options: ReadDocumentOptions): ReadDocumentResult => {
  const { service, documentPath } = options;
  let schema: SchemaSummary;
  let lines = new Map<string, number>();
  if (typeof raw === 'string') {
    let document: Document;
    try {
      document = parseDocument(raw);
    } catch (error) {
      if (!(error instanceof GraphqlSyntaxError)) throw error;
      throw new DocumentError(`${documentPath} is not GraphQL SDL: ${error.message} at line ${raw.slice(0, error.at).split('\n').length}`);
    }
    schema = schemaOf([document]);
    lines = linesOf(document, raw);
  } else if (raw !== null && typeof raw === 'object') {
    schema = fromIntrospection(raw as Record<string, unknown>, documentPath);
  } else {
    throw new DocumentError(`${documentPath} is neither SDL nor the answer to an introspection query`);
  }

  const declared = { [DECLARED_BY]: documentPath };
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const operation of ['query', 'mutation', 'subscription'] as const) {
    const root = schema.roots[operation];
    if (root === undefined) continue;
    for (const [field, definition] of Object.entries(schema.types[root]?.fields ?? {})) {
      const key = `${root}.${field}`;
      const entryId = makeEntryId(service, 'graphql', key);
      const handlerId = makeSymbolId(service, documentPath, key);
      const line = lines.get(key);
      nodes.push({
        id: entryId,
        type: 'entry',
        label: key,
        repo: service,
        file: documentPath,
        ...(line === undefined ? {} : { line }),
        kind: 'graphql',
        meta: { type: root, name: field, returns: definition.type, ...(definition.args === undefined ? {} : { args: definition.args }), adapter: 'graphql-schema', ...declared },
      });
      nodes.push({ id: handlerId, type: 'method', label: key, repo: service, file: documentPath, ...(line === undefined ? {} : { line }), meta: { ...declared } });
      edges.push({ from: entryId, to: handlerId, type: 'handles', confidence: DECLARED_CONFIDENCE, file: documentPath, meta: { ...declared } });
    }
  }
  const entries = nodes.filter((node) => node.type === 'entry').length;
  for (const method of ['POST']) {
    nodes.push({
      id: makeEntryId(service, 'http', makeHttpEntryKey(method, '/graphql')),
      type: 'entry',
      label: `${method} /graphql`,
      repo: service,
      file: documentPath,
      kind: 'http',
      meta: { method, path: '/graphql', adapter: 'graphql-schema', registration: 'graphql/endpoint', handlerVia: 'graphql', graphql: { endpoint: true, schema }, ...declared },
    });
  }
  return {
    declared: entries,
    graph: { schemaVersion: SCHEMA_VERSION, repo: service, generatedAt: options.generatedAt ?? new Date().toISOString(), nodes, edges, types: {}, unresolved: [], meta: { ...declared } },
  };
};
