import { describe, expect, it } from 'vitest';
import { blindSpotMessage, blindSpotNext, blindSpotsOf, SEEN_NOT_IN_CODE } from './blind-spots.js';
import { groupCantFollow, hintForCause } from './cant-follow.js';
import { durationLabel, observedOver } from './observed.js';
import type { UnmatchedSpan } from './observed.js';

const row = (service: string | undefined, kind: UnmatchedSpan['kind'], name: string, count: number, lastSeen = '2026-01-01T00:10:00.000Z'): UnmatchedSpan => ({
  ...(service === undefined ? {} : { service }),
  kind,
  name,
  count,
  lastSeen,
});

const UNMATCHED: UnmatchedSpan[] = [
  row('billing', 'db', 'invoices', 2),
  row('billing', 'http', 'GET /healthz', 1),
  row('billing', 'http', 'GET /readyz', 1, '2026-01-01T00:20:00.000Z'),
  row('billing', 'code', 'LedgerClient.post', 1),
  row('orders', 'messaging', 'order.audited', 1),
  row('shop', 'cloud', 'SecretsManager/GetSecretValue', 1),
];

describe('blind spots', () => {
  it('group by service and kind, most spans first, with the names the trace kept', () => {
    const spots = blindSpotsOf(UNMATCHED);
    expect(spots.map((spot) => [spot.service, spot.kind, spot.count, spot.places])).toEqual([
      ['billing', 'db', 2, 1],
      ['billing', 'http', 2, 2],
      ['billing', 'code', 1, 1],
      ['orders', 'messaging', 1, 1],
      ['shop', 'cloud', 1, 1],
    ]);
    const http = spots[1]!;
    expect(http.lastSeen).toBe('2026-01-01T00:20:00.000Z');
    expect(http.names.map((name) => name.name)).toEqual(['GET /healthz', 'GET /readyz']);
  });

  it('name the call that looks for each kind in the map', () => {
    expect(blindSpotNext('code', 'LedgerClient.post', 'billing')).toBe('find_symbol({query: "LedgerClient.post", service: "billing"})');
    expect(blindSpotNext('http', 'GET /healthz', 'billing')).toBe('list_entries({service: "billing"})');
    expect(blindSpotNext('client', 'GET /orders/:value')).toBe('search({query: "/orders/:value"})');
    expect(blindSpotNext('messaging', 'order.audited')).toBe('search({query: "order.audited"})');
  });

  it('list a few names and count the rest', () => {
    const many = Array.from({ length: 7 }, (_, i) => row('billing', 'http', `GET /r${i}`, 1));
    const [spot] = blindSpotsOf(many, { names: 3 });
    expect(spot).toMatchObject({ places: 7, more: 4 });
    expect(blindSpotMessage(spot!, '2h')).toBe(
      'traffic in billing reached 7 routes no reader drew, 7 spans in 2h: GET /r0 (1), GET /r1 (1), GET /r2 (1), and 4 more',
    );
  });

  it('stand under their own cause in the breakdown, with groups in place of packages', () => {
    const spots = blindSpotsOf(UNMATCHED);
    const rows = spots.map((spot) => ({
      reason: SEEN_NOT_IN_CODE,
      level: 'info' as const,
      service: spot.service ?? null,
      file: '',
      line: 0,
      sites: spot.places,
      meta: { seen: spot },
    }));
    const grouped = groupCantFollow([...rows, { reason: 'call-dynamic-receiver', file: 'a.ts', line: 3, service: 'billing' }]);
    const cause = grouped.causes.find((each) => each.cause === SEEN_NOT_IN_CODE);
    expect(grouped.total).toEqual({ rows: 6, sites: 7 });
    expect(cause).toMatchObject({ sites: 6, packages: [], services: ['billing', 'orders', 'shop'] });
    expect(cause?.seen?.map((spot) => spot.kind)).toEqual(['db', 'http', 'code', 'messaging', 'cloud']);
    expect(cause?.hint).toBe(hintForCause(SEEN_NOT_IN_CODE));
    expect(grouped.packages).toEqual([]);
  });
});

describe('the window an overlay reads', () => {
  const bucket = (hour: string) => ({ hour, spans: 1, joins: {}, entries: {}, symbols: {}, channels: {}, unmatched: [], ambiguous: [] });
  const file = {
    buckets: [bucket('2026-01-01T00:00:00.000Z'), bucket('2026-01-03T23:00:00.000Z')],
    window: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-04T00:00:00.000Z' },
  };

  it('says what the file holds, and what a since cut keeps', () => {
    expect(observedOver(file).window).toEqual({ from: file.window.from, to: file.window.to, label: '3d', short: false });
    expect(observedOver(file, '1d').window).toEqual({ since: '1d', from: '2026-01-03T23:00:00.000Z', to: file.window.to, label: '1d', short: false });
    expect(observedOver(file, '7d').window).toMatchObject({ label: '3d', short: true });
  });

  it('says hours below two days', () => {
    expect(durationLabel(2 * 3_600_000)).toBe('2h');
    expect(durationLabel(47 * 3_600_000)).toBe('47h');
    expect(durationLabel(7 * 24 * 3_600_000)).toBe('7d');
  });
});
