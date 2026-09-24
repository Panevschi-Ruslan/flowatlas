import { Controller, Delete, Get, Post } from '@nestjs/common';

import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  findAll(): Promise<unknown[]> {
    return this.orders.findAll();
  }

  @Post()
  create(): Promise<unknown> {
    return this.orders.create(10);
  }

  @Delete()
  remove(): Promise<unknown> {
    return this.orders.remove('1');
  }
}
