import { resolve } from 'node:path';
import { AdapterRegistry, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { extractRepo } from '@flowatlas/extractor-nestjs';
import { describe, expect, it } from 'vitest';
import { registerDbAdapters } from './index.js';
import { explainedByEdge, leavesPass } from './leaves-pass.js';

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
    // which is the one thing `entityType` was ever about. Both classes state
    // their table with `@Entity(...)`, and the table is what they state (P88
    // D1), so both declared names differ from it now.
    const named = writes.filter((write) => write.meta?.['entityType'] !== undefined);
    expect(named.map((write) => [write.meta?.['table'], write.meta?.['entityType']]).sort()).toEqual([
      ['invoices', 'InvoiceEntity'],
      ['invoices', 'InvoiceEntity'],
      ['orders', 'Order'],
      ['orders', 'Order'],
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
 * `function toString() { [native code] }` went into a notification service's graph (R122).
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
 * A statement read in full that names no table is counted, and is not a
 * failure, whichever driver takes it (R162).
 *
 * `knex.raw('SELECT 1')` was counted after R155, while `pool.query('SELECT 1')`,
 * `pool.query('BEGIN')` and `pool.query('COMMIT')` each wrote
 * `sql-parse-failed`, whose hint says the text "is not a literal". Only the
 * statement whose table is computed is one the reader could not read.
 */
describe('a pg statement that names no table', () => {
  const FILE = 'src/orders/orders.service.ts';

  it('draws the statements that name a table, and nothing for the rest', async () => {
    const graph = await graphOf('pg-no-table');
    const read = queriesIn(graph, FILE).map((node) => [node.line, node.label]);
    expect(read).toEqual([
      [10, 'read orders'],
      [24, 'write orders'],
      [31, 'access ?'],
    ]);
  });

  it('writes a row only for the statement whose table is computed', async () => {
    const graph = await graphOf('pg-no-table');
    const rows = graph.unresolved
      .filter((row) => row.file === FILE)
      .map((row) => [row.line, row.reason]);
    expect(rows).toEqual([[31, 'sql-parse-failed']]);
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
 * and basecamp's own request went missing. On a scheduling app that was seven `GET ?`
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
        // Handed the verb by the caller (P91): the one it hands in, and none
        // where nothing can read what it hands in.
        'Restocker.restock -> PATCH /items/:param/stock @ api.example.com',
        'Restocker.settle -> ? /items/settlement @ api.example.com',
      ].sort(),
    );
  });

  it('reads no body from a caller whose request carries its own settings', async () => {
    const graph = await graphOf('nest-forwarded-verb');
    const bodies = graph.nodes
      .filter((node) => node.type === 'http_out')
      .map((node) => node.meta?.bodyType ?? null);
    // The caller's second argument is `reason`, or the settings it hands
    // over, or the path beside the verb it hands in; none is a body.
    expect(bodies).toEqual([null, null, null, null, null, null, null]);
  });
});

describe('tables named where they are set (P88)', () => {
  const recipes = (): Promise<RepoGraph> => graphOf('tables-set-elsewhere/recipes-api');
  const ratings = (): Promise<RepoGraph> => graphOf('tables-set-elsewhere/ratings-api');

  /** The query a method holds, by the method's label. */
  const queryOf = (graph: RepoGraph, holder: string): GraphNode | undefined => {
    const edge = graph.edges.find(
      (each) => each.type === 'calls' && each.from.endsWith(`:${holder}`) && each.to.startsWith('db_query:'),
    );
    return edge === undefined ? undefined : graph.nodes.find((node) => node.id === edge.to);
  };
  const confidenceInto = (graph: RepoGraph, query: GraphNode | undefined): string | undefined =>
    graph.edges.find((edge) => edge.to === query?.id && edge.type === 'calls')?.confidence;
  const rowsAt = (graph: RepoGraph, file: string, reason: string) =>
    graph.unresolved.filter((row) => row.file === file && row.reason === reason);
  const statsOf = (graph: RepoGraph): Record<string, unknown> =>
    (graph.nodes.find((node) => node.type === 'repo')?.meta?.['stats'] ?? {}) as Record<string, unknown>;

  it('lists no name-only row at a call drawn as a static edge into a repository method, and counts it', async () => {
    const graph = await recipes();
    expect(rowsAt(graph, 'src/recipes/recipes.service.ts', 'db-receiver-name-only')).toEqual([]);
    expect(statsOf(graph)['receiversExplainedByEdge']).toBe(1);
  });

  it('keeps the row where no edge explains the call', async () => {
    const graph = await ratings();
    const kept = rowsAt(graph, 'src/ratings/ratings.service.ts', 'db-receiver-name-only');
    expect(kept.map((row) => row.symbol)).toEqual(['this.reviewsRepository.recent']);
    expect(kept[0]?.meta).toEqual({ cause: 'data-layer-unnamed' });
    expect(statsOf(graph)['receiversExplainedByEdge']).toBe(1);
  });

  it('reads the field a subclass sets for a base nothing configures', async () => {
    const graph = await recipes();
    const list = queryOf(graph, 'RecipesService.list');
    expect(list?.meta).toMatchObject({ table: 'recipes', op: 'read', tableFrom: 'inferred-property' });
    expect(confidenceInto(graph, list)).toBe('static');
    expect(queryOf(graph, 'RecipesService.popular')?.meta).toMatchObject({ table: 'recipes' });
  });

  it('reads the field through two levels of bases', async () => {
    const graph = await recipes();
    for (const holder of ['RecipesService.cookbooks', 'RecipesService.newestCookbooks']) {
      expect(queryOf(graph, holder)?.meta).toMatchObject({ table: 'cookbooks', tableFrom: 'inferred-property' });
    }
  });

  it('lowers the confidence where the field is not readonly', async () => {
    const graph = await recipes();
    const tags = queryOf(graph, 'RecipesService.tags');
    expect(tags?.meta).toMatchObject({ table: 'tags', tableFrom: 'inferred-property' });
    expect(confidenceInto(graph, tags)).toBe('heuristic');
  });

  it('names the subclass whose field cannot be read', async () => {
    const graph = await recipes();
    const [row] = rowsAt(graph, 'src/recipes/recipes.service.ts', 'dynamic-table-name');
    expect(row?.level).toBeUndefined();
    expect(row?.hint).toContain('DraftsRepository sets collectionName');
  });

  it('keeps the base queries at info, declared for every class that extends them', async () => {
    const graph = await recipes();
    // Folded into one row: the two queries of the first base and the one of
    // the second, each written once for every class under it.
    const rows = graph.unresolved.filter((row) => row.reason === 'dynamic-table-name' && row.level === 'info');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ file: 'src/db/base.repository.ts', sites: 3 });
    expect(rows[0]?.hint).toContain('BaseRepository declares this query for every class that extends it');
  });

  it('reads the collection a helper method and a getter hand out', async () => {
    const graph = await recipes();
    expect(queryOf(graph, 'CommentsStore.add')?.meta).toMatchObject({ table: 'comments', op: 'write', tableFrom: 'helper' });
    expect(queryOf(graph, 'CommentsStore.forRecipe')?.meta).toMatchObject({ table: 'comments', op: 'read', tableFrom: 'helper' });
    // A helper whose table is its caller's argument stays a gap.
    expect(queryOf(graph, 'CommentsStore.flag')?.meta?.['table']).toBeNull();
    expect(rowsAt(graph, 'src/comments/comments.store.ts', 'dynamic-table-name')).toHaveLength(1);
  });

  it('names a manager call by the entity class it is handed', async () => {
    const graph = await ratings();
    expect(queryOf(graph, 'RatingsRepository.topRated')?.meta).toMatchObject({
      table: 'ratings',
      source: 'entity-arg',
      entityType: 'Rating',
    });
    expect(queryOf(graph, 'RatingsRepository.reviewersNamed')?.meta).toMatchObject({ table: 'Reviewer', source: 'entity-arg' });
    expect(queryOf(graph, 'RatingsRepository.reviewersNamed')?.meta?.['entityType']).toBeUndefined();
    expect(queryOf(graph, 'RatingsRepository.award')?.meta).toMatchObject({ table: 'reviewer_badges', op: 'write' });
    expect(queryOf(graph, 'RatingsRepository.award')?.meta?.['entityTypeId']).toBeTypeOf('string');
    expect(queryOf(graph, 'RatingsRepository.fromBuilder')?.meta).toMatchObject({ table: 'ratings', source: 'entity-arg' });
  });

  it('names the type-argument path the same way', async () => {
    const graph = await ratings();
    expect(queryOf(graph, 'RatingsService.all')?.meta).toMatchObject({ table: 'ratings', source: 'type-arg', entityType: 'Rating' });
    expect(queryOf(graph, 'RatingsRepository.count')?.meta).toMatchObject({ table: 'ratings', source: 'type-arg' });
    expect(queryOf(graph, 'RatingsRepository.badges')?.meta).toMatchObject({ table: 'reviewer_badges' });
    const tables = graph.nodes.filter((node) => node.type === 'table').map((node) => node.label).sort();
    expect(tables).toEqual(['Reviewer', 'ratings', 'reviewer_badges']);
  });

  it('keeps a sub-query and SQL built at run time as gaps', async () => {
    const graph = await ratings();
    const rows = rowsAt(graph, 'src/ratings/ratings.repository.ts', 'dynamic-table-name');
    expect(rows.map((row) => row.symbol).sort()).toEqual(['this.em.createQueryBuilder', 'this.em.query']);
    expect(queryOf(graph, 'RatingsRepository.nested')?.meta?.['source']).toBe('none');
  });
});

describe('explainedByEdge', () => {
  const method = (id: string, repo = 'shop'): GraphNode => ({ id, type: 'method', label: id.split(':').pop() ?? id, repo });
  const nodes = new Map([
    ['a', method('shop#a.ts:OrdersRepository.findOpen')],
    ['b', method('other#b.ts:OrdersRepository.findOpen', 'other')],
  ]);
  const nodeOf = (id: string): GraphNode | undefined => nodes.get(id);
  const edge = (to: string, confidence: 'static' | 'heuristic') =>
    ({ from: 'caller', to, type: 'calls', confidence, file: 'x.ts', line: 3 }) as const;

  it('answers for a static edge into a method of this repository, by place and method name', () => {
    const explained = explainedByEdge([edge('a', 'static')], nodeOf, 'shop');
    expect(explained('caller', 'x.ts', 3, 'findOpen')).toBe(true);
    expect(explained('caller', 'x.ts', 4, 'findOpen')).toBe(false);
    expect(explained('caller', 'x.ts', 3, 'findAll')).toBe(false);
  });

  it('does not answer for a heuristic edge, or one into another repository', () => {
    expect(explainedByEdge([edge('a', 'heuristic')], nodeOf, 'shop')('caller', 'x.ts', 3, 'findOpen')).toBe(false);
    expect(explainedByEdge([edge('b', 'static')], nodeOf, 'shop')('caller', 'x.ts', 3, 'findOpen')).toBe(false);
  });
});

/**
 * A worker's request through its binding, a client handed the verb, and a
 * request to exactly what a setting holds (P91).
 */
describe('requests the dead-routes fixture makes', () => {
  const requestsOf = (graph: RepoGraph) =>
    graph.nodes
      .filter((node) => node.type === 'http_out')
      .map((node): Record<string, unknown> => ({ line: node.line, ...node.meta }))
      .sort((a, b) => Number(a['line'] ?? 0) - Number(b['line'] ?? 0));

  it('records a request through a binding at its path, with the binding and no host', async () => {
    const graph = await graphOf('multi-repo-dead-routes/orders-worker');
    const [item, , restock] = requestsOf(graph);
    expect(item).toMatchObject({ method: 'GET', path: '/items/:param', binding: 'CATALOG' });
    expect(item?.['host']).toBeUndefined();
    // Handed the verb by its caller, and its second argument is the wrapper's path, not a body.
    expect(restock).toMatchObject({ method: 'PATCH', path: '/items/:param', binding: 'CATALOG', bodyType: null });
    expect(graph.nodes.some((node) => node.type === 'external_api')).toBe(false);
  });

  it('records the annotation a function carries in JSDoc as the decorator it stands for', async () => {
    const graph = await graphOf('multi-repo-dead-routes/orders-worker');
    const fn = graph.nodes.find((node) => node.type === 'function' && node.label === 'allItems');
    expect(fn?.meta?.['markers']).toEqual([{ name: 'CallsService', args: ['catalog', 'GET /items'] }]);
  });

  it('records a request to exactly what a setting holds as rooted at it, with nothing more to its path', async () => {
    const graph = await graphOf('multi-repo-dead-routes/ops-scripts');
    expect(requestsOf(graph)).toEqual([expect.objectContaining({ method: 'POST', path: '', baseUrlEnv: 'REINDEX_URL' })]);
    expect(graph.unresolved.map((row) => row.reason)).not.toContain('dynamic-http-url');
  });
});
