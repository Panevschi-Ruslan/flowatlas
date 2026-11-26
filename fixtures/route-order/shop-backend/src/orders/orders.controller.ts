import { Controller, Get, Param } from '@nestjs/common';
import { OrdersService, type Order, type OrdersSummary } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Spelled out and declared above the parameter route: it answers. */
  @Get('summary')
  summary(): OrdersSummary {
    return this.orders.summary();
  }

  @Get(':orderId')
  findOne(@Param('orderId') orderId: string): Order {
    return this.orders.byId(orderId);
  }

  /** Declared below `:orderId`, which answers `/orders/latest` first: never reached. */
  @Get('latest')
  latest(): Order {
    return this.orders.latest();
  }
}
