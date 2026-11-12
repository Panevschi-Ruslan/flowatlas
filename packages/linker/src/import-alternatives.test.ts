import { alternativeAddress, generatedName, importedName, parseConfig, SCHEMA_VERSION, type GraphEdge, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { joinImports } from './import-link.js';
import { linkGraphs } from './link.js';

const FIXED = '2026-01-01T00:00:00.000Z';

const config = parseConfig({
  services: [
    { name: 'orders', repo: './orders', type: 'functions' },
    { name: 'catalog', repo: './catalog', type: 'functions' },
    { name: 'reports', repo: './reports', type: 'functions' },
  ],
});

const graph = (repo: string, nodes: GraphNode[], edges: GraphEdge[] = []): RepoGraph => ({ schemaVersion: SCHEMA_VERSION, repo, generatedAt: FIXED, nodes, edges, types: {}, unresolved: [] });
const repoNode = (repo: string, meta: Record<string, unknown>): GraphNode => ({ id: `repo:${repo}`, type: 'repo', label: repo, repo, meta });
const channel = (repo: string, name: string): GraphNode => ({ id: `channel:${name}`, type: 'channel', label: name, repo });

const STREAM = 'parameter:/shop/orders/stream';
const STAND_IN = importedName(STREAM);
const MAPPING = 'Resources.IndexMapping';

/** `orders` writes its table's stream to a parameter. */
const orders = (exported: Record<string, unknown> = { kind: 'table', value: 'shop-orders' }): RepoGraph =>
  graph('orders', [repoNode('orders', { exports: [{ keys: [STREAM], address: 'Resources.StreamParameter', file: 'serverless.yml', line: 4, ...exported }] }), channel('orders', 'dynamodb/shop-orders')]);

/** `catalog` maps a function to that parameter, read as a stream and as a table's changes. */
const catalog = (): RepoGraph => {
  const consumer = (kind: string): GraphNode => ({ id: `consumer:catalog#stack.yaml:${alternativeAddress(MAPPING, kind)}`, type: 'consumer', label: 'mapping', repo: 'catalog', meta: { declaredAs: alternativeAddress(MAPPING, kind) } });
  const entry = (prefix: string, kind: string): GraphNode => ({ id: `entry:catalog:event:${prefix}/${STAND_IN}`, type: 'entry', kind: 'event', label: 'event', repo: 'catalog', meta: { declaredAs: alternativeAddress(MAPPING, kind) } });
  return {
    ...graph(
      'catalog',
      [
        repoNode('catalog', {
          imports: [{ key: STREAM, file: 'stack.yaml', line: 9, what: 'what the mapping reads', kinds: ['stream', 'table'], alternatives: ['stream', 'table'].map((kind) => ({ kind, address: alternativeAddress(MAPPING, kind) })) }],
        }),
        channel('catalog', `kinesis/${STAND_IN}`),
        channel('catalog', `dynamodb/${STAND_IN}`),
        consumer('stream'),
        consumer('table'),
        entry('kinesis', 'stream'),
        entry('dynamodb', 'table'),
      ],
      ['stream', 'table'].flatMap((kind): GraphEdge[] => {
        const prefix = kind === 'stream' ? 'kinesis' : 'dynamodb';
        const consumer = `consumer:catalog#stack.yaml:${alternativeAddress(MAPPING, kind)}`;
        return [
          { from: `channel:${prefix}/${STAND_IN}`, to: consumer, type: 'consumes', confidence: 'static' },
          { from: consumer, to: `entry:catalog:event:${prefix}/${STAND_IN}`, type: 'triggers', confidence: 'static' },
        ];
      }),
    ),
    unresolved: [{ file: 'stack.yaml', line: 9, reason: 'stream-filter-not-matched', message: 'filtered', hint: '-', symbol: alternativeAddress(MAPPING, 'stream') }],
  };
};

describe('a declaration read once per kind an import may be (P253)', () => {
  it('keeps the reading the publisher says it is, under the address it was written at, and drops the others with what only they drew', () => {
    const { graphs, rows } = joinImports([orders(), catalog()]);
    expect(rows).toEqual([]);
    const joined = graphs[1] as RepoGraph;
    expect(joined.nodes.map((node) => node.id).filter((id) => !id.startsWith('repo:'))).toEqual([
      'channel:dynamodb/shop-orders',
      `consumer:catalog#stack.yaml:${MAPPING}`,
      'entry:catalog:event:dynamodb/shop-orders',
    ]);
    expect(joined.edges.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual([
      `channel:dynamodb/shop-orders -> consumer:catalog#stack.yaml:${MAPPING}`,
      `consumer:catalog#stack.yaml:${MAPPING} -> entry:catalog:event:dynamodb/shop-orders`,
    ]);
    expect(joined.unresolved).toEqual([]);
  });

  it('drops every reading of an import nothing publishes, and says so once', () => {
    const { graphs, rows } = joinImports([catalog()]);
    expect(rows.map((row) => [row.reason, row.message])).toEqual([['export-not-found', 'what the mapping reads is the parameter /shop/orders/stream, which no configured service publishes, so what it names is not joined']]);
    expect((graphs[0] as RepoGraph).nodes.map((node) => node.id)).toEqual(['repo:catalog']);
  });

  it('drops every reading where the publisher says it is something else', () => {
    const { graphs, rows } = joinImports([orders({ kind: 'queue', value: 'shop-orders' }), catalog()]);
    expect(rows.map((row) => row.reason)).toEqual(['export-mismatched']);
    expect((graphs[1] as RepoGraph).edges).toEqual([]);
  });

  it('drops the reference only a function reading made', () => {
    const KEY = 'parameter:/shop/failures';
    const address = 'Resources.Failures';
    const reports = graph('reports', [
      repoNode('reports', { imports: [{ key: KEY, file: 'stack.yaml', line: 3, what: 'the destination', kinds: ['queue', 'function'], alternatives: ['queue', 'function'].map((kind) => ({ kind, address: alternativeAddress(address, kind) })) }] }),
      { id: 'entry:reports:invoke:tally', type: 'entry', kind: 'invoke', label: 'tally', repo: 'reports', meta: { reaches: [`invoke:${importedName(KEY)}`], reachedAs: { [`invoke:${importedName(KEY)}`]: { type: 'triggers', when: 'failure' } } } },
      { id: `producer:reports#stack.yaml:${alternativeAddress(address, 'queue')}`, type: 'producer', label: 'send', repo: 'reports', meta: { declaredAs: alternativeAddress(address, 'queue') } },
      channel('reports', `sqs/${importedName(KEY)}`),
    ], [
      { from: 'entry:reports:invoke:tally', to: `producer:reports#stack.yaml:${alternativeAddress(address, 'queue')}`, type: 'triggers', confidence: 'static' },
      { from: `producer:reports#stack.yaml:${alternativeAddress(address, 'queue')}`, to: `channel:sqs/${importedName(KEY)}`, type: 'emits', confidence: 'static' },
    ]);
    const platform = graph('orders', [repoNode('orders', { exports: [{ keys: [KEY], address: 'aws_ssm_parameter.failures', file: 'main.tf', line: 1, kind: 'queue', value: 'shop-failures' }] })]);
    const joined = joinImports([platform, reports]).graphs[1] as RepoGraph;
    expect(joined.nodes.find((node) => node.id === 'entry:reports:invoke:tally')?.meta).toEqual({});
    expect(joined.edges.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual([
      `entry:reports:invoke:tally -> producer:reports#stack.yaml:${address}`,
      `producer:reports#stack.yaml:${address} -> channel:sqs/shop-failures`,
    ]);
  });
});

describe('a value published under a name the platform generates (P253)', () => {
  const TOPIC = 'parameter:/shop/catalog/topic';
  const generated = generatedName('stacks.catalog.Resources.Topic');
  const publisher = (repo: string): RepoGraph =>
    graph(repo, [
      repoNode(repo, { exports: [{ keys: [`parameter:/${repo}/topic`], address: 'Resources.TopicParameter', file: 'stack.yaml', line: 3, kind: 'topic', value: generated }] }),
      channel(repo, `sns/${generated}`),
    ]);

  it('joins the importer to the producer\'s own channel, and leaves another repository\'s of the same declaration apart', () => {
    const catalog = { ...publisher('catalog'), nodes: [repoNode('catalog', { exports: [{ keys: [TOPIC], address: 'Resources.TopicParameter', file: 'stack.yaml', line: 3, kind: 'topic', value: generated }] }), channel('catalog', `sns/${generated}`)] };
    const reports = graph('reports', [repoNode('reports', { imports: [{ key: TOPIC, file: 'main.tf', line: 5, what: 'the topic it subscribes to', kinds: ['topic'] }] }), channel('reports', `sns/${importedName(TOPIC)}`)]);
    const { project } = linkGraphs([catalog, reports, publisher('orders')], config, { builtAt: FIXED });
    expect(project.nodes.filter((node) => node.type === 'channel').map((node) => node.id).sort()).toEqual([`channel:sns/\${…}@catalog@stacks.catalog.Resources.Topic`, `channel:sns/${generated}`]);
  });
});

describe('a value read as the name of what it names (P253)', () => {
  it('takes a name published as text as what the import says it is', () => {
    const KEY = 'parameter:/shop/audit/name';
    const orders = graph('orders', [repoNode('orders', { exports: [{ keys: [KEY], address: 'aws_ssm_parameter.audit', file: 'main.tf', line: 1, text: 'shop-audit' }] })]);
    const catalog = graph('catalog', [
      repoNode('catalog', { imports: [{ key: KEY, file: 'stack.yaml', line: 3, what: 'the value of AUDIT', kinds: ['queue'], as: 'name' }] }),
      { id: 'entry:catalog:invoke:restock', type: 'entry', kind: 'invoke', label: 'restock', repo: 'catalog', meta: { environment: { AUDIT: { written: '!Sub ...', value: importedName(KEY), kind: 'queue' } } } },
    ]);
    const { graphs, rows } = joinImports([orders, catalog]);
    expect(rows).toEqual([]);
    expect((graphs[1] as RepoGraph).nodes[1]?.meta?.['environment']).toEqual({ AUDIT: { written: '!Sub ...', value: 'shop-audit', kind: 'queue' } });
  });
});

describe('a choice inside each reading of a choice (P261)', () => {
  const CLICKS = 'parameter:shop/clicks';
  const FAILURES = 'parameter:shop/failures';
  const MAPPING_AT = 'aws_lambda_event_source_mapping.clicks';
  const failure = (kind: string): string => alternativeAddress(`${MAPPING_AT}.on_failure`, kind);
  const destination = (mapped: string, kind: string): GraphNode => ({
    id: `delivery:ledger#main.tf:${alternativeAddress(failure(mapped), kind)}`,
    type: 'consumer',
    label: 'destination',
    repo: 'ledger',
    meta: { declaredAs: alternativeAddress(failure(mapped), kind) },
  });
  const ledger = (): RepoGraph =>
    graph('ledger', [
      repoNode('ledger', {
        imports: [
          {
            key: CLICKS,
            file: 'main.tf',
            line: 9,
            what: 'what the mapping reads',
            kinds: ['stream', 'table'],
            alternatives: ['stream', 'table'].flatMap((kind) => [
              { kind, address: alternativeAddress(MAPPING_AT, kind) },
              { kind, address: failure(kind) },
            ]),
          },
          {
            key: FAILURES,
            file: 'main.tf',
            line: 9,
            what: 'the failure destination of the mapping',
            kinds: ['queue', 'topic'],
            alternatives: ['stream', 'table'].flatMap((mapped) => ['queue', 'topic'].map((kind) => ({ kind, address: alternativeAddress(failure(mapped), kind) }))),
          },
        ],
      }),
      ...['stream', 'table'].flatMap((mapped) => ['queue', 'topic'].map((kind) => destination(mapped, kind))),
    ]);
  const platform = graph('platform', [
    repoNode('platform', {
      exports: [
        { keys: [CLICKS], address: 'aws_ssm_parameter.clicks', file: 'main.tf', line: 1, kind: 'stream', value: 'shop-clicks' },
        { keys: [FAILURES], address: 'aws_ssm_parameter.failures', file: 'main.tf', line: 5, kind: 'queue', value: 'shop-failures' },
      ],
    }),
  ]);

  it("keeps the destination of the kind its publisher says, of the reading the mapping's publisher says, under the address it was written at", () => {
    const { graphs, rows } = joinImports([platform, ledger()]);
    expect(rows).toEqual([]);
    expect((graphs[1] as RepoGraph).nodes.filter((node) => node.type !== 'repo').map((node) => [node.id, node.meta?.['declaredAs']])).toEqual([
      [`delivery:ledger#main.tf:${MAPPING_AT}.on_failure`, `${MAPPING_AT}.on_failure`],
    ]);
  });

  it('drops every destination where the destination is not published', () => {
    const only = graph('platform', [repoNode('platform', { exports: [{ keys: [CLICKS], address: 'aws_ssm_parameter.clicks', file: 'main.tf', line: 1, kind: 'stream', value: 'shop-clicks' }] })]);
    const { graphs, rows } = joinImports([only, ledger()]);
    expect(rows.map((row) => [row.reason, row.meta?.['key']])).toEqual([['export-not-found', FAILURES]]);
    expect((graphs[1] as RepoGraph).nodes.filter((node) => node.type !== 'repo')).toEqual([]);
  });
});
