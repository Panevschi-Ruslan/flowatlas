import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import type { InvoiceRequestedEvent, OrderCreatedEvent } from './invoice.dto';
import { InvoicesService } from './invoices.service';

/** Both consumers: the one that pairs with a producer, and the one that does not. */
@Controller()
export class InvoicesConsumer {
  constructor(private readonly invoices: InvoicesService) {}

  /**
   * Pairs with `OrdersService.create` in the `orders` repository. One
   * `channel:order.created` node, no repo prefix, one producer and one consumer
   * across two repositories, `channels.linked` = 1 (§12).
   */
  @EventPattern('order.created')
  onOrderCreated(@Payload() event: OrderCreatedEvent): void {
    this.invoices.create({ orderId: event.id, amount: event.total.amount });
  }

  /**
   * Nothing in the project publishes `invoice.requested`.
   * Expected: `channels.noProducers` contains `channel:invoice.requested` — a
   * report entry, not an unresolved (D7). A consumer with no producer is how a
   * dead handler looks, and P11 decides whether that is an error.
   */
  @EventPattern('invoice.requested')
  onInvoiceRequested(@Payload() event: InvoiceRequestedEvent): void {
    this.invoices.create({ orderId: event.orderId, amount: event.amount });
  }
}
