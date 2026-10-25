import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type { CreateOrderDto, OrderDto } from '../clients/dto';
import { OrdersClient } from '../clients/orders.client';

/** What the bookshop's browser talks to. */
@Controller('orders')
export class GatewayController {
  constructor(private readonly orders: OrdersClient) {}

  @Post()
  create(@Body() body: CreateOrderDto): OrderDto {
    this.orders.create(body);
    return { id: '1', bookId: body.bookId, status: 'placed' };
  }

  @Get(':id')
  findOne(@Param('id') id: string): void {
    this.orders.findOne(id);
  }
}
