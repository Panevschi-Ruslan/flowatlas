import { Body, Controller, Post } from '@nestjs/common';

/** What the gateway asks for at `PAYMENTS_URL`, once this repository is in the configuration. */
@Controller()
export class ChargesController {
  @Post('charges')
  charge(@Body() body: { orderId: string; amount: number }): { id: string } {
    return { id: `ch_${body.orderId}` };
  }

  @Post('refunds')
  refund(@Body() body: { orderId: string }): { id: string } {
    return { id: `re_${body.orderId}` };
  }
}
