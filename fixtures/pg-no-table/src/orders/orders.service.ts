import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class OrdersService {
  private readonly pool = new Pool();

  // The control: a statement that names its table. Table "orders", no row.
  findAll(): Promise<unknown> {
    return this.pool.query('SELECT id, total FROM orders');
  }

  // A whole statement that names no table: a health check. Counted, no node,
  // no row.
  ping(): Promise<unknown> {
    return this.pool.query('SELECT 1');
  }

  // A transaction around a write. `BEGIN` and `COMMIT` are whole statements
  // that name no table: counted, no node, no row. The insert between them is
  // read as usual.
  async place(total: number): Promise<void> {
    await this.pool.query('BEGIN');
    await this.pool.query('INSERT INTO orders (total) VALUES ($1)', [total]);
    await this.pool.query('COMMIT');
  }

  // The table is computed: the text cannot be read, and this is the only
  // `sql-parse-failed` row in the fixture.
  countIn(table: string): Promise<unknown> {
    return this.pool.query(`SELECT count(*) FROM ${table}`);
  }
}
