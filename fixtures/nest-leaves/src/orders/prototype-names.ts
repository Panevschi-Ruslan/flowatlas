import axios from 'axios';
import { Redis } from 'ioredis';

/**
 * Methods every object has, called on receivers the reader recognises.
 *
 * Nothing here is a cache operation or a request, and the graph must hold no
 * node for any line of this file. It is a fixture about the tables rather than
 * about the libraries: cache methods and HTTP verbs are read by looking a name
 * from the source up in a table, and a table written as an object literal
 * answers `constructor`, `toString`, `valueOf` and `hasOwnProperty` with the
 * language's own values. One such lookup put two `db_query` nodes labelled
 * `function toString() { [native code] }` into a notification service's graph - a node minted from
 * a value nobody wrote, indistinguishable in a count from a real query (R122) -
 * and the same hazard was still open in the cache and verb tables (R130).
 *
 * Written as module-level functions on purpose: a body earns a node only when a
 * leaf is found in it, so "no node anywhere names this file" is a statement the
 * test can make about the whole graph rather than about one node type.
 *
 * None of this is code anybody would write, which is the point: the reader can
 * be asked about any word a program contains, and these four are words every
 * program contains whether it wrote them or not.
 */
const cache = new Redis();

/** Four words the language put on every object, asked of the cache table. */
export const describeCache = (): string => {
  const shown = cache.toString();
  const made = cache.constructor();
  const same = cache.valueOf();
  const owns = cache.hasOwnProperty('status');
  return `${shown}${String(made)}${String(same)}${String(owns)}`;
};

/** The same four asked of the table of HTTP verbs. */
export const describeClient = (): string => {
  const shown = axios.toString();
  const made = axios.constructor();
  const same = axios.valueOf();
  const owns = axios.hasOwnProperty('get');
  return `${shown}${String(made)}${String(same)}${String(owns)}`;
};
