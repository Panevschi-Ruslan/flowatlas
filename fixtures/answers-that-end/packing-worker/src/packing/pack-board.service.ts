import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { ShopBus } from '../bus/shop-bus.service';
import { Scanner } from './scanner.service';

interface PackingEvent {
  type: string;
  orderId: string;
}

/** Chooses its types in a switch: not `ORDER_DELAYED`. */
@Injectable()
export class PackBoard implements OnModuleInit {
  constructor(
    private readonly bus: ShopBus,
    private readonly scanner: Scanner,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('packing_events', (event: PackingEvent) => this.onEvent(event));
  }

  onEvent(event: PackingEvent): void {
    switch (event.type) {
      case 'ORDER_CANCELLED':
        this.clear(event.orderId);
        break;
      default:
        break;
    }
  }

  clear(orderId: string): void {
    void orderId;
    this.scanner.start();
  }
}
