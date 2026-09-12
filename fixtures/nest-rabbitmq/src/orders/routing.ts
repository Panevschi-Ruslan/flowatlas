/** Routing keys declared in this repo. A routing key is the channel name for the
 *  `nestjs-rabbitmq` adapter; the exchange goes to `producer.meta.exchange`. */
export enum RoutingKeys {
  ORDER_REFUNDED = 'order.refunded',
}

/** The exchange every publisher in this fixture writes to. */
export const ORDERS_EXCHANGE = 'orders-x';
