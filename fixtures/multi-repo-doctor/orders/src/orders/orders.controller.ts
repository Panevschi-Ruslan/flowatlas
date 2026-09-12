import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type { CreateOrderDto, OrderDto } from './dto';
import { OrdersService } from './orders.service';

/** The three routes this project has, and the one it is asked for and has not. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body() body: CreateOrderDto): Promise<OrderDto> {
    return this.orders.create(body);
  }

  @Post('legacy')
  legacy(@Body() body: CreateOrderDto): Promise<OrderDto> {
    return this.orders.create(body);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<OrderDto> {
    return this.orders.findOne(id);
  }
}
