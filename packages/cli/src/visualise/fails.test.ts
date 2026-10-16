import type { GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { packFails } from './fails.js';

const nodes: GraphNode[] = [
  {
    id: 'entry:api:http:GET:/orders/:param',
    type: 'entry',
    kind: 'http',
    label: 'GET /orders/:param',
    repo: 'api',
    meta: {
      fails: [
        { status: 404, exception: 'NotFoundException', at: 'api#src/orders.service.ts:OrdersService.findOne', file: 'src/orders.service.ts', line: 9, source: 'throw' },
        { exception: 'RpcException', at: 'api#src/stock.ts:check', source: 'throw' },
      ],
    },
  },
  { id: 'api#src/orders.service.ts:OrdersService.findOne', type: 'method', label: 'OrdersService.findOne', repo: 'api' },
  { id: 'entry:api:http:GET:/health', type: 'entry', kind: 'http', label: 'GET /health', repo: 'api' },
];

describe('packing what each way in can fail with (P68)', () => {
  const position = new Map(nodes.map((node, index) => [node.id, index]));

  it('keys each entry by position and points at the node a failure is written in', () => {
    expect(packFails(nodes, position)).toEqual({
      0: [
        { s: 404, x: 'NotFoundException', at: 1, f: 'src/orders.service.ts', l: 9, src: 'throw' },
        { x: 'RpcException', at: -1, id: 'api#src/stock.ts:check', src: 'throw' },
      ],
    });
  });

  it('ships nothing when no entry says', () => {
    expect(packFails(nodes.slice(1), new Map())).toBeUndefined();
  });
});
