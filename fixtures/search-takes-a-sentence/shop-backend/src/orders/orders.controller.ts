import { Controller, Get, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(): string[] {
    return this.orders.list();
  }

  /** Where an order is cancelled: the route a sentence asking for it must find first. */
  @Post(':orderId/cancel')
  cancel(@Param('orderId') orderId: string): boolean {
    return this.orders.cancel(orderId);
  }

  @Post(':orderId/refund')
  refund(@Param('orderId') orderId: string): number {
    return this.orders.refund(orderId);
  }
}
