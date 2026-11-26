import { Injectable } from '@nestjs/common';

import { EventsService } from '../bus/events.service';

@Injectable()
export class DeskService {
  constructor(private readonly events: EventsService) {}

  requestHelp(deskId: string, deskNumber: number): void {
    this.events.publish('desk_alerts', deskId, { type: 'HELP_REQUESTED', deskNumber });
  }
}
