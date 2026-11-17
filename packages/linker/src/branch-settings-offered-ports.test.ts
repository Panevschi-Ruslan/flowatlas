import { NO_SETTINGS, SCHEMA_VERSION, parseConfig, type GraphNode, type RepoGraph, type RepoSettings } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { branchClaims } from './base-url-value.js';
import { linkGraphs } from './link.js';
import { atLocalPort, portsListening, whereListening, type Listening, type PortIndex } from './local-port.js';
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

const request = (repo: string, meta: Record<string, unknown>, type: 'http_out' | 'ui_api_call' = 'http_out'): GraphNode => ({
  id: `${type}:${repo}#src/call.ts:4:9`,
  type,
  kind: 'http',
  label: `${String(meta['method'])} ${String(meta['path'])}`,
  repo,
  file: 'src/call.ts',
  line: 4,
  meta,
});

const listening = (repo: string, ports: readonly Record<string, unknown>[]): GraphNode => ({ id: `repo:${repo}`, type: 'repo', label: repo, repo, meta: { listen: ports } });

const joins = (result: ReturnType<typeof linkGraphs>) =>
  result.project.edges
    .filter((edge) => edge.type === 'hits' || edge.type === 'http_calls')
    .map((edge) => `${edge.from.split(':')[0]} ${edge.to} ${edge.confidence}`)
    .sort();

const config = (services: readonly { name: string; type: string; baseUrlEnv?: string[] }[]) =>
  parseConfig({ services: services.map((service) => ({ ...service, repo: `./${service.name}` })) } as Parameters<typeof parseConfig>[0]);

describe("a condition's branches over settings different services claim (P309)", () => {
  const services = config([
    { name: 'web', type: 'express' },
    { name: 'orders', type: 'express', baseUrlEnv: ['ORDERS_URL'] },
    { name: 'legacy', type: 'express', baseUrlEnv: ['LEGACY_URL'] },
  ]);
  /** `isProd ? process.env.ORDERS_URL : process.env.LEGACY_URL`, as the extractor writes it. */
  const branched = (path: string, type: 'http_out' | 'ui_api_call' = 'http_out') =>
    graph('web', [request('web', { method: 'GET', path, baseUrlEnv: 'ORDERS_URL', baseUrlAlso: ['LEGACY_URL'], baseUrlEither: ['ORDERS_URL', 'LEGACY_URL'], guessed: true }, type)]);
  const targets = [
    graph('orders', [route('orders', 'GET', '/orders'), route('orders', 'GET', '/health')]),
    graph('legacy', [route('legacy', 'GET', '/v1/orders'), route('legacy', 'GET', '/health')]),
  ];
  const link = (path: string, type: 'http_out' | 'ui_api_call' = 'http_out') => linkGraphs([...targets, branched(path, type)], services, { builtAt: FIXED });

  it("joins the other branch's service where only it serves the request, as a guess", () => {
    const result = link('/v1/orders');
    expect(joins(result)).toEqual(['http_out entry:legacy:http:GET:/v1/orders heuristic']);
    expect(result.project.edges.find((edge) => edge.type === 'http_calls')?.meta?.['chosenAmong']).toEqual(['ORDERS_URL (orders)', 'LEGACY_URL (legacy)']);
    expect(result.project.unresolved).toEqual([]);
  });

  it("joins the first branch's service where only it serves the request, a guess too", () => {
    expect(joins(link('/orders'))).toEqual(['http_out entry:orders:http:GET:/orders heuristic']);
  });

  it('is an ambiguous row naming each where both serve it', () => {
    const result = link('/health');
    expect(joins(result)).toEqual([]);
    const [row] = result.project.unresolved;
    expect(row?.reason).toBe('ambiguous-route-target');
    expect(row?.message).toContain('ORDERS_URL (orders) and LEGACY_URL (legacy)');
    expect(row?.message).toContain('orders and legacy each serve GET /health');
    expect(result.report.httpOut.ambiguous).toBe(1);
  });

  it("is the first branch's row where neither serves it, as before", () => {
    const result = link('/missing');
    expect(joins(result)).toEqual([]);
    expect(result.project.unresolved.map((row) => [row.reason, row.message])).toEqual([['target-route-not-found', 'target service orders has no route GET /missing']]);
  });

  it("reads a browser's request the same way", () => {
    expect(joins(link('/v1/orders', 'ui_api_call'))).toEqual(['ui_api_call entry:legacy:http:GET:/v1/orders heuristic']);
    const row = link('/health', 'ui_api_call').project.unresolved[0];
    expect(row?.reason).toBe('ambiguous-route-target');
    expect(row?.message).toContain('ORDERS_URL (orders) and LEGACY_URL (legacy)');
  });

  it("follows a chain of || to a later setting's claimant only where the first's lacks the route (P313)", () => {
    const chain = graph('web', [request('web', { method: 'GET', path: '/v1/orders', baseUrlEnv: 'ORDERS_URL', baseUrlAlso: ['LEGACY_URL'] })]);
    const result = linkGraphs([...targets, chain], services, { builtAt: FIXED });
    expect(joins(result)).toEqual(['http_out entry:legacy:http:GET:/v1/orders heuristic']);
  });

  it('names nothing where the branches are claimed by one service, and every claimant of a setting several claim (P313)', () => {
    const claims = (claimed: Record<string, readonly string[]>) => branchClaims(branched('/x').nodes[0] as GraphNode, (setting) => claimed[setting] ?? []);
    expect(claims({ ORDERS_URL: ['orders'], LEGACY_URL: ['orders'] })).toBeUndefined();
    expect(claims({ ORDERS_URL: ['orders'], LEGACY_URL: ['legacy', 'orders'] })).toEqual([
      { service: 'orders', settings: ['ORDERS_URL', 'LEGACY_URL'] },
      { service: 'legacy', settings: ['LEGACY_URL'] },
    ]);
    expect(claims({ ORDERS_URL: ['orders'], LEGACY_URL: ['legacy'] })).toEqual([
      { service: 'orders', settings: ['ORDERS_URL'] },
      { service: 'legacy', settings: ['LEGACY_URL'] },
    ]);
  });
});

describe('a port an example environment file offers (P309)', () => {
  const routes: Record<string, GraphNode[]> = {
    shop: [route('shop', 'GET', '/api/cart')],
    api: [route('api', 'GET', '/items')],
  };
  const asked = (method: string, path: string) => servesRequest((service) => routes[service], { method, paths: [path] });
  const ASSUMED = { file: 'package.json', line: 5, setting: 'PORT', default: true as const };
  const index = (heard: Listening[], filed: Record<string, string[]>, offered: Record<string, string[]>): PortIndex => ({
    configured: new Map(),
    all: new Map(Object.entries(filed)),
    offered: new Map(Object.entries(offered)),
    listening: new Map([[3000, heard]]),
  });

  it("takes no request from a default service that serves it, as a merged port does not (P307)", () => {
    const offered = index([{ service: 'shop', ...ASSUMED }], { 'localhost:3000': ['api'] }, { 'localhost:3000': ['api'] });
    expect(atLocalPort(`${LOCAL}/api/cart`, offered, asked('GET', '/api/cart'))).toMatchObject({ kind: 'service', service: 'shop', sure: false });
    expect(atLocalPort(`${LOCAL}/items`, offered, asked('GET', '/items'))).toMatchObject({ kind: 'service', service: 'api', sure: false });
    // Where neither serves it, the offered port outranks the default, as a merged one does.
    expect(atLocalPort(`${LOCAL}/other`, offered, asked('GET', '/other'))).toMatchObject({ kind: 'service', service: 'api' });
  });

  it('keeps a port a file the framework loads, or a container publishes, placing the service outright', () => {
    const placed = index([{ service: 'shop', ...ASSUMED }], { 'localhost:3000': ['api'] }, {});
    expect(atLocalPort(`${LOCAL}/api/cart`, placed, asked('GET', '/api/cart'))).toMatchObject({ kind: 'service', service: 'api' });
  });

  it("asks the code reading the port from a setting alone at an example's value whether it serves the request", () => {
    const heard = index([{ service: 'shop', ...ASSUMED }, { service: 'api', file: 'src/main.ts', line: 3, setting: 'PORT', valueFrom: '.env.example', example: true }], {}, {});
    expect(atLocalPort(`${LOCAL}/api/cart`, heard, asked('GET', '/api/cart'))).toMatchObject({ kind: 'service', service: 'shop' });
    // A value a loaded file gives is firm.
    const loaded = index([{ service: 'shop', ...ASSUMED }, { service: 'api', file: 'src/main.ts', line: 3, setting: 'PORT', valueFrom: '.env.development' }], {}, {});
    expect(atLocalPort(`${LOCAL}/api/cart`, loaded, asked('GET', '/api/cart'))).toMatchObject({ kind: 'service', service: 'api' });
  });

  it("joins an application's own route on the default port an example file offers another service, through the linker", () => {
    const services = config([
      { name: 'shop', type: 'nextjs' },
      { name: 'api', type: 'express' },
    ]);
    const shop = graph('shop', [
      listening('shop', [{ port: 3000, ...ASSUMED }]),
      route('shop', 'GET', '/api/cart'),
      request('shop', { method: 'GET', path: '/api/cart', host: 'localhost:3000', url: `${LOCAL}/api/cart` }),
    ]);
    const api = graph('api', [route('api', 'GET', '/items')]);
    const example = (flag: boolean): Record<string, RepoSettings> => ({
      api: {
        ...NO_SETTINGS,
        hosts: ['localhost:3000', '127.0.0.1:3000', '0.0.0.0:3000'].map((host) => ({ host, file: flag ? '.env.example' : 'wrangler.toml', ...(flag ? { example: true as const } : {}) })),
      },
    });
    expect(joins(linkGraphs([shop, api], services, { builtAt: FIXED, settings: example(true) }))).toEqual(['http_out entry:shop:http:GET:/api/cart heuristic']);
    // A port a deployment file places stays firm: the request goes to api, which lacks the route.
    expect(joins(linkGraphs([shop, api], services, { builtAt: FIXED, settings: example(false) }))).toEqual([]);
  });
});

describe("a code port's fallback, and the value an example environment file offers its setting (P321)", () => {
  const nodes = (ports: readonly Record<string, unknown>[]) => new Map([['repo:orders', listening('orders', ports)]]);
  const settings = (values: readonly { port: number; file: string; example?: true }[]): Record<string, RepoSettings> => ({
    orders: { ...NO_SETTINGS, ports: { ORDERS_PORT: values } },
  });
  const heard = (index: ReturnType<typeof portsListening>) =>
    [...index.byPort.entries()]
      .map(([port, all]) => `${port} ${all.map((each) => `${each.service}${each.valueFrom === undefined ? '' : ` from ${each.valueFrom}`}${each.example === true ? ' example' : ''}`).join(', ')}`)
      .sort();

  it("offers the example's value beside the fallback, and nothing a committed file nothing loads gives", () => {
    const fallback = [{ port: 3000, file: 'src/main.ts', line: 4, setting: 'ORDERS_PORT' }];
    expect(heard(portsListening(nodes(fallback), settings([{ port: 4100, file: '.env.example', example: true }])))).toEqual(['3000 orders', '4100 orders from .env.example example']);
    expect(heard(portsListening(nodes(fallback), settings([{ port: 4100, file: '.env' }])))).toEqual(['3000 orders']);
    // A port filled from a file the code loads is the file's, with nothing more offered.
    const filled = [{ port: 4200, file: 'src/main.ts', line: 4, setting: 'ORDERS_PORT', valueFrom: '.env' }];
    expect(heard(portsListening(nodes(filled), settings([{ port: 4100, file: '.env.example', example: true }])))).toEqual(['4200 orders from .env']);
  });

  it('takes a port read from before a write not read as a guess', () => {
    const rewritten = [{ port: 3000, file: 'src/main.ts', line: 6, rewritten: 'src/main.ts:5' }];
    const [only] = portsListening(nodes(rewritten), {}).byPort.get(3000) ?? [];
    expect(only).toMatchObject({ service: 'orders', rewritten: 'src/main.ts:5' });
    expect(whereListening(only as Listening)).toBe('src/main.ts:6 (from before the write at src/main.ts:5)');
  });
});
