import { Injectable } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/** Publishes what happens to a shop's orders on its orders channel, told apart by `type`. */
@Injectable()
export class OrdersService {
  private readonly bus: RedisClientType = createClient();

  async place(shopId: string, orderId: string): Promise<void> {
    await this.bus.publish(`shop:${shopId}:orders`, JSON.stringify({ type: 'ORDER_PLACED', id: orderId }));
  }

  async ship(shopId: string, orderId: string): Promise<void> {
    await this.bus.publish(`shop:${shopId}:orders`, JSON.stringify({ type: 'ORDER_SHIPPED', id: orderId }));
  }
}
