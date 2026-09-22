import { Injectable } from '@nestjs/common';

import { Emits } from '@flowatlas/markers';
import { EventBus } from '../bus/event-bus.service';
import type { LifecycleEvent, OrderState } from './order.dto';

@Injectable()
export class OrdersService {
  constructor(private readonly bus: EventBus) {}

  /**
   * Three channels from one publish, and three annotations that say so.
   *
   * `verb` is `opened`, `on-hold` or `closed` and nothing else: the parameter's
   * type is a closed set and every step from it is a pure string operation over
   * literals. So the reader folds the template once per member and the graph
   * holds `order:*:opened`, `order:*:on-hold` and `order:*:closed` — with the
   * three `@Emits` below deleted, which is what `doctor` says to do with them
   * (R42, R44).
   */
  @Emits('order:*:opened')
  @Emits('order:*:on-hold')
  @Emits('order:*:closed')
  publishLifecycle(orderId: string, state: OrderState, event: LifecycleEvent): void {
    const verb = state.slice('ORDER_'.length).toLowerCase().replace(/_/g, '-');
    this.bus.publish(`order:${orderId}:${verb}`, event);
  }

  /**
   * The other half of the same fact, and the reason the fold is trustworthy.
   *
   * `region` is typed `string`, so the set is not closed and the hole stays a
   * hole: one channel, `order:*:*:archived`. The reader expands what the code
   * pins down and guesses nothing else.
   */
  archiveInRegion(orderId: string, region: string, event: LifecycleEvent): void {
    this.bus.publish(`order:${orderId}:${region}:archived`, event);
  }
}
