import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

export const ORDER_EVENTS_CLIENT = 'ORDER_EVENTS_CLIENT';

/** What both applications agree an order looks like when it is placed. */
export interface OrderPlaced {
  orderId: string;
  total: number;
}

/**
 * The one place an order event is sent from. A library of the workspace: no
 * manifest, reached by `shop` through the `@shop/order-events` alias the root
 * tsconfig declares.
 */
@Injectable()
export class OrderEvents {
  constructor(@Inject(ORDER_EVENTS_CLIENT) private readonly client: ClientProxy) {}

  placed(event: OrderPlaced): void {
    this.client.emit('order.placed', event);
  }
}
