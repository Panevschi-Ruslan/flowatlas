import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';

import { ShopClient } from './shop.client';

interface BotRoute {
  pattern: RegExp;
  handler: (ctx: { match: string[] }) => Promise<void>;
}

/**
 * The couriers' bot: a command read, and buttons registered in a loop over a
 * table written out, one way in per element (P398). `handleDelivered`, the
 * handler of `delivered:<id>`, requests the route through the client: a way
 * in of a bot, no longer a maybe row.
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
