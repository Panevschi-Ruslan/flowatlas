import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compactAnswer } from '../compact.js';
import { createFlowatlasServer } from '../server.js';

/**
 * What a pilot left open after P404 (P405), on `fixtures/pilot-left-open`:
 * the channel that answers kept in `alsoOn`, a dispatcher's reads through a
 * cast, a set built by spreading others, a route's parameter names on a
 * list's rows, and screens that refetch said to read nothing.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'pilot-left-open', 'flowatlas.config.json');
const EVENTS = 'tenant:*:events';
const DISPATCH = 'consumer:push-worker#src/push/push.service.ts:PushService.dispatch';
const BOT = 'consumer:push-worker#src/bot/chat-bot.service.ts:ChatBot.handleStepReady';
const SCREENS = [
  'consumer:staff-web#src/app/steps/call-board.component.ts:CallBoardComponent.load',
  'consumer:staff-web#src/app/steps/staff-steps.component.ts:StaffStepsComponent.load',
];

let client: Client;

const call = async (name: string, args: Record<string, unknown>, verbose = true): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { verbose, ...args } })) as { content: Array<{ text: string }> };
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

describe('what the pilot left open (P405)', () => {
  it('keeps the channel whose handler reads the field in alsoOn, named with its line, and counts the rest', async () => {
    const answer = await call('who_consumes', { channel: EVENTS, type: 'STEP_READY', field: 'stepName' });
    expect(answer.consumers).toEqual([]);
    expect(answer.alsoOn).toEqual([{ channel: 'channel:status_feed', count: 1, readers: [{ id: BOT, line: 28 }] }]);
    expect(answer.alsoOnRest).toBe('and 3 other channels carry STEP_READY with no handler reading stepName');
    // `settled` is said in the compact answer an agent is handed (P403).
    const compact = await call('who_consumes', { channel: EVENTS, type: 'STEP_READY', field: 'stepName' }, false);
    expect(compact.settled).toBe('no consumer of STEP_READY reads stepName; on status_feed code does (alsoOn)');
    expect(answer.complete).toBe(true);
  });

  it('ranks who_emits\' other channels by their publishes, none cut', async () => {
    const answer = await call('who_emits', { channel: EVENTS, type: 'STEP_READY' });
    expect((answer.alsoOn as Array<{ channel: string }>).map((row) => row.channel)).toEqual([
      'channel:session:*:closed',
      'channel:session:*:paid',
      'channel:session:*:split',
      'channel:status_feed',
    ]);
  });

  it('reads the dispatcher through its cast: roomId missing, read behind a check that returns early', async () => {
    const answer = await call('check_contract', { channel: EVENTS, type: 'CALL_STAFF' });
    expect(answer.missing).toEqual([{ field: 'roomId', id: 'push-worker#src/push/push.service.ts:PushService.dispatch', line: 42, guarded: true, effect: 'returns early' }]);
    const dispatch = (answer.consumers as Array<{ id: string; reads?: string[]; readsNothing?: boolean }>).find((row) => row.id === DISPATCH);
    expect(dispatch?.reads).toEqual(['orderId', 'roomId', 'scopeId', 'ts', 'type']);
    const board = (answer.consumers as Array<{ id: string; readsNothing?: boolean }>).find((row) => row.id === SCREENS[0]);
    expect(board?.readsNothing).toBe(true);
    expect(answer.complete).toBe(true);
  });

  it('reads a set built by spreading others: the consumer filtering by it chooses RESYNC, settled', async () => {
    const answer = await call('who_consumes', { channel: EVENTS, type: 'RESYNC' });
    expect((answer.consumers as Array<{ id: string }>).map((row) => row.id)).toEqual(['consumer:push-worker#src/live/live-feed.service.ts:LiveFeed.redraw']);
    expect(answer.complete).toBe(true);
    expect((await call('who_consumes', { channel: EVENTS, type: 'RESYNC' }, false)).settled).toBe('1 consumer of RESYNC, all listed');
  });

  it('says the screens that refetch read nothing of the message, never "not read"', async () => {
    const answer = await call('who_consumes', { channel: EVENTS, type: 'STEP_READY', field: 'step' });
    expect((answer.consumers as Array<{ id: string }>).map((row) => row.id)).toEqual([DISPATCH]);
    expect(answer.readsNothing).toEqual(SCREENS);
    expect(answer.left).toBeUndefined();
    expect(answer.complete).toBe(true);
  });

  it('keeps a route\'s parameter names on a list\'s rows: rawPath verbose, the label compact', async () => {
    const verbose = await call('list_entries', { in: 'KitsController' });
    expect((verbose.entries as Array<{ rawPath?: string }>).map((row) => row.rawPath)).toEqual(['/api/admin/:tenantId/kits/auto-stopped', '/api/admin/:tenantId/kits/:kitId/restart']);
    const compact = await call('list_entries', { in: 'KitsController' }, false);
    expect((compact.entries as Array<{ label?: string; rawPath?: string }>).map((row) => [row.label, row.rawPath])).toEqual([
      ['GET /api/admin/:tenantId/kits/auto-stopped', undefined],
      ['POST /api/admin/:tenantId/kits/:kitId/restart', undefined],
    ]);
  });
});

describe('a way in\'s parameter names in a compact row (P405)', () => {
  it('says them in the label where it is short, and keeps rawPath beside a long one', () => {
    const long = `/api/admin/:tenantId/${'segment/'.repeat(8)}:kitId`;
    const answer = compactAnswer(
      {
        entries: [
          { id: 'entry:api:http:GET:/kits/:param', type: 'entry', label: 'GET /kits/:param', rawPath: '/kits/:kitId' },
          { id: 'entry:api:http:GET:/long', type: 'entry', label: 'GET /long', rawPath: long },
        ],
        total: 2,
      },
      { tool: 'list_entries' },
    ) as { entries: Array<Record<string, unknown>> };
    expect(answer.entries[0]).toEqual({ id: 'entry:api:http:GET:/kits/:param', label: 'GET /kits/:kitId' });
    expect(answer.entries[1]?.['rawPath']).toBe(long);
  });
});
