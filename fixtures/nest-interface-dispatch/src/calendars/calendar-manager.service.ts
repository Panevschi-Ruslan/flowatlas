import { Injectable } from '@nestjs/common';
import { BasecampCalendarService } from './basecamp.service.js';
import type { Calendar } from './calendar.js';

@Injectable()
export class CalendarManagerService {
  constructor(private readonly basecamp: BasecampCalendarService) {}

  // Through the interface: which implementation runs is decided at run time,
  // so neither provider's request can be attributed here, and each keeps its
  // own.
  async remove(calendar: Calendar): Promise<void> {
    await calendar.deleteEvent('cancelled');
  }

  // Through the concrete class: this is basecamp's request, made from here.
  async archive(): Promise<void> {
    await this.basecamp.deleteEvent('archived');
  }
}
