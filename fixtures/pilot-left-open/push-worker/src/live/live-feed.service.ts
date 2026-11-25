import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { TenantBus } from '../bus/tenant-bus.service';
import { RESYNC_EVENT, ResyncService } from '../sync/resync.service';
import { OTHER_EVENTS, SEAT_EVENTS } from './event-sets';

/**
 * The types the live board redraws for, built by spreading a set and an
 * `as const` list from another file and adding a constant a service file
 * exports: every element is written out somewhere the reader can follow.
 */
const LIVE: ReadonlySet<string> = new Set([...OTHER_EVENTS, ...SEAT_EVENTS, RESYNC_EVENT]);

@Injectable()
export class LiveFeed implements OnModuleInit {
  constructor(
    private readonly bus: TenantBus,
    private readonly resync: ResyncService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('tenant:*:events', (raw: string) => {
      const evt = JSON.parse(raw) as { type: string; scopeId: string; tableId?: string };
      if (!LIVE.has(evt.type)) return;
      this.redraw(evt);
    });
  }

  redraw(evt: { scopeId: string; tableId?: string }): void {
    this.resync.resync(`${evt.scopeId}:${evt.tableId ?? 'all'}`);
  }
}
