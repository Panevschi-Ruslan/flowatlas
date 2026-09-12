import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type { CreateOrderDto, OrderDto } from '../dto/create-order.dto';

import { OrdersService } from './orders.service';

/**
 * The routes every other repository in this fixture aims at.
 *
 * The head revision changes nothing here but the shape of the import above,
 * which moves every line in the file down by five. Nothing in this file
 * changed, and a diff that says otherwise is reporting a whitespace edit as a
 * change to the project.
 */
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
