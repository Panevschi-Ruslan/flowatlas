import { Controller, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('shops/:shopId/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':orderId')
  place(@Param('shopId') shopId: string, @Param('orderId') orderId: string): Promise<void> {
    return this.orders.place(shopId, orderId);
  }

  @Post(':orderId/ship')
  ship(@Param('shopId') shopId: string, @Param('orderId') orderId: string): Promise<void> {
    return this.orders.ship(shopId, orderId);
  }
}
