import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import { OrdersService } from '../orders/orders.service';

/** Handles what `billing` publishes, and calls the method that publishes back. */
@Controller()
export class InvoicesConsumer {
  constructor(private readonly orders: OrdersService) {}

  @EventPattern('invoice.changed')
  onInvoiceChanged(@Payload() event: { orderId: string }): void {
    this.orders.sync(event.orderId);
  }
}
