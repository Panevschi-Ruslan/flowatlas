import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { SpaceBus } from '../bus/space-bus.service';
import type { SpaceEvent } from './space-events';

/**
 * The trap: a subscription that would select `QUOTA_WARNING`, in a class no
 * module registers and nothing injects. Nothing builds it, so it never
 * subscribes, and the type stays one no code that runs selects.
 */
@Injectable()
export class LegacyDigest implements OnModuleInit {
  constructor(private readonly bus: SpaceBus) {}

  onModuleInit(): void {
    this.bus.subscribe('space:*:events', (event: SpaceEvent) => this.onEvent(event));
  }

  onEvent(event: SpaceEvent): void {
    if (event.type === 'QUOTA_WARNING') this.mailQuota(event.usedBytes);
  }

  mailQuota(usedBytes: number): void {
    void usedBytes;
  }
}
