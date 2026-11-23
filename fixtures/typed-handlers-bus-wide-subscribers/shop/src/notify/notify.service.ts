import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { EventsService } from '../bus/events.service';

interface Evt {
  type: string;
  deskNumber?: number;
  orderId?: string;
}

/**
 * Subscribes to every channel of the bus when the module starts and chooses by
 * type in the callback: a constant set gates what is handed on, and the method
 * it hands on to chooses again with a `switch`.
 */
@Injectable()
export class NotifyService implements OnModuleInit {
  private static readonly RELEVANT = new Set(['HELP_REQUESTED', 'ORDER_READY']);

  constructor(private readonly bus: EventsService) {}

  onModuleInit(): void {
    this.bus.all().subscribe(({ scopeId, data }) => {
      const evt = data as Evt;
      if (!evt || !evt.type) return;
      if (!NotifyService.RELEVANT.has(evt.type)) return;
      void this.dispatch(scopeId, data);
    });
  }

  private async dispatch(scopeId: string, raw: unknown): Promise<void> {
    const evt = raw as Evt;
    switch (evt.type) {
      case 'HELP_REQUESTED':
        await this.pageStaff(scopeId, evt);
        return;
      case 'ORDER_READY':
        await this.pingCustomer(scopeId, evt);
        return;
      default:
        return;
    }
  }

  private async pageStaff(scopeId: string, evt: Evt): Promise<void> {
    void scopeId;
    void evt.deskNumber;
  }

  private async pingCustomer(scopeId: string, evt: Evt): Promise<void> {
    void scopeId;
    void evt.orderId;
  }
}
