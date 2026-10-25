import type { AcceptedGap, GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { ANSWERED_HINT } from '../answered.js';
import { acceptedSplitOf } from './accepted-split.js';
import type { AnchoredUnresolvedRow } from './reader.js';

const AT = '2026-01-01T00:00:00.000Z';

const METHOD: GraphNode = {
  id: 'orders#src/orders.service.ts:OrdersService.place',
  type: 'method',
  label: 'OrdersService.place',
  repo: 'orders',
  file: 'src/orders.service.ts',
  line: 4,
};
const PRODUCER: GraphNode = { id: 'producer:orders:1', type: 'producer', label: 'emit', repo: 'orders' };
const CHANNEL: GraphNode = { id: 'channel:order.placed', type: 'channel', label: 'order.placed', repo: 'orders' };
const NODES = [METHOD, PRODUCER, CHANNEL];
const EDGES: GraphEdge[] = [
  { from: METHOD.id, to: PRODUCER.id, type: 'calls', confidence: 'marker' },
  { from: PRODUCER.id, to: CHANNEL.id, type: 'emits', confidence: 'marker' },
];

/** What the database keeps of each row: its node, never its symbol. */
const STORED: AnchoredUnresolvedRow[] = [
  {
    service: 'orders',
    file: 'src/orders.service.ts',
    line: 6,
    reason: 'channel-dynamic',
    level: 'action',
    sites: 1,
    message: 'the channel is built at run time',
    hint: null,
    node: 'OrdersService.place',
  },
  {
    service: 'inventory',
    file: 'src/levels.controller.ts',
    line: 15,
    reason: 'route-unguarded',
    level: 'action',
    sites: 1,
    message: 'GET /levels/summary has no guard',
    hint: null,
    node: 'GET /levels/summary',
  },
  {
    service: 'inventory',
    file: 'src/stock.controller.ts',
    line: 9,
    reason: 'route-unguarded',
    level: 'action',
    sites: 1,
    message: 'GET /stock has no guard',
    hint: null,
    node: 'GET /stock',
  },
];

const db = {
  node: (id: string) => NODES.find((node) => node.id === id),
  nodesByType: (type: string) => NODES.filter((node) => node.type === type),
  allNodes: () => NODES,
  edgesFrom: (id: string, types?: readonly string[]) =>
    EDGES.filter((edge) => edge.from === id && (types === undefined || types.includes(edge.type))),
  edgesTo: (id: string, types?: readonly string[]) =>
    EDGES.filter((edge) => edge.to === id && (types === undefined || types.includes(edge.type))),
  allUnresolved: () => STORED,
} as unknown as Parameters<typeof acceptedSplitOf>[0];

const RULE: AcceptedGap = { reason: 'route-unguarded', service: 'inventory', path: 'GET /levels/*', note: 'published', acceptedAt: AT };

/** The rows three ways: as the graph file writes them, as the database keeps them, and with neither. */
const asWritten = STORED.map(({ node, ...row }) => ({ ...row, file: row.file ?? '', line: row.line ?? 0, symbol: node ?? undefined }));
const asStored = STORED;
const bare = STORED.map(({ node: _node, ...row }) => ({ ...row, file: row.file ?? '', line: row.line ?? 0 }));

describe('acceptedSplitOf', () => {
  it.each([
    ['as the graph file writes them', asWritten],
    ['as the database keeps them', asStored],
    ['with neither symbol nor node', bare],
  ])('demotes, matches on the route and splits the same way, rows %s', (_name, rows) => {
    const split = acceptedSplitOf(db, rows as ReadonlyArray<(typeof rows)[number]>, { gaps: [RULE] });
    expect(split.rows.map((row) => row.level)).toEqual(['info', 'action', 'action']);
    expect(split.rows[0]?.hint).toBe(ANSWERED_HINT);
    expect(split.fresh.map((row) => row.message)).toEqual(['the channel is built at run time', 'GET /stock has no guard']);
    expect(split.accepted.map((row) => row.message)).toEqual(['GET /levels/summary has no guard']);
    expect(split.byEntry).toEqual([undefined, RULE, undefined]);
    expect(split.problem).toBeUndefined();
  });

  it('leaves the rows themselves as they were read, so the baseline keys made of them do not move', () => {
    const split = acceptedSplitOf(db, bare, { gaps: [RULE] });
    expect(split.accepted[0]).not.toHaveProperty('symbol');
    expect(split.rows[1]).toBe(bare[1]);
  });

  it('accepts nothing from a file that could not be read, and hands its problem back', () => {
    const problem = { path: '/p/accepted.json', kind: 'unparseable' as const, detail: 'Unexpected token' };
    const split = acceptedSplitOf(db, asStored, { gaps: [], problem });
    expect(split.accepted).toEqual([]);
    expect(split.fresh).toHaveLength(3);
    expect(split.problem).toBe(problem);
    // Demotion does not depend on the file.
    expect(split.rows[0]?.level).toBe('info');
  });
});
