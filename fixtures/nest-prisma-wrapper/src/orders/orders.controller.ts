import { Controller, Delete, Get, Post } from '@nestjs/common';
import type { Order } from '@acme/db';

import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  findAll(): Promise<Order[]> {
    return this.orders.findAll();
  }

  @Post()
  create(): Promise<Order> {
    return this.orders.create('1');
  }

  @Delete()
  remove(): Promise<Order> {
    return this.orders.remove('1');
  }
}
