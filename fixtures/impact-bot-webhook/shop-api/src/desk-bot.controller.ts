import { Body, Controller, Post } from '@nestjs/common';
import { DeskBot } from './desk-bot';

/** The bot platform posts the desk bot's updates here: the bot's way in, handled by the bot's class, not the API being changed. */
@Controller('bot/desk')
export class DeskBotController {
  constructor(private readonly bot: DeskBot) {}

  @Post('webhook')
  receive(@Body() update: { callback_query?: { data: string } }): Promise<void> {
    return this.bot.handleUpdate(update);
  }
}
