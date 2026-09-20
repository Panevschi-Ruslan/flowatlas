import { Injectable } from '@nestjs/common';
import { Telegraf } from 'telegraf';

import { callbackRegistry } from './handlers/callback-registry.js';
import { registerMenuHandlers } from './commands/menu.command.js';
import { orderCommands } from './commands/order-commands.js';
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

    // Called from a method body, which is the walk that follows no plain
    // function. A module of functions is followed even there (R24).
    orderCommands.myOrders(this.orders);
  }

  greet(): string {
    return this.orders.find('welcome');
  }

  /**
   * A method written as a field, which is how one that will be handed to a
   * callback keeps its `this`. Reading only `getMethod` reports the call below
   * as a receiver nobody can pin down (R25).
   */
  announce = (orderId: string): string => this.orders.find(orderId);

  /** Assigned from outside, so there is no one body to point at. */
  onReady: (() => void) | undefined;

  ready(): void {
    this.announce('latest');
    this.onReady?.();
  }
}
