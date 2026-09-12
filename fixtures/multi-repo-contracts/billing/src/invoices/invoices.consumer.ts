import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import type { OrderCreatedEvent } from './dto';

/** The handler that pairs with the publisher in `orders`. */
@Controller()
export class InvoicesConsumer {
  /**
   * One `channel:order.created`, one publisher, one handler, two repositories.
   * The two ends declare the payload differently, and there is no compiler
   * anywhere on that path to notice.
   */
  @EventPattern('order.created')
  onOrderCreated(@Payload() event: OrderCreatedEvent): void {
    void event;
  }
}
