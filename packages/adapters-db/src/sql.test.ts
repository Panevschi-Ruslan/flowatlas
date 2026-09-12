import { describe, expect, it } from 'vitest';
import { sqlOperation, sqlTables } from './sql.js';

describe('reading tables out of a query', () => {
  it('finds the table a select reads from', () => {
    expect(sqlTables('SELECT id FROM orders WHERE status = $1')).toEqual(['orders']);
  });

  it('finds every table a join brings in', () => {
    expect(
      sqlTables('SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id'),
    ).toEqual(['orders', 'customers']);
  });

  it('finds the table an insert writes to', () => {
    expect(sqlTables('INSERT INTO orders (total) VALUES ($1)')).toEqual(['orders']);
  });

  it('finds the table an update writes to', () => {
    expect(sqlTables('UPDATE orders SET status = $1 WHERE id = $2')).toEqual(['orders']);
  });

  it('finds the table a delete removes from', () => {
    expect(sqlTables('DELETE FROM orders WHERE id = $1')).toEqual(['orders']);
  });

  it('drops the schema a name is qualified by', () => {
    expect(sqlTables('SELECT * FROM public.invoices')).toEqual(['invoices']);
  });

  it('unquotes a name however it was quoted', () => {
    expect(sqlTables('SELECT * FROM public."Invoices"')).toEqual(['invoices']);
    expect(sqlTables('SELECT * FROM `orders`')).toEqual(['orders']);
    expect(sqlTables('SELECT * FROM [orders]')).toEqual(['orders']);
  });

  it('does not report a name that exists only inside the query', () => {
    const tables = sqlTables(
      'WITH recent AS (SELECT * FROM orders WHERE created_at > now()) SELECT count(*) FROM recent',
    );
    expect(tables).toEqual(['orders']);
    expect(tables).not.toContain('recent');
  });

  it('reports each table once, in the order it appears', () => {
    expect(
      sqlTables('SELECT * FROM orders JOIN orders o2 ON o2.parent = orders.id JOIN customers c ON 1=1'),
    ).toEqual(['orders', 'customers']);
  });

  it('finds nothing in text that is not a query', () => {
    expect(sqlTables('not a query at all')).toEqual([]);
  });
});

describe('reading what a query does', () => {
  it.each([
    ['SELECT 1', 'read'],
    ['  select * from orders', 'read'],
    ['WITH x AS (SELECT 1) SELECT * FROM x', 'read'],
    ['INSERT INTO orders VALUES (1)', 'write'],
    ['UPDATE orders SET a = 1', 'write'],
    ['DELETE FROM orders', 'delete'],
    ['TRUNCATE orders', 'delete'],
  ])('reads %s as %s', (sql, expected) => {
    expect(sqlOperation(sql)).toBe(expected);
  });

  it('says nothing when the verb is not one it knows', () => {
    expect(sqlOperation('EXPLAIN ANALYZE SELECT 1')).toBeNull();
  });
});
