import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import { VenueBus } from '../bus/venue-bus.service';
import { SlotRenderer } from './slot-renderer.service';

/**
 * The bot's rooms: `getFreeTimes` asks the rooms API for a venue's free times,
 * renders them, and tells the staff feed they were shown, a type the feed's
 * one consumer does not choose: a step the flow cannot follow, off the
 * request's way.
 */
@Injectable()
export class RoomService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly renderer: SlotRenderer,
    private readonly bus: VenueBus,
  ) {}

  async getFreeTimes(venueId: string): Promise<string> {
    const slots = await this.fetchSlots(venueId);
    this.bus.publish('staff_feed', { type: 'SLOTS_SHOWN', venueId, count: slots.length });
    return this.renderer.render(slots);
  }

  async fetchSlots(venueId: string): Promise<string[]> {
    const response = await firstValueFrom(this.http.get<string[]>(`${this.config.get('ROOMS_API_URL')}/api/admin/${venueId}/rooms/free-times`));
    return response.data;
  }
}
