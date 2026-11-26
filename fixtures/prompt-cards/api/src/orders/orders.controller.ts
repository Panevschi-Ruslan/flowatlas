import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { OrdersService, type OrderView } from './orders.service';

/** Shares its class and method names with `stock-api`'s controller. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':orderId')
  findOne(@Param('orderId') orderId: string): OrderView {
    return this.orders.findOne(orderId);
  }

  @Post(':orderId/cancel')
  cancel(@Param('orderId') orderId: string, @Body() body: { reason: string }): OrderView {
    return this.orders.cancel(orderId, body.reason);
  }
}
