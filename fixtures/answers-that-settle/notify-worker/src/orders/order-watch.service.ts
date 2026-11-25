import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { VenueBus } from '../bus/venue-bus.service';

interface VenueMessage {
  type: string;
  venueId: string;
}

/** Counts the order types by a prefix: a test no name rules out. */
@Injectable()
export class OrderWatch implements OnModuleInit {
  private count = 0;

  constructor(private readonly bus: VenueBus) {}

  onModuleInit(): void {
    this.bus.subscribe('venue_events', (evt: VenueMessage) => this.onEvent(evt));
  }

  onEvent(evt: VenueMessage): void {
    if (evt.type.startsWith('ORDER_')) this.count += 1;
  }
}
