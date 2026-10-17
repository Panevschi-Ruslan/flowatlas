import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveAccepted, SCHEMA_VERSION, type ProjectGraph } from '@flowatlas/core';
import { DIFF_FORMAT_VERSION, writeGraphDb, type DiffReport, type LinkReport } from '@flowatlas/linker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import { edge, entry, node } from '../test-graph.js';

const FIXED = '2026-01-01T00:00:00.000Z';

const report = (): LinkReport => ({
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  configHash: 'test',
  services: [],
  httpOut: { total: 0, linked: 0, byMarker: 0, unknownEnv: 0, noRoute: 0, ambiguous: 0, external: 0, dynamic: 0 },
  ui: { total: 0, resolved: 0, unresolved: 0, byReason: {} },
  channels: { total: 0, linked: 0, noConsumers: [], noProducers: [] },
  routes: { total: 0, called: 0, uncalled: [], duplicated: [] },
  types: { total: 0, sharedPackage: 0 },
  unresolved: [],
  totals: { nodes: 0, edges: 0, types: 0, missed: 0, sites: 0, notes: 0, findings: 0, unresolved: 0 },
});

const ROUTE = 'orders:entry:POST /orders';
const HANDLER = 'orders:OrdersController.create';
const SERVICE = 'orders:OrdersService.place';
const CHANNEL = 'channel:order.placed';
const TABLE = 'table:orders';

const graph: ProjectGraph = {
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  services: [{ name: 'orders', repo: './orders', type: 'nestjs', extractor: null }],
  nodes: [
    entry(ROUTE, {
      label: 'POST /orders',
      meta: { fails: [{ status: 422, exception: 'CouponRejectedError', at: SERVICE, source: 'throw' }] },
    }),
    node(HANDLER, { label: 'OrdersController.create' }),
    node(SERVICE, { label: 'OrdersService.place' }),
    node('orders:OrdersService', { type: 'provider', label: 'OrdersService' }),
    node(CHANNEL, { type: 'channel', label: 'order.placed' }),
    node(TABLE, { type: 'table', label: 'orders' }),
  ],
  edges: [edge(ROUTE, HANDLER, { type: 'handles' }), edge(HANDLER, SERVICE), edge(SERVICE, CHANNEL, { type: 'emits' })],
  types: {
    'type:orders#PlaceOrderDto': {
      name: 'PlaceOrderDto',
      kind: 'object',
      declaredIn: 'orders#src/orders.dto.ts',
      structuralHash: 'h',
      fields: [],
    } as never,
  },
  unresolved: [
    { service: 'orders', file: 'src/orders.service.ts', line: 12, reason: 'channel-dynamic', message: 'order channel built at run time' },
    { service: 'orders', file: 'src/orders.repo.ts', line: 30, reason: 'db-receiver-name-only', message: 'orders table read by name only' },
    // A finding and a note (P81), worded so only the search below finds them.
    { service: 'orders', file: 'src/basket.ts', line: 7, reason: 'query-in-loop', level: 'info', sites: 1, message: 'a lookup per basket line: likely N+1' },
    { service: 'orders', file: 'src/basket-client.ts', line: 3, reason: 'base-url-from-files', level: 'info', message: 'BASKET_URL is taken from .env.example' },
    // One reason twice in one file, inside a method the graph draws (P94).
    { service: 'orders', file: 'src/refunds.ts', line: 40, reason: 'call-dynamic-receiver', symbol: SERVICE, message: 'refund step picked by key' },
    { service: 'orders', file: 'src/refunds.ts', line: 52, reason: 'call-dynamic-receiver', symbol: SERVICE, message: 'refund step picked by key, again' },
  ] as never,
};

const diff: DiffReport = {
  diffFormatVersion: DIFF_FORMAT_VERSION,
  schemaVersion: SCHEMA_VERSION,
  generatedAt: FIXED,
  base: { ref: 'main', services: {} },
  head: { ref: null, services: {} },
  nodes: {
    added: [TABLE],
    removed: ['orders:OrdersService.legacy'],
    changed: [{ id: SERVICE, service: 'orders', label: 'OrdersService.place', fields: ['meta.returns'] }],
    moved: [],
  },
  edges: { added: [{ from: SERVICE, to: CHANNEL, type: 'emits' }], removed: [], changed: [] },
  types: { added: [], removed: [], changed: [] },
  unresolved: { added: [], removed: [] },
  joins: { lost: [] },
  flows: [],
  counts: {
    base: { nodes: 5, edges: 2, types: 1, unresolved: { rows: 2, sites: 2 } },
    head: { nodes: 6, edges: 3, types: 1, unresolved: { rows: 2, sites: 2 } },
  } as never,
  impact: [
    {
      node: SERVICE,
      service: 'orders',
      label: 'OrdersService.place',
      side: 'head',
      entries: [
        { id: ROUTE, service: 'orders', kind: 'http', type: 'entry', label: 'POST /orders', file: null, line: null, depth: 2, confidence: 'static' },
      ],
      counts: { 'orders:http': 1 },
      truncated: 0,
      services: ['orders'],
      servicesWithoutEntry: [],
      reached: 2,
      partial: false,
    },
  ],
  contracts: { new: [], fixed: [], preexisting: [], ignored: [] },
  warnings: [],
  timing: { baseMs: 0, headMs: 0, diffMs: 0, totalMs: 0 },
};

let client: Client;
let dbPath: string;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'flowatlas-p72-'));
  dbPath = join(directory, 'graph.db');
  writeGraphDb(graph, report(), dbPath);
  writeFileSync(
    join(directory, 'observed.json'),
    JSON.stringify({
      observedFormatVersion: 1,
      spans: 9,
      joins: {
        [`${ROUTE} -handles-> ${HANDLER}`]: { count: 7, lastSeen: FIXED },
        [`${HANDLER} -calls-> ${SERVICE}`]: { count: 5, lastSeen: FIXED },
      },
      entries: { [ROUTE]: { hits: 7, lastSeen: FIXED } },
      symbols: { [SERVICE]: { hits: 5 } },
      channels: {},
      unmatched: [],
    }),
  );
  saveAccepted(dbPath, [{ reason: 'db-receiver-name-only', note: 'known; read by name', acceptedAt: FIXED }]);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ dbPath }).connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe('search', () => {
  it('groups what a query finds by kind, each row with the id the next tool takes', async () => {
    const found = await call('search', { query: 'order' });
    expect(Object.keys(found.results).sort()).toEqual(['channels', 'classes', 'gaps', 'routes', 'tables', 'types']);
    expect(found.results.routes[0].id).toBe(ROUTE);
    expect(found.results.types[0]).toMatchObject({ id: 'type:orders#PlaceOrderDto', type: 'type', service: 'orders' });
    expect(found.next[0]).toBe(`get_flow({entry: ${JSON.stringify(ROUTE)}})`);
  });

  it('marks accepted gaps and lists the new ones first', async () => {
    const found = await call('search', { query: 'orders', kinds: ['gaps'] });
    expect(found.results.gaps.map((gap: { gapId: string }) => gap.gapId)).toEqual([
      'gap:orders|src/orders.service.ts|channel-dynamic',
      'gap:orders|src/orders.repo.ts|db-receiver-name-only',
    ]);
    expect(found.results.gaps[0].accepted).toBeUndefined();
    expect(found.results.gaps[1]).toMatchObject({ accepted: true, note: 'known; read by name' });
  });

  it('names the method a gap is in, keeps its gap id for accept, and lists every place (P94)', async () => {
    const found = await call('search', { query: 'refund', kinds: ['gaps'] });
    expect(found.results.gaps).toEqual([
      expect.objectContaining({
        id: SERVICE,
        gapId: 'gap:orders|src/refunds.ts|call-dynamic-receiver',
        loc: 'src/refunds.ts:40',
        sites: 2,
        places: ['src/refunds.ts:40', 'src/refunds.ts:52'],
      }),
    ]);
    // The gap as a prompt with how to close it first (P122), then the method it is in.
    expect(found.next).toEqual([
      'describe_for_prompt({id: "gap:orders|src/refunds.ts|call-dynamic-receiver"})',
      `get_source({symbol: ${JSON.stringify(SERVICE)}})`,
      `who_calls({symbol: ${JSON.stringify(SERVICE)}})`,
    ]);
  });

  it('leads a gap the graph draws nothing around to the gaps of its file', async () => {
    const found = await call('search', { query: 'basket', kinds: ['gaps'] });
    expect(found.results.gaps.every((gap: { id?: string }) => gap.id === undefined)).toBe(true);
    expect(found.next[0]).toMatch(/^describe_for_prompt\(\{id: "gap:[^"]*\|src\/basket-client\.ts\|/);
    expect(found.next[1]).toBe('search({query: "src/basket-client.ts", kinds: ["gaps"]})');
  });

  it('says what each gap hit is about: a gap, a note or a finding (P81)', async () => {
    const kinds = async (query: string): Promise<Array<[string, string]>> =>
      (await call('search', { query, kinds: ['gaps'] })).results.gaps.map((gap: { reason: string; kind: string }) => [gap.reason, gap.kind]);
    expect(await kinds('basket')).toEqual([
      ['base-url-from-files', 'note'],
      ['query-in-loop', 'finding'],
    ]);
    expect(await kinds('orders')).toEqual([
      ['channel-dynamic', 'gap'],
      ['db-receiver-name-only', 'gap'],
    ]);
  });

  it('says an accepted.json it cannot read, and marks nothing accepted (P80)', async () => {
    const file = join(dbPath, '..', 'accepted.json');
    const good = readFileSync(file, 'utf8');
    try {
      writeFileSync(file, good.replace('"acceptedFormatVersion": 2', '"acceptedFormatVersion": 3'));
      const found = await call('search', { query: 'orders', kinds: ['gaps'] });
      expect(found.results.gaps.every((gap: { accepted?: true }) => gap.accepted === undefined)).toBe(true);
      expect(found.note).toMatch(/^accepted\.json at .* cannot be read \(format version 3 was written by a newer flowatlas/);
      // A search that shows no gap has nothing to say about them.
      expect((await call('search', { query: 'coupon' })).note).toBeUndefined();
    } finally {
      writeFileSync(file, good);
    }
  });

  it('finds the ways in that can fail with an exception, by its name or status', async () => {
    const found = await call('search', { query: 'coupon' });
    expect(Object.keys(found.results)).toEqual(['fails']);
    expect(found.results.fails).toEqual([
      { id: ROUTE, type: 'entry', label: 'POST /orders', exception: 'CouponRejectedError', status: 422, sites: 1, service: 'orders' },
    ]);
    expect(found.next[0]).toBe(`get_flow({entry: ${JSON.stringify(ROUTE)}})`);
    expect((await call('search', { query: '422', kinds: ['fails'] })).counts).toEqual({ fails: 1 });
  });

  it('says when nothing matches', async () => {
    expect((await call('search', { query: 'zzz-nothing' })).error).toMatch(/nothing matches/);
  });
});

describe('observed counts', () => {
  it('sit on get_flow rows real traffic went through, and nowhere else', async () => {
    const flow = await call('get_flow', { entry: ROUTE });
    expect(flow.root.observed).toBe(7);
    const handler = flow.root.children[0];
    expect(handler.observed).toBe(7);
    expect(handler.children[0].observed).toBe(5);
    expect(handler.children[0].children[0].observed).toBeUndefined();
  });

  it('sit on who_calls rows, read along the edge the other way', async () => {
    const callers = await call('who_calls', { symbol: SERVICE });
    expect(callers.target.observed).toBe(5);
    expect(callers.callers[0]).toMatchObject({ node: { id: HANDLER }, observed: 5 });
    expect(callers.callers[0].children[0]).toMatchObject({ node: { id: ROUTE }, observed: 7 });
  });
});

describe('what_changed', () => {
  it('says to run diff when there is no diff.json', async () => {
    expect((await call('what_changed')).error).toMatch(/flowatlas diff/);
  });

  it('reads the last diff back, cut to what a session asks next', async () => {
    writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(diff));
    const changes = await call('what_changed');
    expect(changes.base).toEqual({ ref: 'main', label: 'main' });
    expect(changes.counts.nodes).toEqual({ added: 1, removed: 1, changed: 1, moved: 0 });
    expect(changes.entries).toEqual([
      expect.objectContaining({ id: ROUTE, reaches: SERVICE, confidence: 'static' }),
    ]);
    expect(changes.next[0]).toBe(`get_flow({entry: ${JSON.stringify(ROUTE)}})`);
    expect(changes.next[1]).toBe(`impact({symbol: ${JSON.stringify(SERVICE)}})`);
  });

  it('narrows to a service, and bounds every list', async () => {
    const elsewhere = await call('what_changed', { service: 'billing' });
    expect(elsewhere.entries).toEqual([]);
    expect(elsewhere.nodes.changed).toEqual([]);
    const cut = await call('what_changed', { maxNodes: 1 });
    expect(cut.nodes.added).toHaveLength(1);
  });

  it('applies detail: ids at 0, whose and what at 1, the changed fields at 2 (P93)', async () => {
    const bare = await call('what_changed', { detail: 0 });
    expect(bare.nodes.changed).toEqual([{ id: SERVICE }]);
    expect(bare.entries).toEqual([{ id: ROUTE, type: 'entry', reaches: SERVICE }]);
    const usual = await call('what_changed');
    expect(usual.nodes.changed).toEqual([{ id: SERVICE, service: 'orders', label: 'OrdersService.place' }]);
    const full = await call('what_changed', { detail: 2 });
    expect(full.nodes.changed).toEqual([{ id: SERVICE, service: 'orders', label: 'OrdersService.place', fields: ['meta.returns'] }]);
  });

  it('pages every list at once from one offset', async () => {
    const page = await call('what_changed', { maxNodes: 1, offset: 1 });
    expect(page.nodes.added).toEqual([]);
    expect(page.nextOffset).toBeUndefined();
    const two = { ...diff, nodes: { ...diff.nodes, added: [TABLE, CHANNEL] } };
    writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(two));
    const first = await call('what_changed', { maxNodes: 1 });
    expect(first).toMatchObject({ nextOffset: 1, truncated: '1 more; next page offset 1' });
    expect(first.next[0]).toBe('what_changed({maxNodes: 1, offset: 1})');
    expect((await call('what_changed', { maxNodes: 1, offset: 1 })).nodes.added).toEqual([CHANNEL]);
    writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(diff));
  });

  it('says head and base in words: "working tree" where no ref was read (P96)', async () => {
    const changes = await call('what_changed');
    expect(changes.head).toEqual({ ref: null, label: 'working tree' });
    const read = {
      ...diff,
      base: {
        ref: 'main',
        services: {
          orders: { sha: '0123456789abcdef', ref: 'main', cached: false, nodeModules: 'present' as const },
          billing: { sha: null, ref: null, cached: false, nodeModules: 'present' as const },
        },
      },
    };
    writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(read));
    expect((await call('what_changed')).base.label).toBe('main (orders 01234567; billing from the working tree)');
    writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(diff));
  });

  it('counts only the service asked about, every list before it is cut (P96)', async () => {
    const mixed: DiffReport = {
      ...diff,
      nodes: {
        added: [TABLE, 'billing#src/invoices.ts:Invoices.issue'],
        removed: ['orders:OrdersService.legacy', 'entry:billing:http:GET:/invoices'],
        changed: [...diff.nodes.changed, { id: 'billing#src/invoices.ts:Invoices.void', service: 'billing', label: 'Invoices.void', fields: [] }],
        moved: ['billing#src/invoices.ts:Invoices'],
      },
      edges: {
        added: [{ from: SERVICE, to: CHANNEL, type: 'emits' }, { from: 'billing#src/invoices.ts:Invoices.issue', to: TABLE, type: 'queries' }],
        removed: [],
        changed: [],
      },
      types: { added: ['type:orders#PlaceOrderDto', 'type:billing#InvoiceDto'], removed: [], changed: [] },
    };
    writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(mixed));
    const all = await call('what_changed');
    expect(all.counts.nodes).toEqual({ added: 2, removed: 2, changed: 2, moved: 1 });
    const billing = await call('what_changed', { service: 'billing', maxNodes: 1 });
    expect(billing.counts.nodes).toEqual({ added: 1, removed: 1, changed: 1, moved: 1 });
    expect(billing.counts.edges).toEqual({ added: 1, removed: 0, changed: 0 });
    expect(billing.counts.types).toEqual({ added: 1, removed: 0, changed: 0 });
    expect(billing.types.added).toEqual(['type:billing#InvoiceDto']);
    expect(billing.nodes.removed).toEqual(['entry:billing:http:GET:/invoices']);
    const none = await call('what_changed', { service: 'shipping' });
    expect(none.counts.nodes).toEqual({ added: 0, removed: 0, changed: 0, moved: 0 });
    expect(none.note).toBe('no such service in the diff');
    writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(diff));
  });

  describe('the verdict (P96)', () => {
    const withDiff = async (over: Partial<DiffReport>, args: Record<string, unknown> = {}): Promise<any> => {
      writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify({ ...diff, ...over }));
      try {
        return await call('what_changed', { verdict: true, ...args });
      } finally {
        writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(diff));
      }
    };
    const party = (service: string) => ({ service, typeId: null, symbol: 'x' });
    const finding = (severity: 'error' | 'warning') => ({
      severity,
      kind: 'missing_required' as const,
      edge: { from: 'http_out:gateway#src/c.ts:3:1', to: ROUTE, type: 'http_calls' },
      edgeKey: `http_out:gateway#src/c.ts:3:1|http_calls|${ROUTE}`,
      direction: 'request' as const,
      sender: party('gateway'),
      receiver: party('orders'),
      typeId: 'type:orders#PlaceOrderDto',
      field: 'channel',
      expected: 'string',
      actual: null,
      rule: null,
      message: 'receiver orders requires `channel`; sender gateway does not send it',
      ignored: false,
      ignoredBy: null,
    });

    it('is safe when nothing broke, nothing lost its target and no new gap hides a change', async () => {
      const answer = await withDiff({});
      expect(answer.verdict).toBe('safe');
      expect(answer.because).toEqual([expect.stringMatching(/^no new contract error/)]);
      expect(answer.entries).toBeUndefined();
      expect(answer.retest[0]).toMatchObject({ id: ROUTE, changed: 1, observed: 7 });
    });

    it('is unsafe for a new contract error, and hands on check_contract for it', async () => {
      const answer = await withDiff({ contracts: { new: [finding('error')], fixed: [], preexisting: [], ignored: [] } });
      expect(answer.verdict).toBe('unsafe');
      expect(answer.because[0]).toMatch(/^1 new contract error: receiver orders requires/);
      expect(answer.next).toContain(`check_contract({from: "http_out:gateway#src/c.ts:3:1", to: ${JSON.stringify(ROUTE)}})`);
      // A warning is a finding, listed and not deciding.
      const warned = await withDiff({ contracts: { new: [finding('warning')], fixed: [], preexisting: [], ignored: [] } });
      expect(warned.verdict).toBe('safe');
      expect(warned.newFindings).toEqual([expect.objectContaining({ kind: 'contract-break', service: 'gateway', to: ROUTE })]);
    });

    it('is unsafe for a caller whose target went, and says what the head side says instead', async () => {
      const lost = {
        kind: 'target-gone' as const,
        caller: 'http_out:gateway#src/c.ts:9:1',
        target: 'entry:orders:http:GET:/orders/:param',
        edge: 'http_calls',
        service: 'gateway',
        targetService: 'orders',
        now: 'target-route-not-found',
        targetRemoved: true,
      };
      const answer = await withDiff({ joins: { lost: [lost] } });
      expect(answer.verdict).toBe('unsafe');
      expect(answer.vanishedTargets).toEqual([{ caller: lost.caller, target: lost.target, now: 'target-route-not-found' }]);
      expect(answer.because).toEqual([
        expect.stringMatching(/^1 call lost its target/),
        expect.stringMatching(/^1 removed way in is still called from another service/),
      ]);
      // Asked about the service whose route it was, the loss is still that service's.
      expect((await withDiff({ joins: { lost: [lost] } }, { service: 'orders' })).verdict).toBe('unsafe');
    });

    it('is unknown when a service was read from its working tree on both sides', async () => {
      const answer = await withDiff({
        warnings: [{ reason: 'ref-not-found', service: 'orders', message: 'orders: ref main not found', hint: '' }],
      });
      expect(answer.verdict).toBe('unknown');
      expect(answer.because[0]).toMatch(/^orders was not read at the base ref/);
    });

    it('is unknown for a new gap on a path from a change to a way in, and reads its method next', async () => {
      const gap = { id: 'gap:orders|src/orders.controller.ts|call-dynamic-receiver', kind: 'gap' as const, service: 'orders', file: 'src/orders.controller.ts', line: 4, reason: 'call-dynamic-receiver', node: HANDLER, sites: 1 };
      const off = { ...gap, id: 'gap:orders|src/basket.ts|call-dynamic-receiver', file: 'src/basket.ts', node: 'orders:Basket.add' };
      const answer = await withDiff({ unresolved: { added: [off, gap], removed: [] } });
      expect(answer.verdict).toBe('unknown');
      expect(answer.newGaps.map((row: { id: string; onChangedPath?: true }) => [row.id, row.onChangedPath])).toEqual([
        [gap.id, true],
        [off.id, undefined],
      ]);
      expect(answer.next).toContain(`get_source({symbol: ${JSON.stringify(HANDLER)}})`);
      // Off every changed path, a new gap is listed and the branch is safe.
      expect((await withDiff({ unresolved: { added: [off], removed: [] } })).verdict).toBe('safe');
    });

    it('weighs a site a gap id gained like a new gap id, and says how many the base had (P194)', async () => {
      const grown = { id: 'gap:orders|src/orders.controller.ts|call-dynamic-receiver', kind: 'gap' as const, service: 'orders', file: 'src/orders.controller.ts', line: 4, reason: 'call-dynamic-receiver', node: HANDLER, sites: 1, kept: 2 };
      const answer = await withDiff({ unresolved: { added: [grown], removed: [] } });
      expect(answer.verdict).toBe('unknown');
      expect(answer.newGaps).toEqual([expect.objectContaining({ id: grown.id, sites: 1, kept: 2, onChangedPath: true })]);
    });

    it('reads a diff.json of format 1, and says it is too old to know the gaps', async () => {
      const { unresolved: _unresolved, joins: _joins, flows: _flows, ...old } = diff;
      writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify({ ...old, diffFormatVersion: 1 }));
      try {
        const answer = await call('what_changed', { verdict: true });
        expect(answer.verdict).toBe('unknown');
        expect(answer.because[0]).toMatch(/format 1.*rerun flowatlas diff for new gaps/);
      } finally {
        writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(diff));
      }
    });

    it('reads a diff.json of format 2, whose missing flows do not make the verdict unknown (P116)', async () => {
      const { flows: _flows, ...old } = diff;
      writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify({ ...old, diffFormatVersion: 2 }));
      try {
        const answer = await call('what_changed', { verdict: true });
        expect(answer.verdict).toBe('safe');
        expect(answer.counts.flows).toBe(0);
        expect(answer.retest[0].flow).toBeUndefined();
      } finally {
        writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(diff));
      }
    });

    it('ranks the ways in to retest by how many changed nodes each reaches, then by traffic', async () => {
      const other = 'orders:entry:GET /orders';
      const row = (node: string, entries: string[]) => ({
        ...diff.impact[0]!,
        node,
        entries: entries.map((id) => ({ ...diff.impact[0]!.entries[0]!, id, label: id })),
      });
      const answer = await withDiff({
        impact: [row(SERVICE, [other, ROUTE]), row(HANDLER, [ROUTE])],
        nodes: { ...diff.nodes, changed: [...diff.nodes.changed, { id: HANDLER, service: 'orders', label: 'OrdersController.create', fields: [] }] },
      });
      expect(answer.retest.map((entry: { id: string; changed: number }) => [entry.id, entry.changed])).toEqual([
        [ROUTE, 2],
        [other, 1],
      ]);
      expect(answer.next[0]).toBe(`get_flow({entry: ${JSON.stringify(ROUTE)}})`);
    });
  });
});

describe('what_changed says what each changed flow does now (P116)', () => {
  const flow = {
    entry: ROUTE,
    label: 'POST /orders',
    service: 'orders',
    side: 'both' as const,
    reaches: 1,
    participants: [
      { id: 'caller', label: 'client', kind: 'caller' as const },
      { id: 'orders', label: 'orders', kind: 'service' as const, service: 'orders' },
      { id: CHANNEL, label: 'order.placed', kind: 'channel' as const },
      { id: 'billing', label: 'billing', kind: 'service' as const, service: 'billing' },
    ],
    steps: [
      { status: 'same' as const, kind: 'enters' as const, from: 'caller', to: 'orders', label: 'POST /orders', confidence: 'static' as const },
      { status: 'added' as const, kind: 'emits' as const, from: 'orders', to: CHANNEL, label: 'order.placed', confidence: 'static' as const },
      { status: 'removed' as const, kind: 'http_calls' as const, from: 'orders', to: 'billing', label: 'POST /invoices', confidence: 'static' as const },
    ],
    counts: { same: 1, added: 1, removed: 1, changed: 0 },
  };

  it('gives each way in its changed steps as text, and only their counts at detail 0', async () => {
    writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify({ ...diff, flows: [flow] }));
    try {
      const answer = await call('what_changed');
      expect(answer.counts.flows).toBe(1);
      expect(answer.entries[0].flow).toEqual({
        side: 'both',
        added: 1,
        removed: 1,
        changed: 0,
        steps: ['+ orders → order.placed order.placed', '- orders → billing POST /invoices'],
      });
      const bare = await call('what_changed', { detail: 0 });
      expect(bare.entries[0].flow).toEqual({ side: 'both', added: 1, removed: 1, changed: 0 });
      const verdict = await call('what_changed', { verdict: true });
      expect(verdict.retest[0].flow.steps).toHaveLength(2);
    } finally {
      writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(diff));
    }
  });
});
