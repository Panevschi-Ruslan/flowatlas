import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';

import { ShopClient } from './shop.client';

interface BotRoute {
  pattern: RegExp;
  handler: (ctx: { match: string[] }) => Promise<void>;
}

/**
 * The couriers' bot: a command read, and buttons registered in a loop over a
 * table, whose handler the reading cannot name. `handleDelivered` requests
 * the route through the client and is called by nothing the graph holds: a
 * maybe row, and still a bot's.
 */
@Injectable()
export class CourierBot implements OnModuleInit {
  private readonly bot = new Telegraf();

  constructor(private readonly shop: ShopClient) {}

  onModuleInit(): void {
    this.bot.command('help', (ctx) => this.help(ctx));
    for (const route of this.routes()) {
      this.bot.action(route.pattern, (ctx) => route.handler(ctx as { match: string[] }));
    }
    this.bot.launch();
  }

  async help(_ctx: unknown): Promise<void> {
    return undefined;
  }

  async handleDelivered(ctx: { match: string[] }): Promise<void> {
    await this.shop.updateStatus(ctx.match[1] ?? '', 'delivered');
  }

  private routes(): BotRoute[] {
    return [{ pattern: /^delivered:(\w+)$/, handler: this.handleDelivered.bind(this) }];
  }
}
