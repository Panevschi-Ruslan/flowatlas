import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import { OrdersClient } from '../clients/orders.client';

/**
 * A handler for a message nothing publishes.
 *
 * Reported as a channel with no producer, and the entry that handles it is
 * reported dead: a handler nothing can reach is dead in a way a route with no
 * internal callers is not.
 *
 * It still makes a request, and that request still counts toward the in-degree
 * of the route it addresses. `hotspots` measures what points at a node, not
 * what runs, and the two are not the same thing.
 */
@Controller()
export class OrphanConsumer {
  constructor(private readonly orders: OrdersClient) {}

  @EventPattern('orphan.in')
  onOrphan(@Payload() event: { id: string }): void {
    this.orders.create(event.id);
  }
}
