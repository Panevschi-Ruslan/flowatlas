import { Telegraf } from 'telegraf';

import { OrdersService } from '../orders.service.js';

/**
 * Registrations written in a module-level function.
 *
 * The library's own API, so nothing here needs configuring — but the calls are
 * not inside a class, and a reader that only walked classes lost all of them.
 */
export function registerMenuHandlers(bot: Telegraf, orders: OrdersService): void {
  bot.command('menu', () => showMenu(orders));

  bot.action('back_to_main', () => {
    orders.find('latest');
  });
}

/** The single call behind the registration above, so it is the handler. */
export function showMenu(orders: OrdersService): string {
  return orders.find('menu');
}
