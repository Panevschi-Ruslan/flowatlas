import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type { CreateOrderDto, OrderDto } from '../dto/order.dto';

import { OrdersService } from './orders.service';

/** The routes the gateway aims at. The `drop-lookup` branch removes `GET /orders/:id`. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body() body: CreateOrderDto): Promise<OrderDto> {
    return this.orders.create(body);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<OrderDto> {
    return this.orders.findOne(id);
  }
}
