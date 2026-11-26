import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Markup, Telegraf, type Context, type InlineButton } from 'telegraf';

import { replyHelp } from './replies';
import { StaffApi, type ActiveOrder } from './staff.api';
import { TextRouter } from './text-router';

interface ButtonRoute {
  prefix: string;
  handler: (ctx: Context, data: string) => Promise<void>;
  selfAnswers: boolean;
}

interface SlashCommand {
  name: string;
  run: (ctx: Context) => Promise<void>;
}

/**
 * The staff's bot. Its buttons go through a table of prefixes, its commands
 * through a table a method returns, registered one by one in a loop, and its
 * text through a router of its own.
 */
@Injectable()
export class StaffBot implements OnModuleInit {
  private readonly buttonRoutes: ReadonlyArray<ButtonRoute> = [
    { prefix: 'set_status_', handler: (ctx, d) => this.handleStatus(ctx, d), selfAnswers: true },
    { prefix: 'view_order_', handler: (ctx, d) => this.showOrder(ctx, d), selfAnswers: false },
  ];

  constructor(
    private readonly api: StaffApi,
    private readonly text: TextRouter,
  ) {}

  onModuleInit(): void {
    const bot = new Telegraf();
    this.setup(bot);
    bot.launch();
  }

  setup(bot: Telegraf): void {
    bot.on('callback_query', async (ctx) => {
      const data = ('data' in ctx.callbackQuery ? ctx.callbackQuery.data : '') || '';
      const route = this.buttonRoutes.find((r) => data.startsWith(r.prefix));
      if (route) await route.handler(ctx, data);
      if (!route?.selfAnswers) await ctx.answerCbQuery();
    });
    for (const command of this.commands()) {
      bot.command(command.name, (ctx) => command.run(ctx));
    }
    bot.on('text', (ctx) => this.text.route(ctx));
  }

  private commands(): SlashCommand[] {
    return [
      { name: 'orders', run: this.listOrders.bind(this) },
      { name: 'help', run: replyHelp },
    ];
  }

  private async handleStatus(ctx: Context, data: string): Promise<void> {
    await this.api.setStatus(data.slice('set_status_'.length), 'ready');
    await ctx.answerCbQuery('Marked ready');
  }

  private async showOrder(ctx: Context, data: string): Promise<void> {
    const orders = await this.api.getActiveOrders();
    await ctx.reply(orders.find((order) => order.id === data.slice('view_order_'.length))?.summary ?? 'Gone');
  }

  private async listOrders(ctx: Context): Promise<void> {
    const orders = await this.api.getActiveOrders();
    for (const order of orders) {
      await ctx.reply(order.summary, Markup.inlineKeyboard([this.buttonsFor(order)]));
    }
  }

  /** Each order's buttons: two prefixes of the table, and one no element takes. */
  private buttonsFor(order: ActiveOrder): InlineButton[] {
    return [
      Markup.button.callback('Details', `view_order_${order.id}`),
      Markup.button.callback('Ready', `set_status_${order.id}`),
      Markup.button.callback('Archive', `archive_order_${order.id}`),
    ];
  }
}
