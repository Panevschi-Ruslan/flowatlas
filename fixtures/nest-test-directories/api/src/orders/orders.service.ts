import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { catalogue } from '../fixtures/catalogue.js';

@Injectable()
export class OrdersService {
  private readonly pool = new Pool();

  // SELECT: table "orders", op read.
  findAll(): Promise<unknown> {
    return this.pool.query('SELECT id, total FROM orders WHERE status = $1', ['new']);
  }

  // The price list the application ships with, kept in `src/fixtures` and read
  // because the configuration names that directory.
  create(total: number): Promise<unknown> {
    return catalogue(this.pool, total);
  }
}
