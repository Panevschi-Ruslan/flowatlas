import { Injectable } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

import type { BotEvent, OrderCancelledEvent, OrderEvent, OrderPlacedEvent, OrderReadyEvent } from './bot-events';

/**
 * The bot's handlers, each marked as a consumer of the channel the shop
 * relays. None reads the type: the type each takes is said by its parameter's
 * declared type, by the `switch` in the route that calls it, or by both.
 */
@Injectable()
export class Bot {
  /** Its parameter says ORDER_READY, and the route calls it under `case 'ORDER_READY'`. */
  @Consumes('order_updates')
  handleOrderReady(event: OrderReadyEvent): string {
    return `ready ${event.orderId} ${event.label ?? ''}`;
  }

  /** Its parameter says nothing (`type: string`); the route calls it under two cases. */
  @Consumes('order_updates')
  handleStatus(event: OrderEvent): string {
    return `status ${event.orderId}`;
  }

  /** Nothing read calls it; its parameter says ORDER_PLACED. */
  @Consumes('order_updates')
  handlePlaced(event: OrderPlacedEvent): string {
    return `placed ${event.orderId}`;
  }

  /** Its parameter says ORDER_CANCELLED, and the route calls it under `case 'ORDER_REFUNDED'`: the route wins. */
  @Consumes('order_updates')
  handleRefund(event: OrderCancelledEvent): string {
    return `refund ${event.orderId}`;
  }

  /** Takes the whole union: every type alike, so it chooses none. */
  @Consumes('order_updates')
  log(event: BotEvent): string {
    return event.type;
  }
}
