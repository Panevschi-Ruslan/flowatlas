import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runImpact } from '../commands/impact.js';
import { openDbFromOptions } from '../db.js';
import { createModel, upstream } from './graph.js';
import { packGraph } from './pack.js';

const ROOT = resolve(import.meta.dirname, '../../../..');

/**
 * The page's impact walk is `flowatlas impact` drawn, so for every node of a
 * fixture the two must name the same entry points, reach the same number of
 * nodes, and stop in the same services. The largest project fixture; one whose
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

const commandFor = (config: string, id: string) => {
  let text = '';
  runImpact(id, { config, format: 'json', maxNodes: '1000000' }, { out: (chunk) => void (text += chunk), err: () => {} });
  return JSON.parse(text) as {
    reached: number;
    entries: string[];
    services: string[];
    servicesWithoutEntry: string[];
    truncated?: string;
  };
};

describe('impact in the page agrees with flowatlas impact', () => {
  for (const fixture of FIXTURES) {
    it(`for every node of ${fixture}`, () => {
      const config = join(ROOT, 'fixtures', fixture, 'flowatlas.config.json');
      const { ids, packed, model } = pageFor(config);
      const repos = packed.dicts.repos;
      let withEntries = 0;
      ids.forEach((id, i) => {
        const command = commandFor(config, id);
        expect(command.truncated, id).toBeUndefined();
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
      // A comparison of empty answers would agree about nothing.
      expect(withEntries).toBeGreaterThan(5);
    });
  }

  it('lengthens the walk by the steps it climbs, as the command does', () => {
    const { packed } = pageFor(join(ROOT, 'fixtures', 'multi-repo-stepfunctions', 'flowatlas.config.json'));
    expect(packed.steps.length).toBeGreaterThan(0);
  });
});
