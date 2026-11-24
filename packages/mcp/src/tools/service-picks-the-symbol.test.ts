import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import { pluralAsked } from './common.js';

/**
 * Answers never falsely complete (P381), against a lending back end whose
 * `GET /books/:bookId` a gateway serves under the same path, a reader front
 * end requesting it, a desk bot asking the gateway, a route nothing requests
 * and one requested one segment off.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'service-picks-the-symbol', 'flowatlas.config.json');
const API_ROUTE = 'entry:lending-api:http:GET:/books/:param';
const GATEWAY_ROUTE = 'entry:lending-gateway:http:GET:/books/:param';
const BOOK_SCREEN = 'entry:reader-web:screen:/book/:param';
const BOT = 'entry:desk-bot:bot_command:book';
const RELEASE_ROUTE = 'entry:lending-api:http:DELETE:/books/:param/hold';
const EXTEND_ROUTE = 'entry:lending-api:http:POST:/books/:param/extend';

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}, verbose = true): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { ...(verbose ? { verbose: true } : {}), ...args } })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

const ids = (rows: Array<{ id: string }>): string[] => rows.map((row) => row.id);

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

describe('service picks the symbol, and never empties the answer', () => {
  it('who_calls on a route said aloud with its own service lists every way in, in any service', async () => {
    const answer = await call('who_calls', { symbol: 'GET /books/42', service: 'lending-api' });
    expect(answer.target.id).toBe(API_ROUTE);
    expect(ids(answer.waysIn).sort()).toEqual([BOT, GATEWAY_ROUTE, BOOK_SCREEN].sort());
    expect(answer.complete).toBe(true);
  });

  it('impact on a route id with its own service lists the ways in elsewhere', async () => {
    const answer = await call('impact', { symbol: API_ROUTE, service: 'lending-api' });
    expect(ids(answer.entries)).toEqual([BOT, GATEWAY_ROUTE, BOOK_SCREEN]);
    expect(answer.complete).toBe(true);
  });

  it('callersIn keeps one service, says what it left out and the call without it', async () => {
    const answer = await call('impact', { symbol: API_ROUTE, callersIn: 'reader-web' });
    expect(ids(answer.entries)).toEqual([BOOK_SCREEN]);
    expect(answer.complete).toBe(false);
    expect(answer.left).toContain('filter: 2 ways in in other services left out (callersIn: reader-web)');
    expect(answer.next).toContain(`impact({symbol: "${API_ROUTE}"})`);
    const callers = await call('who_calls', { symbol: API_ROUTE, callersIn: 'desk-bot' });
    expect(ids(callers.waysIn)).toEqual([BOT]);
    expect(callers.left).toContain('filter: 2 ways in in other services left out (callersIn: desk-bot)');
  });

  it('a service the symbol lies outside still cuts the rows, and says so', async () => {
    const answer = await call('impact', { symbol: API_ROUTE, service: 'reader-web' });
    expect(ids(answer.entries)).toEqual([BOOK_SCREEN]);
    expect(answer.complete).toBe(false);
  });
});

describe('a name that means two answers each', () => {
  it('who_calls on a route two services serve answers both, the one more is joined to first', async () => {
    const answer = await call('who_calls', { symbol: 'GET /books/42' });
    expect(answer.ambiguous).toBe('"GET /books/42" names 2 symbols; each is answered, the liveliest first');
    expect(answer.answers.map((one: { asked: string }) => one.asked)).toEqual([API_ROUTE, GATEWAY_ROUTE]);
    expect(answer.answers[1].waysIn.map((row: { id: string }) => row.id)).toEqual([BOT]);
    expect(answer.complete).toBe(true);
  });

  it('impact on the same name answers both too', async () => {
    const answer = await call('impact', { symbol: 'GET /books/42' });
    expect(answer.answers.map((one: { asked: string }) => one.asked)).toEqual([API_ROUTE, GATEWAY_ROUTE]);
  });

  it('a name nothing holds answers the nearest, fuzzy and never complete', async () => {
    const answer = await call('who_calls', { symbol: 'BoksService.findOne' });
    expect(answer.fuzzy).toBe(true);
    expect(answer.target.id).toBe('lending-api#src/books.service.ts:BooksService.findOne');
    expect(answer.complete).toBe(false);
    expect(answer.left[0]).toBe('fuzzy: no name holds "BoksService.findOne"; the nearest is answered');
  });
});

describe('impact sums the ways in by kind, the routes the code runs behind apart', () => {
  it('names the screen, the bot and the gateway by the files handling them, and the back end route as changing', async () => {
    const answer = await call('impact', { symbol: 'BooksService.findOne' });
    expect(answer.byKind).toEqual({
      bots: { 'desk-bot': ['src/desk-bot.ts'] },
      routes: { 'lending-gateway': ['src/books.controller.ts'] },
      screens: { 'reader-web': ['src/app/book-page.component.ts'] },
    });
    expect(answer.changing).toEqual([API_ROUTE]);
  });

  it('takes several symbols as one change: every way in once', async () => {
    const answer = await call('impact', { symbols: ['BooksService.findOne', 'HoldsService.place'] });
    expect(answer.targets.map((target: { id: string }) => target.id)).toEqual([
      'lending-api#src/books.service.ts:BooksService.findOne',
      'lending-api#src/holds.service.ts:HoldsService.place',
    ]);
    expect(answer.changing).toEqual([API_ROUTE, 'entry:lending-api:http:POST:/books/:param/hold']);
    expect(new Set(ids(answer.entries)).size).toBe(answer.entries.length);
  });
});

describe('facts before verdicts', () => {
  it('code called only through a dead route is dead with it, not a bare alive', async () => {
    const answer = await call('dead', { id: 'HoldsService.release' });
    expect(answer).toMatchObject({ verdict: 'alive', reach: 'dead', throughDead: true, from: 'DELETE /books/:param/hold' });
  });

  it('a route says how many callers it has beside its verdict', async () => {
    const answer = await call('dead', { id: RELEASE_ROUTE });
    expect(answer).toMatchObject({ verdict: 'dead', callers: 0 });
  });

  it('a class counts every way in no caller joins as uncalled, the one a segment off too', async () => {
    const answer = await call('dead', { id: 'lending-api#src/books.controller.ts:BooksController' });
    expect(answer.uncalled).toBe(2);
    expect(answer.waysIn.find((row: { id: string }) => row.id === EXTEND_ROUTE)).toMatchObject({ verdict: 'unknown', callers: 0 });
  });

  it('list_entries for the dead says the uncalled ways in it did not list, and called: false lists every one', async () => {
    const dead = await call('list_entries', { service: 'lending-api', reach: 'dead' });
    expect(ids(dead.entries)).toEqual([RELEASE_ROUTE]);
    expect(dead.complete).toBe(false);
    expect(dead.next[0]).toBe('list_entries({service: "lending-api", called: false})');
    const uncalled = await call('list_entries', { service: 'lending-api', called: false });
    expect(ids(uncalled.entries)).toEqual([RELEASE_ROUTE, EXTEND_ROUTE]);
    expect(uncalled.complete).toBe(true);
  });
});

describe('several inputs, said any way', () => {
  it('reads ids, a list in the single input and one string in the list as the tool takes them', () => {
    expect(pluralAsked('who_calls', { ids: ['a', 'b'] })).toEqual({ symbols: ['a', 'b'] });
    expect(pluralAsked('impact', { symbol: ['a', 'b'], detail: 2 })).toEqual({ detail: 2, symbols: ['a', 'b'] });
    expect(pluralAsked('find_symbol', { queries: 'a' })).toEqual({ query: 'a' });
    expect(pluralAsked('who_consumes', { channel: 'x', ids: ['y'] })).toEqual({ channels: ['x', 'y'] });
    expect(pluralAsked('dead', { id: ['a', 'b'] })).toEqual({ ids: ['a', 'b'] });
    expect(pluralAsked('get_flow', { ids: ['a'] })).toEqual({ ids: ['a'] });
  });

  it('who_calls takes ids, and impact symbols', async () => {
    const answer = await call('who_calls', { ids: [API_ROUTE, GATEWAY_ROUTE] });
    expect(answer.answers.map((one: { asked: string }) => one.asked)).toEqual([API_ROUTE, GATEWAY_ROUTE]);
    expect(answer.complete).toBe(true);
  });

  it('a symbol of several that names nothing is said, and the answer is not complete', async () => {
    const answer = await call('impact', { symbols: ['BooksService.findOne', 'Nothing.here'] });
    expect(answer.unresolved).toEqual([{ asked: 'Nothing.here', error: 'no symbol matches "Nothing.here"' }]);
    expect(answer.complete).toBe(false);
  });
});
