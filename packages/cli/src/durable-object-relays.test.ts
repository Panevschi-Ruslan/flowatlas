import { resolve } from 'node:path';
import type { GraphNode, RepoGraph } from '@flowatlas/core';
import { extractRepo } from '@flowatlas/extractor-nestjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRegistry, EXTRA_PASSES } from './build/extractor.js';

/**
 * The server half of P361, read with every pass the build runs: a route that
 * hands its request to a per-scope object (a Durable Object's stub) is read
 * into the class the object is made of, and relays what that class's code
 * subscribes to, or what it holds open and writes to as a hub.
 */
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/sse-durable-objects');

const read = (service: string): Promise<RepoGraph> =>
  extractRepo({ rootDir: resolve(FIXTURE, service), repo: service, registry: createRegistry(), extraPasses: EXTRA_PASSES, noTypes: true });

let gateway: RepoGraph;
let digest: RepoGraph;

beforeAll(async () => {
  [gateway, digest] = await Promise.all([read('gateway'), read('digest-worker')]);
}, 120_000);

const relaysOf = (route: string, graph: RepoGraph = gateway): string[] => {
  const relays = graph.nodes.filter((node) => node.type === 'consumer' && node.meta?.['relay'] === route);
  return graph.edges
    .filter((each) => each.type === 'consumes' && relays.some((relay) => relay.id === each.to))
    .map((each) => each.from)
    .sort();
};

const node = (id: string): GraphNode | undefined => gateway.nodes.find((each) => each.id === id);

describe('routes handing their request to a per-scope object (P361)', () => {
  it('follows a stub made from an id into the class the configuration binds, and the branch of its fetch the path takes', () => {
    const id = 'entry:gateway:http:GET:/boards/:param/activity';
    expect(node(id)?.meta).toMatchObject({
      stream: 'sse',
      streamFrom: 'content-type',
      servedBy: [{ class: 'BoardFeed', binding: 'BOARD_FEEDS', method: 'fetch', via: 'config' }],
    });
    expect(relaysOf(id)).toEqual(['channel:board:*:activity']);
  });

  it('reads a subscription the object opens in its constructor, where it feeds the streams the object holds', () => {
    const id = 'entry:gateway:http:GET:/alerts/stream';
    expect(relaysOf(id)).toEqual(['channel:alerts:global']);
    expect(node('channel:durable-object:AlertsRelay')).toBeUndefined();
  });

  it('makes an object that holds the streams and is written to through its stub the hub of a channel of its own', () => {
    const id = 'entry:gateway:http:GET:/boards/:param/presence';
    expect(node(id)?.meta).toMatchObject({ servedBy: [{ class: 'PresenceHub', binding: 'PRESENCE', method: 'fetch', via: 'type' }] });
    expect(relaysOf(id)).toEqual(['channel:durable-object:PresenceHub']);
    const producers = gateway.edges.filter((each) => each.type === 'emits' && each.to === 'channel:durable-object:PresenceHub');
    const methods = producers.map((each) => node(each.from)?.meta?.['method']).sort();
    expect(methods).toEqual(['announce', 'fetch']);
    // The routes that write to the hub are not streams themselves.
    expect(node('entry:gateway:http:POST:/boards/:param/presence/leave')?.meta?.['stream']).toBeUndefined();
    expect(node('entry:gateway:http:POST:/boards/:param/presence')?.meta?.['stream']).toBeUndefined();
  });

  it('says why an object whose class is not read was not followed', () => {
    expect(node('entry:gateway:http:GET:/boards/:param/archive')?.meta?.['handedTo']).toMatchObject([
      { binding: 'ARCHIVE', why: expect.stringContaining('ArchiveFeed, which this repository does not declare') },
    ]);
    expect(node('entry:gateway:http:GET:/ledger/stream')?.meta?.['handedTo']).toMatchObject([
      { binding: 'LEDGER', why: expect.stringContaining('of the worker ledger-worker') },
    ]);
  });

  it('reads a plain worker\'s branch that hands a stream to an object as a GET route of the path its test names', () => {
    const exact = 'entry:digest-worker:http:GET:/digest/stream';
    const pattern = 'entry:digest-worker:http:GET:/teams/:param/feed';
    expect(digest.nodes.find((each) => each.id === exact)?.meta).toMatchObject({ adapter: 'worker-fetch', stream: 'sse', servedBy: [{ class: 'DigestFeed' }] });
    expect(relaysOf(exact, digest)).toEqual(['channel:digest:daily']);
    expect(relaysOf(pattern, digest)).toEqual(['channel:team:*:feed']);
    const unnamed = digest.unresolved.filter((row) => row.reason === 'route-path-dynamic');
    expect(unnamed.map((row) => [row.file, row.line])).toEqual([['src/worker.ts', 24]]);
  });
});
