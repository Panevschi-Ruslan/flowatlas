import { Injectable } from '@nestjs/common';

import { VenueBus } from '../bus/venue-bus.service';
import { VenueEvent } from '../events/venue-event';

/** The orders of a venue, each change told on `venue_events`. */
@Injectable()
export class OrdersService {
  constructor(private readonly bus: VenueBus) {}

  markReady(venueId: string, orderId: string, roomId: string): void {
    this.bus.publish('venue_events', { type: VenueEvent.OrderReady, venueId, orderId, roomId });
  }

  /** Chosen by no code by name; a prefix test elsewhere may take it. */
  markPaid(venueId: string, orderId: string): void {
    this.bus.publish('venue_events', { type: VenueEvent.OrderPaid, venueId, orderId });
  }

  /** Chosen by no consumer the graph read; code past a hand-off compares its name. */
  freeTable(venueId: string, roomId: string): void {
    this.bus.publish('venue_events', { type: VenueEvent.TableFreed, venueId, roomId });
  }
}
