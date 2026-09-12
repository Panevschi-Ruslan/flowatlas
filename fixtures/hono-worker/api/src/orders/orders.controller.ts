import { Controller, Get, Param, Post } from '@nestjs/common';
import { OrdersService, type Order } from './orders.service';

/**
 * The Nest half of the repository.
 *
 * Nothing here knows a worker exists, and nothing about how it is read may
 * change because one does: this controller is the regression evidence for R15.
 */
@Controller('depots/:depotId/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Param('depotId') depotId: string): Promise<Order[]> {
    return this.orders.list(depotId);
  }

  @Post(':orderId/cancel')
  cancel(
    @Param('depotId') depotId: string,
    @Param('orderId') orderId: string,
  ): Promise<void> {
    return this.orders.cancel(depotId, orderId);
  }
}
