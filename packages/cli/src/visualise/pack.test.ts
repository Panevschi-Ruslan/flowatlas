import type { GraphNode } from '@flowatlas/core';
import type { AnchoredUnresolvedRow, LinkReport } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { stableKeys } from './keys.js';
import { packGraph } from './pack.js';

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
    // A service with no node of its own has no index; the row says -1 rather than a wrong one.
    expect(elsewhere![1]).toBe(-1);
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
