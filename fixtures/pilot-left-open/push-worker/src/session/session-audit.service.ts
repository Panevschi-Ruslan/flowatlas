import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { TenantBus } from '../bus/tenant-bus.service';

/** Records every message on the session channels, whatever its type: a reader of no field. */
@Injectable()
export class SessionAudit implements OnModuleInit {
  readonly seen: string[] = [];

  constructor(private readonly bus: TenantBus) {}

  onModuleInit(): void {
    this.bus.subscribe('session:*:closed', (raw: string) => this.record(raw));
    this.bus.subscribe('session:*:paid', (raw: string) => this.record(raw));
    this.bus.subscribe('session:*:split', (raw: string) => this.record(raw));
  }

  record(raw: string): void {
    this.seen.push(raw);
  }
}
