import { resolve } from 'node:path';
import { AdapterRegistry, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { extractRepo } from '@flowatlas/extractor-nestjs';
import { describe, expect, it } from 'vitest';
import { registerDbAdapters } from './index.js';
import { leavesPass } from './leaves-pass.js';

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');

const graphOf = async (fixture: string): Promise<RepoGraph> =>
  extractRepo({
    rootDir: resolve(FIXTURES, fixture),
    repo: fixture,
    registry: registerDbAdapters(new AdapterRegistry()),
    extraPasses: [leavesPass],
  });

const queriesIn = (graph: RepoGraph, file: string): GraphNode[] =>
  graph.nodes
    .filter((node) => node.type === 'db_query' && node.file === file)
    .sort((left, right) => (left.line ?? 0) - (right.line ?? 0));

/**
 * What the reader recorded about a query, without where it was written.
 *
 * The receiver text is left out for the same reason: `this.orders` and `orders`
 * are the same repository reached from a method and from a function, and a
 * comparison that included the text would be comparing the spelling rather than
 * what was read.
 */
const facts = (node: GraphNode): Record<string, unknown> => {
  const { receiver: _spelling, entityTypeId, ...rest } = node.meta ?? {};
  return { ...rest, ...(entityTypeId === undefined ? {} : { entityTypeId: 'a document' }) };
};

describe('a data layer written as a module of functions', () => {
  it('records the same queries as the same data layer written as a class', async () => {
    const graph = await graphOf('fn-data-layer');
    const asFunctions = queriesIn(graph, 'src/orders/orders.repository.ts');
    const asClass = queriesIn(graph, 'src/orders/orders.class.ts');

    // Four queries each, in the same order, saying the same things. Before R52
    // the first list was empty: the walk read the methods of the indexed
    // classes and nothing else, so a query in a module-level function produced
    // no node at all — not an unresolved row, not a dynamic-table report.
    expect(asFunctions).toHaveLength(4);
    expect(asFunctions.map(facts)).toEqual(asClass.map(facts));
  });

  it('gives each function that holds a query a node of its own to hang it off', async () => {
    const graph = await graphOf('fn-data-layer');
    const holders = graph.edges
      .filter((edge) => edge.type === 'calls' && edge.to.includes('orders.repository.ts'))
      .map((edge) => edge.from);

    // A query belongs to the function it is written in, whatever that function
    // is called and whether or not anything calls it: the arrow on a const and
    // the declared function are both bodies of this repository.
    expect(new Set(holders)).toEqual(
      new Set([
        'fn-data-layer#src/orders/orders.repository.ts:listOrders',
        'fn-data-layer#src/orders/orders.repository.ts:saveOrder',
        // The query is one body further in, inside an arrow the exported
        // function keeps to itself, and belongs to the exported function.
        'fn-data-layer#src/orders/orders.repository.ts:archiveOrder',
        'fn-data-layer#src/orders/orders.repository.ts:saveInvoice',
      ]),
    );
  });
});

describe('the shapes a module of functions is written in', () => {
  it('reads a module of functions spelled as an object', async () => {
    const graph = await graphOf('fn-data-layer');
    const holders = graph.edges
      .filter((edge) => edge.type === 'calls' && edge.to.includes('orders.object.ts'))
      .map((edge) => edge.from);

    expect(holders).toEqual(['fn-data-layer#src/orders/orders.object.ts:orderQueries.list']);
  });

  it('says so about the one query it still cannot attribute', async () => {
    const graph = await graphOf('fn-data-layer');
    const rows = graph.unresolved.filter((row) => row.reason === 'db-call-at-module-level');

    // A query at the top level of a module runs at import and belongs to no
    // function anybody can name. There is nothing to hang it off, so it is
    // reported rather than dropped — which is what every query in a module of
    // functions used to be (R52).
    expect(rows).toHaveLength(1);
    expect(rows[0]?.file).toBe('src/orders/orders.object.ts');
    expect(rows[0]?.symbol).toBe('orders.find');
  });
});

describe('the document a write stores', () => {
  it('is recorded for both spellings of the same entity', async () => {
    const graph = await graphOf('fn-data-layer');
    const writes = graph.nodes.filter(
      (node) => node.type === 'db_query' && node.meta?.['op'] === 'write',
    );

    // `Repository<Order>` and `Repository<InvoiceEntity>` are one fact written
    // two ways. Recording the document only for the second — the only one with
    // a wrapper suffix to strip — is what left a project that does not suffix
    // its entities with no answer at all about what its writes store (R48).
    expect(writes).toHaveLength(4);
    for (const write of writes) expect(write.meta?.['entityTypeId']).toBeTypeOf('string');

    const documents = new Set(writes.map((write) => write.meta?.['entityTypeId']));
    expect(documents).toEqual(
      new Set(['type:fn-data-layer#Order', 'type:fn-data-layer#InvoiceEntity']),
    );

    // The declared name is still reported only when it differed from the table,
    // which is the one thing `entityType` was ever about.
    const named = writes.filter((write) => write.meta?.['entityType'] !== undefined);
    expect(named.map((write) => write.meta?.['entityType'])).toEqual([
      'InvoiceEntity',
      'InvoiceEntity',
    ]);
  });
});

describe('a chain that carries two operations', () => {
  it('is one query, recorded as the call that runs it', async () => {
    const graph = await graphOf('nest-knex');
    // `this.db.select('id').from('users').whereRaw(…).first()` — `select` and
    // `first` are both operations of the knex descriptor and every link of the
    // chain starts at the same position, so both used to be emitted for one
    // visit to the database (R49).
    const chain = queriesIn(graph, 'src/users/users.service.ts').filter(
      (node) => node.line === 33,
    );
    expect(chain).toHaveLength(1);
    expect(chain[0]?.meta?.['method']).toBe('first');
    expect(chain[0]?.meta?.['table']).toBe('users');
  });

  it('leaves one node per position, which is what the pass now counts', async () => {
    const graph = await graphOf('nest-knex');
    const queries = graph.nodes.filter((node) => node.type === 'db_query');

    // The count of queries is what decides whether to report a repository whose
    // data layer nobody could read, and it used to be a tally of emissions
    // rather than of nodes. Two chains here carry two operations each, so the
    // tally was two higher than the graph it was meant to describe. The pass
    // now counts the set of leaf ids it recorded, which is this set, so the two
    // cannot drift apart.
    expect(queries).toHaveLength(10);
    expect(new Set(queries.map((node) => node.id)).size).toBe(queries.length);
    expect(graph.unresolved.filter((row) => row.reason === 'db-package-unread')).toEqual([]);
  });
});

/**
 * The tables are asked about words from the source, so they are asked about
 * every word - including the four the language puts on every object whether a
 * program wrote them or not. A lookup written as an object literal answers for
 * those, and one did: `value.toString()` on a receiver of a described package
 * found `Object.prototype.toString`, and two `db_query` nodes labelled
 * `function toString() { [native code] }` went into novu's graph (R122).
 *
 * Asserted as "no node anywhere names this file" rather than as "no `db_query`
 * for this call", because the failure is a node minted from a value nobody read
 * and there is no reason to assume the next one will have the type the last one
 * had. Both fixture files hold module-level functions only, so a body there
 * earns a node exactly when a leaf is found in it and nothing else can make the
 * file appear.
 */
describe('a method every object has', () => {
  const NAMED_BY_NOBODY = [
    ['fn-data-layer', 'src/orders/prototype-names.ts'],
    ['nest-leaves', 'src/orders/prototype-names.ts'],
  ] as const;

  for (const [fixture, file] of NAMED_BY_NOBODY) {
    it(`produces no node anywhere in ${fixture}'s graph`, async () => {
      const graph = await graphOf(fixture);
      expect(graph.nodes.filter((node) => node.file === file)).toEqual([]);
    });
  }
});

/**
 * `knex.raw(sql)` is a statement when it runs on its own and a fragment of
 * another query when a builder takes it (R155).
 *
 * Before R155 every one of these calls was counted and nothing else: `raw` is
 * not an operation of the knex descriptor, so its SQL was never read. The text
 * is read with the reader the `pg` descriptor already uses, and where the call
 * sits decides whether it is a query at all.
 */
describe('the SQL handed to knex.raw', () => {
  const FILE = 'src/reports/reports.service.ts';

  it('reads each statement on its own, and each builder query once', async () => {
    const graph = await graphOf('nest-knex-raw');
    const read = queriesIn(graph, FILE).map((node) => [
      node.line,
      node.label,
      node.meta?.['tables'],
    ]);
    expect(read).toEqual([
      [14, 'read orders', ['orders']],
      [20, 'delete order_events', ['order_events']],
      [27, 'read orders', ['orders', 'customers']],
      [36, 'read orders', ['orders']],
      [44, 'read orders', ['orders']],
      [45, 'read refunds', ['refunds']],
      [52, 'access ?', []],
      [67, 'read orders', ['orders']],
      [78, 'read customers', ['customers']],
      [86, 'write orders', ['orders']],
      [98, 'read orders', ['orders', 'refunds']],
    ]);
  });

  it('says a statement whose table is computed could not be read, and nothing else', async () => {
    const graph = await graphOf('nest-knex-raw');
    // The call graph's own rows about the builder chain are another reader's.
    const rows = graph.unresolved
      .filter((row) => row.file === FILE && row.reason !== 'call-dynamic-receiver')
      .map((row) => [row.line, row.reason]);
    expect(rows).toEqual([[52, 'sql-parse-failed']]);
  });
});

/**
 * A call written against a method's name belongs to the method it dispatches
 * to (R158).
 *
 * Two providers implement one interface, each builds its address from `uid`,
 * and each calls itself through `this`. The compiler's references of one
 * provider's `deleteEvent` take in the interface member and, through it, the
 * other provider's calls, so basecamp's request was forwarded to zoho's
 * `this.deleteEvent('stale')` and to the manager's call through the interface,
 * and basecamp's own request went missing. On cal.com that was seven `GET ?`
 * rows at the wrong calendars and no `PUT .../trashed.json` at all.
 */
describe('a parameter forwarded through an interface method', () => {
  const requests = async (): Promise<string[]> => {
    const graph = await graphOf('nest-interface-dispatch');
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    return graph.edges
      .filter((edge) => edge.type === 'calls' && byId.get(edge.to)?.type === 'http_out')
      .map((edge) => `${edge.from.split(':').pop()} -> ${byId.get(edge.to)?.label}`)
      .sort();
  };

  it('reaches only the callers that run this implementation, and keeps its own request', async () => {
    expect(await requests()).toEqual(
      [
        // Called through the interface: either provider may run, so each keeps
        // the request it writes, with the hole where `uid` goes.
        'BasecampCalendarService.deleteEvent -> PUT /schedule_entries/:param/trashed.json',
        'ZohoCalendarService.deleteEvent -> DELETE /events/:param',
        // Called through `this`: the class's own implementation, and only it.
        'BasecampCalendarService.updateEvent -> PUT /schedule_entries/draft/trashed.json',
        'ZohoCalendarService.updateEvent -> DELETE /events/stale',
        // Called through the concrete class from elsewhere.
        'CalendarManagerService.archive -> PUT /schedule_entries/archived/trashed.json',
      ].sort(),
    );
  });
});

/**
 * A request credited to the caller that fills in its address keeps the verb
 * and the host it states itself (R161).
 *
 * Only the address used to be rebuilt at the caller. The verb came from the
 * caller's call - its name, or GET - so `fetch(url, { method: 'PUT' })` read as
 * GET, and a caller of a client method named `get` turned `axios.delete` into
 * GET. The host was read as the first segment of a path, `/https:/host/…`.
 */
describe('a request forwarded to its callers', () => {
  const requests = async (): Promise<string[]> => {
    const graph = await graphOf('nest-forwarded-verb');
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    return graph.edges
      .filter((edge) => edge.type === 'calls' && byId.get(edge.from)?.type === 'http_out')
      .map((edge) => {
        const request = byId.get(edge.from);
        const caller = graph.edges.find((item) => item.to === edge.from)?.from.split(':').pop();
        return `${caller} -> ${request?.label} @ ${byId.get(edge.to)?.label}`;
      })
      .sort();
  };

  it('keeps the verb and the host the request states', async () => {
    expect(await requests()).toEqual(
      [
        'ItemsService.restore -> PUT /items/featured @ api.example.com',
        'StockService.refill -> PUT /items/restocked @ api.example.com',
        // Through a client method named `get`: the request says DELETE.
        'ItemsService.purge -> DELETE /items/expired @ api.example.com',
        'StockService.retire -> DELETE /items/retired @ api.example.com',
        // `{ method: 'GET', ...init }` is a default the caller's settings
        // replace, so the caller's verb is the one sent.
        'StockService.archive -> POST /items/archive @ api.example.com',
      ].sort(),
    );
  });

  it('reads no body from a caller whose request carries its own settings', async () => {
    const graph = await graphOf('nest-forwarded-verb');
    const bodies = graph.nodes
      .filter((node) => node.type === 'http_out')
      .map((node) => node.meta?.bodyType ?? null);
    // The caller's second argument is `reason`, or the settings it hands
    // over; neither is a body.
    expect(bodies).toEqual([null, null, null, null, null]);
  });
});
