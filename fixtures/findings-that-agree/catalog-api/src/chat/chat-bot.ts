import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';

interface ChatUpdate {
  message?: { text?: string };
}

/** The catalog's chat bot: a command registered on the bot, and the updates its webhook hands on. */
@Injectable()
export class ChatBot implements OnModuleInit {
  private readonly bot = new Telegraf();

  onModuleInit(): void {
    this.bot.command('stock', (ctx) => this.replyStock(String((ctx as { message?: { text?: string } }).message?.text ?? '')));
  }

  async replyStock(text: string): Promise<string> {
    return `stock for ${text}`;
  }

  async handleUpdate(update: ChatUpdate): Promise<void> {
    if (update.message?.text !== undefined) await this.replyStock(update.message.text);
  }
}
