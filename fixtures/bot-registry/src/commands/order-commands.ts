import type { OrdersService } from '../orders.service.js';

/**
 * A module of functions, called from a method rather than from a handler.
 *
 * The class has no method for these: they are where the bot keeps behaviour
 * that has no class of its own, and `setup` names which one it wants. Reading
 * the call as a receiver with no class type would lose both the edge and
 * everything the function reaches (R24).
 */
export const orderCommands = {
  myOrders: (orders: OrdersService): string => orders.find('mine'),
  latest: (orders: OrdersService): string => orders.find('latest'),
};
