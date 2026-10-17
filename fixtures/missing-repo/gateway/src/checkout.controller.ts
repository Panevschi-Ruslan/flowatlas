import { Body, Controller, Param, Post } from '@nestjs/common';

/**
 * Two requests rooted at `PAYMENTS_URL`, which no configured service claims:
 * the service that answers them is in `payments-api`, beside this repository
 * and not in the configuration.
 */
@Controller('checkout')
export class CheckoutController {
  @Post(':id/pay')
  async pay(@Param('id') id: string, @Body() body: { amount: number }): Promise<unknown> {
    const charge = await fetch(`${process.env.PAYMENTS_URL}/charges`, {
      method: 'POST',
      body: JSON.stringify({ orderId: id, amount: body.amount }),
    });
    return charge.json();
  }

  @Post(':id/refund')
  async refund(@Param('id') id: string): Promise<unknown> {
    const refund = await fetch(`${process.env.PAYMENTS_URL}/refunds`, {
      method: 'POST',
      body: JSON.stringify({ orderId: id }),
    });
    return refund.json();
  }
}
