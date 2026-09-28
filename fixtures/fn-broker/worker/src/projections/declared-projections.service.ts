import { Injectable } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import type { OrderEvent } from './order-event';

/**
 * The same consumer, in the other spelling.
 *
 * `OrderProjections.onCreated` beside this one receives `orders:created` through
 * a `bus.subscribe(channel, handler)` call; this receives it through a decorator
 * a framework entry reader knows. Nothing else differs: the same channel, the
 * same payload type, and either one would be a perfectly ordinary way to write
 * the only consumer a service has.
 *
 * It is here because the two used to disagree about what the graph could say.
 * The decorated handler had an `entry` node, so the shape it receives was read
 * off the `handles` edge and compared against what `api` publishes; the
 * call-registered one had none, so the comparison had nothing to compare and
 * reported `no-type-on-receiver` - the row for a receiver whose shape cannot be
 * read at all - about a parameter written in plain sight two lines away (R126).
 *
 * So this file is the control. Both consumers of `orders:created` are compared,
 * and a change that only reads one of the two spellings shows up as one of these
 * four boundaries going unchecked while its twin is checked.
 */
@Injectable()
export class DeclaredProjections {
  @EventPattern('orders:created')
  onCreated(@Payload() event: OrderEvent): void {
    void event.orderId;
  }
}
