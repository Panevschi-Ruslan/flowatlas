import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { SpaceBus } from '../bus/space-bus.service';
import type { ExportFinished, SpaceEvent } from './space-events';

/** A guard that returns early unless the type is one: everything after it handles that type. */
@Injectable()
export class ExportWatcher implements OnModuleInit {
  constructor(private readonly bus: SpaceBus) {}

  onModuleInit(): void {
    this.bus.subscribe('space:*:events', (event: SpaceEvent) => this.onEvent(event));
  }

  onEvent(event: SpaceEvent): void {
    if (event.type !== 'EXPORT_FINISHED') return;
    this.notifyOwner(event);
  }

  notifyOwner(event: ExportFinished): void {
    void event.url;
  }
}
