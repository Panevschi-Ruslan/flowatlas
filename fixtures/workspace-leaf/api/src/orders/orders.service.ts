import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class OrdersService {
  private readonly pool = new Pool();

  // SELECT: table "orders", op read. The driver this goes through is declared in
  // the workspace root's manifest and nowhere in this package's own.
  findAll(): Promise<unknown> {
    return this.pool.query('SELECT id, total FROM orders WHERE status = $1', ['new']);
  }

  // INSERT INTO: table "orders", op write.
  create(total: number): Promise<unknown> {
    return this.pool.query('INSERT INTO orders (total) VALUES ($1) RETURNING id', [total]);
  }
}
