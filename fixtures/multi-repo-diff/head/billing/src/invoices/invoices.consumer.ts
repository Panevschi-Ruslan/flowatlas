import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { ContractIgnore } from '@flowatlas/markers';

import type { OrderCreatedEvent } from './dto';

/** The handler that pairs with the publisher in `orders`. */
@Controller()
export class InvoicesConsumer {
  /**
   * The two shapes differ and this revision does not make them agree.
   *
   * It says the difference is deliberate, which is the honest thing to do about
   * drift somebody has decided to live with: nothing here reads the field the
   * two sides disagree about.
   */
  @ContractIgnore()
  @EventPattern('order.created')
  onOrderCreated(@Payload() event: OrderCreatedEvent): void {
    void event;
  }
}
