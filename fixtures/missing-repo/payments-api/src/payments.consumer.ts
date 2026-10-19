import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

/** The consumer `orders` publishes to, once this repository is in the configuration. */
@Controller()
export class PaymentsConsumer {
  @EventPattern('payment.requested')
  onRequested(@Payload() event: { orderId: string; amount: number }): void {
    void event;
  }
}
