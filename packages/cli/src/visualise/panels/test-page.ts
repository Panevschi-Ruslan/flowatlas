import { readFileSync } from 'node:fs';
import {
  addSpan,
  emptyAgg,
  joinIdOf,
  observedFromParts,
  readAccepted,
  saveAccepted,
  type AcceptedGap,
  type Agg,
  type Observed,
  type ObservedBucket,
  type Unresolved,
} from '@flowatlas/core';
import { packDatabase } from '../../commands/visualise.js';
import { buildTestProject } from '../../test-graph.js';
import { createModel, type GraphModel } from '../graph.js';
import type { PackedGraph } from '../pack.js';
import { stepIdOf } from '../steps.js';
import { PANELS } from './boot.js';
import { createPageContext } from './context.js';
import type { Page } from './page.js';
import { installDocument, type FakeDocument, type FakeWindow } from './test-dom.js';

/**
 * The page in a test (P103): its markup in a test document, its context built
 * from a packed graph, and its panels set up in the order the page sets them
 * up. A panel's test mounts the page up to that panel, calls its factory, and
 * looks at what it drew.
 */

/** The body `page.html` holds - the markup every panel finds its elements in - without its scripts. */
export const pageMarkup = (): string => {
  const html = readFileSync(new URL('../page.html', import.meta.url), 'utf8');
  return html.slice(html.indexOf('<div class="shell">'), html.indexOf('<script'));
};

/**
 * The test project (test-graph.ts) packed as the command packs it: three
 * services, a guard chain, a cross-service call, a channel with a handler and
 * one without, a cycle, check rows, and a map. `extra` adds check rows, and
 * what `flowatlas accept` wrote beside the database.
 */
export const testPack = (
  name = 'page',
  extra: { unresolved?: readonly Unresolved[]; accepted?: readonly AcceptedGap[] } = {},
): PackedGraph => {
  const { db, dbPath } = buildTestProject(name, extra.unresolved === undefined ? {} : { unresolved: extra.unresolved });
  if (extra.accepted !== undefined) saveAccepted(dbPath, extra.accepted);
  try {
    return packDatabase(db, readAccepted(dbPath));
  } finally {
    db.close();
  }
};

/** How the test project's traffic is made (P111): `slower` multiplies the slow hop, `failing` adds failures there. */
export interface TestTraffic {
  slower?: number;
  failing?: number;
  /** Ids the traffic names that the test graph does not hold (a different graph's file). */
  stranger?: boolean;
}

const HOUR = '2026-01-01T08:00:00.000Z';
const GATEWAY = 'entry:gateway:http:POST:/orders';
const ORDERS = 'entry:orders:http:POST:/orders';
const HOP = joinIdOf('http_out:gateway#src/clients/orders.client.ts:20:4', 'http_calls', ORDERS);
const EMIT = joinIdOf('producer:orders#src/orders/orders.service.ts:44:2', 'emits', 'channel:order.created');
const CONSUME = joinIdOf('channel:order.created', 'consumes', 'consumer:billing#src/invoices/invoices.consumer.ts:9');

/** An Agg of `n` spans, the i-th lasting `ms(i)` and answering `status(i)`. */
const aggOf = (n: number, ms: (i: number) => number, status: (i: number) => number | undefined = () => 200): Agg => {
  const agg = emptyAgg();
  for (let i = 0; i < n; i += 1) {
    const answered = status(i);
    addSpan(agg, { at: HOUR, durationMs: ms(i), ...(answered === undefined ? {} : { status: answered }) });
  }
  return agg;
};

/**
 * What `flowatlas observe` would write over the test project (P111): thirty
 * requests into the gateway's `POST /orders`, a slow hop to the orders
 * service, a few 500s, the event and its consumer, and two samples - the
 * slowest request and a failing one, with a span the map has no node for.
 */
export const testObserved = (traffic: TestTraffic = {}): Observed => {
  const slower = traffic.slower ?? 1;
  const failing = traffic.failing ?? 3;
  const hop = (i: number): number => (i < 28 ? 30 + i : 300) * slower;
  const bucket: ObservedBucket = {
    hour: HOUR,
    spans: 180,
    joins: {
      [HOP]: aggOf(30, hop, (i) => (i < failing ? 500 : 201)),
      [EMIT]: aggOf(30, () => 2),
      [CONSUME]: aggOf(30, (i) => 5 + (i % 3)),
      ...(traffic.stranger ? { [joinIdOf('http_out:shop#x', 'http_calls', 'entry:shop:http:GET:/x')]: aggOf(25, () => 9) } : {}),
    },
    entries: {
      [GATEWAY]: aggOf(30, (i) => hop(i) + 10, (i) => (i < failing ? 500 : 201)),
      [ORDERS]: aggOf(30, (i) => hop(i) - 2, (i) => (i < failing ? 500 : 201)),
      ...(traffic.stranger ? { 'entry:shop:http:GET:/x': aggOf(25, () => 9) } : {}),
    },
    symbols: {
      'gateway#src/orders/orders.controller.ts:OrdersController.create': aggOf(30, (i) => hop(i) + 6, () => undefined),
      'orders#src/orders/orders.service.ts:OrdersService.create': aggOf(30, (i) => hop(i) - 6, () => undefined),
    },
    channels: {},
    unmatched: [],
    ambiguous: [],
  };
  const slow = {
    traceId: 'a'.repeat(32), at: HOUR, ms: 310 * slower, status: 201, spans: 6,
    tree: {
      id: GATEWAY, label: 'POST /orders', service: 'gateway', kind: 'server', start: 0, ms: 310 * slower, status: 201,
      children: [{
        id: 'gateway#src/orders/orders.controller.ts:OrdersController.create', label: 'OrdersController.create', service: 'gateway',
        kind: 'internal', start: 1, ms: 306 * slower,
        children: [
          { label: 'cache lookup', service: 'gateway', kind: 'client', start: 2, ms: 1 },
          {
            id: 'http_out:gateway#src/clients/orders.client.ts:20:4', label: 'POST /orders', service: 'gateway', kind: 'client',
            start: 4, ms: 300 * slower, status: 201,
            children: [{ id: ORDERS, label: 'POST /orders', service: 'orders', kind: 'server', start: 5, ms: 298 * slower, status: 201 }],
          },
        ],
      }],
    },
  };
  const bad = {
    traceId: 'b'.repeat(32), at: HOUR, ms: 40, status: 500, error: true as const, spans: 2, cut: 4,
    tree: {
      id: GATEWAY, label: 'POST /orders', service: 'gateway', kind: 'server', start: 0, ms: 40, status: 500, error: true as const,
      children: [{ id: ORDERS, label: 'POST /orders', service: 'orders', kind: 'server', ms: 31, status: 500, error: true as const }],
    },
  };
  return observedFromParts({
    buckets: [bucket],
    samples: { [GATEWAY]: { slow: [slow], failing: [bad] } },
    sources: [],
    droppedAttributes: 0,
    samplesKept: true,
  });
};

/**
 * The test project packed with traffic over it (P111), as `visualise` packs
 * it when an observed file sits beside the database; `diff` adds a second
 * file to compare it with (`--observed-diff`).
 */
export const testRunTimePack = (
  name = 'runtime',
  options: { traffic?: TestTraffic; diff?: TestTraffic; minCount?: number } = {},
): PackedGraph => {
  const { db, dbPath } = buildTestProject(name);
  try {
    const observed = testObserved(options.traffic);
    return packDatabase(db, readAccepted(dbPath), {
      observed,
      ...(options.diff === undefined
        ? {}
        : { observedDiff: { a: observed, b: testObserved(options.diff), names: ['before.json', 'after.json'] as [string, string],
          ...(options.minCount === undefined ? {} : { minCount: options.minCount }) } }),
    });
  } finally {
    db.close();
  }
};

/** A node's position in `data`, by its id: `nodeAt(data)('channel:order.created')`. */
export const nodeAt = (data: PackedGraph): ((id: string) => number) => {
  const model = createModel(data) as GraphModel;
  const at = new Map(data.nodes.map((_, i) => [stepIdOf(model, i), i]));
  return (id) => {
    const v = at.get(id);
    if (v === undefined) throw new Error(`the test graph has no node ${id}`);
    return v;
  };
};

export interface MountedPage {
  page: Page;
  window: FakeWindow;
  document: FakeDocument;
}

export interface MountOptions {
  /** The markup to mount; the page's own by default. */
  markup?: string;
  /** Stop before this panel's factory, which the test then calls itself. */
  upTo?: (page: Page) => Record<string, unknown>;
  /** The address the page is opened at, hash and all. */
  address?: string;
  /** How wide the window is, for the media queries the page asks (P102); 1280 by default. */
  width?: number;
}

/**
 * The page mounted on `data`: every panel and then the first view, the way the
 * page boots, or only the panels before `upTo`.
 */
export const mountPage = (data: PackedGraph, options: MountOptions = {}): MountedPage => {
  const window = installDocument(options.markup ?? pageMarkup(), options.address, options.width);
  const page = createPageContext(data);
  for (const create of PANELS) {
    if (create === options.upTo) return { page, window, document: window.document };
    Object.assign(page, create(page));
  }
  page.start();
  return { page, window, document: window.document };
};

/**
 * `data` with `count` services (P98): its own, then `svc-04`, `svc-05`… -
 * tiny ones the report names and no node is in - so a test can see the rail
 * past a dozen services without building thirty repositories.
 */
export const withServices = (data: PackedGraph, count: number): PackedGraph => {
  const names = [...data.dicts.repos];
  while (names.length < count) names.push('svc-' + String(names.length + 1).padStart(2, '0'));
  const report = data.report as { services: Array<{ name: string }> };
  const services = names.map((name, i) => report.services.find((service) => service.name === name) ??
    { name, type: i % 3 === 0 ? 'express' : 'nestjs', nodes: 3 + i, edges: 2, unresolved: 0, durationMs: 10 + i, skipped: null });
  return { ...data, dicts: { ...data.dicts, repos: names }, report: { ...report, services } };
};

/**
 * `data` with `count` more ways in (P102): copies of its first entry, routed
 * `GET /bulk/0001`… and joined to nothing, so a test can see the Ways in list
 * hold thousands without building a project that large.
 */
export const withWays = (data: PackedGraph, count: number): PackedGraph => {
  const types = data.dicts.types as readonly string[];
  const first = data.nodes.find((node) => types[node[0] as number] === 'entry');
  if (first === undefined) throw new Error('the test graph has no way in to copy');
  const copies = Array.from({ length: count }, (_, n) => {
    const path = '/bulk/' + String(n + 1).padStart(4, '0');
    const copy = [...first];
    copy[1] = 'GET ' + path;
    copy[6] = { ...(first[6] as object | null ?? {}), m: 'GET', p: path };
    return copy;
  });
  return { ...data, nodes: [...data.nodes, ...copies] };
};
