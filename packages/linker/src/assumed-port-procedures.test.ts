import { NO_SETTINGS, SCHEMA_VERSION, parseConfig, type GraphNode, type ListenPort, type RepoGraph, type RepoSettings } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';
import { whereListening } from './local-port.js';
import { servesProcedure } from './request-served.js';

const FIXED = '2026-01-01T00:00:00.000Z';
const SLASHES = '/'.repeat(2);

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

/** A full-stack framework's own server, on the port it assumes where nothing says (P296). */
const ASSUMED: ListenPort = { port: 3000, file: 'package.json', line: 5, setting: 'PORT', default: true };

const procedure = (repo: string, key: string, call = 'query'): GraphNode => ({
  id: `entry:${repo}:rpc:${key}`,
  type: 'entry',
  kind: 'rpc',
  label: key,
  repo,
  meta: { key, call },
});

const sent = (repo: string, key: string, link: Record<string, unknown>, at = 3): GraphNode => ({
  id: `http_out:${repo}#src/client.ts:${at}:1`,
  type: 'http_out',
  kind: 'rpc',
  label: key,
  repo,
  file: 'src/client.ts',
  line: at,
  meta: { procedure: key, call: 'query', link },
});

const config = (names: readonly string[]) =>
  parseConfig({ services: names.map((name) => ({ name, repo: `./${name}`, type: 'express' })) } as Parameters<typeof parseConfig>[0]);

const hits = (result: ReturnType<typeof linkGraphs>) =>
  result.project.edges
    .filter((edge) => edge.type === 'hits')
    .map((edge) => `${edge.from.split('#')[0]} ${edge.to} ${edge.confidence}`)
    .sort();

describe('a procedure link at a port only a framework assumes (P305)', () => {
  // web and admin each assume 3000; web declares the procedure, admin does not.
  const services = config(['web', 'admin', 'worker']);
  const web = graph('web', [listens('web', [ASSUMED]), procedure('web', 'orders.list')]);
  const admin = graph('admin', [listens('admin', [ASSUMED]), procedure('admin', 'users.list')]);

  it('places a link whose host names the port at the one assumed service declaring the procedure', () => {
    const worker = graph('worker', [sent('worker', 'orders.list', { protocol: 'trpc', host: 'localhost:3000', path: '/api/trpc' })]);
    const result = linkGraphs([web, admin, worker], services, { builtAt: FIXED });
    expect(hits(result)).toEqual(['http_out:worker entry:web:rpc:orders.list heuristic']);
    expect(result.project.unresolved.map((row) => row.reason)).not.toContain('local-port-shared');
  });

  it("places a link rooted at a setting whose value names the port the same way", () => {
    const worker = graph('worker', [sent('worker', 'orders.list', { protocol: 'trpc', baseUrlEnv: 'SHOP_URL' })]);
    const settings: Record<string, RepoSettings> = { worker: { ...NO_SETTINGS, values: { SHOP_URL: [{ value: `http:${SLASHES}localhost:3000/api/trpc`, file: '.env.example' }] } } };
    expect(hits(linkGraphs([web, admin, worker], services, { builtAt: FIXED, settings }))).toEqual(['http_out:worker entry:web:rpc:orders.list heuristic']);
  });

  it('places nothing by the port where no assumed service declares the procedure, as before', () => {
    const worker = graph('worker', [sent('worker', 'carts.read', { protocol: 'trpc', host: 'localhost:3000', path: '/api/trpc' })]);
    const result = linkGraphs([web, admin, worker], services, { builtAt: FIXED });
    expect(hits(result)).toEqual([]);
    expect(result.project.unresolved.map((row) => row.reason)).not.toContain('local-port-shared');
  });

  it("asks a gRPC method's service: a server implementing it is where the link goes, the missing method its own finding", () => {
    const cart = graph('web', [listens('web', [ASSUMED]), procedure('web', 'grpc:shop.CartService/GetCart', 'unary')]);
    const declared = { proceduresOf: (service: string) => new Map(service === 'web' ? [['grpc:shop.CartService/GetCart', procedure('web', 'x')]] : []) };
    expect(servesProcedure(declared, 'grpc:shop.CartService/EmptyCart')('web')).toBe(true);
    expect(servesProcedure(declared, 'grpc:shop.AdService/GetAds')('web')).toBe(false);
    const worker = graph('worker', [sent('worker', 'grpc:shop.CartService/EmptyCart', { protocol: 'grpc', host: 'localhost:3000' })]);
    const result = linkGraphs([cart, admin, worker], services, { builtAt: FIXED });
    expect(result.project.unresolved.find((row) => row.service === 'worker')?.reason).toBe('procedure-not-found');
  });
});

describe('a port read through a merge, or from the environment file a framework loads (P305)', () => {
  it('says where each was read', () => {
    expect(whereListening({ service: 'api', file: 'src/main.ts', line: 9, merged: 'src/main.ts:7' })).toBe('src/main.ts:9 (read through the merge at src/main.ts:7)');
    expect(whereListening({ service: 'web', file: '.env', line: 2, setting: 'PORT', valueFrom: '.env' })).toBe('.env:2 (PORT from .env)');
    expect(whereListening({ service: 'web', file: '.env.example', line: 2, setting: 'PORT', valueFrom: '.env.example', default: true })).toBe(
      '.env.example:2 (PORT from .env.example) (an example value)',
    );
  });

  it("lets a server's merged port take its port from an assumed default, as a guess", () => {
    const services = config(['portal', 'api']);
    const portal = graph('portal', [listens('portal', [ASSUMED])]);
    const api = graph('api', [
      listens('api', [{ port: 3000, file: 'src/main.ts', line: 9, merged: 'src/main.ts:7' }]),
      { id: 'entry:api:http:GET:/items', type: 'entry', kind: 'http', label: 'GET /items', repo: 'api', meta: { method: 'GET', path: '/items' } },
    ]);
    const call: GraphNode = {
      id: 'http_out:portal#src/call.ts:4:1',
      type: 'http_out',
      kind: 'http',
      label: 'GET /items',
      repo: 'portal',
      file: 'src/call.ts',
      line: 4,
      meta: { method: 'GET', path: '/items', host: 'localhost:3000', url: `http:${SLASHES}localhost:3000/items` },
    };
    const result = linkGraphs([api, { ...portal, nodes: [...portal.nodes, call] }], services, { builtAt: FIXED });
    expect(
      result.project.edges.filter((edge) => edge.type === 'http_calls').map((edge) => `${edge.to} ${edge.confidence}`),
    ).toEqual(['entry:api:http:GET:/items heuristic']);
  });

  it("moves a framework's default off a port a .env places it elsewhere, so a request there is not its own", () => {
    const services = config(['portal', 'api']);
    const portal = graph('portal', [
      listens('portal', [{ port: 3100, file: '.env', line: 1, setting: 'PORT', valueFrom: '.env' }]),
      { id: 'entry:portal:http:GET:/items', type: 'entry', kind: 'http', label: 'GET /items', repo: 'portal', meta: { method: 'GET', path: '/items' } },
      {
        id: 'http_out:portal#src/call.ts:4:1',
        type: 'http_out',
        kind: 'http',
        label: 'GET /items',
        repo: 'portal',
        file: 'src/call.ts',
        line: 4,
        meta: { method: 'GET', path: '/items', host: 'localhost:3100', url: `http:${SLASHES}localhost:3100/items` },
      },
    ]);
    const result = linkGraphs([portal, graph('api', [])], services, { builtAt: FIXED });
    expect(result.project.edges.filter((edge) => edge.type === 'http_calls').map((edge) => `${edge.to} ${edge.confidence}`)).toEqual([
      'entry:portal:http:GET:/items heuristic',
    ]);
  });
});
