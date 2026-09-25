import { Injectable } from '@nestjs/common';
import { drizzle, eq, type PgTable } from 'drizzle-orm';

import { invoices, orders } from './schema.js';

@Injectable()
export class OrdersService {
  private readonly db = drizzle();

  // A read: the operation is on `select`, the table is on the `from` that
  // follows it. Both belong to one visit to the database and must land in one
  // row.
  findAll(): Promise<unknown[]> {
    return this.db.select().from(orders).limit(20);
  }

  // A read whose chain is longer, to show that the `from` is found however far
  // down the chain the query ends.
  findOne(id: string): Promise<unknown[]> {
    return this.db.select().from(orders).where(eq(id, id)).limit(1);
  }

  // A write: the table is the argument of the call that carries the operation.
  create(total: number): Promise<unknown> {
    return this.db.insert(orders).values({ total });
  }

  // A write on a second table, so the fixture has more than one table node.
  invoice(orderId: string): Promise<unknown> {
    return this.db.insert(invoices).values({ orderId });
  }

  markPaid(id: string): Promise<unknown> {
    return this.db.update(orders).set({ status: 'paid' }).where(eq(id, id));
  }

  remove(id: string): Promise<unknown> {
    return this.db.delete(orders).where(eq(id, id));
  }

  // The table is chosen by the caller, so nothing can be read from the source.
  // Expected: the query is still a node, with no table and a `dynamic-table-name`
  // row saying why.
  purge(table: PgTable): Promise<unknown> {
    return this.db.delete(table).where(eq(1, 1));
  }
}
