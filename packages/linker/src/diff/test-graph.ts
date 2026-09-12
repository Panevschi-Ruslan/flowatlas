/**
 * Two graphs, built by hand, one revision apart.
 *
 * A diff test that had to run an extractor twice would be a test of the
 * extractor. These build exactly the pair a case is about, so a failure names
 * the classification rule rather than the fixture.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SCHEMA_VERSION,
  structuralHash,
  type GraphEdge,
  type GraphNode,
  type ProjectGraph,
  type TypeEntry,
  type TypeField,
  type TypeRegistry,
  type Unresolved,
} from '@flowatlas/core';
import { openGraphDb, type GraphDb } from '../db/reader.js';
import { writeGraphDb } from '../db/writer.js';
import type { LinkReport } from '../report.js';

const FIXED = '2026-01-01T00:00:00.000Z';

export const node = (
  id: string,
  type: GraphNode['type'] = 'method',
  over: Partial<GraphNode> = {},
): GraphNode => ({ id, type, label: id, repo: 'orders', ...over });

export const edge = (
  from: string,
  to: string,
  over: Partial<GraphEdge> = {},
): GraphEdge => ({ from, to, type: 'calls', confidence: 'static', ...over });

export const field = (name: string, type: string, optional = false): TypeField => ({
  name,
  type,
  optional,
});

/** An object shape with its hash taken the way a real registry takes it. */
export const object = (
  name: string,
  fields: TypeField[],
  registry: TypeRegistry = {},
): TypeEntry => {
  const entry: TypeEntry = {
    name,
    kind: 'object',
    declaredIn: `orders#${name}.ts`,
    structuralHash: '',
    fields,
  };
  return { ...entry, structuralHash: structuralHash(entry, registry) };
};

export interface Parts {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  types?: TypeRegistry;
  unresolved?: Unresolved[];
  services?: ProjectGraph['services'];
}

export const graphOf = (parts: Parts = {}): ProjectGraph => ({
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  services: parts.services ?? [{ name: 'orders', repo: './orders', type: 'nestjs', extractor: null }],
  nodes: parts.nodes ?? [],
  edges: parts.edges ?? [],
  types: parts.types ?? {},
  unresolved: parts.unresolved ?? [],
});

export const emptyReport = (): LinkReport => ({
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

const directory = mkdtempSync(join(tmpdir(), 'flowatlas-diff-'));
let written = 0;

/**
 * A real database built from a handful of nodes.
 *
 * Written and read the way the tool does it rather than mocked, so a walk that
 * works here is one that works against a graph a build produced.
 */
export const openTestDb = (parts: Parts): GraphDb => {
  written += 1;
  const path = join(directory, `graph-${written}.db`);
  writeGraphDb(graphOf(parts), emptyReport(), path);
  return openGraphDb(path);
};
