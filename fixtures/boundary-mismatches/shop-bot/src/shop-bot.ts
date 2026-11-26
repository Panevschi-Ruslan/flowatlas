import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Markup, Telegraf } from 'telegraf';

type Reply = { reply(text: string, extra?: unknown): void };

/** The shop's bot: one command shows an order with its buttons, and a handler for each. */
@Injectable()
export class ShopBot implements OnModuleInit {
  private readonly bot = new Telegraf();

  onModuleInit(): void {
    this.bot.command('order', (ctx) => this.showOrder(ctx as Reply, 'o1'));
    this.bot.action('order:confirm', (ctx) => this.confirm(ctx as Reply));
    this.bot.action(/^order:cancel:(\w+)$/, (ctx) => this.cancel(ctx as Reply));
    // The button sends `order:track`: nothing handles it, and nothing sends this.
    this.bot.action('order:tracking', (ctx) => this.track(ctx as Reply));
    this.bot.action(/^order:details:/, (ctx) => this.details(ctx as Reply));
    this.bot.launch();
  }

  showOrder(ctx: Reply, orderId: string): void {
    ctx.reply(
      `Order ${orderId}`,
      Markup.inlineKeyboard([
        Markup.button.callback('Confirm', 'order:confirm'),
        Markup.button.callback('Cancel', `order:cancel:${orderId}`),
        Markup.button.callback('Track', 'order:track'),
        // Sixty-six bytes: the platform takes sixty-four.
        Markup.button.callback('Details', 'order:details:with-the-full-delivery-address-and-the-courier-notes'),
      ]),
    );
  }

  confirm(ctx: Reply): void {
    ctx.reply('Confirmed');
  }

  cancel(ctx: Reply): void {
    ctx.reply('Cancelled');
  }

  track(ctx: Reply): void {
    ctx.reply('On its way');
  }

  details(ctx: Reply): void {
    ctx.reply('Details');
  }
}
