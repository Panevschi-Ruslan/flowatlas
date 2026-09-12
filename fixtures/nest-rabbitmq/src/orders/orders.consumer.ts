import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';

import type { OrderCreatedEvent, OrderRefundedEvent } from './order.dto';
import { ORDERS_EXCHANGE, RoutingKeys } from './routing';

/**
 * Consumers on the exchange. `@RabbitSubscribe` is not a P01 entry decorator, so
 * these consumers carry `meta.entryId: null` — unlike the `@EventPattern`
 * consumer in `orders.controller.ts`, which points back at its entry (D1).
 *
 * The second parameter is the raw `amqplib` message, which is what the real
 * library hands the handler. It is a parameter type only and adds no node.
 */
@Injectable()
export class OrdersConsumer {
  // The canonical row: channel from `routingKey`, `meta.queue` from `queue`,
  // `meta.exchange` from `exchange`.
  // Expected: `channel:order.created`, `meta.queue: "orders-created-q"`, static.
  @RabbitSubscribe({
    exchange: 'orders-x',
    routingKey: 'order.created',
    queue: 'orders-created-q',
  })
  async onOrderCreated(event: OrderCreatedEvent, amqpMsg: ConsumeMessage): Promise<void> {
    void event.orderId;
    void amqpMsg.fields.routingKey;
  }

  // The same decorator with both names read from declarations in this repo.
  // Expected: `channel:order.refunded`, `meta.queue: "orders-refunded-q"`, static.
  @RabbitSubscribe({
    exchange: ORDERS_EXCHANGE,
    routingKey: RoutingKeys.ORDER_REFUNDED,
    queue: 'orders-refunded-q',
  })
  async onOrderRefunded(event: OrderRefundedEvent): Promise<void> {
    void event.amount;
  }
}
