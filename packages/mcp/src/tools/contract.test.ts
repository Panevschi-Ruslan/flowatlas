import { copyFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import type { TrafficChecker, TrafficCompared } from './common.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'multi-repo');
const CONFIG = join(FIXTURE, 'flowatlas.config.json');
const INVOICE = 'entry:gateway:http:POST:/orders/:param/invoice';

/** The multi-repo graph beside the observed file `observe --shapes` wrote (the CLI's `observe.shapes.json`). */
const copy = mkdtempSync(join(tmpdir(), 'flowatlas-traffic-'));
cpSync(join(FIXTURE, '.flowatlas'), copy, { recursive: true });
copyFileSync(join(FIXTURE, 'expected.cli', 'observe.shapes.json'), join(copy, 'observed.json'));

/**
 * The contracts package's answer stood in for (this package does not depend
 * on it): the invoice route differs in one field, every other route agrees.
 * What it was asked is kept, so the test sees the shapes and the call handed in.
 */
const asked: Array<Parameters<TrafficChecker>[0]> = [];
const checker: TrafficChecker = (input) => {
  asked.push(input);
  const differs = input.entry === INVOICE ? 1 : 0;
  const compared: TrafficCompared = {
    entry: input.entry,
    samples: input.shapes.samples,
    lastSeen: input.shapes.lastSeen,
    ...(differs === 0
      ? {}
      : {
          request: {
            against: { typeId: 'type:@fx/contracts#OrderDto', by: 'route', symbol: 'x', service: 'gateway' },
            samples: 1,
            diffs: [{ kind: 'extra_field', path: 'giftNote', expected: null, actual: 'string', seenIn: 1, of: 1, severity: 'info', message: 'm' }],
          },
        }),
    unchecked: [{ direction: 'response', status: '500', reason: 'status-not-declared', samples: 1 }],
    differs,
  };
  return compared;
};

const clients: Client[] = [];
const connect = async (trafficChecker?: TrafficChecker): Promise<(name: string, args?: Record<string, unknown>) => Promise<any>> => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ configPath: CONFIG, dbPath: join(copy, 'graph.db'), ...(trafficChecker === undefined ? {} : { trafficChecker }) }).connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  clients.push(client);
  return async (name, args = {}) => {
    const response = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
    return JSON.parse(response.content[0]!.text);
  };
};

let call: Awaited<ReturnType<typeof connect>>;
let unchecked: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  call = await connect(checker);
  unchecked = await connect();
});
afterAll(async () => {
  for (const client of clients) await client.close();
  rmSync(copy, { recursive: true, force: true });
});

describe('check_contract with traffic shapes (P113)', () => {
  it('answers an entry id with what traffic carried into it, and the calls that check each crossing', async () => {
    const answer = await call('check_contract', { edge: INVOICE });
    expect(answer.entry).toBe(INVOICE);
    expect(answer.traffic).toEqual({
      samples: 1,
      window: { from: '2025-10-16T07:00:00.000Z', to: '2025-10-16T09:00:00.000Z' },
      against: { request: 'type:@fx/contracts#OrderDto' },
      request: [{ severity: 'info', kind: 'extra_field', field: 'giftNote', expected: null, actual: 'string', seenIn: 1, of: 1, message: 'm' }],
      unchecked: ['response 500: status-not-declared'],
    });
    expect(answer.callers).toBe(3);
    expect(answer.next[0]).toMatch(/^check_contract\({from: "ui_api_call:web#/);
    // The shapes handed in are the file's, never the body: names and types only.
    expect(asked.at(-1)?.shapes.request?.f).toHaveProperty('giftNote');
  });

  it('carries traffic on an edge into the entry, handing the checker the call being checked', async () => {
    const edge = 'ui_api_call:web#src/app/orders-api.service.ts:61:12';
    const answer = await call('check_contract', { from: edge, to: INVOICE });
    expect(answer.edge).toMatchObject({ from: edge, to: INVOICE });
    expect(answer.traffic.request).toHaveLength(1);
    expect(asked.at(-1)?.caller).toMatchObject({ from: edge, to: INVOICE });
  });

  it('says there are no shapes rather than nothing, and carries none without a checker', async () => {
    expect(await call('check_contract', { edge: 'entry:orders:http:POST:/orders' })).toMatchObject({
      note: expect.stringContaining('observe --shapes'),
      callers: 0,
    });
    expect((await unchecked('check_contract', { edge: INVOICE })).traffic).toBeUndefined();
    expect(await call('check_contract', { edge: 'entry:nowhere:http:GET:/x' })).toEqual({ error: 'no entry entry:nowhere:http:GET:/x' });
  });

  it('has get_flow hint check_contract on a way in whose traffic differs, and only there', async () => {
    const flow = await call('get_flow', { entry: INVOICE, maxNodes: 5 });
    expect(flow.next[1]).toBe(`check_contract({edge: "${INVOICE}"})`);
    const agrees = await call('get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', maxNodes: 5 });
    expect(agrees.next.some((hint: string) => hint.startsWith('check_contract({edge'))).toBe(false);
    expect((await unchecked('get_flow', { entry: INVOICE, maxNodes: 5 })).next.some((hint: string) => hint.startsWith('check_contract({edge'))).toBe(false);
  });
});
