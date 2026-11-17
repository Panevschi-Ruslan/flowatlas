import { NO_SETTINGS, SCHEMA_VERSION, parseConfig, type ContainerRun, type GraphNode, type RepoGraph, type RepoSettings } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { chooseAmongSettings, settingCandidates, settingTiersAfter } from './base-url-value.js';
import { linkGraphs } from './link.js';
import { atLocalPort, portsListening, whereListening, type Listening, type PortIndex } from './local-port.js';

const FIXED = '2026-01-01T00:00:00.000Z';

const graph = (repo: string, nodes: GraphNode[]): RepoGraph => ({ schemaVersion: SCHEMA_VERSION, repo, generatedAt: FIXED, nodes, edges: [], types: {}, unresolved: [] });

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

/** ORDERS_URL claimed by orders, STAGE_URL by stage, DEV_URL by dev, ARCHIVE_URL by archive. */
const services = parseConfig({
  services: [
    { name: 'web', repo: './web', type: 'express' },
    { name: 'orders', repo: './orders', type: 'express', baseUrlEnv: ['ORDERS_URL'] },
    { name: 'stage', repo: './stage', type: 'express', baseUrlEnv: ['STAGE_URL'] },
    { name: 'dev', repo: './dev', type: 'express', baseUrlEnv: ['DEV_URL'] },
    { name: 'archive', repo: './archive', type: 'express', baseUrlEnv: ['ARCHIVE_URL'] },
  ],
} as Parameters<typeof parseConfig>[0]);

const targets = [
  graph('orders', [route('orders', 'GET', '/orders')]),
  graph('stage', [route('stage', 'GET', '/both'), route('stage', 'GET', '/stage-only')]),
  graph('dev', [route('dev', 'GET', '/both'), route('dev', 'GET', '/dev-only')]),
  graph('archive', [route('archive', 'GET', '/both'), route('archive', 'GET', '/exports')]),
];

const link = (meta: Record<string, unknown>, type: 'http_out' | 'ui_api_call' = 'http_out') => linkGraphs([...targets, graph('web', [request(meta, type)])], services, { builtAt: FIXED });

/** `process.env.ORDERS_URL || (isProd ? process.env.STAGE_URL : process.env.DEV_URL) || process.env.ARCHIVE_URL`, as the readers write it (P325). */
const chained = (path: string) => ({
  method: 'GET',
  path,
  baseUrlEnv: 'ORDERS_URL',
  baseUrlAlso: ['STAGE_URL', 'DEV_URL', 'ARCHIVE_URL'],
  baseUrlAlsoTiers: [['STAGE_URL', 'DEV_URL'], ['ARCHIVE_URL']],
});

describe('a condition later in a chain, one tier of its branches (P325)', () => {
  it('reads the tiers as the reader groups them', () => {
    const call = request(chained('/x'));
    expect(settingTiersAfter(call)).toEqual([['STAGE_URL', 'DEV_URL'], ['ARCHIVE_URL']]);
    const claimants = (setting: string): string[] => ({ ORDERS_URL: ['orders'], STAGE_URL: ['stage'], DEV_URL: ['dev'], ARCHIVE_URL: ['archive'] })[setting] ?? [];
    const candidates = settingCandidates(call, claimants);
    expect(candidates).toEqual({
      order: 'chain',
      tiers: [[{ service: 'orders', settings: ['ORDERS_URL'] }], [{ service: 'stage', settings: ['STAGE_URL'] }, { service: 'dev', settings: ['DEV_URL'] }], [{ service: 'archive', settings: ['ARCHIVE_URL'] }]],
      conditions: [1],
    });
    expect(chooseAmongSettings(candidates as NonNullable<typeof candidates>, (service) => (service === 'dev' || service === 'stage' ? service : undefined))).toMatchObject({ kind: 'several', order: 'chain-either' });
    expect(chooseAmongSettings(candidates as NonNullable<typeof candidates>, (service) => (service === 'archive' ? service : undefined))).toMatchObject({ kind: 'one', order: 'chain' });
    // Without the grouping, each later setting is a tier of its own, as before.
    const { baseUrlAlsoTiers: _tiers, ...flat } = chained('/x');
    expect(settingCandidates(request(flat), claimants)?.tiers.map((tier) => tier.map((claim) => claim.service))).toEqual([['orders'], ['stage'], ['dev'], ['archive']]);
  });

  it("asks both branches' claimants alike: both serving is a row, not the first branch's join", () => {
    const result = link(chained('/both'));
    expect(joins(result)).toEqual([]);
    const [row] = result.project.unresolved;
    expect(row?.reason).toBe('ambiguous-route-target');
    expect(row?.message).toBe(
      "the request's base is one of ORDERS_URL (orders) and STAGE_URL (stage) and DEV_URL (dev) and ARCHIVE_URL (archive), read from the first of them that is set, a condition nobody settles choosing among the later ones, and stage and dev each serve GET /both",
    );
  });

  it("joins the one branch's claimant serving it, the second branch as much as the first, and the tier after the condition where neither does", () => {
    expect(joins(link(chained('/dev-only')))).toEqual(['http_out entry:dev:http:GET:/dev-only heuristic']);
    expect(joins(link(chained('/stage-only')))).toEqual(['http_out entry:stage:http:GET:/stage-only heuristic']);
    expect(joins(link(chained('/exports')))).toEqual(['http_out entry:archive:http:GET:/exports heuristic']);
    expect(joins(link(chained('/orders')))).toEqual(['http_out entry:orders:http:GET:/orders static']);
  });

  it("reads a browser's request the same way", () => {
    expect(joins(link(chained('/dev-only'), 'ui_api_call'))).toEqual(['ui_api_call entry:dev:http:GET:/dev-only heuristic']);
    const [row] = link(chained('/both'), 'ui_api_call').project.unresolved;
    expect(row?.reason).toBe('ambiguous-route-target');
    expect(row?.message).toContain('a condition nobody settles choosing among the later ones');
  });
});

describe("a fallback port inside a container, settled by the container's own environment (P325)", () => {
  /** `listen(process.env.PORT ?? 3000)`. */
  const nodes = new Map<string, GraphNode>([['repo:orders', { id: 'repo:orders', type: 'repo', label: 'orders', repo: 'orders', meta: { listen: [{ port: 3000, file: 'src/main.ts', line: 9, setting: 'PORT' }] } }]]);
  const container = (environment: Record<string, number>, environmentFiles?: Record<string, string>): ContainerRun => ({
    name: 'orders',
    names: ['orders'],
    file: 'docker-compose.yml',
    ports: [{ published: 8080, container: 4000, file: 'docker-compose.yml', line: 5 }],
    environment,
    ...(environmentFiles === undefined ? {} : { environmentFiles }),
  });
  const settings = (run: ContainerRun, ports?: RepoSettings['ports']): Record<string, RepoSettings> => ({ orders: { ...NO_SETTINGS, containers: [run], ...(ports === undefined ? {} : { ports }) } });

  it('listens where an env file or the Dockerfile gives the setting, firm, named by that file', () => {
    const index = portsListening(nodes, settings(container({ PORT: 4000 }, { PORT: 'orders/docker.env' })));
    expect(index.inNetwork.get('orders:4000')).toEqual([
      { service: 'orders', file: 'src/main.ts', line: 9, setting: 'PORT', valueFrom: 'orders/docker.env (orders)', inContainer: { name: 'orders', file: 'docker-compose.yml' } },
    ]);
    expect(index.inNetwork.get('orders:3000')).toBeUndefined();
    const [published] = index.byPort.get(8080) ?? [];
    expect(whereListening(published as Listening)).toBe('src/main.ts:9 (PORT from orders/docker.env (orders)), published as 8080 by docker-compose.yml');
    expect(index.rows).toEqual([]);
    const port: PortIndex = { configured: new Map(), all: new Map(), listening: index.byPort };
    expect(atLocalPort(`http:${'/'.repeat(2)}localhost:8080/x`, port)).toMatchObject({ kind: 'service', service: 'orders' });
  });

  it("keeps the machine's own file out of the container: the fallback is where the container listens without one", () => {
    const index = portsListening(nodes, settings(container({}), { PORT: [{ port: 4000, file: '.env.development' }] }));
    // On the machine, the file's value is offered beside the fallback (P325).
    expect([...index.byPort.keys()].sort()).toEqual([3000, 4000]);
    // In the container, the code's fallback, and the mapping to 4000 meets nothing.
    expect(index.inNetwork.get('orders:3000')?.map((each) => each.valueFrom)).toEqual([undefined]);
    expect(index.rows.map((row) => row.reason)).toEqual(['published-port-unheard']);
  });
});
