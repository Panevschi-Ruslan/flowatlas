import { Body, Controller, Post } from '@nestjs/common';
import { receiptHtml } from '@rendered-mail/mail';
import { relay } from '@rendered-mail/relay';
import { lookupCustomer } from '@rendered-mail/sdk';

@Controller('orders')
export class OrdersController {
  /**
   * Renders the receipt with the mail package's templates, looks the customer
   * up through the SDK, and hands the message to the relay. Three members, and
   * only the first of them renders anything.
   */
  @Post()
  async place(@Body() order: { id: string; email: string }): Promise<{ id: string }> {
    const customer = await lookupCustomer(order.email);
    await relay(customer.email, receiptHtml(order.id));
    return { id: order.id };
  }
}
