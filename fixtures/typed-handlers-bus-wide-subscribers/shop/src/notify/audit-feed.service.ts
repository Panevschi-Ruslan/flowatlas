import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { EventsService } from '../bus/events.service';

/**
 * Subscribes to every channel of the bus, and keeps the types it is handed:
 * a set filled when the code runs, so which types it takes is not read.
 */
@Injectable()
export class AuditFeed implements OnModuleInit {
  private readonly kept = new Set<string>();
  private readonly lines: string[] = [];

  constructor(private readonly bus: EventsService) {}

  /** Called with the types a setting names, when the code runs. */
  keep(types: readonly string[]): void {
    for (const type of types) this.kept.add(type);
  }

  onModuleInit(): void {
    this.bus.all().subscribe(({ data }) => {
      const evt = data as { type: string };
      if (!this.kept.has(evt.type)) return;
      this.record(evt.type);
    });
  }

  private record(type: string): void {
    this.lines.push(type);
  }
}
