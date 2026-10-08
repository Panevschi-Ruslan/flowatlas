import { dbTableAccessSchema } from '@flowatlas/core';
import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { configuredAccessOf } from './configured.js';

const SOURCE = `
import { insert, findOne as lookUp } from '@acme/data-kit';
import * as kit from '@acme/data-kit';
const ORDERS = 'orders';
const auditLog = (event: string) => event;
export const run = async (year: number) => {
  await insert(ORDERS, {});
  await lookUp('customers', {});
  await kit.remove('orders', {});
  await insert(\`orders_\${year}\`, {});
  auditLog('x');
  const insertLocal = (table: string) => table;
  insertLocal('orders');
};
export const shadowed = () => {
  const insert = (table: string) => table;
  return insert('orders');
};
`;

const DESCRIBED = [
  { name: 'insert', package: '@acme/data-kit', table: 0, op: 'write' },
  { name: 'findOne', package: '@acme/data-kit', table: 0, op: 'read' },
  { name: 'remove', package: '@acme/data-kit', table: 0, op: 'delete' },
  { name: 'auditLog', table: 'audit_events', op: 'write' },
].map((row) => dbTableAccessSchema.parse(row));

describe('a table named by the configuration, at a call to the function it names (P37)', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('/src/orders.ts', SOURCE);
  const read = () =>
    file
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .map((call) => [call.getExpression().getText(), configuredAccessOf(call, DESCRIBED)] as const)
      .map(([callee, found]) => [callee, found === undefined ? undefined : `${found.op ?? '?'} ${found.table ?? '?'}`]);

  it('reads the table at the argument, through a constant, an alias and a namespace, with nothing installed', () => {
    expect(read()).toEqual([
      ['insert', 'write orders'],
      ['lookUp', 'read customers'],
      ['kit.remove', 'delete orders'],
      ['insert', 'write ?'],
      ['auditLog', 'write audit_events'],
      ['insertLocal', undefined],
      ['insert', undefined],
    ]);
  });
});

describe('a table named by the configuration, at a method of a client a factory made (P39)', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile(
    '/src/orders.ts',
    `
import { createClient } from '@acme/data-kit';
import * as kit from '@acme/data-kit';
const db = createClient();
class Orders {
  private store = kit.createClient();
  save() { return this.store.insert('orders', {}); }
}
export const run = async () => {
  const pooled = await createClient();
  db.insert('orders', {});
  pooled.findOne('customers', {});
  createClient().insert('audit', {});
  const other = { insert: (table: string) => table };
  other.insert('orders');
  return new Orders().save();
};
`,
  );
  const described = [
    { factory: 'createClient', name: 'insert', package: '@acme/data-kit', table: 0, op: 'write' },
    { factory: 'createClient', name: 'findOne', package: '@acme/data-kit', table: 0, op: 'read' },
  ].map((row) => dbTableAccessSchema.parse(row));

  it('follows the receiver to the factory call, through a const, an await, a field and a chain', () => {
    const read = file
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .map((call) => configuredAccessOf(call, described))
      .flatMap((found) => (found === undefined ? [] : [`${found.op ?? '?'} ${found.table ?? '?'}`]));
    expect(read).toEqual(['write orders', 'write orders', 'read customers', 'write audit']);
  });
});
