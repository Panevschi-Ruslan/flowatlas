import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  type ProjectGraph,
  type TypeRegistry,
  type Unresolved,
} from '@flowatlas/core';
import { openGraphDb, writeGraphDb, type GraphDb } from '@flowatlas/linker';
import type { LinkReport } from '@flowatlas/linker';

const FIXED = '2026-01-01T00:00:00.000Z';

let written = 0;

export const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id,
  type: 'method',
  label: id,
  repo: 'orders',
  ...over,
});

export const edge = (from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({
  from,
  to,
  type: 'calls',
  confidence: 'static',
  ...over,
});

export const entry = (id: string, over: Partial<GraphNode> = {}): GraphNode =>
  node(id, { type: 'entry', kind: 'http', ...over });

const emptyReport = (): LinkReport => ({
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  configHash: 'test',
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
});

export interface TestGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  types?: TypeRegistry;
  unresolved?: Unresolved[];
}

const directory = mkdtempSync(join(tmpdir(), 'flowatlas-mcp-'));

/**
 * A real database built from a handful of nodes.
 *
 * Written and read the way the tool does it rather than faked, so a query that
 * passes here is a query that works.
 */
export const buildTestDb = (graph: TestGraph): GraphDb => {
  written += 1;
  const path = join(directory, `graph-${written}.db`);
  const project: ProjectGraph = {
    schemaVersion: SCHEMA_VERSION,
    builtAt: FIXED,
    services: [{ name: 'orders', repo: './orders', type: 'nestjs', extractor: null }],
    nodes: graph.nodes,
    edges: graph.edges,
    types: graph.types ?? {},
    unresolved: graph.unresolved ?? [],
  };
  writeGraphDb(project, emptyReport(), path);
  return openGraphDb(path);
};

export const testDbDirectory = directory;
