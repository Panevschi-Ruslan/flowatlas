import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { VenueBus } from '../bus/venue-bus.service';

interface VenueMessage {
  type: string;
  venueId: string;
}

/** Takes every type alike and records the venue. */
@Injectable()
export class AuditTrail implements OnModuleInit {
  private readonly lines: string[] = [];

  constructor(private readonly bus: VenueBus) {}

  onModuleInit(): void {
    this.bus.subscribe('venue_events', (evt: VenueMessage) => this.record(evt));
  }

  record(evt: VenueMessage): void {
    this.lines.push(evt.venueId);
  }
}
