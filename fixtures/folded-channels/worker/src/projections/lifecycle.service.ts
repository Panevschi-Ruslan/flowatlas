import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { EventBus } from '../bus/event-bus.service';

interface LifecycleEvent {
  readonly orderId: string;
}

/**
 * The other end of the three channels, in a repository that has never seen the
 * union they were derived from.
 *
 * Each subscription names one channel outright. They join the publishes in
 * `api` because the reader worked out what that template reaches — without the
 * fold, all three would hang off `order:*:*` and this service would look like
 * it listens to something nobody sends.
 */
@Injectable()
export class LifecycleProjections implements OnModuleInit {
  constructor(private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.bus.pSubscribe('order:*:opened', (event: LifecycleEvent) => this.onOpened(event));
    this.bus.pSubscribe('order:*:on-hold', (event: LifecycleEvent) => this.onHeld(event));
    this.bus.pSubscribe('order:*:closed', (event: LifecycleEvent) => this.onClosed(event));
  }

  onOpened(event: LifecycleEvent): void {
    void event.orderId;
  }

  onHeld(event: LifecycleEvent): void {
    void event.orderId;
  }

  onClosed(event: LifecycleEvent): void {
    void event.orderId;
  }
}
