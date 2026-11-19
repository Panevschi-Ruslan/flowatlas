import { Body, Controller, Post } from '@nestjs/common';
import { OrderEvents } from '@shop/order-events';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly events: OrderEvents) {}

  @Post()
  checkout(@Body() body: { orderId: string; total: number }): { accepted: boolean } {
    this.events.placed({ orderId: body.orderId, total: body.total });
    return { accepted: true };
  }
}
