import { dataSource } from '../data-source.js';
import { Order } from './entities.js';

/**
 * Methods every object has, called on a receiver of a described package.
 *
 * The operation a call performs is read by looking its method name up in the
 * descriptor's table of operations, and the name comes out of the source. Asked
 * about `toString`, an object literal answers with `Object.prototype.toString` -
 * and a `db_query` node was minted for it, labelled
 * `function toString() { [native code] }`, twice in novu's graph (R122). The
 * graph must hold no node for any line of this file.
 *
 * Module-level functions on purpose: a body earns a node only once a leaf is
 * found in it, so the assertion can be about the whole graph.
 */
const orders = dataSource.getRepository<Order>(Order);

/** Four words the language put on every object, asked of the operations table. */
export const describeOrders = (): string => {
  const shown = orders.toString();
  const made = orders.constructor();
  const same = orders.valueOf();
  const owns = orders.hasOwnProperty('find');
  return `${shown}${String(made)}${String(same)}${String(owns)}`;
};
