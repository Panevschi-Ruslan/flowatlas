import { describe, expect, it } from 'vitest';
import { compactAnswer } from './compact.js';
import { settledAnswer } from './settled.js';
import { flowWithin } from './tools/flow.js';

/**
 * P404: answers that settle themselves. A type no code compares is settled
 * by where its name is written; a flow says where its requests land first,
 * a cut elsewhere leaving that settled; the places a type may still be
 * chosen are counted, not listed, in a compact answer.
 */
describe('answers that settle themselves', () => {
  it('settles a type nothing selects where its name rules every place out, and says it once', () => {
    const said = 'no code compares ROW_CLAIMED: its name is written only where it is sent, at src/rows.ts:17 in api';
    const answer = settledAnswer('who_consumes', {
      channel: { id: 'channel:venue_events' },
      consumers: [],
      total: 0,
      type: 'ROW_CLAIMED',
      unselected: said,
      sureness: 'sure',
      complete: true,
      next: ['who_emits({channel: "channel:venue_events", type: "ROW_CLAIMED"})'],
    }) as Record<string, unknown>;
    expect(answer['settled']).toBe(said);
    expect(answer['unselected']).toBeUndefined();
    expect(answer['sureness']).toBeUndefined();
    expect(answer['next']).toBeUndefined();
  });

  it('settles where a flow\'s request lands, whatever else the walk cut, unless an unread step is on its way', () => {
    const requests = [{ route: 'entry:rooms-api:http:GET:/api/admin/:param/rooms/free-times', by: 'rooms-api#src/rooms.controller.ts:RoomsController.freeTimes' }];
    const off = settledAnswer('get_flow', {
      requests,
      root: { node: { id: 'bot#src/room.service.ts:RoomService.getFreeTimes' }, children: [] },
      complete: false,
      left: ["unread: 1 step on the path could not be followed: event staff_feed (message-type-unselected), off every request's way"],
      next: ['impact({symbol: "x"})'],
    }) as Record<string, unknown>;
    expect(off['settled']).toBe('the request lands on GET /api/admin/:param/rooms/free-times (rooms-api), RoomsController.freeTimes');
    expect(off['next']).toBeUndefined();
    expect(off['complete']).toBe(false);
    const deep = { requests, complete: false, left: ['depth: 4 more rows past depth 8'] };
    expect(settledAnswer('get_flow', deep)).toBe(deep);
    const on = { requests, complete: false, left: ["unread: 1 step on the path could not be followed: Api.load, on a request's way"] };
    expect(settledAnswer('get_flow', on)).toBe(on);
    const unjoined = { requests: [{ unjoined: 'GET /x' }], complete: true };
    expect(settledAnswer('get_flow', unjoined)).toBe(unjoined);
  });

  it('cuts a flow past its size by its deepest rows, never its requests', () => {
    const leaf = (id: number) => ({ node: { id: `svc#a.ts:A.m${id}`, label: 'x'.repeat(300) }, children: [] });
    const deep = { node: { id: 'svc#a.ts:A.deep' }, children: Array.from({ length: 40 }, (_, index) => leaf(index)) };
    const answer = flowWithin({ requests: [{ route: 'entry:a:http:GET:/x' }], root: { node: { id: 'svc#a.ts:A.root' }, children: [deep] } as never, complete: true }, 4000);
    expect(JSON.stringify(answer).length).toBeLessThanOrEqual(4000);
    expect(answer['requests']).toEqual([{ route: 'entry:a:http:GET:/x' }]);
    expect(answer['complete']).toBe(false);
    expect(answer['left']).toEqual(['cap: 40 rows deeper than 1 steps cut, the answer held to 4000 characters; requests lists every request']);
  });

  it('leaves the places a type may still be chosen to a verbose answer, counted in left', () => {
    const answer = compactAnswer(
      {
        consumers: [],
        total: 0,
        selectionUnread: [{ loc: 'src/board.ts:9', service: 'worker', why: 'TABLE_FREED is written here' }],
        complete: false,
        left: ['unsure: 1 place may still choose TABLE_FREED, the first src/board.ts:9'],
      },
      { tool: 'who_consumes' },
    ) as Record<string, unknown>;
    expect(answer['selectionUnread']).toBeUndefined();
    expect(answer['left']).toEqual(['unsure: 1 place may still choose TABLE_FREED, the first src/board.ts:9']);
  });
});
