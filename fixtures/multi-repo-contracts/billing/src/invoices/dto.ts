import type { MoneyDto } from '@fx/wire';

/**
 * What `billing` believes arrives on `order.created`.
 *
 * `orders` publishes `orderId`, `total` and `placedAt`; this requires a
 * `customerId` nobody publishes and reads `total` as a number rather than the
 * shared money shape. A channel has no compiler between its two ends, which is
 * exactly why it is worth checking.
 */
export interface OrderCreatedEvent {
  orderId: string;
  customerId: string;
  total: MoneyDto;
  placedAt: string;
}

/**
 * The question `billing` asks `orders` over a channel rather than a route.
 *
 * It leaves out the `includeItems` the handler requires and adds an
 * `includeRefunds` the handler has never heard of.
 */
export interface GetOrderQuery {
  orderId: string;
  includeRefunds: boolean;
}
