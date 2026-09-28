import { Controller, Get } from '@nestjs/common';
import type { Order } from '@acme/db';

import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  all(): Promise<Order[]> {
    return this.orders.all();
  }

  @Get('recent')
  recent(): Promise<Order[]> {
    return this.orders.recent();
  }
}
