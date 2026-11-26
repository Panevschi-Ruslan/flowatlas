import { Injectable } from '@nestjs/common';
import { ShopClient } from '../shop.client';

export interface OrderEvent {
  type: string;
  orderId: string;
  label?: string;
  reason?: string;
}

@Injectable()
export class BotService {
  constructor(private readonly shop: ShopClient) {}

  /** Reads the one optional field of the frame. */
  handleOrderReady(event: OrderEvent): string {
    const label = event.label ?? 'your order';
    return `ready: ${label}`;
  }

  /** Cancels on the shop for the client, then says so. */
  async handleOrderCancelled(event: OrderEvent): Promise<string> {
    const { orderId, reason } = event;
    await this.shop.cancelOrder(orderId, 'ops-bot');
    return `cancelled ${orderId}: ${reason ?? ''}`;
  }
}
