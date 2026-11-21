import { describe, expect, it } from 'vitest';
import { compactAnswer, compactNext, compactOutputSchema, isIdTail, locBeside, serviceOfId } from './compact.js';

describe('compact answers (P365)', () => {
  it('reads the service an id names by the id grammar, and none from a channel', () => {
    expect(serviceOfId('orders#src/orders/orders.service.ts:OrdersService.findOne')).toBe('orders');
    expect(serviceOfId('consumer:notify-worker#src/handlers/notices.ts:Notices.digest')).toBe('notify-worker');
    expect(serviceOfId('entry:gateway:http:GET:/orders/:param')).toBe('gateway');
    expect(serviceOfId('entry:shop@admin:screen:/orders')).toBe('shop');
    expect(serviceOfId('gap:orders|src/orders/orders.service.ts|unknown-base-url-env')).toBe('orders');
    expect(serviceOfId('type:web#OrderDto')).toBe('web');
    expect(serviceOfId('channel:order.created')).toBeUndefined();
    expect(serviceOfId('channel:space:*:events#MEMBER_JOINED')).toBeUndefined();
    expect(serviceOfId('cron:nightly')).toBeUndefined();
  });

  it('takes a label for the id only when it is the id or its tail after a separator', () => {
    expect(isIdTail('consumer:a#src/x.ts:Notices.digest', 'Notices.digest')).toBe(true);
    expect(isIdTail('channel:order.created', 'order.created')).toBe(true);
    expect(isIdTail('entry:gateway:http:GET:/orders', 'GET /orders')).toBe(false);
    expect(isIdTail('a#src/x.ts:Notices.digest', 'ices.digest')).toBe(false);
  });

  it('says what is left of loc once the id holds its file', () => {
    expect(locBeside('orders#src/orders.ts:Orders.find', 'src/orders.ts:31')).toEqual({ line: 31 });
    expect(locBeside('gap:orders|src/orders.ts|why', 'src/orders.ts:7')).toEqual({ line: 7 });
    // The id holds the line too: nothing is left.
    expect(locBeside('http_out:web#src/api.ts:21:12', 'src/api.ts:21')).toBeUndefined();
    expect(locBeside('orders#src/orders.ts:Orders.find', 'src/orders.ts')).toBeUndefined();
    // A file the id does not hold, or holds only as part of a longer name, stays.
    expect(locBeside('channel:order.created', 'src/orders.ts:16')).toEqual({ loc: 'src/orders.ts:16' });
    expect(locBeside('orders#src/orders.ts.bak:Orders.find', 'src/orders.ts:3')).toEqual({ loc: 'src/orders.ts:3' });
  });

  it('keeps the paging call alone when a list was cut, and two calls otherwise', () => {
    const next = ['list_entries({offset: 3})', 'get_flow({entry: "a"})', 'get_flow({entry: "b"})'];
    expect(compactNext(next, 3)).toEqual(['list_entries({offset: 3})']);
    expect(compactNext(next, undefined)).toEqual(next.slice(0, 2));
  });

  it('drops from each row what its id says, and repeats in meta, and keeps everything else', () => {
    const answer = {
      channel: {
        id: 'channel:space:*:events',
        type: 'channel',
        label: 'space:*:events',
        loc: 'src/spaces/spaces.service.ts:16',
        service: 'docs-api',
        meta: { channelKind: 'channel', producers: 4 },
      },
      consumers: [
        {
          id: 'consumer:worker#src/handlers/notices.ts:Notices.digest',
          type: 'consumer',
          label: 'Notices.digest',
          loc: 'src/handlers/notices.ts:12',
          service: 'worker',
          kind: 'sse',
          meta: { kind: 'sse', selectedBy: 'consumer:worker#src/handlers/notices.ts:Notices.route', messageTypes: ['A'] },
          selectedIn: 'Notices.route',
          via: 'switch',
          guards: [],
          ref: null,
          ignored: false,
          // Fields a later answer adds pass whole.
          reach: 'alive',
          from: 'screen /notices',
          complete: false,
        },
      ],
      total: 1,
      unread: [],
      dead: false,
      next: ['who_emits({channel: "x"})', 'who_calls({symbol: "y"})', 'impact({symbol: "y"})'],
    };
    expect(compactAnswer(answer)).toEqual({
      channel: {
        id: 'channel:space:*:events',
        // A channel's id names no service and no file: both stay.
        loc: 'src/spaces/spaces.service.ts:16',
        service: 'docs-api',
        meta: { channelKind: 'channel', producers: 4 },
      },
      consumers: [
        {
          id: 'consumer:worker#src/handlers/notices.ts:Notices.digest',
          line: 12,
          kind: 'sse',
          meta: { selectedBy: 'consumer:worker#src/handlers/notices.ts:Notices.route', messageTypes: ['A'] },
          via: 'switch',
          reach: 'alive',
          from: 'screen /notices',
          complete: false,
        },
      ],
      total: 1,
      // The answer's own empty list and false are the answer.
      unread: [],
      dead: false,
      next: ['who_emits({channel: "x"})', 'who_calls({symbol: "y"})'],
    });
  });

  it('keeps a type and a label the id does not say', () => {
    // A method is the id's `Class.member`; a function or a class is not told by its id.
    const method = { id: 'orders#src/orders.ts:Orders.find', type: 'method', label: 'find()' };
    const fn = { id: 'orders#src/orders.ts:find', type: 'function', label: 'find' };
    expect(compactAnswer({ rows: [method, fn] })).toEqual({ rows: [{ id: method.id, label: 'find()' }, { id: fn.id, type: 'function' }] });
    // A way in's label said aloud, and its kind, are in its id; a request's label is not.
    const entry = { id: 'entry:gateway:http:GET:/orders', type: 'entry', label: 'GET /orders', service: 'gateway', kind: 'http' };
    const request = { id: 'http_out:web#src/api.ts:21:12', type: 'http_out', label: 'GET /orders', kind: 'fetch' };
    expect(compactAnswer({ entry, request })).toEqual({ entry: { id: entry.id }, request: { id: request.id, label: 'GET /orders', kind: 'fetch' } });
  });

  it('drops from meta the parts of the id and the words of the label, and a field naming the row it is under', () => {
    const entry = {
      id: 'entry:shop:http:GET:/orders/:param',
      meta: { method: 'GET', path: '/orders/:param', rawPath: '/orders/:id', channelKind: 'entry' },
    };
    const request = {
      id: 'http_out:web#src/api.ts:21:12',
      label: 'GET /orders/:param',
      meta: { method: 'GET', path: '/orders/:param', baseUrlEnv: 'SHOP_URL', selects: [{ type: 'A', consumer: 'http_out:web#src/api.ts:21:12', line: 4 }] },
    };
    expect(compactAnswer({ entry, request })).toEqual({
      // `entry` is the id's kind, not a value it holds.
      entry: { id: entry.id, meta: { rawPath: '/orders/:id', channelKind: 'entry' } },
      request: { id: request.id, label: request.label, meta: { baseUrlEnv: 'SHOP_URL', selects: [{ type: 'A', line: 4 }] } },
    });
  });

  it('reads a gap by its gapId too: service, file and reason are in it', () => {
    const gap = {
      id: 'http_out:web#src/api.ts:44:12',
      gapId: 'gap:web|src/api.ts|target-route-not-found',
      type: 'gap',
      reason: 'target-route-not-found',
      service: 'web',
      loc: 'src/api.ts:44',
      message: 'target service shop has no route POST /orders',
    };
    expect(compactAnswer({ gaps: [gap] })).toEqual({
      gaps: [{ id: gap.id, gapId: gap.gapId, message: gap.message }],
    });
  });

  it('lists output schemas a compact answer fits: nothing required, line beside loc', () => {
    const schema = {
      type: 'object',
      properties: {
        node: { $ref: '#/$defs/Node' },
        required: { type: 'boolean' },
      },
      required: ['node', 'required'],
      additionalProperties: false,
      $defs: {
        Node: {
          type: 'object',
          properties: { id: { type: 'string' }, loc: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
      },
    };
    expect(compactOutputSchema(schema)).toEqual({
      type: 'object',
      properties: { node: { $ref: '#/$defs/Node' }, required: { type: 'boolean' } },
      additionalProperties: false,
      $defs: {
        Node: {
          type: 'object',
          properties: { id: { type: 'string' }, loc: { type: 'string' }, line: { type: 'integer' } },
          additionalProperties: false,
        },
      },
    });
  });
});
