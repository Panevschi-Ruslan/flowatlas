import type { GraphNode } from '@flowatlas/core';
import type { AnchoredUnresolvedRow, LinkReport } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { packGraph } from './pack.js';

const report = {
  httpOut: {},
  channels: {},
  routes: { total: 0, called: 0, duplicated: 0 },
  types: {},
  totals: {},
  services: [],
} as unknown as LinkReport;

const nodes: GraphNode[] = [
  { id: 'entry:api:http:GET:/orders', type: 'entry', kind: 'http', label: 'GET /orders', repo: 'api', file: 'src/orders.controller.ts', line: 10 },
  { id: 'api#src/orders.controller.ts:OrdersController.list', type: 'method', label: 'OrdersController.list', repo: 'api', file: 'src/orders.controller.ts', line: 11 },
];

const rows: AnchoredUnresolvedRow[] = [
  {
    node: 'OrdersController.list -> this.mail.send',
    service: 'api',
    file: 'src/orders.controller.ts',
    line: 12,
    reason: 'call-dynamic-receiver',
    level: 'info',
    sites: 3,
    message: 'm',
    hint: null,
    meta: {
      causes: [
        {
          cause: 'module-not-installed',
          package: '@shop/mailer',
          sites: 2,
          samples: [{ file: 'src/orders.controller.ts', line: 12, symbol: 'OrdersController.list -> this.mail.send' }],
        },
        { cause: 'dynamic-member', sites: 1, samples: [{ file: 'src/orders.controller.ts', line: 14 }] },
      ],
    },
  },
  {
    node: 'Receipt',
    service: 'api',
    file: 'src/orders.repo.ts',
    line: 3,
    reason: 'type-unresolved',
    level: 'action',
    sites: 1,
    message: 'm',
    hint: null,
    meta: { cause: 'module-not-installed', package: '@shop/mailer' },
  },
];

const pack = (accepted?: Parameters<typeof packGraph>[0]['accepted']) =>
  packGraph({
    builtAt: '2026-10-08T00:00:00.000Z',
    nodes,
    edges: [],
    unresolved: rows,
    report,
    ...(accepted === undefined ? {} : { accepted }),
  });

describe("what the reader couldn't follow, on the page (P75)", () => {
  it('ships the breakdown by cause and package, with the node each place is written in', () => {
    const packed = pack().cantFollow!;
    expect(packed.total).toEqual({ rows: 2, sites: 4 });
    expect(packed.causes.map((cause) => [cause.l, cause.s])).toEqual([
      ['module-not-installed:@shop/mailer', 3],
      ['dynamic-member', 1],
    ]);
    const [place] = packed.causes[0]!.p[0]!.x;
    expect(place).toEqual(['api', 'src/orders.controller.ts', 12, 'OrdersController.list -> this.mail.send', 1]);
    expect(packed.packages).toEqual([{ n: '@shop/mailer', s: 3, c: [['module-not-installed', 3]] }]);
  });

  it('leaves out what was accepted, and ships nothing when nothing is left', () => {
    const packed = pack([
      { reason: 'call-dynamic-receiver', note: '', acceptedAt: '2026-10-08T00:00:00.000Z' },
      { reason: 'type-unresolved', note: '', acceptedAt: '2026-10-08T00:00:00.000Z' },
    ]);
    expect(packed.cantFollow).toBeUndefined();
  });
});
