import { Body, Controller, Param, Post } from '@nestjs/common';

import { OrdersService } from './orders.service';
import type { OrderState } from './order.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':id/state')
  setState(@Param('id') id: string, @Body() body: { state: OrderState }): void {
    this.orders.publishLifecycle(id, body.state, { orderId: id });
  }
}
