import { Controller, Delete, Param, Patch, Post, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';

/** Three routes, each publishing on `shop:<id>:orders`. */
@Controller('api/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Query('shopId') shopId: string): Promise<void> {
    return this.orders.create(shopId);
  }

  @Patch(':orderId/status')
  setStatus(@Query('shopId') shopId: string, @Param('orderId') orderId: string): Promise<void> {
    return this.orders.setStatus(shopId, orderId);
  }

  @Delete(':orderId')
  remove(@Query('shopId') shopId: string, @Param('orderId') orderId: string): Promise<void> {
    return this.orders.remove(shopId, orderId);
  }
}
