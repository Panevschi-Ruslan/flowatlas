import type { BotDeps } from '../handlers/callback-registry.js';

/**
 * A helper a handler calls by name.
 *
 * Reached only because a handler names it: the walk spreads through the
 * functions handlers call and stops there.
 */
export function summarise(orderId: string, { orders }: BotDeps): string {
  return orders.find(orderId);
}
