import { Injectable } from '@nestjs/common';
import { Telegraf } from 'telegraf';

import { OrdersService } from './orders.service.js';

/**
 * A bot written against the library directly, rather than with decorators.
 *
 * The older of the two styles and still the more common. Everything here is an
 * ordinary entry point with a bot kind, so nothing downstream knows a bot was
 * involved (I8).
 */
@Injectable()
export class DirectBot {
  private readonly bot = new Telegraf();

  constructor(private readonly orders: OrdersService) {}

  setup(): void {
    // Two commands, one handler. A person types either, so both are ways in.
    // Keeping only the first said `/i` did not exist, and said nothing about
    // having dropped it (R02).
    this.bot.command(['inbox', 'i'], (ctx) => this.list(ctx));

    // A word and a pattern in one list: both are kept, spelled the way the
    // decorator adapter spells them, so the same bot read either way lands on
    // the same ids.
    this.bot.action(['refresh', /^page_(\d+)$/], (ctx) => this.page(ctx));

    // The method's own name is the command; there is no trigger to read.
    this.bot.settings((ctx) => this.page(ctx));

    this.bot.launch();
  }

  list(ctx: unknown): void {
    void ctx;
    void this.orders.create(1);
  }

  page(ctx: unknown): void {
    void ctx;
  }
}
