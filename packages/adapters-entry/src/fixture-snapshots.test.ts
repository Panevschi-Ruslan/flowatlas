import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What stands in front of a way in is said one way, in every committed snapshot.
 *
 * R109 made it an edge: a `middleware` node and a `guarded_by` edge whose
 * `meta.order` is the position in the chain, drawn by the one helper every
 * reader hands a `wrapping` to. Two readers built on branches that ran beside
 * that change went on writing the old list, `meta.middleware`, and seven routes
 * in two fixtures read as having nothing in front of them to everything that
 * reads edges — the route audit, the blast radius, the `flow` query. Nothing
 * failed, because nothing asked.
 *
 * This asks, of every snapshot rather than of the two that had it, because the
 * next reader to repeat it will be a new one and its fixture will be new too.
 */
const FIXTURES = fileURLToPath(new URL('../../../fixtures', import.meta.url));
const SNAPSHOTS = ['expected.graph.json', 'expected.project-graph.json'];

interface Snapshot {
  nodes?: ReadonlyArray<{ id: string; meta?: Record<string, unknown> }>;
}

const snapshots = (): Array<{ path: string; graph: Snapshot }> =>
  readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => SNAPSHOTS.map((name) => join(FIXTURES, entry.name, name)))
    .filter((path) => existsSync(path))
    .map((path) => ({ path, graph: JSON.parse(readFileSync(path, 'utf8')) as Snapshot }));

describe('the committed fixture snapshots', () => {
  it('are there to be read, so an empty pass cannot pass', () => {
    expect(snapshots().length).toBeGreaterThan(10);
  });

  it('carry no chain as a list on a node, only as guarded_by edges (R109)', () => {
    const listed = snapshots().flatMap(({ path, graph }) =>
      (graph.nodes ?? [])
        .filter((node) => node.meta !== undefined && 'middleware' in node.meta)
        .map((node) => `${path.slice(FIXTURES.length + 1)}: ${node.id}`),
    );
    expect(listed).toEqual([]);
  });
});
