import { resolve } from 'node:path';
import { countsOf, kindOfRow, parseConfig, wasMissed, type RepoGraph, type Unresolved } from '@flowatlas/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractRepo } from '../extract-repo.js';
import type { NestExtractContext } from '../context.js';
import { definePass } from './types.js';
import { MOST_REACHED } from './call-shape.js';

/**
 * P69's row, one per loop since P89.
 *
 * The data-layer reader is not a dependency of this package, so the leaves a
 * loop reaches are played here by a pass that adds them at sites inside the
 * fixture's loops. The fixtures' own snapshots (`nest-query-loop`,
 * `loops-worth-fixing`) are the same questions asked with the real readers.
 */
const FIXTURE = resolve(import.meta.dirname, '../../../../fixtures/nest-query-loop');
const FILE = 'src/orders/orders.service.ts';
const ONE_BY_ONE = `loop#${FILE}:OrdersService.byIdsOneByOne`;
const SAVE_ALL = `loop#${FILE}:OrdersService.saveAll`;
const SAVE_ONE = `loop#${FILE}:OrdersService.saveOne`;

interface Played {
  type: 'db_query' | 'cache_op' | 'producer' | 'http_out';
  from: string;
  line: number;
  column: number;
  meta?: Record<string, unknown>;
}

/** Leaves added where the given method's loop is, with the meta a reader would write. */
type Extra = (ctx: NestExtractContext) => void;

const playing = (leaves: readonly Played[], extra: Extra = () => {}) =>
  definePass('play-leaves', (ctx) => {
    for (const leaf of leaves) {
      if (!ctx.builder.has(leaf.from)) continue;
      const id = `${leaf.type}:loop#${FILE}:${leaf.line}:${leaf.column}`;
      ctx.builder.addNode({ id, type: leaf.type, label: leaf.type, repo: ctx.repo, file: FILE, line: leaf.line, ...(leaf.meta === undefined ? {} : { meta: leaf.meta }) });
      ctx.builder.addEdge({ from: leaf.from, to: id, type: 'calls', confidence: 'static', file: FILE, line: leaf.line });
    }
    extra(ctx);
  });

const extract = (leaves: readonly Played[], options: { config?: unknown; extra?: Extra } = {}): Promise<RepoGraph> =>
  extractRepo({
    rootDir: FIXTURE,
    repo: 'loop',
    extraPasses: [playing(leaves, options.extra)],
    ...(options.config === undefined ? {} : { config: parseConfig(options.config) }),
  });

const loopRows = (graph: RepoGraph): Unresolved[] => graph.unresolved.filter((row) => row.reason === 'query-in-loop');

const statsOf = (graph: RepoGraph): Record<string, unknown> =>
  (graph.nodes.find((node) => node.type === 'repo')?.meta?.['stats'] ?? {}) as Record<string, unknown>;

/** The for-of in `byIdsOneByOne` starts on line 16; its body is lines 17 and 18. */
const inOneByOne = (type: Played['type'], column: number, meta?: Record<string, unknown>, line = 17): Played => ({
  type,
  from: ONE_BY_ONE,
  line,
  column,
  ...(meta === undefined ? {} : { meta }),
});

/**
 * Ways in, played too: no entry adapter is registered here. One handles the
 * method with the loop; a second, when asked, handles another method that calls it.
 */
const ONE = 'entry:loop:test:one';
const TWO = 'entry:loop:test:two';
const OTHER = `loop#${FILE}:OrdersService.byIdsTogether`;
const wayIn = (id: string, to: string): Extra => (ctx) => {
  ctx.builder.addNode({ id, type: 'entry', label: id, repo: ctx.repo, kind: 'test' });
  ctx.builder.addEdge({ from: id, to, type: 'handles', confidence: 'static' });
};

describe('a query run once per item of a loop', () => {
  let graph: RepoGraph;
  beforeAll(async () => {
    graph = await extract([inOneByOne('db_query', 27), inOneByOne('cache_op', 33), inOneByOne('producer', 7, undefined, 18)], {
      extra: wayIn(ONE, ONE_BY_ONE),
    });
  });

  it('is one finding per loop at info, at the loop line, naming every leaf it reaches', () => {
    const rows = loopRows(graph);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ file: FILE, line: 16, level: 'info', sites: 1, symbol: ONE_BY_ONE });
    expect(row?.message).toBe('A `for-of` loop runs 1 database query, 1 cache call and 1 publish once per item: likely N+1.');
    expect(row?.meta?.['reaches']).toEqual([
      { id: `db_query:loop#${FILE}:17:27`, type: 'db_query', words: 'database query' },
      { id: `cache_op:loop#${FILE}:17:33`, type: 'cache_op', words: 'cache call' },
      { id: `producer:loop#${FILE}:18:7`, type: 'producer', words: 'publish' },
    ]);
    expect(row?.meta?.['severity']).toBe('likely');
    expect(row === undefined ? undefined : kindOfRow(row)).toBe('finding');
    expect(row === undefined ? undefined : wasMissed(row)).toBe(false);
    expect(countsOf(rows)).toEqual({ missed: 0, sites: 0, notes: 0, findings: 1, nothing: 0 });
  });

  it('counts the ways in of this service that reach the loop', () => {
    expect(loopRows(graph)[0]?.meta).toMatchObject({ waysIn: 1, entries: [ONE] });
  });
});

describe('a loop reaching many leaves', () => {
  it(`names the nearest ${MOST_REACHED} and counts the rest`, async () => {
    const leaves = Array.from({ length: MOST_REACHED + 2 }, (_, i) => inOneByOne('db_query', 27 + i));
    const [row] = loopRows(await extract(leaves));
    expect(row?.meta?.['reaches']).toHaveLength(MOST_REACHED);
    expect(row?.meta?.['reachesCut']).toBe(2);
    expect(row?.message).toContain(`runs ${MOST_REACHED + 2} database queries once per item`);
  });
});

describe('ways in', () => {
  it('counts two routes that reach one service method', async () => {
    const graph = await extract([inOneByOne('db_query', 27)], {
      extra: (ctx) => {
        wayIn(ONE, ONE_BY_ONE)(ctx);
        wayIn(TWO, OTHER)(ctx);
        ctx.builder.addEdge({ from: OTHER, to: ONE_BY_ONE, type: 'calls', confidence: 'static', file: FILE, line: 25 });
      },
    });
    expect(loopRows(graph).find((row) => row.symbol === ONE_BY_ONE)?.meta).toMatchObject({ waysIn: 2, entries: [ONE, TWO] });
  });
});

describe('per item on purpose', () => {
  it('is a note when every leaf is a conditional write or a send to one recipient', async () => {
    const graph = await extract([inOneByOne('db_query', 27, { conditional: true }), inOneByOne('producer', 33, { perItem: true })]);
    const [row] = loopRows(graph);
    expect(row?.meta?.['severity']).toBe('note');
    expect(row === undefined ? undefined : kindOfRow(row)).toBe('note');
    expect(row?.level).toBe('info');
    expect(row?.message).toContain('per item on purpose');
  });

  it('is likely when one leaf is a conditional write and another a plain read', async () => {
    const [row] = loopRows(await extract([inOneByOne('db_query', 27, { conditional: true }), inOneByOne('db_query', 33)]));
    expect(row?.meta?.['severity']).toBe('likely');
  });

  it('is a note through a helper named under callShape.conditionalWrites', async () => {
    const leaf: Played = { type: 'db_query', from: SAVE_ONE, line: 48, column: 12 };
    const plain = loopRows(await extract([leaf])).find((row) => row.symbol === SAVE_ALL);
    expect(plain?.meta?.['severity']).toBe('likely');
    const guarded = loopRows(await extract([leaf], { config: { callShape: { conditionalWrites: ['saveOne'] } } })).find(
      (row) => row.symbol === SAVE_ALL,
    );
    expect(guarded?.meta?.['severity']).toBe('note');
    expect(guarded?.meta?.['reaches']).toEqual([{ id: `db_query:loop#${FILE}:48:12`, type: 'db_query', words: 'database query', via: SAVE_ONE }]);
  });

  it('is a note for a request to a host named under callShape.perItemHosts', async () => {
    const leaves = [inOneByOne('http_out', 27, { host: 'mail.example.test' })];
    expect(loopRows(await extract(leaves))[0]?.meta?.['severity']).toBe('likely');
    const config = { callShape: { perItemHosts: ['mail.example.test'] } };
    expect(loopRows(await extract(leaves, { config }))[0]?.meta?.['severity']).toBe('note');
  });
});

describe('a loop around nothing but batch calls', () => {
  it('writes no row, marks its edges and is counted', async () => {
    const graph = await extract([inOneByOne('producer', 27, { batch: true }), inOneByOne('db_query', 33, { batch: true })]);
    expect(loopRows(graph).filter((row) => row.symbol === ONE_BY_ONE)).toEqual([]);
    const marks = graph.edges.filter((edge) => edge.from === ONE_BY_ONE && edge.meta?.['inLoop'] !== undefined).map((edge) => edge.meta?.['inLoop']);
    expect(marks).toEqual([
      { kind: 'for-of', line: 16, bounded: 'batch-call' },
      { kind: 'for-of', line: 16, bounded: 'batch-call' },
    ]);
    expect(statsOf(graph)['loopsBounded']).toEqual({ 'batch-call': 1 });
  });

  it('is listed when one leaf is not a batch', async () => {
    const graph = await extract([inOneByOne('producer', 27, { batch: true }), inOneByOne('db_query', 33)]);
    expect(loopRows(graph).filter((row) => row.symbol === ONE_BY_ONE)).toHaveLength(1);
    expect(statsOf(graph)['loopsBounded']).toBeUndefined();
  });
});
