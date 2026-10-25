import { Body, Controller, Param, Post } from '@nestjs/common';

import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() body: { amount: number }): Promise<string> {
    return this.orders.confirm(id, body.amount);
  }
}
