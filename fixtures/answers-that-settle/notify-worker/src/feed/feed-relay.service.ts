import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { VenueBus } from '../bus/venue-bus.service';
import { FeedGateway } from './feed.gateway';

interface VenueMessage {
  type: string;
  venueId: string;
}

/** Takes every type and hands each to the feed, choosing none. */
@Injectable()
export class FeedRelay implements OnModuleInit {
  constructor(
    private readonly bus: VenueBus,
    private readonly gateway: FeedGateway,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('venue_events', (evt: VenueMessage) => this.onEvent(evt));
  }

  onEvent(evt: VenueMessage): void {
    this.gateway.push(evt);
  }
}
