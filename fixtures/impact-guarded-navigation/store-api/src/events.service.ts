import { Injectable } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/** One channel per shop for its orders. */
@Injectable()
export class EventsService {
  private readonly bus: RedisClientType = createClient();

  async orderChanged(shopId: string): Promise<void> {
    await this.bus.publish(`shop:${shopId}:orders`, JSON.stringify({ type: 'ORDER_CHANGED' }));
  }
}
