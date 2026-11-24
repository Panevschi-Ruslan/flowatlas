import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * Findings that hold (P395), against the fixture where a screen is fed through
 * a stream relaying the shop's two channels, another through a stream one of
 * whose channels is looked up when it opens, a store page reads two fields of
 * its answer behind a presence check and one plainly, the back office sends a
 * draft seven of whose fields may be missing and one of the wrong type, and a
 * route answers a type made of itself.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'findings-that-hold', 'flowatlas.config.json');

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { verbose: true, ...args } })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createFlowatlasServer({ configPath: CONFIG, allTools: true });
  await server.connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe('findings that hold', () => {
  it('checks a type a screen chooses against every channel its stream relays, and holds it back where the relays are not all read', async () => {
    const answer = await call('findings', { kind: 'type-never-published' });
    // AUDIT_ENTRY_CREATED comes on the events channel, ORDER_PLACED on the orders channel: only the refund, on neither, is listed.
    expect(answer.rows.map((row: { id: string }) => row.id)).toEqual(['channel:shop:*:events#ORDER_REFUNDED']);
    expect(answer.rows[0].message).toContain('on the 2 channels it receives (shop:*:events, shop:*:orders)');
    expect(answer.heldBack['type-never-published']).toEqual({ count: 1, why: '1 subscription(s) behind GET /shops/:param/feed name a channel not read' });
  });

  it('holds back a field of an answer read behind a presence check, and lists the one read plainly', async () => {
    const answer = await call('findings', { kind: 'answer-field-never-returned' });
    expect(answer.rows.map((row: { message: string }) => row.message.split(' ')[0])).toEqual(['`rating`']);
    expect(answer.heldBack['answer-field-never-returned'].why).toContain('is read behind a check that it is there');
    const contract = await call('check_contract', { edge: 'GET /stores/:id' });
    const guarded = contract.answer.missing.filter((row: { guarded?: boolean }) => row.guarded === true).map((row: { field: string }) => row.field);
    expect(guarded.sort()).toEqual(['changesFromPrevious', 'distance']);
  });

  it('lists contract breaks at error and counts those at warning, with the call that lists them', async () => {
    const all = await call('findings');
    expect(all.counts['contract-break']).toBe(1);
    expect(all.warnings).toEqual({ 'contract-break': 7 });
    expect(all.next).toContain('findings({kind: "contract-break", severity: "warning"})');
    const warnings = await call('findings', { kind: 'contract-break', severity: 'warning' });
    expect(warnings.total).toBe(7);
    expect(warnings.rows.every((row: { severity: string }) => row.severity === 'warning')).toBe(true);
  });

  it('answers on a route whose answer type is made of itself', async () => {
    const contract = await call('check_contract', { edge: 'GET /categories/tree' });
    expect(contract.left.join(' ')).toContain('is not a shape read');
  });
});
