import { Injectable, type OnModuleInit } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { Telegraf } from 'telegraf';

import { ApiClient } from './api.client';

/**
 * `/items` lists the shop's items; a change of any order, relayed on
 * `shop:*:orders`, makes the bot fetch the list again through the same route.
 */
@Injectable()
export class StoreBot implements OnModuleInit {
  private readonly bot = new Telegraf();
  private readonly listener: RedisClientType = createClient();

  constructor(private readonly api: ApiClient) {}

  onModuleInit(): void {
    this.bot.command('items', (ctx) => this.showItems(ctx as { reply(text: string): void }));
    void this.listener.pSubscribe('shop:*:orders', (message) => this.onStatusEvent(message));
    this.bot.launch();
  }

  async showItems(ctx: { reply(text: string): void }): Promise<void> {
    ctx.reply((await this.api.getItems('main')).join(', '));
  }

  async onStatusEvent(message: string): Promise<void> {
    void message;
    await this.api.getItems('main');
  }
}
