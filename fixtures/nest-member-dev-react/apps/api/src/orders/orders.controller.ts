import { Body, Controller, Post } from '@nestjs/common';
import { sendReceipt } from '@member-dev-react/mailer';

@Controller('orders')
export class OrdersController {
  /** The only work is one package away: the receipt the mailer sends. */
  @Post()
  async place(@Body() order: { id: string; email: string }): Promise<{ id: string }> {
    await sendReceipt(order.email, order.id);
    return { id: order.id };
  }
}
