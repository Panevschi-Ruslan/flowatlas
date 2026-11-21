import { Body, Controller, Patch } from '@nestjs/common';
import { OrdersService } from './orders.service';

/** The crossing: the back office's screen and the operations bot both request this route. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Patch('status')
  setStatus(@Body() body: { orderId: string; status: string }): Promise<void> {
    return this.orders.updateStatus(body.orderId, body.status);
  }
}
