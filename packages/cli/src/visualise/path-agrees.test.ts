import { join, resolve } from 'node:path';
import { findPath } from '@flowatlas/mcp';
import { describe, expect, it } from 'vitest';
import { openDbFromOptions } from '../db.js';
import { createModel, EDGE, shortestPath, UPSTREAM } from './graph.js';
import { packGraph } from './pack.js';

const ROOT = resolve(import.meta.dirname, '../../../..');

/**
 * The page's path finder and `flowatlas path` ask one search, core's
 * `shortestWays` (P229), so with the page showing the edges a flow walks they
 * must find the same paths: from every way in to every node of a fixture,
 * the same answer, the same length, the same count and the same nodes. The
 * largest project fixture, and one joined by channels.
 */
const FIXTURES = ['multi-repo', 'multi-repo-events'];

const loaded = (config: string) => {
  const db = openDbFromOptions({ config });
  const nodes = db.allNodes();
  const report = db.report();
  if (report === undefined) throw new Error(`no report for ${config}; run the fixtures first`);
  const packed = packGraph({ builtAt: '', nodes, edges: db.allEdges(), unresolved: db.allUnresolved(), report });
  return { db, ids: nodes.map((node) => node.id), model: createModel(packed) };
};

describe('a path in the page agrees with flowatlas path', () => {
  for (const fixture of FIXTURES) {
    it(`from every way in to every node of ${fixture}`, () => {
      const { db, ids, model } = loaded(join(ROOT, 'fixtures', fixture, 'flowatlas.config.json'));
      try {
        const walked = new Set(model.data.dicts.edgeTypes.flatMap((name, k) => (UPSTREAM.includes(name) ? [k] : [])));
        const filter = { node: () => true, edge: (k: number) => walked.has(model.edges[k]![EDGE.type]!), active: true };
        let found = 0;
        ids.forEach((fromId, from) => {
          if (!fromId.startsWith('entry:')) return;
          ids.forEach((toId, to) => {
            const page = shortestPath(model, { from, to, filter, depth: 24, cap: 1000 });
            const command = findPath(db, fromId, toId, { depth: 24, maxNodes: 1000 });
            const nodesOf = (row: { node: { id: string; ref?: boolean }; children: unknown[] }): string[] => [
              ...(row.node.ref === true ? [] : [row.node.id]),
              ...row.children.flatMap((child) => nodesOf(child as typeof row)),
            ];
            expect(
              { from: fromId, to: toId, found: command.found, length: command.length, paths: command.paths, nodes: nodesOf(command.root).sort() },
            ).toEqual({
              from: fromId,
              to: toId,
              found: page.found,
              length: page.length,
              paths: page.paths,
              nodes: page.found ? page.nodes.map((v) => ids[v]!).sort() : [fromId],
            });
            if (page.found && from !== to) found += 1;
          });
        });
        // A fixture whose ways in reach nothing would agree vacuously.
        expect(found).toBeGreaterThan(20);
      } finally {
        db.close();
      }
    });
  }
});
