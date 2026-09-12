import { Controller, Get, Param } from '@nestjs/common';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':id')
  findOne(@Param('id') id: string): { data: unknown } {
    return this.orders.fetchOne(id);
  }

  @Get()
  settings(): unknown {
    return this.orders.settings();
  }
}
