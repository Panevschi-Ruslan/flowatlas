import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';

import { ShopClient } from './shop.client';

interface BotRoute {
  pattern: RegExp;
  handler: (ctx: { match: string[] }) => Promise<void>;
}

/**
 * Buttons registered in a loop over a table of routes: the reading cannot say
 * which handler `route.handler` is, so the call is a gap in this file and
 * `handleStatus` is called by nothing the graph holds.
 */
@Injectable()
export class OpsBot implements OnModuleInit {
  private readonly bot = new Telegraf();

  constructor(private readonly shop: ShopClient) {}

  onModuleInit(): void {
    for (const route of this.routes()) {
      this.bot.action(route.pattern, (ctx) => route.handler(ctx as { match: string[] }));
    }
    this.bot.launch();
  }

  async handleStatus(ctx: { match: string[] }): Promise<void> {
    await this.shop.updateStatus(ctx.match[1], ctx.match[2]);
  }

  private routes(): BotRoute[] {
    return [{ pattern: /^status:(\w+):(\w+)$/, handler: this.handleStatus.bind(this) }];
  }
}
