import { Body, Controller, Post } from '@nestjs/common';

import { Bot } from '../bot/bot';
import type { OrderCancelledEvent, OrderEvent, OrderReadyEvent } from '../bot/bot-events';

interface RelayBody {
  channel: string;
  scopeId: string;
  message: OrderEvent;
}

/** What the shop's bus posts: every message of the orders channel, dispatched by its type. */
@Controller('events')
export class RelayController {
  constructor(private readonly bot: Bot) {}

  @Post('relay')
  relay(@Body() body: RelayBody): string {
    const event = body.message;
    this.bot.log(event as never);
    switch (event.type) {
      case 'ORDER_READY':
        return this.bot.handleOrderReady(event as OrderReadyEvent);
      case 'STATUS_CHANGED':
      case 'ORDER_CANCELLED':
        return this.bot.handleStatus(event);
      case 'ORDER_REFUNDED':
        return this.bot.handleRefund(event as unknown as OrderCancelledEvent);
      default:
        return 'ignored';
    }
  }
}
