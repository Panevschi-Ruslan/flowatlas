import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import { withoutShown } from '../query/next.js';
import { completeOf } from './common.js';

/**
 * Answers that finish in one call (P364), against the fixture whose screens
 * choose types of message on one channel: every row naming code says whether
 * it runs and where it is reached from, every list whether it is complete,
 * several inputs are answered in one call, and `next` asks nothing a row
 * already says.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'helpdesk-screen-reach', 'flowatlas.config.json');
const CHANNEL = 'channel:desk:*:events';
const QUEUE = 'consumer:console#src/screens/QueueScreen.tsx:onQueueEvent';
const TICKET = 'consumer:console#src/screens/TicketScreen.tsx:onTicketEvent';
const ARCHIVE = 'consumer:console#src/screens/ArchivePanel.tsx:onArchiveEvent';
const ASSIGN = 'desk-api#src/tickets/tickets.service.ts:TicketsService.assign';
const REOPEN = 'desk-api#src/tickets/tickets.service.ts:TicketsService.reopen';

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

/** Whether a hint asks again what the rows say: dead, who_calls or search on one of them. */
const repeats = (next: readonly string[], ids: readonly string[]): string[] =>
  next.filter((hint) => /^(dead|who_calls|search)\(/.test(hint) && ids.some((id) => hint.includes(JSON.stringify(id))));

describe('reach and the nearest way in on each row', () => {
  it('names the screen each handler of a type is shown on, and asks nothing the rows say', async () => {
    const answer = await call('who_consumes', { channel: CHANNEL, type: 'TICKET_ASSIGNED' });
    expect(answer.consumers.map((row: { id: string; reach: string; from: string }) => [row.id, row.reach, row.from])).toEqual([
      [QUEUE, 'alive', 'screen /queue'],
      [TICKET, 'alive', 'screen /tickets/:param'],
    ]);
    expect(answer.complete).toBe(true);
    expect(answer.left).toBeUndefined();
    expect(repeats(answer.next, [QUEUE, TICKET])).toEqual([]);
  });

  it('says a handler no way in reaches sits behind the component nothing renders, a maybe and never a no (P367)', async () => {
    const answer = await call('who_consumes', { channel: CHANNEL, type: 'TICKET_REOPENED' });
    expect(answer.consumers).toHaveLength(1);
    // No route shows the panel, nothing renders it and its name is written nowhere else (P370): that chain is
    // unreached. The method that publishes the type is called by nothing read, a maybe, and the row says so.
    expect(answer.consumers[0]).toMatchObject({ id: ARCHIVE, reach: 'maybe', from: 'behind', behind: 'desk-api#src/tickets/tickets.service.ts:TicketsService.reopen' });
  });

  it('places a publish at the route that runs it', async () => {
    const answer = await call('who_emits', { channel: CHANNEL, type: 'TICKET_ASSIGNED' });
    expect(answer.producers[0]).toMatchObject({ reach: 'alive', from: 'POST /desks/:param/tickets/:param/assign' });
    expect(answer.complete).toBe(true);
  });

  it('places a screen subscription in its screen, its own service first, and counts no route publishing to it (P371)', async () => {
    const answer = await call('who_consumes', { channel: CHANNEL, type: 'TICKET_CLOSED' });
    expect(answer.consumers[0]).toMatchObject({ id: TICKET, from: 'screen /tickets/:param' });
    expect(answer.consumers[0].ways).toBeUndefined();
  });

  it('says reach on the rows of who_calls, find_symbol and search, and not at detail 0', async () => {
    const callers = await call('who_calls', { symbol: ASSIGN });
    expect(callers.target).toMatchObject({ reach: 'alive', from: 'POST /desks/:param/tickets/:param/assign' });
    expect(callers.callers[0].node).toMatchObject({ reach: 'alive' });
    const found = await call('find_symbol', { query: 'reopen' });
    // Nothing calls it, though its class is used: a call the reading could not type may (P367).
    expect(found.matches.find((row: { id: string }) => row.id === REOPEN)).toMatchObject({ reach: 'maybe', from: 'behind' });
    const searched = await call('search', { query: 'QueueScreen', kinds: ['classes'] });
    expect(searched.results.classes[0]).toMatchObject({ reach: 'alive', from: 'screen /queue' });
    const bare = await call('who_consumes', { channel: CHANNEL, type: 'TICKET_ASSIGNED', detail: 0 });
    expect(bare.consumers[0].reach).toBeUndefined();
  });

  it('gives impact the reach of its target and of each way in, and dead the way in', async () => {
    const impact = await call('impact', { symbol: ASSIGN });
    expect(impact.target.reach).toBe('alive');
    expect(impact.entries[0].reach).toBeDefined();
    expect(impact.entries[0].from).toBeUndefined();
    const dead = await call('dead', { id: QUEUE });
    expect(dead).toMatchObject({ verdict: 'alive', from: 'screen /queue' });
    expect(repeats(dead.next ?? [], [QUEUE])).toEqual([]);
  });
});

describe('several inputs in one call', () => {
  it('answers each id under answers, with what each asked', async () => {
    const answer = await call('dead', { ids: [QUEUE, REOPEN] });
    expect(answer.answers.map((one: { asked: string; verdict: string }) => [one.asked, one.verdict])).toEqual([
      [QUEUE, 'alive'],
      [REOPEN, 'likely-dead'],
    ]);
    expect(answer.answers[1].from).toBe('behind');
    expect(answer.complete).toBeUndefined();
  });

  it('takes the single form and the several together, without repeats', async () => {
    const answer = await call('find_symbol', { query: 'reopen', queries: ['reopen', 'onQueueEvent'] });
    expect(answer.answers.map((one: { asked: string }) => one.asked)).toEqual(['reopen', 'onQueueEvent']);
    expect(answer.complete).toBe(true);
  });

  it('answers several searches, types and symbols', async () => {
    const searched = await call('search', { queries: ['Queue', 'TICKET_CLOSED'] });
    expect(searched.answers.map((one: { asked: string }) => one.asked)).toEqual(['Queue', 'TICKET_CLOSED']);
    expect(searched.answers[1].results.messages[0].label).toBe('TICKET_CLOSED');
    const types = await call('get_type', { types: ['DeskEvent', 'NoSuchType'] });
    expect(types.answers[0].type.name).toBe('DeskEvent');
    expect(types.answers[1]).toMatchObject({ asked: 'NoSuchType', error: expect.stringContaining('no type named') });
    const callers = await call('who_calls', { symbols: [ASSIGN, REOPEN] });
    expect(callers.answers.map((one: { target: { id: string } }) => one.target.id)).toEqual([ASSIGN, REOPEN]);
  });

  it('asks for one of the two forms', async () => {
    expect((await call('who_calls', {})).error).toMatch(/symbol or symbols/);
  });
});

describe('whether a list is the whole answer', () => {
  it('names the cut where a walk stopped, and keeps the call that walks on', async () => {
    const answer = await call('who_calls', { symbol: ASSIGN, depth: 1 });
    expect(answer.complete).toBe(false);
    expect(answer.left).toEqual(['depth: 1 callers past depth 1, from the frontier rows']);
    expect(answer.next[0]).toBe(`who_calls({symbol: ${JSON.stringify(ASSIGN)}})`);
  });

  it('names a page left', async () => {
    const answer = await call('list_entries', { maxNodes: 1 });
    expect(answer.complete).toBe(false);
    expect(answer.left[0]).toMatch(/^page: \d+ more rows from offset 1$/);
  });

  it('says the several answers are incomplete where one is', async () => {
    const answer = await call('who_calls', { symbols: [ASSIGN, REOPEN], depth: 1 });
    expect(answer.complete).toBe(false);
    expect(answer.left).toEqual([`symbol ${ASSIGN}: see its left`]);
  });

  it('is true or false with left, never left alone', () => {
    expect(completeOf([undefined, false, ''])).toEqual({ complete: true });
    expect(completeOf(['page: 3 more rows from offset 2', undefined])).toEqual({ complete: false, left: ['page: 3 more rows from offset 2'] });
  });
});

describe('next without what the rows say', () => {
  it('drops dead on a row with reach and who_calls or search on a row with from', () => {
    const rows = [
      { id: 'a#x.ts:Box.open', label: 'Box.open', reach: 'alive', from: 'GET /box' },
      { id: 'b#y.ts:lid', reach: 'dead' },
    ];
    expect(
      withoutShown(
        [
          'dead({id: "a#x.ts:Box.open"})',
          'dead({id: "b#y.ts:lid"})',
          'who_calls({symbol: "a#x.ts:Box.open", depth: 6})',
          'who_calls({symbol: "b#y.ts:lid"})',
          'search({query: "Box", kinds: ["classes"]})',
          'impact({symbol: "a#x.ts:Box.open"})',
        ],
        rows,
      ),
    ).toEqual(['who_calls({symbol: "b#y.ts:lid"})', 'impact({symbol: "a#x.ts:Box.open"})']);
  });
});
