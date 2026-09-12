import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  type ProjectGraph,
  type TypeEntry,
} from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import type { LinkReport } from '../report.js';
import { openGraphDb, type GraphDb } from './reader.js';
import { writeGraphDb } from './writer.js';

const FIXED = '2026-01-01T00:00:00.000Z';
const dir = mkdtempSync(join(tmpdir(), 'flowatlas-db-'));

afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id,
  type: 'method',
  label: id,
  repo: 'orders',
  ...over,
});

const edge = (from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({
  from,
  to,
  type: 'calls',
  confidence: 'static',
  ...over,
});

const type = (): TypeEntry => ({
  name: 'OrderDto',
  kind: 'object',
  declaredIn: 'src/dto.ts',
  structuralHash: 'aaa',
  fields: [{ name: 'id', type: 'string', optional: false }],
  meta: { exported: true },
});

const report = (over: Partial<LinkReport> = {}): LinkReport => ({
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  configHash: 'abc123',
  services: [],
  httpOut: {
    total: 0,
    linked: 0,
    byMarker: 0,
    unknownEnv: 0,
    noRoute: 0,
    ambiguous: 0,
    external: 0,
    dynamic: 0,
  },
  ui: { total: 0, resolved: 0, unresolved: 0, byReason: {} },
  channels: { total: 0, linked: 0, noConsumers: [], noProducers: [] },
  routes: { total: 0, called: 0, uncalled: [], duplicated: [] },
  types: { total: 0, sharedPackage: 0 },
  unresolved: [],
  totals: { nodes: 0, edges: 0, types: 0, unresolved: 0 },
  ...over,
});

const project = (over: Partial<ProjectGraph> = {}): ProjectGraph => ({
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  services: [{ name: 'orders', repo: './orders', type: 'nestjs', extractor: '@flowatlas/extractor-nestjs' }],
  nodes: [],
  edges: [],
  types: {},
  unresolved: [],
  ...over,
});

/** Writes a graph to its own file and opens it. */
let opened = 0;
const built = (graph: ProjectGraph, linkReport = report()): GraphDb => {
  opened += 1;
  const path = join(dir, `graph-${opened}.db`);
  writeGraphDb(graph, linkReport, path, { flowatlasVersion: '1.2.3' });
  return openGraphDb(path);
};

/** a → b → d and a → c → d, so d is reachable two ways. */
const diamond = (): ProjectGraph =>
  project({
    nodes: [node('a'), node('b'), node('c'), node('d')],
    edges: [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
  });

describe('writing and reading back', () => {
  it('returns what it was given', () => {
    const graph = project({
      nodes: [
        node('entry:orders:http:GET:/orders', {
          type: 'entry',
          kind: 'http',
          label: 'GET /orders',
          file: 'src/orders.controller.ts',
          line: 12,
          meta: { method: 'GET', path: '/orders' },
        }),
        node('orders#src/orders.service.ts:OrdersService.findAll'),
      ],
      edges: [
        edge('entry:orders:http:GET:/orders', 'orders#src/orders.service.ts:OrdersService.findAll', {
          type: 'handles',
          params: ['type:orders#OrderDto'],
          returns: 'type:orders#OrderDto',
          meta: { via: 'baseUrlEnv' },
        }),
      ],
      types: { 'type:orders#OrderDto': type() },
      unresolved: [
        { service: 'orders', file: 'src/a.ts', line: 3, reason: 'dynamic-channel-name', message: 'built at run time' },
      ],
    });
    const db = built(graph);

    expect(db.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(db.counts()).toEqual({ nodes: 2, edges: 1, types: 1, unresolved: 1 });
    expect(db.node('entry:orders:http:GET:/orders')).toEqual(graph.nodes[0]);
    expect(db.edgesFrom('entry:orders:http:GET:/orders')).toEqual(graph.edges);
    expect(db.type('type:orders#OrderDto')).toEqual({ id: 'type:orders#OrderDto', ...type() });
    expect(db.services()).toEqual(graph.services);
    db.close();
  });

  it('keeps the values a set of them allows', () => {
    const graph = project({
      types: {
        'type:orders#Status': {
          name: 'Status',
          kind: 'enum',
          declaredIn: 'src/status.ts',
          structuralHash: 'bbb',
          members: ['created', 'paid'],
        },
      },
    });
    const db = built(graph);
    expect(db.type('type:orders#Status')?.members).toEqual(['created', 'paid']);
    db.close();
  });

  it('hands back the report it stored', () => {
    const stored = report({ routes: { total: 3, called: 1, uncalled: ['x'], duplicated: ['y'] } });
    const db = built(project(), stored);
    expect(db.report()).toEqual(stored);
    db.close();
  });

  it('finds nodes by what they are and by what they are called', () => {
    const db = built(
      project({
        nodes: [
          node('entry:orders:http:GET:/orders', { type: 'entry', kind: 'http', label: 'GET /orders' }),
          node('entry:orders:message:order.created', { type: 'entry', kind: 'message', label: 'order.created' }),
          node('orders#svc', { label: 'OrdersService.findAll' }),
        ],
      }),
    );

    expect(db.nodesByType('entry').map((item) => item.id)).toHaveLength(2);
    expect(db.nodesByType('entry', 'http').map((item) => item.id)).toEqual([
      'entry:orders:http:GET:/orders',
    ]);
    expect(db.search('findAll').map((item) => item.id)).toEqual(['orders#svc']);
    expect(db.search('order', { types: ['method'] }).map((item) => item.id)).toEqual(['orders#svc']);
    db.close();
  });

  it('replaces an earlier database rather than adding to it', () => {
    const path = join(dir, 'rebuilt.db');
    writeGraphDb(project({ nodes: [node('a'), node('b')] }), report(), path);
    writeGraphDb(project({ nodes: [node('a')] }), report(), path);
    const db = openGraphDb(path);
    expect(db.counts().nodes).toBe(1);
    db.close();
  });
});

describe('walking the graph', () => {
  it('goes as deep as it is allowed and no deeper', () => {
    const db = built(
      project({
        nodes: [node('a'), node('b'), node('c')],
        edges: [edge('a', 'b'), edge('b', 'c')],
      }),
    );

    expect(db.traverse({ from: 'a', maxDepth: 1 }).rows.map((row) => row.id)).toEqual(['a', 'b']);
    expect(db.traverse({ from: 'a', maxDepth: 2 }).rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    db.close();
  });

  it('walks backward when asked', () => {
    const db = built(
      project({ nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'b'), edge('b', 'c')] }),
    );
    expect(db.traverse({ from: 'c', direction: 'in', maxDepth: 3 }).rows.map((row) => row.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
    db.close();
  });

  it('stops at a cycle instead of going round it', () => {
    const db = built(
      project({ nodes: [node('a'), node('b')], edges: [edge('a', 'b'), edge('b', 'a')] }),
    );
    const walk = db.traverse({ from: 'a', maxDepth: 10 });
    expect(walk.rows.map((row) => row.id)).toEqual(['a', 'b']);
    db.close();
  });

  it('follows only the kinds of edge it was asked for', () => {
    const db = built(
      project({
        nodes: [node('a'), node('b'), node('c')],
        edges: [edge('a', 'b', { type: 'calls' }), edge('a', 'c', { type: 'emits' })],
      }),
    );
    expect(db.traverse({ from: 'a', edgeTypes: ['calls'] }).rows.map((row) => row.id)).toEqual([
      'a',
      'b',
    ]);
    db.close();
  });

  it('says when it stopped at the limit rather than at the end', () => {
    const db = built(
      project({
        nodes: [node('a'), node('b'), node('c'), node('d')],
        edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')],
      }),
    );
    const capped = db.traverse({ from: 'a', maxNodes: 2 });
    expect(capped.rows).toHaveLength(2);
    expect(capped.truncated).toBe(true);
    expect(db.traverse({ from: 'a', maxNodes: 50 }).truncated).toBe(false);
    db.close();
  });

  it('starts from every node it was given', () => {
    const db = built(
      project({ nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'c'), edge('b', 'c')] }),
    );
    expect(db.traverse({ from: ['a', 'b'] }).rows.filter((row) => row.depth === 0)).toHaveLength(2);
    db.close();
  });

  it('keeps one row per path, so the shape of the walk survives', () => {
    const db = built(diamond());
    const walk = db.traverse({ from: 'a' });
    expect(walk.rows.filter((row) => row.id === 'd')).toHaveLength(2);
    expect(walk.rows.map((row) => row.path)).toContain('a>b>d');
    expect(walk.rows.map((row) => row.path)).toContain('a>c>d');
    db.close();
  });
});

describe('asking what reaches what', () => {
  it('names each node once however many ways there are to it', () => {
    const db = built(diamond());
    expect(db.forwardReach('a').rows.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(db.reverseReach('d').rows.map((row) => row.id)).toEqual(['d', 'b', 'c', 'a']);
    db.close();
  });

  it('keeps the shallowest sighting of a node two distances away', () => {
    const db = built(
      project({
        nodes: [node('a'), node('b'), node('c')],
        edges: [edge('a', 'c'), edge('a', 'b'), edge('b', 'c')],
      }),
    );
    expect(db.forwardReach('a').rows.find((row) => row.id === 'c')?.depth).toBe(1);
    db.close();
  });
});
