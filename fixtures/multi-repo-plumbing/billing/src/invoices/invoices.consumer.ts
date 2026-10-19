import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import type { OrderCreatedEvent } from './invoice.dto';
import { InvoicesService } from './invoices.service';

@Controller()
export class InvoicesConsumer {
  constructor(private readonly invoices: InvoicesService) {}

  /** Where `orders`' `POST /orders` ends: the consumer of `order.created`. */
  @EventPattern('order.created')
  onOrderCreated(@Payload() event: OrderCreatedEvent): void {
    this.invoices.create({ orderId: event.id, amount: event.total });
  }
}
