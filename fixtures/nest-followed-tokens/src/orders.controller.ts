import { Controller, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':id')
  place(@Param('id') id: string): string {
    return this.orders.place(id);
  }
}
