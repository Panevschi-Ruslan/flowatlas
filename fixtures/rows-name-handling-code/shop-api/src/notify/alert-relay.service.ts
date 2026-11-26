import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { EventsService } from '../bus/events.service';

interface Alert {
  type?: string;
  deskNumber?: number;
}

/**
 * Subscribes to every channel of the bus when the module starts, and pages the
 * staff on one type of message. Only `desk_alerts` publishes that type; the
 * cart channels the bus also carries publish no type at all.
 */
@Injectable()
export class AlertRelay implements OnModuleInit {
  constructor(private readonly bus: EventsService) {}

  onModuleInit(): void {
    this.bus.all().subscribe(({ scopeId, data }) => {
      const alert = data as Alert;
      if (alert.type === 'HELP_REQUESTED') this.pageStaff(scopeId, alert);
    });
  }

  private pageStaff(scopeId: string, alert: Alert): void {
    void scopeId;
    void alert.deskNumber;
  }
}
