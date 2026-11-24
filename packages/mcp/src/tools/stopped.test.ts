import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION, type ProjectGraph } from '@flowatlas/core';
import { writeGraphDb, type LinkReport } from '@flowatlas/linker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import { edge, entry, node } from '../test-graph.js';

/**
 * Walks that say where they stopped (P94), on a project of its own: a chain
 * that ends in a method nothing calls, in a file with gaps that might hide
 * the call; a caller the graph has no node for; a chain longer than the
 * deepest walk; and a method only that orphan reaches.
 */
const FIXED = '2026-01-01T00:00:00.000Z';
const ROUTE = 'entry:shop:http:POST:/carts';
const HANDLER = 'shop#src/carts.controller.ts:CartsController.create';
const SERVICE = 'shop#src/carts.service.ts:CartsService.add';
const ORPHAN = 'shop#src/jobs/sweep.ts:SweepJob.run';
const SWEPT = 'shop#src/jobs/sweep.ts:SweepJob.sweepOne';
const GHOST = 'shop#src/gone.ts:Gone.call';
const CHAIN = Array.from({ length: 20 }, (_, index) => `shop#src/chain.ts:Chain.step${index}`);

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

const graph: ProjectGraph = {
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  services: [{ name: 'shop', repo: './shop', type: 'nestjs', extractor: null }],
  nodes: [
    entry(ROUTE, { repo: 'shop', label: 'POST /carts', meta: { method: 'POST', path: '/carts' } }),
    node(HANDLER, { repo: 'shop', label: 'CartsController.create', file: 'src/carts.controller.ts', line: 5 }),
    node(SERVICE, { repo: 'shop', label: 'CartsService.add', file: 'src/carts.service.ts', line: 9 }),
    node(ORPHAN, { repo: 'shop', label: 'SweepJob.run', file: 'src/jobs/sweep.ts', line: 4 }),
    node(SWEPT, { repo: 'shop', label: 'SweepJob.sweepOne', file: 'src/jobs/sweep.ts', line: 12 }),
    ...CHAIN.map((id, index) => node(id, { repo: 'shop', label: `Chain.step${index}`, file: 'src/chain.ts', line: index + 1 })),
  ],
  edges: [
    edge(ROUTE, HANDLER, { type: 'handles' }),
    edge(HANDLER, SERVICE),
    edge(ORPHAN, SERVICE),
    edge(GHOST, SERVICE),
    edge(ORPHAN, SWEPT),
    // step0 is called by step1, which is called by step2, and so on up.
    ...CHAIN.slice(1).map((id, index) => edge(id, CHAIN[index]!)),
  ],
  types: {},
  unresolved: [
    { service: 'shop', file: 'src/jobs/sweep.ts', line: 20, reason: 'call-dynamic-receiver', level: 'info', sites: 2, message: 'a step picked by key' },
    { service: 'shop', file: 'src/jobs/sweep.ts', line: 30, reason: 'any-typed', level: 'info', sites: 1, message: 'a field typed any' },
    // Neither counts: a finding, and a place with nothing to join.
    { service: 'shop', file: 'src/jobs/sweep.ts', line: 40, reason: 'query-in-loop', level: 'info', sites: 1, message: 'a query per item' },
    { service: 'shop', file: 'src/jobs/sweep.ts', line: 50, reason: 'handler-not-a-method', level: 'nothing', sites: 1, message: 'nothing to join' },
  ] as never,
};

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { verbose: true, ...args } })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

/** Every row of a callers tree. */
const rows = (nodes: Array<{ node: { id: string }; children: unknown[] }>): Array<Record<string, any>> =>
  nodes.flatMap((row) => [row, ...rows(row.children as never)]);

beforeAll(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'flowatlas-p94-')), 'graph.db');
  writeGraphDb(graph, report(), dbPath);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ dbPath }).connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  await client.listTools();
});

afterAll(async () => {
  await client.close();
});

describe('who_calls at the end of a chain', () => {
  it('marks a caller nothing calls as the top of its chain, with the gaps in its file', async () => {
    const answer = await call('who_calls', { symbol: SERVICE });
    const orphan = rows(answer.callers).find((row) => row.node.id === ORPHAN);
    // Two gap rows; the finding and the place with nothing to join are not gaps.
    expect(orphan).toMatchObject({ topOfChain: true, gapsInFile: 2 });
    // A way in ends a chain too, and is no lead.
    expect(rows(answer.callers).find((row) => row.node.id === ROUTE)?.topOfChain).toBeUndefined();
    expect(answer.truncated).toBeUndefined();
    expect(answer.next.slice(0, 2)).toEqual(['cant_follow({service: "shop"})', 'search({query: "src/jobs/sweep.ts", kinds: ["gaps"]})']);
  });

  it('says a caller the graph holds no node for, rather than dropping it', async () => {
    const answer = await call('who_calls', { symbol: SERVICE });
    expect(answer.callers.find((row: { node: { id: string } }) => row.node.id === GHOST)?.node).toEqual({ id: GHOST, type: 'missing' });
  });

  it('marks the target itself when nothing calls it', async () => {
    const answer = await call('who_calls', { symbol: ORPHAN });
    expect(answer).toMatchObject({ topOfChain: true, gapsInFile: 2, callers: [] });
    expect(answer.next).not.toContain(`who_calls({symbol: ${JSON.stringify(ORPHAN)}})`);
  });

  it('at the deepest depth, draws the tree that far and walks the rest of the chain to its end (P376, P379)', async () => {
    const answer = await call('who_calls', { symbol: CHAIN[0], depth: 16 });
    expect(answer.stoppedBy).toBeUndefined();
    expect(answer.frontier).toBeUndefined();
    expect(answer.maybe.map((row: { id: string; hops: number }) => [row.id, row.hops])).toEqual([[CHAIN[19], 19]]);
    expect(answer.next.some((hint: string) => hint.startsWith('who_calls('))).toBe(false);
  });

  it('without depth, walks a chain longer than any depth to its end, and says no way in is above it (P376)', async () => {
    const answer = await call('who_calls', { symbol: CHAIN[0] });
    expect(answer.stoppedBy).toBeUndefined();
    expect(answer.waysIn).toEqual([]);
    // The chain's top, nineteen hops up, is code a call the reading did not follow may reach: a maybe row.
    expect(answer.maybe.map((row: { id: string; hops: number }) => [row.id, row.hops])).toEqual([[CHAIN[19], 19]]);
    expect(answer.waysInNone).toBe('no way in reaches this; the maybe rows stop at an unread call');
    expect(answer.left).toContain('gaps: 1 chain stops at an unread call before any way in: the maybe row');
    expect(answer.next.some((hint: string) => hint.startsWith('who_calls('))).toBe(false);
  });

  it('says maxNodes cut the tree, the depth being where it stops being drawn (P379)', async () => {
    const answer = await call('who_calls', { symbol: SERVICE, maxNodes: 1, depth: 1 });
    expect(answer.stoppedBy).toEqual(['maxNodes']);
    expect(answer.truncated).toBe('2 more nodes past maxNodes 1; raise maxNodes or ask who_calls on a child id');
  });
});

describe('impact with no way in', () => {
  it('says the callers may be behind a gap when something reaches it, and where to look', async () => {
    const answer = await call('impact', { symbol: SWEPT });
    // The chain ends at code nothing read calls, which an unread call could: a maybe row (P367), not an empty list.
    expect(answer.entries.map((row: { id: string; reach: string }) => [row.id, row.reach])).toEqual([[ORPHAN, 'maybe']]);
    expect(answer.maybe).toBe(1);
    expect(answer.reached).toBe(1);
    expect(answer.entriesNone).toBe('nothing in the graph reaches this from a way in; the callers may be behind a gap');
    expect(answer.left).toEqual(['gaps: 1 chain stops at an unread call before any way in: the maybe row']);
    // The maybe row is the chain's top: no deeper who_calls, only where its caller may hide.
    expect(answer.next).toEqual(['cant_follow({service: "shop"})', 'search({query: "src/jobs/sweep.ts", kinds: ["gaps"]})']);
  });

  it('says nothing reaches it when nothing does', async () => {
    const answer = await call('impact', { symbol: ORPHAN });
    expect(answer.entriesNone).toBe('nothing reaches this');
    expect(answer.next[0]).toBe('cant_follow({service: "shop"})');
  });

  it('says nothing about it when a way in does reach it', async () => {
    const answer = await call('impact', { symbol: SERVICE });
    expect(answer.entries.map((row: { id: string; reach?: string }) => [row.id, row.reach])).toEqual([[ROUTE, 'dead'], [ORPHAN, 'maybe']]);
    expect(answer.entriesNone).toBeUndefined();
  });
});
