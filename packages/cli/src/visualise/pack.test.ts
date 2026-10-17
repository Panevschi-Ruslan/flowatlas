import type { GraphEdge, GraphNode } from '@flowatlas/core';
import type { AnchoredUnresolvedRow, LinkReport } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { stableKeys } from './keys.js';
import { wordsOf } from './dictionary.js';
import { createModel, serviceOfRow, type GraphModel } from './graph.js';
import { packObserved } from './observed.js';
import { packGraph, type PackedGraph } from './pack.js';
import { ambiguousOf, logsOf, unmatchedOf } from './steps.js';

const report = {
  httpOut: {},
  channels: {},
  routes: { total: 0, called: 0, duplicated: 0 },
  types: {},
  totals: {},
  services: [],
} as unknown as LinkReport;

const nodes: GraphNode[] = [
  {
    id: 'entry:api:http:GET:/orders',
    type: 'entry',
    kind: 'http',
    label: 'GET /orders',
    repo: 'api',
    file: 'src/orders.controller.ts',
    line: 10,
    meta: { method: 'GET', path: '/orders', adapter: 'nestjs-http', controller: 'OrdersController' },
  },
  {
    id: 'db:api#src/orders.repo.ts:7',
    type: 'db_query',
    label: 'read orders',
    repo: 'api',
    file: 'src/orders.repo.ts',
    line: 7,
    meta: { table: 'orders', op: 'read', source: 'string-arg', tables: ['orders'], receiver: 'this.orders' },
  },
  {
    id: 'invoke:lending-create-loan',
    type: 'entry',
    kind: 'invoke',
    label: 'invoke lending-create-loan',
    repo: 'lambda',
    file: 'infra/main.tf',
    line: 3,
    meta: { handler: 'loans/create.handler', deployedBy: 'terraform', bodyKeys: ['name'], unreferenced: true },
  },
  {
    id: 'shop#src/app/total.pipe.ts:TotalPipe',
    type: 'provider',
    kind: 'pipe',
    label: 'TotalPipe',
    repo: 'shop',
    file: 'src/app/total.pipe.ts',
    line: 4,
    meta: { name: 'total', pure: false, hostBindings: [], exportAs: 'total' },
  },
  {
    id: 'shop#src/app/glow.directive.ts:GlowDirective',
    type: 'ui_component',
    kind: 'directive',
    label: 'GlowDirective',
    repo: 'shop',
    file: 'src/app/glow.directive.ts',
    line: 5,
    meta: {
      hostBindings: ['(focus)=onFocus()'],
      hostMembers: ['shop#src/app/glow.directive.ts:GlowDirective.onFocus', 'shop#src/app/gone.ts:Gone.away'],
    },
  },
  {
    id: 'shop#src/app/glow.directive.ts:GlowDirective.onFocus',
    type: 'method',
    label: 'GlowDirective.onFocus',
    repo: 'shop',
    file: 'src/app/glow.directive.ts',
    line: 9,
  },
];

const row = (over: Partial<AnchoredUnresolvedRow>): AnchoredUnresolvedRow => ({
  service: 'api',
  file: 'src/orders.repo.ts',
  line: 9,
  reason: 'db-receiver-name-only',
  level: 'action',
  sites: 1,
  message: 'a receiver read by its name only',
  hint: 'name the class',
  node: null,
  ...over,
});

const packed = packGraph({
  builtAt: '2026-10-07T00:00:00.000Z',
  nodes,
  edges: [{ from: nodes[0]!.id, to: nodes[1]!.id, type: 'calls', confidence: 'static' }],
  unresolved: [
    row({ node: 'db:api#src/orders.repo.ts:7' }),
    row({ node: 'this.orders.find', line: 12 }),
    row({ service: 'web', file: 'src/new.ts', reason: 'dynamic-table-name', level: 'info', sites: 4, hint: null }),
  ],
  report,
});

const metaOf = (index: number): Record<string, unknown> => {
  const meta = packed.nodes[index]![6];
  if (meta === 0) return {};
  const { meta: names, enumerated, values } = packed.dicts;
  return Object.fromEntries(
    Object.entries(meta as Record<string, unknown>).map(([key, value]) => [
      names[key],
      enumerated.includes(key) ? values[value as number] : value,
    ]),
  );
};

describe('packing what the details panel shows', () => {
  it('ships the metadata the panel reads under short keys, with the name the graph gives each', () => {
    expect(metaOf(0)).toEqual({ method: 'GET', path: '/orders', adapter: 'nestjs-http' });
    expect(metaOf(2)).toEqual({
      handler: 'loans/create.handler',
      deployedBy: 'terraform',
      bodyKeys: ['name'],
      unreferenced: true,
    });
  });

  it('ships a pipe that says it is impure, and leaves an empty list out (P45)', () => {
    expect(metaOf(3)).toEqual({ name: 'total', pure: false, exportAs: 'total' });
  });

  it('ships the methods a host binding calls as node positions the panel jumps to, dropping ids with no node (P50)', () => {
    expect(metaOf(4)).toEqual({ hostBindings: ['(focus)=onFocus()'], hostMembers: [5] });
    expect(packed.dicts.nodeRefs).toEqual(['hm']);
  });

  it('ships a word that takes few values once, as an index into one list', () => {
    expect(packed.dicts.enumerated).toContain('ad');
    expect(packed.dicts.values).toEqual(['nestjs-http', 'read', 'string-arg', 'terraform']);
    expect((packed.nodes[0]![6] as Record<string, unknown>)['ad']).toBe(0);
  });

  it('does not say twice what the label already says, past the fields the lists read', () => {
    // `read orders` carries its table and its operation; how the name was read
    // is not in the label and is kept.
    expect(metaOf(1)).toEqual({ source: 'string-arg' });
  });

  it('ships every row, anchored when its symbol is a node and only then', () => {
    expect(packed.rows).toHaveLength(3);
    const [onNode, onText, elsewhere] = packed.rows as unknown[][];
    expect(onNode![0]).toBe(1);
    expect(onText![0]).toBe(-1);
    expect(elsewhere![0]).toBe(-1);
  });

  it('keeps each row’s place, reason, level and hint as indices, and its message as text', () => {
    const [onNode, , elsewhere] = packed.rows as unknown[][];
    const { repos, files, reasons, levels, hints } = packed.dicts;
    expect(files[onNode![2] as number]).toBe('src/orders.repo.ts');
    expect(repos[onNode![1] as number]).toBe('api');
    expect(reasons[onNode![4] as number]).toBe('db-receiver-name-only');
    expect(levels[onNode![5] as number]).toBe('action');
    expect(hints[onNode![8] as number]).toBe('name the class');
    expect(onNode![7]).toBe('a receiver read by its name only');
    // A service with no node of its own is not in the list of services, so its row names it (P97, P133).
    expect(elsewhere![1]).toBe('web');
    expect(serviceOfRow(repos, elsewhere!)).toBe('web');
    expect(serviceOfRow(repos, onNode!)).toBe('api');
    expect(serviceOfRow(repos, [-1, -1])).toBe('');
    expect(files[elsewhere![2] as number]).toBe('src/new.ts');
    expect(elsewhere![6]).toBe(4);
    expect(elsewhere![8]).toBe(-1);
  });

  it('still groups the rows by reason for the not-joined table', () => {
    expect(packed.unresolved.map((group) => [group.reason, group.count])).toEqual([
      ['db-receiver-name-only', 2],
      ['dynamic-table-name', 1],
    ]);
  });
});

describe('the stat row and the Not joined tab, by kind (P81)', () => {
  // A report as 0.5.x stored it: `unresolved` alone, counting every row not
  // at `nothing`, and `query-in-loop` written at `nothing`.
  const old = {
    ...report,
    totals: { nodes: 2, edges: 1, types: 0, unresolved: 5 },
  } as unknown as LinkReport;
  const rows = [
    row({}),
    row({ reason: 'call-dynamic-receiver', level: 'info', sites: 12, line: 20 }),
    row({ reason: 'base-url-from-files', level: 'info', sites: 3, line: 30 }),
    row({ reason: 'query-in-loop', level: 'nothing', line: 40 }),
    row({ reason: 'route-unguarded', line: 50 }),
  ];
  const kinded = packGraph({ builtAt: '2026-10-07T00:00:00.000Z', nodes, edges: [], unresolved: rows, report: old });

  it('counts missed, notes and findings from the rows, whatever the stored report says', () => {
    expect(kinded.report).toMatchObject({
      totals: { nodes: 2, edges: 1, types: 0, missed: 2, sites: 13, notes: 1, findings: 2, unresolved: 2 },
    });
  });

  it('lists each reason under its kind', () => {
    expect(kinded.unresolved.map((group) => [group.reason, group.kind])).toEqual(
      expect.arrayContaining([
        ['db-receiver-name-only', 'gap'],
        ['call-dynamic-receiver', 'gap'],
        ['base-url-from-files', 'note'],
        ['query-in-loop', 'finding'],
        ['route-unguarded', 'finding'],
      ]),
    );
  });
});

describe('naming nodes in a link', () => {
  const keyAt = (keys: typeof packed.keys, i: number): string =>
    keys.longer[String(i)] ?? keys.all.slice(i * keys.width, (i + 1) * keys.width);

  it('ships a stable key for every node, spelled from its id', () => {
    expect(packed.keys).toEqual(stableKeys(nodes.map((node) => node.id)));
    expect(packed.keys.all).toHaveLength(nodes.length * packed.keys.width);
  });

  it('gives a node the same key when nodes before it come and go', () => {
    const moved = packGraph({
      builtAt: '2026-10-08T00:00:00.000Z',
      nodes: [{ ...nodes[0]!, id: 'aaa:first' }, nodes[2]!, nodes[1]!],
      edges: [],
      unresolved: [],
      report,
    });
    expect(keyAt(moved.keys, 1)).toBe(keyAt(packed.keys, 2));
    expect(keyAt(moved.keys, 2)).toBe(keyAt(packed.keys, 1));
  });
});

describe('edges a stand-in typed (P78)', () => {
  it('ships how and whose types, by edge position, and nothing when none was', () => {
    expect(packed.standIns).toBeUndefined();
    const marked = packGraph({
      builtAt: '2026-10-07T00:00:00.000Z',
      nodes,
      edges: [
        { from: nodes[0]!.id, to: nodes[1]!.id, type: 'calls', confidence: 'static' },
        {
          from: nodes[1]!.id,
          to: nodes[0]!.id,
          type: 'calls',
          confidence: 'heuristic',
          meta: { because: ['shape-file'], typedBy: '@acme/queue-client' },
        },
      ],
      unresolved: [],
      report,
    });
    expect(marked.standIns).toEqual({
      via: ['package-from-repo', 'shape-file'],
      packages: ['@acme/queue-client'],
      edges: { '1': [1, 0] },
    });
  });
});

describe('logs and unmatched spans through dictionaries (P84)', () => {
  const levels = ['log', 'warn', 'error'];
  const logging: GraphNode[] = Array.from({ length: 12 }, (_, i) => ({
    id: `api#src/jobs.ts:Jobs.run${i}`,
    type: 'method',
    label: `Jobs.run${i}`,
    repo: 'api',
    file: 'src/jobs.ts',
    line: 10 * i,
    meta: {
      logs: [
        { level: levels[i % 3], text: 'job started', at: 10 * i + 1 },
        { level: 'log', text: `job ${i} wrote {count} rows`, at: 10 * i + 2 },
        { level: 'error', at: 10 * i + 3 },
      ],
    },
  }));
  const packLogs = (list: GraphNode[]) => packGraph({ builtAt: '2026-10-07T00:00:00.000Z', nodes: list, edges: [], unresolved: [], report });

  it('lists the repeated levels and templates once, ships a one-off template as it is, and reads back the same lines', () => {
    const data = packLogs(logging);
    expect(data.dicts.logLevels).toEqual(['error', 'log', 'warn']);
    expect(data.dicts.logTexts).toEqual(['job started']);
    expect(data.logs?.[0]).toEqual([[1, 1, 0], [1, 2, 'job 0 wrote {count} rows'], [0, 3]]);
    const model = createModel(data) as GraphModel;
    logging.forEach((node, i) => {
      const lines = (node.meta!['logs'] as Array<{ level: string; text?: string; at: number }>).map(({ level, text, at }) => ({
        level,
        line: at,
        text: text ?? '',
      }));
      expect(logsOf(model, i)).toEqual(lines);
    });
  });

  it('ships a block with nothing worth listing exactly as its words, with no list at all', () => {
    const data = packLogs(logging.slice(0, 1));
    expect(data.dicts.logLevels).toBeUndefined();
    expect(data.dicts.logTexts).toBeUndefined();
    expect(data.logs?.[0]).toEqual([['log', 1, 'job started'], ['log', 2, 'job 0 wrote {count} rows'], ['error', 3]]);
    expect(logsOf(createModel(data) as GraphModel, 0)[2]).toEqual({ level: 'error', line: 3, text: '' });
  });

  it('reads back every unmatched span, with and without a service', () => {
    const unmatched = [
      ...Array.from({ length: 6 }, (_, i) => ({ service: 'billing', kind: 'code', name: `LedgerClient.post${i}`, count: 1 })),
      { kind: 'http', name: 'GET /metrics', count: 2 },
      { service: 'gateway', kind: 'http', name: 'GET /health', count: 1 },
    ];
    const packed = packObserved({ joins: {}, entries: {}, symbols: {}, channels: {}, unmatched } as never, [], {}, new Map());
    expect(packed.services).toEqual(['billing']);
    expect(packed.kinds).toEqual(['code', 'http']);
    expect(packed.unmatched[6]).toEqual([-1, 1, 'GET /metrics']);
    expect(packed.unmatched[7]).toEqual(['gateway', 1, 'GET /health']);
    expect(unmatchedOf(packed)).toEqual(unmatched.map(({ count: _, ...span }) => span));
  });

  it('reads back what fit several places: edges for a join, nodes otherwise, and how many it does not name', () => {
    const edges = [{ from: 'a', to: 'b', type: 'calls', confidence: 'static' }] as GraphEdge[];
    const ambiguous = [
      { service: 'billing', kind: 'symbol', name: 'LedgerClient.post', candidates: ['a', 'gone'], more: 2, count: 3 },
      { kind: 'join', name: 'GET /x', candidates: ['a -calls-> b'], count: 1 },
    ];
    const packed = packObserved(
      { joins: {}, entries: {}, symbols: {}, channels: {}, unmatched: [], ambiguous } as never,
      edges,
      {},
      new Map([['a', 4]]),
    );
    expect(packed.ambiguous).toEqual([
      ['billing', 'symbol', 'LedgerClient.post', 3, [4], 3],
      [-1, 'join', 'GET /x', 1, [0]],
    ]);
    expect(ambiguousOf(packed)).toEqual([
      { service: 'billing', kind: 'symbol', name: 'LedgerClient.post', count: 3, places: [4], unnamed: 3 },
      { kind: 'join', name: 'GET /x', count: 1, places: [0], unnamed: 0 },
    ]);
    expect(packObserved({ joins: {}, entries: {}, symbols: {}, channels: {}, unmatched: [] } as never, [], {}, new Map())).not.toHaveProperty('ambiguous');
  });

  it('packs one build to the same bytes twice, with every dictionary sorted', () => {
    const one = JSON.stringify(packLogs(logging));
    expect(JSON.stringify(packLogs(logging))).toBe(one);
    const data = JSON.parse(one) as PackedGraph;
    const { types, repos, kinds, files, edgeTypes, confidences, values, logLevels, logTexts } = data.dicts;
    for (const list of [types, repos, kinds, files, edgeTypes, confidences, values, logLevels!, logTexts!]) {
      expect(list).toEqual([...list].sort());
    }
  });
});

describe('wordsOf (P84)', () => {
  it('lists only what pays for its place, and nothing unless the list pays for its name', () => {
    expect(wordsOf(['a', 'b', 'a'], 'k').list).toEqual([]);
    const many = wordsOf([...Array(10).fill('NotFoundException'), 'Once'], 'exceptions');
    expect(many.list).toEqual(['NotFoundException']);
    expect(many.word('NotFoundException')).toBe(0);
    expect(many.word('Once')).toBe('Once');
  });
});
