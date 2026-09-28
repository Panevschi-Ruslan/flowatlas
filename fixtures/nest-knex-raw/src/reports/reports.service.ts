import { Injectable } from '@nestjs/common';
import { knex } from 'knex';

/** A table named once and substituted into a statement, which is still a literal. */
const ORDERS = 'orders';

@Injectable()
export class ReportsService {
  private readonly db = knex();

  // A statement on its own, awaited where it is written. The SQL is a literal.
  // Expected: read `orders`.
  open(status: string): Promise<unknown> {
    return this.db.raw('SELECT id, total FROM orders WHERE status = ?', [status]);
  }

  // A delete, written as a statement rather than as a builder.
  // Expected: delete `order_events`.
  async prune(before: Date): Promise<void> {
    await this.db.raw('DELETE FROM order_events WHERE created_at < ?', [before]);
  }

  // A template whose substitutions are all values: one inside a quoted string,
  // one after `=`, one after `LIMIT`. None of them can name a table.
  // Expected: read `orders` and `customers`.
  forCustomer(customerId: string, region: string, limit: number): Promise<unknown> {
    return this.db.raw(
      `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE c.region = '${region}' AND o.customer_id = ${customerId} LIMIT ${limit}`,
    );
  }

  // A template whose substitution is a constant, which is a literal written in
  // two places. Expected: read `orders`.
  total(): Promise<unknown> {
    return this.db.raw(`SELECT count(*) FROM ${ORDERS}`);
  }

  // Statements handed to the language's own `Promise.all`, which is not a
  // builder: each of them is still a statement of its own.
  // Expected: read `orders`, read `refunds`.
  async both(): Promise<unknown[]> {
    return Promise.all([
      this.db.raw('SELECT sum(total) FROM orders'),
      this.db.raw('SELECT sum(amount) FROM refunds'),
    ]);
  }

  // The table is chosen by the caller, so the statement cannot be read.
  // Expected: a query with no table and a `sql-parse-failed` row.
  purge(table: string): Promise<unknown> {
    return this.db.raw(`DELETE FROM ${table} WHERE created_at < now()`);
  }

  // A statement that touches no table at all: a connection check. Nothing to
  // draw and nothing to fix. Expected: no query, no row.
  ping(): Promise<unknown> {
    return this.db.raw('SELECT 1');
  }

  // Fragments. `raw` handed to a builder is part of the builder's query, not a
  // second visit to the database. Expected: one query, read `orders`, and no
  // node or row for any of the three `raw` calls - including the one that is a
  // whole sub-select naming `customers`, because where it is written decides
  // what it is.
  large(min: number): Promise<unknown[]> {
    return this.db('orders')
      .where(this.db.raw('total > ?', [min]))
      .whereIn('customer_id', this.db.raw('SELECT id FROM customers WHERE vip = true'))
      .select('id', this.db.raw('total * 2 AS doubled'));
  }

  // A fragment kept in a variable before the builder takes it. Where it is
  // written says nothing, and its text is not a statement: no verb opens it.
  // Expected: one query, read `customers`, nothing for the `raw`.
  emails(): Promise<unknown[]> {
    const lowered = this.db.raw('lower(email) AS email');
    return this.db('customers').select(lowered);
  }

  // A fragment kept in a variable and built from a column the caller chooses:
  // computed, but still not a statement. Expected: nothing for the `raw`, and
  // one query, write `orders`.
  touch(column: string): Promise<number> {
    const now = this.db.raw(`"${column}"`);
    return this.db('orders').update({ updated_at: now });
  }

  // A statement written above the call and handed to it by a `const`, built
  // from a list of placeholders, with a WITH clause whose name carries its
  // columns. Expected: read `orders` and `refunds`; `picked` is the statement's
  // own name for a list of values, not a table.
  picked(ids: string[]): Promise<unknown> {
    const marks = ids.map(() => '?').join(', ');
    const query = `WITH picked(id) AS (VALUES ${marks})
      SELECT o.id FROM orders o JOIN picked p ON p.id = o.id
      WHERE o.id NOT IN (SELECT order_id FROM refunds WHERE order_id IN (${marks}))`;
    return this.db.raw(query, [...ids, ...ids]);
  }
}
