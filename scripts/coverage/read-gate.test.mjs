/**
 * The read gate's own tests (R154).
 *
 * The fixtures exercise the gate over graphs this repository already keeps, and
 * every one of them is a single service at the root of its tree, so a path the
 * graph spells relative to a service and a path the counting rule spells
 * relative to the clone are the same string there. The harness is where they
 * differ, and nothing checked the difference until an edge's site was found
 * joined to the clone rather than to the service that drew it. These build the
 * graph by hand, with services that are not at `.`, which is the case the
 * fixtures cannot reach.
 *
 *   node --test scripts/coverage/read-gate.test.mjs
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clonePaths, readGate } from './read-gate.mjs';

const SERVICES = [
  { name: 'api', repo: 'apps/api' },
  { name: 'worker', repo: 'apps/worker' },
];

/** A measurement with sites of one family in each named file. */
const sites = (...paths) => new Map(paths.map((path) => [path, { routes: 1 }]));

const gate = (perFile, graph) =>
  readGate({ where: 'r154-test', state: 'fresh', perFile, graph, toPath: clonePaths(SERVICES) });

const unread = (result) => result.missing.map((row) => row.path);

describe('clonePaths', () => {
  it('joins a path to the directory of the service that read it', () => {
    const toPath = clonePaths([...SERVICES, { name: 'root', repo: '.' }]);
    assert.equal(toPath('src/a.ts', 'api'), 'apps/api/src/a.ts');
    assert.equal(toPath('../../packages/lib/b.ts', 'api'), 'packages/lib/b.ts');
    assert.equal(toPath('src/a.ts', 'root'), 'src/a.ts');
  });

  it('places nothing for a service it was not given, rather than at the root', () => {
    const toPath = clonePaths(SERVICES);
    assert.equal(toPath('src/a.ts', 'elsewhere'), undefined);
    assert.equal(toPath('src/a.ts', undefined), undefined);
    // A service named like something every object already has is still unknown.
    assert.equal(toPath('src/a.ts', 'constructor'), undefined);
  });
});

describe('an edge site in a service not at the root', () => {
  // `src/app.ts` declares the route and yields the entry. The controller's
  // only output is the `handles` edge recorded at its method.
  const graph = {
    nodes: [
      { id: 'entry:api:http:GET /orders', type: 'entry', repo: 'api', file: 'src/app.ts', line: 3 },
      { id: 'api#src/orders.controller.ts:Orders.list', type: 'method', repo: 'api' },
    ],
    edges: [
      {
        from: 'entry:api:http:GET /orders',
        to: 'api#src/orders.controller.ts:Orders.list',
        type: 'handles',
        file: 'src/orders.controller.ts',
        line: 7,
      },
    ],
    unresolved: [],
  };

  it('counts the file whose only output is an edge as read', () => {
    const result = gate(sites('apps/api/src/app.ts', 'apps/api/src/orders.controller.ts'), graph);
    assert.deepEqual(unread(result), []);
    assert.deepEqual(result.unplaced, []);
  });

  it('does not count a file at the clone root that shares the service-relative name', () => {
    const result = gate(sites('apps/api/src/app.ts', 'src/orders.controller.ts'), graph);
    assert.deepEqual(unread(result), ['src/orders.controller.ts']);
  });
});

describe('an edge whose source belongs to no one service', () => {
  // A channel is one node for the whole project and its `repo` is whichever
  // service the merge met first. The consumer's site is in the worker.
  const graph = {
    nodes: [
      { id: 'channel:orders:created', type: 'channel', repo: 'api', file: 'src/orders.ts', line: 2 },
      { id: 'producer:api#src/orders.ts:2:1', type: 'producer', repo: 'api', file: 'src/orders.ts', line: 2 },
      { id: 'consumer:worker#src/projections.ts:P.onCreated', type: 'consumer', repo: 'worker' },
    ],
    edges: [
      {
        from: 'channel:orders:created',
        to: 'consumer:worker#src/projections.ts:P.onCreated',
        type: 'consumes',
        file: 'src/projections.ts',
        line: 9,
      },
    ],
    unresolved: [],
  };

  it('reads the site relative to the service at the other end', () => {
    const result = gate(sites('apps/worker/src/projections.ts', 'apps/api/src/projections.ts'), graph);
    assert.deepEqual(unread(result), ['apps/api/src/projections.ts']);
    assert.deepEqual(result.unplaced, []);
  });
});

describe('an edge the gate cannot place', () => {
  it('says so, and does not count a file at the clone root as read', () => {
    const graph = {
      nodes: [],
      edges: [{ from: 'api#gone.ts:f', to: 'api#gone.ts:g', type: 'calls', file: 'src/a.ts', line: 1 }],
      unresolved: [],
    };
    const result = gate(sites('src/a.ts', 'apps/api/src/a.ts'), graph);
    assert.deepEqual(unread(result), ['apps/api/src/a.ts', 'src/a.ts']);
    assert.deepEqual(result.unplaced, [{ what: 'edge', file: 'src/a.ts', service: undefined }]);
  });

  it('says so for a node or a row of a service the harness did not configure', () => {
    const graph = {
      nodes: [{ id: 'other#src/a.ts:f', type: 'entry', repo: 'other', file: 'src/a.ts', line: 1 }],
      edges: [],
      unresolved: [{ file: 'src/b.ts', line: 1, reason: 'x', service: 'other' }],
    };
    const result = gate(new Map(), graph);
    assert.deepEqual(result.unplaced, [
      { what: 'node', file: 'src/a.ts', service: 'other' },
      { what: 'row', file: 'src/b.ts', service: 'other' },
    ]);
  });
});
