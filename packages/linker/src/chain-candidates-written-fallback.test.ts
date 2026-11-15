import { NO_SETTINGS, SCHEMA_VERSION, localHostsOf, parseConfig, type GraphNode, type RepoGraph, type RepoSettings } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { chooseAmongSettings, settingCandidates } from './base-url-value.js';
import { linkGraphs } from './link.js';
import { atLocalPort, portsListening, type Listening, type PortIndex } from './local-port.js';
import { servesRequest } from './request-served.js';

const FIXED = '2026-01-01T00:00:00.000Z';
const SLASHES = '/'.repeat(2);
const LOCAL = `http:${SLASHES}localhost:3000`;

const graph = (repo: string, nodes: GraphNode[]): RepoGraph => ({
  schemaVersion: SCHEMA_VERSION,
  repo,
  generatedAt: FIXED,
  nodes,
  edges: [],
  types: {},
  unresolved: [],
});

const route = (repo: string, method: string, path: string): GraphNode => ({
  id: `entry:${repo}:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path },
});

const request = (meta: Record<string, unknown>, type: 'http_out' | 'ui_api_call' = 'http_out'): GraphNode => ({
  id: `${type}:web#src/call.ts:4:9`,
  type,
  kind: 'http',
  label: `${String(meta['method'])} ${String(meta['path'])}`,
  repo: 'web',
  file: 'src/call.ts',
  line: 4,
  meta,
});

const joins = (result: ReturnType<typeof linkGraphs>) =>
  result.project.edges
    .filter((edge) => edge.type === 'hits' || edge.type === 'http_calls')
    .map((edge) => `${edge.from.split(':')[0]} ${edge.to} ${edge.confidence}`)
    .sort();

const chosenAmong = (result: ReturnType<typeof linkGraphs>) => result.project.edges.find((edge) => edge.type === 'http_calls' || edge.type === 'hits')?.meta?.['chosenAmong'];

const services = parseConfig({
  services: [
    { name: 'web', repo: './web', type: 'express' },
    { name: 'orders', repo: './orders', type: 'express', baseUrlEnv: ['ORDERS_URL'] },
    { name: 'legacy', repo: './legacy', type: 'express', baseUrlEnv: ['LEGACY_URL'] },
    { name: 'archive', repo: './archive', type: 'express', baseUrlEnv: ['LEGACY_URL', 'ARCHIVE_URL'] },
  ],
} as Parameters<typeof parseConfig>[0]);

const targets = [
  graph('orders', [route('orders', 'GET', '/orders'), route('orders', 'GET', '/health')]),
  graph('legacy', [route('legacy', 'GET', '/v1/orders'), route('legacy', 'GET', '/health'), route('legacy', 'GET', '/v1/both')]),
  graph('archive', [route('archive', 'GET', '/v0/orders'), route('archive', 'GET', '/v1/both')]),
];

const link = (meta: Record<string, unknown>, type: 'http_out' | 'ui_api_call' = 'http_out') => linkGraphs([...targets, graph('web', [request(meta, type)])], services, { builtAt: FIXED });

describe('a chain of settings read as candidates where the first claimant lacks the route (P313)', () => {
  /** `process.env.ORDERS_URL || process.env.ARCHIVE_URL`, as the extractor writes it. */
  const chain = (path: string) => ({ method: 'GET', path, baseUrlEnv: 'ORDERS_URL', baseUrlAlso: ['ARCHIVE_URL'] });

  it("keeps the first claimant's join where it serves the request, as sure as it was", () => {
    const result = link(chain('/orders'));
    expect(joins(result)).toEqual(['http_out entry:orders:http:GET:/orders static']);
    expect(chosenAmong(result)).toBeUndefined();
  });

  it("joins a later setting's claimant serving it where the first does not, as a guess naming the candidates", () => {
    const result = link(chain('/v0/orders'));
    expect(joins(result)).toEqual(['http_out entry:archive:http:GET:/v0/orders heuristic']);
    expect(chosenAmong(result)).toEqual(['ORDERS_URL (orders)', 'ARCHIVE_URL (archive)']);
    expect(result.project.unresolved).toEqual([]);
  });

  it('asks each later setting in order, the first serving it the answer', () => {
    const three = { method: 'GET', path: '/v1/orders', baseUrlEnv: 'ORDERS_URL', baseUrlAlso: ['ARCHIVE_URL', 'LEGACY_URL'] };
    expect(joins(link(three))).toEqual(['http_out entry:legacy:http:GET:/v1/orders heuristic']);
    // A service a setting before claims is asked there, not again.
    const before = { method: 'GET', path: '/v1/both', baseUrlEnv: 'ORDERS_URL', baseUrlAlso: ['ARCHIVE_URL', 'LEGACY_URL'] };
    expect(joins(link(before))).toEqual(['http_out entry:archive:http:GET:/v1/both heuristic']);
  });

  it("is the first claimant's row where nobody serves it, as before", () => {
    const result = link(chain('/missing'));
    expect(joins(result)).toEqual([]);
    expect(result.project.unresolved.map((row) => [row.reason, row.message])).toEqual([['target-route-not-found', 'target service orders has no route GET /missing']]);
  });

  it('is a row naming each where a later setting several claim is served by more than one', () => {
    const result = link({ method: 'GET', path: '/v1/both', baseUrlEnv: 'ORDERS_URL', baseUrlAlso: ['LEGACY_URL'] });
    expect(joins(result)).toEqual([]);
    const [row] = result.project.unresolved;
    expect(row?.reason).toBe('ambiguous-route-target');
    expect(row?.message).toBe(
      "the request's base is one of ORDERS_URL (orders) and LEGACY_URL (legacy) and LEGACY_URL (archive), read from the first of them that is set, and legacy and archive each serve GET /v1/both",
    );
    expect(result.report.httpOut.ambiguous).toBe(1);
  });

  it("reads a browser's request the same way", () => {
    expect(joins(link(chain('/v0/orders'), 'ui_api_call'))).toEqual(['ui_api_call entry:archive:http:GET:/v0/orders heuristic']);
    expect(joins(link(chain('/orders'), 'ui_api_call'))).toEqual(['ui_api_call entry:orders:http:GET:/orders static']);
    const row = link({ method: 'GET', path: '/v1/both', baseUrlEnv: 'ORDERS_URL', baseUrlAlso: ['LEGACY_URL'] }, 'ui_api_call').project.unresolved[0];
    expect(row?.reason).toBe('ambiguous-route-target');
    expect(row?.message).toContain('read from the first of them that is set');
  });

  it('names nothing where the chain reaches one service', () => {
    const call = request({ method: 'GET', path: '/x', baseUrlEnv: 'A', baseUrlAlso: ['B'] });
    expect(settingCandidates(call, (setting) => (setting === 'A' || setting === 'B' ? ['orders'] : []))).toBeUndefined();
    const candidates = settingCandidates(call, (setting) => (setting === 'A' ? ['orders'] : setting === 'B' ? ['legacy'] : []));
    expect(candidates).toEqual({ order: 'chain', tiers: [[{ service: 'orders', settings: ['A'] }], [{ service: 'legacy', settings: ['B'] }]] });
    expect(chooseAmongSettings(candidates as NonNullable<typeof candidates>, (service) => (service === 'orders' ? service : undefined))).toBeUndefined();
  });
});

describe("a condition's branch setting several services claim (P313)", () => {
  /** `isProd ? process.env.ORDERS_URL : process.env.LEGACY_URL`, LEGACY_URL claimed by legacy and archive. */
  const branched = (path: string) => ({ method: 'GET', path, baseUrlEnv: 'ORDERS_URL', baseUrlAlso: ['LEGACY_URL'], baseUrlEither: ['ORDERS_URL', 'LEGACY_URL'], guessed: true });

  it('asks every claimant of the setting: one serving the request is the join', () => {
    const result = link(branched('/v0/orders'));
    expect(joins(result)).toEqual(['http_out entry:archive:http:GET:/v0/orders heuristic']);
    expect(chosenAmong(result)).toEqual(['ORDERS_URL (orders)', 'LEGACY_URL (legacy)', 'LEGACY_URL (archive)']);
  });

  it('is a row naming them where several serve it', () => {
    const [row] = link(branched('/v1/both')).project.unresolved;
    expect(row?.reason).toBe('ambiguous-route-target');
    expect(row?.message).toContain('chosen by a condition nobody settles, and legacy and archive each serve GET /v1/both');
  });
});

describe('a key a settings factory builds from a variable, for every setting of a chain or a condition (P313)', () => {
  it("claims a branch's key by whoever claims its variable", () => {
    const meta = {
      method: 'GET',
      path: '/v1/orders',
      baseUrlEnv: 'orders.url',
      baseUrlVariable: 'ORDERS_URL',
      baseUrlAlso: ['legacy.url'],
      baseUrlEither: ['orders.url', 'legacy.url'],
      baseUrlVariables: { 'legacy.url': 'LEGACY_URL' },
      guessed: true,
    };
    const result = link(meta);
    expect(joins(result)).toEqual(['http_out entry:legacy:http:GET:/v1/orders heuristic']);
    expect(chosenAmong(result)).toEqual(['orders.url (orders)', 'legacy.url (legacy)', 'legacy.url (archive)']);
  });

  it("claims a chain's later key by whoever claims its variable, nobody claiming the first", () => {
    const meta = { method: 'GET', path: '/v0/orders', baseUrlEnv: 'catalog.url', baseUrlAlso: ['archive.url'], baseUrlVariables: { 'archive.url': 'ARCHIVE_URL' } };
    expect(joins(link(meta))).toEqual(['http_out entry:archive:http:GET:/v0/orders static']);
    // And where the first's claimant lacks the route, the later key's claimant serving it.
    const after = { method: 'GET', path: '/v0/orders', baseUrlEnv: 'orders.url', baseUrlVariable: 'ORDERS_URL', baseUrlAlso: ['archive.url'], baseUrlVariables: { 'archive.url': 'ARCHIVE_URL' } };
    expect(joins(link(after))).toEqual(['http_out entry:archive:http:GET:/v0/orders heuristic']);
  });
});

describe("a setting's written fallback port is a guess (P313)", () => {
  const routes: Record<string, GraphNode[]> = {
    shop: [route('shop', 'GET', '/api/cart')],
    api: [route('api', 'GET', '/health')],
  };
  /** `listen(process.env.PORT ?? 3000)`: the fallback the code writes. */
  const FALLBACK = { service: 'api', file: 'src/main.ts', line: 9, setting: 'PORT' } as const;
  /** A full-stack framework's own server on the port it assumes (P296). */
  const ASSUMED = { service: 'shop', file: 'package.json', line: 5, setting: 'PORT', default: true } as const;
  const heard = (...each: Listening[]): PortIndex => ({ configured: new Map(), all: new Map(), listening: new Map([[3000, each]]) });
  const asked = (path: string) => servesRequest((service) => routes[service], { method: 'GET', paths: [path] });

  it('yields to a default-port service serving the request, and outranks it where nobody does', () => {
    expect(atLocalPort(`${LOCAL}/api/cart`, heard(FALLBACK, ASSUMED), asked('/api/cart'))).toMatchObject({ kind: 'service', service: 'shop' });
    expect(atLocalPort(`${LOCAL}/health`, heard(FALLBACK, ASSUMED), asked('/health'))).toMatchObject({ kind: 'service', service: 'api', sure: false });
    expect(atLocalPort(`${LOCAL}/items`, heard(FALLBACK, ASSUMED), asked('/items'))).toMatchObject({ kind: 'service', service: 'api' });
  });

  it('outranks a merged port where nobody serves the request', () => {
    const merged = { service: 'shop', file: 'src/server.ts', line: 4, merged: 'src/server.ts:2' };
    expect(atLocalPort(`${LOCAL}/items`, heard(FALLBACK, merged), asked('/items'))).toMatchObject({ kind: 'service', service: 'api' });
  });

  it('stays firm where a container publishes it, or a loaded file gives the setting', () => {
    const published = { ...FALLBACK, published: { port: 3000, file: 'docker-compose.yml' } };
    expect(atLocalPort(`${LOCAL}/api/cart`, heard(published, ASSUMED), asked('/api/cart'))).toMatchObject({ kind: 'service', service: 'api' });
    const loaded = { ...FALLBACK, valueFrom: '.env' };
    expect(atLocalPort(`${LOCAL}/api/cart`, heard(loaded, ASSUMED), asked('/api/cart'))).toMatchObject({ kind: 'service', service: 'api' });
    const filed: PortIndex = { ...heard(FALLBACK, ASSUMED), all: new Map([['localhost:3000', ['api']]]) };
    expect(atLocalPort(`${LOCAL}/api/cart`, filed, asked('/api/cart'))).toMatchObject({ kind: 'service', service: 'api' });
  });

  it('keeps the published port over the fallback it publishes, for one service at one port', () => {
    const nodes = new Map<string, GraphNode>([['repo:api', { id: 'repo:api', type: 'repo', label: 'api', repo: 'api', meta: { listen: [{ port: 3000, file: 'src/main.ts', line: 9, setting: 'PORT' }] } }]]);
    const settings: Record<string, RepoSettings> = {
      api: {
        ...NO_SETTINGS,
        hosts: localHostsOf(3000).map((host) => ({ host, file: 'docker-compose.yml', mapped: { published: 3000, container: 3000, side: 'published' as const } })),
        containers: [{ name: 'api', names: ['api'], file: 'docker-compose.yml', ports: [{ published: 3000, container: 3000, file: 'docker-compose.yml', line: 6 }], environment: {} }],
      },
    };
    const [kept] = portsListening(nodes, settings).byPort.get(3000) ?? [];
    expect(kept?.published).toEqual({ port: 3000, file: 'docker-compose.yml' });
  });
});
