import { Injectable } from '@nestjs/common';
import type { SqlEntityManager } from '@mikro-orm/postgresql';

import { ManagerBase } from './manager-base.js';

/**
 * A repository whose SQL goes through the ORM's manager rather than the ORM.
 *
 * `getKnex()` on the manager hands back a knex instance, and from there every
 * query is knex's own: a table, a chain, and an operation along it. Nothing in
 * this file imports `knex`; the manager is the only way in, which is the shape
 * this fixture exists to hold.
 */
@Injectable()
export class InventoryLevelRepository extends ManagerBase {
  constructor(private readonly em: SqlEntityManager) {
    super();
  }

  // The builder taken straight off the manager and invoked at once, with the
  // table written as an alias object: `{ il: 'inventory_level' }` is
  // `'inventory_level as il'`.
  reserved(itemId: string): Promise<unknown[]> {
    return super
      .getActiveManager<SqlEntityManager>()
      .getKnex()({ il: 'inventory_level' })
      .select('reserved_quantity')
      .where('inventory_item_id', itemId);
  }

  // The builder kept in a variable first, which is how most such methods read.
  stocked(itemId: string): Promise<unknown[]> {
    const knex = this.getActiveManager<SqlEntityManager>().getKnex();
    return knex('inventory_level').select('stocked_quantity').where('inventory_item_id', itemId);
  }

  // The transaction's builder when there is one and the manager's when not, with
  // the table named in a `from` halfway along the chain rather than where the
  // chain started - `location_id` there is a column.
  reservation(itemId: string): Promise<unknown> {
    const manager = this.getActiveManager<SqlEntityManager>();
    const knex = manager.getTransactionContext() ?? manager.getKnex();
    return knex
      .select('location_id')
      .from('reservation_item')
      .where('inventory_item_id', itemId)
      .first();
  }

  // A write, through a manager the constructor was handed rather than one the
  // base looked up.
  adjust(itemId: string, quantity: number): Promise<number> {
    return this.em
      .getKnex()('inventory_level')
      .where('inventory_item_id', itemId)
      .update({ stocked_quantity: quantity });
  }
}

// A function outside any class, handed a context and casting the manager out of
// it: the cast is the only place the manager's type is written.
export const reservedLocations = (context: { manager?: unknown }): Promise<unknown[]> => {
  const manager = context.manager as SqlEntityManager;
  const knex = manager.getKnex();
  return knex.select('location_id').from('reservation_item');
};
