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
