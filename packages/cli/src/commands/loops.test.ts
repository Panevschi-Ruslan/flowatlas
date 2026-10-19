import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDoctorCommand } from './doctor.js';
import { runStats } from './stats.js';

/**
 * The loops worth fixing (P89), as a person reads them: doctor lists the
 * likely N+1 loops reached from more ways in first and the per-item ones as
 * notes, and `stats` says how many loops were set aside and why. The graph
 * beneath is the fixture's own snapshot.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'loops-worth-fixing', 'flowatlas.config.json');

const quiet = { out(): void {}, err(): void {}, tty: false };

const captured = (run: (io: { out(text: string): void; err(text: string): void; tty: boolean }) => void): string => {
  let text = '';
  run({ out: (chunk) => (text += chunk), err: () => {}, tty: false });
  return text;
};

describe('doctor on loops that run a query per item', () => {
  const { report } = runDoctorCommand({ config: CONFIG }, quiet);
  const groups = report.unresolved.byReason.filter((group) => group.reason === 'query-in-loop');

  it('lists the likely N+1 loops as findings, reached from more ways in first', () => {
    const findings = groups.find((group) => group.kind === 'finding');
    expect(findings?.level).toBe('info');
    expect(findings?.rows.map((row) => [row.symbol?.split(':').pop(), row.waysIn])).toEqual([
      ['ParcelsService.labelsFor', 3],
      // A raw read through TypeORM, read as a statement (P126).
      ['ParcelHandover.withCarriers', 1],
      ['ParcelsService.statuses', 1],
    ]);
  });

  it('counts the loops that are per item on purpose with the other notes', () => {
    const notes = groups.find((group) => group.kind === 'note');
    expect(notes?.level).toBe('info');
    expect(notes?.rows.map((row) => row.symbol?.split(':').pop())).toEqual([
      'ParcelDispatch.claimAll',
      'ParcelDispatch.notifyAll',
      // A guarded raw UPDATE through a query runner, and a manager's guarded
      // update with its criteria after the entity class (P126).
      'ParcelHandover.releaseAll',
      'ParcelHandover.holdAll',
    ]);
    expect(report.unresolved.notes).toBeGreaterThanOrEqual(4);
  });

  it('says how many ways in reach each loop', () => {
    const text = captured((io) => runDoctorCommand({ config: CONFIG }, io));
    expect(text).toMatch(/parcels\.service\.ts:18 .*likely N\+1\.\s+\(3 ways in\)/);
    expect(text).toMatch(/parcels\.service\.ts:28 .*likely N\+1\.\s+\(1 way in\)/);
  });
});

describe('stats on loops set aside', () => {
  it('counts each reason a loop was set aside for', () => {
    const json = JSON.parse(captured((io) => runStats({ config: CONFIG, format: 'json' }, io))) as { loopsBounded: Record<string, number> };
    expect(json.loopsBounded).toEqual({ chunk: 1, page: 1, cursor: 1, retry: 1, literal: 1, 'batch-call': 2, migration: 1 });
    const text = captured((io) => runStats({ config: CONFIG, format: 'tree' }, io));
    expect(text).toContain('loops set aside: chunk 1 · page 1 · cursor 1 · retry 1 · literal 1 · batch-call 2 · migration 1');
  });
});
