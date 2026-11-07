import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GraphEdge, GraphNode, ProjectGraph } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { checkContracts } from './check.js';

const ROOT = resolve(import.meta.dirname, '../../..');

/** A graph with one request to one GraphQL endpoint, the operation and the schema as given; `served` adds to what the endpoint carries. */
const graphWith = (fields: unknown[], schema: unknown, served: Record<string, unknown> = {}): ProjectGraph => {
  const call: GraphNode = {
    id: 'ui_api_call:web#src/a.ts:1:1',
    type: 'ui_api_call',
    label: 'query A /graphql',
    repo: 'web',
    file: 'src/a.ts',
    line: 1,
    meta: { method: 'POST', path: '/graphql', graphql: { operation: 'query', name: 'A', fields, variables: [], document: { file: 'src/a.ts', line: 1 }, library: 'apollo' } },
  };
  const endpoint: GraphNode = { id: 'entry:orders:http:POST:/graphql', type: 'entry', label: 'POST /graphql', repo: 'orders', kind: 'http', meta: { method: 'POST', path: '/graphql', graphql: { endpoint: true, schema, ...served } } };
  const edge: GraphEdge = { from: call.id, to: endpoint.id, type: 'hits', confidence: 'static' };
  return { schemaVersion: 7, builtAt: '2026-11-05T00:00:00.000Z', services: [], nodes: [call, endpoint], edges: [edge], types: {}, unresolved: [] } as unknown as ProjectGraph;
};

const SCHEMA = {
  roots: { query: 'Query' },
  types: {
    Query: { kind: 'object', fields: { order: { type: 'Order', args: { id: { type: 'ID!', required: true } } } } },
    Order: { kind: 'object', fields: { id: { type: 'ID!' }, total: { type: 'Float' } } },
  },
};

describe('a GraphQL operation against the schema it is sent to (P232)', () => {
  it('is an error to select a field the type does not have, named at its line', () => {
    const report = checkContracts(graphWith([{ field: 'order', arguments: ['id'], line: 3, selections: [{ field: 'id', line: 4 }, { field: 'discount', line: 5 }] }], SCHEMA));
    expect(report.findings.map((finding) => [finding.rule, finding.severity, finding.field, finding.direction])).toEqual([['graphql-field-unknown', 'error', 'order.discount', 'response']]);
    expect(report.findings[0]?.message).toContain('src/a.ts:5');
    expect(report.summary.errors).toBe(1);
  });

  it('names a field a fragment in another file selects at its line there', () => {
    const report = checkContracts(graphWith([{ field: 'order', arguments: ['id'], line: 3, selections: [{ field: 'discount', file: 'src/fragments.ts', line: 7 }] }], SCHEMA));
    expect(report.findings[0]?.message).toContain('src/fragments.ts:7');
  });

  it('is an error to leave out an argument the field requires, or to hand it one it does not take', () => {
    const report = checkContracts(graphWith([{ field: 'order', arguments: ['first'], line: 3, selections: [{ field: 'id', line: 4 }] }], SCHEMA));
    expect(report.findings.map((finding) => [finding.rule, finding.field, finding.kind]).sort()).toEqual([
      ['graphql-arg-required', 'order(id)', 'missing_required'],
      ['graphql-arg-unknown', 'order(first)', 'extra_field'],
    ]);
  });

  it('says nothing of an operation the schema answers, and does not check it again as a typed body', () => {
    const report = checkContracts(graphWith([{ field: 'order', arguments: ['id'], line: 3, selections: [{ field: 'id', line: 4 }, { field: 'total', line: 5 }] }], SCHEMA));
    expect(report.findings).toEqual([]);
    expect(report.unchecked).toEqual([]);
  });

  it('finds the field the fixture selects and its schema does not have', () => {
    const graph = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'graphql-gateway', 'expected.project-graph.json'), 'utf8')) as ProjectGraph;
    const report = checkContracts(graph);
    expect(report.findings.map((finding) => [finding.rule, finding.field, finding.receiver.service])).toEqual([['graphql-field-unknown', 'order.discount', 'web']]);
  });
});

describe('an operation sent through a federation gateway (P241)', () => {
  const COMPOSED = {
    roots: { query: 'Query' },
    types: {
      Query: { kind: 'object', fields: { customer: { type: 'Customer' } } },
      Customer: { kind: 'object', fields: { name: { type: 'String!' }, note: { type: 'String', federation: { inaccessible: true } } } },
    },
  };
  const GATEWAY = { gateway: { subgraphs: [] } };

  it('is an error to select a field no subgraph of the composition has, said of the gateway', () => {
    const report = checkContracts(graphWith([{ field: 'customer', line: 3, selections: [{ field: 'discount', line: 4 }] }], COMPOSED, GATEWAY));
    expect(report.findings.map((finding) => finding.rule)).toEqual(['graphql-field-unknown']);
    expect(report.findings[0]?.message).toContain('no subgraph orders composes has Customer.discount');
  });

  it('is an error of its own to select a field the composition hides', () => {
    const report = checkContracts(graphWith([{ field: 'customer', line: 3, selections: [{ field: 'name', line: 4 }, { field: 'note', line: 5 }] }], COMPOSED, GATEWAY));
    expect(report.findings.map((finding) => [finding.rule, finding.severity, finding.field])).toEqual([['graphql-field-inaccessible', 'error', 'customer.note']]);
    expect(report.findings[0]?.message).toContain('src/a.ts:5');
  });

  it('compares nothing on the gateway\'s own route to a subgraph', () => {
    const graph = graphWith([], COMPOSED, GATEWAY);
    const route = { id: 'entry:customers:http:POST:/graphql', type: 'entry', label: 'POST /graphql', repo: 'customers', kind: 'http', meta: { method: 'POST', path: '/graphql', graphql: { endpoint: true, schema: COMPOSED } } };
    const routed = { ...graph, nodes: [...graph.nodes, route], edges: [...graph.edges, { from: 'entry:orders:http:POST:/graphql', to: route.id, type: 'http_calls', confidence: 'static' }] } as unknown as ProjectGraph;
    expect(checkContracts(routed).findings).toEqual([]);
  });
});
