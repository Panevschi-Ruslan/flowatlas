import {
  SCHEMA_VERSION,
  parseConfig,
  type FlowatlasConfig,
  type GraphNode,
  type RepoGraph,
} from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';

const FIXED = '2026-01-01T00:00:00.000Z';

const config = (apiTarget?: Record<string, string>): FlowatlasConfig =>
  parseConfig({
    services: [
      { name: 'api', repo: './api', type: 'nextjs' },
      { name: 'admin', repo: './admin', type: 'nextjs' },
      { name: 'web', repo: './web', type: 'react', ...(apiTarget === undefined ? {} : { apiTarget }) },
    ],
  } as Parameters<typeof parseConfig>[0]);

const graph = (repo: string, nodes: GraphNode[]): RepoGraph => ({
  schemaVersion: SCHEMA_VERSION,
  repo,
  generatedAt: FIXED,
  nodes,
  edges: [],
  types: {},
  unresolved: [],
});

const procedure = (repo: string, key: string, call = 'query'): GraphNode => ({
  id: `entry:${repo}:rpc:${key}`,
  type: 'entry',
  kind: 'rpc',
  label: `rpc ${key}`,
  repo,
  meta: { key, call },
});

/** A message handler listening on a string that reads like a procedure path. */
const pattern = (repo: string, key: string): GraphNode => ({
  id: `entry:${repo}:rpc:${key}`,
  type: 'entry',
  kind: 'rpc',
  label: `rpc ${key}`,
  repo,
  meta: { pattern: key },
});

const ask = (repo: string, path: string | null, call = 'query'): GraphNode => ({
  id: `ui_api_call:${repo}#src/orders.ts:3:10`,
  type: 'ui_api_call',
  kind: 'rpc',
  label: `rpc ${path ?? '?'}`,
  repo,
  file: 'src/orders.ts',
  line: 3,
  meta: { procedure: path, call, operation: 'useQuery', client: 'described' },
});

const hitsOf = (graphs: RepoGraph[], cfg: FlowatlasConfig) => {
  const { project, report } = linkGraphs(graphs, cfg, { builtAt: FIXED });
  return {
    hits: project.edges.filter((edge) => edge.type === 'hits'),
    reasons: report.unresolved.map((row) => row.reason),
    rows: report.unresolved,
    ui: report.ui,
  };
};

describe('a request for a procedure', () => {
  it('joins the procedure of the same path in its own service', () => {
    const { hits, ui } = hitsOf(
      [graph('api', [procedure('api', 'orders.list'), ask('api', 'orders.list')])],
      config(),
    );
    expect(hits).toMatchObject([
      { to: 'entry:api:rpc:orders.list', confidence: 'static', meta: { via: 'same-service', targetService: 'api' } },
    ]);
    expect(ui).toMatchObject({ total: 1, resolved: 1, unresolved: 0 });
  });

  it('joins a service the configuration says it calls, and no other', () => {
    const graphs = [
      graph('api', [procedure('api', 'orders.list')]),
      graph('admin', [procedure('admin', 'orders.list')]),
      graph('web', [ask('web', 'orders.list')]),
    ];
    const { hits } = hitsOf(graphs, config({ API_URL: 'api' }));
    expect(hits.map((edge) => [edge.to, edge.meta?.['via']])).toEqual([
      ['entry:api:rpc:orders.list', 'api-target'],
    ]);
  });

  it('guesses nothing when the configuration names no service, and says who declares it', () => {
    const graphs = [
      graph('admin', [procedure('admin', 'orders.list')]),
      graph('web', [ask('web', 'orders.list')]),
    ];
    const { hits, rows, ui } = hitsOf(graphs, config());
    expect(hits).toEqual([]);
    expect(rows).toMatchObject([
      {
        reason: 'procedure-not-found',
        message: 'no procedure orders.list in web',
        hint: expect.stringContaining('admin declares it'),
      },
    ]);
    expect(ui.byReason).toEqual({ 'procedure-not-found': 1 });
  });

  it('never joins a message handler listening on the same string', () => {
    const { hits, reasons } = hitsOf(
      [graph('api', [pattern('api', 'orders.list'), ask('api', 'orders.list')])],
      config(),
    );
    expect(hits).toEqual([]);
    expect(reasons).toEqual(['procedure-not-found']);
  });

  it('joins, and says so, when the call asks for another ending than the one declared', () => {
    const { hits, rows } = hitsOf(
      [graph('api', [procedure('api', 'orders.list', 'query'), ask('api', 'orders.list', 'mutation')])],
      config(),
    );
    expect(hits).toHaveLength(1);
    expect(rows).toMatchObject([
      { reason: 'procedure-call-mismatch', message: 'orders.list is asked for as a mutation and declared as a query' },
    ]);
  });

  it('names both when two configured services declare it', () => {
    const graphs = [
      graph('api', [procedure('api', 'orders.list')]),
      graph('admin', [procedure('admin', 'orders.list')]),
      graph('web', [ask('web', 'orders.list')]),
    ];
    const { hits, rows } = hitsOf(graphs, config({ API_URL: 'api', ADMIN_URL: 'admin' }));
    expect(hits).toEqual([]);
    expect(rows).toMatchObject([{ reason: 'procedure-ambiguous', message: 'admin and api both declare orders.list' }]);
  });

  it('counts a path that was not read, without saying it twice', () => {
    const { hits, rows, ui } = hitsOf([graph('api', [procedure('api', 'orders.list'), ask('api', null)])], config());
    expect(hits).toEqual([]);
    expect(rows).toEqual([]);
    expect(ui.byReason).toEqual({ 'procedure-path-dynamic': 1 });
  });
});
