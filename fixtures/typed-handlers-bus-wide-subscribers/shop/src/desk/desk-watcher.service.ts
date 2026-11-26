import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { EventsService } from '../bus/events.service';

interface DeskEvent {
  type: string;
  deskNumber: number;
}

/**
 * Subscribes to one channel with a handler written in place, which does more
 * than hand the message on: it is read for the type it chooses as a named
 * function would be.
 */
@Injectable()
export class DeskWatcher implements OnModuleInit {
  private readonly closed: number[] = [];

  constructor(private readonly bus: EventsService) {}

  onModuleInit(): void {
    this.bus.subscribe('desk_alerts', (data) => {
      const evt = data as DeskEvent;
      if (evt.type === 'DESK_CLOSED') {
        this.archive(evt.deskNumber);
        this.log(`desk ${evt.deskNumber} closed`);
      }
    });
  }

  private archive(deskNumber: number): void {
    this.closed.push(deskNumber);
  }

  private log(line: string): void {
    void line;
  }
}
