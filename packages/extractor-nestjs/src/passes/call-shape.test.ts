import { resolve } from 'node:path';
import { countsOf, kindOfRow, wasMissed, type RepoGraph } from '@flowatlas/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractRepo } from '../extract-repo.js';
import { definePass } from './types.js';

/**
 * P69's row, at the level P81 gave it back.
 *
 * The data-layer reader is not a dependency of this package, so the query it
 * would find is played here by a pass that adds the one leaf the fixture's
 * `byIdsOneByOne` runs per item. The fixture's own snapshot is the same
 * question asked with the real reader.
 */
const FIXTURE = resolve(import.meta.dirname, '../../../../fixtures/nest-query-loop');
const FILE = 'src/orders/orders.service.ts';
const METHOD = `loop#${FILE}:OrdersService.byIdsOneByOne`;
const LEAF = `db_query:loop#${FILE}:17:27`;

const playQuery = definePass('play-query', (ctx) => {
  if (!ctx.builder.has(METHOD)) return;
  ctx.builder.addNode({ id: LEAF, type: 'db_query', label: 'findOne orders', repo: ctx.repo, file: FILE, line: 17 });
  ctx.builder.addEdge({ from: METHOD, to: LEAF, type: 'calls', confidence: 'static', file: FILE, line: 17 });
});

let graph: RepoGraph;

beforeAll(async () => {
  graph = await extractRepo({ rootDir: FIXTURE, repo: 'loop', extraPasses: [playQuery] });
});

describe('a query run once per item of a loop', () => {
  it('is a finding at info: likely, never a miss, and not a place with nothing to join', () => {
    const row = graph.unresolved.find((item) => item.reason === 'query-in-loop');
    expect(row).toMatchObject({ file: FILE, line: 17, level: 'info', sites: 1, symbol: METHOD });
    expect(row === undefined ? undefined : kindOfRow(row)).toBe('finding');
    expect(row === undefined ? undefined : wasMissed(row)).toBe(false);
    expect(countsOf(graph.unresolved.filter((item) => item.reason === 'query-in-loop'))).toEqual({
      missed: 0,
      sites: 0,
      notes: 0,
      findings: 1,
      nothing: 0,
    });
  });
});
