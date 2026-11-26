import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { joinGraphqlFields } from './graphql-link.js';
import { edgeKey } from './order.js';

/**
 * An operation joined to the fields of the schema its endpoint serves, where
 * a server serves several (P266).
 */

const field = (key: string): GraphNode => ({ id: `entry:api:graphql:${key}`, type: 'entry', kind: 'graphql', label: key, repo: 'api', meta: {} });

const endpoint = (path: string, open?: string): GraphNode => ({
  id: `entry:api:http:POST:${path}`,
  type: 'entry',
  kind: 'http',
  label: `POST ${path}`,
  repo: 'api',
  meta: {
    method: 'POST',
    path,
    graphql: {
      endpoint: true,
      fieldsAt: path,
      ...(open === undefined ? {} : { open }),
      schema: { roots: { query: 'Query' }, types: { Query: { kind: 'object', fields: { me: { type: 'Viewer!' } } }, Viewer: { kind: 'object', fields: { id: { type: 'ID!' } } } } },
    },
  },
});

const operation = (fields: readonly string[]): GraphNode => ({
  id: 'ui_api_call:web#src/page.tsx:3:2',
  type: 'ui_api_call',
  kind: 'http',
  label: 'query Page',
  repo: 'web',
  file: 'src/page.tsx',
  meta: { method: 'POST', path: '/settings', graphql: { operation: 'query', name: 'Page', document: { file: 'src/page.tsx', line: 1 }, fields: fields.map((name, at) => ({ field: name, line: at + 2 })) } },
});

const run = (at: GraphNode, fields: readonly string[]) => {
  const call = operation(fields);
  const nodes = new Map([call, at, endpoint('/graphql'), field('Query.me@/settings'), field('Query.me@/graphql')].map((node) => [node.id, node]));
  const hit: GraphEdge = { from: call.id, to: at.id, type: 'hits', confidence: 'heuristic' };
  const edges = new Map([[edgeKey(hit), hit]]);
  const rows = joinGraphqlFields(nodes, edges);
  return { joined: [...edges.values()].filter((edge) => edge.to.includes(':graphql:')).map((edge) => edge.to), rows };
};

describe('the fields of the schema an endpoint serves (P266)', () => {
  it('joins the field of the endpoint the operation reached, and not the same field of another schema', () => {
    const { joined, rows } = run(endpoint('/settings'), ['me']);
    expect(joined).toEqual(['entry:api:graphql:Query.me@/settings']);
    expect(rows).toEqual([]);
  });

  it('says a root field no resolver declares at an endpoint whose schema is not all it answers', () => {
    const { joined, rows } = run(endpoint('/settings', 'its plugin useRecords answers requests itself'), ['products']);
    expect(joined).toEqual([]);
    expect(rows.map((row) => [row.reason, row.level])).toEqual([['graphql-field-no-resolver', 'info']]);
    expect(rows[0]?.message).toContain('its plugin useRecords answers requests itself');
  });

  it('leaves a field the schema lacks to the contract where the schema is all there is', () => {
    expect(run(endpoint('/settings'), ['products']).rows).toEqual([]);
  });
});
