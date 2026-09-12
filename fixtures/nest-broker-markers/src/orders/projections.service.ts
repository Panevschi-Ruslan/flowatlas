import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { EventBusService } from '../bus/event-bus.service';
import { Consumes } from '@flowatlas/markers';
import type { OrderCancelledEvent, OrderCreatedEvent } from './order.dto';

/**
 * Consumers of the in-house bus. `adapters.broker.custom` declares an empty
 * `consumers` list for `event-bus` (D3), so the subscriptions below produce
 * nothing on their own — the `@Consumes` markers are the only thing that makes
 * these methods consumers, which is exactly the case I10 reserves markers for.
 */
@Injectable()
export class ProjectionsService implements OnModuleInit {
  constructor(private readonly bus: EventBusService) {}

  onModuleInit(): void {
    this.bus.on('order.created', (event: OrderCreatedEvent) => this.onOrderCreated(event));
    this.bus.on('order.cancelled', (event: OrderCancelledEvent) => this.onOrderCancelled(event));
  }

  // Expected: `consumer` + `consumes` from `channel:order.created` + `handles`,
  // all with confidence `marker` and `meta.entryId: null`.
  @Consumes('order.created')
  onOrderCreated(event: OrderCreatedEvent): void {
    void event.orderId;
  }

  // The same, on a channel this repo also produces: the `channel:order.cancelled`
  // node is shared by the producer in `OrdersService.cancel` and this consumer.
  @Consumes('order.cancelled')
  onOrderCancelled(event: OrderCancelledEvent): void {
    void event.reason;
  }
}
