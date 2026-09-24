import { Pool } from 'pg';

/**
 * Stored data, so the route audit has something to say a route reaches.
 *
 * A class, and one instance of it exported, which is one of the two shapes an
 * Express service keeps its data access in. The other — a module of exported
 * functions around a `pool` — reads the same since R52; `fixtures/fn-data-layer`
 * is where the two are compared.
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
