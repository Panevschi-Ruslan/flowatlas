import { dataSource } from '../data-source.js';
import { Order } from './entities.js';

const orders = dataSource.getRepository<Order>(Order);

/**
 * A module of functions spelled as an object, which is how a good deal of code
 * keeps a group of related queries together. A call through it names one of
 * them as surely as calling a function by name does, so the query inside is
 * recorded under `orderQueries.list`.
 */
export const orderQueries = {
  list: async (): Promise<Order[]> => orders.find(),
};

/**
 * The one shape that still has nowhere to go: a query that runs when the module
 * is imported. There is no function or method to record it under, so the reader
 * reports it instead of dropping it — which is the difference between this and
 * what it used to do with every query in a module of functions.
 */
export const warmUp = orders.find();
