import { SCHEMA_VERSION, parseConfig, type GraphNode, type ListenPort, type RepoGraph } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';
import { atLocalPort, type Listening, type PortIndex } from './local-port.js';
import { servesRequest } from './request-served.js';

const FIXED = '2026-01-01T00:00:00.000Z';
const SLASHES = '/'.repeat(2);
const LOCAL = `http:${SLASHES}localhost:3000`;

const route = (repo: string, method: string, path: string): GraphNode => ({
  id: `entry:${repo}:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path },
});

/** A full-stack framework's own server, on the port it assumes where nothing says (P296). */
const ASSUMED = { file: 'package.json', line: 5, setting: 'PORT', default: true as const };
/** A server's port read through a merge helper of the repository's own (P305): a guess. */
const MERGED = { file: 'src/main.ts', line: 9, merged: 'src/main.ts:7' };

describe('atLocalPort where a default and a merged port meet (P307)', () => {
  const routes: Record<string, GraphNode[]> = {
    shop: [route('shop', 'GET', '/api/cart')],
    api: [route('api', 'POST', '/graphql'), route('api', 'GET', '/health')],
  };
  const heard = (...each: Listening[]): PortIndex => ({ configured: new Map(), all: new Map(), listening: new Map([[3000, each]]) });
  const index = heard({ service: 'api', ...MERGED }, { service: 'shop', ...ASSUMED });
  const asked = (method: string, path: string, operation = false) => servesRequest((service) => routes[service], { method, paths: [path], operation });

  it('takes no request from the assumed service that serves it', () => {
    expect(atLocalPort(`${LOCAL}/api/cart`, index, asked('GET', '/api/cart'))).toMatchObject({ kind: 'service', service: 'shop', sure: false });
  });

  it('places at the merged port what its service serves', () => {
    expect(atLocalPort(`${LOCAL}/graphql`, index, asked('POST', '/graphql', true))).toMatchObject({ kind: 'service', service: 'api', sure: false });
    expect(atLocalPort(`${LOCAL}/health`, index, asked('GET', '/health'))).toMatchObject({ kind: 'service', service: 'api' });
  });

  it('lets the merged port outrank the default where neither serves the request, as before', () => {
    expect(atLocalPort(`${LOCAL}/items`, index, asked('GET', '/items'))).toMatchObject({ kind: 'service', service: 'api' });
    expect(atLocalPort(`${LOCAL}/api/cart`, index)).toMatchObject({ kind: 'service', service: 'api' });
  });

  it('is a row where both serve the request', () => {
    const both: Record<string, GraphNode[]> = { ...routes, shop: [...(routes['shop'] ?? []), route('shop', 'GET', '/health')] };
    const serves = servesRequest((service) => both[service], { method: 'GET', paths: ['/health'] });
    expect(atLocalPort(`${LOCAL}/health`, index, serves)).toMatchObject({ kind: 'shared', port: 3000, services: ['api', 'shop'] });
  });

  it('keeps an example value of a default a guess as weak as the default', () => {
    const example = heard({ service: 'api', ...MERGED }, { service: 'shop', ...ASSUMED, valueFrom: '.env.example' });
    expect(atLocalPort(`${LOCAL}/api/cart`, example, asked('GET', '/api/cart'))).toMatchObject({ kind: 'service', service: 'shop' });
  });

  it('lets a port the code writes as a number win outright, a served default or not', () => {
    const written = heard({ service: 'api', file: 'src/main.ts', line: 9 }, { service: 'shop', ...ASSUMED });
    expect(atLocalPort(`${LOCAL}/api/cart`, written, asked('GET', '/api/cart'))).toMatchObject({ kind: 'service', service: 'api', sure: true });
  });

  it("takes a setting's written fallback as a guess that yields to a served default, and outranks it where nobody serves the request (P313)", () => {
    const fallback = heard({ service: 'api', file: 'src/main.ts', line: 9, setting: 'PORT' }, { service: 'shop', ...ASSUMED });
    expect(atLocalPort(`${LOCAL}/api/cart`, fallback, asked('GET', '/api/cart'))).toMatchObject({ kind: 'service', service: 'shop' });
    expect(atLocalPort(`${LOCAL}/items`, fallback, asked('GET', '/items'))).toMatchObject({ kind: 'service', service: 'api', sure: false });
  });

  it('lets a file placing a service win outright', () => {
    const filed: PortIndex = { ...index, all: new Map([['localhost:3000', ['api']]]) };
    expect(atLocalPort(`${LOCAL}/api/cart`, filed, asked('GET', '/api/cart'))).toMatchObject({ kind: 'service', service: 'api' });
  });
});

describe('an application calling its own route on a port a merged server shares (P307)', () => {
  const graph = (repo: string, nodes: GraphNode[]): RepoGraph => ({
    schemaVersion: SCHEMA_VERSION,
    repo,
    generatedAt: FIXED,
    nodes,
    edges: [],
    types: {},
    unresolved: [],
  });
  const listens = (repo: string, ports: ListenPort[]): GraphNode => ({ id: `repo:${repo}`, type: 'repo', label: repo, repo, meta: { listen: ports } });
  const call = (repo: string, method: string, path: string, line: number): GraphNode => ({
    id: `http_out:${repo}#src/call.ts:${line}:1`,
    type: 'http_out',
    kind: 'http',
    label: `${method} ${path}`,
    repo,
    file: 'src/call.ts',
    line,
    meta: { method, path, host: 'localhost:3000', url: `${LOCAL}${path}` },
  });
  const services = parseConfig({
    services: ['shop', 'api'].map((name) => ({ name, repo: `./${name}`, type: 'express' })),
  } as Parameters<typeof parseConfig>[0]);

  it('joins its own route, and a request only the server serves the server', () => {
    const shop = graph('shop', [
      listens('shop', [{ port: 3000, ...ASSUMED }]),
      route('shop', 'GET', '/api/cart'),
      call('shop', 'GET', '/api/cart', 4),
      call('shop', 'GET', '/items', 8),
    ]);
    const api = graph('api', [listens('api', [{ port: 3000, ...MERGED }]), route('api', 'GET', '/items')]);
    const result = linkGraphs([api, shop], services, { builtAt: FIXED });
    expect(
      result.project.edges
        .filter((edge) => edge.type === 'http_calls')
        .map((edge) => `${edge.from.split('#')[1]} ${edge.to} ${edge.confidence}`)
        .sort(),
    ).toEqual(['src/call.ts:4:1 entry:shop:http:GET:/api/cart heuristic', 'src/call.ts:8:1 entry:api:http:GET:/items heuristic']);
  });
});
