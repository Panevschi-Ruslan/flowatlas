import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { OrdersService, type Order } from './orders.service';

@Controller('api/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':id')
  findOne(@Param('id') id: string): Order {
    return this.orders.findOne(id);
  }

  @Post(':id/ready')
  ready(@Param('id') id: string): void {
    this.orders.markReady(id);
  }

  @Post(':id/delay')
  delay(@Param('id') id: string, @Body() body: { minutes: number }): void {
    this.orders.delay(id, body.minutes);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string): void {
    this.orders.cancel(id);
  }
}
