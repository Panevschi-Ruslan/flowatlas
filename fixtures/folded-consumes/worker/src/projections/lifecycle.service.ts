import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { Consumes } from '@flowatlas/markers';
import { EventBus } from '../bus/event-bus.service';

/**
 * The states an order moves through, written as a union.
 *
 * The same closed set the publishing side of `folded-channels` derives its
 * channel names from, on the receiving side this time: the compiler already
 * knows there are three of them, and the subscription below is written once.
 */
export type OrderState = 'ORDER_OPENED' | 'ORDER_ON_HOLD' | 'ORDER_CLOSED';

export interface LifecycleEvent {
  readonly orderId: string;
}

@Injectable()
export class LifecycleProjections implements OnModuleInit {
  constructor(private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.subscribeTo('ORDER_OPENED');
  }

  /**
   * One subscription, three channels.
   *
   * `state` is a closed set and every step from it is a pure string operation
   * over literals, so the template folds once per member and this call draws a
   * `consumes` edge from each of `order:opened`, `order:on-hold` and
   * `order:closed` (R42).
   */
  private subscribeTo(state: OrderState): void {
    const verb = state.slice('ORDER_'.length).toLowerCase().replace(/_/g, '-');
    this.bus.pSubscribe(`order:${verb}`, (event: LifecycleEvent) => this.onLifecycle(event));
  }

  /**
   * Three annotations that restate what the subscription already says.
   *
   * All three should be reported as shadowed. Reading only the first `consumes`
   * edge answered for one of them, and two annotations stayed in the file with
   * nothing to say they were next (R45) — the receiving half of a fix that had
   * already been made for `@Emits` on a producer reaching several channels.
   */
  @Consumes('order:opened')
  @Consumes('order:on-hold')
  @Consumes('order:closed')
  onLifecycle(event: LifecycleEvent): void {
    void event.orderId;
  }
}
