import { NO_SETTINGS, SCHEMA_VERSION, parseConfig, type GraphNode, type RepoGraph, type RepoSettings } from '@flowatlas/core';
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

/** ORDERS_URL claimed by orders and legacy; LEGACY_URL by legacy; ARCHIVE_URL by archive. */
const services = parseConfig({
  services: [
    { name: 'web', repo: './web', type: 'express' },
    { name: 'orders', repo: './orders', type: 'express', baseUrlEnv: ['ORDERS_URL'] },
    { name: 'legacy', repo: './legacy', type: 'express', baseUrlEnv: ['ORDERS_URL', 'LEGACY_URL'] },
    { name: 'archive', repo: './archive', type: 'express', baseUrlEnv: ['ARCHIVE_URL'] },
  ],
} as Parameters<typeof parseConfig>[0]);

const targets = [
  graph('orders', [route('orders', 'GET', '/orders'), route('orders', 'GET', '/both')]),
  graph('legacy', [route('legacy', 'GET', '/v1/orders'), route('legacy', 'GET', '/both')]),
  graph('archive', [route('archive', 'GET', '/v0/orders')]),
];

const link = (meta: Record<string, unknown>, type: 'http_out' | 'ui_api_call' = 'http_out') => linkGraphs([...targets, graph('web', [request(meta, type)])], services, { builtAt: FIXED });

describe('a setting several services claim, its claimants asked whether they serve the request (P319)', () => {
  const plain = (path: string) => ({ method: 'GET', path, baseUrlEnv: 'ORDERS_URL' });

  it('joins the one claimant serving the request, as a guess naming each claim', () => {
    const result = link(plain('/v1/orders'));
    expect(joins(result)).toEqual(['http_out entry:legacy:http:GET:/v1/orders heuristic']);
    expect(chosenAmong(result)).toEqual(['ORDERS_URL (orders)', 'ORDERS_URL (legacy)']);
    expect(result.project.unresolved).toEqual([]);
  });

  it('is an ambiguous-route-target row where several serve it', () => {
    const result = link(plain('/both'));
    expect(joins(result)).toEqual([]);
    const [row] = result.project.unresolved;
    expect(row?.reason).toBe('ambiguous-route-target');
    expect(row?.message).toBe(
      "the request's base is one of ORDERS_URL (orders) and ORDERS_URL (legacy), a setting several services claim, and orders and legacy each serve GET /both",
    );
    expect(result.report.httpOut.ambiguous).toBe(1);
  });

  it('keeps the row naming the claimants where none serves it, as before', () => {
    const [row] = link(plain('/missing')).project.unresolved;
    expect([row?.reason, row?.message]).toEqual(['unknown-base-url-env', 'ORDERS_URL is declared on services orders and legacy']);
  });

  it("is a chain's first tier like any other: a later setting is asked only where no claimant serves it", () => {
    const chain = (path: string) => ({ ...plain(path), baseUrlAlso: ['ARCHIVE_URL'] });
    expect(joins(link(chain('/v1/orders')))).toEqual(['http_out entry:legacy:http:GET:/v1/orders heuristic']);
    expect(joins(link(chain('/v0/orders')))).toEqual(['http_out entry:archive:http:GET:/v0/orders heuristic']);
    expect(link(chain('/both')).project.unresolved[0]?.message).toContain('read from the first of them that is set, and orders and legacy each serve GET /both');
  });

  it("reads a browser's request the same way", () => {
    expect(joins(link(plain('/v1/orders'), 'ui_api_call'))).toEqual(['ui_api_call entry:legacy:http:GET:/v1/orders heuristic']);
    const [row] = link(plain('/both'), 'ui_api_call').project.unresolved;
    expect(row?.reason).toBe('ambiguous-route-target');
    expect(row?.message).toContain('a setting several services claim');
  });

  it('names the order of one setting several claim', () => {
    const call = request(plain('/x'));
    const candidates = settingCandidates(call, (setting) => (setting === 'ORDERS_URL' ? ['legacy', 'orders'] : []));
    expect(candidates).toEqual({ order: 'claimed', tiers: [[{ service: 'legacy', settings: ['ORDERS_URL'] }, { service: 'orders', settings: ['ORDERS_URL'] }]] });
    expect(chooseAmongSettings(candidates as NonNullable<typeof candidates>, (service) => (service === 'orders' ? service : undefined))).toMatchObject({ kind: 'one', order: 'claimed' });
  });
});

describe('a condition nested in a chain, the chain after it a later tier (P319)', () => {
  /** `(isProd ? process.env.LEGACY_URL : process.env.ORDERS_URL) || process.env.ARCHIVE_URL`, as the extractor writes it. */
  const nested = (path: string) => ({
    method: 'GET',
    path,
    baseUrlEnv: 'LEGACY_URL',
    baseUrlAlso: ['ORDERS_URL', 'ARCHIVE_URL'],
    baseUrlEither: ['LEGACY_URL', 'ORDERS_URL'],
    guessed: true,
  });

  it("asks the chain's later setting where no branch's claimant serves the request", () => {
    const result = link(nested('/v0/orders'));
    expect(joins(result)).toEqual(['http_out entry:archive:http:GET:/v0/orders heuristic']);
    expect(chosenAmong(result)).toEqual(['LEGACY_URL, ORDERS_URL (legacy)', 'ORDERS_URL (orders)', 'ARCHIVE_URL (archive)']);
  });

  it("keeps the condition's own choice where a branch's claimant serves it", () => {
    expect(joins(link(nested('/orders')))).toEqual(['http_out entry:orders:http:GET:/orders heuristic']);
    expect(link(nested('/both')).project.unresolved[0]?.message).toContain('chosen by a condition nobody settles, and legacy and orders each serve GET /both');
  });

  it('is a tier of its own where both branches reach one service', () => {
    const call = request({ method: 'GET', path: '/x', baseUrlEnv: 'A', baseUrlAlso: ['B', 'C'], baseUrlEither: ['A', 'B'] });
    const claimants = (setting: string): string[] => (setting === 'A' || setting === 'B' ? ['orders'] : setting === 'C' ? ['archive'] : []);
    const candidates = settingCandidates(call, claimants);
    expect(candidates).toEqual({ order: 'either', tiers: [[{ service: 'orders', settings: ['A', 'B'] }], [{ service: 'archive', settings: ['C'] }]] });
    // The branches' one service serving it is the join it always was.
    expect(chooseAmongSettings(candidates as NonNullable<typeof candidates>, (service) => service)).toBeUndefined();
    expect(chooseAmongSettings(candidates as NonNullable<typeof candidates>, (service) => (service === 'archive' ? service : undefined))).toMatchObject({ kind: 'one', order: 'chain' });
  });
});

describe('a written fallback port whose setting an environment file gives (P319)', () => {
  const node = (port: Record<string, unknown>): Map<string, GraphNode> =>
    new Map([['repo:api', { id: 'repo:api', type: 'repo', label: 'api', repo: 'api', meta: { listen: [{ port: 3000, file: 'src/main.ts', line: 9, setting: 'PORT', ...port }] } }]]);
  const given = (...values: { port: number; file: string; example?: true }[]): Record<string, RepoSettings> => ({ api: { ...NO_SETTINGS, ports: { PORT: values } } });

  it("listens at the file's port, firm, and not at the fallback", () => {
    const { byPort } = portsListening(node({}), given({ port: 4000, file: '.env' }));
    expect(byPort.get(3000)).toBeUndefined();
    expect(byPort.get(4000)).toEqual([{ service: 'api', file: 'src/main.ts', line: 9, setting: 'PORT', valueFrom: '.env' }]);
    const index: PortIndex = { configured: new Map(), all: new Map(), listening: byPort };
    expect(atLocalPort(`http:${SLASHES}localhost:4000/x`, index)).toMatchObject({ kind: 'service', service: 'api' });
    expect(atLocalPort(`${LOCAL}/x`, index)).toBeUndefined();
  });

  it("offers an example file's port beside the fallback, both guesses", () => {
    const { byPort } = portsListening(node({}), given({ port: 4000, file: '.env.example', example: true }));
    expect(byPort.get(3000)?.map((each) => each.valueFrom)).toEqual([undefined]);
    expect(byPort.get(4000)).toEqual([{ service: 'api', file: 'src/main.ts', line: 9, setting: 'PORT', valueFrom: '.env.example', example: true }]);
  });

  it('leaves a default, a merged port and a port the reader already filled as they were', () => {
    for (const port of [{ default: true }, { merged: 'src/main.ts:2' }, { valueFrom: '.env' }]) {
      expect(portsListening(node(port), given({ port: 4000, file: '.env' })).byPort.get(4000)).toBeUndefined();
    }
  });
});

describe('a firm port beside a guess at the same number (P319)', () => {
  const routes: Record<string, GraphNode[]> = { shop: [route('shop', 'GET', '/api/cart')], api: [route('api', 'GET', '/health')] };
  const asked = (path: string) => servesRequest((service) => routes[service], { method: 'GET', paths: [path] });
  const heard = (...each: Listening[]): PortIndex => ({ configured: new Map(), all: new Map(), listening: new Map([[3000, each]]) });
  /** `listen(process.env.PORT ?? 3000)`, a guess. */
  const FALLBACK = { service: 'api', file: 'src/main.ts', line: 9, setting: 'PORT' } as const;
  /** `listen(3000)`, firm. */
  const WRITTEN = { service: 'shop', file: 'src/server.ts', line: 4 } as const;

  it('is the firm one outright, whoever serves the request', () => {
    expect(atLocalPort(`${LOCAL}/health`, heard(FALLBACK, WRITTEN), asked('/health'))).toMatchObject({ kind: 'service', service: 'shop', sure: true });
    expect(atLocalPort(`${LOCAL}/api/cart`, heard(FALLBACK, WRITTEN))).toMatchObject({ kind: 'service', service: 'shop' });
  });

  it('drops a merged, offered or default guess the same way, and a firmly filed service stays', () => {
    const merged = { service: 'api', file: 'src/main.ts', line: 9, merged: 'src/main.ts:2' };
    const offered = { service: 'api', file: 'src/main.ts', line: 9, setting: 'PORT', valueFrom: '.env.example', example: true as const };
    for (const guess of [merged, offered]) expect(atLocalPort(`${LOCAL}/x`, heard(guess, WRITTEN))).toMatchObject({ kind: 'service', service: 'shop' });
    const offeredOnly: PortIndex = { ...heard(WRITTEN), all: new Map([['localhost:3000', ['api']]]), offered: new Map([['localhost:3000', ['api']]]) };
    expect(atLocalPort(`${LOCAL}/x`, offeredOnly)).toMatchObject({ kind: 'service', service: 'shop' });
    const filed: PortIndex = { ...heard(FALLBACK, WRITTEN), all: new Map([['localhost:3000', ['api']]]) };
    expect(atLocalPort(`${LOCAL}/x`, filed)).toMatchObject({ kind: 'shared', services: ['api', 'shop'] });
  });

  it('keeps two firm ports shared', () => {
    const published = { ...FALLBACK, published: { port: 3000, file: 'docker-compose.yml' } };
    expect(atLocalPort(`${LOCAL}/x`, heard(published, WRITTEN))).toMatchObject({ kind: 'shared', services: ['api', 'shop'] });
  });
});
