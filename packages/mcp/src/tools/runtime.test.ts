import { copyFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'multi-repo');
const CONFIG = join(FIXTURE, 'flowatlas.config.json');

/**
 * The multi-repo graph with the observed file `flowatlas observe` wrote over
 * the fixture's traces (the CLI's `observe.json` snapshot), on a copy, and the
 * same graph without one.
 */
const copy = mkdtempSync(join(tmpdir(), 'flowatlas-runtime-'));
cpSync(join(FIXTURE, '.flowatlas'), copy, { recursive: true });
copyFileSync(join(FIXTURE, 'expected.cli', 'observe.json'), join(copy, 'observed.json'));
const bare = mkdtempSync(join(tmpdir(), 'flowatlas-runtime-bare-'));
cpSync(join(FIXTURE, '.flowatlas'), bare, { recursive: true });

const clients: Client[] = [];
const connect = async (dbPath: string): Promise<(name: string, args?: Record<string, unknown>) => Promise<any>> => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ configPath: CONFIG, dbPath }).connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  clients.push(client);
  return async (name, args = {}) => {
    const response = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
    return JSON.parse(response.content[0]!.text);
  };
};

let call: Awaited<ReturnType<typeof connect>>;
let none: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  call = await connect(join(copy, 'graph.db'));
  none = await connect(join(bare, 'graph.db'));
});
afterAll(async () => {
  for (const client of clients) await client.close();
  rmSync(copy, { recursive: true, force: true });
  rmSync(bare, { recursive: true, force: true });
});

/** A 32- or 16-hex run standing alone: a trace or span id. */
const ID = /(?<![0-9a-f])([0-9a-f]{32}|[0-9a-f]{16})(?![0-9a-f])/;

describe('slow_steps', () => {
  it('ranks the timed steps by the figure asked for, and keeps only those seen minCount times', async () => {
    const all = await call('slow_steps', { minCount: 1, limit: 100 });
    const p95s = all.steps.map((step: { p95: number }) => step.p95);
    expect(p95s).toEqual([...p95s].sort((a, b) => b - a));
    expect(all.steps[0]).toMatchObject({ label: 'OrdersController.findOne', service: 'gateway', p95: 520 });
    const hop = all.steps.find((step: { type?: string }) => step.type === 'http_calls');
    expect(hop).toMatchObject({ measuredAt: 'caller', max: 500, label: 'gateway GET /orders/:param -> orders GET /orders/:param' });
    // The call site's own row would say what its join says.
    expect(all.steps.some((step: { id: string }) => step.id === hop.from)).toBe(false);
    expect((await call('slow_steps', { minCount: 2, limit: 100 })).steps.every((step: { count: number }) => step.count >= 2)).toBe(true);
    const tooFew = await call('slow_steps', { minCount: 50 });
    expect(tooFew).toMatchObject({ steps: [], total: 0, note: expect.stringContaining('lower minCount') });
  });

  it('keeps to what an entry reaches, and names the flow, the trace and the source next', async () => {
    const entry = 'entry:gateway:http:GET:/orders/:param';
    const scoped = await call('slow_steps', { entry, minCount: 1 });
    expect(scoped.steps.some((step: { service: string }) => step.service === 'billing')).toBe(false);
    expect(scoped.next.slice(0, 2)).toEqual([`get_flow({entry: ${JSON.stringify(entry)}})`, `trace_for({entry: ${JSON.stringify(entry)}})`]);
    expect(scoped.next[2]).toMatch(/^get_source\(/);
    const cut = await call('slow_steps', { minCount: 1, limit: 2 });
    expect(cut.steps).toHaveLength(2);
    expect(cut.total).toBeGreaterThan(2);
    expect(cut.truncated).toContain('larger limit');
  });
});

describe('hot_paths', () => {
  it('lists entries busiest first, each with the joins it reached most, bounded both ways', async () => {
    const hot = await call('hot_paths', {});
    const counts = hot.entries.map((entry: { count: number }) => entry.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const gateway = hot.entries.find((entry: { id: string }) => entry.id === 'entry:gateway:http:GET:/orders/:param');
    expect(gateway.joins[0]).toMatchObject({ count: 1, p95: 500 });
    const bounded = await call('hot_paths', { limit: 1, joins: 0 });
    expect(bounded.entries).toHaveLength(1);
    expect(bounded.entries[0]).not.toHaveProperty('joins');
    expect(bounded.truncated).toBeDefined();
    expect((await call('hot_paths', { service: 'orders' })).entries.every((entry: { service: string }) => entry.service === 'orders')).toBe(true);
  });
});

describe('trace_for', () => {
  it('answers a route said aloud with the failing request as a tree of node ids, and no trace id', async () => {
    const answer = await call('trace_for', { entry: 'POST /orders' });
    expect(answer.entry).toBe('entry:orders:http:POST:/orders');
    expect(answer.failing).toMatchObject({ id: 'entry:orders:http:POST:/orders', status: 500, error: true, ms: 35 });
    expect(answer.failing.children[0]).toMatchObject({ id: 'channel:order.created', kind: 'producer' });
    expect(answer.failing.children[0].children[0]).toMatchObject({ id: 'entry:billing:event:order.created', service: 'billing' });
    // The one request sampled is both: shown once.
    expect(answer.slow).toBeUndefined();
    expect(answer.note).toContain('also the slowest');
    expect(JSON.stringify(answer)).not.toMatch(ID);
  });

  it('answers an entry id with the slow request across services, and cuts a tree at maxNodes', async () => {
    const answer = await call('trace_for', { entry: 'entry:gateway:http:GET:/orders/:param' });
    expect(answer.slow).toMatchObject({ ms: 520, service: 'gateway' });
    expect(answer.slow.children[0].children[0]).toMatchObject({ id: 'entry:orders:http:GET:/orders/:param', service: 'orders', ms: 496 });
    expect(answer.failing).toBeUndefined();
    expect(JSON.stringify(answer)).not.toMatch(ID);
    const cut = await call('trace_for', { entry: 'POST /invoices', maxNodes: 2 });
    expect(cut.truncated).toContain('larger maxNodes');
    expect(cut.failing.children).toHaveLength(1);
    expect(cut.failing.children[0]).not.toHaveProperty('children');
  });

  it('says when an entry has no sample, and what would give it one', async () => {
    const answer = await call('trace_for', { entry: 'entry:orders:http:POST:/orders/:param/archive' });
    expect(answer.note).toContain('flowatlas observe');
    expect(answer.slow).toBeUndefined();
    expect((await call('trace_for', { entry: 'GET /nowhere' })).error).toContain('no entry matches');
  });
});

describe('run time beside the map', () => {
  it('puts p95 and errorRate beside observed, and trace_for in next, where the file has them', async () => {
    const flow = await call('get_flow', { entry: 'entry:gateway:http:GET:/orders/:param' });
    expect(flow.root).toMatchObject({ observed: 2, p95: 520, errorRate: 0 });
    expect(flow.next[1]).toBe('trace_for({entry: "entry:gateway:http:GET:/orders/:param"})');
    const entries = await call('list_entries', { service: 'billing', kind: 'http' });
    expect(entries.next).toContain('trace_for({entry: "entry:billing:http:GET:/invoices/:param"})');
  });

  it('answers that nothing was observed when there is no file, and adds nothing to other answers', async () => {
    for (const tool of ['slow_steps', 'hot_paths']) expect((await none(tool, {})).error).toContain('nothing was observed');
    expect((await none('trace_for', { entry: 'POST /orders' })).error).toContain('nothing was observed');
    const flow = await none('get_flow', { entry: 'entry:gateway:http:GET:/orders/:param' });
    expect(flow.root).not.toHaveProperty('p95');
    expect(flow.next.some((hint: string) => hint.startsWith('trace_for'))).toBe(false);
  });
});

describe('undeclared_failures', () => {
  it('ranks the ways in whose 5xx nothing declares first, bounded, each naming the failing request and the handler next', async () => {
    const all = await call('undeclared_failures', {});
    expect(all.window).toMatchObject({ from: expect.any(String), to: expect.any(String) });
    const entries = all.routes.map((row: { entry: string }) => row.entry);
    expect(entries).toContain('entry:orders:http:POST:/orders');
    expect(entries).toContain('entry:billing:http:POST:/invoices');
    // A 404 the handler declares, and traffic answered, is not undeclared.
    expect(entries).not.toContain('entry:billing:http:GET:/invoices/:param');
    const ranks = all.routes.map((row: { undeclared: Array<{ status: number; count: number; expected?: string }> }) =>
      row.undeclared.filter((item) => item.status >= 500 && item.expected === undefined).reduce((sum, item) => sum + item.count, 0),
    );
    expect(ranks).toEqual([...ranks].sort((a: number, b: number) => b - a));
    const invoices = all.routes.find((row: { entry: string }) => row.entry === 'entry:billing:http:POST:/invoices');
    expect(invoices.undeclared).toEqual([{ status: 500, count: 1, share: expect.any(Number) }]);
    // Hit often enough that the 409 it declares and nobody answered is said.
    expect(invoices.declaredNeverSeen).toEqual([expect.objectContaining({ status: 409, exception: 'ConflictException' })]);
    expect(invoices.next).toEqual([
      'trace_for({entry: "entry:billing:http:POST:/invoices"})',
      expect.stringMatching(/^get_source\(\{symbol: "billing#src\/invoices\/invoices\.controller\.ts:InvoicesController\.create"\}\)$/),
    ]);
    const cut = await call('undeclared_failures', { limit: 1 });
    expect(cut.routes).toHaveLength(1);
    expect(cut.total).toBe(all.routes.length);
    expect(cut.truncated).toContain('larger limit');
    expect((await call('undeclared_failures', { service: 'orders' })).routes.every((row: { service: string }) => row.service === 'orders')).toBe(true);
    expect((await call('undeclared_failures', { minCount: 2 })).routes).toEqual([]);
  });

  it('says there is nothing to read without an observed file', async () => {
    expect(await none('undeclared_failures', {})).toEqual({ error: expect.stringContaining('flowatlas observe') });
  });
});

describe('failures on get_flow and describe_for_prompt', () => {
  it('set the statuses seen beside the declared failures of the root, over the window', async () => {
    const flow = await call('get_flow', { entry: 'GET /invoices/inv-1' });
    expect(flow.root.fails).toEqual([expect.objectContaining({ status: 404, exception: 'NotFoundException', seen: 1 })]);
    expect(flow.root.failures).toEqual({ hits: 3, window: expect.any(Object), undeclared: [], declaredNeverSeen: [] });
    const invoices = await call('get_flow', { entry: 'POST /invoices' });
    expect(invoices.root.fails[0]).not.toHaveProperty('seen');
    expect(invoices.root.failures).toMatchObject({ undeclared: [{ status: 500 }], declaredNeverSeen: [{ status: 409 }] });
    expect((await none('get_flow', { entry: 'POST /invoices' })).root).not.toHaveProperty('failures');
  });

  it('write the same in the text and carry it as data on an entry', async () => {
    const answer = await call('describe_for_prompt', { id: 'entry:billing:http:POST:/invoices' });
    expect(answer.failures).toMatchObject({ undeclared: [{ status: 500 }], declaredNeverSeen: [{ status: 409 }] });
    expect(answer.markdown).toContain('## Failures seen at run time');
    expect(answer.markdown).toContain('- **500** ×1');
    expect(answer.markdown).toContain('`ConflictException` — declared, never seen in the window');
    const bare = await none('describe_for_prompt', { id: 'entry:billing:http:POST:/invoices' });
    expect(bare).not.toHaveProperty('failures');
    expect(bare.markdown).not.toContain('Failures seen at run time');
  });
});
