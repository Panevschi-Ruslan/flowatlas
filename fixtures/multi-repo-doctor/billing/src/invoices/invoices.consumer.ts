import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { Consumes } from '@flowatlas/markers';

import type { OrderCreatedEvent } from './dto';
import { InvoicesService } from './invoices.service';

/** Both halves of what `@Consumes` is for, and what it is not for. */
@Controller()
export class InvoicesConsumer {
  constructor(private readonly invoices: InvoicesService) {}

  /**
   * The annotation the code has made redundant: the decorator names the same
   * channel in a literal anybody can read.
   * Expected: `marker-consumes-shadowed`, a warning.
   */
  @Consumes('order.created')
  @EventPattern('order.created')
  onOrderCreated(@Payload() event: OrderCreatedEvent): void {
    this.invoices.record(event.id, event.total);
  }
}
