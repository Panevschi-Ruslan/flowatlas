import { UseGuards } from '@nestjs/common';
import { FlowEntry } from '@flowatlas/markers';
import { Action, Command, Hears, Help, On, Start, Update } from 'nestjs-telegraf';
import { Action as CqrsAction } from './cqrs-like.js';
import { dynamicKey } from './callbacks.js';
import { AdminGuard } from './admin.guard.js';
import { OrdersService } from './orders.service.js';

@Update()
export class OrdersUpdate {
  constructor(private readonly orders: OrdersService) {}

  @Start()
  start(): string {
    return 'hello';
  }

  @Help()
  help(): string {
    return 'help';
  }

  @Command('menu')
  menu(): string {
    return 'menu';
  }

  /** An array fans out: one entry per spelling, both handled here. */
  @Command(['orders', 'o'])
  list(): string {
    return 'orders';
  }

  /** A reply-keyboard button sends plain text, which reads as a command. */
  @Hears('Меню')
  keyboardMenu(): string {
    return 'menu';
  }

  @Hears(/^hi/i)
  greet(): string {
    return 'hi';
  }

  /** The guard is the generic pass's business; the adapter says nothing about it. */
  @Action('order_confirm')
  @UseGuards(AdminGuard)
  confirm(): string {
    return this.orders.create(1);
  }

  @Action(/^order_(\d+)$/)
  byId(): string {
    return 'one order';
  }

  @Action(dynamicKey())
  @FlowEntry('checkout')
  checkout(): string {
    return 'checkout';
  }

  /** The same dynamic key without a marker: unresolved, and no invented entry. */
  @Action(dynamicKey())
  retry(): string {
    return 'retry';
  }

  @On('callback_query')
  anyButton(): string {
    return 'button';
  }

  @On(['message', 'edited_message'])
  anyMessage(): string {
    return 'message';
  }

  /** Same exported name, different package: not a bot handler. */
  @CqrsAction('order.created')
  projectOrderCreated(): void {
    return undefined;
  }
}
