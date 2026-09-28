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

/**
 * What `billing` believes comes back from `orders.get`.
 *
 * `orders` answers with `id`, `total` and `placedAt`; this also requires a
 * `status` the handler never returns. The reply to a request over a channel is
 * a response like any other, with no compiler between its two ends (R151).
 */
export interface OrderDto {
  id: string;
  total: number;
  placedAt: string;
  status: string;
}
