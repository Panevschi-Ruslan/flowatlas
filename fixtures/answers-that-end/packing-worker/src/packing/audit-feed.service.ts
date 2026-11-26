import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { ShopBus } from '../bus/shop-bus.service';

interface PackingEvent {
  type: string;
  orderId: string;
}

/** Keeps the types a setting names, a set filled when the code runs: which it takes is not read. */
@Injectable()
export class AuditFeed implements OnModuleInit {
  private readonly kept = new Set<string>();
  private readonly lines: string[] = [];

  constructor(private readonly bus: ShopBus) {}

  start(types: readonly string[]): void {
    for (const type of types) this.kept.add(type);
  }

  onModuleInit(): void {
    this.bus.subscribe('packing_events', (event: PackingEvent) => this.onEvent(event));
  }

  onEvent(event: PackingEvent): void {
    if (!this.kept.has(event.type)) return;
    this.lines.push(event.orderId);
  }
}
