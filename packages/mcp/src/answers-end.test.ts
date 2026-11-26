import { describe, expect, it } from 'vitest';
import { cappedAnswer, MAX_ANSWER_CHARS } from './capped.js';
import { confirmOf } from './query/ways-in.js';
import { INSTRUCTIONS } from './server.js';
import { routeAloud, settledAnswer } from './settled.js';

/**
 * P403: answers that end the question. A whole answer says what it adds up
 * to in `settled` and names no further call; every answer is held to a size,
 * its longest list cut with the call for the rest; a maybe's search names
 * the call where its name is common.
 */
describe('answers that end the question', () => {
  it('says where a request lands and that every way in is listed, with no next', () => {
    const answer = settledAnswer('who_calls', {
      target: {
        id: 'web#src/api.ts:Api.load',
        requests: [{ route: 'entry:shop-api:http:GET:/api/items/:param', by: 'shop-api#src/items.controller.ts:ItemsController.one' }],
      },
      callers: [],
      waysIn: [{ id: 'entry:web:screen:/items' }],
      complete: true,
      next: ['get_flow({entry: "entry:web:screen:/items"})'],
    }) as Record<string, unknown>;
    expect(answer['settled']).toBe('its request lands on GET /api/items/:param (shop-api), ItemsController.one; 1 way in reaches it, all listed');
    expect(answer['next']).toBeUndefined();
    expect(Object.keys(answer)[0]).toBe('settled');
  });

  it('settles a complete impact, counting what lies beyond a channel', () => {
    const answer = settledAnswer('impact', {
      entries: [{ id: 'entry:api:http:GET:/a' }, { id: 'entry:web:screen:/a' }],
      total: 2,
      throughChannels: [{ consumer: 'consumer:x#a.ts:A.on', channels: ['order.created'], ways: 3 }],
      complete: true,
      next: ['impact({symbol: "x", channel: "order.created"})'],
    }) as Record<string, unknown>;
    expect(answer['settled']).toBe('2 ways in break, all listed; more beyond a channel, counted in throughChannels');
    expect(answer['next']).toBeUndefined();
  });

  it('never settles an answer that is not whole, an error, or a page with more', () => {
    const open = { entries: [], total: 0, complete: false, left: ['gaps: 1 chain stops'], next: ['who_calls({symbol: "x"})'] };
    expect(settledAnswer('impact', open)).toBe(open);
    const paged = { entries: [{ id: 'a' }], total: 4, nextOffset: 1, complete: true };
    expect(settledAnswer('impact', paged)).toBe(paged);
    const failed = { error: 'no symbol matches "x"' };
    expect(settledAnswer('impact', failed)).toBe(failed);
    const other = { entries: [], complete: true };
    expect(settledAnswer('list_entries', other)).toBe(other);
  });

  it('settles check_contract only where the two ends were compared', () => {
    const agree = settledAnswer('check_contract', { edge: { from: 'a', to: 'b' }, status: 'identical', findings: [], next: ['get_type({type: "t"})'] }) as Record<string, unknown>;
    expect(agree['settled']).toBe('the two ends agree');
    const channel = settledAnswer('check_contract', { channel: 'channel:desk', missing: [{ field: 'deskId' }], unused: [], complete: true }) as Record<string, unknown>;
    expect(channel['settled']).toBe('1 field read and sent by none: missing');
    const route = { entry: 'entry:api:http:GET:/a', reads: [], complete: true, next: ['check_contract({from: "x", to: "y"})'] };
    expect(settledAnswer('check_contract', route)).toBe(route);
    const unchecked = { edge: { from: 'a', to: 'b' }, status: 'unchecked', findings: [] };
    expect(settledAnswer('check_contract', unchecked)).toBe(unchecked);
  });

  it('settles who_consumes of a type', () => {
    const answer = settledAnswer('who_consumes', { consumers: [{ id: 'consumer:a' }], total: 1, type: 'ORDER_READY', complete: true }) as Record<string, unknown>;
    expect(answer['settled']).toBe('1 consumer of ORDER_READY, all listed');
  });

  it('says a route aloud', () => {
    expect(routeAloud('entry:shop:http:POST:/orders/:param')).toBe('POST /orders/:param (shop)');
    expect(routeAloud('entry:web@admin:screen:/floor')).toBe('screen /floor (web)');
    expect(routeAloud('channel:x')).toBe('channel:x');
  });

  const rows = (count: number) => Array.from({ length: count }, (_, at) => ({ id: `entry:api:http:GET:/route/${at}`, note: 'x'.repeat(200) }));

  it('cuts the longest list of an answer past its size, with the next page as the call for the rest', () => {
    const answer = { entries: rows(300), total: 300, complete: true, next: ['get_flow({entry: "a"})'] };
    const capped = cappedAnswer(answer, { tool: 'list_entries', args: { maxNodes: 300 }, paged: true }) as typeof answer & { nextOffset: number; left: string[] };
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
    expect(capped.entries.length).toBeGreaterThan(10);
    expect(capped.entries[0]).toEqual(answer.entries[0]);
    expect(capped.complete).toBe(false);
    expect(capped.nextOffset).toBe(capped.entries.length);
    expect(capped.left).toEqual([`cap: entries ${capped.entries.length} of 300 rows, the answer held to ${MAX_ANSWER_CHARS} characters`]);
    expect(capped.next).toEqual([`list_entries({maxNodes: 300, offset: ${capped.entries.length}})`]);
  });

  it('answers verbose past its size with the compact call, and a tool with no pages with a narrower question', () => {
    const answer = { consumers: rows(200), total: 200 };
    const verbose = cappedAnswer(answer, { tool: 'who_consumes', args: { channel: 'c', verbose: true, detail: 2 }, paged: false }) as Record<string, unknown>;
    expect(verbose['next']).toEqual(['who_consumes({channel: "c", detail: 2})']);
    const plain = cappedAnswer(answer, { tool: 'who_consumes', args: { channel: 'c' }, paged: false }) as Record<string, unknown>;
    expect(plain['next']).toBeUndefined();
    expect(plain['left']).toContain('cap: ask a narrower question (a service, a type, a field) for the rest');
  });

  it('leaves an answer within its size as it is', () => {
    const answer = { entries: rows(3), total: 3, complete: true };
    expect(cappedAnswer(answer, { tool: 'list_entries', args: {}, paged: true })).toBe(answer);
  });

  it("searches a maybe's method by its call where another shares its name", () => {
    const shared = (repo: string, name: string) => repo === 'web' && name === 'start';
    expect(confirmOf({ label: 'Timer.start', repo: 'web', type: 'method' }, shared)).toEqual({ grep: '.start(', repo: 'web' });
    expect(confirmOf({ label: 'Timer.stopAll', repo: 'web', type: 'method' }, shared)).toEqual({ grep: 'stopAll', repo: 'web' });
    expect(confirmOf({ label: 'start', repo: 'web', type: 'function' }, shared)).toEqual({ grep: 'start', repo: 'web' });
  });

  it('says in the instructions that a settled answer is whole', () => {
    expect(INSTRUCTIONS).toContain('`settled` or `complete: true` is the whole answer: stop');
  });
});
