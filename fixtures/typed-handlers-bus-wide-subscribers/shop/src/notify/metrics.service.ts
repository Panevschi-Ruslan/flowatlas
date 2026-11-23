import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { EventsService } from '../bus/events.service';

/**
 * Subscribes to every channel of the bus with a callback that only hands each
 * frame's message on, as its second argument, to a method that chooses.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private placed = 0;

  constructor(private readonly bus: EventsService) {}

  onModuleInit(): void {
    this.bus.all().subscribe(({ scopeId, data }) => this.count(scopeId, data));
  }

  private count(scopeId: string, raw: unknown): void {
    const evt = raw as { type: string };
    if (evt.type === 'ORDER_PLACED') this.placed += scopeId.length > 0 ? 1 : 0;
  }
}
