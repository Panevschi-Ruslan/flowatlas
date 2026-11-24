import { Injectable } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/** Publishes the shop's audit trail and its alerts on a second channel, the shop's events. */
@Injectable()
export class AuditService {
  private readonly bus: RedisClientType = createClient();

  async record(shopId: string, entryId: string): Promise<void> {
    await this.bus.publish(`shop:${shopId}:events`, JSON.stringify({ type: 'AUDIT_ENTRY_CREATED', id: entryId }));
  }

  async alert(shopId: string, alertId: string): Promise<void> {
    await this.bus.publish(`shop:${shopId}:events`, JSON.stringify({ type: 'ALERT_RAISED', id: alertId }));
  }
}
