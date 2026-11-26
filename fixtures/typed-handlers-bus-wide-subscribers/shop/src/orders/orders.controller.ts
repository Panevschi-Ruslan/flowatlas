import { Body, Controller, Param, Post } from '@nestjs/common';

import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  place(@Body() body: { orderId: string }): void {
    this.orders.place(body.orderId);
  }

  @Post(':id/ready')
  ready(@Param('id') id: string, @Body() body: { label: string }): void {
    this.orders.markReady(id, body.label);
  }

  @Post(':id/status')
  status(@Param('id') id: string, @Body() body: { status: string }): void {
    this.orders.changeStatus(id, body.status);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string): void {
    this.orders.cancel(id);
  }

  @Post(':id/refund')
  refund(@Param('id') id: string): void {
    this.orders.refund(id);
  }
}
