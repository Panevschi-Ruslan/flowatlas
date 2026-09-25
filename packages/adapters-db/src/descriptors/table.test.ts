import { Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { knexDescriptor, tableLocators } from './index.js';
import { locateTable, type TableLocator } from './table.js';

/**
 * Enough of each library to write the call the way its users write it.
 *
 * Declared here rather than imported, because what is being tested is the walk
 * from a call to the expression that names its table, and that walk reads the
 * source rather than the types. The shapes still match the real libraries so
 * that a case reads as the code somebody would actually write.
 */
const HEADER = `
declare class PgTable {}
declare function pgTable(name: string, columns: Record<string, unknown>): PgTable;
declare class SelectBuilder {
  from(table: PgTable): SelectBuilder;
  where(condition: unknown): SelectBuilder;
  limit(count: number): Promise<unknown[]>;
}
declare class InsertBuilder { values(row: unknown): Promise<unknown>; }
declare class Db {
  select(): SelectBuilder;
  insert(table: PgTable): InsertBuilder;
  delete(table: PgTable): Promise<unknown>;
}
declare const db: Db;

interface QueryBuilder {
  from(table: string): QueryBuilder;
  where(condition: unknown): QueryBuilder;
  orderBy(column: string): QueryBuilder;
  select(...columns: string[]): Promise<unknown[]>;
  count(column?: string): QueryBuilder;
  first(): Promise<unknown>;
}
declare const knex: (table: string) => QueryBuilder;
declare const knexdb: { select(...c: string[]): QueryBuilder; count(c?: string): QueryBuilder };

declare class Schema<T> {}
interface MongooseModel<T> {
  new (doc: unknown): { save(): Promise<T> };
  find(filter?: unknown): Promise<T[]>;
}
declare function model<T>(collection: string, schema: Schema<T>): MongooseModel<T>;

declare class SequelizeModel {
  static init(attributes: unknown, options: unknown): void;
  static findAll(): Promise<unknown[]>;
}
declare const connection: { define(name: string, attributes: unknown): typeof SequelizeModel };
`;

const parse = (source: string): SourceFile =>
  new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', `${HEADER}${source}`);

/** The call named by `method`, which is the one each case is about. */
const callTo = (file: SourceFile, method: string): CallExpression => {
  const call = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((item) => item.getExpression().getText().endsWith(`.${method}`));
  if (call === undefined) throw new Error(`no .${method}() in the source`);
  return call;
};

/**
 * The operations knex's descriptor lists, which the chain-root locator asks
 * about to tell a builder made from a table apart from one made by a query.
 * The other three libraries never reach that question, so they are given the
 * same answer and it makes no difference to them.
 */
const isKnexOperation = (method: string): boolean => knexDescriptor.operations[method] !== undefined;

const table = (source: string, method: string, locators: readonly TableLocator[]): string | null =>
  locateTable(callTo(parse(source), method), locators, isKnexOperation);

const DRIZZLE = tableLocators['drizzle-orm']!;
const KNEX = tableLocators['knex']!;
const MONGOOSE = tableLocators['mongoose']!;
const SEQUELIZE = tableLocators['sequelize']!;

describe('finding the table a drizzle call touches', () => {
  const schema = `const orders = pgTable('orders', {});\n`;

  it('reads the argument of the call that carries the operation', () => {
    expect(table(`${schema}db.insert(orders).values({});`, 'insert', DRIZZLE)).toBe('orders');
  });

  it('reads the argument of the from that follows a select', () => {
    expect(table(`${schema}db.select().from(orders).limit(1);`, 'select', DRIZZLE)).toBe('orders');
  });

  it('finds the from however long the chain after it is', () => {
    const source = `${schema}db.select().from(orders).where(1).where(2).limit(1);`;
    expect(table(source, 'select', DRIZZLE)).toBe('orders');
  });

  it('gives the name the schema was declared with, not the name of the constant', () => {
    const source = `const ordersTable = pgTable('orders', {});\ndb.insert(ordersTable).values({});`;
    expect(table(source, 'insert', DRIZZLE)).toBe('orders');
  });

  it('answers with nothing when the table is a parameter', () => {
    const source = `function purge(t: PgTable) { return db.delete(t); }`;
    expect(table(source, 'delete', DRIZZLE)).toBeNull();
  });
});

describe('finding the table a knex chain started from', () => {
  it('reads the literal the builder was made with', () => {
    expect(table(`knex('users').select('id');`, 'select', KNEX)).toBe('users');
  });

  it('walks back past every method chained onto the builder', () => {
    const source = `knex('users').where({}).orderBy('email').first();`;
    expect(table(source, 'first', KNEX)).toBe('users');
  });

  it('follows a constant to the string it holds', () => {
    expect(table(`const USERS = 'users';\nknex(USERS).select('id');`, 'select', KNEX)).toBe('users');
  });

  it('stops at the root when the builder is reached through a property', () => {
    // `this.db('users')` is a call on a property, and a walk that treated the
    // property as another link of the chain walked past the root.
    const source = `class S { db = knex; go() { return this.db('users').where({}).first(); } }`;
    expect(table(source, 'first', KNEX)).toBe('users');
  });

  it('prefers the from over the call the chain started from', () => {
    // The shape directus writes everywhere: the chain starts from the columns
    // and names the table halfway along. Asking the root first read `id` as the
    // name of a table on most of a real repository's queries.
    const source = `knexdb.select('id').from('users').first();`;
    expect(table(source, 'first', KNEX)).toBe('users');
    expect(table(source, 'select', KNEX)).toBe('users');
  });

  it('keeps the table and drops the alias a self-join gave it', () => {
    // One real repository had `directus_sessions`, `directus_sessions AS s` and
    // `directus_sessions as s` in its graph as three tables.
    expect(table(`knex('sessions AS s').first();`, 'first', KNEX)).toBe('sessions');
    expect(table(`knexdb.select('id').from('sessions as s').first();`, 'first', KNEX)).toBe(
      'sessions',
    );
  });

  it('answers with nothing when the chain starts from an operation rather than a table', () => {
    // `count('*')` makes the builder here, and reading its argument as a table
    // put the counted column in the graph under a name that looked like one.
    expect(table(`knexdb.count('*').first();`, 'first', KNEX)).toBeNull();
  });

  it('answers with nothing when the table is decided by the caller', () => {
    const source = `function purge(t: string) { return knex(t).select('id'); }`;
    expect(table(source, 'select', KNEX)).toBeNull();
  });
});

describe('finding the collection a mongoose model stands for', () => {
  const declared = `const schema = new Schema<{ id: string }>();\nconst OrderModel = model('orders', schema);\n`;

  it('reads the string the model was declared with', () => {
    expect(table(`${declared}OrderModel.find({});`, 'find', MONGOOSE)).toBe('orders');
  });

  it('follows a document back to the model it was made from', () => {
    const source = `${declared}const doc = new OrderModel({});\ndoc.save();`;
    expect(table(source, 'save', MONGOOSE)).toBe('orders');
  });

  it('answers with nothing when the model is chosen by name at run time', () => {
    const source = `declare const models: Record<string, MongooseModel<unknown>>;\nfunction go(n: string) { return models[n].find({}); }`;
    expect(table(source, 'find', MONGOOSE)).toBeNull();
  });
});

describe('finding the table a sequelize model stands for', () => {
  it('reads the table name its init stated', () => {
    const source = `
      class Invoice extends SequelizeModel {}
      Invoice.init({}, { sequelize: connection, modelName: 'invoice', tableName: 'invoices' });
      Invoice.findAll();
    `;
    expect(table(source, 'findAll', SEQUELIZE)).toBe('invoices');
  });

  it('falls back to the model name when no table name was stated', () => {
    const source = `
      class Invoice extends SequelizeModel {}
      Invoice.init({}, { sequelize: connection, modelName: 'invoice' });
      Invoice.findAll();
    `;
    expect(table(source, 'findAll', SEQUELIZE)).toBe('invoice');
  });

  it('reads the options one property at a time, so an unreadable one loses nothing', () => {
    // The connection in the same object is not a static value, and reading the
    // object as a whole lost the property that was the answer.
    const source = `
      class Invoice extends SequelizeModel {}
      Invoice.init({}, { sequelize: connection, tableName: 'invoices' });
      Invoice.findAll();
    `;
    expect(table(source, 'findAll', SEQUELIZE)).toBe('invoices');
  });

  it('reads a table name the class states itself', () => {
    const source = `
      class Invoice extends SequelizeModel { static tableName = 'invoices'; }
      Invoice.findAll();
    `;
    expect(table(source, 'findAll', SEQUELIZE)).toBe('invoices');
  });

  it('reads the first argument of a define', () => {
    const source = `const Payment = connection.define('payments', {});\nPayment.findAll();`;
    expect(table(source, 'findAll', SEQUELIZE)).toBe('payments');
  });

  it('answers with nothing when the model is chosen by name at run time', () => {
    const source = `
      declare const models: Record<string, typeof SequelizeModel>;
      function go(n: string) { return models[n].findAll(); }
    `;
    expect(table(source, 'findAll', SEQUELIZE)).toBeNull();
  });
});
