import { Injectable } from '@nestjs/common';
import { EventBus } from '../bus/event-bus';
import type { OrderCancelledFrame, OrderReadyFrame } from './order-frames';

@Injectable()
export class OrdersService {
  constructor(private readonly bus: EventBus) {}

  async markReady(orderId: string, label: string): Promise<void> {
    const frame: OrderReadyFrame = { type: 'ORDER_READY', orderId, label };
    await this.bus.publish('order_updates', frame);
  }

  async cancel(orderId: string, reason: string): Promise<void> {
    const frame: OrderCancelledFrame = { type: 'ORDER_CANCELLED', orderId, reason };
    await this.bus.publish('order_updates', frame);
  }
}
