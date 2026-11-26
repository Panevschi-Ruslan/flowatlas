import { resolve } from 'node:path';
import type { GraphNode, RepoGraph } from '@flowatlas/core';
import { extractRepo } from '@flowatlas/extractor-nestjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRegistry, EXTRA_PASSES } from './build/extractor.js';

/**
 * The server half of P359, read with every pass the build runs: a route whose
 * handler streams server-sent events is a consumer of each channel the code
 * behind it subscribes to, marked with the route it relays to.
 */
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/sse-relay-channels');

const read = (service: string): Promise<RepoGraph> =>
  extractRepo({ rootDir: resolve(FIXTURE, service), repo: service, registry: createRegistry(), extraPasses: EXTRA_PASSES, noTypes: true });

let shipping: RepoGraph;
let edge: RepoGraph;

beforeAll(async () => {
  [shipping, edge] = await Promise.all([read('shipping'), read('edge')]);
}, 120_000);

const relaysOf = (graph: RepoGraph, route: string): string[] => {
  const relays = graph.nodes.filter((node) => node.type === 'consumer' && node.meta?.['relay'] === route);
  return graph.edges
    .filter((each) => each.type === 'consumes' && relays.some((relay) => relay.id === each.to))
    .map((each) => each.from)
    .sort();
};

const route = (graph: RepoGraph, id: string): GraphNode | undefined => graph.nodes.find((node) => node.id === id);

describe('routes relaying a channel onto a stream (P359)', () => {
  it('reads Nest\'s stream decorator alone as a GET route, and the subscription written in its handler', () => {
    const id = 'entry:shipping:http:GET:/workspaces/:param/events';
    expect(route(shipping, id)?.meta).toMatchObject({ stream: 'sse', streamFrom: 'decorator', relays: ['channel:workspace:*:events'] });
    expect(relaysOf(shipping, id)).toEqual(['channel:workspace:*:events']);
  });

  it('reads a channel handed to a helper of the project at the route that hands it', () => {
    expect(relaysOf(shipping, 'entry:shipping:http:GET:/workspaces/:param/warehouses/:param/packing')).toEqual(['channel:warehouse:*:parcels']);
  });

  it('reads a worker\'s stream helper, and a helper written as a function', () => {
    const id = 'entry:edge:http:GET:/live/:param';
    expect(route(edge, id)?.meta).toMatchObject({ stream: 'sse', streamFrom: 'helper' });
    expect(relaysOf(edge, id)).toEqual(['channel:workspace:*:events']);
  });

  it('says so on a stream with no subscription behind it, and reads nothing as a stream that is not one', () => {
    const audit = shipping.unresolved.filter((row) => row.reason === 'stream-relay-unread');
    expect(audit.map((row) => [row.file, row.line])).toEqual([['src/live/live.controller.ts', 34]]);
    expect(route(edge, 'entry:edge:http:GET:/rooms/:param/stream')?.meta?.['stream']).toBeUndefined();
    expect(route(shipping, 'entry:shipping:http:POST:/workspaces/:param/parcels/:param/packed')?.meta?.['stream']).toBeUndefined();
  });
});
