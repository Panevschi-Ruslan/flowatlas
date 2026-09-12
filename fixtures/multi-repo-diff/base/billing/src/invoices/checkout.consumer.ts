import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import { OrdersClient } from './orders.client';

/**
 * The way in that makes `billing` part of the blast radius.
 *
 * A cart checked out somewhere else becomes an order here, so a change to
 * `OrdersService.create` in another repository is reachable from a channel
 * handler — which is precisely the kind of caller nobody remembers to retest.
 *
 * Nothing in this project publishes `cart.checked-out`; it comes from a service
 * the configuration does not list, which the linker reports rather than treats
 * as a fault.
 */
@Controller()
export class CheckoutConsumer {
  constructor(private readonly orders: OrdersClient) {}

  @EventPattern('cart.checked-out')
  onCheckedOut(@Payload() event: { customerId: string }): void {
    this.orders.create({ customerId: event.customerId, note: 'from cart' });
  }
}
