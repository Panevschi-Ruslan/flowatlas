import { Pool } from 'pg';

/**
 * The layer under the routes, and the half of this fixture that settles which
 * reader ran.
 *
 * Both readers read the ways in - the entry adapters are asked by either - so a
 * route on its own does not say which one opened the directory. A query does: the
 * data layer is a pass the server reader has and the browser reader has not, so
 * a graph of this repository with no table in it was read by the reader that can
 * only see one half.
 */
const pool = new Pool();

export const orders = {
  list: (): Promise<unknown> => pool.query('select id, total from orders where tenant_id = $1', ['t1']),
  insert: (total: number): Promise<unknown> =>
    pool.query('insert into orders (total) values ($1)', [total]),
};
