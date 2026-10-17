import type { GraphNode } from '@flowatlas/core';
import type { AnchoredUnresolvedRow } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { summariseProject } from './start.js';

const row = (over: Partial<AnchoredUnresolvedRow>): AnchoredUnresolvedRow => ({
  service: 'orders',
  file: 'src/orders.service.ts',
  line: 1,
  reason: 'dynamic-http-url',
  level: 'action',
  sites: 1,
  message: 'an address built at run time',
  hint: null,
  node: null,
  ...over,
});

const nodes: GraphNode[] = [
  { id: 'entry:orders:http:GET:/orders', type: 'entry', kind: 'http', label: 'GET /orders', repo: 'orders' },
  { id: 'entry:billing:http:GET:/bills', type: 'entry', kind: 'http', label: 'GET /bills', repo: 'billing' },
];

const rows = [
  row({}),
  row({ reason: 'call-dynamic-receiver', level: 'info', sites: 7, line: 2 }),
  row({ reason: 'handler-not-a-method', level: 'nothing', sites: 4, line: 3 }),
  row({ reason: 'base-url-from-files', level: 'info', sites: 2, line: 4 }),
  row({ reason: 'query-in-loop', level: 'info', line: 5 }),
  row({ reason: 'route-unguarded', line: 6 }),
  row({ service: 'billing', reason: 'route-unguarded', line: 7 }),
];

describe('the first answer of a session, counted by kind (P81)', () => {
  it('counts gaps, notes and findings the way the build line does', () => {
    const summary = summariseProject({ nodes, channelEnds: new Map(), unresolved: rows });
    expect(summary.counts).toEqual({ gaps: 2, sites: 8, notes: 1, findings: 3, nothing: 4 });
  });

  it('lists only gaps among the top gaps, and counts only them per service', () => {
    const summary = summariseProject({ nodes, channelEnds: new Map(), unresolved: rows });
    expect(summary.topGaps.map((gap) => gap.reason)).toEqual(['dynamic-http-url']);
    expect(summary.services.map((service) => [service.service, service.gaps])).toEqual([
      ['billing', 0],
      ['orders', 1],
    ]);
  });

  it('counts one service when asked about one', () => {
    const summary = summariseProject({ nodes, channelEnds: new Map(), unresolved: rows, service: 'billing' });
    expect(summary.counts).toEqual({ gaps: 0, sites: 0, notes: 0, findings: 1, nothing: 0 });
  });
});
