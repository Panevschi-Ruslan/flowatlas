import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { EventBus } from '../bus/event-bus.service';

interface OrderEvent {
  readonly orderId: string;
  readonly total: number;
}

/**
 * The other end of the three channels, in a repository that has never seen the
 * service, the function or the route that publishes them.
 *
 * Each subscription names one channel outright. They join the publishes in
 * `api` only because every spelling of a publish is now read: with the class
 * walk alone, `orders:created` had one producer instead of two and
 * `orders:invoiced` and `orders:cancelled` had none, so two of these three
 * handlers listened to nothing at all.
 */
@Injectable()
export class OrderProjections implements OnModuleInit {
  constructor(private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.bus.subscribe('orders:created', (event: OrderEvent) => this.onCreated(event));
    this.bus.subscribe('orders:invoiced', (event: OrderEvent) => this.onInvoiced(event));
    this.bus.subscribe('orders:cancelled', (event: OrderEvent) => this.onCancelled(event));
  }

  onCreated(event: OrderEvent): void {
    void event.orderId;
  }

  onInvoiced(event: OrderEvent): void {
    void event.total;
  }

  onCancelled(event: OrderEvent): void {
    void event.orderId;
  }
}
