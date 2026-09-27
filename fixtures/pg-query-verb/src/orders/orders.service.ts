import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class OrdersService {
  private readonly pool = new Pool();

  // The control: a verb the reader knows. Table "orders", op read, no row.
  findAll(): Promise<unknown> {
    return this.pool.query('SELECT id, total FROM orders WHERE status = $1', ['new']);
  }

  // Parses, names a table, and opens with no verb the reader knows: the text
  // starts with a comment. Expected: a node for "orders" with no op, and one
  // `unknown-db-operation` row here.
  report(): Promise<unknown> {
    return this.pool.query('/* nightly report */ SELECT count(*) FROM orders');
  }

  // The same, for a verb the reader has no entry for at all. Expected: a node
  // for "invoices" with no op, and a second `unknown-db-operation` row.
  plan(): Promise<unknown> {
    return this.pool.query('EXPLAIN SELECT * FROM invoices');
  }
}
