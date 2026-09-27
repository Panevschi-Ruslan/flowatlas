import type { Unresolved } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { documentAgeRows, STALE_REASON, type AgeReader, type DeclaredDocument } from './age.js';
import { canonicalReason, expandReasons, hintFor, isKnownReason } from './hints.js';

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

/**
 * The row answers for a document of any kind, so the kind is in the sentence.
 *
 * `openapi-document-age` was named when an OpenAPI document was the only kind
 * there was. R79 added AsyncAPI, and the reason and the prose then named one
 * format while answering for two: a reader with an AsyncAPI document was told
 * something about OpenAPI (R127).
 */
describe('a document of a kind the reason does not name', () => {
  const ASYNC: DeclaredDocument = {
    service: 'billing',
    documentPath: 'contracts/billing.asyncapi.json',
    kind: 'asyncapi',
  };

  it('names the kind in the message', () => {
    const row = only(documentAgeRows([ASYNC], reader(new Date('2026-01-10T00:00:00Z'), undefined)));
    expect(row.message).toContain('the asyncapi document last changed 2026-01-10');
    expect(row.message).not.toContain('OpenAPI');
  });

  it('says `document` where the caller named no kind, rather than guessing one', () => {
    const row = only(documentAgeRows([BILLING], reader(new Date('2026-01-10T00:00:00Z'), undefined)));
    expect(row.message).toContain('the document last changed 2026-01-10');
    expect(row.message).not.toContain('undefined');
  });

  it('carries a reason named after the question and not after one format', () => {
    expect(STALE_REASON).toBe('document-age');
  });

  /**
   * The compatibility half, and why this was declined once rather than done as a
   * typo: a reason is spelled by hand in `doctor.ignoreReasons` and can sit in a
   * committed baseline, so a project that silenced the old name must go on having
   * it silenced without editing anything.
   */
  it('keeps the old spelling working wherever somebody has already written it', () => {
    expect(isKnownReason('openapi-document-age')).toBe(true);
    expect(
      hintFor({ reason: 'openapi-document-age', file: 'contracts/billing.json', line: 1 }),
    ).not.toContain('unknown reason');
    expect(canonicalReason('openapi-document-age')).toBe(STALE_REASON);
    expect(new Set(expandReasons(['openapi-document-age']))).toEqual(
      new Set(['openapi-document-age', 'document-age']),
    );
    // A reason nobody renamed passes through untouched, list and all.
    expect(expandReasons(['db-receiver-name-only'])).toEqual(['db-receiver-name-only']);
  });
});

/**
 * The whole row, field by field.
 *
 * The cases above hold the sentence by fragments, which is how a message is
 * best asserted; what they leave loose is everything else a reader and the
 * baseline key on - where the row points, whose it is, and at which level. That
 * a real `doctor` run still silences it under the old spelling is asserted over
 * a built fixture in `commands/doctor-document-age.test.ts`.
 */
describe('the row, as a whole', () => {
  it('points at the document, belongs to the service, and says nothing it cannot know', () => {
    const rows = documentAgeRows(
      [{ service: 'billing', documentPath: 'contracts/billing.asyncapi.json', kind: 'asyncapi' }],
      reader(new Date('2026-01-10T00:00:00Z'), new Date('2026-09-25T00:00:00Z')),
    );
    expect(rows).toEqual([
      {
        file: 'contracts/billing.asyncapi.json',
        line: 1,
        reason: 'document-age',
        level: 'info',
        service: 'billing',
        symbol: 'billing',
        message:
          'billing was declared by contracts/billing.asyncapi.json, the asyncapi document last changed 2026-01-10; ' +
          'the newest commit among the repositories that were read is from 2026-09-25, ' +
          'so the document may be behind the service it describes',
        hint:
          'Fetch the current asyncapi document from whoever owns billing and rebuild. Nothing here can check a ' +
          'document against the running service, so how recently it was updated is the only evidence there is ' +
          'that it is still true.',
      },
    ]);
  });
});
