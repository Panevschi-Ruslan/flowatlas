import { Injectable } from '@nestjs/common';

import { EventBusService } from '../bus/event-bus.service';
import { Emits } from '@flowatlas/markers';
import type {
  OrderArchivedEvent,
  OrderCancelledEvent,
  OrderCreatedEvent,
  OrderExport,
} from './order.dto';

/**
 * Producers on the in-house bus, and the three marker cases.
 *
 * Every `this.bus.publish(...)` here is a producer only because
 * `flowatlas.config.json` declares the `event-bus` custom adapter; drop that entry
 * and this file yields nothing but ordinary call edges.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly bus: EventBusService) {}

  // The plain custom-adapter row: a literal channel, no marker involved.
  // Expected: `producer` + `channel:order.created` + `emits`, static,
  // `meta.adapter: "custom:event-bus"`.
  create(event: OrderCreatedEvent): void {
    this.bus.publish('order.created', event);
  }

  // The duplicate case (D5): the marker names the same channel the static
  // producer already resolves, so the marker edge is dropped and this method
  // yields exactly one `emits` edge, the `static` one. P11 flags the redundant
  // marker later; P04 must not emit a second edge.
  // Expected: one `emits` on `channel:order.created`, confidence `static`.
  @Emits('order.created')
  createAndNotify(event: OrderCreatedEvent): void {
    this.bus.publish('order.created', event);
  }

  // A marker on a method with no broker call at all: the producer's site is the
  // decorator itself (§10).
  // Expected: `producer` + `channel:order.exported` + `emits`, confidence
  // `marker`.
  @Emits('order.exported')
  exportAll(): OrderExport {
    return { rows: 0 };
  }

  // The marker earns its place here: the static producer exists but its channel
  // is computed, so the two describe different things and both edges survive
  // (D5 applies only when the channels match).
  // Expected: a `marker` edge to `channel:order.archived`, plus a `static`
  // producer with no channel and unresolved `channel-dynamic`.
  @Emits('order.archived')
  archive(event: OrderArchivedEvent): void {
    this.bus.publish(this.channelFor('archived'), event);
  }

  // A second static producer, on a different channel, with no marker.
  // Expected: `channel:order.cancelled`, static.
  cancel(event: OrderCancelledEvent): void {
    this.bus.publish('order.cancelled', event);
  }

  /** Builds a channel name at run time, which is what makes `archive` blind. */
  private channelFor(suffix: string): string {
    return `order.${suffix}`;
  }
}
