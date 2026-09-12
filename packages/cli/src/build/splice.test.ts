import {
  DanglingEdgeError,
  GraphBuilder,
  SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  type RepoGraph,
  type TypeEntry,
} from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { spliceRepoGraph } from './splice.js';

const REPO = 'orders';
const AT = '2026-01-01T00:00:00.000Z';

const method = (file: string, name: string): GraphNode => ({
  id: `${REPO}#${file}:${name}`,
  type: 'method',
  label: name,
  repo: REPO,
  file,
});

const calls = (from: GraphNode, to: GraphNode, file: string): GraphEdge => ({
  from: from.id,
  to: to.id,
  type: 'calls',
  confidence: 'static',
  file,
});

const dto = (file: string): TypeEntry => ({
  name: 'OrderDto',
  kind: 'object',
  declaredIn: `${REPO}#${file}`,
  structuralHash: 'abc',
  fields: [],
});

const graphOf = (parts: {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  types?: Record<string, TypeEntry>;
  unresolved?: RepoGraph['unresolved'];
}): RepoGraph => ({
  schemaVersion: SCHEMA_VERSION,
  repo: REPO,
  generatedAt: AT,
  nodes: parts.nodes ?? [],
  edges: parts.edges ?? [],
  types: parts.types ?? {},
  unresolved: parts.unresolved ?? [],
});

const SERVICE = 'src/orders/orders.service.ts';
const CONTROLLER = 'src/orders/orders.controller.ts';

const service = method(SERVICE, 'OrdersService.findOne');
const handler = method(CONTROLLER, 'OrdersController.findOne');
const table: GraphNode = { id: `table:${REPO}#Order`, type: 'table', label: 'Order', repo: REPO };

const previous = graphOf({
  nodes: [handler, service, table],
  edges: [
    calls(handler, service, CONTROLLER),
    { from: service.id, to: table.id, type: 'queries', confidence: 'static', file: SERVICE },
  ],
  types: { [`type:${REPO}#OrderDto`]: dto(SERVICE) },
  unresolved: [{ file: SERVICE, line: 3, reason: 'call-dynamic-receiver' }],
});

describe('splicing a fragment onto the graph of the last build', () => {
  it('replaces only what the re-read files owned', () => {
    const spliced = spliceRepoGraph(
      previous,
      [SERVICE],
      graphOf({
        nodes: [{ ...service, line: 42 }, table],
        edges: [
          { from: service.id, to: table.id, type: 'queries', confidence: 'static', file: SERVICE },
        ],
      }),
    );

    expect(spliced.nodes.map((node) => node.id)).toEqual([handler.id, service.id, table.id].sort());
    expect(spliced.nodes.find((node) => node.id === service.id)?.line).toBe(42);
    // The controller was not re-read, so the edge it owns is still there.
    expect(spliced.edges.map((edge) => `${edge.from} ${edge.type}`)).toContain(
      `${handler.id} calls`,
    );
    // The service was, so what it used to own and no longer declares is gone.
    expect(spliced.types).toEqual({});
    expect(spliced.unresolved).toEqual([]);
  });

  it('refuses a re-read that leaves a caller pointing at a method that is gone', () => {
    const renamed = method(SERVICE, 'OrdersService.findById');
    expect(() =>
      spliceRepoGraph(previous, [SERVICE], graphOf({ nodes: [renamed, table] })),
    ).toThrow(DanglingEdgeError);
  });

  it('keeps what a file that was not re-read still owns', () => {
    const spliced = spliceRepoGraph(
      previous,
      [SERVICE],
      graphOf({ nodes: [service, table], edges: [] }),
    );
    expect(spliced.nodes.map((node) => node.id)).toContain(handler.id);
    expect(spliced.edges.map((edge) => edge.from)).toEqual([handler.id]);
  });

  it('keeps a node no file declares while an edge still points at it', () => {
    const spliced = spliceRepoGraph(
      previous,
      [CONTROLLER],
      graphOf({ nodes: [handler], edges: [calls(handler, service, CONTROLLER)] }),
    );
    expect(spliced.nodes.map((node) => node.id)).toContain(table.id);
  });

  it('drops a node no file declares once nothing points at it any more', () => {
    const spliced = spliceRepoGraph(
      previous,
      [SERVICE],
      graphOf({ nodes: [service], edges: [] }),
    );
    expect(spliced.nodes.map((node) => node.id)).not.toContain(table.id);
  });

  it('comes out in the order a full build would have written', () => {
    const builder = new GraphBuilder({ repo: REPO, generatedAt: AT });
    for (const node of [table, service, handler]) builder.addNode(node);
    builder.addEdge(calls(handler, service, CONTROLLER));
    builder.addEdge({
      from: service.id,
      to: table.id,
      type: 'queries',
      confidence: 'static',
      file: SERVICE,
    });
    builder.addType(`type:${REPO}#OrderDto`, dto(SERVICE));
    builder.addUnresolved({ file: SERVICE, line: 3, reason: 'call-dynamic-receiver' });

    const rebuilt = spliceRepoGraph(previous, [], graphOf({}));
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(builder.build()));
  });

  it('refuses a fragment that leaves an edge pointing at nothing', () => {
    const orphaned = graphOf({
      nodes: [],
      edges: [calls(handler, service, CONTROLLER)],
    });
    expect(() => spliceRepoGraph(previous, [CONTROLLER, SERVICE], orphaned)).toThrow(
      DanglingEdgeError,
    );
  });

  it('drops a type declared in a file that was re-read and no longer declares it', () => {
    const spliced = spliceRepoGraph(previous, [SERVICE], graphOf({ nodes: [service] }));
    expect(spliced.types).toEqual({});
  });

  it('keeps a type that came from a shared package, whatever was re-read', () => {
    const shared = graphOf({
      nodes: [service],
      types: { 'type:@fx/contracts#OrderDto': { ...dto(SERVICE), declaredIn: '@fx/contracts' } },
    });
    const withShared = spliceRepoGraph(previous, [], shared);
    const after = spliceRepoGraph(withShared, [SERVICE, CONTROLLER], graphOf({}));
    expect(Object.keys(after.types)).toEqual(['type:@fx/contracts#OrderDto']);
  });
});
