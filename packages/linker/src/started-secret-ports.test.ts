import { NO_SETTINGS, SCHEMA_VERSION, parseConfig, type GraphNode, type HostAlias, type RepoGraph, type RepoSettings } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';
import { portsListening, whereListening, type Listening } from './local-port.js';

const FIXED = '2026-01-01T00:00:00.000Z';
const SLASHES = '/'.repeat(2);

const graph = (repo: string, nodes: GraphNode[]): RepoGraph => ({ schemaVersion: SCHEMA_VERSION, repo, generatedAt: FIXED, nodes, edges: [], types: {}, unresolved: [] });

const route = (repo: string, method: string, path: string, meta: Record<string, unknown> = {}): GraphNode => ({
  id: `entry:${repo}:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path, ...meta },
});

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

const filedHosts = (port: number, file: string): HostAlias[] => [`localhost:${port}`, `127.0.0.1:${port}`, `0.0.0.0:${port}`].map((host) => ({ host, file, environmentFile: true as const }));

describe('a literal port one service writes (P337, the join P331 saw as a guess)', () => {
  const services = config(['web', 'bare', 'audit']);
  const settings: Record<string, RepoSettings> = { bare: { ...NO_SETTINGS, hosts: filedHosts(4100, '.env.development') } };
  const linked = (meta: Record<string, unknown>) =>
    linkGraphs(
      [
        graph('bare', [route('bare', 'GET', '/things')]),
        graph('audit', [listening('audit', [{ port: 4100, file: 'src/app.ts', line: 9 }]), route('audit', 'GET', '/audit/log', meta)]),
        graph('web', [request('web', `http:${SLASHES}localhost:4100/audit/log`, '/audit/log')]),
      ],
      services,
      { builtAt: FIXED, settings },
    );

  it('joins firmly where the route is read from a resolved type', () => {
    expect(joins(linked({}))).toEqual(['src/call.ts:4 entry:audit:http:GET:/audit/log static']);
  });

  it('is no surer than a route read from what the source states, its framework not installed (R142)', () => {
    // The port is as sure as before: what bounds the edge is the route it lands on.
    expect(joins(linked({ confidence: 'heuristic' }))).toEqual(['src/call.ts:4 entry:audit:http:GET:/audit/log heuristic']);
  });
});

describe('the environment a command of the project starts the server with (P337)', () => {
  it('places a setting the code reads alone at the port, firmly', () => {
    const nodes = new Map([['repo:stock', listening('stock', [{ file: 'src/app.ts', line: 9, setting: 'PORT' }])]]);
    const settings: Record<string, RepoSettings> = { stock: { ...NO_SETTINGS, ports: { PORT: [{ port: 4600, file: 'run-stock.sh', started: true }] } } };
    const [heard] = portsListening(nodes, settings).byPort.get(4600) ?? [];
    expect(heard).toEqual(expect.objectContaining({ service: 'stock', valueFrom: 'run-stock.sh' }));
    expect(heard?.unloaded).toBeUndefined();
    expect(whereListening(heard as Listening)).toBe('src/app.ts:9 (PORT from run-stock.sh)');
  });

  it('moves a written fallback and a framework default, and confirms a fallback it repeats', () => {
    const fallback = new Map([['repo:stock', listening('stock', [{ port: 3000, file: 'src/app.ts', line: 9, setting: 'PORT' }])]]);
    const started = (port: number): Record<string, RepoSettings> => ({ stock: { ...NO_SETTINGS, ports: { PORT: [{ port, file: 'run-stock.sh', started: true }] } } });
    expect(portsListening(fallback, started(4600)).byPort.get(4600)?.[0]).toEqual(expect.objectContaining({ valueFrom: 'run-stock.sh' }));
    expect(portsListening(fallback, started(3000)).byPort.get(3000)?.[0]).toEqual(expect.objectContaining({ valueFrom: 'run-stock.sh' }));
    const framework = new Map([['repo:stock', listening('stock', [{ port: 3000, file: 'package.json', line: 6, setting: 'PORT', default: true }])]]);
    expect(portsListening(framework, started(4600)).byPort.get(4600)?.[0]).toEqual(expect.objectContaining({ valueFrom: 'run-stock.sh' }));
  });

  it('joins a request at the port to the service, over an offer of another service there', () => {
    const services = config(['web', 'stock', 'bare']);
    const settings: Record<string, RepoSettings> = {
      stock: { ...NO_SETTINGS, ports: { PORT: [{ port: 4600, file: 'run-stock.sh', started: true }] } },
      bare: { ...NO_SETTINGS, hosts: filedHosts(4600, '.env.development') },
    };
    const result = linkGraphs(
      [
        graph('stock', [listening('stock', [{ port: 3000, file: 'src/app.ts', line: 9, setting: 'PORT' }]), route('stock', 'GET', '/levels')]),
        graph('bare', [route('bare', 'GET', '/levels')]),
        graph('web', [request('web', `http:${SLASHES}localhost:4600/levels`, '/levels')]),
      ],
      services,
      { builtAt: FIXED, settings },
    );
    expect(joins(result)).toEqual(['src/call.ts:4 entry:stock:http:GET:/levels heuristic']);
    expect(result.project.edges.find((edge) => edge.type === 'http_calls')?.meta?.['listensAt']).toBe('src/app.ts:9 (PORT from run-stock.sh)');
    expect(result.project.unresolved.filter((row) => row.reason === 'local-port-shared')).toEqual([]);
  });
});

describe('a setting a Secret gives a container (P337)', () => {
  const nodes = new Map([['repo:ledger', listening('ledger', [{ port: 3000, file: 'src/app.ts', line: 9, setting: 'PORT' }])]]);
  const routed = {
    name: 'ledger',
    names: ['ledger'],
    file: 'k8s/ledger.yaml',
    ports: [{ port: 80, target: 3000, file: 'k8s/ledger.yaml', line: 30 }],
    environment: {},
    environmentSecret: ['PORT'],
    imageUnread: { image: 'registry.example.test/shop/ledger:1.0', why: 'nothing in the project builds it, and an image is never fetched' },
  };

  it("takes no port from the code's fallback, says why, and says nothing of the image for it", () => {
    const read = portsListening(nodes, { ledger: { ...NO_SETTINGS, routes: [routed] } });
    expect(read.inNetwork.get('ledger:80')).toBeUndefined();
    expect(read.rows.map((row) => row.reason)).toEqual(['published-port-unheard']);
    expect(read.rows[0]?.message).toBe(
      "k8s/ledger.yaml routes ledger:80 to port 3000 of ledger's containers, but ledger's code reads its port from PORT (src/app.ts:9), which a Secret gives, and a secret's value is never read",
    );
  });
});
