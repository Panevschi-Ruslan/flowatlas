import { describe, expect, it } from 'vitest';
import { GraphBuilder } from './builder.js';
import { causeMeta, causeOfRow, groupCantFollow, placeIdOf, type CantFollowRow } from './cant-follow.js';
import { wasMissed } from './model/graph.js';

const call = (file: string, line: number, cause: string, pkg?: string) => ({
  file,
  line,
  reason: 'call-dynamic-receiver',
  level: 'info' as const,
  symbol: `Orders.place -> x${line}.go`,
  ...causeMeta(pkg === undefined ? { cause } : { cause, package: pkg }),
});

describe('folding keeps why', () => {
  it('lists the causes of the places a folded row stands for, most first, a few places each', () => {
    const builder = new GraphBuilder({ repo: 'shop', generatedAt: 'fixed' });
    builder.addUnresolved(call('src/a.ts', 1, 'module-not-installed', '@shop/mailer'));
    builder.addUnresolved(call('src/a.ts', 2, 'dynamic-member'));
    for (let line = 3; line <= 7; line += 1) builder.addUnresolved(call('src/b.ts', line, 'module-not-installed', '@shop/mailer'));
    const [row] = builder.build().unresolved;
    expect(row?.sites).toBe(7);
    expect(row?.meta?.['cause']).toBeUndefined();
    const causes = row?.meta?.['causes'] as Array<{ cause: string; package?: string; sites: number; samples: unknown[] }>;
    expect(causes.map(({ cause, package: pkg, sites }) => [cause, pkg, sites])).toEqual([
      ['module-not-installed', '@shop/mailer', 6],
      ['dynamic-member', undefined, 1],
    ]);
    expect(causes[0]?.samples).toHaveLength(3);
  });

  it('adds nothing to a folded row whose places never said why', () => {
    const builder = new GraphBuilder({ repo: 'shop', generatedAt: 'fixed' });
    builder.addUnresolved({ file: 'src/a.ts', line: 1, reason: 'type-generic-uninstantiated', level: 'info' });
    builder.addUnresolved({ file: 'src/a.ts', line: 2, reason: 'type-generic-uninstantiated', level: 'info' });
    expect(builder.build().unresolved[0]?.meta).toBeUndefined();
  });
});

describe('the breakdown', () => {
  const rows: CantFollowRow[] = [
    {
      file: 'src/a.ts',
      line: 1,
      reason: 'call-dynamic-receiver',
      level: 'info',
      sites: 5,
      service: 'shop',
      meta: {
        causes: [
          { cause: 'module-not-installed', package: '@shop/mailer', sites: 4, samples: [{ file: 'src/a.ts', line: 1, symbol: 'Orders.place -> mail.send' }] },
          { cause: 'callback-param', sites: 1, samples: [{ file: 'src/a.ts', line: 9 }] },
        ],
      },
    },
    { file: 'src/b.ts', line: 3, reason: 'type-unresolved', service: 'shop', meta: { cause: 'module-not-installed', package: '@shop/mailer' } },
    { file: 'src/c.ts', line: 4, reason: 'type-unresolved', service: 'pay', meta: { cause: 'module-not-installed', package: '@shop/ledger' } },
    { file: 'src/d.ts', line: 5, reason: 'dynamic-table-name', service: 'pay' },
    // A finding (P81), never a step the reader could not follow.
    { file: 'src/e.ts', line: 6, reason: 'query-in-loop', level: 'info', service: 'pay' },
  ];

  it('counts what every other figure counts, and nothing at level nothing', () => {
    const found = groupCantFollow(rows);
    const missed = rows.filter(wasMissed);
    expect(found.total).toEqual({ rows: missed.length, sites: missed.reduce((sum, row) => sum + (row.sites ?? 1), 0) });
    expect(found.causes.reduce((sum, cause) => sum + cause.sites, 0)).toBe(found.total.sites);
  });

  it('groups by cause, then package, most places first', () => {
    const found = groupCantFollow(rows);
    expect(found.causes.map((cause) => [cause.label, cause.sites])).toEqual([
      ['module-not-installed', 6],
      ['callback-param', 1],
      ['dynamic-table-name', 1],
    ]);
    expect(found.causes[0]?.packages.map((pkg) => [pkg.package, pkg.sites])).toEqual([
      ['@shop/mailer', 5],
      ['@shop/ledger', 1],
    ]);
    expect(found.causes[0]?.reasons).toEqual(['call-dynamic-receiver', 'type-unresolved']);
    expect(found.packages.map((pkg) => [pkg.package, pkg.sites])).toEqual([
      ['@shop/mailer', 5],
      ['@shop/ledger', 1],
    ]);
  });

  it('labels a cause with its package when there is only one, and cuts what is past the top', () => {
    const found = groupCantFollow(rows, { top: 1, package: '@shop/ledger' });
    expect(found.causes.map((cause) => cause.label)).toEqual(['module-not-installed:@shop/ledger']);
    expect(groupCantFollow(rows, { top: 1 }).truncated).toEqual({ causes: 2, packages: 1 });
  });

  it('narrows to a service and a cause', () => {
    expect(groupCantFollow(rows, { service: 'pay' }).total).toEqual({ rows: 2, sites: 2 });
    expect(groupCantFollow(rows, { cause: 'callback-param' }).total).toEqual({ rows: 1, sites: 1 });
  });

  it('reads a reason that is one cause under another name as that cause', () => {
    expect(causeOfRow({ reason: 'call-through-token' })).toEqual({ cause: 'untyped-di-token' });
    expect(causeOfRow({ reason: 'route-unguarded' })).toEqual({ cause: 'route-unguarded' });
  });
});

describe('the node a place is in', () => {
  const ids = new Set(['shop#src/a.ts:Orders.place', 'shop#src/a.ts:handler']);
  const has = (id: string): boolean => ids.has(id);

  it('is the caller a call row names, and only when the graph holds it', () => {
    expect(placeIdOf({ service: 'shop', file: 'src/a.ts', line: 1, symbol: 'Orders.place -> mail.send' }, has)).toBe('shop#src/a.ts:Orders.place');
    expect(placeIdOf({ service: 'shop', file: 'src/a.ts', line: 1, symbol: 'handler@3 -> log.info' }, has)).toBe('shop#src/a.ts:handler');
    expect(placeIdOf({ service: 'shop', file: 'src/b.ts', line: 1, symbol: 'Orders.place -> mail.send' }, has)).toBeUndefined();
    expect(placeIdOf({ service: 'shop', file: 'src/a.ts', line: 1, symbol: 'Receipt' }, has)).toBeUndefined();
  });
});
