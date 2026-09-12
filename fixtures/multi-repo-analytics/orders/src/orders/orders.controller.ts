import { Body, Controller, Get, Post } from '@nestjs/common';

import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Four calls reach this route, from three services. */
  @Post('create')
  create(@Body() body: { customerId: string }): Promise<unknown> {
    return this.orders.create(body.customerId);
  }

  /** The other half of the HTTP cycle: answering this calls `gateway` back. */
  @Get('recent')
  recent(): Promise<unknown> {
    return this.orders.recent('current');
  }
}
