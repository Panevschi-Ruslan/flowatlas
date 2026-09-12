import { resolve } from 'node:path';
import { AdapterRegistry, parseConfig, type FlowatlasConfig, type RepoGraph } from '@flowatlas/core';
import { extractRepo } from '@flowatlas/extractor-nestjs';
import { Project, type ClassDeclaration } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { dataNameHints } from '../descriptors/index.js';
import { registerDbAdapters } from '../index.js';
import { leavesPass } from '../leaves-pass.js';
import { dataLayerOf } from './silence.js';

const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures');

/** The vocabulary the pass itself uses, so these cases are the real ones. */
const readsAsData = (name: string): boolean => dataNameHints.type.test(name);

const classes = (source: string): ((name: string) => ClassDeclaration) => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(
    '/node_modules/orm/index.d.ts',
    'export declare class Repository<T> { find(): T[] }',
  );
  const file = project.createSourceFile('/a.ts', source);
  return (name) => {
    const found = file.getClass(name);
    if (found === undefined) throw new Error(`no class ${name} in the source`);
    return found;
  };
};

describe('what a reader would name to make a data layer visible', () => {
  it('answers with the outermost class in the chain that reads as one', () => {
    const of = classes(`
      abstract class MongoStore<T> {}
      class OrderStore extends MongoStore<{ id: string }> {}
      class ArchivedOrderStore extends OrderStore {}
    `);
    expect(dataLayerOf(of('ArchivedOrderStore'), readsAsData)?.base.getName()).toBe('MongoStore');
  });

  it('answers with the class itself when it stands alone', () => {
    const of = classes('class OrdersRepository { find() {} }');
    const layer = dataLayerOf(of('OrdersRepository'), readsAsData);
    expect(layer?.base.getName()).toBe('OrdersRepository');
    expect(layer?.chain).toEqual(['OrdersRepository']);
  });

  it('answers with nothing when no name in the chain reads as a data layer', () => {
    const of = classes(`
      abstract class Base {}
      class OrdersService extends Base {}
    `);
    expect(dataLayerOf(of('OrdersService'), readsAsData)).toBeUndefined();
  });

  it('stops at the first class a package declares, since origin already answers for those', () => {
    const of = classes(`
      import { Repository } from 'orm';
      class OrdersRepo extends Repository<{ id: string }> {}
    `);
    // `Repository` reads as a data layer but belongs to `orm`, so it is not
    // something to name in the configuration.
    expect(dataLayerOf(of('OrdersRepo'), readsAsData)?.base.getName()).toBe('OrdersRepo');
  });
});

const graphOf = async (fixture: string, config?: FlowatlasConfig): Promise<RepoGraph> =>
  extractRepo({
    rootDir: resolve(FIXTURES, fixture),
    repo: fixture,
    registry: registerDbAdapters(new AdapterRegistry()),
    extraPasses: [leavesPass],
    ...(config === undefined ? {} : { config }),
  });

const dbRows = (graph: RepoGraph) => graph.unresolved.filter((row) => row.reason.startsWith('db-'));

const count = (graph: RepoGraph, type: string): number =>
  graph.nodes.filter((node) => node.type === type).length;

describe('a data layer nothing recognised', () => {
  it('is reported once, naming the class and the key to put it in', async () => {
    const graph = await graphOf('nest-hidden-db');

    // Nothing is invented from a name: the operations stay out of the graph.
    expect(count(graph, 'db_query')).toBe(0);
    expect(count(graph, 'table')).toBe(0);

    expect(dbRows(graph)).toHaveLength(1);
    const [row] = dbRows(graph);
    expect(row?.reason).toBe('db-layer-unread');
    expect(row?.symbol).toBe('MongoStore');
    expect(row?.file).toBe('src/data/mongo-store.ts');
    expect(row?.hint).toContain('adapters.db.localBaseClasses');
    expect(row?.hint).toContain('"MongoStore"');
  });

  it('says nothing once the base class is named, and reads the operations instead', async () => {
    const config = parseConfig({ adapters: { db: { localBaseClasses: ['MongoStore'] } } });
    const graph = await graphOf('nest-hidden-db', config);

    expect(dbRows(graph)).toEqual([]);
    expect(count(graph, 'db_query')).toBe(2);
    expect(count(graph, 'table')).toBe(1);
  });

  it('says nothing about a service that genuinely stores nothing', async () => {
    const graph = await graphOf('nest-no-data');

    // The shape a rule phrased as "providers and no leaves" would nag about.
    expect(count(graph, 'provider')).toBeGreaterThan(0);
    expect(count(graph, 'db_query') + count(graph, 'http_out') + count(graph, 'config_key')).toBe(0);
    expect(graph.unresolved).toEqual([]);
  });

  it('says so when a database it is known to use produced nothing at all', async () => {
    // The same repository, told that it uses a database. Nothing in it is
    // named like a data layer, so the manifest is the only evidence there is.
    const config = parseConfig({ adapters: { force: { db: ['typeorm'] } } });
    const graph = await graphOf('nest-no-data', config);

    expect(dbRows(graph)).toHaveLength(1);
    const [row] = dbRows(graph);
    expect(row?.reason).toBe('db-package-unread');
    expect(row?.symbol).toBe('typeorm');
    expect(row?.hint).toContain('adapters.db.localBaseClasses');
  });
});
