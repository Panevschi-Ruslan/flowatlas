import { Controller, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';

/** The route a person's click reaches, and where the publish starts. */
@Controller('depots/:depotId/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':orderId/cancel')
  cancel(
    @Param('depotId') depotId: string,
    @Param('orderId') orderId: string,
  ): Promise<void> {
    return this.orders.cancel(depotId, orderId);
  }
}
