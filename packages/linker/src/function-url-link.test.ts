import { ENVIRONMENT_META, type EnvironmentValue, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { functionUrlsOf } from './function-url-link.js';
import { edgeKey } from './order.js';

const url = (fn: string): GraphNode => ({
  id: `entry:lending:http:ALL:/*#${fn}`,
  type: 'entry',
  kind: 'http',
  label: 'ALL /*',
  repo: 'lending',
  meta: { by: 'function-url', function: fn },
});

const runner = (name: string, environment: Record<string, EnvironmentValue>): GraphNode => ({
  id: `entry:lending:invoke:${name}`,
  type: 'entry',
  kind: 'invoke',
  label: name,
  repo: 'lending',
  meta: { name, [ENVIRONMENT_META]: environment },
});

const call: GraphNode = { id: 'http_out:lending#src/kiosk.ts:5:22', type: 'http_out', label: 'GET /cards', repo: 'lending', meta: { baseUrlEnv: 'CARD_LOOKUP_URL', path: '/cards' } };

const graph = (functions: GraphNode[], targets: GraphNode[]) => {
  const handler: GraphNode = { id: 'lending#src/kiosk.ts:handler', type: 'function', label: 'handler', repo: 'lending' };
  const nodes = new Map([...functions, ...targets, handler, call].map((node) => [node.id, node]));
  const list: GraphEdge[] = [
    ...functions.map((fn): GraphEdge => ({ from: fn.id, to: handler.id, type: 'handles', confidence: 'static' })),
    { from: handler.id, to: call.id, type: 'calls', confidence: 'static' },
  ];
  return functionUrlsOf(nodes, new Map(list.map((edge) => [edgeKey(edge), edge])));
};

const setTo = (fn: string, kind = 'url'): EnvironmentValue => ({ written: 'module.card_lookup_url.url', value: fn, kind });

describe('functionUrlsOf', () => {
  it('finds the URL entry of the function the setting names, through the function running the call', () => {
    const found = graph([runner('library-kiosk', { CARD_LOOKUP_URL: setTo('library-card-lookup') })], [url('library-card-lookup'), url('library-other')]);
    expect(found.get(call.id)?.map((entry) => entry.id)).toEqual(['entry:lending:http:ALL:/*#library-card-lookup']);
  });

  it('reaches one URL per function where two functions set the setting differently', () => {
    const found = graph(
      [runner('library-kiosk', { CARD_LOOKUP_URL: setTo('library-card-lookup') }), runner('library-desk', { CARD_LOOKUP_URL: setTo('library-other') })],
      [url('library-card-lookup'), url('library-other')],
    );
    expect(found.get(call.id)?.map((entry) => entry.meta?.['function'])).toEqual(['library-card-lookup', 'library-other']);
  });

  it('joins nothing where the setting is not a function URL or names a function with none', () => {
    expect(graph([runner('library-kiosk', { CARD_LOOKUP_URL: setTo('library-card-lookup', 'queue') })], [url('library-card-lookup')]).size).toBe(0);
    expect(graph([runner('library-kiosk', { CARD_LOOKUP_URL: setTo('library-missing') })], [url('library-card-lookup')]).size).toBe(0);
    expect(graph([runner('library-kiosk', {})], [url('library-card-lookup')]).size).toBe(0);
  });
});
