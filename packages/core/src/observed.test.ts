import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  describeObservedProblem,
  joinIdOf,
  OBSERVED_FILE,
  OBSERVED_FORMAT_VERSION,
  observedOf,
  observedPathFor,
  readObserved,
} from './observed.js';

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-observed-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let written = 0;
const file = (text: string): string => {
  written += 1;
  const path = join(scratch, `observed-${written}.json`);
  writeFileSync(path, text);
  return path;
};

const body = {
  spans: 3,
  joins: { [joinIdOf('a', 'http_calls', 'b')]: { count: 1, lastSeen: '2026-01-01T00:00:00.000Z' } },
  entries: { b: { hits: 1, lastSeen: null } },
  symbols: {},
  channels: {},
  unmatched: [{ service: 'shop', kind: 'http' as const, name: 'GET /health', count: 1 }],
  ambiguous: [{ kind: 'symbol' as const, name: 'CartService.add', candidates: ['x', 'y'], count: 2 }],
};

describe('the observed file contract', () => {
  it('names a join one way', () => {
    expect(joinIdOf('http_out:shop#a.ts:1:1', 'http_calls', 'entry:catalog:http:GET:/x')).toBe(
      'http_out:shop#a.ts:1:1 -http_calls-> entry:catalog:http:GET:/x',
    );
  });

  it('sits beside the database', () => {
    expect(observedPathFor(join('out', 'graph.db'))).toBe(join('out', OBSERVED_FILE));
  });

  it('reads version 2 as written', () => {
    const observed = observedOf(body);
    expect(observed.observedFormatVersion).toBe(OBSERVED_FORMAT_VERSION);
    expect(readObserved(file(JSON.stringify(observed)))).toEqual({ observed });
  });

  it('reads version 1 as it is, with nothing ambiguous', () => {
    const { ambiguous: _, ...older } = body;
    const read = readObserved(file(JSON.stringify({ observedFormatVersion: 1, ...older })));
    expect(read.problem).toBeUndefined();
    expect(read.observed).toMatchObject({ observedFormatVersion: 1, ambiguous: [], spans: 3 });
  });

  it('says why a file cannot be read', () => {
    const kindOf = (path: string) => readObserved(path).problem?.kind;
    expect(kindOf(join(scratch, 'none.json'))).toBe('missing');
    expect(kindOf(file('{ "observedFormatVersion": 2, '))).toBe('unparseable');
    expect(kindOf(file('[]'))).toBe('invalid');
    expect(kindOf(file(JSON.stringify({ ...body, observedFormatVersion: 9 })))).toBe('newer-version');
    expect(kindOf(file(JSON.stringify({ ...body, observedFormatVersion: 0 })))).toBe('unknown-version');
    expect(kindOf(file(JSON.stringify(body)))).toBe('unknown-version');
    const invalid = readObserved(file(JSON.stringify({ ...observedOf(body), joins: { x: { count: 'many' } } })));
    expect(invalid.problem).toMatchObject({ kind: 'invalid', detail: expect.stringContaining('joins.x.count') });
    expect(invalid.observed).toBeUndefined();
    expect(describeObservedProblem(invalid.problem!)).toContain('so nothing seen at run time is shown');
  });
});
