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
