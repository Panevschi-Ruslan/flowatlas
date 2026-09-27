import { describe, expect, it } from 'vitest';
import { redisPubSub, socketio } from './adapters/index.js';
import { methodMatches } from './call-site.js';
import { shapeChannelNames, trimEndpoint } from './channel-name.js';

describe('the endpoint a class declares', () => {
  it('reads the same namespace however the slashes were written', () => {
    expect(trimEndpoint('orders')).toBe('orders');
    expect(trimEndpoint('/orders')).toBe('orders');
    expect(trimEndpoint('/orders/')).toBe('orders');
  });

  it('puts every name the call wrote under the endpoint', () => {
    const names = shapeChannelNames(['order:opened', 'order:closed'], {
      prefix: 'orders',
      separator: '/',
    });
    expect(names).toEqual(['orders/order:opened', 'orders/order:closed']);
  });

  // The root namespace is the absence of one, so the name is the whole address.
  it('leaves a name alone when no endpoint was declared', () => {
    expect(shapeChannelNames(['order:updated'], { prefix: '', separator: '/' })).toEqual([
      'order:updated',
    ]);
    expect(shapeChannelNames(['order:updated'])).toEqual(['order:updated']);
  });

  // Two endpoints are two connections, and the same event on each is two
  // channels; collapsing them would join services that never speak.
  it('keeps the same event under two endpoints apart', () => {
    const here = shapeChannelNames(['order:updated'], { prefix: 'orders', separator: '/' });
    const there = shapeChannelNames(['order:updated'], { prefix: 'audit', separator: '/' });
    expect(here).not.toEqual(there);
  });
});

describe('names a transport keeps for itself', () => {
  it('drops the library signalling to itself rather than drawing it', () => {
    expect(
      shapeChannelNames(['connect', 'disconnect'], { reserved: socketio.reservedChannels }),
    ).toEqual([]);
  });

  it('keeps an application event that sits beside them', () => {
    expect(
      shapeChannelNames(['connect', 'order:updated'], {
        prefix: 'orders',
        separator: '/',
        reserved: socketio.reservedChannels,
      }),
    ).toEqual(['orders/order:updated']);
  });
});

describe('the socket description', () => {
  // The whole claim of the ticket: one description, two repositories.
  it('recognises a repository at either end of the wire', () => {
    expect(socketio.detect({ dependencies: { 'socket.io-client': '^4.8.0' } })).toBe(true);
    expect(socketio.detect({ dependencies: { '@nestjs/websockets': '^11.0.0' } })).toBe(true);
    expect(socketio.detect({ dependencies: { ws: '^8.0.0' } })).toBe(false);
  });

  it('calls a publish with an acknowledgement something other than a publish', () => {
    expect(socketio.acknowledgedKind).toBe('rpc');
    expect(socketio.producerPatterns[0]?.kind).toBe('event');
  });

  // A handler answering is decided at the call site, and the decorator that
  // marks one is the same either way, so this end stays an event.
  it('says nothing about whether a handler answers', () => {
    expect(socketio.consumerPatterns.every((pattern) => pattern.kind === 'event')).toBe(true);
  });
});

describe('the subscription verbs of a pub/sub transport', () => {
  const methodsOf = (pattern: { method: string | readonly string[] }): readonly string[] =>
    typeof pattern.method === 'string' ? [pattern.method] : pattern.method;
  const spellings = (redisPubSub.subscriberPatterns ?? []).flatMap(methodsOf);

  // The bug this replaced: two of these five were in the description, and the
  // client that writes the other three had its subscriptions read by nothing.
  it('names every spelling both clients of it write', () => {
    expect(spellings).toEqual([
      'subscribe',
      'psubscribe',
      'pSubscribe',
      'ssubscribe',
      'sSubscribe',
    ]);
  });

  // What arrives is delivered on an event named after the same prefix, so the
  // two halves of one verb cannot drift apart.
  it('pairs each verb with the event that carries what arrives', () => {
    expect((redisPubSub.subscriberPatterns ?? []).map((pattern) => pattern.listenerEvent)).toEqual([
      'message',
      'pmessage',
      'smessage',
    ]);
  });

  it('reads a call by any spelling the description names', () => {
    expect(methodMatches('pSubscribe', ['psubscribe', 'pSubscribe'])).toBe(true);
    expect(methodMatches('subscribe', 'subscribe')).toBe(true);
    // A name the description does not hold is still not a match: the reader
    // knows no casing rule of its own.
    expect(methodMatches('PSUBSCRIBE', ['psubscribe', 'pSubscribe'])).toBe(false);
  });
});
