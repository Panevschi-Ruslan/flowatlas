import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * who_consumes and who_emits take a message type as the channel (P393), as
 * check_contract does (P382): answered on the channel carrying it, saying
 * which, on the fixture where ORDER_READY travels on order_updates.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'typed-handlers-bus-wide-subscribers', 'flowatlas.config.json');

let client: Client;

const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { verbose: true, ...args } })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ configPath: CONFIG, allTools: true }).connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe('a message type given as the channel', () => {
  it('who_consumes answers as for the channel and the type', async () => {
    const asType = await call('who_consumes', { channel: 'ORDER_READY' });
    const asked = await call('who_consumes', { channel: 'order_updates', type: 'ORDER_READY' });
    expect(asType.carriedBy).toEqual(['channel:order_updates']);
    expect(asType.type).toBe('ORDER_READY');
    expect(asType.consumers).toEqual(asked.consumers);
    expect(asType.error).toBeUndefined();
  });

  it('who_emits too, and a name that is neither still gets the nearest channels', async () => {
    const asType = await call('who_emits', { channel: 'order_ready' });
    expect(asType.carriedBy).toEqual(['channel:order_updates']);
    expect(asType.producers.length).toBeGreaterThan(0);
    const neither = await call('who_emits', { channel: 'zzqqxx' });
    expect(neither.error).toContain('no channel named');
  });
});
