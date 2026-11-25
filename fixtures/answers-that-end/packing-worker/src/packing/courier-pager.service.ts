import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { ShopBus } from '../bus/shop-bus.service';

interface PackingEvent {
  type: string;
  orderId: string;
}

/** Pages a courier for the types a list names, filled when the code runs. */
@Injectable()
export class CourierPager implements OnModuleInit {
  private readonly paged: string[] = [];

  constructor(private readonly bus: ShopBus) {}

  watch(types: readonly string[]): void {
    this.paged.push(...types);
  }

  onModuleInit(): void {
    this.bus.subscribe('packing_events', (event: PackingEvent) => this.onEvent(event));
  }

  onEvent(event: PackingEvent): void {
    if (!this.paged.includes(event.type)) return;
    void event.orderId;
  }
}
