import { Body, Controller, Post } from '@nestjs/common';

@Controller()
export class PaymentsController {
  /** Reached from the shop by `PAYMENTS_BASE`, the container this repository is built into. */
  @Post('payments')
  async pay(@Body() body: { id: string }): Promise<unknown> {
    // `ORDERS_API` is `http://orders:3000` in this repository's `serverless.yml`.
    const order = await fetch(`${process.env.ORDERS_API}/orders/${body.id}`);
    return order.json();
  }

  /** Reached from the shop by the code's own fallback, `http://localhost:4000`. */
  @Post('refunds')
  refund(@Body() body: { id: string }): { id: string } {
    return body;
  }
}
