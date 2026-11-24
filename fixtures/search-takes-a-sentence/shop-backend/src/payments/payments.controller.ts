import { Body, Controller, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Takes a payment: what "what handles payments" means. */
  @Post()
  capture(@Body() body: { orderId: string; amount: number }): number {
    return this.payments.capture(body.orderId, body.amount);
  }
}
