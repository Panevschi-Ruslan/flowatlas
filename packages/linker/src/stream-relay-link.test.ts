import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { edgeKey } from './order.js';
import { joinStreamRelays } from './stream-relay-link.js';

const ROUTE = 'entry:api:http:GET:/spaces/:param/events';
const QUIET = 'entry:api:http:GET:/rooms/:param/stream';
const SEEN = 'entry:api:http:GET:/audit';
const CHANNEL = 'channel:space:*:events';
const RELAY = 'consumer:api#src/live.ts:Live.events';
const CALL = 'ui_api_call:web#src/useLive.ts:4:20';
const ROOM_CALL = 'ui_api_call:web#src/room.ts:2:18';
const AUDIT_CALL = 'ui_api_call:web#src/audit.ts:2:18';
const SCREEN = 'consumer:web#src/Board.tsx:handleEvent';

const graph = (): { nodes: Map<string, GraphNode>; edges: Map<string, GraphEdge> } => {
  const nodes: GraphNode[] = [
    { id: ROUTE, type: 'entry', kind: 'http', label: 'GET /spaces/:param/events', repo: 'api', file: 'src/live.ts', line: 10, meta: { stream: 'sse' } },
    { id: QUIET, type: 'entry', kind: 'http', label: 'GET /rooms/:param/stream', repo: 'api', file: 'src/worker.ts', line: 20 },
    { id: SEEN, type: 'entry', kind: 'http', label: 'GET /audit', repo: 'api', file: 'src/live.ts', line: 30, meta: { stream: 'sse' } },
    { id: CHANNEL, type: 'channel', label: 'space:*:events', repo: 'api' },
    { id: RELAY, type: 'consumer', kind: 'sse', label: 'Live.events', repo: 'api', meta: { relay: ROUTE } },
    { id: CALL, type: 'ui_api_call', kind: 'sse', label: 'GET /spaces/:param/events', repo: 'web' },
    { id: ROOM_CALL, type: 'ui_api_call', kind: 'sse', label: 'GET /rooms/:param/stream', repo: 'web' },
    { id: AUDIT_CALL, type: 'ui_api_call', kind: 'sse', label: 'GET /audit', repo: 'web' },
    { id: SCREEN, type: 'consumer', kind: 'sse', label: 'handleEvent', repo: 'web', meta: { entryId: null } },
  ];
  const edges: GraphEdge[] = [
    { from: CHANNEL, to: RELAY, type: 'consumes', confidence: 'static', file: 'src/live.ts', line: 12 },
    { from: CALL, to: ROUTE, type: 'hits', confidence: 'static' },
    { from: CALL, to: SCREEN, type: 'triggers', confidence: 'heuristic', file: 'src/useLive.ts', line: 5 },
    { from: ROOM_CALL, to: QUIET, type: 'hits', confidence: 'static' },
    { from: AUDIT_CALL, to: SEEN, type: 'hits', confidence: 'static' },
  ];
  return { nodes: new Map(nodes.map((node) => [node.id, node])), edges: new Map(edges.map((edge) => [edgeKey(edge), edge])) };
};

describe('channels handed on through a stream (P359)', () => {
  it('makes each screen fed by a relaying route a consumer of the channel, at the weakest link', () => {
    const { nodes, edges } = graph();
    joinStreamRelays(nodes, edges);
    expect(edges.get(`${CHANNEL} consumes ${SCREEN}`)).toEqual({
      from: CHANNEL,
      to: SCREEN,
      type: 'consumes',
      confidence: 'heuristic',
      file: 'src/useLive.ts',
      line: 5,
      meta: { via: 'sse', route: ROUTE, call: CALL },
    });
    expect(nodes.get(SCREEN)?.meta?.['routes']).toEqual([ROUTE]);
  });

  it('says so on a route a browser holds open that relays nothing read, once, unless its reader already did', () => {
    const { nodes, edges } = graph();
    const rows = joinStreamRelays(nodes, edges);
    expect(rows.map((row) => [row.service, row.file, row.line, row.reason, row.level])).toEqual([['api', 'src/worker.ts', 20, 'stream-relay-unread', 'info']]);
  });

  it('draws nothing twice when run over its own answer', () => {
    const { nodes, edges } = graph();
    joinStreamRelays(nodes, edges);
    const before = edges.size;
    joinStreamRelays(nodes, edges);
    expect(edges.size).toBe(before);
  });
});

describe('a route handed to a per-scope object whose class is not read (P361)', () => {
  it('names the object and why, where a browser holds the route open', () => {
    const { nodes, edges } = graph();
    const quiet = nodes.get(QUIET) as GraphNode;
    quiet.meta = { handedTo: [{ binding: 'ROOMS', method: 'fetch', why: 'wrangler.jsonc binds ROOMS to the class Room, which this repository does not declare', hint: 'Export Room.' }] };
    const [row] = joinStreamRelays(nodes, edges);
    expect(row).toMatchObject({ file: 'src/worker.ts', line: 20, reason: 'stream-relay-unread', hint: 'Export Room.' });
    expect(row?.message).toContain('hands its request to a per-scope object whose class is not read: wrangler.jsonc binds ROOMS');
  });
});
