import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import { reachOfVerdict } from '../query/ways-in.js';

/**
 * Reach that never hides a maybe, and impact that answers "what could break"
 * in one call (P367), against a back end whose method is reached through a
 * route a web screen requests, a route a bot's handler requests where the
 * bot registers its handlers in a loop the reading cannot follow, and a
 * webhook whose handler calls it directly.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'impact-calling-side', 'flowatlas.config.json');
const TARGET = 'shop-api#src/orders.service.ts:OrdersService.updateStatus';
const ROUTE = 'entry:shop-api:http:PATCH:/orders/status';
const HOOK = 'entry:shop-api:http:POST:/hooks/chat';
const SCREEN = 'entry:backoffice-web:screen:/board';
const HANDLER = 'ops-bot#src/ops-bot.ts:OpsBot.handleStatus';
const CLIENT = 'ops-bot#src/shop.client.ts:ShopClient.updateStatus';
const GAP = 'gap:ops-bot|src/ops-bot.ts|call-dynamic-receiver';
const ARCHIVE = 'shop-api#src/archive-helper.ts:ArchiveHelper.copyStatus';
const LEGACY = 'shop-api#src/legacy-export.ts:LegacyExport.run';

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

/** Every row of a who_calls tree, by id. */
const rowsOf = (callers: Array<{ node: Record<string, unknown> & { id: string }; children?: unknown[] }>): Map<string, Record<string, unknown>> => {
  const rows = new Map<string, Record<string, unknown>>();
  const queue = [...callers];
  while (queue.length > 0) {
    const item = queue.shift()!;
    rows.set(item.node.id, item.node);
    queue.push(...((item.children ?? []) as typeof callers));
  }
  return rows;
};

describe('impact lists every way in that could break, in one call', () => {
  it('names the screen and the bot handler on the calling side, the webhook as outside, the handler as a maybe with its gap', async () => {
    const answer = await call('impact', { symbol: TARGET });
    expect(answer.entries.map((row: { id: string; reach: string; via?: string }) => [row.id, row.reach, row.via])).toEqual([
      [SCREEN, 'outside', 'PATCH /orders/status (shop-api)'],
      [ROUTE, 'alive', undefined],
      [HOOK, 'outside', undefined],
      [HANDLER, 'maybe', 'PATCH /orders/status (shop-api)'],
    ]);
    expect(answer.entries[3]).toMatchObject({ gap: GAP, from: 'behind', service: 'ops-bot', loc: 'src/ops-bot.ts:29' });
    expect(answer.entriesByService).toEqual({ 'shop-api': 2, 'backoffice-web': 1 });
    expect(answer.maybe).toBe(1);
    expect(answer.complete).toBe(false);
    expect(answer.left).toEqual(['gaps: 1 chain stops at an unread call before any way in: the maybe row']);
  });

  it('walks on from the route itself to the callers beyond it', async () => {
    const answer = await call('impact', { symbol: ROUTE });
    expect(answer.entries.map((row: { id: string }) => row.id)).toEqual([SCREEN, HANDLER]);
  });

  it('keeps a row its id, service and line at detail 1 when compact, the crossing and the reach beside them', async () => {
    const response = (await client.callTool({ name: 'impact', arguments: { symbol: TARGET } })) as { content: Array<{ text: string }> };
    const compact = JSON.parse(response.content[0]!.text);
    expect(compact.entries[3]).toEqual({ id: HANDLER, line: 29, reach: 'maybe', from: 'behind', gap: GAP, via: 'PATCH /orders/status (shop-api)' });
  });

  it('pages the ways in and the maybe rows as one list', async () => {
    const answer = await call('impact', { symbol: TARGET, maxNodes: 2 });
    expect(answer.entries).toHaveLength(2);
    expect(answer).toMatchObject({ total: 4, nextOffset: 2, complete: false });
  });
});

describe('reach never turns a maybe into a no', () => {
  it('says the bot chain sits behind the unread call in its file, never unreached', async () => {
    const answer = await call('who_calls', { symbol: TARGET, depth: 8 });
    const rows = rowsOf(answer.callers);
    for (const id of [HANDLER, CLIENT]) expect(rows.get(id)).toMatchObject({ reach: 'maybe', from: 'behind', gap: GAP });
    expect(rows.get(CLIENT)).toMatchObject({ behind: HANDLER });
    expect(rows.get(HANDLER)!['behind']).toBeUndefined();
    expect(rows.get(HOOK)).toMatchObject({ reach: 'outside' });
    // Only the helper a dead method alone calls is unreached: no way in reaches it, and no unread call could.
    expect([...rows].filter(([, row]) => row['reach'] === 'unreached').map(([id]) => id)).toEqual([ARCHIVE]);
    expect(rows.get(ARCHIVE)).toMatchObject({ from: 'none' });
    expect(rows.get(LEGACY)).toMatchObject({ reach: 'dead' });
  });

  it('says dead on the handler is likely-dead, with the gap it sits behind', async () => {
    const answer = await call('dead', { id: HANDLER });
    expect(answer).toMatchObject({ verdict: 'likely-dead', from: 'behind', gap: GAP });
  });

  it('says a way in whose caller is outside is outside, and unknown nowhere', () => {
    expect(reachOfVerdict({ type: 'entry' }, { verdict: 'unknown', evidence: { outside: 'webhook' } })).toBe('outside');
    expect(reachOfVerdict({ type: 'entry' }, { verdict: 'unknown', evidence: {} })).toBe('outside');
    expect(reachOfVerdict({ type: 'entry' }, { verdict: 'unknown', evidence: { oneOff: [{ call: 'x', asks: 'GET /a', differs: 'a for b' }] } })).toBe('maybe');
    expect(reachOfVerdict({ type: 'ui_component' }, { verdict: 'unknown', evidence: {} })).toBe('maybe');
    expect(reachOfVerdict({ type: 'provider' }, { verdict: 'unknown', evidence: { outside: 'library' } })).toBe('outside');
    expect(reachOfVerdict({ type: 'method' }, { verdict: 'likely-dead', evidence: {} })).toBe('maybe');
    expect(reachOfVerdict({ type: 'method' }, { verdict: 'dead', evidence: {} })).toBe('dead');
  });
});
