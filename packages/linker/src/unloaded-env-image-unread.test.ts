import { NO_SETTINGS, SCHEMA_VERSION, parseConfig, type GraphNode, type HostAlias, type RepoGraph, type RepoSettings } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { offeredHostsOf } from './base-url-value.js';
import { linkGraphs } from './link.js';
import { loadedFilesOf, portsListening, whereListening, type Listening } from './local-port.js';

const FIXED = '2026-01-01T00:00:00.000Z';
const SLASHES = '/'.repeat(2);

const graph = (repo: string, nodes: GraphNode[]): RepoGraph => ({ schemaVersion: SCHEMA_VERSION, repo, generatedAt: FIXED, nodes, edges: [], types: {}, unresolved: [] });

const route = (repo: string, method: string, path: string): GraphNode => ({ id: `entry:${repo}:http:${method}:${path}`, type: 'entry', kind: 'http', label: `${method} ${path}`, repo, meta: { method, path } });

const request = (repo: string, url: string, path: string, line = 4): GraphNode => ({
  id: `http_out:${repo}#src/call.ts:${line}:9`,
  type: 'http_out',
  kind: 'http',
  label: `GET ${path}`,
  repo,
  file: 'src/call.ts',
  line,
  meta: { method: 'GET', path, host: url.replace(/^https?:\/\//, '').split('/')[0], url },
});

const listening = (repo: string, ports: readonly Record<string, unknown>[]): GraphNode => ({ id: `repo:${repo}`, type: 'repo', label: repo, repo, meta: { listen: ports } });

const config = (names: readonly string[]) => parseConfig({ services: names.map((name) => ({ name, type: 'express', repo: `./${name}` })) } as Parameters<typeof parseConfig>[0]);

const joins = (result: ReturnType<typeof linkGraphs>) =>
  result.project.edges
    .filter((edge) => edge.type === 'http_calls')
    .map((edge) => `${edge.file}:${edge.line} ${edge.to} ${edge.confidence}`)
    .sort();

/** The hosts a `PORT=` in a non-example environment file of a service gives, as the settings reader writes them. */
const filedHosts = (port: number, file: string): HostAlias[] => [`localhost:${port}`, `127.0.0.1:${port}`, `0.0.0.0:${port}`].map((host) => ({ host, file, environmentFile: true as const }));

describe('a port a file nothing is read loading gives, whatever the code reads (P331)', () => {
  it('offers the hosts of a file the code does not load, and keeps those of a file it loads firm', () => {
    const settings: Record<string, RepoSettings> = {
      api: { ...NO_SETTINGS, hosts: filedHosts(4050, '.env.development') },
      loaded: { ...NO_SETTINGS, hosts: filedHosts(4200, '.env.development') },
    };
    const nodes = new Map([['repo:loaded', listening('loaded', [{ port: 4200, file: 'src/app.ts', line: 6, setting: 'PORT', valueFrom: '.env.development' }])]]);
    const loaded = loadedFilesOf(nodes);
    expect(loaded('loaded', '.env.development')).toBe(true);
    expect(loaded('api', '.env.development')).toBe(false);
    const offered = offeredHostsOf(settings, loaded);
    expect(offered.get('localhost:4050')).toEqual(['api']);
    expect(offered.get('localhost:4200')).toBeUndefined();
    // Without what the code loads, every such host is offered.
    expect(offeredHostsOf(settings).get('localhost:4200')).toEqual(['loaded']);
  });

  it("offers a file's value to a setting the code reads alone, as a guess", () => {
    const nodes = new Map([['repo:api', listening('api', [{ file: 'src/app.ts', line: 9, setting: 'PORT' }])]]);
    const settings: Record<string, RepoSettings> = { api: { ...NO_SETTINGS, ports: { PORT: [{ port: 4050, file: '.env.development', environment: 'development' }] } } };
    const [heard] = portsListening(nodes, settings).byPort.get(4050) ?? [];
    expect(heard).toMatchObject({ service: 'api', valueFrom: '.env.development', unloaded: true });
    expect(whereListening(heard as Listening)).toBe('src/app.ts:9 (PORT from .env.development) (a file nothing is read loading)');
  });

  it('yields an offered port to a service the code places there firmly, and asks a guess whether it serves the request', () => {
    const services = config(['web', 'bare', 'audit', 'api']);
    const settings: Record<string, RepoSettings> = {
      bare: { ...NO_SETTINGS, hosts: filedHosts(4100, '.env.development') },
      api: { ...NO_SETTINGS, hosts: filedHosts(4050, '.env.development'), ports: { PORT: [{ port: 4050, file: '.env.development' }] } },
    };
    const graphs = [
      graph('bare', [route('bare', 'GET', '/things')]),
      graph('audit', [listening('audit', [{ port: 4100, file: 'src/app.ts', line: 9 }]), route('audit', 'GET', '/audit/log')]),
      graph('api', [listening('api', [{ file: 'src/app.ts', line: 9, setting: 'PORT' }]), route('api', 'GET', '/items')]),
      graph('web', [
        request('web', `http:${SLASHES}localhost:4100/audit/log`, '/audit/log', 4),
        request('web', `http:${SLASHES}localhost:4050/items`, '/items', 5),
      ]),
    ];
    const result = linkGraphs(graphs, services, { builtAt: FIXED, settings });
    expect(joins(result)).toEqual(['src/call.ts:4 entry:audit:http:GET:/audit/log static', 'src/call.ts:5 entry:api:http:GET:/items heuristic']);
    // Before P331 the file placed bare at 4100 as firmly as audit's code: two services, no join.
    expect(result.project.unresolved.filter((row) => row.reason === 'local-port-shared')).toEqual([]);
  });
});

describe("a container's image whose environment is not read (P331)", () => {
  const nodes = new Map([['repo:orders', listening('orders', [{ port: 3000, file: 'src/app.ts', line: 9, setting: 'PORT' }])]]);
  const container = (environment: Record<string, number>) => ({
    name: 'orders',
    names: ['orders'],
    file: 'docker-compose.yml',
    ports: [{ published: 8080, container: 4000, file: 'docker-compose.yml', line: 8 }],
    environment,
    imageUnread: { image: 'registry.example.test/shop/orders:1.2', why: 'nothing in the project builds it, and an image is never fetched' },
  });

  it('says so where the setting the code reads its port from hangs on it, once per image', () => {
    const settings: Record<string, RepoSettings> = { orders: { ...NO_SETTINGS, containers: [container({}), { ...container({}), name: 'orders-2', names: ['orders-2'] }] } };
    const rows = portsListening(nodes, settings).rows.filter((row) => row.reason === 'container-image-unread');
    expect(rows).toEqual([
      expect.objectContaining({
        service: 'orders',
        file: 'docker-compose.yml',
        line: 8,
        level: 'info',
        message:
          'docker-compose.yml runs orders (orders) from the image registry.example.test/shop/orders:1.2; nothing in the project builds it, and an image is never fetched, so the environment the image gives is not read: it may set PORT (src/app.ts:9), which orders\'s code reads its port from; the port there is taken as 3000, where nothing read gives the setting',
      }),
    ]);
  });

  it("says nothing where the container's own environment gives the setting, or the code reads no setting", () => {
    expect(portsListening(nodes, { orders: { ...NO_SETTINGS, containers: [container({ PORT: 4000 })] } }).rows.filter((row) => row.reason === 'container-image-unread')).toEqual([]);
    const literal = new Map([['repo:orders', listening('orders', [{ port: 4000, file: 'src/app.ts', line: 9 }])]]);
    expect(portsListening(literal, { orders: { ...NO_SETTINGS, containers: [container({})] } }).rows).toEqual([]);
  });

  it("says so for a cluster's routed name whose containers run an image nothing builds", () => {
    const settings: Record<string, RepoSettings> = {
      orders: {
        ...NO_SETTINGS,
        routes: [{ name: 'orders', names: ['orders'], file: 'k8s/orders.yaml', ports: [{ port: 80, target: 3000, file: 'k8s/orders.yaml', line: 29 }], environment: {}, imageUnread: { image: 'orders', why: 'nothing in the project builds it, and an image is never fetched' } }],
      },
    };
    const rows = portsListening(nodes, settings).rows;
    expect(rows.map((row) => `${row.reason} ${row.file}:${row.line}`)).toEqual(['container-image-unread k8s/orders.yaml:29']);
  });
});
