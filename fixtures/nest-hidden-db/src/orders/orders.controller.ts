import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { Order } from './order.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get(':id')
  get(@Param('id') id: string): Promise<Order | null> {
    return this.service.get(id);
  }

  @Post()
  create(@Body() order: Order): Promise<Order> {
    return this.service.create(order);
  }
}
