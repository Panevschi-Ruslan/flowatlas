import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as glob from './glob.js';
import {
  acceptedFor,
  acceptedKeyOf,
  compileAccepted,
  covers,
  describeAcceptedProblem,
  describeAccepted,
  gapIdOf,
  isRule,
  matchesRoutePattern,
  routeOfSymbol,
  loadAccepted,
  parseGapId,
  readAccepted,
  saveAccepted,
  splitAccepted,
  withAccepted,
  withoutAccepted,
} from './accepted.js';

/** A rename that can be told to fail, to show a write cut short leaves the file whole. */
const renames = vi.hoisted(() => ({ fail: false }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    renameSync: (from: string, to: string) => {
      if (renames.fail) throw new Error('rename stubbed to fail');
      return fs.renameSync(from, to);
    },
  };
});

/** Every glob compiled, counted. */
vi.mock('./glob.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./glob.js')>();
  return { ...actual, compileGlob: vi.fn(actual.compileGlob) };
});

const AT = '2026-01-01T00:00:00.000Z';

const dbIn = (prefix: string): string => join(mkdtempSync(join(tmpdir(), prefix)), 'graph.db');
const writeRaw = (dbPath: string, text: string): void => writeFileSync(join(dbPath, '..', 'accepted.json'), text);

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

  it('match a file glob in the grammar shapes uses: ? is one character, ** matches no segment too', () => {
    const gap = (file: string) => ({ reason: 'r', file });
    expect(covers({ reason: 'r', file: 'src/**/public.ts' }, gap('src/public.ts'))).toBe(true);
    expect(covers({ reason: 'r', file: 'src/**/public.ts' }, gap('src/a/b/public.ts'))).toBe(true);
    expect(covers({ reason: 'r', file: 'src/a?.ts' }, gap('src/ab.ts'))).toBe(true);
    expect(covers({ reason: 'r', file: 'src/a?.ts' }, gap('src/a.ts'))).toBe(false);
    expect(isRule({ reason: 'r', file: 'src/a?.ts' })).toBe(true);
  });
});

describe('a file that cannot be read (P80)', () => {
  // In the order the file is written in.
  const ENTRIES = [
    { reason: 'b', service: 's', note: 'kept', acceptedAt: AT },
    { reason: 'a', note: '', acceptedAt: AT },
  ];

  it('is no problem when it is not there', () => {
    expect(readAccepted(dbIn('flowatlas-accepted-none-'))).toEqual({ gaps: [] });
  });

  it('reads a good file as before, through the old name too', () => {
    const db = dbIn('flowatlas-accepted-good-');
    saveAccepted(db, ENTRIES);
    expect(readAccepted(db)).toEqual({ gaps: ENTRIES });
    expect(loadAccepted(db)).toEqual(ENTRIES);
  });

  it('says which of four ways it cannot be read, and accepts nothing', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['{"acceptedFormatVersion": 2, "gaps": [\n<<<<<<< HEAD\n', 'unparseable', /JSON/],
      ['', 'unparseable', /JSON/],
      ['[]', 'invalid', /not an object/],
      [JSON.stringify({ acceptedFormatVersion: 2, gaps: [{ note: '', acceptedAt: AT }] }), 'invalid', /^gaps\.0\.reason: /],
      [JSON.stringify({ acceptedFormatVersion: 3, gaps: [] }), 'newer-version', /written by a newer flowatlas.*upgrade to change it/],
      [JSON.stringify({ acceptedFormatVersion: 0, gaps: [] }), 'unknown-version', /acceptedFormatVersion 0 /],
      [JSON.stringify({ acceptedFormatVersion: '2', gaps: [] }), 'unknown-version', /acceptedFormatVersion "2" /],
      [JSON.stringify({ gaps: [] }), 'unknown-version', /no acceptedFormatVersion/],
    ];
    for (const [text, kind, detail] of cases) {
      const db = dbIn('flowatlas-accepted-bad-');
      writeRaw(db, text);
      const read = readAccepted(db);
      expect(read.gaps).toEqual([]);
      expect(read.problem?.kind).toBe(kind);
      expect(read.problem?.path).toBe(join(db, '..', 'accepted.json'));
      expect(read.problem?.detail).toMatch(detail);
      expect(loadAccepted(db)).toEqual([]);
    }
  });

  it('is said in one sentence that names the file', () => {
    expect(describeAcceptedProblem({ path: '/p/accepted.json', kind: 'unparseable', detail: 'Unexpected end of JSON input' })).toBe(
      'accepted.json at /p/accepted.json cannot be read (Unexpected end of JSON input), so nothing in it is accepted',
    );
  });

  it('is never left half-written: a failed rename leaves the old file and no temporary', () => {
    const db = dbIn('flowatlas-accepted-atomic-');
    saveAccepted(db, ENTRIES);
    const before = readFileSync(join(db, '..', 'accepted.json'), 'utf8');
    renames.fail = true;
    try {
      expect(() => saveAccepted(db, [{ reason: 'c', note: '', acceptedAt: AT }])).toThrow(/rename stubbed to fail/);
    } finally {
      renames.fail = false;
    }
    expect(readFileSync(join(db, '..', 'accepted.json'), 'utf8')).toBe(before);
    expect(readdirSync(join(db, '..')).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(existsSync(join(db, '..', 'accepted.json'))).toBe(true);
  });
});

describe('compiled accepted rules (P80)', () => {
  const ENTRIES = [
    { reason: 'r', service: 'catalog', file: 'src/public/**', note: '', acceptedAt: AT },
    { reason: 'route-unguarded', service: 'inventory', path: 'GET /levels/*', note: 'levels', acceptedAt: AT },
    { reason: 'route-unguarded', path: '/health', note: '', acceptedAt: AT },
    { reason: 'r', file: 'src/a?.ts', note: '', acceptedAt: AT },
    { reason: 'exact', service: 's', file: 'src/x.ts', note: '', acceptedAt: AT },
    { reason: 'everywhere', note: '', acceptedAt: AT },
  ];
  const GAPS = [
    { reason: 'r', service: 'catalog', file: 'src/public/a/b.ts' },
    { reason: 'r', service: 'catalog', file: 'src/private/a.ts' },
    { reason: 'r', service: 'other', file: 'src/public/a.ts' },
    { reason: 'route-unguarded', service: 'inventory', symbol: 'GET /levels/summary' },
    { reason: 'route-unguarded', service: 'inventory', node: 'GET /levels/low' },
    { reason: 'route-unguarded', service: 'inventory', symbol: 'POST /levels/summary' },
    { reason: 'route-unguarded', service: 'any', symbol: 'DELETE /health' },
    { reason: 'route-unguarded', service: 'inventory', symbol: 'LevelsController.low' },
    { reason: 'r', file: 'src/ab.ts' },
    { reason: 'r', file: 'src/a.ts' },
    { reason: 'exact', service: 's', file: 'src/x.ts' },
    { reason: 'exact', service: 's', file: 'src/y.ts' },
    { reason: 'everywhere' },
    { reason: 'none' },
  ];

  it('take exactly what covers takes, entry by entry and row by row', () => {
    const rules = compileAccepted(ENTRIES);
    for (const gap of GAPS) {
      expect(rules.match(gap)).toBe(ENTRIES.find((entry) => covers(entry, gap)));
      expect(acceptedFor(ENTRIES, gap)).toBe(rules.match(gap));
    }
  });

  it('split rows in one pass, saying which entry took each', () => {
    const split = compileAccepted(ENTRIES).split(GAPS);
    expect(split.fresh).toEqual(GAPS.filter((gap) => !ENTRIES.some((entry) => covers(entry, gap))));
    expect(split.accepted).toHaveLength(GAPS.length - split.fresh.length);
    expect(split.byEntry).toHaveLength(GAPS.length);
    expect(split.byEntry[3]).toBe(ENTRIES[1]);
    expect(split.byEntry[1]).toBeUndefined();
    expect(splitAccepted(ENTRIES, GAPS)).toEqual({ fresh: split.fresh, accepted: split.accepted });
  });

  it('match a row on what matchedAs says it is about', () => {
    const rows = [{ reason: 'route-unguarded', service: 'inventory', line: 3 }];
    const split = compileAccepted(ENTRIES).split(rows, (row) => ({ ...row, symbol: 'GET /levels/x' }));
    expect(split.accepted).toEqual(rows);
  });

  it('compile each file glob once, however many rows they are asked about', () => {
    const compiled = vi.mocked(glob.compileGlob);
    compiled.mockClear();
    const rules = compileAccepted(ENTRIES);
    rules.split([...GAPS, ...GAPS, ...GAPS]);
    for (const gap of GAPS) rules.match(gap);
    // Two entries carry a glob: src/public/** and src/a?.ts.
    expect(compiled).toHaveBeenCalledTimes(2);
  });
});

