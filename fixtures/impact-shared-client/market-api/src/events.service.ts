import { Injectable } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/** One channel per shop, every kind of message told apart by `type`. */
@Injectable()
export class EventsService {
  private readonly bus: RedisClientType = createClient();

  async itemsChanged(shopId: string): Promise<void> {
    await this.bus.publish(`shop:${shopId}:events`, JSON.stringify({ type: 'ITEMS_CHANGED' }));
  }

  async deskUrgent(shopId: string, deskId: string): Promise<void> {
    await this.bus.publish(`shop:${shopId}:events`, JSON.stringify({ type: 'DESK_URGENT', deskId }));
  }
}
