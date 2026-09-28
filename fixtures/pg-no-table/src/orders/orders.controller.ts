import { Controller, Get, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  findAll(): Promise<unknown> {
    return this.orders.findAll();
  }

  @Get('ping')
  ping(): Promise<unknown> {
    return this.orders.ping();
  }

  @Post()
  place(): Promise<void> {
    return this.orders.place(1);
  }

  @Get('count/:table')
  countIn(@Param('table') table: string): Promise<unknown> {
    return this.orders.countIn(table);
  }
}
