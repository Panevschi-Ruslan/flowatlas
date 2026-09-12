import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import type { OrderCreatedEvent } from './dto';

/** The handler that pairs with the publisher in `orders`. */
@Controller()
export class InvoicesConsumer {
  @EventPattern('order.created')
  onOrderCreated(@Payload() event: OrderCreatedEvent): void {
    void event;
  }
}
