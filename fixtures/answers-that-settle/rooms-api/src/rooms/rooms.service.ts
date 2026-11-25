import { Injectable } from '@nestjs/common';

import { VenueBus } from '../bus/venue-bus.service';
import { VenueEvent } from '../events/venue-event';

/** The rooms of a venue, and what each change tells the venue's channels. */
@Injectable()
export class RoomsService {
  constructor(private readonly bus: VenueBus) {}

  freeTimes(venueId: string): string[] {
    return [`${venueId}:09:00`, `${venueId}:10:00`];
  }

  /** Published, and compared by no code: its name is written only here and where it is defined. */
  claimRow(venueId: string, roomId: string): void {
    this.bus.publish('venue_events', { type: VenueEvent.RowClaimed, venueId, roomId });
  }

  callStaff(venueId: string, roomId: string, note: string): void {
    this.bus.publish('venue_events', { type: VenueEvent.CallStaff, venueId, roomId, note });
  }

  /** Told on both channels: the staff bot reads `roomName` on the second. */
  roomReady(venueId: string, roomId: string, roomName: string): void {
    this.bus.publish('venue_events', { type: VenueEvent.RoomReady, venueId, roomId, roomName });
    this.bus.publish('staff_feed', { type: VenueEvent.RoomReady, venueId, roomId, roomName });
  }
}
