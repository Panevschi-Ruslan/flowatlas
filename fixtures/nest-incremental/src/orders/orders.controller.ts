import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { ApiKeyGuard } from '../guards/api-key.guard';
import type { CreateOrderDto, OrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(ApiKeyGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':id')
  findOne(@Param('id') id: string): OrderDto {
    return this.orders.findOne(id);
  }

  @Post()
  create(@Body() body: CreateOrderDto): OrderDto {
    return this.orders.create(body);
  }
}
