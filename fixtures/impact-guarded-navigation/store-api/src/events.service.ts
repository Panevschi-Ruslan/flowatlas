import { Injectable } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/** Three channels per shop: every change of its orders, the paid ones, and the closed ones. */
@Injectable()
export class EventsService {
  private readonly bus: RedisClientType = createClient();

  async orderChanged(shopId: string): Promise<void> {
    await this.bus.publish(`shop:${shopId}:orders`, JSON.stringify({ type: 'ORDER_CHANGED' }));
  }

  async orderPaid(shopId: string): Promise<void> {
    await this.bus.publish(`shop:${shopId}:paid`, JSON.stringify({ type: 'ORDER_PAID' }));
  }

  async orderClosed(shopId: string): Promise<void> {
    await this.bus.publish(`shop:${shopId}:closed`, JSON.stringify({ type: 'ORDER_CLOSED' }));
  }
}
