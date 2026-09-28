import { describe, expect, it } from 'vitest';
import { isValuePosition, sqlOperation, sqlTables } from './sql.js';

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

describe('names a WITH clause introduces (R155)', () => {
  it('leaves out every one of them, not only the first', () => {
    expect(
      sqlTables(
        'WITH a AS (SELECT id FROM orders), b AS (SELECT id FROM refunds) SELECT * FROM a JOIN b ON a.id = b.id',
      ),
    ).toEqual(['orders', 'refunds']);
  });

  it('leaves out one written with its columns, and one that is recursive', () => {
    expect(
      sqlTables(
        'WITH input_pairs(product_id, option_id) AS (VALUES (?, ?)) SELECT * FROM product_option po JOIN input_pairs ip ON ip.option_id = po.id',
      ),
    ).toEqual(['product_option']);
    expect(
      sqlTables(
        'WITH RECURSIVE tree AS (SELECT id FROM roles UNION ALL SELECT r.id FROM roles r JOIN tree t ON t.id = r.parent_id) SELECT * FROM tree',
      ),
    ).toEqual(['roles']);
  });
});

describe('where a substitution can only be a value (R155)', () => {
  it.each([
    "SELECT * FROM orders WHERE region = '",
    'SELECT * FROM orders WHERE id = ',
    'SELECT * FROM orders WHERE total >= ',
    'SELECT * FROM orders WHERE name ILIKE ',
    'SELECT * FROM orders LIMIT ',
    'SELECT * FROM orders WHERE id IN (',
    'SELECT * FROM orders WHERE id IN (1, ',
    'INSERT INTO orders (a, b) VALUES (',
    'WITH input_pairs(a, b) AS (VALUES ',
  ])('takes the hole after %j for a value', (before) => {
    expect(isValuePosition(before)).toBe(true);
  });

  it.each([
    'SELECT * FROM ',
    'SELECT * FROM orders JOIN ',
    'SELECT * FROM orders WHERE ',
    'SELECT * FROM orders WHERE a = 1 AND ',
    'SELECT * FROM (',
    'SELECT a, ',
    'INSERT INTO orders (a, ',
    'SELECT * FROM orders WHERE id IN (SELECT id FROM ',
    '"',
  ])('does not take the hole after %j for one', (before) => {
    expect(isValuePosition(before)).toBe(false);
  });
});
