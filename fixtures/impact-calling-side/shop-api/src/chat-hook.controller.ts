import { Body, Controller, Post } from '@nestjs/common';
import { ChatUpdatesService } from './chat-updates.service';

/** A chat platform posts its updates here: a way in whose caller is outside the project by design. */
@Controller('hooks')
export class ChatHookController {
  constructor(private readonly updates: ChatUpdatesService) {}

  @Post('chat')
  receive(@Body() update: { orderId: string; text: string }): Promise<void> {
    return this.updates.handleUpdate(update);
  }
}
