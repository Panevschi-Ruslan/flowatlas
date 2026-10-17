import { Body, Controller, Post } from '@nestjs/common';

/** What the payment provider posts to when a card payment settles. */
@Controller('webhooks')
export class WebhooksController {
  @Post('payments')
  payment(@Body() body: { id: string }): { received: string } {
    return { received: body.id };
  }
}
