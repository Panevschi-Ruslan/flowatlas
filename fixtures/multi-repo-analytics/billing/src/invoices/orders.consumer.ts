import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import { InvoicesService } from './invoices.service';

@Controller()
export class OrdersConsumer {
  constructor(private readonly invoices: InvoicesService) {}

  @EventPattern('order.changed')
  onOrderChanged(@Payload() event: { orderId: string }): void {
    this.invoices.sync(event.orderId);
  }
}
