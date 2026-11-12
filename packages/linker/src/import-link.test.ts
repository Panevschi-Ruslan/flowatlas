import { importedName, parseConfig, SCHEMA_VERSION, UNREAD_SPAN, type GraphEdge, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';

const FIXED = '2026-01-01T00:00:00.000Z';

const config = (baseUrlEnv?: string[]) =>
  parseConfig({
    services: [
      { name: 'gateway', repo: './gateway', type: 'functions', ...(baseUrlEnv === undefined ? {} : { baseUrlEnv }) },
      { name: 'orders', repo: './orders', type: 'functions' },
      { name: 'catalog', repo: './catalog', type: 'functions' },
      { name: 'web', repo: './web', type: 'functions' },
    ],
  });

const graph = (repo: string, nodes: GraphNode[], edges: GraphEdge[] = []): RepoGraph => ({ schemaVersion: SCHEMA_VERSION, repo, generatedAt: FIXED, nodes, edges, types: {}, unresolved: [] });

const repoNode = (repo: string, meta: Record<string, unknown>): GraphNode => ({ id: `repo:${repo}`, type: 'repo', label: repo, repo, meta });

const channel = (repo: string, name: string): GraphNode => ({ id: `channel:sqs/${name}`, type: 'channel', label: `sqs/${name}`, repo, meta: { channelKind: 'queue', adapters: ['aws-sqs'] } });

const QUEUE = 'export:orders-placed-arn';
const STAND_IN = importedName(QUEUE);

/** `orders` publishes its queue under an export name, and a producer of its own sends to it. */
const orders = (exported: Record<string, unknown> = { kind: 'queue', value: 'orders-placed' }, repo = 'orders'): RepoGraph =>
  graph(
    repo,
    [
      repoNode(repo, { exports: [{ keys: [QUEUE, 'stack:shop-orders#PlacedArn'], address: 'shop-orders/PlacedArn', file: 'lib/stack.ts', line: 9, ...exported }] }),
      channel(repo, 'orders-placed'),
      { id: `producer:${repo}#src/place.ts:4:1`, type: 'producer', label: 'send', repo },
    ],
    [{ from: `producer:${repo}#src/place.ts:4:1`, to: 'channel:sqs/orders-placed', type: 'emits', confidence: 'static' }],
  );

/** `catalog` reads that queue by its export name, and so does a value of its environment. */
const catalog = (kinds: string[] = ['queue']): RepoGraph =>
  graph(
    'catalog',
    [
      repoNode('catalog', {
        imports: [
          { key: QUEUE, file: 'template.yaml', line: 20, what: 'the queue Resources.Reorder.Events.Placed reads', kinds },
          { key: 'export:shop-api-url', file: 'template.yaml', line: 14, what: 'the value of SHOP_API_URL Resources.Reorder is deployed with' },
        ],
      }),
      channel('catalog', STAND_IN),
      { id: 'consumer:catalog#template.yaml:Placed', type: 'consumer', label: 'mapping', repo: 'catalog' },
      {
        id: 'entry:catalog:invoke:catalog-reorder',
        type: 'entry',
        kind: 'invoke',
        label: 'catalog-reorder',
        repo: 'catalog',
        meta: { environment: { SHOP_API_URL: { written: '!ImportValue shop-api-url', imported: 'export:shop-api-url', unread: 'imported' } } },
      },
    ],
    [{ from: `channel:sqs/${STAND_IN}`, to: 'consumer:catalog#template.yaml:Placed', type: 'consumes', confidence: 'static' }],
  );

const gateway = (): RepoGraph =>
  graph('gateway', [
    repoNode('gateway', {
      exports: [{ keys: ['export:shop-api-url'], address: 'resources.Outputs.ApiUrl', file: 'serverless.yml', line: 40, kind: 'api', value: 'shop' }],
      apiRoots: [{ key: 'export:shop-api-root', path: '/', api: 'shop', file: 'serverless.yml', line: 36 }],
    }),
  ]);

describe('a value one repository publishes and another reads (P249)', () => {
  it('renames what is imported to what the publisher names, so the two are one channel', () => {
    const { project } = linkGraphs([orders(), catalog(), gateway()], config(), { builtAt: FIXED });
    const channels = project.nodes.filter((node) => node.type === 'channel').map((node) => node.id);
    expect(channels).toEqual(['channel:sqs/orders-placed']);
    expect(project.edges.filter((edge) => edge.to === 'consumer:catalog#template.yaml:Placed').map((edge) => edge.from)).toEqual(['channel:sqs/orders-placed']);
    expect(project.unresolved.filter((row) => row.reason.startsWith('export-'))).toEqual([]);
    const imports = project.nodes.find((node) => node.id === 'repo:catalog')?.meta?.['imports'] as Array<Record<string, unknown>>;
    expect(imports.map((site) => site['from'])).toEqual(['orders', 'gateway']);
  });

  it('gives a value of the environment what it imports: an API another service publishes is that service', () => {
    const { project } = linkGraphs([orders(), catalog(), gateway()], config(), { builtAt: FIXED });
    const environment = project.nodes.find((node) => node.id === 'entry:catalog:invoke:catalog-reorder')?.meta?.['environment'] as Record<string, unknown>;
    expect(environment['SHOP_API_URL']).toEqual({ written: '!ImportValue shop-api-url', imported: 'export:shop-api-url', value: 'shop', kind: 'api', service: 'gateway' });
  });

  it('leaves an import nobody publishes as it was, and says so at the import', () => {
    const { project } = linkGraphs([catalog()], config(), { builtAt: FIXED });
    expect(project.nodes.some((node) => node.id === `channel:sqs/${STAND_IN}`)).toBe(true);
    expect(project.unresolved.filter((row) => row.reason === 'export-not-found').map((row) => [row.service, row.file, row.line, row.message])).toEqual([
      ['catalog', 'template.yaml', 14, 'the value of SHOP_API_URL Resources.Reorder is deployed with is the export shop-api-url, which no configured service publishes, so what it names is not joined'],
      ['catalog', 'template.yaml', 20, 'the queue Resources.Reorder.Events.Placed reads is the export orders-placed-arn, which no configured service publishes, so what it names is not joined'],
    ]);
  });

  it('joins to neither of two services publishing one name', () => {
    const { project } = linkGraphs([orders(), orders({ kind: 'queue', value: 'other-placed' }, 'web'), catalog()], config(), { builtAt: FIXED });
    expect(project.nodes.some((node) => node.id === `channel:sqs/${STAND_IN}`)).toBe(true);
    expect(project.unresolved.find((row) => row.reason === 'export-ambiguous')?.message).toContain('orders publishes as the queue orders-placed and web publishes as the queue other-placed');
  });

  it('joins nothing to a value that is not the kind the import reads, or that is not read', () => {
    const topic = linkGraphs([orders({ kind: 'topic', value: 'orders-placed' }), catalog()], config(), { builtAt: FIXED }).project;
    expect(topic.unresolved.find((row) => row.reason === 'export-mismatched')?.message).toContain('a queue where it is read, which orders publishes as the topic orders-placed');
    const unread = linkGraphs([orders({ unread: 'it is a value known only once deployed' }), catalog()], config(), { builtAt: FIXED }).project;
    expect(unread.unresolved.find((row) => row.reason === 'export-mismatched')?.message).toContain('a value that is not read: it is a value known only once deployed');
  });
});

describe('a route hanging from another service API (P249)', () => {
  const rooted: GraphNode = {
    id: `entry:orders:http:POST:/${UNREAD_SPAN}/orders`,
    type: 'entry',
    kind: 'http',
    label: `POST /${UNREAD_SPAN}/orders`,
    repo: 'orders',
    file: 'lib/stack.ts',
    line: 30,
    meta: { method: 'POST', path: `/${UNREAD_SPAN}/orders`, root: 'export:shop-api-root', below: '/orders' },
  };
  const client = (): RepoGraph =>
    graph(
      'web',
      [
        { id: 'web#api.ts:place', type: 'function', label: 'place', repo: 'web' },
        { id: 'http_out:web#api.ts:3:1', type: 'http_out', label: 'POST /orders', repo: 'web', file: 'api.ts', line: 3, meta: { method: 'POST', path: '/orders', baseUrlEnv: 'SHOP_API' } },
      ],
      [{ from: 'web#api.ts:place', to: 'http_out:web#api.ts:3:1', type: 'calls', confidence: 'static' }],
    );

  it('is reached by a client of the service that publishes the API, though another repository holds it', () => {
    const { project } = linkGraphs([gateway(), graph('orders', [rooted]), client()], config(['SHOP_API']), { builtAt: FIXED });
    expect(project.edges.find((edge) => edge.from === 'http_out:web#api.ts:3:1')?.to).toBe('entry:orders:http:POST:/orders');
  });

  it('is named by the export it hangs from when nothing publishes that export', () => {
    const { project } = linkGraphs([graph('orders', [rooted])], config(), { builtAt: FIXED });
    expect(project.unresolved.find((row) => row.reason === 'route-root-not-found')?.message).toBe(
      'POST /orders hangs from the export shop-api-root, which no configured service publishes, so its full path is not known',
    );
  });
});
