import { describe, expect, it } from 'vitest';
import { countsOf, type Unresolved } from './graph.js';

const row = (over: Partial<Unresolved>): Unresolved => ({ file: 'src/a.ts', line: 1, reason: 'type-unresolved', ...over });

describe('the one counter', () => {
  it('counts a mix of every kind into five numbers that are never added together', () => {
    const rows: Unresolved[] = [
      // Gaps: one actionable, one folded over forty places, one at nothing.
      row({ reason: 'dynamic-http-url' }),
      row({ reason: 'call-dynamic-receiver', level: 'info', sites: 40 }),
      row({ reason: 'handler-not-a-method', level: 'nothing', sites: 12 }),
      row({ reason: 'handler-not-a-method', level: 'nothing' }),
      // Notes: joins made from files, a package read from its source.
      row({ reason: 'base-url-from-files', level: 'info' }),
      row({ reason: 'package-from-repo', level: 'info' }),
      // Findings: one at info with its own sites, one actionable.
      row({ reason: 'query-in-loop', level: 'info', sites: 1 }),
      row({ reason: 'route-unguarded' }),
    ];
    expect(countsOf(rows)).toEqual({ missed: 2, sites: 41, notes: 2, findings: 2, nothing: 13 });
  });

  it('counts nothing in an empty list', () => {
    expect(countsOf([])).toEqual({ missed: 0, sites: 0, notes: 0, findings: 0, nothing: 0 });
  });

  // A database built before kinds existed stored `query-in-loop` at `nothing`;
  // it is still a finding, and still not a place with nothing to join.
  it('counts a finding by its kind whatever level an older build gave it', () => {
    expect(countsOf([row({ reason: 'query-in-loop', level: 'nothing', sites: 1 })])).toEqual({
      missed: 0,
      sites: 0,
      notes: 0,
      findings: 1,
      nothing: 0,
    });
  });

  it('reads stored rows, where level and sites are always set', () => {
    const stored = [
      { reason: 'type-unresolved', level: 'info' as const, sites: 3, meta: undefined },
      { reason: 'query-in-loop', level: 'info' as const, sites: 1, meta: { severity: 'note' } },
    ];
    expect(countsOf(stored)).toEqual({ missed: 1, sites: 3, notes: 1, findings: 0, nothing: 0 });
  });
});
