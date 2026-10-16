import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  acceptedKeyOf,
  covers,
  describeAccepted,
  gapIdOf,
  isRule,
  matchesRoutePattern,
  routeOfSymbol,
  loadAccepted,
  parseGapId,
  saveAccepted,
  splitAccepted,
  withAccepted,
  withoutAccepted,
} from './accepted.js';

const AT = '2026-01-01T00:00:00.000Z';

describe('accepted gaps', () => {
  it('name a gap by service, file and reason, and read the name back', () => {
    const id = gapIdOf({ service: 'orders', file: 'src/a.ts', reason: 'channel-dynamic' });
    expect(id).toBe('gap:orders|src/a.ts|channel-dynamic');
    expect(parseGapId(id)).toEqual({ service: 'orders', file: 'src/a.ts', reason: 'channel-dynamic' });
    expect(parseGapId('gap:||')).toBeUndefined();
    expect(parseGapId('channel-dynamic')).toBeUndefined();
  });

  it('cover a reason everywhere, or only where they say', () => {
    const gap = { service: 'orders', file: 'src/a.ts', reason: 'r' };
    expect(covers({ reason: 'r' }, gap)).toBe(true);
    expect(covers({ reason: 'r', service: 'billing' }, gap)).toBe(false);
    expect(covers({ reason: 'r', service: 'orders', file: 'src/b.ts' }, gap)).toBe(false);
    expect(covers({ reason: 'other' }, gap)).toBe(false);
  });

  it('split gaps into new and accepted, order kept', () => {
    const rows = [{ reason: 'a' }, { reason: 'b' }, { reason: 'a', service: 's' }];
    const split = splitAccepted([{ reason: 'a', note: '', acceptedAt: AT }], rows);
    expect(split.fresh).toEqual([{ reason: 'b' }]);
    expect(split.accepted).toHaveLength(2);
  });

  it('round-trip through the file, sorted, one entry per target', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'flowatlas-accepted-')), 'graph.db');
    expect(loadAccepted(dbPath)).toEqual([]);
    let gaps = withAccepted([], { reason: 'z', note: 'one', acceptedAt: AT });
    gaps = withAccepted(gaps, { reason: 'a', service: 's', note: '', acceptedAt: AT });
    gaps = withAccepted(gaps, { reason: 'z', note: 'two', acceptedAt: AT });
    saveAccepted(dbPath, gaps);
    const read = loadAccepted(dbPath);
    expect(read.map((gap) => gap.reason)).toEqual(['a', 'z']);
    expect(read[1]?.note).toBe('two');
    expect(withoutAccepted(read, { reason: 'z' })).toHaveLength(1);
  });

  it('accept every route a pattern names, by method or for all of them, and nothing that is not a route', () => {
    const route = (symbol: string) => ({ service: 'inventory', file: 'src/levels.controller.ts', reason: 'route-unguarded', symbol });
    const rule = { reason: 'route-unguarded', service: 'inventory', path: 'GET /levels/*' };
    expect(covers(rule, route('GET /levels/summary'))).toBe(true);
    expect(covers(rule, route('GET /levels/:param/low'))).toBe(true);
    expect(covers(rule, route('POST /levels/summary'))).toBe(false);
    expect(covers(rule, route('GET /stock'))).toBe(false);
    expect(covers({ ...rule, path: '/levels/*' }, route('POST /levels/summary'))).toBe(true);
    // A row read back from the database keeps its symbol as `node`.
    expect(covers(rule, { reason: 'route-unguarded', service: 'inventory', node: 'GET /levels/low' })).toBe(true);
    expect(covers(rule, { reason: 'route-unguarded', service: 'inventory', symbol: 'LevelsController.low' })).toBe(false);
  });

  it('accept every file a glob names: * within a segment, ** across them', () => {
    const gap = (file: string) => ({ reason: 'r', file });
    expect(covers({ reason: 'r', file: 'src/public/**' }, gap('src/public/a/b.ts'))).toBe(true);
    expect(covers({ reason: 'r', file: 'src/public/*.ts' }, gap('src/public/a.ts'))).toBe(true);
    expect(covers({ reason: 'r', file: 'src/public/*.ts' }, gap('src/public/a/b.ts'))).toBe(false);
    expect(covers({ reason: 'r', file: 'src/public/**' }, { reason: 'r' })).toBe(false);
  });

  it('tell a rule from one place, and say a rule in a line', () => {
    expect(isRule({ reason: 'r', service: 's', file: 'src/a.ts' })).toBe(false);
    expect(isRule({ reason: 'r', service: 's' })).toBe(true);
    expect(isRule({ reason: 'r', file: 'src/**' })).toBe(true);
    expect(isRule({ reason: 'r', file: 'src/a.ts', path: 'GET /a' })).toBe(true);
    expect(describeAccepted({ reason: 'route-unguarded', service: 'inventory', path: 'GET /levels/*' })).toBe(
      'route-unguarded · service inventory · path GET /levels/*',
    );
    expect(describeAccepted({ reason: 'r' })).toBe('r · everywhere');
  });

  it('keep two rules over one service that name two prefixes as two entries', () => {
    let gaps = withAccepted([], { reason: 'r', service: 's', path: 'GET /a/*', note: 'a', acceptedAt: AT });
    gaps = withAccepted(gaps, { reason: 'r', service: 's', path: 'GET /b/*', note: 'b', acceptedAt: AT });
    gaps = withAccepted(gaps, { reason: 'r', service: 's', note: 'all', acceptedAt: AT });
    expect(gaps.map(acceptedKeyOf)).toEqual(['gap:s||r|GET /a/*', 'gap:s||r|GET /b/*', 'gap:s||r']);
    expect(withoutAccepted(gaps, { reason: 'r', service: 's', path: 'GET /a/*' })).toHaveLength(2);
  });

  it('read a file written before rules had paths, and write the version that has them', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'flowatlas-accepted-')), 'graph.db');
    writeFileSync(join(dbPath, '..', 'accepted.json'), JSON.stringify({ acceptedFormatVersion: 1, gaps: [{ reason: 'r', note: '', acceptedAt: AT }] }));
    expect(loadAccepted(dbPath)).toEqual([{ reason: 'r', note: '', acceptedAt: AT }]);
    saveAccepted(dbPath, [{ reason: 'r', path: '/a/*', note: 'x', acceptedAt: AT }]);
    expect(loadAccepted(dbPath)).toEqual([{ reason: 'r', path: '/a/*', note: 'x', acceptedAt: AT }]);
  });

  it('match a route pattern the way doctor.publicRoutes always has', () => {
    expect(matchesRoutePattern('GET /api/public/*', 'get', '/api/public/a')).toBe(true);
    expect(matchesRoutePattern('* /health', 'POST', '/health')).toBe(true);
    expect(matchesRoutePattern('GET', 'GET', '/x')).toBe(false);
    expect(routeOfSymbol('GET /orders/:param')).toEqual({ method: 'GET', path: '/orders/:param' });
    expect(routeOfSymbol('OrdersController.list')).toBeUndefined();
  });
});
