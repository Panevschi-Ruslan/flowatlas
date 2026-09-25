import { Body, Controller, Delete, Get, Post } from '@nestjs/common';

import { OrdersService } from './orders.service.js';
import type { OrderDocument } from './order.model.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  findAll(): Promise<OrderDocument[]> {
    return this.orders.findAll();
  }

  @Post()
  create(@Body() body: OrderDocument): Promise<OrderDocument> {
    return this.orders.create(body);
  }

  @Delete()
  remove(): Promise<unknown> {
    return this.orders.remove('1');
  }
}
