import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  SCHEMA_VERSION,
  type GraphNode,
  type ProjectGraph,
  type RepoGraph,
} from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import type { LinkReport } from '../report.js';
import { openGraphDb } from './reader.js';
import { replaceService, writeGraphDb } from './writer.js';

const FIXED = '2026-01-01T00:00:00.000Z';
const dir = mkdtempSync(join(tmpdir(), 'flowatlas-store-'));

afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id,
  type: 'method',
  label: id,
  repo: 'orders',
  ...over,
});

const report: LinkReport = {
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
};

const channel: GraphNode = {
  id: 'channel:order.created',
  type: 'channel',
  label: 'order.created',
  repo: 'orders',
};

const project = (): ProjectGraph => ({
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  services: [],
  nodes: [node('orders#a.ts:One'), node('orders#b.ts:Two'), node('billing#c.ts:Three', { repo: 'billing' }), channel],
  edges: [
    { from: 'orders#a.ts:One', to: 'orders#b.ts:Two', type: 'calls', confidence: 'static' },
    { from: 'orders#b.ts:Two', to: 'channel:order.created', type: 'emits', confidence: 'static' },
    { from: 'billing#c.ts:Three', to: 'channel:order.created', type: 'consumes', confidence: 'static' },
  ],
  types: {
    'type:orders#OrderDto': {
      name: 'OrderDto',
      kind: 'object',
      declaredIn: 'orders#src/dto.ts',
      structuralHash: 'aaa',
      fields: [],
    },
  },
  unresolved: [{ service: 'orders', file: 'src/a.ts', line: 1, reason: 'call-dynamic-receiver' }],
});

const repoGraph = (nodes: GraphNode[], over: Partial<RepoGraph> = {}): RepoGraph => ({
  schemaVersion: SCHEMA_VERSION,
  repo: 'orders',
  generatedAt: FIXED,
  nodes,
  edges: [],
  types: {},
  unresolved: [],
  ...over,
});

const dbAt = (name: string): string => {
  const path = join(dir, `${name}.db`);
  writeGraphDb(project(), report, path);
  return path;
};

describe('replacing one repository in a database that is already there', () => {
  it('takes out what that repository owned and puts back what it owns now', () => {
    const path = dbAt('replace');
    const db = new Database(path);
    replaceService(db, 'orders', repoGraph([node('orders#a.ts:Renamed')]));
    db.close();

    const reader = openGraphDb(path);
    expect(reader.nodesByType('method').map((item) => item.id).sort()).toEqual([
      'billing#c.ts:Three',
      'orders#a.ts:Renamed',
    ]);
    expect(reader.unresolved({ service: 'orders' })).toEqual([]);
    reader.close();
  });

  it('leaves what belongs to the whole project alone', () => {
    const path = dbAt('shared');
    const db = new Database(path);
    replaceService(db, 'orders', repoGraph([node('orders#a.ts:Renamed')]));
    db.close();

    const reader = openGraphDb(path);
    expect(reader.node('channel:order.created')).toBeDefined();
    // The edge the other repository owns still points at it.
    expect(reader.edgesTo('channel:order.created').map((item) => item.from)).toEqual([
      'billing#c.ts:Three',
    ]);
    reader.close();
  });

  it('leaves the previous rows in place when a replacement cannot be finished', () => {
    const path = dbAt('rollback');
    const db = new Database(path);
    const twice = repoGraph([node('orders#a.ts:One'), node('orders#a.ts:One')]);
    expect(() => replaceService(db, 'orders', twice)).toThrow();
    db.close();

    const reader = openGraphDb(path);
    expect(reader.nodesByType('method').map((item) => item.id).sort()).toEqual([
      'billing#c.ts:Three',
      'orders#a.ts:One',
      'orders#b.ts:Two',
    ]);
    reader.close();
  });
});

describe('writing the database over one a reader may be holding', () => {
  it('never leaves a half-written file where the finished one belongs', () => {
    const path = dbAt('atomic');
    const before = openGraphDb(path);
    expect(before.counts().nodes).toBe(4);

    const next = project();
    next.nodes = [node('orders#a.ts:One')];
    next.edges = [];
    writeGraphDb(next, report, path);

    // The reader that was already open still answers, from the file it opened.
    expect(before.counts().nodes).toBe(4);
    before.close();

    const after = openGraphDb(path);
    expect(after.counts().nodes).toBe(1);
    after.close();
  });

  it('leaves nothing behind that a later run would have to clean up', () => {
    const path = dbAt('leftovers');
    expect(existsSync(`${path}.building`)).toBe(false);
    expect(readdirSync(dir).filter((name) => name.endsWith('.building'))).toEqual([]);
  });
});
