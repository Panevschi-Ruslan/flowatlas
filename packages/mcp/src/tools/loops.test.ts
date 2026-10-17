import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/** The loops worth fixing (P89), as an assistant is handed them. */
const CONFIG = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'loops-worth-fixing', 'flowatlas.config.json');

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ configPath: CONFIG }).connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe('loops that run a query per item', () => {
  it('are searched busiest first, each saying how sure it is', async () => {
    const answer = await call('search', { query: 'query-in-loop', kinds: ['gaps'] });
    const hits = answer.results.gaps as Array<{ loc: string; kind: string; severity: string; waysIn: number }>;
    expect(hits.map((hit) => [hit.loc, hit.kind, hit.severity, hit.waysIn])).toEqual([
      ['src/parcels/parcels.service.ts:18', 'finding', 'likely', 3],
      // A file holding a likely N+1 and two per-item loops keeps its finding,
      // ranked before a note reached alike (P130).
      ['src/parcels/handover.ts:43', 'finding', 'likely', 1],
      ['src/parcels/dispatch.ts:13', 'note', 'note', 1],
    ]);
  });

  it('are written into the prompt with the ways in that reach them', async () => {
    const answer = await call('describe_for_prompt', { id: 'GET /parcels/labels' });
    expect(answer.markdown).toMatch(/`query-in-loop` at .*parcels\.service\.ts:18.*likely N\+1\. Reached from 3 ways in\./);
  });
});
