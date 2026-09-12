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

  it('loses only the operation when the package is not described', () => {
    const result = classifyDbCall({ method: 'find', origin: origin(), nameHints });
    expect(result).toMatchObject({ emit: true, table: 'Order', op: null, confidence: 'heuristic' });
    expect(result?.unresolved?.reason).toBe('unknown-db-package');
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

  it('falls back to the receiver name, and says that is all it had', () => {
    const result = classifyDbCall({
      method: 'find',
      origin: origin({ package: null, isLocal: true, typeName: 'OrdersRepository', typeArgs: [] }),
      receiverText: 'this.localRepo',
      nameHints,
    });
    expect(result).toMatchObject({ table: null, op: null, confidence: 'heuristic' });
    expect(result?.unresolved?.reason).toBe('db-receiver-name-only');
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
