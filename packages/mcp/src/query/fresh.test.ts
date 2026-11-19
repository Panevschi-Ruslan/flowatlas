import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { contentHash, FRESHNESS_FILE, FRESHNESS_FORMAT_VERSION, type Freshness } from '@flowatlas/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import { withStale } from './fresh.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-fresh-'));
const out = join(scratch, '.flowatlas');
const repo = join(scratch, 'orders');
const SHA = 'c'.repeat(40);

/** The orders service's one file, as a build read it and as it is now. */
const stamped = (text: string): [number, number, string] => {
  const path = join(repo, 'src', 'orders', 'orders.service.ts');
  mkdirSync(join(repo, 'src', 'orders'), { recursive: true });
  writeFileSync(path, text);
  const stat = statSync(path);
  return [stat.size, stat.mtimeMs, contentHash(text)];
};

let client: Client;

beforeAll(async () => {
  mkdirSync(out, { recursive: true });
  copyFileSync(join(ROOT, 'fixtures', 'multi-repo', '.flowatlas', 'graph.db'), join(out, 'graph.db'));
  const stamp = stamped('as it was read\n');
  writeFileSync(join(repo, 'src', 'orders', 'orders.service.ts'), 'edited since\n');
  // A checkout the build found on main; the directory is no checkout now, so it reads as moved.
  mkdirSync(join(repo, '.git', 'refs', 'heads'), { recursive: true });
  writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/feature-x\n');
  writeFileSync(join(repo, '.git', 'refs', 'heads', 'feature-x'), `${'d'.repeat(40)}\n`);
  const freshness: Freshness = {
    freshnessFormatVersion: FRESHNESS_FORMAT_VERSION,
    builtAt: '2026-11-05T10:00:00.000Z',
    services: { orders: { dir: repo, commit: SHA, branch: 'main', dirty: false, files: { 'src/orders/orders.service.ts': stamp } } },
  };
  writeFileSync(join(out, FRESHNESS_FILE), JSON.stringify(freshness));

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ dbPath: join(out, 'graph.db'), allTools: true, toolsPollMs: 0 }).connect(serverSide);
  // Every answer is checked against its tool's output schema, as a strict client checks it.
  client = new Client({ name: 'test', version: '0' }, { jsonSchemaValidator: new AjvJsonSchemaValidator() });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
  rmSync(scratch, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
  const response = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { ...JSON.parse(response.content[0]!.text), isError: response.isError === true };
};

describe('an answer that says the code moved since the build (P230)', () => {
  it('names the file it cites that changed, and what to do', async () => {
    const flow = await call('get_flow', { entry: 'entry:orders:http:POST:/orders' });
    expect(flow.isError).toBe(false);
    expect(flow.stale).toEqual({ files: 1, of: 1, first: 'orders/src/orders/orders.service.ts', since: '2026-11-05T10:00:00.000Z', fix: 'run flowatlas build' });
  });

  it('says nothing on an answer whose files did not move', async () => {
    const flow = await call('get_flow', { entry: 'entry:billing:http:GET:/invoices/:param' });
    expect(flow.stale).toBeUndefined();
  });

  it('passes the output schema of a tool that declares one', async () => {
    const found = await call('find_symbol', { query: 'OrdersService.create' });
    expect(found.isError).toBe(false);
    expect(found.stale).toMatchObject({ files: 1, first: 'orders/src/orders/orders.service.ts' });
  });

  it('start_here says the checkout moved', async () => {
    const start = await call('start_here', {});
    expect(start.isError).toBe(false);
    expect(start.moved).toBe('orders: built on main@ccccccc, now feature-x@ddddddd');
  });
});

describe('a server told to rebuild when an answer finds its files moved', () => {
  it('says rebuilding when it started one, and passes the answer through when nothing moved', () => {
    let asked = 0;
    const handle = { path: join(out, 'graph.db'), onStale: () => (asked += 1) > 0 };
    const answer = withStale(handle, { root: { node: { id: 'orders#src/orders/orders.service.ts:OrdersService.create' }, children: [] } }) as { stale?: { rebuilding?: boolean } };
    expect(answer.stale?.rebuilding).toBe(true);
    expect(asked).toBe(1);
    const quiet = { root: { node: { id: 'channel:order.created' }, children: [] } };
    expect(withStale(handle, quiet)).toBe(quiet);
    expect(withStale(handle, { error: 'no' })).toEqual({ error: 'no' });
  });
});
