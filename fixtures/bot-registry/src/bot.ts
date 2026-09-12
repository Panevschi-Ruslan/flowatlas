import { Injectable } from '@nestjs/common';
import { Telegraf } from 'telegraf';

import { callbackRegistry } from './handlers/callback-registry.js';
import { registerMenuHandlers } from './commands/menu.command.js';
import { OrdersService } from './orders.service.js';
import './actions/cancel-order.action.js';

/**
 * The bot itself, which registers almost nothing.
 *
 * Everything a person presses is in the table or in a module-level function, so
 * reading only this class finds one way in out of six.
 */
@Injectable()
export class Bot {
  private readonly bot = new Telegraf();

  constructor(private readonly orders: OrdersService) {}

  setup(): void {
    this.bot.start(() => this.greet());
    registerMenuHandlers(this.bot, this.orders);

    this.bot.on('callback_query', (data) => {
      callbackRegistry.dispatch(String(data), { orders: this.orders });
    });
  }

  greet(): string {
    return this.orders.find('welcome');
  }
}
