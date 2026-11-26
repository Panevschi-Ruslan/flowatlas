import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { OrdersService } from './orders.service';

interface DeskUpdate {
  callback_query?: { data: string };
}

/**
 * The desk's bot, inside the back end: a command registered on the bot, and
 * the updates its webhook hands on, a button's callback read here.
 */
@Injectable()
export class DeskBot implements OnModuleInit {
  private readonly bot = new Telegraf();

  constructor(private readonly orders: OrdersService) {}

  onModuleInit(): void {
    this.bot.command('ready', (ctx) => this.markReady(String((ctx as { message?: { text?: string } }).message?.text ?? '')));
  }

  async markReady(text: string): Promise<void> {
    await this.orders.updateStatus(text.split(' ')[1] ?? '', 'ready');
  }

  async handleUpdate(update: DeskUpdate): Promise<void> {
    if (update.callback_query !== undefined) await this.onButton(update.callback_query.data);
  }

  async onButton(data: string): Promise<void> {
    const [, orderId, status] = data.split(':');
    await this.orders.updateStatus(orderId ?? '', status ?? '');
  }
}
