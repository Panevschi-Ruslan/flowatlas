import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import type { OrderDto } from '@fx/contracts';

/**
 * A second handler of `order.created`, in the gateway. Expected: the one
 * violation of `only-billing-consumes-order-events`; billing's handler passes.
 */
@Controller()
export class OrderAuditConsumer {
  private readonly seen: string[] = [];

  @EventPattern('order.created')
  onOrderCreated(@Payload() order: OrderDto): void {
    this.seen.push(order.id);
  }
}
