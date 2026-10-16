import { Body, Controller, Param, Post } from '@nestjs/common';
import type { Receipt } from '@shopkit/mailer';

import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  place(@Body() body: { sku: string; quantity: number }): Promise<Receipt> {
    return this.orders.place(body.sku, body.quantity);
  }

  @Post(':id/resend')
  resend(@Param('id') id: string): Promise<Receipt> {
    return this.orders.resend(id);
  }
}
