import { Body, Controller, Post } from '@nestjs/common';

import type { CreateOrderDto, OrderDto } from '../dto/order.dto';

import { OrdersService } from './orders.service';

/** `GET /orders/:id` is gone on this branch; the deployed gateway still asks for it. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body() body: CreateOrderDto): Promise<OrderDto> {
    return this.orders.create(body);
  }
}
