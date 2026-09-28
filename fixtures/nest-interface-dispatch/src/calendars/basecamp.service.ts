import { Injectable } from '@nestjs/common';
import type { Calendar } from './calendar.js';

@Injectable()
export class BasecampCalendarService implements Calendar {
  async deleteEvent(uid: string): Promise<void> {
    await fetch(`${process.env.BASECAMP_URL}/schedule_entries/${uid}/trashed.json`);
  }

  // Calls itself through `this`, which runs this class's `deleteEvent` and no
  // other: the draft entry is trashed at basecamp.
  async updateEvent(uid: string): Promise<void> {
    await this.deleteEvent('draft');
  }
}
