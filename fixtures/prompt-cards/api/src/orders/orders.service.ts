import { Injectable } from '@nestjs/common';

import { ShopBus } from '../bus/shop-bus.service';

export interface OrderView {
  id: string;
  status: string;
}

export interface OrderCancelled {
  type: 'ORDER_CANCELLED';
  orderId: string;
  reason: string;
}

@Injectable()
export class OrdersService {
  constructor(private readonly bus: ShopBus) {}

  findOne(orderId: string): OrderView {
    return { id: orderId, status: 'open' };
  }

  /** Publishes one typed message on the shop's channel and a line on the plain-named `audit` channel. */
  cancel(orderId: string, reason: string): OrderView {
    const order = this.findOne(orderId);
    const event: OrderCancelled = { type: 'ORDER_CANCELLED', orderId, reason };
    this.bus.publish(`shop:${order.id}:orders`, event);
    this.bus.publish('audit', { orderId, action: 'cancel' });
    return { ...order, status: 'cancelled' };
  }
}
