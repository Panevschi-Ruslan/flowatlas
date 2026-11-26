import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';

import { AppService } from './app.service';

/** Two commands, each through the bot's one client: only `/items` reaches `GET /api/items`. */
@Injectable()
export class MarketBot implements OnModuleInit {
  private readonly bot = new Telegraf();

  constructor(private readonly app: AppService) {}

  onModuleInit(): void {
    this.bot.command('items', (ctx) => this.showItems(ctx as { reply(text: string): void }));
    this.bot.command('desks', (ctx) => this.showDesks(ctx as { reply(text: string): void }));
    this.bot.launch();
  }

  async showItems(ctx: { reply(text: string): void }): Promise<void> {
    ctx.reply((await this.app.getActive('main')).join(', '));
  }

  async showDesks(ctx: { reply(text: string): void }): Promise<void> {
    ctx.reply((await this.app.getDesks()).join(', '));
  }
}
