import { Injectable } from '@nestjs/common';

import { ShopBus } from '../bus/shop-bus.service';

export interface Order {
  id: string;
  status: string;
}

/** The orders, and the packing channel each change is told on. */
@Injectable()
export class OrdersService {
  constructor(private readonly bus: ShopBus) {}

  findOne(id: string): Order {
    return { id, status: 'open' };
  }

  markReady(id: string): void {
    this.bus.publish('packing_events', { type: 'ORDER_READY', orderId: id });
  }

  /** Published, and chosen by no code: two consumers choose other types, two choose in a way not read. */
  delay(id: string, minutes: number): void {
    this.bus.publish('packing_events', { type: 'ORDER_DELAYED', orderId: id, minutes });
  }

  cancel(id: string): void {
    this.bus.publish('packing_events', { type: 'ORDER_CANCELLED', orderId: id });
  }
}
