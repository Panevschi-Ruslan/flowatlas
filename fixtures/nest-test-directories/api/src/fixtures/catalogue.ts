import type { Pool } from 'pg';

/**
 * Runtime code in a directory named `fixtures`: the reference data the service
 * prices an order against. Read only because `readTestDirectories` names it.
 */
export const catalogue = (pool: Pool, total: number): Promise<unknown> =>
  pool.query('SELECT price FROM catalogue WHERE max_total >= $1', [total]);
