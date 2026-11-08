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
