import { makeEntryId, type GraphEdge, type GraphNode, type Unresolved } from '@flowatlas/core';
import { GRAPHQL_META, namedTypeIn, type GraphqlCallMeta, type SchemaSummary } from '@flowatlas/graphql';
import { edgeKey } from './order.js';

/**
 * The fields a GraphQL request selects, joined to the resolvers of the
 * service it reached (P232).
 *
 * By the time this runs every request has been joined to a route by its
 * address, as any request is; a request to a GraphQL server joined that
 * server's endpoint. Here each field it selects becomes an edge of the same
 * kind and confidence to that service's entry for the field - the root
 * fields, and every field below them a resolver of its own answers, found by
 * walking down from the root type through the schema the endpoint carries.
 * A field is only ever looked for in the service the request reached (D3),
 * so two services with a `Query.orders` each are never confused, and nothing
 * is joined by an operation's name.
 */
export const joinGraphqlFields = (nodes: ReadonlyMap<string, GraphNode>, edges: Map<string, GraphEdge>): Unresolved[] => {
  const rows: Unresolved[] = [];
  for (const edge of [...edges.values()]) {
    if (edge.type !== 'hits' && edge.type !== 'http_calls') continue;
    const call = nodes.get(edge.from);
    const endpoint = nodes.get(edge.to);
    const operation = call?.meta?.[GRAPHQL_META] as GraphqlCallMeta | undefined;
    const served = endpoint?.meta?.[GRAPHQL_META] as { endpoint?: boolean; schema?: SchemaSummary } | undefined;
    if (call === undefined || endpoint === undefined || operation === undefined || served?.endpoint !== true) continue;
    const schema = served.schema;
    const service = endpoint.repo;
    const rootType = schema?.roots[operation.operation] ?? (operation.operation === 'query' ? 'Query' : operation.operation === 'mutation' ? 'Mutation' : 'Subscription');
    const named = operation.name ?? operation.operation;

    const join = (type: string, field: GraphqlCallMeta['fields'][number], depth: number): void => {
      if (depth > 32 || field.field === '__typename') return;
      const owner = field.on ?? type;
      const entryId = makeEntryId(service, 'graphql', `${owner}.${field.field}`);
      const entry = nodes.get(entryId);
      const declared = schema?.types[owner]?.fields?.[field.field];
      if (entry !== undefined) {
        const joined: GraphEdge = {
          from: call.id,
          to: entryId,
          type: edge.type,
          confidence: edge.confidence,
          ...(call.file === undefined ? {} : { file: operation.document.file }),
          line: field.line,
          meta: { [GRAPHQL_META]: { operation: named, field: `${owner}.${field.field}`, ...(field.alias === undefined ? {} : { alias: field.alias }) } },
        };
        edges.set(edgeKey(joined), joined);
      } else if (depth === 0 && (declared !== undefined || schema === undefined)) {
        // A root field the schema has and no resolver answers. One the schema
        // does not have is the contract's to say (`graphql-field-unknown`).
        rows.push({
          service: call.repo,
          file: operation.document.file,
          line: field.line,
          reason: 'graphql-field-no-resolver',
          level: 'action',
          message: `${named} asks ${service} for ${owner}.${field.field}, which no resolver of ${service} answers`,
          hint: 'Resolve the field in the service, or correct the operation; the request stops at the endpoint.',
          symbol: call.id,
        });
      }
      if (declared === undefined || field.selections === undefined) return;
      for (const inner of field.selections) join(namedTypeIn(declared.type), inner, depth + 1);
    };

    for (const field of operation.fields) join(rootType, field, 0);
  }
  return rows;
};
