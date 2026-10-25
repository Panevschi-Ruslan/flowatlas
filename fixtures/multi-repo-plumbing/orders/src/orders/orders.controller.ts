import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { AppLogger } from '../common/app-logger';
import type { CreateOrderDto, OrderDto } from './order.dto';
import { OrdersService } from './orders.service';

/** Every route logs the request before it hands it on. */
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly logger: AppLogger,
  ) {}

  @Get(':id')
  findOne(@Param('id') id: string): Promise<OrderDto> {
    this.logger.log(`GET /orders/${id}`, 'OrdersController');
    return this.orders.findOne(id);
  }

  /** `POST /orders`: the flow §1 of P92 asks to reach billing's `order.created` consumer. */
  @Post()
  create(@Body() body: CreateOrderDto): Promise<OrderDto> {
    this.logger.log('POST /orders', 'OrdersController');
    return this.orders.create(body);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string): Promise<OrderDto> {
    this.logger.log(`POST /orders/${id}/archive`, 'OrdersController');
    return this.orders.archive(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string): Promise<OrderDto> {
    this.logger.log(`POST /orders/${id}/cancel`, 'OrdersController');
    return this.orders.cancel(id);
  }
}
