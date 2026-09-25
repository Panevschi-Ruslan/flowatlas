import type { Unresolved } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { documentAgeRows, STALE_REASON, type AgeReader, type DeclaredDocument } from './age.js';
import { hintFor, isKnownReason } from './hints.js';

const BILLING: DeclaredDocument = { service: 'billing', documentPath: 'contracts/billing.json' };

/** The two dates, handed over rather than found, so a test needs no checkout. */
const reader = (changedAt: Date | undefined, newestCommit: Date | undefined): AgeReader => ({
  changedAt: () => changedAt,
  newestCommit: () => newestCommit,
});

const only = (rows: readonly { message?: string; hint?: string }[]) => {
  expect(rows).toHaveLength(1);
  return rows[0] as { message?: string; hint?: string };
};

describe('how old a declared document is', () => {
  it('says so when the work has moved on since the document was fetched', () => {
    const row = only(
      documentAgeRows([BILLING], reader(new Date('2026-01-10T00:00:00Z'), new Date('2026-09-25T00:00:00Z'))),
    );
    expect(row.message).toContain('last changed 2026-01-10');
    expect(row.message).toContain('the newest commit among the repositories that were read is from 2026-09-25');
    expect(row.message).toContain('may be behind the service it describes');
    // The action a stale document asks for, which a fresh one must not ask for.
    expect(row.hint).toContain('Fetch the current document');
  });

  it('does not cry stale when the document is newer than everything read', () => {
    const row = only(
      documentAgeRows([BILLING], reader(new Date('2026-09-25T00:00:00Z'), new Date('2026-01-10T00:00:00Z'))),
    );
    expect(row.message).not.toContain('may be behind');
    expect(row.hint).not.toContain('Fetch the current document');
    // Still says what the row is for: the document is nobody's word but its own.
    expect(row.hint).toContain("contracts/billing.json's word for it");
  });

  it('says there was nothing to compare against rather than guessing', () => {
    const row = only(documentAgeRows([BILLING], reader(new Date('2026-01-10T00:00:00Z'), undefined)));
    expect(row.message).toContain('nothing here is a checkout');
    expect(row.message).not.toContain('may be behind');
  });

  it('is one row per declared service, and none at all without one', () => {
    const rows = documentAgeRows(
      [BILLING, { service: 'payments', documentPath: 'contracts/payments.json' }],
      reader(new Date('2026-01-10T00:00:00Z'), new Date('2026-09-25T00:00:00Z')),
    );
    expect(rows.map((row) => row.service)).toEqual(['billing', 'payments']);
    expect(documentAgeRows([], reader(undefined, undefined))).toEqual([]);
  });

  it('carries a reason doctor knows, so the row is never printed without advice', () => {
    const [row] = documentAgeRows([BILLING], reader(undefined, undefined));
    expect(row).toBeDefined();
    expect(row?.reason).toBe(STALE_REASON);
    expect(isKnownReason(STALE_REASON)).toBe(true);
    // Nothing invented: the row is informational, and a row asking for nothing
    // must not be counted among the things to do.
    expect(row?.level).toBe('info');
    // Stripped of the hint it was written with, the catalogue still has advice
    // for it — which is the relationship I13 exists to keep true.
    const { hint: _hint, ...bare } = row as Unresolved;
    expect(hintFor(bare)).not.toContain('unknown reason');
  });
});
