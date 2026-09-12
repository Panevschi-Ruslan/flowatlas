import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';

import { Order } from './order.entity';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  findAll(): Promise<Order[]> {
    return this.orders.findAll();
  }

  @Get('recent')
  recent(): unknown {
    return this.orders.recent();
  }

  @Post()
  create(@Body() body: Order): Promise<Order> {
    return this.orders.create(body);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.orders.remove(id);
  }
}
