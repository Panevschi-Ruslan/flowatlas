import type { GraphEdge, GraphNode } from '@flowatlas/core';
import type { AnchoredUnresolvedRow, LinkReport, ServiceReport } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { packagesOf } from '../commands/build.js';
import { CLUSTER_MIN, clustersOf } from './map-pack.js';
import {
  createMap,
  formatMapHash,
  serviceInside,
  isOpen,
  MAP_BOX,
  MAP_OPEN_UNDER,
  mapCycles,
  mapLayout,
  mapMarks,
  mapView,
  openByDefault,
  parseMapHash,
} from './map.js';
import { packGraph } from './pack.js';

/**
 * A shop of five services, written by hand: a front end calls an API, the API
 * publishes an order onto a channel a worker consumes, the worker reads its
 * own table, calls a payments host and calls back into the API, and the API
 * and the worker both build on a contracts package another service publishes.
 */
const node = (over: Partial<GraphNode> & Pick<GraphNode, 'id' | 'type' | 'repo'>): GraphNode => ({
  label: over.id,
  ...over,
});

const nodes: GraphNode[] = [
  node({ id: 'repo:shop-web', type: 'repo', repo: 'shop-web' }),
  node({ id: 'ui:shop-web#checkout', type: 'ui_api_call', repo: 'shop-web', label: 'POST /orders' }),
  node({ id: 'repo:orders-api', type: 'repo', repo: 'orders-api' }),
  node({ id: 'entry:orders-api:http:POST:/orders', type: 'entry', kind: 'http', repo: 'orders-api', label: 'POST /orders' }),
  node({ id: 'entry:orders-api:http:GET:/orders', type: 'entry', kind: 'http', repo: 'orders-api', label: 'GET /orders' }),
  node({ id: 'orders-api#OrdersService.place', type: 'method', repo: 'orders-api', label: 'OrdersService.place' }),
  node({ id: 'orders-api#OrdersService.refund', type: 'method', repo: 'orders-api', label: 'OrdersService.refund' }),
  node({ id: 'producer:orders-api#place', type: 'producer', repo: 'orders-api' }),
  node({
    id: 'channel:order-placed',
    type: 'channel',
    repo: 'orders-api',
    label: 'order-placed',
    meta: { channelKind: 'topic', adapters: ['kafka'] },
  }),
  node({ id: 'channel:order-lost', type: 'channel', repo: 'orders-api', label: 'order-lost', meta: { adapters: ['kafka'] } }),
  node({ id: 'repo:billing-worker', type: 'repo', repo: 'billing-worker' }),
  node({ id: 'consumer:billing-worker#placed', type: 'consumer', repo: 'billing-worker' }),
  node({ id: 'billing-worker#Billing.charge', type: 'method', repo: 'billing-worker', label: 'Billing.charge' }),
  node({ id: 'db:billing-worker#1', type: 'db_query', repo: 'billing-worker' }),
  node({ id: 'table:billing-worker#invoices', type: 'table', repo: 'billing-worker', label: 'invoices' }),
  node({ id: 'http_out:billing-worker#1', type: 'http_out', repo: 'billing-worker' }),
  node({ id: 'external_api:pay.example.com', type: 'external_api', repo: 'billing-worker', label: 'pay.example.com' }),
  node({ id: 'repo:contracts', type: 'repo', repo: 'contracts' }),
];

const edge = (from: string, to: string, type: GraphEdge['type'], confidence: GraphEdge['confidence'] = 'static'): GraphEdge =>
  ({ from, to, type, confidence });

const edges: GraphEdge[] = [
  edge('ui:shop-web#checkout', 'entry:orders-api:http:POST:/orders', 'hits', 'heuristic'),
  edge('entry:orders-api:http:POST:/orders', 'orders-api#OrdersService.place', 'handles'),
  edge('orders-api#OrdersService.place', 'producer:orders-api#place', 'calls'),
  edge('producer:orders-api#place', 'channel:order-placed', 'emits'),
  edge('producer:orders-api#place', 'channel:order-lost', 'emits'),
  edge('channel:order-placed', 'consumer:billing-worker#placed', 'consumes'),
  edge('consumer:billing-worker#placed', 'billing-worker#Billing.charge', 'handles'),
  edge('billing-worker#Billing.charge', 'db:billing-worker#1', 'calls'),
  edge('db:billing-worker#1', 'table:billing-worker#invoices', 'queries'),
  edge('billing-worker#Billing.charge', 'http_out:billing-worker#1', 'calls'),
  edge('http_out:billing-worker#1', 'external_api:pay.example.com', 'calls'),
  edge('billing-worker#Billing.charge', 'orders-api#OrdersService.refund', 'calls', 'heuristic'),
  edge('entry:orders-api:http:POST:/orders', 'repo:orders-api', 'guarded_by'),
];

const service = (name: string, packages?: ServiceReport['packages']): ServiceReport => ({
  name,
  repo: `../${name}`,
  type: 'nestjs',
  extractor: 'nestjs',
  nodes: 0,
  edges: 0,
  types: 0,
  unresolved: 0,
  durationMs: 0,
  ...(packages === undefined ? {} : { packages }),
});

const report = {
  httpOut: {},
  channels: {},
  routes: { total: 0, called: 0, duplicated: 0 },
  types: {},
  totals: {},
  services: [
    service('shop-web', { runtime: ['react'], dev: ['vitest'] }),
    service('orders-api', { name: '@shop/orders-api', runtime: ['@shop/contracts', 'lodash'], dev: ['vitest'] }),
    service('billing-worker', { runtime: ['@shop/contracts', 'lodash'], dev: ['vitest'] }),
    service('contracts', { name: '@shop/contracts', runtime: [], dev: [] }),
  ],
} as unknown as LinkReport;

const rows: AnchoredUnresolvedRow[] = [
  {
    service: 'orders-api', file: 'a.ts', line: 1, reason: 'x', level: 'action', sites: 1, message: 'm', hint: null, node: null,
  },
  {
    service: 'orders-api', file: 'a.ts', line: 2, reason: 'y', level: 'info', sites: 1, message: 'm', hint: null, node: null,
  },
];

const packed = packGraph({ builtAt: '2026-10-08T00:00:00.000Z', nodes, edges, unresolved: rows, report });
const map = createMap(packed.map);
const confidences = packed.dicts.confidences;
const idOf = (i: number): string => {
  const box = map.boxes[i]!;
  return ['service', 'channel', 'data', 'external', 'package'][box.k] + ':' + box.n;
};
const boxNamed = (id: string) => map.boxes[map.byId.get(id)!]!;
const columnOf = (id: string): string =>
  ['front', 'api', 'channel', 'worker', 'library', 'data', 'external', 'package'][boxNamed(id).c]!;

describe('the project at the size of its services', () => {
  it('puts each service in the column of what it is for', () => {
    expect(columnOf('service:shop-web')).toBe('front');
    expect(columnOf('service:orders-api')).toBe('api');
    expect(columnOf('service:billing-worker')).toBe('worker');
    expect(columnOf('service:contracts')).toBe('library');
    expect(columnOf('channel:order-placed')).toBe('channel');
    expect(columnOf('data:billing-worker')).toBe('data');
    expect(columnOf('external:pay.example.com')).toBe('external');
  });

  it('joins boxes by what passes between them, counted, with the edges kept', () => {
    const links = map.links
      .filter((link) => link.k !== 7)
      .map((link) => `${idOf(link.f)} ${['http', 'message', 'workflow', 'invoke', 'db', 'external', 'calls'][link.k]} ${idOf(link.t)} ×${link.n}`)
      .sort();
    expect(links).toEqual([
      'channel:order-placed message service:billing-worker ×1',
      'service:billing-worker calls service:orders-api ×1',
      'service:billing-worker db data:billing-worker ×1',
      'service:billing-worker external external:pay.example.com ×1',
      'service:orders-api message channel:order-lost ×1',
      'service:orders-api message channel:order-placed ×1',
      'service:shop-web http service:orders-api ×1',
    ]);
    const http = map.links.find((link) => idOf(link.f) === 'service:shop-web')!;
    expect(packed.edges[http.e![0]!]![0]).toBe(1);
    expect(confidences[http.b!]).toBe('heuristic');
  });

  it('leaves plumbing out of the links', () => {
    expect(map.links.every((link) => (link.e ?? []).every((e) => packed.dicts.edgeTypes[packed.edges[e]![2]!] !== 'guarded_by'))).toBe(true);
  });

  it('counts what each box is checked for', () => {
    expect(boxNamed('service:orders-api').s).toMatchObject({ problems: 1, ways: 2, uncalled: 1, 'e:http': 2 });
    expect(boxNamed('channel:order-placed').s).toMatchObject({ producers: 1, consumers: 1 });
    expect(boxNamed('channel:order-lost').s).toMatchObject({ producers: 1, consumers: 0 });
    expect(boxNamed('data:billing-worker').s).toMatchObject({ tables: 1 });
    expect(map.boxes[map.byId.get('data:billing-worker')!]!.a).toBe(14);
    expect(map.boxes[map.byId.get('service:orders-api')!]!.a).toBe(2);
  });

  it('joins a service to the service publishing the package it depends on, and shares the rest', () => {
    const manifestLinks = map.links
      .filter((link) => link.k === 7)
      .map((link) => `${idOf(link.f)} → ${idOf(link.t)}${link.d ? ' (dev)' : ''}${link.p ? ' via ' + link.p : ''}`)
      .sort();
    expect(manifestLinks).toEqual([
      'service:billing-worker → package:lodash',
      'service:billing-worker → package:vitest (dev)',
      'service:billing-worker → service:contracts via @shop/contracts',
      'service:orders-api → package:lodash',
      'service:orders-api → package:vitest (dev)',
      'service:orders-api → service:contracts via @shop/contracts',
      'service:shop-web → package:vitest (dev)',
    ]);
    expect(map.byId.has('package:react')).toBe(false);
    const manifest = packed.map.manifests[map.byId.get('service:orders-api')!]!;
    expect(manifest.name).toBe('@shop/orders-api');
    expect(manifest.runtime.map((i) => packed.map.packages[i])).toEqual(['@shop/contracts', 'lodash']);
  });
});

describe('families of names', () => {
  it('gathers names sharing a prefix once there are enough of them', () => {
    expect(clustersOf(['pay-api-cards', 'pay-api-refunds', 'pay-api-payouts', 'pay-web', 'ledger'])).toEqual([
      'pay-api-', 'pay-api-', 'pay-api-', '', '',
    ]);
    expect(clustersOf(['pay-api-cards', 'pay-api-refunds', 'pay-web', 'pay-jobs'])).toEqual(['pay-', 'pay-', 'pay-', 'pay-']);
    expect(clustersOf(['core.jobs.sync', 'core.jobs.send', 'core.jobs.read'])).toEqual(['core.jobs.', 'core.jobs.', 'core.jobs.']);
    expect(clustersOf(['a-b', 'a-c'])).toEqual(['', '']);
    expect(clustersOf(['pay', 'pay-', 'pay-x'])).toEqual(['', '', '']);
    expect(CLUSTER_MIN).toBe(3);
  });
});

describe('what the map draws', () => {
  const base = { toggled: new Set<string>(), hidden: new Set<string>() };

  it('draws every box as itself while the map is small, and no packages unless asked', () => {
    const view = mapView(map, base, confidences);
    expect([...view.units.keys()].sort()).toEqual([
      'channel:order-lost', 'channel:order-placed', 'data:billing-worker', 'external:pay.example.com',
      'service:billing-worker', 'service:contracts', 'service:orders-api', 'service:shop-web',
    ]);
    expect(view.links.some((link) => link.kind === 'package')).toBe(false);
  });

  it('adds the packages layer, development dependencies only when asked too', () => {
    const runtime = mapView(map, { ...base, packages: true }, confidences);
    expect(runtime.units.has('package:lodash')).toBe(true);
    expect(runtime.units.has('package:vitest')).toBe(false);
    expect(runtime.links.filter((link) => link.kind === 'package').map((link) => link.from + '>' + link.to).sort()).toEqual([
      'service:billing-worker>package:lodash', 'service:billing-worker>service:contracts',
      'service:orders-api>package:lodash', 'service:orders-api>service:contracts',
    ]);
    const dev = mapView(map, { ...base, packages: true, dev: true }, confidences);
    expect(dev.units.has('package:vitest')).toBe(true);
  });

  it('hides a kind of link without hiding the boxes', () => {
    const view = mapView(map, { ...base, hidden: new Set(['message']) }, confidences);
    expect(view.links.some((link) => link.kind === 'message')).toBe(false);
    expect(view.units.has('channel:order-placed')).toBe(true);
  });

  it('draws only the focus and what is one link from it', () => {
    const view = mapView(map, { ...base, focus: 'service:orders-api' }, confidences);
    expect([...view.units.keys()].sort()).toEqual([
      'channel:order-lost', 'channel:order-placed', 'service:billing-worker', 'service:orders-api', 'service:shop-web',
    ]);
  });

  it('closes a cluster into one unit, merges its links and counts what is inside', () => {
    const big = createMap({
      ...packed.map,
      boxes: packed.map.boxes.map((box) => (box.n.startsWith('channel') || box.n.startsWith('order-') ? { ...box, g: 'kafka' } : box)),
    });
    const id = 'cluster:channel:kafka';
    expect(big.clusters.get(id)!.members).toHaveLength(2);
    expect(openByDefault(big, id)).toBe(true);
    const closed = mapView(big, { ...base, toggled: new Set([id]) }, confidences);
    expect(isOpen(big, id, new Set([id]))).toBe(false);
    expect(closed.units.get(id)!.members).toHaveLength(2);
    const fromApi = closed.links.find((link) => link.from === 'service:orders-api' && link.to === id)!;
    expect(fromApi.count).toBe(2);
    expect(fromApi.links).toHaveLength(2);
  });

  it('starts clusters closed on a map too large to read with every box drawn', () => {
    const boxes = Array.from({ length: MAP_OPEN_UNDER.boxes + 1 }, (_, i) =>
      ({ k: 0, n: `pay-api-${i}`, c: 1, g: 'pay-api', a: -1, s: {} }));
    const crowded = createMap({ boxes, links: [], packages: [], manifests: {} });
    expect(openByDefault(crowded, 'cluster:api:pay-api')).toBe(false);
    expect(mapView(crowded, base).units.size).toBe(1);
  });
});

describe('where the map puts things', () => {
  it('puts columns left to right in the order a request travels, the same every time', () => {
    const view = mapView(map, { toggled: new Set(), hidden: new Set() }, confidences);
    const one = mapLayout(map, view);
    const two = mapLayout(map, view);
    expect(one.columns.map((column) => column.name)).toEqual(['front', 'api', 'channel', 'worker', 'library', 'data', 'external']);
    expect([...one.placed]).toEqual([...two.placed]);
    const x = (id: string) => one.placed.get(id)!.x;
    expect(x('service:shop-web')).toBeLessThan(x('service:orders-api'));
    expect(x('service:orders-api')).toBeLessThan(x('channel:order-placed'));
    expect(x('channel:order-placed')).toBeLessThan(x('service:billing-worker'));
    const ys = [...one.placed.values()];
    for (const a of ys) {
      for (const b of ys) {
        if (a === b || a.x !== b.x) continue;
        expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(a.h);
      }
    }
  });

  it('frames an open cluster around its members', () => {
    const big = createMap({
      ...packed.map,
      boxes: packed.map.boxes.map((box) => (box.n.startsWith('order-') ? { ...box, g: 'kafka' } : box)),
    });
    const laid = mapLayout(big, mapView(big, { toggled: new Set(), hidden: new Set() }, confidences));
    expect(laid.frames).toHaveLength(1);
    const frame = laid.frames[0]!;
    for (const id of ['channel:order-lost', 'channel:order-placed']) {
      const at = laid.placed.get(id)!;
      expect(at.y).toBeGreaterThan(frame.y);
      expect(at.y + at.h).toBeLessThan(frame.y + frame.h);
    }
  });
});

describe('a large open family', () => {
  it('wraps into sub-columns that fill down first, with nothing overlapping', () => {
    const boxes = Array.from({ length: 30 }, (_, i) =>
      ({ k: 0, n: `pay-api-${String(i).padStart(2, '0')}`, c: 1, g: 'pay-api-', a: -1, s: {} }));
    const family = createMap({ boxes, links: [], packages: [], manifests: {} });
    const laid = mapLayout(family, mapView(family, { toggled: new Set(), hidden: new Set() }));
    const xs = [...new Set([...laid.placed.values()].map((at) => at.x))].sort((a, b) => a - b);
    expect(xs).toHaveLength(Math.ceil(30 / MAP_BOX.wrap));
    const all = [...laid.placed.values()];
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
    const frame = laid.frames[0]!;
    for (const at of all) {
      expect(at.x).toBeGreaterThanOrEqual(frame.x);
      expect(at.x + at.w).toBeLessThanOrEqual(frame.x + frame.w);
    }
    expect(laid.placed.get('service:pay-api-00')!.x).toBe(laid.placed.get('service:pay-api-01')!.x);
    expect(laid.width).toBe(frame.w - 16);
  });
});

describe('checking on the map', () => {
  it('finds the services that reach each other', () => {
    const view = mapView(map, { toggled: new Set(), hidden: new Set() }, confidences);
    const cycles = mapCycles(view);
    expect([...cycles.units].sort()).toEqual(['channel:order-placed', 'service:billing-worker', 'service:orders-api']);
    expect(cycles.links.size).toBe(3);
  });

  it('marks what is checked, per unit', () => {
    const view = mapView(map, { toggled: new Set(), hidden: new Set() }, confidences);
    expect([...mapMarks(map, view, 'problems')]).toEqual([['service:orders-api', 1]]);
    expect([...mapMarks(map, view, 'dead')]).toEqual([['channel:order-lost', 1]]);
    expect([...mapMarks(map, view, 'uncalled')]).toEqual([['service:orders-api', 1]]);
    expect(mapMarks(map, view, 'cycles', mapCycles(view)).size).toBe(3);
  });

  it('says what is inside a service: its ways in and its busiest classes', () => {
    const inside = serviceInside(packed, 'orders-api');
    expect(inside.ways.map((i) => packed.nodes[i]![1])).toEqual(['GET /orders', 'POST /orders']);
    expect(inside.classes).toEqual([{ name: 'OrdersService', edges: 3 }]);
    expect(serviceInside(packed, 'nowhere').ways).toEqual([]);
  });
});

describe('a map view in the address', () => {
  it('writes a view as it opens as #map, and everything else by name', () => {
    expect(formatMapHash({})).toBe('#map');
    const hash = formatMapHash({
      selected: 'service:orders-api',
      focus: 'service:orders-api',
      toggled: new Set(['cluster:api:pay-api-']),
      hidden: new Set(['db', 'calls']),
      mark: 'dead',
      packages: true,
      dev: true,
    });
    expect(hash).toBe('#map/s=service:orders-api&f=service:orders-api&t=cluster:api:pay-api-&h=calls,db&m=dead&p=1&d=1');
    expect(parseMapHash(hash)).toEqual({
      selected: 'service:orders-api',
      link: null,
      focus: 'service:orders-api',
      toggled: ['cluster:api:pay-api-'],
      hidden: ['calls', 'db'],
      mark: 'dead',
      packages: true,
      dev: true,
    });
  });

  it('names a link by its two ends and its kind', () => {
    const hash = formatMapHash({ link: 'service:shop-web>service:orders-api>http' });
    expect(hash).toBe('#map/l=service:shop-web%3Eservice:orders-api%3Ehttp');
    expect(parseMapHash(hash)!.link).toBe('service:shop-web>service:orders-api>http');
  });

  it('reads a name with characters an address escapes, and drops what it does not know', () => {
    const hash = formatMapHash({ selected: 'package:@scope/pkg' });
    expect(parseMapHash(hash)!.selected).toBe('package:@scope/pkg');
    expect(parseMapHash('#map/h=nope,db&m=never')).toMatchObject({ hidden: ['db'], mark: null });
    expect(parseMapHash('#map')).toMatchObject({ selected: null, toggled: [] });
    expect(parseMapHash('#graph/abc')).toBeNull();
  });
});

describe('what a manifest says a service is built from', () => {
  it('lists run-time and development dependencies apart, each once and sorted', () => {
    expect(
      packagesOf({
        name: '@shop/api',
        dependencies: { zod: '^4', express: '^5' },
        peerDependencies: { react: '^19' },
        devDependencies: { vitest: '^3', zod: '^4' },
      }),
    ).toEqual({ name: '@shop/api', runtime: ['express', 'react', 'zod'], dev: ['vitest'] });
    expect(packagesOf(undefined)).toBeUndefined();
    expect(packagesOf({})).toEqual({ runtime: [], dev: [] });
  });
});
