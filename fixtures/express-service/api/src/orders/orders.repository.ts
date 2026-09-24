import { Pool } from 'pg';

/**
 * Stored data, so the route audit has something to say a route reaches.
 *
 * A class, and one instance of it exported, because that is the only shape the
 * data-layer reader walks: it works through the classes of a repository, and a
 * `pool.query(…)` written in a module-level function is not read at all. That
 * is a real limit for repositories that keep their data access in functions,
 * and it belongs to the data-layer reader rather than to this fixture.
 */
export class OrdersRepository {
  private readonly pool = new Pool();

  list(): Promise<unknown> {
    return this.pool.query('select id, total from orders where tenant_id = $1', ['t1']);
  }

  byId(orderId: string): Promise<unknown> {
    return this.pool.query('select id, total from orders where id = $1', [orderId]);
  }

  insert(total: number): Promise<unknown> {
    return this.pool.query('insert into orders (total) values ($1)', [total]);
  }
}

export const orders = new OrdersRepository();
