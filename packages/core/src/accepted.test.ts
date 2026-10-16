import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  covers,
  gapIdOf,
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
    const id = gapIdOf({ service: 'orders', file: 'src/a.ts', reason: 'dynamic-channel-name' });
    expect(id).toBe('gap:orders|src/a.ts|dynamic-channel-name');
    expect(parseGapId(id)).toEqual({ service: 'orders', file: 'src/a.ts', reason: 'dynamic-channel-name' });
    expect(parseGapId('gap:||')).toBeUndefined();
    expect(parseGapId('dynamic-channel-name')).toBeUndefined();
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
});
