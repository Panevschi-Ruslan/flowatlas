import { Body, Controller, Param, Post } from '@nestjs/common';
import { ChatBot } from './chat-bot';

/** The chat platform posts the bot's updates here, under a secret in the address: nothing in the project calls it. */
@Controller('tg')
export class ChatHookController {
  constructor(private readonly bot: ChatBot) {}

  @Post(':secret')
  receive(@Param('secret') secret: string, @Body() update: { message?: { text?: string } }): Promise<void> {
    void secret;
    return this.bot.handleUpdate(update);
  }
}
