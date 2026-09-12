import { Controller, Get, Param, Post } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  findAll(): Promise<Order[]> {
    return this.orders.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Order | null> {
    return this.orders.findOne(id);
  }

  @Post()
  create(): Promise<Order> {
    return this.orders.create('u1');
  }
}
