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

describe('a table named by the configuration, at a client handed in (P44)', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile(
    '/src/members.ts',
    `
import { createClient, type DataClient } from '@acme/data-kit';
import type { DataClient as OtherClient } from '@acme/other-kit';
const shared = createClient();
type Client = ReturnType<typeof createClient>;
export const byReturnType = (db: ReturnType<typeof createClient>) => db.insert('members', {});
export const byAwaited = (db: Awaited<ReturnType<typeof createClient>> | undefined) => db?.findOne('teams', {});
export const byName = (db: DataClient) => db.insert('invites', {});
export const byTypeof = (db: typeof shared) => db.findOne('seats', {});
class Members {
  private readonly later: DataClient;
  constructor(private readonly db: DataClient, later: DataClient) { this.later = later; }
  save() { return this.db.insert('members', {}); }
  find() { return this.later.findOne('members', {}); }
}
export const lookalikes = (a: OtherClient, b: { insert(t: string, r: object): void }, c: Client) => {
  a.insert('nope', {});
  b.insert('nope', {});
  c.insert('aliased', {});
};
`,
  );
  const described = [
    { factory: 'createClient', clientType: 'DataClient', name: 'insert', package: '@acme/data-kit', table: 0, op: 'write' },
    { factory: 'createClient', clientType: 'DataClient', name: 'findOne', package: '@acme/data-kit', table: 0, op: 'read' },
  ].map((row) => dbTableAccessSchema.parse(row));

  it('follows a parameter or an injected field by its declared type, and leaves lookalikes alone', () => {
    const read = file
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .map((call) => configuredAccessOf(call, described))
      .flatMap((found) => (found === undefined ? [] : [`${found.op ?? '?'} ${found.table ?? '?'}`]));
    expect(read).toEqual([
      'write members',
      'read teams',
      'write invites',
      'read seats',
      'write members',
      'read members',
      'write aliased',
    ]);
  });
});

describe('a client handed in, by the type its factory resolves to return or a qualified name (P49)', () => {
  const read = (files: Record<string, string>, rows: Array<Record<string, unknown>>) => {
    const project = new Project({ useInMemoryFileSystem: true });
    for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
    const described = rows.map((row) => dbTableAccessSchema.parse(row));
    return project
      .getSourceFileOrThrow('/src/use.ts')
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .map((call) => configuredAccessOf(call, described))
      .flatMap((found) => (found === undefined ? [] : [`${found.op ?? '?'} ${found.table ?? '?'}`]));
  };

  it('matches a named interface against what an installed factory returns, with no clientType', () => {
    expect(
      read(
        {
          '/node_modules/@acme/data-kit/package.json': '{ "name": "@acme/data-kit", "types": "index.d.ts" }',
          '/node_modules/@acme/data-kit/index.d.ts': [
            'export interface Store { put(table: string, row: object): Promise<void>; }',
            'export interface Other { put(table: string, row: object): Promise<void>; }',
            'export declare function openStore(): Promise<Store>;',
          ].join('\n'),
          '/src/use.ts': [
            "import type { Store, Other } from '@acme/data-kit';",
            "export const save = (store: Store) => store.put('orders', {});",
            "export const not = (other: Other) => other.put('nope', {});",
          ].join('\n'),
        },
        [{ factory: 'openStore', name: 'put', package: '@acme/data-kit', table: 0, op: 'write' }],
      ),
    ).toEqual(['write orders']);
  });

  it("matches a repository factory's own interface from a file of its own, and nothing when the type does not resolve", () => {
    expect(
      read(
        {
          '/src/types.ts': 'export interface Store { put(table: string, row: object): void; }',
          '/src/store.ts': [
            "import type { Store } from './types';",
            'export const openStore = (): Store => ({ put: () => undefined });',
          ].join('\n'),
          '/src/use.ts': [
            "import type { Store } from './types';",
            "import type { Missing } from './missing';",
            "export const save = (store: Store) => store.put('orders', {});",
            "export const lost = (store: Missing) => store.put('nope', {});",
          ].join('\n'),
        },
        [{ factory: 'openStore', name: 'put', table: 0, op: 'write' }],
      ),
    ).toEqual(['write orders']);
  });

  it('matches a qualified kit.DataClient against clientType through a namespace import', () => {
    expect(
      read(
        {
          '/src/use.ts': [
            "import * as kit from '@acme/data-kit';",
            "import * as other from '@acme/other-kit';",
            "export const save = (db: kit.DataClient) => db.insert('orders', {});",
            "export const made = (db: ReturnType<typeof kit.createClient>) => db.insert('members', {});",
            "export const not = (db: other.DataClient) => db.insert('nope', {});",
          ].join('\n'),
        },
        [{ factory: 'createClient', clientType: 'DataClient', name: 'insert', package: '@acme/data-kit', table: 0, op: 'write' }],
      ),
    ).toEqual(['write orders', 'write members']);
  });
});
