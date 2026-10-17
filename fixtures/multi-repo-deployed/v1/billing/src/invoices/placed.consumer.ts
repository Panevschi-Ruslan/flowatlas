import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import type { OrderPlacedEvent } from './dto';

/** Pairs with the publisher in `orders`; breaks the rule `billing-reads-no-order-events` in every version. */
@Controller()
export class PlacedConsumer {
  @EventPattern('order.placed')
  onPlaced(@Payload() event: OrderPlacedEvent): void {
    void event;
  }
}
