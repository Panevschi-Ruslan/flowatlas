import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';

import { GatewayClient } from './gateway.client';

/** One command, `/book`, which asks the gateway for a book. */
@Injectable()
export class DeskBot implements OnModuleInit {
  private readonly bot = new Telegraf();

  constructor(private readonly gateway: GatewayClient) {}

  onModuleInit(): void {
    this.bot.command('book', (ctx) => this.showBook(ctx as { reply(text: string): void }));
    this.bot.launch();
  }

  async showBook(ctx: { reply(text: string): void }): Promise<void> {
    ctx.reply(await this.gateway.book('first'));
  }
}
