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
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EDGE_TYPES } from '@flowatlas/core';
import {
  SPOKEN_FOR_BY,
  clonePaths,
  overFixture,
  readGate,
  serviceOfEdge,
  sourceUnder,
} from './read-gate.mjs';

const PACKAGES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages');

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

  it('places the site in the service at the other end', () => {
    assert.equal(serviceOfEdge(graph.edges[0], new Map(graph.nodes.map((node) => [node.id, node]))), 'worker');
    assert.deepEqual(gate(sites('apps/worker/src/projections.ts'), graph).unplaced, []);
  });

  it('speaks for no family of that file, since no family owns `consumes` (R160)', () => {
    // Before R160 this edge counted the worker's file as read for its routes.
    const result = gate(sites('apps/worker/src/projections.ts', 'apps/api/src/projections.ts'), graph);
    assert.deepEqual(unread(result), ['apps/api/src/projections.ts', 'apps/worker/src/projections.ts']);
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

/** A measurement with sites of the named families, one entry per file. */
const measured = (entries) =>
  new Map(entries.map(([path, ...families]) => [path, Object.fromEntries(families.map((family) => [family, 1]))]));

/** Which family went unread in which file, as `path family`. */
const unreadRows = (result) => result.missing.map((row) => `${row.path} ${row.family}`);

describe('an edge speaks only for its own family (R160)', () => {
  // A repository file with query sites and no query node, in which one
  // function calls another. The call says the reader was in the file; it says
  // nothing about whether the data reader was.
  const calls = {
    nodes: [
      { id: 'api#src/repo.ts:Repo.find', type: 'method', repo: 'api', file: 'src/repo.ts', line: 3 },
      { id: 'api#src/repo.ts:Repo.map', type: 'method', repo: 'api', file: 'src/repo.ts', line: 9 },
    ],
    edges: [
      {
        from: 'api#src/repo.ts:Repo.find',
        to: 'api#src/repo.ts:Repo.map',
        type: 'calls',
        file: 'src/repo.ts',
        line: 4,
      },
    ],
    unresolved: [],
  };

  it('fails a data file whose only edge is a call', () => {
    const result = gate(measured([['apps/api/src/repo.ts', 'data']]), calls);
    assert.deepEqual(unreadRows(result), ['apps/api/src/repo.ts data']);
  });

  it('passes a data file whose edge is a query', () => {
    // The query node is filed elsewhere on purpose: the edge alone answers.
    const graph = {
      nodes: [
        { id: 'db_query:api#src/db.ts:1:1', type: 'db_query', repo: 'api', file: 'src/db.ts', line: 1 },
        { id: 'table:api#Order', type: 'table', repo: 'api' },
      ],
      edges: [
        { from: 'db_query:api#src/db.ts:1:1', to: 'table:api#Order', type: 'queries', file: 'src/repo.ts', line: 4 },
      ],
      unresolved: [],
    };
    const result = gate(measured([['apps/api/src/repo.ts', 'data']]), graph);
    assert.deepEqual(unreadRows(result), []);
  });

  it('lets an edge speak for a family only through a node of that family', () => {
    // `handles` is the routes family's kind when it runs from an entry, and a
    // message consumer's or a button's when it runs from one of those.
    const graph = {
      nodes: [
        { id: 'consumer:api#src/jobs.ts:J.run', type: 'consumer', repo: 'api' },
        { id: 'entry:api:http:GET /jobs', type: 'entry', repo: 'api' },
        { id: 'api#src/jobs.ts:J.run', type: 'method', repo: 'api' },
      ],
      edges: [
        {
          from: 'consumer:api#src/jobs.ts:J.run',
          to: 'api#src/jobs.ts:J.run',
          type: 'handles',
          file: 'src/jobs.ts',
          line: 2,
        },
        {
          from: 'entry:api:http:GET /jobs',
          to: 'api#src/jobs.ts:J.run',
          type: 'handles',
          file: 'src/http.ts',
          line: 2,
        },
      ],
      unresolved: [],
    };
    const result = gate(
      measured([
        ['apps/api/src/jobs.ts', 'routes'],
        ['apps/api/src/http.ts', 'routes'],
      ]),
      graph,
    );
    assert.deepEqual(unreadRows(result), ['apps/api/src/jobs.ts routes']);
  });

  it('lets an edge of a kind no family owns speak for nothing', () => {
    const graph = {
      nodes: [
        { id: 'api#src/boot.ts:bootstrap', type: 'function', repo: 'api' },
        { id: 'config_key:api#PORT', type: 'config_key', repo: 'api' },
      ],
      edges: [
        {
          from: 'api#src/boot.ts:bootstrap',
          to: 'config_key:api#PORT',
          type: 'reads_config',
          file: 'src/boot.ts',
          line: 5,
        },
      ],
      unresolved: [],
    };
    const result = gate(measured([['apps/api/src/boot.ts', 'routes', 'data']]), graph);
    assert.deepEqual(unreadRows(result), ['apps/api/src/boot.ts data', 'apps/api/src/boot.ts routes']);
  });

  it('names every edge kind of the model, and only those, in the table', () => {
    assert.deepEqual([...SPOKEN_FOR_BY.edges.keys()].sort(), [...EDGE_TYPES].sort());
  });
});

describe('a row speaks only for the family its reason belongs to (R160)', () => {
  const row = (reason) => ({
    nodes: [],
    edges: [],
    unresolved: [{ file: 'src/a.ts', line: 1, reason, service: 'api' }],
  });
  const both = measured([['apps/api/src/a.ts', 'routes', 'data']]);

  it('speaks for data when the reader of data gave up, and not for routes', () => {
    assert.deepEqual(unreadRows(gate(both, row('unknown-db-package'))), ['apps/api/src/a.ts routes']);
  });

  it('speaks for routes when the reader of routes gave up, and not for data', () => {
    assert.deepEqual(unreadRows(gate(both, row('route-path-dynamic'))), ['apps/api/src/a.ts data']);
  });

  it('speaks for nothing when its reason belongs to no family', () => {
    assert.deepEqual(unreadRows(gate(both, row('call-dynamic-receiver'))), [
      'apps/api/src/a.ts data',
      'apps/api/src/a.ts routes',
    ]);
  });

  it('names only reasons some reader in this repository writes', () => {
    // A misspelt reason in the table would speak for nothing, silently. Every
    // one must appear as a literal in a package's source.
    const source = readdirSync(PACKAGES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => sourceUnder(join(PACKAGES, entry.name, 'src')).map(([, text]) => text))
      .join('\n');
    for (const reason of SPOKEN_FOR_BY.reasons.keys()) assert.ok(source.includes(`'${reason}'`), reason);
  });

  it('speaks for every family when the file could not be parsed at all', () => {
    assert.deepEqual(unreadRows(gate(both, row('file-not-parsed'))), []);
  });

  it('does not take a reason named like something every object has', () => {
    assert.deepEqual(unreadRows(gate(both, row('constructor'))), [
      'apps/api/src/a.ts data',
      'apps/api/src/a.ts routes',
    ]);
  });
});

/**
 * A project where `billing` is an OpenAPI document. Its entries, the methods
 * behind them and the `handles` edges between them are filed at the document,
 * which is not source, and its directory is wherever the document lives.
 */
const declaredProject = {
  services: [
    { name: 'api', repo: './api', type: 'nestjs' },
    { name: 'billing', repo: './contracts', type: 'declared' },
  ],
  nodes: [
    { id: 'entry:api:http:GET /a', type: 'entry', repo: 'api', file: 'src/a.ts', line: 1 },
    { id: 'entry:billing:http:GET /invoices', type: 'entry', repo: 'billing', file: 'src/b.ts', line: 1 },
    { id: 'billing#GET /invoices', type: 'method', repo: 'billing', file: 'contracts/billing.json', line: 1 },
  ],
  edges: [
    {
      from: 'entry:billing:http:GET /invoices',
      to: 'billing#GET /invoices',
      type: 'handles',
      file: 'contracts/billing.json',
      line: 1,
    },
  ],
  unresolved: [{ file: 'contracts/billing.json', line: 1, reason: 'route-path-dynamic', service: 'billing' }],
};

describe('a service declared only by a document (R160)', () => {
  const run = (perFile) =>
    readGate({
      where: 'r160-test',
      perFile,
      graph: declaredProject,
      toPath: clonePaths([
        { name: 'api', repo: 'api' },
        { name: 'billing', repo: 'contracts' },
      ]),
    });

  it('sets its output aside rather than placing it or calling it unplaced', () => {
    const result = run(measured([['api/src/a.ts', 'routes']]));
    assert.deepEqual(unreadRows(result), []);
    assert.deepEqual(result.unplaced, []);
    assert.deepEqual(result.documentOnly, { services: ['billing'], nodes: 2, edges: 1, rows: 1 });
  });

  it('lets none of it speak for a source file that shares its path', () => {
    const result = run(measured([['contracts/src/b.ts', 'routes']]));
    assert.deepEqual(unreadRows(result), ['contracts/src/b.ts routes']);
  });
});

describe('a fixture that keeps only a project graph (R160)', () => {
  it('is gated, each service read relative to its own directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r160-'));
    try {
      mkdirSync(join(dir, 'fx', 'api', 'src'), { recursive: true });
      mkdirSync(join(dir, 'fx', 'contracts'), { recursive: true });
      writeFileSync(join(dir, 'fx', 'api', 'src', 'a.ts'), "app.get('/a', handler);\n");
      writeFileSync(join(dir, 'fx', 'api', 'src', 'b.ts'), "router.post('/b', handler);\n");
      writeFileSync(join(dir, 'fx', 'contracts', 'billing.json'), '{}\n');
      writeFileSync(join(dir, 'fx', 'expected.project-graph.json'), JSON.stringify(declaredProject));
      const results = overFixture('fx', dir);
      assert.deepEqual(
        results.map((result) => result.graph),
        ['expected.project-graph.json'],
      );
      assert.deepEqual(unreadRows(results[0]), ['api/src/b.ts routes']);
      assert.deepEqual(results[0].unplaced, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
