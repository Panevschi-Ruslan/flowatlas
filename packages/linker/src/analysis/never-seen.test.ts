import { joinIdOf, observedFromParts, type Agg, type ObservedBucket, type UnmatchedAgg } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { deadEntries, deadVerdict } from './dead.js';
import { buildTestDb, edge, node } from './__fixtures__/test-db.js';
import { bestGuessCounts, confirmedByTraffic, confirmedJoins, neverSeen } from './never-seen.js';

const agg = (count: number, at: string): Agg => ({ count, errors: 0, firstSeen: at, lastSeen: at });

interface Hour {
  hour: string;
  entries?: Record<string, number>;
  symbols?: Record<string, number>;
  channels?: Record<string, number>;
  joins?: Record<string, number>;
  unmatched?: Array<Omit<UnmatchedAgg, keyof Agg> & { count: number }>;
}

const record = (counts: Record<string, number> | undefined, at: string): Record<string, Agg> =>
  Object.fromEntries(Object.entries(counts ?? {}).map(([id, n]) => [id, agg(n, at)]));

/** An observed file holding these hours, as `observe` would have written it. */
const observedOf = (hours: Hour[]) => {
  const buckets: ObservedBucket[] = hours.map((h) => ({
    hour: h.hour,
    spans: 1,
    joins: record(h.joins, h.hour),
    entries: record(h.entries, h.hour),
    symbols: record(h.symbols, h.hour),
    channels: record(h.channels, h.hour),
    unmatched: (h.unmatched ?? []).map(({ count, ...row }) => ({ ...row, ...agg(count, h.hour) })),
    ambiguous: [],
  }));
  return observedFromParts({ buckets, samples: {}, sources: [], droppedAttributes: 0, samplesKept: true });
};

const route = (id: string, over = {}) => node(id, { type: 'entry', kind: 'http', file: 'src/x.ts', line: 1, ...over });

const BUSY = 'entry:orders:http:GET:/orders';
const QUIET = 'entry:orders:http:POST:/orders/:param/cancel';
const PROBE = 'entry:orders:http:GET:/healthz';

const twoDays = (entries: Record<string, number>): Hour[] => [
  { hour: '2026-01-01T00:00:00.000Z', entries },
  { hour: '2026-01-07T23:00:00.000Z', entries: {} },
];

describe('never seen', () => {
  it('is strong beside a busy sibling, and carries its window', () => {
    const db = buildTestDb({
      nodes: [route(BUSY), route(QUIET), route(PROBE), node('ui:web:1', { type: 'ui_api_call', repo: 'web' })],
      edges: [edge('ui:web:1', QUIET, { type: 'hits' })],
    });
    const answer = neverSeen(db, observedOf(twoDays({ [BUSY]: 25 })));
    db.close();
    expect(answer.window.label).toBe('7d');
    expect(answer.rows.map((row) => [row.id, row.confidence, row.reachableFrom])).toEqual([
      [PROBE, 'strong', 'outside'],
      [QUIET, 'strong', 'code'],
    ]);
    expect(answer.rows[0]!.neighbours).toEqual({ seen: 1, of: 2, most: 25 });
  });

  it('is weak where no sibling was busy, and where the file holds less than asked', () => {
    const db = buildTestDb({ nodes: [route(BUSY), route(QUIET)], edges: [] });
    const few = neverSeen(db, observedOf(twoDays({ [BUSY]: 3 })));
    const short = neverSeen(db, observedOf(twoDays({ [BUSY]: 25 })), { since: '30d' });
    db.close();
    expect(few.rows.map((row) => row.confidence)).toEqual(['weak']);
    expect(short.window).toMatchObject({ since: '30d', label: '7d', short: true });
    expect(short.rows.map((row) => [row.confidence, row.window])).toEqual([['weak', '7d']]);
  });

  it('cuts the window at read time: what was seen only before it is never seen inside it', () => {
    const db = buildTestDb({ nodes: [route(BUSY), route(QUIET)], edges: [] });
    const observed = observedOf([
      { hour: '2026-01-01T00:00:00.000Z', entries: { [QUIET]: 2, [BUSY]: 30 } },
      { hour: '2026-01-07T23:00:00.000Z', entries: { [BUSY]: 30 } },
    ]);
    const all = neverSeen(db, observed);
    const lastDay = neverSeen(db, observed, { since: '1d' });
    db.close();
    expect(all.rows).toEqual([]);
    expect(lastDay.rows.map((row) => [row.id, row.confidence, row.window])).toEqual([[QUIET, 'strong', '1d']]);
  });

  it('says one note for a service with no span at all, and no rows', () => {
    const db = buildTestDb({
      nodes: [route(BUSY), route(QUIET), route('entry:billing:http:GET:/invoices', { repo: 'billing' })],
      edges: [],
    });
    const answer = neverSeen(db, observedOf(twoDays({ [BUSY]: 25 })));
    db.close();
    expect(answer.notes).toEqual(['nothing from billing in the window']);
    expect(answer.rows.some((row) => row.service === 'billing')).toBe(false);
  });

  it('asks about methods only where the service has symbol spans', () => {
    const nodes = [
      route(BUSY),
      route(QUIET),
      node('orders#a.ts:OrdersController.list'),
      node('orders#a.ts:OrdersController.cancel'),
    ];
    const edges = [
      edge(BUSY, 'orders#a.ts:OrdersController.list', { type: 'handles' }),
      edge(QUIET, 'orders#a.ts:OrdersController.cancel', { type: 'handles' }),
    ];
    const db = buildTestDb({ nodes, edges });
    const withoutSymbols = neverSeen(db, observedOf(twoDays({ [BUSY]: 25 })));
    const withSymbols = neverSeen(db, observedOf([
      { hour: '2026-01-01T00:00:00.000Z', entries: { [BUSY]: 25 }, symbols: { 'orders#a.ts:OrdersController.list': 25 } },
    ]));
    db.close();
    expect(withoutSymbols.rows.map((row) => row.type)).toEqual(['entry']);
    expect(withSymbols.rows.filter((row) => row.type === 'method').map((row) => [row.id, row.confidence])).toEqual([
      ['orders#a.ts:OrdersController.cancel', 'strong'],
    ]);
  });

  it('counts a handler as seen when the way in it handles was hit, whether or not a span named it', () => {
    const db = buildTestDb({
      nodes: [
        route(BUSY),
        node('orders#a.ts:OrdersController.list'),
        node('orders#b.ts:OrdersService.save'),
        node('orders#b.ts:OrdersService.find'),
      ],
      edges: [
        edge(BUSY, 'orders#a.ts:OrdersController.list', { type: 'handles' }),
        edge('orders#a.ts:OrdersController.list', 'orders#b.ts:OrdersService.save'),
        edge('orders#a.ts:OrdersController.list', 'orders#b.ts:OrdersService.find'),
      ],
    });
    const answer = neverSeen(db, observedOf([
      { hour: '2026-01-01T00:00:00.000Z', entries: { [BUSY]: 25 }, symbols: { 'orders#b.ts:OrdersService.save': 25 } },
    ]));
    db.close();
    // The handler ran 25 times with its route; only the method no span named and no way in hands work to is asked about.
    expect(answer.rows.map((row) => [row.id, row.confidence])).toEqual([['orders#b.ts:OrdersService.find', 'strong']]);
  });

  it('filters by kind and confidence', () => {
    const db = buildTestDb({ nodes: [route(BUSY), route(QUIET), route('entry:orders:cron:nightly', { kind: 'cron' })], edges: [] });
    const observed = observedOf(twoDays({ [BUSY]: 25 }));
    expect(neverSeen(db, observed, { kind: 'cron' }).rows.map((row) => row.id)).toEqual(['entry:orders:cron:nightly']);
    expect(neverSeen(db, observed, { confidence: 'weak' }).rows.map((row) => row.id)).toEqual(['entry:orders:cron:nightly']);
    db.close();
  });
});

describe('best guesses traffic went through', () => {
  const call = 'ui:web#a.ts:1';
  const guess = edge(call, BUSY, { type: 'hits', confidence: 'heuristic' });
  const sure = edge('ui:web#a.ts:2', BUSY, { type: 'hits' });

  it('are a heuristic join seen at least once, never a static one', () => {
    const joins = observedOf([
      { hour: '2026-01-01T00:00:00.000Z', joins: { [joinIdOf(call, 'hits', BUSY)]: 3, [joinIdOf('ui:web#a.ts:2', 'hits', BUSY)]: 1 } },
    ]).joins;
    expect(confirmedByTraffic(guess, { joins })?.count).toBe(3);
    expect(confirmedByTraffic(sure, { joins })).toBeUndefined();
    expect(confirmedByTraffic(guess, { joins: {} })).toBeUndefined();
  });

  it('are counted apart from the best guesses, and a join the graph lost is ignored', () => {
    const db = buildTestDb({ nodes: [route(BUSY), node(call, { type: 'ui_api_call', repo: 'web' })], edges: [guess] });
    const observed = observedOf([
      { hour: '2026-01-01T00:00:00.000Z', joins: { [joinIdOf(call, 'hits', BUSY)]: 3, [joinIdOf('gone', 'hits', BUSY)]: 9 } },
    ]);
    expect(confirmedJoins(db, observed).map((row) => row.id)).toEqual([joinIdOf(call, 'hits', BUSY)]);
    expect(bestGuessCounts(db, observed)).toEqual({ bestGuesses: 1, confirmed: 1 });
    db.close();
  });
});

describe('dead, with traffic as evidence', () => {
  const graph = () =>
    buildTestDb({
      nodes: [route(BUSY), route(QUIET), route(PROBE), route('entry:orders:cron:nightly', { kind: 'cron' })],
      edges: [],
      report: { routes: { total: 3, called: 0, uncalled: [BUSY, QUIET, PROBE], duplicated: [] } },
    });

  it('is exactly the static answer without an observed file', () => {
    const db = graph();
    const without = deadVerdict(db, db.report(), PROBE);
    const rows = deadEntries(db, db.report());
    db.close();
    expect(without).toMatchObject({ verdict: 'unknown', evidence: { outside: 'probe' } });
    expect(without!.evidence.neverSeen).toBeUndefined();
    expect(rows.every((row) => row.evidence?.seen === undefined && row.evidence?.neverSeen === undefined)).toBe(true);
  });

  it('says alive when seen, whatever the static answer, and that static reach missed a caller', () => {
    const db = graph();
    const answer = deadVerdict(db, db.report(), BUSY, { observed: observedOf(twoDays({ [BUSY]: 25 })) });
    db.close();
    expect(answer).toMatchObject({ verdict: 'alive', evidence: { seen: { count: 25, window: '7d' } } });
    expect(answer!.reason).toContain('static reach does not see calls it (a blind spot)');
  });

  it('turns an outside way in never seen beside a busy neighbour from unknown into likely-dead', () => {
    const db = graph();
    const observed = observedOf(twoDays({ [BUSY]: 25 }));
    const probe = deadVerdict(db, db.report(), PROBE, { observed });
    const weak = deadVerdict(db, db.report(), 'entry:orders:cron:nightly', { observed });
    db.close();
    expect(probe).toMatchObject({ verdict: 'likely-dead', evidence: { outside: 'probe', neverSeen: { window: '7d', confidence: 'strong' } } });
    expect(weak).toMatchObject({ verdict: 'unknown', evidence: { outside: 'cron', neverSeen: { confidence: 'weak' } } });
  });

  it('keeps a static dead and adds the silence as corroboration', () => {
    const db = graph();
    const rows = deadEntries(db, db.report(), { observed: observedOf(twoDays({ [BUSY]: 25 })) });
    db.close();
    const quiet = rows.find((row) => row.id === QUIET);
    expect(quiet).toMatchObject({ verdict: 'dead', evidence: { neverSeen: { window: '7d', confidence: 'strong' } } });
    expect(rows.find((row) => row.id === BUSY)?.verdict).toBe('alive');
  });
});
