import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class OrdersService {
  private readonly pool = new Pool();

  // SELECT: table "orders", op read.
  findAll(): Promise<unknown> {
    return this.pool.query('SELECT id, total FROM orders WHERE status = $1', ['new']);
  }

  // JOIN: two tables, "orders" and "customers".
  findWithCustomer(id: string): Promise<unknown> {
    return this.pool.query(
      'SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1',
      [id],
    );
  }

  // INSERT INTO: table "orders", op write.
  create(total: number): Promise<unknown> {
    return this.pool.query('INSERT INTO orders (total) VALUES ($1) RETURNING id', [total]);
  }

  // UPDATE: table "orders", op write.
  markPaid(id: string): Promise<unknown> {
    return this.pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['paid', id]);
  }

  // DELETE FROM: table "orders", op delete.
  remove(id: string): Promise<unknown> {
    return this.pool.query('DELETE FROM orders WHERE id = $1', [id]);
  }

  // Schema-qualified and quoted names keep only the table itself: "invoices".
  invoices(): Promise<unknown> {
    return this.pool.query('SELECT * FROM public."invoices"');
  }

  // A name introduced by WITH is query-local. Only "orders" is a table here;
  // "recent" must not be reported as one.
  recentTotals(): Promise<unknown> {
    return this.pool.query(
      'WITH recent AS (SELECT * FROM orders WHERE created_at > now()) SELECT count(*) FROM recent',
    );
  }

  // The query is built at run time, so nothing can be read from it.
  // Expected: sql-parse-failed, node still emitted with no table.
  search(column: string, value: string): Promise<unknown> {
    return this.pool.query(`SELECT * FROM orders WHERE ${column} = $1`, [value]);
  }
}
