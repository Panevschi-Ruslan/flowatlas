import { Body, Controller, Patch } from '@nestjs/common';
import { OrdersService } from './orders.service';

/** The API being changed: the back office's screen requests this route. */
@Controller('api/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Patch('status')
  setStatus(@Body() body: { orderId: string; status: string }): Promise<void> {
    return this.orders.updateStatus(body.orderId, body.status);
  }
}
