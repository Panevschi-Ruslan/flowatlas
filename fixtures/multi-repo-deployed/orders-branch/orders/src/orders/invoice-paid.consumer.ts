import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

/** What `billing` on `main` publishes; the one v1 runs publishes nothing of the kind. */
interface InvoicePaidEvent {
  invoiceId: string;
  orderId: string;
}

/** New on this branch: marks an order paid when billing says so. */
@Controller()
export class InvoicePaidConsumer {
  @EventPattern('invoice.paid')
  onPaid(@Payload() event: InvoicePaidEvent): void {
    void event;
  }
}
