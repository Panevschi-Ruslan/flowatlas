import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FLOW_DEPTH, REVERSE_EDGES, walkBack } from '@flowatlas/mcp';
import type { GraphDb } from '@flowatlas/linker';
import { openDbFromOptions } from '../db.js';
import { createModel, upstream } from './graph.js';
import { packGraph } from './pack.js';

const ROOT = resolve(import.meta.dirname, '../../../..');

/**
 * The page's impact walk is the linker's walk back along the edges a call
 * runs over, drawn: so for every node of a fixture the two must name the
 * same entry points, reach the same number of nodes, and stop in the same
 * services. `flowatlas impact` answers as the graph server's tool does since
 * P370, walking past each way in to the callers beyond it, which is a wider
 * question than the page's panel asks. The largest project fixture; one whose
 * workflows lengthen the walk by the steps it climbs; one joined by channels.
 */
const FIXTURES = ['multi-repo', 'multi-repo-stepfunctions', 'multi-repo-events'];

const pageFor = (config: string) => {
  const db = openDbFromOptions({ config });
  try {
    const nodes = db.allNodes();
    const report = db.report();
    if (report === undefined) throw new Error(`no report for ${config}; run the fixtures first`);
    const packed = packGraph({ builtAt: '', nodes, edges: db.allEdges(), unresolved: db.allUnresolved(), report });
    return { ids: nodes.map((node) => node.id), packed, model: createModel(packed) };
  } finally {
    db.close();
  }
};

/** What the linker's walk back reaches from a node, as the page's panel counts it. */
const walkFor = (db: GraphDb, id: string) => {
  const target = db.node(id);
  const traverse = (maxDepth: number) => db.traverse({ from: id, direction: 'in', edgeTypes: REVERSE_EDGES, maxDepth, maxNodes: 1_000_000 });
  const walk = walkBack(DEFAULT_FLOW_DEPTH, traverse);
  const entries = new Set<string>();
  const services = new Set<string>(target === undefined ? [] : [target.repo]);
  const entryServices = new Set<string>();
  const reached = new Set<string>();
  for (const row of walk.rows) {
    if (row.depth === 0) continue;
    reached.add(row.id);
    const node = db.node(row.id);
    if (node === undefined) continue;
    services.add(node.repo);
    if (node.type === 'entry') {
      entries.add(node.id);
      entryServices.add(node.repo);
    }
  }
  return {
    reached: reached.size,
    entries: [...entries],
    services: [...services],
    servicesWithoutEntry: [...services].filter((name) => !entryServices.has(name)),
    truncated: walk.truncated,
  };
};

describe("impact in the page agrees with the linker's walk back", () => {
  for (const fixture of FIXTURES) {
    it(`for every node of ${fixture}`, () => {
      const config = join(ROOT, 'fixtures', fixture, 'flowatlas.config.json');
      const { ids, packed, model } = pageFor(config);
      const repos = packed.dicts.repos;
      let withEntries = 0;
      const db = openDbFromOptions({ config });
      ids.forEach((id, i) => {
        const command = walkFor(db, id);
        expect(command.truncated, id).toBeFalsy();
        const page = upstream(model, i);
        expect({
          id,
          reached: page.reached,
          entries: page.entries.map((v) => ids[v]).sort(),
          services: page.services.map((s) => repos[s]).sort(),
          withoutEntry: page.withoutEntry.map((s) => repos[s]).sort(),
        }).toEqual({
          id,
          reached: command.reached,
          entries: [...command.entries].sort(),
          services: [...command.services].sort(),
          withoutEntry: [...command.servicesWithoutEntry].sort(),
        });
        if (command.entries.length > 0) withEntries += 1;
      });
      db.close();
      // A comparison of empty answers would agree about nothing.
      expect(withEntries).toBeGreaterThan(5);
    });
  }

  it('lengthens the walk by the steps it climbs, as the command does', () => {
    const { packed } = pageFor(join(ROOT, 'fixtures', 'multi-repo-stepfunctions', 'flowatlas.config.json'));
    expect(packed.steps.length).toBeGreaterThan(0);
  });
});
