import { Injectable } from '@nestjs/common';

import { EventBusService } from '../bus/event-bus.service';
import { Emits } from '@flowatlas/markers';
import { SHIPPING_CHANNELS } from './channels';
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

  // The four ways to name more than one channel, which all mean the same thing
  // (R38). Each publishes through a computed channel, so the annotation is
  // earning its place rather than repeating what the code says.
  //
  // Expected, for each: one producer whose label names every channel it
  // publishes, and one `emits` edge per channel, confidence `marker`.
  @Emits('order.held', 'order.released')
  severalArguments(event: OrderArchivedEvent): void {
    this.bus.publish(this.channelFor('held-or-released'), event);
  }

  @Emits(['order.split', 'order.merged'])
  aListInPlace(event: OrderArchivedEvent): void {
    this.bus.publish(this.channelFor('split-or-merged'), event);
  }

  @Emits(SHIPPING_CHANNELS)
  aCatalogue(event: OrderArchivedEvent): void {
    this.bus.publish(this.channelFor('shipping'), event);
  }

  // The form the three above shorten. It has to mean exactly what they mean,
  // which is why it is here rather than only in the older cases.
  @Emits('order.refunded')
  @Emits('order.reopened')
  stacked(event: OrderArchivedEvent): void {
    this.bus.publish(this.channelFor('refunded-or-reopened'), event);
  }

  // Given an argument and left naming nothing. Expected: no channel, and
  // `marker-names-nothing` from `doctor` — never silence, which is the whole
  // point of the ticket.
  @Emits([])
  namesNothing(event: OrderArchivedEvent): void {
    this.bus.publish(this.channelFor('nothing'), event);
  }

  // Resolved, and not a name. Expected: `marker-arg-not-a-name`.
  @Emits(7 as unknown as string)
  notAName(event: OrderArchivedEvent): void {
    this.bus.publish(this.channelFor('number'), event);
  }

  /** Builds a channel name at run time, which is what makes `archive` blind. */
  private channelFor(suffix: string): string {
    return `order.${suffix}`;
  }
}
