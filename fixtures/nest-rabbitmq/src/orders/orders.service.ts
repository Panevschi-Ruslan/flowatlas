import { Inject, Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ClientProxy } from '@nestjs/microservices';
import type { Options } from 'amqplib';

import type {
  OrderCancelledEvent,
  OrderCreatedEvent,
  OrderRefundedEvent,
} from './order.dto';
import { ORDERS_EXCHANGE, RoutingKeys } from './routing';

/**
 * Producers. Two receivers live side by side on purpose: `AmqpConnection` from
 * `@golevelup/nestjs-rabbitmq`, and a `ClientProxy` registered on the RMQ
 * transport. Both belong to the `nestjs-rabbitmq` adapter, and neither may be
 * claimed by `nestjs-kafka` — `@nestjs/microservices` is in `package.json` but
 * `Transport.KAFKA` appears nowhere in the source, so the kafka half of the
 * detection rule (§7) never fires (D4).
 */
@Injectable()
export class OrdersService {
  private readonly publishOptions: Options.Publish = { persistent: true };

  constructor(
    private readonly amqp: AmqpConnection,
    @Inject('RMQ_CLIENT') private readonly client: ClientProxy,
  ) {}

  // The canonical row: `amqp.publish(exchange, routingKey, msg)`.
  // Expected: `channel:order.created`, `meta.kind: "message"`,
  // `meta.exchange: "orders-x"`, static.
  create(event: OrderCreatedEvent): Promise<void> {
    return this.amqp.publish('orders-x', 'order.created', event, this.publishOptions);
  }

  // Both arguments come from declarations in this repo: the exchange from a
  // const, the routing key from an enum member.
  // Expected: `channel:order.refunded`, `meta.exchange: "orders-x"`, static.
  refund(event: OrderRefundedEvent): Promise<void> {
    return this.amqp.publish(ORDERS_EXCHANGE, RoutingKeys.ORDER_REFUNDED, event);
  }

  // The routing key is a parameter, so there is no channel to name. The producer
  // survives with `meta.exchange` still resolved from the literal.
  // Expected: unresolved `channel-dynamic`, hint naming `OrdersService.publishTo`.
  publishTo(routingKey: string, event: OrderCreatedEvent): Promise<void> {
    return this.amqp.publish('orders-x', routingKey, event);
  }

  // The `ClientProxy` half. RMQ carries `emit` exactly like Kafka does, so this
  // is `meta.kind: "event"` with `meta.adapter: "nestjs-rabbitmq"`.
  // Expected: `channel:order.cancelled`, static.
  cancel(event: OrderCancelledEvent): void {
    this.client.emit('order.cancelled', event);
  }
}
