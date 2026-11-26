import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { ShopBus } from '../bus/shop-bus.service';
import { OrdersService } from './orders.service';

interface PackingEvent {
  type: string;
  orderId: string;
}

/**
 * Prints a receipt when an order is ready, reading the order back: the only
 * way `POST /api/orders/:id/ready` reaches `OrdersService.findOne` is across
 * the channel.
 */
@Injectable()
export class Receipts implements OnModuleInit {
  constructor(
    private readonly bus: ShopBus,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('packing_events', (event: PackingEvent) => this.onEvent(event));
  }

  onEvent(event: PackingEvent): void {
    if (event.type === 'ORDER_READY') this.print(event.orderId);
  }

  print(orderId: string): void {
    void this.orders.findOne(orderId).status;
  }
}
