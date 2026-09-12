import { Body, Controller, Post } from '@nestjs/common';

import type { OrderCreatedEvent } from './order.dto';
import { OrdersService } from './orders.service';

/** An http entry so the bus producers are reachable from a P01 entry node. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body() body: OrderCreatedEvent): { accepted: true } {
    this.orders.create(body);
    return { accepted: true };
  }
}
