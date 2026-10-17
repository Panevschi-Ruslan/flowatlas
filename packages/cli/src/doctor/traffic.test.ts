import { join, resolve } from 'node:path';
import { readObserved, SEEN_NOT_IN_CODE, type Unresolved } from '@flowatlas/core';
import { openGraphDb } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { blindSpotRows, confirmedLine, withConfirmedGuesses } from './traffic.js';

/*
 * Doctor beside an observed file (P110), on the multi-repo graph and the file
 * `flowatlas observe` wrote over its traces (the CLI's `observe.json`
 * snapshot): one info row per blind-spot group, the best guesses traffic went
 * through counted apart, and the row explaining a confirmed guess withdrawn.
 */
const FIXTURE = resolve(import.meta.dirname, '../../../../fixtures/multi-repo');
const observed = readObserved(join(FIXTURE, 'expected.cli', 'observe.json')).observed!;

/** The one best guess twenty page loads went through: the web's call made by `OrdersApiService.one`. */
const GUESSED = 'ui_api_call:web#src/app/orders-api.service.ts:73:12';

describe('blind spots in doctor', () => {
  it('are one file-less info row per service and kind, with the group as meta', () => {
    const rows = blindSpotRows(observed);
    expect(rows.map((row) => [row.service, (row.meta?.['seen'] as { kind: string }).kind])).toEqual([
      ['billing', 'db'],
      ['billing', 'client'],
      ['billing', 'code'],
      ['billing', 'http'],
      ['gateway', 'http'],
      ['orders', 'messaging'],
    ]);
    expect(rows.every((row) => row.reason === SEEN_NOT_IN_CODE && row.level === 'info' && row.file === '')).toBe(true);
    expect(rows[0]!.message).toBe('traffic in billing reached 1 collection no reader drew, 2 spans in 2h: invoices (2)');
    expect(blindSpotRows(undefined)).toEqual([]);
  });
});

describe('best guesses confirmed by traffic', () => {
  const row = (reason: string, symbol?: string): Unresolved => ({
    file: 'src/app/orders-api.service.ts',
    line: 73,
    reason,
    service: 'web',
    ...(symbol === undefined ? {} : { symbol }),
  });

  it('are counted apart, and the row explaining a confirmed guess is withdrawn', () => {
    const db = openGraphDb(join(FIXTURE, '.flowatlas', 'graph.db'), { readonly: true });
    try {
      const rows = [row('base-url-from-name', GUESSED), row('base-url-from-name', 'ui_api_call:web#elsewhere:1:1'), row('call-dynamic-receiver', GUESSED)];
      const { rows: kept, confirmed } = withConfirmedGuesses(db, observed, rows);
      expect(kept.map((each) => [each.reason, each.symbol])).toEqual([
        ['base-url-from-name', 'ui_api_call:web#elsewhere:1:1'],
        ['call-dynamic-receiver', GUESSED],
      ]);
      expect(confirmed).toEqual({ window: '2h', bestGuesses: 5, confirmed: 1, withdrawn: 1 });
      expect(confirmedLine(confirmed)).toBe('1 of 5 best guesses confirmed by traffic in 2h; 1 row explaining a guess left out');
      // Narrowed to a service, only the guesses its code makes.
      expect(withConfirmedGuesses(db, observed, [], 'billing').confirmed).toMatchObject({ bestGuesses: 0, confirmed: 0 });
      expect(confirmedLine(withConfirmedGuesses(db, observed, [], 'billing').confirmed)).toBeUndefined();
      // No observed file: every row as it was, and nothing to say.
      expect(withConfirmedGuesses(db, undefined, rows)).toEqual({ rows });
    } finally {
      db.close();
    }
  });
});
