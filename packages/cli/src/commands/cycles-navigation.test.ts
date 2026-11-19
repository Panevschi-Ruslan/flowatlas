import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openGraphDb } from '@flowatlas/linker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadGraph } from '../analysis/graph.js';
import { tarjanScc } from '../analysis/scc.js';
import { buildProject } from './build.js';
import { CYCLE_EDGES, runCycles } from './cycles.js';
import { runDead } from './dead.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'nuxt-navigation', 'flowatlas.config.json');

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-navigation-'));
let db = '';

beforeAll(async () => {
  const result = await buildProject({ config: CONFIG, out: scratch, builtAt: '2026-01-01T00:00:00.000Z' });
  db = result.dbPath;
}, 180_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('a navigation between pages is no cycle (P265)', () => {
  it('reports none for pages that navigate to each other, though the navigations alone would close loops', () => {
    // The orders list and an order link to each other, and a sign-in page and the start page redirect back and forth.
    const graph = openGraphDb(db);
    try {
      const withNavigations = tarjanScc(loadGraph(graph, { edgeTypes: [...CYCLE_EDGES], collapseChannels: true }), { minLength: 2 });
      expect(withNavigations.length).toBeGreaterThan(0);
    } finally {
      graph.close();
    }
    expect(runCycles({ db }).result.cycles).toEqual([]);
  });

  it('still counts a page a link reaches as reached', async () => {
    const { result } = await runDead({ db });
    const dead = JSON.stringify(result);
    expect(dead).not.toContain('pages/receipts/[id].vue');
  });
});
