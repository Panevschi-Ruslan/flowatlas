import { readOrders, writeOrder } from './store.js';

/**
 * What the route calls, one package away.
 *
 * Each of these calls something else in turn, on purpose. A function node with
 * no outgoing edge is exactly how this used to read — the way in reached the
 * name and stopped there — so the second call is what says whether the body was
 * read or only pointed at.
 */
export const listOrders = async (): Promise<unknown[]> => readOrders();

export const saveOrder = async (order: unknown): Promise<unknown> => writeOrder(order);
