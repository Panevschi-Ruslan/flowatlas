import {
  NO_SETTINGS,
  SCHEMA_VERSION,
  localHostsOf,
  parseConfig,
  type FlowatlasConfig,
  type GraphEdge,
  type GraphNode,
  type ListenPort,
  type RepoGraph,
  type RepoSettings,
} from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';

const FIXED = '2026-01-01T00:00:00.000Z';
const SLASHES = '/'.repeat(2);

/** Two services that both serve `GET /items`, so the route alone settles nothing, a browser and a script. */
const config = (orders: Record<string, unknown> = {}): FlowatlasConfig =>
  parseConfig({
    services: [
      { name: 'orders', repo: './orders', type: 'express', ...orders },
      { name: 'billing', repo: './billing', type: 'express' },
      { name: 'web', repo: './web', type: 'react' },
      { name: 'jobs', repo: './jobs', type: 'express' },
    ],
  } as Parameters<typeof parseConfig>[0]);

const graph = (repo: string, nodes: GraphNode[], edges: GraphEdge[] = []): RepoGraph => ({
  schemaVersion: SCHEMA_VERSION,
  repo,
  generatedAt: FIXED,
  nodes,
  edges,
  types: {},
  unresolved: [],
});

/** A service serving `GET /items`, whose server listens where `listen` says. */
const server = (repo: string, listen: readonly ListenPort[] = []): RepoGraph =>
  graph(repo, [
    { id: `repo:${repo}`, type: 'repo', label: repo, repo, meta: listen.length === 0 ? {} : { listen } },
    { id: `entry:${repo}:http:GET:/items`, type: 'entry', kind: 'http', label: 'GET /items', repo, meta: { method: 'GET', path: '/items' } },
  ]);

const UI = 'ui_api_call:web#src/api.ts:3:1';
const OUT = 'http_out:jobs#src/sync.ts:4:9';

/** A browser's request and a server's to `<host>/items`, with the third-party edges their readers draw for the host. */
const callers = (host: string): RepoGraph[] => {
  const request = (id: string, type: 'ui_api_call' | 'http_out', repo: string, file: string): GraphNode => ({
    id,
    type,
    kind: 'http',
    label: 'GET /items',
    repo,
    file,
    line: 3,
    meta: { method: 'GET', url: `http:${SLASHES}${host}/items`, path: '/items', baseUrlEnv: null, host },
  });
  const external = (repo: string): GraphNode => ({ id: `external_api:${host}`, type: 'external_api', label: host, repo, meta: { host } });
  return [
    graph('web', [request(UI, 'ui_api_call', 'web', 'src/api.ts'), external('web')], [{ from: UI, to: `external_api:${host}`, type: 'calls', confidence: 'static' }]),
    graph('jobs', [request(OUT, 'http_out', 'jobs', 'src/sync.ts'), external('jobs')], [{ from: OUT, to: `external_api:${host}`, type: 'calls', confidence: 'static' }]),
  ];
};

const at = (port: number, extra: Partial<ListenPort> = {}): ListenPort => ({ port, file: 'src/main.ts', line: 7, ...extra });

const link = (
  host: string,
  listen: { orders?: ListenPort[]; billing?: ListenPort[] },
  cfg = config(),
  settings?: Record<string, RepoSettings>,
) =>
  linkGraphs([server('orders', listen.orders), server('billing', listen.billing), ...callers(host)], cfg, {
    builtAt: FIXED,
    ...(settings === undefined ? {} : { settings }),
  });

const joins = (result: ReturnType<typeof link>) =>
  result.project.edges
    .filter((edge) => edge.type === 'http_calls' || edge.type === 'hits')
    .map((edge) => `${edge.type} ${edge.to} ${edge.confidence} ${String(edge.meta?.['listensAt'] ?? '-')}`)
    .sort();

describe('a request to a port on this machine joins the service listening there (P250)', () => {
  it('joins a browser and a server request to the one service whose code writes the port, static, and drops the third party', () => {
    const result = link('localhost:3001', { orders: [at(3001)], billing: [at(3002)] });
    expect(joins(result)).toEqual([
      'hits entry:orders:http:GET:/items static src/main.ts:7',
      'http_calls entry:orders:http:GET:/items static src/main.ts:7',
    ]);
    expect(result.project.nodes.some((node) => node.type === 'external_api')).toBe(false);
    expect(result.report.httpOut).toMatchObject({ total: 1, linked: 1, external: 0 });
  });

  it('is a guess where the port is a setting fallback or a library default, and says the setting', () => {
    expect(joins(link('127.0.0.1:3001', { orders: [at(3001, { setting: 'PORT' })] }))).toEqual([
      'hits entry:orders:http:GET:/items heuristic src/main.ts:7 (PORT)',
      'http_calls entry:orders:http:GET:/items heuristic src/main.ts:7 (PORT)',
    ]);
    expect(joins(link('[::1]:3000', { billing: [at(3000, { default: true })] }))).toEqual([
      'hits entry:billing:http:GET:/items heuristic src/main.ts:7 (its default)',
      'http_calls entry:billing:http:GET:/items heuristic src/main.ts:7 (its default)',
    ]);
  });

  it('is a guess where only a setting file places the port, spelled `0.0.0.0` or not', () => {
    const settings = { orders: { ...NO_SETTINGS, hosts: localHostsOf(3001).map((host) => ({ host, file: '.env.example' })) } };
    expect(joins(link(`0.0.0.0:3001`, {}, config(), settings))).toEqual(['hits entry:orders:http:GET:/items heuristic -', 'http_calls entry:orders:http:GET:/items heuristic -']);
  });

  it('is a row, not a pick, where two services listen on the port, by code or by their files', () => {
    const result = link('localhost:3005', { orders: [at(3005)], billing: [at(3005, { file: 'src/server.ts', line: 2 })] });
    expect(joins(result)).toEqual([]);
    const rows = result.project.unresolved.filter((row) => row.reason === 'local-port-shared');
    expect(rows.map((row) => row.service).sort()).toEqual(['jobs', 'web']);
    expect(rows[0]?.message).toBe('port 3005 on this machine is where billing (src/server.ts:2) and orders (src/main.ts:7) each listen, so it is not one service');
    expect(result.report.httpOut).toMatchObject({ total: 1, linked: 0, ambiguous: 1 });
    expect(result.report.ui.byReason).toEqual({ 'local-port-shared': 1 });
    // Both are the project's own services: the port is no third party.
    expect(result.project.nodes.some((node) => node.type === 'external_api')).toBe(false);
    const filed = { billing: { ...NO_SETTINGS, hosts: localHostsOf(3005).map((host) => ({ host, file: '.env.example' })) } };
    const mixed = link('localhost:3005', { orders: [at(3005)] }, config(), filed);
    expect(mixed.project.unresolved.find((row) => row.reason === 'local-port-shared')?.message).toContain('billing (its setting files) and orders (src/main.ts:7)');
  });

  it('lets a host the configuration names decide, and leaves a port nobody listens on as it was', () => {
    const decided = link('localhost:3005', { orders: [at(3005)], billing: [at(3005)] }, config({ hosts: ['localhost:3005'] }));
    expect(joins(decided)).toEqual(['hits entry:orders:http:GET:/items static -', 'http_calls entry:orders:http:GET:/items static -']);
    const nobody = link('localhost:4999', { orders: [at(3001)] });
    expect(joins(nobody)).toEqual([]);
    expect(nobody.report.httpOut).toMatchObject({ external: 1 });
    expect(nobody.project.unresolved.some((row) => row.reason === 'local-port-shared')).toBe(false);
  });

  it('places a procedure client link at a port on this machine the same way', () => {
    const procedure: GraphNode = {
      id: 'http_out:jobs#src/rpc.ts:2:1',
      type: 'http_out',
      kind: 'rpc',
      label: 'orders.list',
      repo: 'jobs',
      file: 'src/rpc.ts',
      line: 2,
      meta: { procedure: 'orders.list', link: { host: 'localhost:3005' } },
    };
    const result = linkGraphs(
      [server('orders', [at(3005)]), server('billing', [at(3005)]), graph('jobs', [procedure])],
      config(),
      { builtAt: FIXED },
    );
    expect(result.project.unresolved.some((row) => row.reason === 'local-port-shared' && row.service === 'jobs')).toBe(true);
  });
});

/** A container of `orders` publishing `published:container`, as a compose file starts it. */
const container = (mappings: Array<[number, number]>, environment: Record<string, number> = {}, names = ['orders', 'orders-api']): RepoSettings => ({
  ...NO_SETTINGS,
  hosts: mappings.flatMap(([published, inside]) => [
    ...localHostsOf(published).map((host) => ({ host, file: 'docker-compose.yml', mapped: { published, container: inside, side: 'published' as const } })),
    ...names.map((name) => ({ host: `${name}:${inside}`, file: 'docker-compose.yml', mapped: { published, container: inside, side: 'container' as const } })),
  ]),
  containers: [
    {
      name: 'orders',
      names,
      file: 'docker-compose.yml',
      ports: mappings.map(([published, inside], index) => ({ published, container: inside, file: 'docker-compose.yml', line: 6 + index })),
      environment,
    },
  ],
});

describe('a port the code and the files decide together (P254)', () => {
  it('joins a request to a published port to the service listening on the container side, saying which side', () => {
    const result = link('localhost:3001', { orders: [at(3000)] }, config(), { orders: container([[3001, 3000]]) });
    expect(joins(result)).toEqual([
      'hits entry:orders:http:GET:/items heuristic src/main.ts:7, published as 3001 by docker-compose.yml',
      'http_calls entry:orders:http:GET:/items heuristic src/main.ts:7, published as 3001 by docker-compose.yml',
    ]);
    expect(result.project.unresolved.some((row) => row.reason === 'published-port-unheard')).toBe(false);
  });

  it("joins a request on the container's own network to its port, saying it is the container's", () => {
    const result = link('orders-api:3000', { orders: [at(3000)] }, config(), { orders: container([[3001, 3000]]) });
    expect(joins(result)).toEqual([
      'hits entry:orders:http:GET:/items heuristic src/main.ts:7, in the container orders (docker-compose.yml)',
      'http_calls entry:orders:http:GET:/items heuristic src/main.ts:7, in the container orders (docker-compose.yml)',
    ]);
    // By the configured name, the join is as sure as the configuration.
    expect(joins(link('orders:3000', { orders: [at(3000)] }, config(), { orders: container([[3001, 3000]]) }))[1]).toBe(
      'http_calls entry:orders:http:GET:/items static src/main.ts:7, in the container orders (docker-compose.yml)',
    );
  });

  it("reads the container's environment over the code's fallback inside it", () => {
    const result = link('localhost:4001', { orders: [at(3000, { setting: 'PORT' })] }, config(), { orders: container([[4001, 4000]], { PORT: 4000 }) });
    expect(joins(result)[1]).toBe(
      'http_calls entry:orders:http:GET:/items heuristic src/main.ts:7 (PORT from docker-compose.yml (orders)), published as 4001 by docker-compose.yml',
    );
  });

  it('is a note where a mapping meets nothing the code listens on, and still joins by the file', () => {
    const elsewhere = link('localhost:3002', { orders: [at(3000)] }, config(), { orders: container([[3002, 8080]]) });
    expect(joins(elsewhere)).toEqual(['hits entry:orders:http:GET:/items heuristic -', 'http_calls entry:orders:http:GET:/items heuristic -']);
    const row = elsewhere.project.unresolved.find((each) => each.reason === 'published-port-unheard');
    expect(row).toMatchObject({ service: 'orders', file: 'docker-compose.yml', line: 6, level: 'info', meta: { published: 3002, container: 8080, listens: [3000] } });
    expect(row?.message).toBe("docker-compose.yml publishes port 8080 of orders (orders) as 3002, but orders's code listens on 3000 (src/main.ts:7)");
    const silent = link('localhost:3002', {}, config(), { orders: container([[3002, 8080]]) });
    expect(silent.project.unresolved.find((each) => each.reason === 'published-port-unheard')?.message).toContain("but nothing in orders's code is read listening on a port");
    const alone = link('localhost:3002', { orders: [{ file: 'src/main.ts', line: 7, setting: 'PORT' }] }, config(), { orders: container([[3002, 8080]]) });
    expect(alone.project.unresolved.find((each) => each.reason === 'published-port-unheard')?.message).toContain(
      "but orders's code reads its port from PORT (src/main.ts:7), which the container's environment does not give",
    );
    // The port the container's environment gives, not the code's fallback (P283).
    const given = link('localhost:3002', { orders: [at(3002, { setting: 'PORT' })] }, config(), { orders: container([[3002, 3002]], { PORT: 8080 }) });
    expect(given.project.unresolved.find((each) => each.reason === 'published-port-unheard')?.message).toBe(
      "docker-compose.yml publishes port 3002 of orders (orders) as 3002, but orders's code listens on 8080 (PORT as the container's environment gives it, src/main.ts:7)",
    );
  });

  it("fills a port the code reads from a setting alone with the service's own example environment file", () => {
    const settings = { orders: { ...NO_SETTINGS, ports: { ORDERS_PORT: [{ port: 3006, file: '.env.example' }] } } };
    const result = link('localhost:3006', { orders: [{ file: 'src/main.ts', line: 7, setting: 'ORDERS_PORT' }] }, config(), settings);
    expect(joins(result)[1]).toBe('http_calls entry:orders:http:GET:/items heuristic src/main.ts:7 (ORDERS_PORT from .env.example)');
    // Without the file, a setting alone places nothing.
    expect(joins(link('localhost:3006', { orders: [{ file: 'src/main.ts', line: 7, setting: 'ORDERS_PORT' }] }))).toEqual([]);
  });

  it('says where a port handed to the server is written', () => {
    expect(joins(link('localhost:3001', { orders: [at(3001, { handed: 'src/index.ts:3' })] }))[1]).toBe(
      'http_calls entry:orders:http:GET:/items static src/main.ts:7 (handed at src/index.ts:3)',
    );
  });

  it("lets a front end's dev server give way where its service serves no route, and joins it where it does", () => {
    const dev = (path: string): RepoGraph[] => [
      graph('web', [
        { id: 'repo:web', type: 'repo', label: 'web', repo: 'web', meta: { listen: [{ port: 5173, file: 'vite.config.ts', line: 4, devServer: true }] } },
        { id: 'entry:web:http:GET:/api/basket', type: 'entry', kind: 'http', label: 'GET /api/basket', repo: 'web', meta: { method: 'GET', path: '/api/basket' } },
      ]),
      server('orders'),
      graph('jobs', [
        {
          id: UI,
          type: 'ui_api_call',
          kind: 'http',
          label: `GET ${path}`,
          repo: 'jobs',
          file: 'src/api.ts',
          line: 3,
          meta: { method: 'GET', url: `http:${SLASHES}localhost:5173${path}`, path, baseUrlEnv: null, host: 'localhost:5173' },
        },
      ]),
    ];
    const served = linkGraphs(dev('/api/basket'), config(), { builtAt: FIXED });
    expect(served.project.edges.filter((edge) => edge.type === 'hits').map((edge) => `${edge.to} ${edge.confidence}`)).toEqual(['entry:web:http:GET:/api/basket static']);
    const forwarded = linkGraphs(dev('/items'), config(), { builtAt: FIXED });
    // A proxy forwards `/items`; the request is joined by its route alone, as before the dev server's port was read.
    expect(forwarded.project.edges.filter((edge) => edge.type === 'hits').map((edge) => `${edge.to} ${String(edge.meta?.['via'])}`)).toEqual([
      'entry:orders:http:GET:/items unique-route',
    ]);
  });
});

/** A name a cluster's network routes to orders's containers: `orders-svc:80` to `target`. */
const routed = (target: number, environment: Record<string, number> = {}): RepoSettings => ({
  ...NO_SETTINGS,
  hosts: [
    { host: 'orders-svc', file: 'k8s/orders.yaml' },
    { host: 'orders-svc:80', file: 'k8s/orders.yaml', mapped: { published: 80, container: target, side: 'routed' } },
    { host: 'orders-svc.shop.svc.cluster.local', file: 'k8s/orders.yaml' },
    { host: 'orders-svc.shop.svc.cluster.local:80', file: 'k8s/orders.yaml', mapped: { published: 80, container: target, side: 'routed' } },
  ],
  routes: [
    {
      name: 'orders-svc',
      names: ['orders-svc', 'orders-svc.shop.svc.cluster.local'],
      file: 'k8s/orders.yaml',
      ports: [{ port: 80, target, file: 'k8s/orders.yaml', line: 30 }],
      environment,
    },
  ],
});

describe("a name a cluster's network routes to a service's containers (P257)", () => {
  it('joins a request to the name at the port it routes, the scheme saying the port where the host does not', () => {
    for (const host of ['orders-svc:80', 'orders-svc', 'orders-svc.shop.svc.cluster.local']) {
      expect(joins(link(host, { orders: [at(3000)] }, config(), { orders: routed(3000) }))).toEqual([
        'hits entry:orders:http:GET:/items heuristic src/main.ts:7, behind orders-svc:80 (k8s/orders.yaml)',
        'http_calls entry:orders:http:GET:/items heuristic src/main.ts:7, behind orders-svc:80 (k8s/orders.yaml)',
      ]);
    }
  });

  it("reads the containers' environment over the code's fallback behind the name", () => {
    expect(joins(link('orders-svc', { orders: [at(3000, { setting: 'PORT' })] }, config(), { orders: routed(4000, { PORT: 4000 }) }))[1]).toBe(
      'http_calls entry:orders:http:GET:/items heuristic src/main.ts:7 (PORT from k8s/orders.yaml (orders-svc)), behind orders-svc:80 (k8s/orders.yaml)',
    );
  });

  it('is a note where the name routes to a port nothing in the code listens on', () => {
    const result = link('orders-svc', { orders: [at(3000)] }, config(), { orders: routed(8080) });
    const row = result.project.unresolved.find((each) => each.reason === 'published-port-unheard');
    expect(row).toMatchObject({ service: 'orders', file: 'k8s/orders.yaml', line: 30, level: 'info', meta: { routed: 80, container: 8080, listens: [3000] } });
    expect(row?.message).toBe("k8s/orders.yaml routes orders-svc:80 to port 8080 of orders's containers, but orders's code listens on 3000 (src/main.ts:7)");
  });
});

describe('a request on a network to a port the service is not reached at there (P257)', () => {
  it("is a finding, never a join, where it names a container's published port on the container's network", () => {
    const result = link('orders-api:3001', { orders: [at(3000)] }, config(), { orders: container([[3001, 3000]]) });
    expect(joins(result)).toEqual([]);
    const rows = result.project.unresolved.filter((each) => each.reason === 'network-port-unreachable');
    expect(rows.map((row) => `${row.service} ${row.file}:${row.line}`)).toEqual(['jobs src/sync.ts:3', 'web src/api.ts:3']);
    expect(rows[0]?.message).toBe(
      "orders-api:3001 names orders on its container's network at a port docker-compose.yml publishes only on the machine running it, so the request will not connect; on that network it is reached at orders-api:3000",
    );
    expect(result.project.nodes.some((node) => node.type === 'external_api')).toBe(false);
    expect(result.report.httpOut).toMatchObject({ total: 1, linked: 0, noRoute: 1 });
    expect(result.report.ui.byReason).toEqual({ 'network-port-unreachable': 1 });
  });

  it("is a finding where it names the containers' own port behind a cluster's name", () => {
    const result = link('orders-svc:3000', { orders: [at(3000)] }, config(), { orders: routed(3000) });
    expect(joins(result)).toEqual([]);
    expect(result.project.unresolved.find((each) => each.reason === 'network-port-unreachable')?.message).toBe(
      "orders-svc:3000 names orders on its cluster's network at its containers' own port, which k8s/orders.yaml routes only through orders-svc:80, so the request will not connect",
    );
  });

  it('says nothing where the code listens on the published port too, or where nothing says where it listens', () => {
    expect(joins(link('orders:3001', { orders: [at(3000), at(3001, { line: 9 })] }, config(), { orders: container([[3001, 3000]]) }))).toHaveLength(2);
    const unread = link('orders-api:3001', {}, config(), { orders: container([[3001, 3000]]) });
    expect(unread.project.unresolved.some((row) => row.reason === 'network-port-unreachable')).toBe(false);
  });
});

/** A front end whose dev server forwards by `rules`, its browser calling `path` with no host, and a script calling its dev server. */
const proxied = (rules: readonly Record<string, unknown>[], path: string, own: GraphNode[] = []): RepoGraph[] => [
  graph('web', [
    {
      id: 'repo:web',
      type: 'repo',
      label: 'web',
      repo: 'web',
      meta: { listen: [{ port: 5180, file: 'vite.config.ts', line: 4, devServer: true }], proxy: rules },
    },
    { id: UI, type: 'ui_api_call', kind: 'http', label: `GET ${path}`, repo: 'web', file: 'src/api.ts', line: 3, meta: { method: 'GET', path, baseUrlEnv: null } },
    ...own,
  ]),
  server('orders', [at(3001)]),
  server('billing', [at(3002)]),
  graph(
    'jobs',
    [
      {
        id: OUT,
        type: 'http_out',
        kind: 'http',
        label: `GET ${path}`,
        repo: 'jobs',
        file: 'src/sync.ts',
        line: 4,
        meta: { method: 'GET', url: `http:${SLASHES}localhost:5180${path}`, path, baseUrlEnv: null, host: 'localhost:5180' },
      },
      { id: 'external_api:localhost:5180', type: 'external_api', label: 'localhost:5180', repo: 'jobs', meta: { host: 'localhost:5180' } },
    ],
    [{ from: OUT, to: 'external_api:localhost:5180', type: 'calls', confidence: 'static' }],
  ),
];

const rule = (path: string, target: string, to: string, extra: Record<string, unknown> = {}) => ({ path, target, to, file: 'vite.config.ts', line: 6, ...extra });

/** Each join as `type to confidence via proxiedBy proxiedAs`. */
const through = (result: ReturnType<typeof linkGraphs>): string[] =>
  result.project.edges
    .filter((edge) => edge.type === 'hits' || edge.type === 'http_calls' || (edge.type === 'calls' && edge.to.startsWith('external_api')))
    .map((edge) => `${edge.type} ${edge.to} ${edge.confidence} ${String(edge.meta?.['via'] ?? '-')} ${String(edge.meta?.['proxiedBy'] ?? '-')} ${String(edge.meta?.['proxiedAs'] ?? '-')}`)
    .sort();

describe("a request a server's proxy forwards joins where it is forwarded (P257)", () => {
  it('joins a request with no host, and one to the dev server, at the rewritten path, a guess naming the rule', () => {
    const result = linkGraphs(proxied([rule('/api', `http:${SLASHES}localhost:3001`, '')], '/api/items'), config(), { builtAt: FIXED });
    expect(through(result)).toEqual([
      'hits entry:orders:http:GET:/items heuristic proxy vite.config.ts:6 /items',
      'http_calls entry:orders:http:GET:/items heuristic proxy vite.config.ts:6 /items',
    ]);
    // The dev server is the project's own: no third party is drawn for it.
    expect(result.project.nodes.some((node) => node.id === 'external_api:localhost:5180')).toBe(false);
    expect(result.project.edges.find((edge) => edge.type === 'hits')?.meta?.['listensAt']).toBe('src/main.ts:7');
  });

  it('forwards before the server own routes, unless the rule is applied after them', () => {
    const own: GraphNode[] = [{ id: 'entry:web:http:GET:/items', type: 'entry', kind: 'http', label: 'GET /items', repo: 'web', meta: { method: 'GET', path: '/items' } }];
    const first = linkGraphs(proxied([rule('/', `http:${SLASHES}localhost:3002`, '')], '/items', own), config(), { builtAt: FIXED });
    expect(through(first)).toEqual([
      'hits entry:billing:http:GET:/items heuristic proxy vite.config.ts:6 -',
      'http_calls entry:billing:http:GET:/items heuristic proxy vite.config.ts:6 -',
    ]);
    const after = linkGraphs(proxied([rule('/', `http:${SLASHES}localhost:3002`, '', { after: 'own-routes' })], '/items', own), config(), { builtAt: FIXED });
    expect(through(after)).toEqual(['hits entry:web:http:GET:/items static same-service - -', 'http_calls entry:web:http:GET:/items static host - -']);
  });

  it('is a route not found at the service the proxy names, where it serves nothing there', () => {
    const result = linkGraphs(proxied([rule('/api', `http:${SLASHES}localhost:3001`, '/v2')], '/api/items'), config(), { builtAt: FIXED });
    expect(through(result)).toEqual([]);
    expect(result.project.unresolved.filter((row) => row.reason === 'target-route-not-found').map((row) => row.message)).toEqual([
      'target service orders has no route GET /v2/items',
      'target service orders has no route GET /v2/items',
    ]);
  });

  it('draws a third party where the proxy forwards to a host no service is reached at, and says so', () => {
    const result = linkGraphs(proxied([rule('/ext', `https:${SLASHES}api.example.test`, '')], '/ext/items'), config(), { builtAt: FIXED });
    expect(through(result)).toEqual([
      'calls external_api:api.example.test heuristic proxy vite.config.ts:6 /items',
      'calls external_api:api.example.test heuristic proxy vite.config.ts:6 /items',
    ]);
    expect(result.project.unresolved.filter((row) => row.reason === 'proxied-to-third-party').map((row) => `${row.service} ${row.level}`)).toEqual(['jobs info', 'web info']);
    expect(result.report.ui.byReason).toEqual({ 'proxied-to-third-party': 1 });
    expect(result.report.httpOut).toMatchObject({ external: 1 });
  });
});

/** A server whose repository node forwards by `rules`, serving `GET /items` itself. */
const forwarder = (repo: string, rules: readonly Record<string, unknown>[], listen: readonly ListenPort[]): RepoGraph =>
  graph(repo, [
    { id: `repo:${repo}`, type: 'repo', label: repo, repo, meta: { listen, proxy: rules } },
    { id: `entry:${repo}:http:GET:/items`, type: 'entry', kind: 'http', label: 'GET /items', repo, meta: { method: 'GET', path: '/items' } },
  ]);

describe("the rest of the ways a server's proxy forwards a request (P260)", () => {
  it("reads a target from a setting the service's files give one address, and says where they give none", () => {
    const setting = rule('/api', '', '', { setting: { name: 'ORDERS_URL', to: '' } });
    const given = { web: { ...NO_SETTINGS, values: { ORDERS_URL: [{ value: `http:${SLASHES}localhost:3001`, file: '.env.example' }] } } };
    const result = linkGraphs(proxied([setting], '/api/items'), config(), { builtAt: FIXED, settings: given });
    expect(through(result)).toEqual([
      'hits entry:orders:http:GET:/items heuristic proxy vite.config.ts:6 /items',
      'http_calls entry:orders:http:GET:/items heuristic proxy vite.config.ts:6 /items',
    ]);
    expect(result.project.edges.find((edge) => edge.type === 'hits')?.meta?.['proxiedTo']).toEqual(['ORDERS_URL from .env.example']);
    const none = linkGraphs(proxied([setting], '/api/items'), config(), { builtAt: FIXED });
    // Nothing forwards it: the request to the dev server is what its reader drew.
    expect(through(none)).toEqual(['calls external_api:localhost:5180 static - - -']);
    expect(none.project.unresolved.find((row) => row.reason === 'proxy-rule-unread')?.message).toBe(
      "the proxy rule for /api in vite.config.ts reads its target from ORDERS_URL, which the service's files give no address",
    );
    // A fallback written beside the setting is the target where the files give none.
    const fallback = linkGraphs(proxied([rule('/api', `http:${SLASHES}localhost:3002`, '', { setting: { name: 'ORDERS_URL', to: '' } })], '/api/items'), config(), { builtAt: FIXED });
    expect(through(fallback)[0]).toBe('hits entry:billing:http:GET:/items heuristic proxy vite.config.ts:6 /items');
  });

  it('matches a key written as a regular expression, and rewrites the whole path by one', () => {
    const pattern = rule('^/legacy/.*', `http:${SLASHES}localhost:3001`, '', { match: { source: '^/legacy/.*' }, rewrite: { source: '^/legacy', with: '' } });
    expect(through(linkGraphs(proxied([pattern], '/legacy/items'), config(), { builtAt: FIXED }))).toEqual([
      'hits entry:orders:http:GET:/items heuristic proxy vite.config.ts:6 /items',
      'http_calls entry:orders:http:GET:/items heuristic proxy vite.config.ts:6 /items',
    ]);
  });

  it('follows a request a proxy forwards to a server whose own proxy forwards it again, naming each rule', () => {
    const graphs = proxied([rule('/api', `http:${SLASHES}localhost:3002`, '')], '/api/items');
    const chained = [...graphs.filter((each) => each.repo !== 'billing'), forwarder('billing', [{ path: '/items', target: `http:${SLASHES}localhost:3001`, to: '/items', file: 'src/proxy.ts', line: 3 }], [at(3002)])];
    const result = linkGraphs(chained, config(), { builtAt: FIXED });
    expect(through(result)).toEqual([
      'hits entry:orders:http:GET:/items heuristic proxy vite.config.ts:6 /items',
      'http_calls entry:orders:http:GET:/items heuristic proxy vite.config.ts:6 /items',
    ]);
    expect(result.project.edges.find((edge) => edge.type === 'hits')?.meta?.['proxiedThen']).toEqual(['src/proxy.ts:3']);
  });

  it('says where proxies forward a request in a circle, and joins nothing', () => {
    const graphs = proxied([rule('/api', `http:${SLASHES}localhost:3002`, '/api')], '/api/items');
    const circle = [...graphs.filter((each) => each.repo !== 'billing'), forwarder('billing', [{ path: '/api', target: `http:${SLASHES}localhost:5180`, to: '/api', file: 'src/proxy.ts', line: 3 }], [at(3002)])];
    const result = linkGraphs(circle, config(), { builtAt: FIXED });
    expect(through(result)).toEqual([]);
    expect(result.project.unresolved.filter((row) => row.reason === 'proxy-chain-unfollowed').map((row) => `${row.service} ${row.message}`)).toEqual([
      'jobs the request is forwarded by web, then billing, and back to web: the proxies forward it in a circle',
      'web the request is forwarded by web, then billing, and back to web: the proxies forward it in a circle',
    ]);
    expect(result.report.httpOut).toMatchObject({ noRoute: 1 });
  });
});

/** Where a cluster's ways in send a public host's paths, and the names they route. */
const public_ = (): Record<string, RepoSettings> => ({
  orders: { ...routed(3000), ingress: [{ host: 'shop.example.test', object: 'ingress/shop', rule: { path: '/api', target: `http:${SLASHES}orders-svc`, to: '', file: 'k8s/ingress.yaml', line: 12 } }] },
  web: { ...NO_SETTINGS, ingress: [{ host: 'shop.example.test', object: 'ingress/shop', rule: { path: '/', target: `http:${SLASHES}web-svc`, to: '', file: 'k8s/ingress.yaml', line: 9 } }] },
});

describe("a request to a public host a cluster's way in routes (P260)", () => {
  it('leaves a request to a public host no rule matches the path of as it was', () => {
    const only = { orders: public_()['orders'] as RepoSettings };
    const result = link('shop.example.test', { orders: [at(3000)] }, config(), only);
    expect(joins(result)).toEqual([]);
    expect(result.project.edges.filter((edge) => edge.type === 'calls' && edge.to.startsWith('external_api')).map((edge) => edge.to)).toEqual(['external_api:shop.example.test', 'external_api:shop.example.test']);
  });

  it('forwards a request with no host from a service the way in serves, and one to the public host', () => {
    const graphs: RepoGraph[] = [
      server('orders', [at(3000)]),
      server('billing'),
      graph('web', [{ id: UI, type: 'ui_api_call', kind: 'http', label: 'GET /api/items', repo: 'web', file: 'src/api.ts', line: 3, meta: { method: 'GET', path: '/api/items', baseUrlEnv: null } }]),
      graph(
        'jobs',
        [
          { id: OUT, type: 'http_out', kind: 'http', label: 'GET /api/items', repo: 'jobs', file: 'src/sync.ts', line: 4, meta: { method: 'GET', url: `https:${SLASHES}shop.example.test/api/items`, path: '/api/items', baseUrlEnv: null, host: 'shop.example.test' } },
          { id: 'external_api:shop.example.test', type: 'external_api', label: 'shop.example.test', repo: 'jobs', meta: { host: 'shop.example.test' } },
        ],
        [{ from: OUT, to: 'external_api:shop.example.test', type: 'calls', confidence: 'static' }],
      ),
    ];
    const result = linkGraphs(graphs, config(), { builtAt: FIXED, settings: public_() });
    expect(through(result)).toEqual([
      'hits entry:orders:http:GET:/items heuristic ingress k8s/ingress.yaml:12 /items',
      'http_calls entry:orders:http:GET:/items heuristic ingress k8s/ingress.yaml:12 /items',
    ]);
    const hit = result.project.edges.find((edge) => edge.type === 'http_calls');
    expect(hit?.meta).toMatchObject({ wayIn: 'ingress/shop', listensAt: 'src/main.ts:7, behind orders-svc:80 (k8s/orders.yaml)' });
    expect(result.project.nodes.some((node) => node.id === 'external_api:shop.example.test')).toBe(false);
  });
});

describe('a port this machine forwards to a cluster, or a node opens for it (P260)', () => {
  it('joins a request to the forwarded port, saying how it is reached', () => {
    const forwarded: RepoSettings = {
      ...NO_SETTINGS,
      hosts: localHostsOf(8081).map((host) => ({ host, file: 'Makefile', mapped: { published: 8081, container: 3000, side: 'published' as const } })),
      containers: [{ name: 'svc/orders', names: [], file: 'Makefile', ports: [{ published: 8081, container: 3000, file: 'Makefile', line: 2 }], environment: {}, via: 'forwarded' }],
    };
    expect(joins(link('localhost:8081', { orders: [at(3000)] }, config(), { orders: forwarded }))).toEqual([
      'hits entry:orders:http:GET:/items heuristic src/main.ts:7, forwarded from 8081 to svc/orders by Makefile',
      'http_calls entry:orders:http:GET:/items heuristic src/main.ts:7, forwarded from 8081 to svc/orders by Makefile',
    ]);
    const opened: RepoSettings = { ...forwarded, containers: [{ ...(forwarded.containers?.[0] as NonNullable<RepoSettings['containers']>[number]), name: 'orders-svc', file: 'k8s/orders.yaml', ports: [{ published: 8081, container: 3000, file: 'k8s/orders.yaml', line: 30 }], via: 'node-port' }] };
    expect(joins(link('localhost:8081', { orders: [at(3000)] }, config(), { orders: opened }))[0]).toBe('hits entry:orders:http:GET:/items heuristic src/main.ts:7, at node port 8081 of orders-svc (k8s/orders.yaml)');
    const unheard = link('localhost:8081', { orders: [at(4000)] }, config(), { orders: forwarded });
    expect(unheard.project.unresolved.find((row) => row.reason === 'published-port-unheard')?.message).toBe(
      "Makefile forwards port 8081 of this machine to svc/orders, port 3000 of orders's containers, but orders's code listens on 4000 (src/main.ts:7)",
    );
  });
});

describe('a request with no host from a server that resolves it against its own address (P260)', () => {
  const own = (proxy: readonly Record<string, unknown>[] = []): RepoGraph[] => [
    server('orders', [at(3001)]),
    graph('web', [
      { id: 'repo:web', type: 'repo', label: 'web', repo: 'web', meta: { ownOrigin: true, proxy } },
      { id: 'entry:web:http:GET:/health', type: 'entry', kind: 'http', label: 'GET /health', repo: 'web', meta: { method: 'GET', path: '/health' } },
      { id: 'http_out:web#app/page.tsx:3:1', type: 'http_out', kind: 'http', label: 'GET /health', repo: 'web', file: 'app/page.tsx', line: 3, meta: { method: 'GET', url: '/health', path: '/health', baseUrlEnv: null } },
      { id: 'http_out:web#app/page.tsx:4:1', type: 'http_out', kind: 'http', label: 'GET /shop-api/items', repo: 'web', file: 'app/page.tsx', line: 4, meta: { method: 'GET', url: '/shop-api/items', path: '/shop-api/items', baseUrlEnv: null } },
    ]),
  ];

  it("joins its own route, and a path its rewrites forward, where they are", () => {
    const result = linkGraphs(own([rule('/shop-api', `http:${SLASHES}localhost:3001`, '', { after: 'own-routes', file: 'next.config.js', line: 5 })]), config(), { builtAt: FIXED });
    expect(through(result)).toEqual([
      'http_calls entry:orders:http:GET:/items heuristic proxy next.config.js:5 /items',
      'http_calls entry:web:http:GET:/health heuristic ownOrigin - -',
    ]);
  });

  it('stays a request nobody can place in a server that does not', () => {
    const graphs = own();
    const plain = graphs.map((each) => (each.repo !== 'web' ? each : { ...each, nodes: each.nodes.map((node) => (node.type === 'repo' ? { ...node, meta: {} } : node)) }));
    expect(through(linkGraphs(plain, config(), { builtAt: FIXED }))).toEqual([]);
  });
});

describe('a server asking itself, a way in at any host and every setting a chain reads (P263)', () => {
  /** A Next-like server's requests with no host: one marked as the platform fetch's, one in a file a browser reads too, one through another client. */
  const asking = (marks: Record<string, unknown>, ownOrigin = true): RepoGraph[] => {
    const out = (line: number, meta: Record<string, unknown> = {}): GraphNode => ({ id: `http_out:web#app/api/report/route.ts:${line}:1`, type: 'http_out', kind: 'http', label: 'GET /health', repo: 'web', file: 'app/api/report/route.ts', line, meta: { method: 'GET', url: '/health', path: '/health', baseUrlEnv: null, ...meta } });
    return [
      server('orders', [at(3001)]),
      graph('web', [
        { id: 'repo:web', type: 'repo', label: 'web', repo: 'web', meta: ownOrigin ? { ownOrigin: true } : {} },
        { id: 'entry:web:http:GET:/health', type: 'entry', kind: 'http', label: 'GET /health', repo: 'web', meta: { method: 'GET', path: '/health' } },
        out(3, marks),
        out(4, marks),
        out(5),
        { id: 'ui_api_call:web#app/api/report/route.ts:4:1', type: 'ui_api_call', kind: 'http', label: 'GET /health', repo: 'web', file: 'app/api/report/route.ts', line: 4, meta: { method: 'GET', path: '/health', baseUrlEnv: null } },
      ]),
    ];
  };

  it('says a server request with no host through the platform fetch will not work, once, where no browser makes it too', () => {
    const result = linkGraphs(asking({ originless: true }), config(), { builtAt: FIXED });
    expect(through(result).filter((each) => each.startsWith('http_calls'))).toEqual([
      'http_calls entry:web:http:GET:/health heuristic ownOrigin - -',
      'http_calls entry:web:http:GET:/health heuristic ownOrigin - -',
      'http_calls entry:web:http:GET:/health heuristic ownOrigin - -',
    ]);
    expect(result.project.unresolved.filter((row) => row.reason === 'server-request-without-origin').map((row) => `${row.file}:${row.line} ${row.message}`)).toEqual([
      "app/api/report/route.ts:3 web's server makes this request to /health with no host through the platform fetch, which has no page address on the server to resolve it against: it throws as written",
    ]);
    // A file that holds one of the service's own ways in is the server's, whatever else reads it.
    const handler: GraphNode = { id: 'entry:web:http:GET:/api/report', type: 'entry', kind: 'http', label: 'GET /api/report', repo: 'web', file: 'app/api/report/route.ts', meta: { method: 'GET', path: '/api/report' } };
    const served = asking({ originless: true }).map((each) => (each.repo === 'web' ? { ...each, nodes: [...each.nodes, handler] } : each));
    expect(linkGraphs(served, config(), { builtAt: FIXED }).project.unresolved.filter((row) => row.reason === 'server-request-without-origin').map((row) => row.line)).toEqual([3, 4]);
  });

  it('joins a request its client answers in process to its own route, static, and says nothing more, its own address resolving or not', () => {
    for (const ownOrigin of [true, false]) {
      const result = linkGraphs(asking({ inProcess: true }, ownOrigin), config(), { builtAt: FIXED });
      expect(through(result).filter((each) => each.includes('inProcess'))).toEqual(['http_calls entry:web:http:GET:/health static inProcess - -', 'http_calls entry:web:http:GET:/health static inProcess - -']);
      expect(result.project.unresolved.filter((row) => row.reason === 'server-request-without-origin')).toEqual([]);
    }
  });

  it("forwards a front end's request with no host through a way in at any host that serves it, and no public host's", () => {
    const any = (path: string, target: string, line: number) => ({ host: '*', object: 'ingress/edge', rule: { path, target: `http:${SLASHES}${target}`, to: '', file: 'k8s/ingress.yaml', line } });
    const settings: Record<string, RepoSettings> = {
      orders: { ...routed(3000), ingress: [any('/api', 'orders-svc', 12)] },
      web: { ...NO_SETTINGS, ingress: [any('/', 'web-svc', 9)] },
    };
    const graphs: RepoGraph[] = [
      server('orders', [at(3000)]),
      server('billing'),
      graph('web', [{ id: UI, type: 'ui_api_call', kind: 'http', label: 'GET /api/items', repo: 'web', file: 'src/api.ts', line: 3, meta: { method: 'GET', path: '/api/items', baseUrlEnv: null } }]),
    ];
    expect(through(linkGraphs(graphs, config(), { builtAt: FIXED, settings }))).toEqual(['hits entry:orders:http:GET:/items heuristic ingress k8s/ingress.yaml:12 /items']);
    // A request to a public host is not the hostless rule's: whether the host reaches the cluster is not in the files.
    expect(joins(link('shop.example.test', { orders: [at(3000)] }, config(), { orders: settings['orders'] as RepoSettings }))).toEqual([]);
  });

  it('names every setting a hop of a chain reads its target from, in the order the request passes them', () => {
    const graphs = proxied([rule('/api', '', '', { setting: { name: 'GATEWAY_URL', to: '' } })], '/api/items');
    const chained = [...graphs.filter((each) => each.repo !== 'billing'), forwarder('billing', [{ path: '/items', target: '', to: '/items', file: 'src/proxy.ts', line: 3, setting: { name: 'ORDERS_URL', to: '/items' } }], [at(3002)])];
    const settings = {
      web: { ...NO_SETTINGS, values: { GATEWAY_URL: [{ value: `http:${SLASHES}localhost:3002`, file: '.env.example' }] } },
      billing: { ...NO_SETTINGS, values: { ORDERS_URL: [{ value: `http:${SLASHES}localhost:3001`, file: '.env' }] } },
    };
    const result = linkGraphs(chained, config(), { builtAt: FIXED, settings });
    expect(result.project.edges.find((edge) => edge.type === 'hits')?.meta).toMatchObject({ proxiedThen: ['src/proxy.ts:3'], proxiedTo: ['GATEWAY_URL from .env.example', 'ORDERS_URL from .env'] });
  });
});
