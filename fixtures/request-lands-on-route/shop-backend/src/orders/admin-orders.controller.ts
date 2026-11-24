import { Body, Controller, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('admin/:storeId/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':orderId/modify')
  modify(@Param('storeId') storeId: string, @Param('orderId') orderId: string, @Body() body: { lines: string[] }): number {
    return this.orders.modify(storeId, orderId, body.lines);
  }
}
