import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { OrdersClient } from '../clients/orders.client';

/** The front door: what the browser posts to, guarded, forwarded to `orders`. */
@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersClient) {}

  @Post()
  create(@Body() body: { customerId: string }): unknown {
    return this.orders.create(body.customerId);
  }
}
