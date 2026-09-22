import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { GraphEdge, ProjectGraph, RepoGraph } from '@flowatlas/core';
import type { LinkReport } from '@flowatlas/linker';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { buildProject } from './build.js';
import { runExtract } from './extract.js';

/**
 * What the tool ought to say, written from the fixtures' own source.
 *
 * Every other comparison in this repository is against something the tool
 * printed earlier: a recorded graph, a recorded answer, a recorded screen. That
 * proves the behaviour has not moved. It cannot tell a right answer from a wrong
 * one, and where the recording was taken while the answer was wrong it keeps the
 * mistake and calls the correction a regression (R09).
 *
 * So nothing here is compared against a recording. Each expectation below was
 * read off the fixture's source by hand — this route is declared, that method
 * handles it, this request reaches it, and the chain ends at that table — and
 * says so in its own name, so that a failure names the fact that stopped being
 * true rather than a line number in a JSON file.
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const fixture = (name: string): string => join(ROOT, 'fixtures', name);
const FIXED = '2026-01-01T00:00:00.000Z';

// Beside the fixtures, so the copies still resolve the packages hoisted there.
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-ground-truth-'));

let groundTruth: ProjectGraph;
let multiRepo: ProjectGraph;
let leaves: RepoGraph;
let groundTruthReport: LinkReport;

/**
 * A fixture copied to where nothing else is reading it.
 *
 * A build writes each repository's own graph beside that repository's source,
 * so two test files building one fixture at the same time are two builds
 * writing to one place, and each can be handed the other's answer. Reading a
 * copy is also what makes this the build these assertions asked for rather than
 * whichever build happened to run last.
 *
 * The configuration comes with the copy: `apiTarget` and `baseUrlEnv` are part
 * of what is being asserted, so they are used rather than restated here.
 */
const copyOf = (name: string): string => {
  const dir = join(scratch, name);
  // What a previous build left behind is left behind: the copy is read from
  // nothing but source, and a file another test is rewriting is never opened.
  cpSync(fixture(name), dir, {
    recursive: true,
    filter: (from) => !from.split(sep).includes('.flowatlas'),
  });
  return dir;
};

beforeAll(async () => {
  const one = await buildProject({
    config: join(copyOf('ground-truth'), 'flowatlas.config.json'),
    builtAt: FIXED,
  });
  groundTruth = one.project;
  groundTruthReport = one.report;

  const two = await buildProject({
    config: join(copyOf('multi-repo'), 'flowatlas.config.json'),
    builtAt: FIXED,
  });
  multiRepo = two.project;

  const three = await runExtract(copyOf('nest-leaves'));
  leaves = three.graph;
}, 240_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

/**
 * The one node an edge of this kind leads to, or a sentence saying what is
 * there instead.
 *
 * Answering with prose rather than with `undefined` is what makes the failure
 * readable: "expected 'nothing: … has no http_calls edge' to be
 * 'entry:api:http:PATCH:/orders/:param'" says which fact stopped being true.
 */
const follows = (
  graph: { edges: readonly GraphEdge[] },
  from: string,
  type: string,
): string => {
  const found = graph.edges.filter((edge) => edge.from === from && edge.type === type);
  if (found.length === 0) return `nothing: ${from} has no ${type} edge`;
  if (found.length > 1) {
    return `${found.length} of them: ${found.map((edge) => edge.to).sort().join(', ')}`;
  }
  return found[0]?.to ?? '';
};

/** Everything an edge of this kind leads to, sorted, so a list can be compared whole. */
const allFollowing = (
  graph: { edges: readonly GraphEdge[] },
  from: string,
  type: string,
): string[] =>
  graph.edges
    .filter((edge) => edge.from === from && edge.type === type)
    .map((edge) => edge.to)
    .sort();

/** The edge between two nodes, or a sentence saying there is none. */
const edgeBetween = (
  graph: { edges: readonly GraphEdge[] },
  from: string,
  to: string,
): GraphEdge | string =>
  graph.edges.find((edge) => edge.from === from && edge.to === to) ??
  `no edge from ${from} to ${to}`;

/** Every HTTP route in the graph, by id. */
const routesOf = (graph: ProjectGraph): string[] =>
  graph.nodes
    .filter((node) => node.type === 'entry' && node.kind === 'http')
    .map((node) => node.id)
    .sort();

/** What one node says about itself, or a sentence saying it is not there. */
const metaOf = (
  graph: { nodes: readonly { id: string; meta?: Record<string, unknown> }[] },
  id: string,
): Record<string, unknown> | string =>
  graph.nodes.find((node) => node.id === id)?.meta ?? `no node ${id}`;

/** The walk out of one node, hop by hop, as `<edge> <node>` lines a person can read. */
const walkFrom = (graph: ProjectGraph, start: string, types: readonly string[]): string[] => {
  const lines: string[] = [];
  let current = start;
  for (let hop = 0; hop < 20; hop += 1) {
    const next = graph.edges.filter(
      (edge) => edge.from === current && types.includes(edge.type),
    );
    if (next.length !== 1) break;
    const edge = next[0] as GraphEdge;
    lines.push(`${edge.type} ${edge.to}`);
    current = edge.to;
  }
  return lines;
};

describe('a controller registered under two names, read from fixtures/ground-truth', () => {
  // api/src/orders/orders.controller.ts:13 is `@Controller(['orders', 'o'])`,
  // with `@Get(':id')` on line 17 and `@Patch(':id')` on line 22. A person may
  // type either name and the running service answers both.
  it('opens one way in per name in the list, all reaching the same handler', () => {
    expect(routesOf(groundTruth)).toEqual([
      'entry:api:http:GET:/files/*',
      'entry:api:http:GET:/files/latest',
      'entry:api:http:GET:/o/:param',
      'entry:api:http:GET:/orders/:param',
      'entry:api:http:GET:/reports/:param',
      'entry:api:http:PATCH:/o/:param',
      'entry:api:http:PATCH:/orders/:param',
    ]);
  });

  it('sends both names of a GET to the method the controller declares', () => {
    const findOne = 'api#src/orders/orders.controller.ts:OrdersController.findOne';
    expect(follows(groundTruth, 'entry:api:http:GET:/orders/:param', 'handles')).toBe(findOne);
    expect(follows(groundTruth, 'entry:api:http:GET:/o/:param', 'handles')).toBe(findOne);
  });

  it('sends both names of a PATCH to the method the controller declares', () => {
    const rename = 'api#src/orders/orders.controller.ts:OrdersController.rename';
    expect(follows(groundTruth, 'entry:api:http:PATCH:/orders/:param', 'handles')).toBe(rename);
    expect(follows(groundTruth, 'entry:api:http:PATCH:/o/:param', 'handles')).toBe(rename);
  });

  it('counts an alias nobody calls as a route nobody calls', () => {
    expect(groundTruthReport.routes.uncalled).toContain('entry:api:http:PATCH:/o/:param');
  });
});

describe('a request that is neither a GET nor a POST, read from fixtures/ground-truth', () => {
  // client/src/orders/orders.client.ts:21 is
  // `this.http.patch(`${this.config.get('API_URL')}/orders/${id}`, { name })`.
  const call = 'http_out:client#src/orders/orders.client.ts:21:12';

  it('keeps the verb the call was written with', () => {
    expect(metaOf(groundTruth, call)).toMatchObject({
      method: 'PATCH',
      path: '/orders/:param',
      baseUrlEnv: 'API_URL',
    });
  });

  it('reaches the route that answers that verb, and says how it knew', () => {
    expect(follows(groundTruth, call, 'http_calls')).toBe('entry:api:http:PATCH:/orders/:param');
    expect(edgeBetween(groundTruth, call, 'entry:api:http:PATCH:/orders/:param')).toMatchObject({
      confidence: 'static',
      meta: { via: 'baseUrlEnv', targetService: 'api' },
    });
  });
});

describe('a catch-all beside a route that spells its segment out, in fixtures/ground-truth', () => {
  // api/src/files/files.controller.ts declares `@Get('latest')` on line 13 and
  // `@Get('*')` on line 18. Both answer `GET /files/latest`; the router runs the
  // one that spells the segment out.
  const call = 'http_out:client#src/orders/orders.client.ts:26:12';

  it('chooses the route that spells the segment out over the one that swallows it', () => {
    expect(follows(groundTruth, call, 'http_calls')).toBe('entry:api:http:GET:/files/latest');
  });

  it('leaves the catch-all reported as reached by nobody', () => {
    expect(groundTruthReport.routes.uncalled).toContain('entry:api:http:GET:/files/*');
  });
});

describe('a segment chosen from a table of names, in fixtures/ground-truth', () => {
  // client/src/orders/orders.client.ts:35 asks for
  // `${API_URL}/reports/${REPORT_PATHS[kind]}`. `api` does serve
  // `GET /reports/:kind`, and this call must still reach nothing: a route
  // declares a hole for values, not for a choice between names the caller keeps
  // in a table (R01, R05).
  const call = 'http_out:client#src/orders/orders.client.ts:35:12';

  it('does not write the lookup down as a route parameter', () => {
    expect(metaOf(groundTruth, call)).toMatchObject({ path: '/reports/${…}' });
  });

  it('reaches no route, though one looks as though it would answer', () => {
    expect(follows(groundTruth, call, 'http_calls')).toBe(
      `nothing: ${call} has no http_calls edge`,
    );
    expect(groundTruthReport.routes.uncalled).toContain('entry:api:http:GET:/reports/:param');
  });
});

describe('what the three requests of fixtures/ground-truth add up to', () => {
  it('puts each of them in exactly one bucket', () => {
    // Two reach a route — the PATCH and the literal `/files/latest` — and the
    // one whose segment comes out of a table reaches nothing.
    expect(groundTruthReport.httpOut).toEqual({
      total: 3,
      linked: 2,
      byMarker: 0,
      unknownEnv: 0,
      noRoute: 0,
      ambiguous: 0,
      external: 0,
      dynamic: 1,
    });
  });
});

describe('the routes fixtures/multi-repo declares, read from its controllers', () => {
  it('holds one entry per method and path, the pair of aliases collapsed into one', () => {
    // gateway/src/orders/orders.controller.ts declares eight — three of them
    // the pair a closed segment reaches and the half of a second pair that
    // exists (R31) — orders declares five over three files, `GET /a/:param`
    // twice, which is one id, and billing/src/invoices/invoices.controller.ts
    // declares two.
    expect(routesOf(multiRepo)).toEqual([
      'entry:billing:http:GET:/invoices/:param',
      'entry:billing:http:POST:/invoices',
      'entry:gateway:http:GET:/orders/:param',
      'entry:gateway:http:POST:/orders/:param/cancel',
      'entry:gateway:http:POST:/orders/:param/invoice',
      'entry:gateway:http:POST:/orders/:param/refund',
      'entry:gateway:http:POST:/orders/:param/resume',
      'entry:gateway:http:POST:/orders/:param/ship',
      'entry:gateway:http:POST:/orders/charge',
      'entry:gateway:http:POST:/orders/pay',
      'entry:orders:http:GET:/a/:param',
      'entry:orders:http:GET:/orders/:param',
      'entry:orders:http:GET:/orders/latest',
      'entry:orders:http:POST:/orders',
      'entry:orders:http:POST:/orders/:param/archive',
    ]);
  });

  it('sends each route to the method declared under its decorator', () => {
    const handlers = Object.fromEntries(
      routesOf(multiRepo).map((id) => [id, follows(multiRepo, id, 'handles')]),
    );
    expect(handlers).toEqual({
      'entry:billing:http:GET:/invoices/:param':
        'billing#src/invoices/invoices.controller.ts:InvoicesController.findOne',
      'entry:billing:http:POST:/invoices':
        'billing#src/invoices/invoices.controller.ts:InvoicesController.create',
      'entry:gateway:http:GET:/orders/:param':
        'gateway#src/orders/orders.controller.ts:OrdersController.findOne',
      'entry:gateway:http:POST:/orders/:param/ship':
        'gateway#src/orders/orders.controller.ts:OrdersController.ship',
      'entry:gateway:http:POST:/orders/:param/refund':
        'gateway#src/orders/orders.controller.ts:OrdersController.refund',
      'entry:gateway:http:POST:/orders/:param/resume':
        'gateway#src/orders/orders.controller.ts:OrdersController.resume',
      'entry:gateway:http:POST:/orders/:param/cancel':
        'gateway#src/orders/orders.controller.ts:OrdersController.cancel',
      'entry:gateway:http:POST:/orders/:param/invoice':
        'gateway#src/orders/orders.controller.ts:OrdersController.invoice',
      'entry:gateway:http:POST:/orders/charge':
        'gateway#src/orders/orders.controller.ts:OrdersController.charge',
      'entry:gateway:http:POST:/orders/pay':
        'gateway#src/orders/orders.controller.ts:OrdersController.pay',
      // The one route two controllers declare: one node, two handlers, which is
      // a duplicate-route finding rather than an ambiguity.
      'entry:orders:http:GET:/a/:param':
        '2 of them: orders#src/aliases/current-aliases.controller.ts:CurrentAliasesController.resolve, orders#src/aliases/legacy-aliases.controller.ts:LegacyAliasesController.resolve',
      'entry:orders:http:GET:/orders/:param':
        'orders#src/orders/orders.controller.ts:OrdersController.findOne',
      'entry:orders:http:GET:/orders/latest':
        'orders#src/orders/orders.controller.ts:OrdersController.latest',
      'entry:orders:http:POST:/orders':
        'orders#src/orders/orders.controller.ts:OrdersController.create',
      'entry:orders:http:POST:/orders/:param/archive':
        'orders#src/orders/orders.controller.ts:OrdersController.archive',
    });
  });
});

describe('the chain fixtures/multi-repo exists to draw', () => {
  it('goes from the button in the browser to the table three repositories away', () => {
    // Read from the source, in order: the template on
    // web/src/app/checkout.component.ts:15, `checkout` on line 20,
    // `OrdersApiService.order` on line 20 of orders-api.service.ts, its request
    // on line 21, the gateway's `GET /orders/:id` on line 30 of its controller,
    // `OrdersClient.fetchOne` on line 32, its request on line 33, orders'
    // `GET /orders/:id` on line 25, `OrdersService.findOne` on line 25 of the
    // service, and its `findOne` on the repository on line 26.
    expect(
      walkFrom(multiRepo, 'ui_action:web#src/app/checkout.component.ts:15:22', [
        'handles',
        'calls',
        'hits',
        'http_calls',
        'queries',
      ]),
    ).toEqual([
      'handles web#src/app/checkout.component.ts:CheckoutComponent.checkout',
      'calls web#src/app/orders-api.service.ts:OrdersApiService.order',
      'calls ui_api_call:web#src/app/orders-api.service.ts:21:12',
      'hits entry:gateway:http:GET:/orders/:param',
      'handles gateway#src/orders/orders.controller.ts:OrdersController.findOne',
      'calls gateway#src/clients/orders.client.ts:OrdersClient.fetchOne',
      'calls http_out:gateway#src/clients/orders.client.ts:33:12',
      'http_calls entry:orders:http:GET:/orders/:param',
      'handles orders#src/orders/orders.controller.ts:OrdersController.findOne',
      'calls orders#src/orders/orders.service.ts:OrdersService.findOne',
      'calls db_query:orders#src/orders/orders.service.ts:26:23',
      'queries table:orders#Order',
    ]);
  });

  it('reads the request the gateway makes for one order as reaching the route orders serves', () => {
    // gateway/src/clients/orders.client.ts:33 asks for
    // `${ORDERS_URL}/orders/${id}`; `flowatlas.config.json` gives `ORDERS_URL` to
    // `orders`, whose controller declares `@Get(':id')` under `@Controller('orders')`.
    const call = 'http_out:gateway#src/clients/orders.client.ts:33:12';
    expect(metaOf(multiRepo, call)).toMatchObject({
      method: 'GET',
      path: '/orders/:param',
      baseUrlEnv: 'ORDERS_URL',
    });
    expect(follows(multiRepo, call, 'http_calls')).toBe('entry:orders:http:GET:/orders/:param');
    expect(edgeBetween(multiRepo, call, 'entry:orders:http:GET:/orders/:param')).toMatchObject({
      confidence: 'static',
      meta: { via: 'baseUrlEnv' },
    });
  });

  it('keeps both halves of an address a helper assembles', () => {
    // web/src/app/orders-api.service.ts:61 passes `${id}/invoice` to `urlFor`,
    // which writes `${environment.apiUrl}/orders/` in front of it. Reading only
    // the key it is rooted at reported the request against `/`, which the
    // gateway does not serve — a route that was never missing (R05).
    const call = 'ui_api_call:web#src/app/orders-api.service.ts:61:12';
    expect(metaOf(multiRepo, call)).toMatchObject({
      method: 'POST',
      path: '/orders/:param/invoice',
    });
    expect(follows(multiRepo, call, 'hits')).toBe('entry:gateway:http:POST:/orders/:param/invoice');
  });

  it('ends at the table the entity names', () => {
    const findOne = 'orders#src/orders/orders.service.ts:OrdersService.findOne';
    // orders/src/orders/orders.service.ts:26 is `this.orders.findOne(...)` on a
    // `Repository<Order>`, and order.entity.ts declares `Order`.
    const query = 'db_query:orders#src/orders/orders.service.ts:26:23';
    expect(follows(multiRepo, findOne, 'calls')).toBe(query);
    expect(metaOf(multiRepo, query)).toMatchObject({ op: 'read', table: 'Order' });
    expect(follows(multiRepo, query, 'queries')).toBe('table:orders#Order');
  });
});

describe('what fixtures/multi-repo deliberately does not join', () => {
  it('does not join a client asking for a route the service renamed', () => {
    // gateway/src/clients/orders.client.ts:44 asks for
    // `POST /orders/:param/cancel`; orders/src/orders/orders.controller.ts:42
    // declares `POST /orders/:param/archive` and nothing else near it.
    const call = 'http_out:gateway#src/clients/orders.client.ts:44:12';
    expect(follows(multiRepo, call, 'http_calls')).toBe(
      `nothing: ${call} has no http_calls edge`,
    );
    expect(
      multiRepo.unresolved.find((row) => row.line === 44 && row.service === 'gateway')?.message,
    ).toBe('target service orders has no route POST /orders/:param/cancel');
  });

  it('does not join an address with two holes in a row to the route it resembles', () => {
    // `${ORDERS_URL}/orders/${id}${suffix}` on line 59 could be one segment or
    // four, and each hole is its own span nobody read. It used to collapse to
    // `/orders/:param` and join (R01).
    const call = 'http_out:gateway#src/clients/orders.client.ts:59:12';
    expect(metaOf(multiRepo, call)).toMatchObject({ path: '/orders/${…}${…}' });
    expect(follows(multiRepo, call, 'http_calls')).toBe(
      `nothing: ${call} has no http_calls edge`,
    );
  });

  it('does not join an address whose hole runs into text', () => {
    // web/src/app/orders-api.service.ts:48 asks for `${apiUrl}/orders/${id}-summary`.
    // The segment could be `42-summary` or `latest-summary`; nothing here says
    // which, and it used to collapse to `/orders/:param` and join (R01).
    const call = 'ui_api_call:web#src/app/orders-api.service.ts:48:12';
    expect(metaOf(multiRepo, call)).toMatchObject({ path: '/orders/${…}-summary' });
    expect(follows(multiRepo, call, 'hits')).toBe(`nothing: ${call} has no hits edge`);
  });

  it('does not choose between two services that both serve the route a browser asks for', () => {
    // web/src/app/orders-api.service.ts:34 is rooted at `ordersUrl`, which
    // `apiTarget` does not name, and `gateway` and `orders` both serve
    // `GET /orders/:param`.
    const call = 'ui_api_call:web#src/app/orders-api.service.ts:34:12';
    expect(follows(multiRepo, call, 'hits')).toBe(`nothing: ${call} has no hits edge`);
  });
});

describe('the channel both ends of fixtures/multi-repo meet on', () => {
  it('gives a name emitted in one repository and handled in another exactly one node', () => {
    expect(multiRepo.nodes.filter((node) => node.id === 'channel:order.created')).toHaveLength(1);
  });

  it('joins the emit in orders to the handler in billing through it', () => {
    // orders/src/orders/orders.service.ts:49 emits `order.created`;
    // billing/src/invoices/invoices.consumer.ts:17 is
    // `@EventPattern('order.created')`.
    expect(follows(multiRepo, 'producer:orders#src/orders/orders.service.ts:49:5', 'emits')).toBe(
      'channel:order.created',
    );
    expect(allFollowing(multiRepo, 'channel:order.created', 'consumes')).toEqual([
      'consumer:billing#src/invoices/invoices.consumer.ts:InvoicesConsumer.onOrderCreated',
    ]);
  });

  it('leaves a name nobody handles with no handler rather than with a wrong one', () => {
    // Nothing in the project has an `@EventPattern('order.archived')`.
    expect(allFollowing(multiRepo, 'channel:order.archived', 'consumes')).toEqual([]);
  });
});

describe('the leaves fixtures/nest-leaves writes down, read from its service', () => {
  const cacheOps = (): Record<string, unknown> =>
    Object.fromEntries(
      leaves.nodes
        .filter((node) => node.type === 'cache_op')
        .map((node) => [
          node.id.replace('cache_op:nest-leaves#src/orders/orders.service.ts:', 'line '),
          `${String(node.meta?.['op'] ?? '?')} ${String(node.meta?.['keyPattern'] ?? '(none)')}`,
        ]),
    );

  it('keeps a literal key whole and marks the hole in a key that has one', () => {
    // The five calls on the cache, at lines 19, 24, 28, 32 and 38 of
    // orders.service.ts. `orders:${id}` keeps its prefix; `del(key)` has no
    // literal part at all, so there is no pattern to write down.
    expect(cacheOps()).toEqual({
      'line 19:12': 'get orders:index',
      'line 24:12': 'get orders:*',
      'line 28:12': 'set orders:*',
      'line 32:12': 'del orders:*',
      'line 38:12': 'del (none)',
    });
  });

  it('says which key it could not read rather than inventing one', () => {
    // `this.cache.del(key)` on line 38.
    expect(leaves.unresolved.filter((row) => row.reason === 'dynamic-cache-key')).toHaveLength(1);
    expect(leaves.unresolved.find((row) => row.reason === 'dynamic-cache-key')?.line).toBe(38);
  });

  it('roots an outgoing address at the setting it was built from', () => {
    // Line 44: `this.http.get(`${this.config.get('ORDERS_URL')}/orders/${id}`)`.
    expect(metaOf(leaves, 'http_out:nest-leaves#src/orders/orders.service.ts:44:12')).toMatchObject(
      { method: 'GET', path: '/orders/:param', baseUrlEnv: 'ORDERS_URL' },
    );
  });

  it('names the third party an absolute address goes to', () => {
    // Line 54: `axios.post('https://api.stripe.com/v1/charges', …)`.
    const call = 'http_out:nest-leaves#src/orders/orders.service.ts:54:12';
    expect(metaOf(leaves, call)).toMatchObject({ method: 'POST', host: 'api.stripe.com' });
    expect(follows(leaves, call, 'calls')).toBe('external_api:api.stripe.com');
  });

  it('takes the verb of a platform request out of its options', () => {
    // Line 65: `fetch('https://example.test/health', { method: 'HEAD' })`.
    expect(metaOf(leaves, 'http_out:nest-leaves#src/orders/orders.service.ts:65:12')).toMatchObject(
      { method: 'HEAD', host: 'example.test' },
    );
  });

  it('records every settings key the service reads and none it does not', () => {
    // Lines 70 to 72: `FEATURE_X`, `TIMEOUT_MS` with a fallback, and
    // `process.env.NODE_ENV`, plus `ORDERS_URL` behind the two addresses.
    // `config.get(name)` on line 79 names nothing, so nothing is written down.
    expect(
      leaves.nodes
        .filter((node) => node.type === 'config_key')
        .map((node) => node.id)
        .sort(),
    ).toEqual([
      'config_key:nest-leaves#FEATURE_X',
      'config_key:nest-leaves#NODE_ENV',
      'config_key:nest-leaves#ORDERS_URL',
      'config_key:nest-leaves#TIMEOUT_MS',
    ]);
    expect(leaves.unresolved.filter((row) => row.reason === 'dynamic-config-key')).toHaveLength(1);
  });
});
