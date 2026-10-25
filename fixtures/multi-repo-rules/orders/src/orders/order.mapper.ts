import type { OrderDto, OrderStatus } from '@fx/contracts';

import type { Order } from './order.entity';

/**
 * The row shape and the wire shape are different things, and only the wire shape
 * is shared: `OrderDto` comes from `@fx/contracts`, so what this repository
 * returns and what `gateway` asks for are the same declaration (D6).
 */
export const toDto = (row: Order): OrderDto => ({
  id: row.id,
  customerId: row.customerId,
  status: row.status as OrderStatus,
  total: { amount: row.total, currency: row.currency },
});
