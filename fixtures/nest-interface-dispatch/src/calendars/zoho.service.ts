import { Injectable } from '@nestjs/common';
import type { Calendar } from './calendar.js';

@Injectable()
export class ZohoCalendarService implements Calendar {
  async deleteEvent(uid: string): Promise<void> {
    await fetch(`${process.env.ZOHO_URL}/events/${uid}`, { method: 'DELETE' });
  }

  // The same call, spelled the same way, in another class. It runs zoho's
  // `deleteEvent`, and none of basecamp's request belongs here.
  async updateEvent(uid: string): Promise<void> {
    await this.deleteEvent('stale');
  }
}
