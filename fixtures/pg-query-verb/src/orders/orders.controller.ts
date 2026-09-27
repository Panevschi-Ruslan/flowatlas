import { Controller, Get } from '@nestjs/common';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  findAll(): Promise<unknown> {
    return this.orders.findAll();
  }

  @Get('report')
  report(): Promise<unknown> {
    return this.orders.report();
  }

  @Get('plan')
  plan(): Promise<unknown> {
    return this.orders.plan();
  }
}
