import { Body, Controller, Post } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';
import { BotService, type OrderEvent } from '../bot/bot.service';

/** What the shop's bus posts to the bot: every frame of `order_updates`, dispatched by its type. */
@Controller('events')
export class EventsController {
  constructor(private readonly bot: BotService) {}

  @Post('orders')
  @Consumes('order_updates')
  receive(@Body() event: OrderEvent): string | Promise<string> {
    switch (event.type) {
      case 'ORDER_READY':
        return this.bot.handleOrderReady(event);
      case 'ORDER_CANCELLED':
        return this.bot.handleOrderCancelled(event);
      default:
        return 'ignored';
    }
  }
}
