import { describe, expect, it } from 'vitest';
import type { Type } from 'ts-morph';
import type { TypeOrigin } from '../origin.js';
import { classifyDbCall, operationOf, type DbDescriptor } from './db.js';

const nameHints = { receiver: /(repository|repo|store)$/i, type: /(repository|repo|store)$/i };

/** A type argument that reports the given name, which is all the classifier reads. */
const entityArg = (name: string): Type =>
  ({
    getSymbol: () => ({ getName: () => name }),
    isUnion: () => false,
    isTypeParameter: () => false,
  }) as unknown as Type;

const origin = (over: Partial<TypeOrigin> = {}): TypeOrigin => ({
  package: 'some-orm',
  typeName: 'Repository',
  typeArgs: [entityArg('Order')],
  isLocal: false,
  ...over,
});

const descriptor: DbDescriptor = {
  package: 'some-orm',
  operations: { find: 'read', save: 'write', remove: 'delete', 'list*': 'read' },
};

describe('operationOf', () => {
  it('prefers an exact name', () => {
    expect(operationOf(descriptor, 'find')).toBe('read');
  });

  it('falls back to a prefix', () => {
    expect(operationOf(descriptor, 'listActiveForUser')).toBe('read');
  });

  it('prefers the longest prefix that matches', () => {
    const layered: DbDescriptor = {
      package: 'x',
      operations: { 'set*': 'write', 'setup*': 'read' },
    };
    expect(operationOf(layered, 'setupIndexes')).toBe('read');
    expect(operationOf(layered, 'setStatus')).toBe('write');
  });

  it('says nothing about a method it does not know', () => {
    expect(operationOf(descriptor, 'explain')).toBeNull();
  });

  // Both are methods real code calls on a real value, and a record written as an
  // object literal answers them with the language's own. novu carried two query
  // nodes labelled with the text of a native function until this was own-keys.
  it('says nothing about a name the language answers for every object', () => {
    expect(operationOf(descriptor, 'toString')).toBeNull();
    expect(operationOf(descriptor, 'constructor')).toBeNull();
  });
});

describe('classifying a call', () => {
  it('is certain when the package is described and the entity is in the types', () => {
    const result = classifyDbCall({ method: 'find', origin: origin(), descriptor });
    expect(result).toMatchObject({
      emit: true,
      table: 'Order',
      op: 'read',
      confidence: 'static',
      source: 'type-arg',
    });
  });

  /**
   * A package nobody has described is a package whose type parameters nobody
   * here can read, so the row is the whole answer.
   *
   * `Kysely<DB>` is a connection typed by the whole schema, and reading its type
   * argument gave immich two table nodes with 407 `queries` edges pointing at
   * them, beside 407 rows saying the package was not understood (R83).
   */
  it('names no table when the package is not described, and says so', () => {
    const result = classifyDbCall({ method: 'find', origin: origin(), nameHints });
    expect(result).toMatchObject({
      emit: true,
      table: null,
      tables: [],
      op: null,
      confidence: 'heuristic',
    });
    expect(result?.unresolved?.reason).toBe('unknown-db-package');
  });

  /**
   * The row does not depend on the type argument being a table.
   *
   * PeerTube's model base is parameterised by a generic helper of the ORM's own
   * typings, which is a name and is not a table. Reading this row's condition off
   * the table would have thrown away 1,949 of them the moment the name stopped
   * being one (R83).
   */
  it('still reports an undescribed data layer whose type argument is not its table', () => {
    const result = classifyDbCall({
      method: 'findAll',
      origin: origin({ typeName: 'Model' }),
      nameHints: { type: /model$/i },
      entityFromPackage: true,
    });
    expect(result).toMatchObject({ emit: true, table: null });
    expect(result?.unresolved?.reason).toBe('unknown-db-package');
  });

  /**
   * A described library still only names a table the repository declares.
   *
   * A base class of one's own over an ORM's `Model` is parameterised by the
   * ORM's own helper, and following that argument named 1,898 of PeerTube's
   * 1,958 queries after a type in `node_modules`: one table node standing for a
   * hundred real tables (R83).
   */
  it('will not take a table name from a type the repository does not declare', () => {
    const result = classifyDbCall({
      method: 'find',
      origin: origin({ typeArgs: [entityArg('AttributesOnly')] }),
      descriptor,
      entityFromPackage: true,
    });
    expect(result).toMatchObject({ emit: true, table: null, tables: [], op: 'read' });
  });

  it('will not call an unfamiliar package a data layer on the strength of a type argument alone', () => {
    expect(
      classifyDbCall({
        method: 'toString',
        origin: origin({ typeName: 'Buffer', package: '@types/node' }),
        receiverText: 'file.buffer',
        nameHints,
      }),
    ).toBeNull();
  });

  /**
   * A name is not evidence, so the row stands alone.
   *
   * 463 of the 1,153 nodes this minted on immich were the job queue, the event
   * bus, the filesystem, ffmpeg and child_process, because that repository names
   * every adapter `Repository` (R83).
   */
  it('reports a receiver it only recognised by name, and draws nothing', () => {
    const result = classifyDbCall({
      method: 'find',
      origin: origin({ package: null, isLocal: true, typeName: 'OrdersRepository', typeArgs: [] }),
      receiverText: 'this.localRepo',
      nameHints,
    });
    expect(result).toMatchObject({ emit: false, table: null, op: null, confidence: 'heuristic' });
    expect(result?.unresolved?.reason).toBe('db-receiver-name-only');
    expect(result?.unresolved?.hint).toContain('declared in this repository');
    expect(result?.unresolved?.hint).toContain('localBaseClasses');
  });

  /**
   * Advice a reader can act on, which depends on who declared the type.
   *
   * The only row this produced on one real repository named a type a framework
   * declares and told the reader to name its base class in their own
   * configuration — a thing they cannot do, on a list whose whole value is that
   * everything in it can be done (R64).
   */
  it('does not tell a reader to configure a type a package declares', () => {
    const result = classifyDbCall({
      method: 'set',
      origin: origin({ package: 'some-framework', typeName: 'ReadonlyStore', typeArgs: [] }),
      receiverText: 'cookieStore',
      nameHints,
    });
    expect(result?.unresolved?.reason).toBe('db-receiver-name-only');
    expect(result?.unresolved?.hint).toContain('the some-framework package declares');
    expect(result?.unresolved?.hint).not.toContain('localBaseClasses');
  });

  /**
   * A wrapper in a sibling package, which the checker reaches through a link and
   * so reads as local. Local to the project, not to the service, and the row
   * used to say "declared in this repository" of a class that is not (R97).
   */
  it('names the workspace package a wrapper is declared in, since naming it is the fix', () => {
    const result = classifyDbCall({
      method: 'findOrders',
      origin: origin({ package: null, isLocal: true, typeName: 'Database', typeArgs: [] }),
      receiverText: 'ordersRepo',
      nameHints,
      workspacePackage: '@acme/db',
    });
    expect(result?.unresolved?.reason).toBe('db-receiver-name-only');
    expect(result?.unresolved?.hint).toContain('the workspace package @acme/db declares');
    expect(result?.unresolved?.hint).toContain('adapters.db.localBaseClasses');
    expect(result?.unresolved?.hint).not.toContain('declared in this repository');
  });

  it('says so when the type came from the language itself', () => {
    const result = classifyDbCall({
      method: 'get',
      origin: origin({ package: null, isLocal: false, typeName: '__type', typeArgs: [] }),
      receiverText: 'cookieStore',
      nameHints,
    });
    expect(result?.unresolved?.hint).toContain("language's own library");
    expect(result?.unresolved?.hint).not.toContain('localBaseClasses');
  });

  it('still asks for an install when nothing resolved at all', () => {
    const result = classifyDbCall({
      method: 'find',
      origin: null,
      receiverText: 'this.localRepo',
      nameHints,
    });
    expect(result?.unresolved?.hint).toContain("Install the repository's dependencies");
  });

  it('does not mistake a static helper on a class for a use of one', () => {
    expect(
      classifyDbCall({
        method: 'coerce',
        origin: origin({ package: null, isLocal: true, typeName: 'BaseRepository', typeArgs: [] }),
        receiverText: 'BaseRepository',
        nameHints,
      }),
    ).toBeNull();
  });

  it('says nothing at all when there is no signal', () => {
    expect(classifyDbCall({ method: 'log', origin: null, receiverText: 'this.logger', nameHints })).toBeNull();
  });

  it('takes the table from the property when the descriptor says to', () => {
    const byProperty: DbDescriptor = {
      package: 'client',
      tableOverride: { kind: 'receiver-prop' },
      operations: { findMany: 'read' },
    };
    expect(
      classifyDbCall({
        method: 'findMany',
        origin: origin({ package: 'client', typeArgs: [] }),
        descriptor: byProperty,
        receiverProp: 'order',
      }),
    ).toMatchObject({ table: 'order', op: 'read', source: 'receiver-prop', confidence: 'static' });
  });

  it('takes the tables from a query when the descriptor says to', () => {
    const pg: DbDescriptor = {
      package: 'pg',
      tableOverride: { kind: 'sql-parse', argIndex: 0 },
      operations: { query: 'read' },
    };
    expect(
      classifyDbCall({
        method: 'query',
        origin: origin({ package: 'pg', typeArgs: [] }),
        descriptor: pg,
        sqlTables: ['orders', 'customers'],
        sqlOp: 'read',
      }),
    ).toMatchObject({ table: 'orders', tables: ['orders', 'customers'], op: 'read' });
  });

  it('still records a query it could not read, and says so', () => {
    const pg: DbDescriptor = {
      package: 'pg',
      tableOverride: { kind: 'sql-parse', argIndex: 0 },
      operations: { query: 'read' },
    };
    const result = classifyDbCall({
      method: 'query',
      origin: origin({ package: 'pg', typeArgs: [] }),
      descriptor: pg,
      sqlTables: [],
      sqlOp: null,
    });
    expect(result).toMatchObject({ emit: true, table: null, confidence: 'heuristic' });
    expect(result?.unresolved?.reason).toBe('sql-parse-failed');
  });

  it('does not invent a query for a method the descriptor does not list', () => {
    const result = classifyDbCall({ method: 'connect', origin: origin(), descriptor });
    expect(result).toMatchObject({ emit: false, table: null });
    expect(result?.unresolved).toBeUndefined();
  });

  it('drops the persistence suffix but remembers the declared name', () => {
    const result = classifyDbCall({
      method: 'find',
      origin: origin({ typeArgs: [entityArg('OrderDocument')] }),
      descriptor,
    });
    expect(result).toMatchObject({ table: 'Order', entityType: 'OrderDocument' });
  });

  it('treats a repository base named in the configuration like a described package', () => {
    const local: DbDescriptor = { package: 'local', operations: { 'find*': 'read' } };
    expect(
      classifyDbCall({
        method: 'findByDepot',
        origin: origin({ package: 'local:BaseRepository', isLocal: true }),
        descriptor: local,
      }),
    ).toMatchObject({ table: 'Order', op: 'read', confidence: 'static' });
  });
});
