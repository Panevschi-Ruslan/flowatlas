import {
  SCHEMA_VERSION,
  parseConfig,
  type FlowatlasConfig,
  type GraphNode,
  type RepoGraph,
} from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';

const FIXED = '2026-01-01T00:00:00.000Z';

const config = (apiTarget?: Record<string, string>): FlowatlasConfig =>
  parseConfig({
    services: [
      { name: 'api', repo: './api', type: 'nextjs' },
      { name: 'admin', repo: './admin', type: 'nextjs' },
      { name: 'web', repo: './web', type: 'react', ...(apiTarget === undefined ? {} : { apiTarget }) },
    ],
  } as Parameters<typeof parseConfig>[0]);

const graph = (repo: string, nodes: GraphNode[]): RepoGraph => ({
  schemaVersion: SCHEMA_VERSION,
  repo,
  generatedAt: FIXED,
  nodes,
  edges: [],
  types: {},
  unresolved: [],
});

const procedure = (repo: string, key: string, call = 'query'): GraphNode => ({
  id: `entry:${repo}:rpc:${key}`,
  type: 'entry',
  kind: 'rpc',
  label: `rpc ${key}`,
  repo,
  meta: { key, call },
});

/** A message handler listening on a string that reads like a procedure path. */
const pattern = (repo: string, key: string): GraphNode => ({
  id: `entry:${repo}:rpc:${key}`,
  type: 'entry',
  kind: 'rpc',
  label: `rpc ${key}`,
  repo,
  meta: { pattern: key },
});

const ask = (repo: string, path: string | null, call = 'query'): GraphNode => ({
  id: `ui_api_call:${repo}#src/orders.ts:3:10`,
  type: 'ui_api_call',
  kind: 'rpc',
  label: `rpc ${path ?? '?'}`,
  repo,
  file: 'src/orders.ts',
  line: 3,
  meta: { procedure: path, call, operation: 'useQuery', client: 'described' },
});

const hitsOf = (graphs: RepoGraph[], cfg: FlowatlasConfig) => {
  const { project, report } = linkGraphs(graphs, cfg, { builtAt: FIXED });
  return {
    hits: project.edges.filter((edge) => edge.type === 'hits'),
    reasons: report.unresolved.map((row) => row.reason),
    rows: report.unresolved,
    ui: report.ui,
  };
};

describe('a request for a procedure', () => {
  it('joins the procedure of the same path in its own service', () => {
    const { hits, ui } = hitsOf(
      [graph('api', [procedure('api', 'orders.list'), ask('api', 'orders.list')])],
      config(),
    );
    expect(hits).toMatchObject([
      { to: 'entry:api:rpc:orders.list', confidence: 'static', meta: { via: 'same-service', targetService: 'api' } },
    ]);
    expect(ui).toMatchObject({ total: 1, resolved: 1, unresolved: 0 });
  });

  it('joins a service the configuration says it calls, and no other', () => {
    const graphs = [
      graph('api', [procedure('api', 'orders.list')]),
      graph('admin', [procedure('admin', 'orders.list')]),
      graph('web', [ask('web', 'orders.list')]),
    ];
    const { hits } = hitsOf(graphs, config({ API_URL: 'api' }));
    expect(hits.map((edge) => [edge.to, edge.meta?.['via']])).toEqual([
      ['entry:api:rpc:orders.list', 'api-target'],
    ]);
  });

  it('guesses nothing when the configuration names no service, and says who declares it', () => {
    const graphs = [
      graph('admin', [procedure('admin', 'orders.list')]),
      graph('web', [ask('web', 'orders.list')]),
    ];
    const { hits, rows, ui } = hitsOf(graphs, config());
    expect(hits).toEqual([]);
    expect(rows).toMatchObject([
      {
        reason: 'procedure-not-found',
        message: 'no procedure orders.list in web',
        hint: expect.stringContaining('admin declares it'),
      },
    ]);
    expect(ui.byReason).toEqual({ 'procedure-not-found': 1 });
  });

  it('never joins a message handler listening on the same string', () => {
    const { hits, reasons } = hitsOf(
      [graph('api', [pattern('api', 'orders.list'), ask('api', 'orders.list')])],
      config(),
    );
    expect(hits).toEqual([]);
    expect(reasons).toEqual(['procedure-not-found']);
  });

  it('joins, and says so, when the call asks for another ending than the one declared', () => {
    const { hits, rows } = hitsOf(
      [graph('api', [procedure('api', 'orders.list', 'query'), ask('api', 'orders.list', 'mutation')])],
      config(),
    );
    expect(hits).toHaveLength(1);
    expect(rows).toMatchObject([
      { reason: 'procedure-call-mismatch', message: 'orders.list is asked for as a mutation and declared as a query' },
    ]);
  });

  it('names both when two configured services declare it', () => {
    const graphs = [
      graph('api', [procedure('api', 'orders.list')]),
      graph('admin', [procedure('admin', 'orders.list')]),
      graph('web', [ask('web', 'orders.list')]),
    ];
    const { hits, rows } = hitsOf(graphs, config({ API_URL: 'api', ADMIN_URL: 'admin' }));
    expect(hits).toEqual([]);
    expect(rows).toMatchObject([{ reason: 'procedure-ambiguous', message: 'admin and api both declare orders.list' }]);
  });

  it('counts a path that was not read, without saying it twice', () => {
    const { hits, rows, ui } = hitsOf([graph('api', [procedure('api', 'orders.list'), ask('api', null)])], config());
    expect(hits).toEqual([]);
    expect(rows).toEqual([]);
    expect(ui.byReason).toEqual({ 'procedure-path-dynamic': 1 });
  });
});

describe('a request for an oRPC procedure (P58)', () => {
  const served = (repo: string, key: string, prefix = '/rpc'): GraphNode => ({
    ...procedure(repo, key, 'handler'),
    file: 'src/orders.ts',
    line: 12,
    meta: { key, call: 'handler', mounted: [{ protocol: 'rpc', prefix, file: 'src/app/rpc/route.ts' }] },
  });
  const sent = (repo: string, key: string, link: Record<string, unknown>): GraphNode => ({
    ...ask(repo, key, 'handler'),
    meta: { procedure: key, call: 'handler', operation: 'call', client: 'orpc-client', link },
  });

  it('goes where the link sends, of the services the caller names', () => {
    const graphs = [
      graph('api', [served('api', 'orders.list')]),
      graph('admin', [served('admin', 'orders.list')]),
      graph('web', [sent('web', 'orders.list', { protocol: 'rpc', path: '/rpc', baseUrlEnv: 'ADMIN_URL' })]),
    ];
    const { hits, rows } = hitsOf(graphs, config({ API_URL: 'api', ADMIN_URL: 'admin' }));
    expect(hits.map((edge) => [edge.to, edge.meta?.['via'], edge.confidence])).toEqual([
      ['entry:admin:rpc:orders.list', 'link-url', 'static'],
    ]);
    expect(rows).toEqual([]);
  });

  it('asks only the service the link names, and says who else declares it', () => {
    const graphs = [
      graph('api', [served('api', 'orders.list')]),
      graph('admin', []),
      graph('web', [sent('web', 'orders.list', { protocol: 'rpc', path: '/rpc', baseUrlEnv: 'ADMIN_URL' })]),
    ];
    const { hits, rows } = hitsOf(graphs, config({ API_URL: 'api', ADMIN_URL: 'admin' }));
    expect(hits).toEqual([]);
    expect(rows).toMatchObject([{ reason: 'procedure-not-found', message: 'no procedure orders.list in web or admin', hint: expect.stringContaining('api declares it') }]);
  });

  it('joins and says so when the link sends where no mount of its protocol answers', () => {
    const graphs = [
      graph('api', [served('api', 'orders.list', '/rpc')]),
      graph('web', [sent('web', 'orders.list', { protocol: 'rpc', path: '/api', baseUrlEnv: 'API_URL' })]),
    ];
    const { hits, rows } = hitsOf(graphs, config({ API_URL: 'api' }));
    expect(hits).toHaveLength(1);
    expect(rows).toMatchObject([{ reason: 'procedure-link-unserved', message: 'orders.list is sent to /api and served over rpc at /rpc' }]);
  });

  it('joins a procedure named by its value at the place it is declared, whatever its path says', () => {
    const inProcess: GraphNode = {
      ...ask('api', 'get', 'handler'),
      meta: { procedure: 'get', call: 'handler', operation: 'call', client: 'orpc-client', procedureAt: 'src/orders.ts:12', inProcess: true },
    };
    const { hits, rows } = hitsOf([graph('api', [served('api', 'orders.get'), inProcess])], config());
    expect(hits.map((edge) => [edge.to, edge.meta?.['via']])).toEqual([['entry:api:rpc:orders.get', 'same-service']]);
    expect(rows).toEqual([]);
  });
});

describe('the routes a procedure is answered at (P58)', () => {
  const route = (id: string, path: string, file: string, meta: Record<string, unknown> = {}): GraphNode => ({
    id,
    type: 'entry',
    kind: 'http',
    label: id,
    repo: 'api',
    file,
    line: 1,
    meta: { method: 'POST', path, ...meta },
  });
  const listed: GraphNode = {
    ...procedure('api', 'orders.list', 'handler'),
    file: 'src/orders.ts',
    line: 5,
    meta: {
      key: 'orders.list',
      call: 'handler',
      served: ['app/rpc/route.ts', 'app/api/route.ts'],
      mounted: [
        { protocol: 'rpc', prefix: '/rpc', file: 'app/rpc/route.ts' },
        { protocol: 'openapi', prefix: '/api', file: 'app/api/route.ts' },
      ],
    },
  };
  const placed: GraphNode = { ...procedure('api', 'orders.place', 'handler'), meta: { key: 'orders.place', call: 'handler' } };
  const nodes = [
    listed,
    placed,
    route('entry:api:http:GET:/api/orders', '/api/orders', 'src/orders.ts', { procedure: 'orders.list' }),
    route('entry:api:http:POST:/api/orders/place', '/api/orders/place', 'src/orders.ts', { procedure: 'orders.place' }),
    route('entry:api:http:POST:/rpc/*', '/rpc/*', 'app/rpc/route.ts'),
    route('entry:api:http:POST:/api/*', '/api/*', 'app/api/route.ts'),
    route('entry:api:http:GET:/health', '/health', 'app/rpc/route.ts'),
  ];
  const sent: GraphNode = {
    ...ask('web', 'orders.list', 'handler'),
    meta: { procedure: 'orders.list', call: 'handler', operation: 'call', client: 'orpc-client', link: { protocol: 'rpc', path: '/rpc' } },
  };

  it('counts the route of a called procedure as called, and the catch-all of the mount it went through', () => {
    const { report } = linkGraphs([graph('api', nodes), graph('web', [sent])], config({ API_URL: 'api' }), { builtAt: FIXED });
    expect(report.routes.uncalled).toEqual([
      'entry:api:http:GET:/health',
      'entry:api:http:POST:/api/*',
      'entry:api:http:POST:/api/orders/place',
    ]);
  });
});

describe("a server's request for another service's procedure (P242)", () => {
  const servers = (): FlowatlasConfig =>
    parseConfig({
      services: [
        { name: 'orders', repo: './orders', type: 'express', baseUrlEnv: ['ORDERS_URL'] },
        { name: 'billing', repo: './billing', type: 'express', hosts: ['billing.internal'] },
        { name: 'worker', repo: './worker', type: 'nestjs' },
      ],
    } as Parameters<typeof parseConfig>[0]);

  /** A worker's request through a client whose link sends where `link` says. */
  const sent = (path: string, link: Record<string, unknown>, call = 'handler'): GraphNode => ({
    id: `http_out:worker#src/clients.ts:${path.length}:5`,
    type: 'http_out',
    kind: 'rpc',
    label: `rpc ${path}`,
    repo: 'worker',
    file: 'src/clients.ts',
    line: path.length,
    meta: { procedure: path, call, operation: 'call', client: 'orpc-client', link },
  });

  const linked = (nodes: GraphNode[], settings = {}) =>
    linkGraphs(
      [
        graph('orders', [procedure('orders', 'orders.place', 'handler')]),
        graph('billing', [procedure('billing', 'invoices.create', 'mutation')]),
        graph('worker', nodes),
      ],
      servers(),
      { builtAt: FIXED, settings },
    );

  it("joins the procedure of the service its link's setting is claimed by, and counts it a call out", () => {
    const { project, report } = linked([sent('orders.place', { protocol: 'rpc', path: '/rpc', baseUrlEnv: 'ORDERS_URL' })]);
    expect(project.edges.filter((edge) => edge.type === 'hits')).toMatchObject([
      { to: 'entry:orders:rpc:orders.place', confidence: 'static', meta: { via: 'link-url', targetService: 'orders' } },
    ]);
    expect(report.httpOut).toMatchObject({ total: 1, linked: 1 });
    expect(report.unresolved).toEqual([]);
  });

  it('joins the service a written host is reached at', () => {
    const { project } = linked([sent('invoices.create', { protocol: 'trpc', path: '/trpc', host: 'billing.internal' }, 'mutation')]);
    expect(project.edges.filter((edge) => edge.type === 'hits')).toMatchObject([
      { to: 'entry:billing:rpc:invoices.create', confidence: 'static', meta: { via: 'link-url', targetService: 'billing' } },
    ]);
  });

  it("takes a setting nobody claims as the service its own files' value names, as a guess, and says so", () => {
    const settings = {
      worker: { values: { PAYMENTS_URL: [{ value: 'http://billing.internal:4000', file: '.env.example' }] }, namedOnly: {}, hosts: [] },
    };
    const { project, report } = linked(
      [sent('invoices.create', { protocol: 'trpc', path: '/trpc', baseUrlEnv: 'PAYMENTS_URL' }, 'mutation')],
      settings,
    );
    expect(project.edges.filter((edge) => edge.type === 'hits')).toMatchObject([
      { to: 'entry:billing:rpc:invoices.create', confidence: 'heuristic', meta: { via: 'link-url', baseUrlFrom: '.env.example' } },
    ]);
    expect(report.unresolved.map((row) => row.reason)).toEqual(['base-url-from-files']);
  });

  it('says a setting nothing places with the row any request rooted at it gets, and joins nothing', () => {
    const { project, report } = linked([sent('orders.place', { protocol: 'rpc', path: '/rpc', baseUrlEnv: 'LEGACY_URL' })]);
    expect(project.edges.filter((edge) => edge.type === 'hits')).toEqual([]);
    expect(report.unresolved.map((row) => row.reason)).toEqual(['unknown-base-url-env']);
    expect(report.httpOut).toMatchObject({ total: 1, linked: 0, unknownEnv: 1 });
  });

  it('draws a host no service is reached at as a third party', () => {
    const { project, report } = linked([sent('entries.record', { protocol: 'trpc', path: '/trpc', host: 'ledger.partner.example' }, 'mutation')]);
    expect(project.edges.filter((edge) => edge.to.startsWith('external_api:'))).toHaveLength(1);
    expect(report.httpOut).toMatchObject({ external: 1 });
    expect(report.unresolved).toEqual([]);
  });

  it('asks only the service the link names, and names the two it asked', () => {
    const { report } = linked([sent('invoices.create', { protocol: 'rpc', path: '/rpc', baseUrlEnv: 'ORDERS_URL' })]);
    expect(report.unresolved).toMatchObject([{ reason: 'procedure-not-found', message: 'no procedure invoices.create in worker or orders' }]);
    expect(report.httpOut).toMatchObject({ noRoute: 1 });
  });

  it('carries what the caller hands and reads back on the edge, as a request carries its body (P247)', () => {
    const typed: GraphNode = {
      ...sent('orders.place', { protocol: 'rpc', path: '/rpc', baseUrlEnv: 'ORDERS_URL' }),
      meta: {
        procedure: 'orders.place',
        call: 'handler',
        operation: 'call',
        client: 'orpc-client',
        link: { protocol: 'rpc', path: '/rpc', baseUrlEnv: 'ORDERS_URL' },
        inputType: 'type:worker#NewOrder',
        outputType: 'type:worker#PlacedOrder',
      },
    };
    const { project } = linked([typed]);
    expect(project.edges.filter((edge) => edge.type === 'hits')).toMatchObject([
      { params: ['type:worker#NewOrder'], returns: 'type:worker#PlacedOrder' },
    ]);
  });

  it("checks a tRPC link's path against where the tree is mounted (P247)", () => {
    const { report } = linkGraphs(
      [
        graph('ledger', [
          {
            ...procedure('ledger', 'entries.record', 'mutation'),
            meta: { key: 'entries.record', call: 'mutation', mounted: [{ protocol: 'trpc', prefix: '/api', file: 'src/server.ts' }] },
          },
        ]),
        graph('worker', [sent('entries.record', { protocol: 'trpc', path: '/trpc', baseUrlEnv: 'LEDGER_URL' }, 'mutation')]),
      ],
      parseConfig({
        services: [
          { name: 'ledger', repo: './ledger', type: 'express', baseUrlEnv: ['LEDGER_URL'] },
          { name: 'worker', repo: './worker', type: 'nestjs' },
        ],
      } as Parameters<typeof parseConfig>[0]),
      { builtAt: FIXED },
    );
    expect(report.unresolved).toMatchObject([
      { reason: 'procedure-link-unserved', message: 'entries.record is sent to /trpc and served over trpc at /api' },
    ]);
  });

  it('keeps the values a setting nothing places was given, for the survey of missing repositories (P247)', () => {
    const settings = {
      worker: { values: { ARCHIVE_URL: [{ value: 'http://archive.shop.internal:7000', file: '.env.example' }] }, namedOnly: {}, hosts: [] },
    };
    const { project, report } = linked([sent('orders.store', { protocol: 'rpc', path: '/rpc', baseUrlEnv: 'ARCHIVE_URL' })], settings);
    expect(report.unresolved.map((row) => row.reason)).toEqual(['unknown-base-url-env']);
    expect(project.nodes.find((node) => node.type === 'http_out')?.meta?.['baseUrlValues']).toEqual(['http://archive.shop.internal:7000']);
  });
});

describe('an MCP request for a way in keyed by a pattern (P277)', () => {
  const patterned = (repo: string, key: string, call: string, keyPattern: string): GraphNode => ({
    ...procedure(repo, key, call),
    meta: { key, call, keyPattern },
  });
  const askAt = (repo: string, path: string, call: string, line: number): GraphNode => ({
    ...ask(repo, path, call),
    id: `ui_api_call:${repo}#src/orders.ts:${line}:10`,
    line,
  });

  it('joins a URI a resource template matches, and a name written in part as a guess', () => {
    const { hits } = hitsOf(
      [
        graph('api', [
          patterned('api', 'mcp:resource:shop://orders/{id}', 'resource', 'uri-template'),
          patterned('api', 'mcp:tool:find{collection}', 'tool', 'name-template'),
          procedure('api', 'mcp:tool:findOrders', 'tool'),
          askAt('api', 'mcp:resource:shop://orders/42', 'resource', 3),
          askAt('api', 'mcp:tool:findProducts', 'tool', 4),
          askAt('api', 'mcp:tool:findOrders', 'tool', 5),
        ]),
      ],
      config(),
    );
    expect(hits.map((edge) => [edge.to, edge.confidence]).sort()).toEqual([
      ['entry:api:rpc:mcp:resource:shop://orders/{id}', 'static'],
      ['entry:api:rpc:mcp:tool:findOrders', 'static'],
      ['entry:api:rpc:mcp:tool:find{collection}', 'heuristic'],
    ]);
  });

  it('does not join a tool to a resource whose pattern the name happens to match', () => {
    const { hits, reasons } = hitsOf(
      [graph('api', [patterned('api', 'mcp:resource:{anything}', 'resource', 'uri-template'), askAt('api', 'mcp:tool:find', 'tool', 3)])],
      config(),
    );
    expect(hits).toEqual([]);
    expect(reasons).toEqual(['procedure-not-found']);
  });
});
